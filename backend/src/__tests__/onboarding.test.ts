import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { recorder } from "./support/supabaseRecorder.js";

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => recorder.client,
}));

vi.mock("../services/email.js", () => ({
  sendInviteEmail: vi.fn(async () => ({ success: true })),
  sendVerificationEmail: vi.fn(async () => ({ success: true })),
  sendAccountExistsEmail: vi.fn(async () => ({ success: true })),
  sendWelcomeEmail: vi.fn(async () => ({ success: true })),
  sendPinResetEmail: vi.fn(async () => ({ success: true })),
  sendTestEmail: vi.fn(async () => ({ success: true })),
  sendInvitationRequestReceipt: vi.fn(async () => ({ success: true })),
  sendInvitationRequestNotice: vi.fn(async () => ({ success: true })),
}));

const { createApp } = await import("../app.js");
const { hashReceipt, generateReceipt, generateFounderToken, hashFounderToken, hashInviteToken } = await import(
  "../services/inviteCodes.js"
);
const email = await import("../services/email.js");
const app = createApp();

/**
 * The front door, tested as an attacker would knock on it.
 *
 * These are the bugs the review found, written down so they cannot come back:
 * a verification anyone could spend, a signup that told strangers who has an
 * account, an admin profile with no PIN, and an invitation two people could
 * accept at once.
 */

const RECEIPT = generateReceipt();
const ARCHIVE = "aaaaaaaa-0000-0000-0000-00000000000a";
const PERSON = "aaaaaaaa-0000-0000-0000-0000000000ad";
const INSTALL = "aaaaaaaa-0000-0000-0000-0000000000f1";

/**
 * A founding invitation, in the shape the route accepts (M44).
 *
 * Whether it is *real* is decided inside `create_household`, so every test
 * below that expects to reach the transaction carries a well-formed one; the
 * ones that prove the gate deliberately do not.
 */
const FOUNDER = generateFounderToken();

function signupBody(over: Record<string, unknown> = {}) {
  return {
    about: "someone",
    your_name: "Claire Fournier",
    email: "founder@example.com",
    pin: "314159",
    receipt: RECEIPT,
    founder_token: FOUNDER,
    subject: { full_name: "Margaret Fournier", birth_date: "1939-05-17" },
    relationship: "Son",
    // Her word (054): no archive without a declaration of who agrees.
    consent: { basis: "care_mandate", signer_name: "Claire Fournier", lang: "en" },
    ...over,
  };
}

/** The household function succeeded and handed back its four ids. */
function householdCreated() {
  recorder.reset({
    "rpc:create_household": [
      { account_id: "acc", archive_id: ARCHIVE, person_id: PERSON, installation_id: INSTALL },
    ],
  });
}

/** The household function refused — for any of its reasons. */
function householdRefused() {
  recorder.reset({});
  recorder.failure = { message: 'raise exception "signup_refused"' };
}

beforeEach(() => {
  recorder.reset({});
  vi.clearAllMocks();
});

describe("M14 — the receipt belongs to whoever earned it", () => {
  it("refuses a signup that presents no receipt", async () => {
    householdCreated();
    const res = await request(app).post("/api/onboarding/sign-up").send(
      signupBody({ receipt: undefined })
    );

    expect(res.status).toBe(403);
    // The hijack: no household function is even reached.
    expect(recorder.forTable("rpc:create_household")).toHaveLength(0);
  });

  it("sends the receipt's hash, never the receipt", async () => {
    householdCreated();
    await request(app).post("/api/onboarding/sign-up").send(signupBody());

    const [call] = recorder.forTable("rpc:create_household");
    const args = call.payload as Record<string, unknown>;
    expect(args.p_receipt_hash).toBe(hashReceipt(RECEIPT));
    expect(JSON.stringify(args)).not.toContain(RECEIPT);
  });

  it("refuses a replayed receipt — the database spends it, not the route", async () => {
    householdCreated();
    const first = await request(app).post("/api/onboarding/sign-up").send(signupBody());
    expect(first.status).toBe(201);

    // Second attempt: the conditional update inside the transaction matches
    // no row, so the function raises and the route refuses.
    householdRefused();
    const second = await request(app).post("/api/onboarding/sign-up").send(signupBody());
    expect(second.status).toBe(403);
  });

  it("mints a receipt only for the address that answered the code", async () => {
    recorder.reset({
      email_verifications: [{ id: "v1", expires_at: new Date(Date.now() + 60_000).toISOString() }],
    });

    const res = await request(app)
      .post("/api/onboarding/verify-email/check")
      .send({ email: "founder@example.com", code: "ABC234" });

    expect(res.status).toBe(200);
    expect(typeof res.body.receipt).toBe("string");

    // The lookup matches the emailed code itself, not the address alone — the
    // recorder returns the seeded row whatever the query said, so delete
    // `.eq("code_hash", …)` and any code verifies for a known address; the
    // match is asserted as query shape (F68 #8).
    const [lookup] = recorder.forTable("email_verifications");
    expect(lookup.op).toBe("select");
    expect(lookup.filters.some((f) => f.method === "eq" && f.column === "code_hash")).toBe(true);

    const [, update] = recorder.forTable("email_verifications");
    const payload = update.payload as Record<string, unknown>;
    // Stored as a hash, bound to the signup purpose, with its own expiry.
    expect(payload.receipt_hash).toBe(hashReceipt(res.body.receipt));
    expect(payload.receipt_hash).not.toBe(res.body.receipt);
    expect(payload.purpose).toBe("signup");
    expect(payload.receipt_expires_at).toBeTruthy();
  });
});

describe("M15 — the household is one transaction", () => {
  it("creates everything through a single call", async () => {
    householdCreated();
    const res = await request(app).post("/api/onboarding/sign-up").send(signupBody());

    expect(res.status).toBe(201);
    expect(recorder.forTable("rpc:create_household")).toHaveLength(1);
    // No hand-rolled sequence of inserts left to half-succeed.
    expect(recorder.forTable("families").filter((q) => q.op === "insert")).toHaveLength(0);
    expect(recorder.forTable("archives").filter((q) => q.op === "insert")).toHaveLength(0);
    expect(recorder.forTable("people").filter((q) => q.op === "insert")).toHaveLength(0);
    expect(recorder.forTable("archive_memberships")).toHaveLength(0);
  });

  it("never reports success without both cookies", async () => {
    householdCreated();
    const res = await request(app).post("/api/onboarding/sign-up").send(signupBody());

    const cookies = String(res.headers["set-cookie"] ?? "");
    expect(cookies).toContain("recall_device=");
    expect(cookies).toContain("recall_profile=");
  });

  it("fails rather than half-succeeding when the function returns nothing", async () => {
    recorder.reset({ "rpc:create_household": [] });
    const res = await request(app).post("/api/onboarding/sign-up").send(signupBody());

    expect(res.status).toBe(500);
    expect(String(res.headers["set-cookie"] ?? "")).not.toContain("recall_profile=");
  });
});

describe("M17 — no passwordless administrator", () => {
  it("requires a PIN at signup", async () => {
    householdCreated();
    const res = await request(app)
      .post("/api/onboarding/sign-up")
      .send(signupBody({ pin: undefined }));

    expect(res.status).toBe(400);
    expect(recorder.forTable("rpc:create_household")).toHaveLength(0);
  });

  it("rejects a PIN that is not six digits", async () => {
    householdCreated();
    for (const pin of ["123", "abcdef", "12345678"]) {
      const res = await request(app).post("/api/onboarding/sign-up").send(signupBody({ pin }));
      expect(res.status).toBe(400);
    }
  });

  it("passes a hash, never the PIN itself", async () => {
    householdCreated();
    await request(app).post("/api/onboarding/sign-up").send(signupBody({ pin: "271828" }));

    const [call] = recorder.forTable("rpc:create_household");
    const args = call.payload as Record<string, unknown>;
    expect(String(args.p_admin_pin_hash)).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(args)).not.toContain("271828");
  });
});

describe("M19 — public endpoints do not confirm who has an account", () => {
  it("answers identically for a taken and a free address", async () => {
    recorder.reset({ families: [{ id: "fam" }] });
    const taken = await request(app)
      .post("/api/onboarding/verify-email/send")
      .send({ email: "taken@example.com", name: "Someone" });

    // The free address's code row is read back by id, so it can be replaced
    // only once the new code has gone out.
    recorder.reset({ families: [], email_verifications: [{ id: "v-new" }] });
    const free = await request(app)
      .post("/api/onboarding/verify-email/send")
      .send({ email: "free@example.com", name: "Someone" });

    expect(taken.status).toBe(free.status);
    expect(taken.body).toEqual(free.body);
    expect(JSON.stringify(taken.body)).not.toMatch(/exists|taken|already/i);
  });

  it("sends no verification code to an address already in use", async () => {
    recorder.reset({ families: [{ id: "fam" }] });
    await request(app)
      .post("/api/onboarding/verify-email/send")
      .send({ email: "taken@example.com", name: "Someone" });

    expect(email.sendVerificationEmail).not.toHaveBeenCalled();
    // Nothing is written for an address that cannot be used.
    expect(recorder.forTable("email_verifications").filter((q) => q.op === "insert")).toHaveLength(0);
  });

  it("tells the address's real owner instead, so nobody is left stuck", async () => {
    recorder.reset({ families: [{ id: "fam" }] });
    await request(app)
      .post("/api/onboarding/verify-email/send")
      .send({ email: "taken@example.com", name: "Someone" });

    // The address only: the typed name is not the owner's to be greeted by.
    expect(email.sendAccountExistsEmail).toHaveBeenCalledWith("taken@example.com");
  });

  it("refuses a duplicate signup without saying that is the reason", async () => {
    householdRefused();
    const res = await request(app).post("/api/onboarding/sign-up").send(signupBody());

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toMatch(/exists|taken|already|receipt|expired/i);
  });

  it("gives every refusal the same answer, whatever went wrong", async () => {
    householdRefused();
    const duplicate = await request(app).post("/api/onboarding/sign-up").send(signupBody());

    householdCreated();
    const noReceipt = await request(app)
      .post("/api/onboarding/sign-up")
      .send(signupBody({ receipt: undefined }));

    expect(duplicate.status).toBe(noReceipt.status);
    expect(duplicate.body).toEqual(noReceipt.body);
  });
});

/**
 * M44 — the front door is not open.
 *
 * `POST /sign-up` used to be reachable by whoever found it: anyone could
 * create a family on this platform. Creating one now requires a founding
 * invitation the platform owner minted, and — the part that matters — the
 * token is spent inside the same transaction that creates the family, not
 * checked by the route and consumed a moment later. A token verified here
 * and spent there is a token two browsers can both verify.
 */
describe("M44 — a family cannot be created without an invitation", () => {
  it("refuses a signup carrying no founding token", async () => {
    householdCreated();

    const res = await request(app)
      .post("/api/onboarding/sign-up")
      .send(signupBody({ founder_token: undefined }));

    // The same 403 every other provokable signup refusal gives (M19): a
    // stranger cannot tell a missing invitation from a taken address.
    expect(res.status).toBe(403);
    // It never reached the transaction: nothing was created and no receipt
    // was spent by the attempt.
    expect(recorder.forTable("rpc:create_household")).toHaveLength(0);
  });

  it("refuses a malformed token the same way", async () => {
    householdCreated();

    const res = await request(app)
      .post("/api/onboarding/sign-up")
      .send(signupBody({ founder_token: "../../etc/passwd" }));

    expect(res.status).toBe(403);
    expect(recorder.forTable("rpc:create_household")).toHaveLength(0);
  });

  it("hands the token to the transaction, hashed, never in the clear", async () => {
    householdCreated();

    await request(app).post("/api/onboarding/sign-up").send(signupBody());

    const [call] = recorder.forTable("rpc:create_household");
    const args = call.payload as Record<string, unknown>;

    expect(args.p_founder_hash).toBe(hashFounderToken(FOUNDER));
    // The secret itself never travels to the database.
    expect(JSON.stringify(args)).not.toContain(FOUNDER);
  });

  it("gives a founder token a different hash than a member invitation", () => {
    /*
     * Domain separation, which is the whole reason the two cannot be
     * swapped. A member invitation joins a family; a founding one creates
     * a family. If they shared a domain, anyone ever invited to help with
     * an archive could found their own — and this is a hash mismatch
     * rather than a check some route has to remember.
     */
    const secret = "the-same-string-in-both-domains";
    expect(hashFounderToken(secret)).not.toBe(hashInviteToken(secret));
  });

  it("answers a request for an invitation identically however it lands", async () => {
    // New address, address that already asked, address that already has a
    // family — one answer, because anything else is a membership oracle.
    for (const rows of [{}, { invitation_requests: [{ id: "r1", email: "x@example.com" }] }]) {
      recorder.reset(rows);
      const res = await request(app)
        .post("/api/onboarding/founding/request")
        .send({ email: "x@example.com", name: "Someone", note: "For my mother." });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    }
  });

  it("tells both ends about a request — the stranger and the platform owner (checklist 19 §B)", async () => {
    recorder.reset({
      families: [{ id: "own1", email: "owner@example.com", platform_owner: true }],
    });
    const receipt = vi.mocked(email.sendInvitationRequestReceipt);
    const notice = vi.mocked(email.sendInvitationRequestNotice);
    receipt.mockClear();
    notice.mockClear();

    const res = await request(app)
      .post("/api/onboarding/founding/request")
      .send({ email: "Asker@Example.com", name: "Someone", note: "For my mother." });
    expect(res.body).toEqual({ ok: true });

    // The sends ride behind the answer, never in front of it — the owner's
    // address is looked up first, so the notice lands a few ticks later.
    await vi.waitFor(() => expect(notice).toHaveBeenCalled());
    expect(receipt).toHaveBeenCalledWith("asker@example.com");
    expect(notice).toHaveBeenCalledWith("owner@example.com", {
      email: "asker@example.com",
      name: "Someone",
      note: "For my mother.",
    });
  });

  it("gives a dead founding link the same gentle end as a fabricated one", async () => {
    for (const rows of [
      {},
      { founding_invitations: [{ id: "f1", email: "a@b.c", expires_at: new Date(Date.now() - 1000).toISOString() }] },
      { founding_invitations: [{ id: "f1", email: "a@b.c", expires_at: new Date(Date.now() + 1000).toISOString(), accepted_at: new Date().toISOString() }] },
      { founding_invitations: [{ id: "f1", email: "a@b.c", expires_at: new Date(Date.now() + 1000).toISOString(), revoked_at: new Date().toISOString() }] },
    ]) {
      recorder.reset(rows);
      const res = await request(app)
        .post("/api/onboarding/founding/check")
        .send({ token: generateFounderToken() });

      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: "This invitation is not valid any more." });
    }
  });
});

/**
 * M41 — the invitation carries the face it means.
 *
 * The transaction is where the real refusals live, and those are proven
 * against a real database in the staging suite. What is testable here is the
 * half the route owns: that a chosen profile actually travels with the
 * invitation, and that the obvious mistakes are answered in words instead of
 * being posted to somebody's inbox and failing at the far end.
 */
describe("M41 — an invitation names a profile", () => {
  const SECRET = "test-session-secret-that-is-long-enough-32";
  const SHELF = "aaaaaaaa-0000-0000-0000-0000000000e1";
  const SUBJECT = "aaaaaaaa-0000-0000-0000-0000000000c1";

  const cookies = [
    `recall_device=${jwt.sign({ installationId: INSTALL, archiveId: ARCHIVE }, SECRET, { expiresIn: 3600 })}`,
    `recall_profile=${jwt.sign({ personId: PERSON, name: "Admin", role: "admin", archiveId: ARCHIVE }, SECRET, { expiresIn: 3600 })}`,
  ];

  function family(people: Record<string, unknown>[]) {
    recorder.reset({
      installations: [{ id: INSTALL, archive_id: ARCHIVE, revoked_at: null, is_trusted: true }],
      settings: [{ archive_id: ARCHIVE, display_name: "Margaret" }],
      people: [
        {
          id: PERSON,
          name: "Admin",
          role: "admin",
          status: "active",
          archived_at: null,
          archive_id: ARCHIVE,
        },
        ...people,
      ],
      invitations: [],
    });
  }

  const shelfProfile = {
    id: SHELF,
    name: "Hélène",
    role: "co_author",
    status: "pending",
    archived_at: null,
    archive_id: ARCHIVE,
    joined_at: null,
  };

  function invite(over: Record<string, unknown> = {}) {
    return request(app)
      .post("/api/onboarding/invites")
      .set("Cookie", cookies)
      .send({
        invites: [
          { name: "Hélène", email: "helene@example.com", person_id: SHELF, ...over },
        ],
      });
  }

  it("stores the chosen profile on the invitation", async () => {
    family([shelfProfile]);

    const res = await invite();

    expect(res.status).toBe(201);
    const [written] = recorder.forTable("invitations").filter((q) => q.op === "insert");
    expect((written.payload as Record<string, unknown>).person_id).toBe(SHELF);
    // And it is still this family's invitation.
    expect((written.payload as Record<string, unknown>).archive_id).toBe(ARCHIVE);
  });

  it("sends no profile at all for somebody genuinely new", async () => {
    family([]);

    const res = await invite({ person_id: undefined });

    expect(res.status).toBe(201);
    const [written] = recorder.forTable("invitations").filter((q) => q.op === "insert");
    expect((written.payload as Record<string, unknown>).person_id).toBeNull();
  });

  it("reads the profile only within the caller's archive", async () => {
    family([shelfProfile]);
    await invite();

    // Not requireRole's own reload of the caller, which is the one legitimately
    // unscoped read — the invite route's lookup, identified by its columns.
    const [lookup] = recorder
      .forTable("people")
      .filter((q) => q.op === "select" && q.select === "id, role, joined_at");

    expect(lookup).toBeDefined();
    expect(lookup.filters.some((f) => f.column === "archive_id" && f.value === ARCHIVE)).toBe(true);
    expect(lookup.filters.some((f) => f.column === "id" && f.value === SHELF)).toBe(true);
  });

  /*
   * The three refusals — the subject, an already-joined profile, a face from
   * another family — are proven in the staging suite instead, and that is not
   * a gap being papered over.
   *
   * This double records the questions the routes ask; it does not answer them.
   * `maybeSingle()` hands back the first row of whatever the test provided,
   * whatever the filters said, which is exactly right for proving a query
   * named its archive and exactly useless for proving what happens when the
   * row that comes back is the subject's. Writing those here would mean
   * asserting against a fixture the route cannot actually have received —
   * the same shape of false confidence that let M22 and M45B ship broken
   * functions past a dozen green tests.
   *
   * So they live in `staging/staging.test.ts`, where a real database decides,
   * along with the transaction-level refusals they back onto.
   */
  void SUBJECT;
});

describe("M16 — invitations", () => {
  const TOKEN = "K".repeat(43);

  it("accepts through one transaction that re-asserts the conditions", async () => {
    recorder.reset({
      invitations: [
        {
          id: "inv1",
          archive_id: ARCHIVE,
          email: "aunt@example.com",
          name: "Aunt",
          relationship: "Aunt",
          role: "co_author",
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          code_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        },
      ],
      "rpc:accept_invitation": [
        {
          out_person_id: "p1",
          out_archive_id: ARCHIVE,
          out_role: "co_author",
          out_account_id: "acc",
        },
      ],
      // What the joiner's new family session is read back as (M94).
      families: [{ id: "fam-1", archive_id: ARCHIVE, session_version: 1, status: "active" }],
      family_sessions: [
        {
          id: "sess-join",
          family_id: "fam-1",
          archive_id: ARCHIVE,
          person_id: null,
          role: null,
          session_version: 1,
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          revoked_at: null,
        },
      ],
      people: [{ id: "p1", name: "Aunt Marie", role: "co_author", status: "active", archive_id: ARCHIVE, archived_at: null }],
    });

    const res = await request(app)
      .post("/api/onboarding/join/complete")
      .send({ token: TOKEN, pin: "246810", name: "Aunt Marie" });

    expect(res.status).toBe(201);
    expect(recorder.forTable("rpc:accept_invitation")).toHaveLength(1);
    // The route no longer writes the person, the membership, or the consume.
    expect(recorder.forTable("people").filter((q) => q.op === "insert")).toHaveLength(0);
    expect(recorder.forTable("archive_memberships")).toHaveLength(0);
    /*
     * No trusted device is born by joining (M94).
     *
     * The route used to mint an installation and hand the invitee's browser a
     * device cookie. A family may have exactly one trusted device, and a
     * joined member is meant to sign in from anywhere with the family
     * password and their PIN — so the joiner leaves with a family session
     * and nothing else.
     */
    expect(recorder.forTable("installations")).toHaveLength(0);
    const cookies = String(res.headers["set-cookie"] ?? "");
    expect(cookies).toContain("recall_family=");
    expect(cookies).not.toContain("recall_device=");

    // And it is elevated to them, so their next request knows who they are
    // without a second sign-in.
    const elevated = recorder
      .forTable("family_sessions")
      .filter((q) => q.op === "update" && (q.payload as Record<string, unknown>)?.person_id === "p1");
    expect(elevated).toHaveLength(1);
  });

  /*
   * M94, adversarial: the joiner is seated in the archive that invited them
   * and no other.
   *
   * The join now opens a family session, which means the route picks a family
   * row — and picking the wrong one would seat an invitee inside somebody
   * else's archive with a live, elevated session. The recorder answers
   * without honouring filters, so the answer proves nothing; what is checked
   * is that the *question* named the archive the transaction returned, and
   * that no query in the whole path ever named another one.
   */
  it("opens the joiner's session in the inviting archive and no other", async () => {
    const OTHER = "bbbbbbbb-0000-0000-0000-00000000000b";
    const live = {
      id: "inv-1",
      archive_id: ARCHIVE,
      email: "aunt@example.com",
      name: "Aunt",
      relationship: "Aunt",
      role: "co_author",
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      code_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    };
    recorder.reset({
      invitations: [live],
      "rpc:accept_invitation": [
        { out_person_id: "p1", out_archive_id: ARCHIVE, out_role: "co_author", out_account_id: "acc" },
      ],
      families: [{ id: "fam-1", archive_id: ARCHIVE, session_version: 1, status: "active" }],
      family_sessions: [
        {
          id: "sess-join",
          family_id: "fam-1",
          archive_id: ARCHIVE,
          person_id: null,
          role: null,
          session_version: 1,
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          revoked_at: null,
        },
      ],
      people: [
        { id: "p1", name: "Aunt Marie", role: "co_author", status: "active", archive_id: ARCHIVE, archived_at: null },
      ],
    });

    const res = await request(app)
      .post("/api/onboarding/join/complete")
      .send({ token: TOKEN, pin: "246810", name: "Aunt Marie" });

    expect(res.status).toBe(201);

    // The family was looked up by the archive the transaction returned.
    const lookups = recorder.forTable("families").filter((q) => q.op === "select");
    expect(lookups.length).toBeGreaterThan(0);
    expect(
      lookups.some((q) => q.filters.some((f) => f.column === "archive_id" && f.value === ARCHIVE))
    ).toBe(true);

    // The session row that was written names that archive too.
    const opened = recorder
      .forTable("family_sessions")
      .filter((q) => q.op === "insert")
      .map((q) => q.payload as Record<string, unknown>);
    expect(opened).toHaveLength(1);
    expect(opened[0].archive_id).toBe(ARCHIVE);

    // And nothing anywhere in the join ever mentioned the other family.
    const namedOther = recorder.queries.some(
      (q) =>
        q.filters.some((f) => f.value === OTHER) ||
        JSON.stringify(q.payload ?? {}).includes(OTHER)
    );
    expect(namedOther).toBe(false);
  });

  it("refuses when the transaction says somebody else won the race", async () => {
    recorder.reset({
      invitations: [
        {
          id: "inv1",
          archive_id: ARCHIVE,
          email: "aunt@example.com",
          name: "Aunt",
          role: "co_author",
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          code_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        },
      ],
    });
    recorder.failure = { message: 'raise exception "invitation_unavailable"' };

    const res = await request(app)
      .post("/api/onboarding/join/complete")
      .send({ token: TOKEN, pin: "246810", name: "Aunt Marie" });

    expect(res.status).toBe(404);
    expect(recorder.forTable("people").filter((q) => q.op === "insert")).toHaveLength(0);
  });

  it("judges a spoken code by its own, shorter expiry", async () => {
    // Link still live, spoken code already dead.
    recorder.reset({
      invitations: [
        {
          id: "inv1",
          archive_id: ARCHIVE,
          email: "aunt@example.com",
          name: "Aunt",
          role: "co_author",
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          code_expires_at: new Date(Date.now() - 1000).toISOString(),
        },
      ],
    });

    const res = await request(app).post("/api/onboarding/join/lookup").send({ code: "ABC234" });
    expect(res.status).toBe(404);
  });

  it("records every attempt atomically, successful or not", async () => {
    recorder.reset({ invitations: [] });
    await request(app).post("/api/onboarding/join/lookup").send({ code: "ABC234" });

    const [recorded] = recorder.forTable("rpc:record_invitation_attempt");
    expect(recorded).toBeTruthy();
    const payload = recorded.payload as Record<string, unknown>;
    expect(payload.p_succeeded).toBe(false);
    // The fingerprint identifies the attempt without storing the secret.
    expect(String(payload.p_fingerprint)).not.toContain("ABC234");
    // The counter is incremented by the database, not read-modify-written by
    // the route — which used to read a column it had not selected and so
    // wrote 1 forever.
    expect(
      recorder.forTable("invitations").filter((q) => q.op === "update" && "lookup_attempts" in (q.payload ?? {}))
    ).toHaveLength(0);
  });

  it("refuses a secret that has already been guessed at too often", async () => {
    recorder.reset({
      "rpc:invitation_attempt_pressure": [{ by_fingerprint: 8, by_email: 0 }],
      invitations: [
        {
          id: "inv1",
          archive_id: ARCHIVE,
          email: "aunt@example.com",
          name: "Aunt",
          role: "co_author",
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          code_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        },
      ],
    });

    const res = await request(app).post("/api/onboarding/join/lookup").send({ code: "ABC234" });

    expect(res.status).toBe(404);
    // Refused before the invitation was even read: guessing costs the
    // attacker a round trip and buys them nothing.
    expect(recorder.forTable("invitations")).toHaveLength(0);
  });

  it("closes the door on a spray of different guesses", async () => {
    /*
     * The per-secret counter cannot see this shape: every distinct wrong
     * guess is its own fingerprint's first attempt, so an attacker walking
     * the code space never trips it. What all the guesses share is the
     * attempts table, so past a global budget of recent failures the lookup
     * refuses everyone until the window passes — before reading the
     * invitation, before recording anything.
     */
    recorder.reset({
      invitation_attempts: Array.from({ length: 50 }, (_, i) => ({ id: `a${i}` })),
      invitations: [
        {
          id: "inv1",
          archive_id: ARCHIVE,
          email: "aunt@example.com",
          name: "Aunt",
          role: "co_author",
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          code_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        },
      ],
    });

    const res = await request(app).post("/api/onboarding/join/lookup").send({ code: "ABC234" });

    expect(res.status).toBe(404);
    expect(recorder.forTable("invitations")).toHaveLength(0);
    // Refused guesses are not recorded: the attack throttles to the budget
    // instead of holding the door shut against real invitees forever.
    expect(recorder.forTable("rpc:record_invitation_attempt")).toHaveLength(0);
  });

  it("refuses the lookup when the failure count cannot be read", async () => {
    /*
     * A limiter that treats "the database could not answer" as "zero recent
     * failures" is a limiter an attacker can switch off by inducing errors.
     * The count query failing closes the door instead.
     */
    recorder.reset({
      invitations: [
        {
          id: "inv1",
          archive_id: ARCHIVE,
          email: "aunt@example.com",
          name: "Aunt",
          role: "co_author",
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          code_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        },
      ],
    });
    recorder.failNext = {
      table: "invitation_attempts",
      op: "select",
      error: { message: "connection refused" },
    };

    const res = await request(app).post("/api/onboarding/join/lookup").send({ code: "ABC234" });

    expect(res.status).toBe(404);
    expect(recorder.forTable("invitations")).toHaveLength(0);
  });

  it("locks an invitation whose invitee is being hammered", async () => {
    recorder.reset({
      "rpc:invitation_attempt_pressure": [{ by_fingerprint: 0, by_email: 15 }],
      invitations: [
        {
          id: "inv1",
          archive_id: ARCHIVE,
          email: "aunt@example.com",
          name: "Aunt",
          role: "co_author",
          lookup_attempts: 0,
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          code_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        },
      ],
    });

    const res = await request(app).post("/api/onboarding/join/lookup").send({ code: "ABC234" });

    expect(res.status).toBe(404);
    const lock = recorder
      .forTable("invitations")
      .find((q) => q.op === "update" && "locked_until" in (q.payload ?? {}));
    expect(lock).toBeTruthy();
  });

  it("refuses an invitation that is inside its lockout", async () => {
    recorder.reset({
      "rpc:invitation_attempt_pressure": [{ by_fingerprint: 0, by_email: 0 }],
      invitations: [
        {
          id: "inv1",
          archive_id: ARCHIVE,
          email: "aunt@example.com",
          name: "Aunt",
          role: "co_author",
          locked_until: new Date(Date.now() + 600_000).toISOString(),
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          code_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        },
      ],
    });

    const res = await request(app).post("/api/onboarding/join/lookup").send({ code: "ABC234" });
    expect(res.status).toBe(404);
  });

  it("tells the transaction which secret was presented", async () => {
    const live = {
      id: "inv1",
      archive_id: ARCHIVE,
      email: "aunt@example.com",
      name: "Aunt",
      role: "co_author",
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      code_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const accepted = [
      {
        out_person_id: "p1",
        out_archive_id: ARCHIVE,
        out_role: "co_author",
        out_account_id: "acc",
        out_installation_id: INSTALL,
      },
    ];

    recorder.reset({ invitations: [live], "rpc:accept_invitation": accepted });
    await request(app)
      .post("/api/onboarding/join/complete")
      .send({ code: "ABC234", pin: "246810", name: "Aunt Marie" });
    expect(
      (recorder.forTable("rpc:accept_invitation")[0].payload as Record<string, unknown>)
        .p_secret_kind
    ).toBe("code");

    recorder.reset({ invitations: [live], "rpc:accept_invitation": accepted });
    await request(app)
      .post("/api/onboarding/join/complete")
      .send({ token: "K".repeat(43), pin: "246810", name: "Aunt Marie" });
    expect(
      (recorder.forTable("rpc:accept_invitation")[0].payload as Record<string, unknown>)
        .p_secret_kind
    ).toBe("token");
  });
});

describe("M18 — the lookup stops handing out the family's details", () => {
  beforeEach(() => {
    recorder.reset({
      invitations: [
        {
          id: "inv1",
          archive_id: ARCHIVE,
          email: "aunt@example.com",
          name: "Aunt Marie",
          relationship: "Aunt",
          role: "co_author",
          invited_by: PERSON,
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          code_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        },
      ],
      settings: [
        {
          display_name: "Margaret",
          full_name: "Margaret Fournier",
          birth_date: "1939-05-17",
          residence: "Bruxelles 1000",
        },
      ],
      people: [{ name: "Claire Fournier" }],
    });
  });

  it("never selects the subject's legal name, birth date or address", async () => {
    await request(app).post("/api/onboarding/join/lookup").send({ code: "ABC234" });

    const [settingsQuery] = recorder.forTable("settings");
    expect(settingsQuery.select).toBe("display_name");
  });

  it("returns only what lets an invitee recognise the family", async () => {
    const res = await request(app).post("/api/onboarding/join/lookup").send({ code: "ABC234" });

    expect(res.status).toBe(200);
    expect(res.body.subject).toEqual({ display_name: "Margaret" });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("Fournier");
    expect(body).not.toContain("1939-05-17");
    expect(body).not.toContain("Bruxelles");
  });

  it("identifies the inviter by first name only", async () => {
    const res = await request(app).post("/api/onboarding/join/lookup").send({ code: "ABC234" });

    expect(res.body.inviter_name).toBe("Claire");
  });
});

/**
 * Security review, 29 Sep 2026 — the public forms (authn-2, edge-1, input-2,
 * access-9, input-5).
 */
describe("the sign-up code goes to exactly the address typed", () => {
  it("matches a family's address exactly — `_` and `%` are not wildcards", async () => {
    recorder.reset({ families: [] });
    await request(app)
      .post("/api/onboarding/verify-email/send")
      .send({ email: "j_n%@example.com" });

    const [lookup] = recorder.forTable("families");
    const filter = lookup.filters.find((f) => f.method === "ilike");
    expect(filter?.value).toBe("j\\_n\\%@example.com");
  });

  it("answers an address with `*` as a free one, without asking the families table", async () => {
    recorder.reset({ families: [{ id: "fam" }], email_verifications: [{ id: "v-new" }] });
    const res = await request(app)
      .post("/api/onboarding/verify-email/send")
      .send({ email: "j*@example.com" });

    expect(res.status).toBe(200);
    expect(recorder.forTable("families")).toHaveLength(0);
    expect(email.sendAccountExistsEmail).not.toHaveBeenCalled();
    expect(email.sendVerificationEmail).toHaveBeenCalledTimes(1);
  });

  it("never passes the typed name into the mail", async () => {
    recorder.reset({ families: [], email_verifications: [{ id: "v-new" }] });
    await request(app)
      .post("/api/onboarding/verify-email/send")
      .send({ email: "free@example.com", name: "Your bank: call 0800 now" });

    const args = vi.mocked(email.sendVerificationEmail).mock.calls[0] as unknown[];
    expect(args[0]).toBe("free@example.com");
    expect(JSON.stringify(args)).not.toContain("bank");
  });

  it("says a held-back send was held back — never 'sent' — on both branches alike", async () => {
    // Somebody spending a victim's hourly budget used to leave the victim's
    // own page waiting for a code that had been "sent" and never would be.
    const heldBack = { success: false, reason: "held", throttled: true as const };
    vi.mocked(email.sendVerificationEmail).mockResolvedValueOnce(heldBack);
    vi.mocked(email.sendAccountExistsEmail).mockResolvedValueOnce(heldBack);

    recorder.reset({ families: [], email_verifications: [{ id: "v-new" }] });
    const free = await request(app).post("/api/onboarding/verify-email/send").send({ email: "free@example.com" });
    recorder.reset({ families: [{ id: "fam" }] });
    const taken = await request(app).post("/api/onboarding/verify-email/send").send({ email: "taken@example.com" });

    expect(free.status).toBe(429);
    expect(free.body.code).toBe("too_many_sent");
    expect(free.body.ok).toBeUndefined();
    expect(taken.status).toBe(free.status);
    expect(taken.body).toEqual(free.body);
  });

  it("answers a failed send the same way whether or not the address has a family", async () => {
    const failed = { success: false, reason: "The email could not be sent." };
    vi.mocked(email.sendVerificationEmail).mockResolvedValueOnce(failed);
    vi.mocked(email.sendAccountExistsEmail).mockResolvedValueOnce(failed);

    recorder.reset({ families: [], email_verifications: [{ id: "v-new" }] });
    const free = await request(app).post("/api/onboarding/verify-email/send").send({ email: "free@example.com" });
    recorder.reset({ families: [{ id: "fam" }] });
    const taken = await request(app).post("/api/onboarding/verify-email/send").send({ email: "taken@example.com" });

    expect(free.status).toBe(502);
    expect(taken.status).toBe(free.status);
    expect(taken.body).toEqual(free.body);
  });

  it("keeps the code already in the inbox when the new one was not sent", async () => {
    vi.mocked(email.sendVerificationEmail).mockResolvedValueOnce({
      success: false,
      reason: "held",
      throttled: true,
    });
    recorder.reset({ families: [], email_verifications: [{ id: "v-new" }] });
    await request(app).post("/api/onboarding/verify-email/send").send({ email: "free@example.com" });

    const deletes = recorder.forTable("email_verifications").filter((q) => q.op === "delete");
    // Only the unsent code goes; nothing is deleted by address.
    expect(deletes).toHaveLength(1);
    expect(deletes[0].filters).toEqual([{ method: "eq", column: "id", value: "v-new" }]);
  });

  it("replaces older codes only once the new one has gone out", async () => {
    const created = "2026-09-29T10:00:00.123456+00:00";
    recorder.reset({ families: [], email_verifications: [{ id: "v-new", created_at: created }] });
    await request(app).post("/api/onboarding/verify-email/send").send({ email: "free@example.com" });

    const ops = recorder.forTable("email_verifications").map((q) => q.op);
    expect(ops).toEqual(["insert", "delete"]);
    const [del] = recorder.forTable("email_verifications").filter((q) => q.op === "delete");
    expect(del.filters).toContainEqual({ method: "eq", column: "email", value: "free@example.com" });
    // Strictly older than this code: never "every code but mine".
    expect(del.filters).toContainEqual({ method: "lt", column: "created_at", value: created });
    expect(del.filters.some((f) => f.method === "neq")).toBe(false);
  });

  it("two sends overlapping leave the newer code alive", async () => {
    // A double tap: A inserts a, B inserts b, A sends, B sends. With
    // "delete all but mine" A removed b and B removed a — two mails, no code.
    // Played against a table that honours the filters, the newer code stays.
    type Row = { id: string; email: string; created_at: string };
    const table: Row[] = [
      { id: "a", email: "free@example.com", created_at: "2026-09-29T10:00:00.000001+00:00" },
      { id: "b", email: "free@example.com", created_at: "2026-09-29T10:00:00.000002+00:00" },
    ];
    const apply = (filters: { method: string; column: string; value: unknown }[]) => {
      for (let i = table.length - 1; i >= 0; i--) {
        const row = table[i] as unknown as Record<string, unknown>;
        const hit = filters.every((f) =>
          f.method === "eq"
            ? row[f.column] === f.value
            : f.method === "lt"
              ? String(row[f.column]) < String(f.value)
              : f.method === "neq"
                ? row[f.column] !== f.value
                : true
        );
        if (hit) table.splice(i, 1);
      }
    };

    for (const mine of [table[0], table[1]]) {
      recorder.reset({ families: [], email_verifications: [{ id: mine.id, created_at: mine.created_at }] });
      await request(app).post("/api/onboarding/verify-email/send").send({ email: "free@example.com" });
      const [del] = recorder.forTable("email_verifications").filter((q) => q.op === "delete");
      apply(del.filters);
    }

    expect(table.map((r) => r.id)).toEqual(["b"]);
  });
});

describe("a request for an invitation can never be rewritten by a stranger", () => {
  it("inserts, never upserts, and records a first request as pending", async () => {
    recorder.reset({});
    await request(app)
      .post("/api/onboarding/founding/request")
      .send({ email: "asker@example.com", name: "Someone", note: "For my mother." });

    const writes = recorder.forTable("invitation_requests");
    expect(writes.map((q) => q.op)).toEqual(["insert"]);
    expect((writes[0].payload as Record<string, unknown>).status).toBe("pending");
  });

  it("answers a repeat exactly like a first request, and writes and mails nothing", async () => {
    recorder.reset({ families: [{ id: "own1", email: "owner@example.com", platform_owner: true }] });
    recorder.failNext = {
      table: "invitation_requests",
      op: "insert",
      error: { message: "duplicate key value violates unique constraint", code: "23505" },
    };

    const res = await request(app)
      .post("/api/onboarding/founding/request")
      .send({ email: "victim@example.com", name: "Not them", note: "Overwritten" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const writes = recorder.forTable("invitation_requests");
    expect(writes.every((q) => q.op === "insert")).toBe(true);
    // Give any stray background send a chance to show itself.
    await new Promise((r) => setTimeout(r, 20));
    expect(email.sendInvitationRequestReceipt).not.toHaveBeenCalled();
    expect(email.sendInvitationRequestNotice).not.toHaveBeenCalled();
  });

  it("caps the stored name", async () => {
    recorder.reset({});
    await request(app)
      .post("/api/onboarding/founding/request")
      .send({ email: "asker@example.com", name: "x".repeat(500) });

    const [write] = recorder.forTable("invitation_requests");
    expect(String((write.payload as Record<string, unknown>).name)).toHaveLength(120);
  });
});

describe("public forms refuse a body that is not a form (input-5)", () => {
  const PUBLIC = [
    "/api/onboarding/founding/check",
    "/api/onboarding/founding/request",
    "/api/onboarding/verify-email/send",
    "/api/onboarding/verify-email/check",
    "/api/onboarding/sign-up",
    "/api/onboarding/join/lookup",
    "/api/onboarding/join/complete",
  ];

  it("answers 400 to no body, a bare string and an array", async () => {
    for (const path of PUBLIC) {
      const none = await request(app).post(path);
      expect(none.status, `${path} with no body`).toBe(400);

      const array = await request(app).post(path).send([{ email: "a@example.com" }]);
      expect(array.status, `${path} with an array`).toBe(400);

      const text = await request(app).post(path).set("Content-Type", "text/plain").send("hello");
      expect(text.status, `${path} with text`).toBe(400);
    }
  });

  it("still tells an anonymous caller of the admin route 401, not 400", async () => {
    const res = await request(app).post("/api/onboarding/invites");
    expect(res.status).toBe(401);
  });

  it("refuses an address longer than any mailbox can have", async () => {
    const long = `${"a".repeat(250)}@example.com`;
    for (const path of ["/api/onboarding/verify-email/send", "/api/onboarding/founding/request"]) {
      const res = await request(app).post(path).send({ email: long });
      expect(res.status, path).toBe(400);
    }
  });

  it("refuses a name past 120 characters at sign-up, before anything is created", async () => {
    householdCreated();
    const mine = await request(app)
      .post("/api/onboarding/sign-up")
      .send(signupBody({ your_name: "x".repeat(121) }));
    const theirs = await request(app)
      .post("/api/onboarding/sign-up")
      .send(signupBody({ subject: { full_name: "y".repeat(121) } }));

    expect(mine.status).toBe(400);
    expect(theirs.status).toBe(400);
    expect(recorder.forTable("rpc:create_household")).toHaveLength(0);
  });

  it("refuses a name past 120 characters when joining", async () => {
    recorder.reset({});
    const res = await request(app)
      .post("/api/onboarding/join/complete")
      .send({ code: "ABC234", pin: "314159", name: "z".repeat(121) });
    expect(res.status).toBe(400);
    expect(recorder.forTable("rpc:accept_invitation")).toHaveLength(0);
  });
});
