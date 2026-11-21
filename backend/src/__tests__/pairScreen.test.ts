import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import argon2 from "argon2";
import { recorder } from "./support/supabaseRecorder.js";

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => recorder.client,
}));

const { createApp } = await import("../app.js");
const { hashPin } = await import("../services/pins.js");
const app = createApp();

/**
 * M111 — pairing the family screen with the family credential.
 *
 * One page, one credential: the family email and password pair the screen in
 * the living room, exactly as `docs/specs/identity-model.md` § "The one
 * trusted device" describes. The old door — an "installation username" and an
 * access code on a second credential system — retires as a user-facing
 * concept, so this route is now the only way a family turns a machine into
 * the family screen.
 *
 * The security weight sits on the spec's exclusivity: while a trusted device
 * exists, no other device can become one. The database referees the race with
 * a partial unique index (migration 027); these tests hold the route to the
 * same rule from the outside.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";

const ARCHIVE_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const ARCHIVE_B = "bbbbbbbb-0000-0000-0000-00000000000b";
const FAMILY_A = "aaaaaaaa-0000-0000-0000-0000000000fa";
const SUBJECT_A = "aaaaaaaa-0000-0000-0000-0000000000c1";

const PASSWORD = "a-long-family-passphrase";
const PASSWORD_HASH = await argon2.hash(PASSWORD, { type: argon2.argon2id });

function familyRow(over: Record<string, unknown> = {}) {
  return {
    id: FAMILY_A,
    archive_id: ARCHIVE_A,
    password_hash: PASSWORD_HASH,
    session_version: 1,
    status: "active",
    platform_owner: false,
    ...over,
  };
}

/** The subject — the one profile whose session pairing starts. */
function subjectRow(over: Record<string, unknown> = {}) {
  return {
    id: SUBJECT_A,
    name: "Margaret",
    role: "user",
    status: "active",
    archive_id: ARCHIVE_A,
    archived_at: null,
    ...over,
  };
}

/*
 * access-2: the password alone no longer pairs. An admin of the archive
 * confirms with their own PIN. The recorder answers every query on a table
 * with the same rows, so the admin read is answered by its own select string
 * — otherwise the subject lookup that starts her session would be handed the
 * admin too.
 */
const ADMIN_A = "aaaaaaaa-0000-0000-0000-0000000000d1";
const ADMIN_PIN = "482915";
const ADMIN_PIN_HASH = await hashPin(ADMIN_PIN);
const ADMIN_SELECT = "id, name, role, status, archived_at, pin_hash, locked_until";

function adminRow(over: Record<string, unknown> = {}) {
  return {
    id: ADMIN_A,
    name: "Andy",
    role: "admin",
    status: "active",
    archived_at: null,
    archive_id: ARCHIVE_A,
    pin_hash: ADMIN_PIN_HASH,
    locked_until: null,
    ...over,
  };
}

function world(
  over: { families?: unknown[]; installations?: unknown[]; people?: unknown[]; admins?: unknown[] } = {}
) {
  recorder.reset(
    {
      families: (over.families ?? [familyRow()]) as Record<string, unknown>[],
      installations: (over.installations ?? []) as Record<string, unknown>[],
      people: (over.people ?? [subjectRow()]) as Record<string, unknown>[],
    },
    { [`people:select:${ADMIN_SELECT}`]: (over.admins ?? [adminRow()]) as Record<string, unknown>[] }
  );
}

function pair(body: Record<string, unknown>) {
  return request(app).post("/api/family/pair-screen").send(body);
}

const GOOD = {
  email: "family@example.invalid",
  password: PASSWORD,
  admin_person_id: ADMIN_A,
  pin: ADMIN_PIN,
};

/**
 * The set-cookie header, as a browser's jar would resolve it: the last
 * Set-Cookie for a name wins (RFC 6265), and a cleared cookie is not sent
 * back. Eviction clears before issuing, so both rules matter here.
 */
function cookiesOf(res: request.Response): string[] {
  const raw = (res.headers["set-cookie"] ?? []) as unknown as string[];
  const jar = new Map<string, string>();
  for (const line of raw) {
    const pair = line.split(";")[0];
    jar.set(pair.split("=")[0], pair);
  }
  return [...jar.values()].filter((pair) => pair.split("=").slice(1).join("=").length > 0);
}

beforeEach(() => world());

describe("pairing a screen on a family with none", () => {
  it("mints the device session and starts the subject's session", async () => {
    const res = await pair(GOOD);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, next: "/" });

    // The mechanism, not just the answer: one installation row, trusted,
    // in the family's own archive.
    const inserts = recorder.forTable("installations").filter((q) => q.op === "insert");
    expect(inserts).toHaveLength(1);
    const payload = inserts[0].payload as Record<string, unknown>;
    expect(payload.is_trusted).toBe(true);
    expect(payload.archive_id).toBe(ARCHIVE_A);

    // 056: the renewal cadence starts the moment a screen becomes hers —
    // ~90 days out, never left null for the notice logic to trip on.
    const expiresAt = Date.parse(payload.session_expires_at as string);
    const daysOut = (expiresAt - Date.now()) / 86_400_000;
    expect(daysOut).toBeGreaterThan(89);
    expect(daysOut).toBeLessThan(91);

    // Both sessions left on the browser: the machine's, and hers.
    const cookies = cookiesOf(res);
    expect(cookies.some((c) => c.startsWith("recall_device="))).toBe(true);
    expect(cookies.some((c) => c.startsWith("recall_profile="))).toBe(true);

    // And /auth/session agrees: this is now a trusted machine with the
    // subject at the keyboard — the acceptance criterion's own probe. The
    // jar is applied the way a browser applies Set-Cookie: in order, later
    // lines winning — the M116 eviction clears the profile *before* the
    // subject's fresh cookie is issued, and only the final state is real.
    const jar = new Map(cookiesOf(res).map((c) => c.split("=") as [string, string]));
    const browserJar = [...jar.entries()]
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${v}`);
    const session = await request(app).get("/api/auth/session").set("Cookie", browserJar);
    expect(session.body.device).toBe(true);
    expect(session.body.profile).toMatchObject({ name: "Margaret", role: "user" });
  });

  it("still pairs the screen when the archive has no subject yet", async () => {
    world({ people: [] });
    const res = await pair(GOOD);

    expect(res.status).toBe(200);
    const cookies = cookiesOf(res);
    expect(cookies.some((c) => c.startsWith("recall_device="))).toBe(true);
    // No profile session is minted. A bare clearing line ("recall_profile=")
    // is allowed — since M116 this path evicts any stale claim in the jar —
    // but a *valued* profile cookie here would be an invented person.
    expect(cookies.some((c) => c.startsWith("recall_profile=") && c !== "recall_profile=")).toBe(
      false
    );
  });
});

describe("exclusivity — one screen per family", () => {
  it("refuses when a trusted screen already exists, pointing at the replacement ceremony", async () => {
    world({
      installations: [
        { id: "existing", archive_id: ARCHIVE_A, is_trusted: true, revoked_at: null },
      ],
    });
    const res = await pair(GOOD);

    expect(res.status).toBe(409);
    // The refusal points at the real door (M117): the replacement ceremony,
    // gated by the family email. Until M117 this named the interim path
    // (sign the old screen out); now the ceremony exists, it names it.
    expect(res.body.error).toMatch(/replacement link/i);
    expect(res.body.error).toMatch(/family email/i);
    expect(res.body.code).toBe("screen_taken");

    // Verified by mechanism: no second recall_device is minted.
    expect(recorder.forTable("installations").filter((q) => q.op === "insert")).toHaveLength(0);
    expect(cookiesOf(res).some((c) => c.startsWith("recall_device="))).toBe(false);
  });

  /*
    047 — a Recall device is not the family's slot.

    The rule counted every trusted row the same, and there are now two kinds.
    A household shipped hardware had spent its only slot on a device it never
    chose to spend it on, and could never pair the tablet in the kitchen.
  */
  it("still lets a family pair its own screen beside a Recall device", async () => {
    world({
      installations: [
        {
          id: "the-hardware",
          archive_id: ARCHIVE_A,
          is_trusted: true,
          is_recall_device: true,
          revoked_at: null,
        },
      ],
    });

    const res = await pair(GOOD);

    expect(res.status).toBe(200);
    expect(cookiesOf(res).some((c) => c.startsWith("recall_device="))).toBe(true);
  });

  /*
    The other direction, and the one that matters more: narrowing the rule
    must not dissolve it. M116's property — the family password cannot mint a
    SECOND browser screen — is what the index and this route enforce together,
    and a hardware row beside it must not become a way to slip past.
  */
  it("refuses a second browser screen even when a Recall device is also present", async () => {
    world({
      installations: [
        {
          id: "the-hardware",
          archive_id: ARCHIVE_A,
          is_trusted: true,
          is_recall_device: true,
          revoked_at: null,
        },
        {
          id: "their-laptop",
          archive_id: ARCHIVE_A,
          is_trusted: true,
          is_recall_device: false,
          revoked_at: null,
        },
      ],
    });

    const res = await pair(GOOD);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("screen_taken");
    expect(recorder.forTable("installations").filter((q) => q.op === "insert")).toHaveLength(0);
  });

  /*
    The fail-safe direction, written as its own case because the first draft
    got it backwards.

    That draft filtered the query on `is_recall_device = false`, so a trusted
    row whose flag was absent or unreadable dropped out of the answer and the
    slot looked empty — a guard failing OPEN on the one question it exists to
    settle, and the cost is a second display in somebody's house. Exemption
    now requires proof: anything not explicitly hardware still blocks.
  */
  it("treats a trusted row that does not prove it is hardware as holding the slot", async () => {
    world({
      installations: [
        // No `is_recall_device` at all — the shape the old filter dropped.
        { id: "unlabelled", archive_id: ARCHIVE_A, is_trusted: true, revoked_at: null },
      ],
    });

    const res = await pair(GOOD);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("screen_taken");
  });

  it("translates a lost pairing race into the same refusal", async () => {
    // Two browsers pass the "no trusted screen yet" check together; the
    // database's unique index answers the loser with 23505.
    recorder.failNext = {
      table: "installations",
      op: "insert",
      error: { message: "duplicate key value violates unique constraint", code: "23505" },
    };
    const res = await pair(GOOD);

    expect(res.status).toBe(409);
    // The refusal points at the real door (M117): the replacement ceremony,
    // gated by the family email. Until M117 this named the interim path
    // (sign the old screen out); now the ceremony exists, it names it.
    expect(res.body.error).toMatch(/replacement link/i);
    expect(res.body.error).toMatch(/family email/i);
    expect(res.body.code).toBe("screen_taken");
    expect(cookiesOf(res).some((c) => c.startsWith("recall_device="))).toBe(false);
  });
});

describe("a screen that signs itself out frees the family's slot", () => {
  /*
   * The old way back after "Sign this screen out" was the access-code door,
   * which M111 retires. Without this, sign-out would strand the family: the
   * row would still hold the one trusted slot, so no screen — including this
   * same machine — could ever pair again until a replacement ceremony that
   * does not exist yet. Deliberate sign-out is the device relinquishing its
   * own slot; the ceremony remains the answer for a lost or stolen one.
   */
  const INSTALL = "aaaaaaaa-0000-0000-0000-0000000000f1";
  const deviceCookie = `recall_device=${jwt.sign(
    { installationId: INSTALL, archiveId: ARCHIVE_A },
    SECRET,
    { expiresIn: 3600 }
  )}`;

  it("untrusts and revokes the installation row on full sign-out", async () => {
    world({
      installations: [{ id: INSTALL, archive_id: ARCHIVE_A, is_trusted: true, revoked_at: null }],
    });
    const res = await request(app).post("/api/auth/sign-out").set("Cookie", [deviceCookie]);

    expect(res.status).toBe(200);
    const updates = recorder.forTable("installations").filter((q) => q.op === "update");
    expect(updates).toHaveLength(1);
    const payload = updates[0].payload as Record<string, unknown>;
    expect(payload.is_trusted).toBe(false);
    expect(payload.revoked_at).toBeTruthy();
    expect(updates[0].filters).toContainEqual({ method: "eq", column: "id", value: INSTALL });
  });

  it("lets the family pair again once the slot is freed", async () => {
    world({
      installations: [
        { id: INSTALL, archive_id: ARCHIVE_A, is_trusted: false, revoked_at: "2026-08-08" },
      ],
    });
    const res = await pair(GOOD);

    expect(res.status).toBe(200);
    expect(cookiesOf(res).some((c) => c.startsWith("recall_device="))).toBe(true);
  });

  it("still refuses while a revoked row holds the trusted flag", async () => {
    // Parity with the database: the partial unique index counts every row
    // where is_trusted, revoked or not. The check must refuse exactly where
    // the insert would fail, or the race answer and the kind answer diverge.
    world({
      installations: [
        { id: INSTALL, archive_id: ARCHIVE_A, is_trusted: true, revoked_at: "2026-08-08" },
      ],
    });
    const res = await pair(GOOD);

    expect(res.status).toBe(409);
  });
});

describe("the credential is refused without detail", () => {
  it("refuses a wrong password", async () => {
    const res = await pair({ ...GOOD, password: "not-the-password" });

    expect(res.status).toBe(401);
    expect(recorder.forTable("installations")).toHaveLength(0);
    expect(cookiesOf(res)).toHaveLength(0);
  });

  it("answers an unknown email identically to a wrong password", async () => {
    const wrongPassword = await pair({ ...GOOD, password: "not-the-password" });

    world({ families: [] });
    const unknownEmail = await pair(GOOD);

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
  });

  it("refuses a family that has never set a password, without a server error", async () => {
    // Three real families predate the family password (pre-M20). However
    // good the page is, /pair-screen cannot work for them — but it must
    // refuse like a wrong password, not fall over.
    world({ families: [familyRow({ password_hash: null })] });
    const res = await pair(GOOD);

    expect(res.status).toBe(401);
    expect(recorder.forTable("installations")).toHaveLength(0);
  });

  it("refuses the platform owner, who has no family screen to set up", async () => {
    world({ families: [familyRow({ archive_id: null, platform_owner: true })] });
    const res = await pair(GOOD);

    expect(res.status).toBe(409);
    expect(recorder.forTable("installations").filter((q) => q.op === "insert")).toHaveLength(0);
  });
});

describe("stale keys do not survive a sign-in that changes who the browser is (M116/F33)", () => {
  /*
   * The bug class: one cookie jar, two families. `requireRole` prefers the
   * family session and `requireDevice` prefers the device, so a browser
   * holding family A's remote session beside family B's fresh device answers
   * some questions as A and some as B — observed live on the Overview, half
   * a page each. /family/login evicts since M116; these pin the two other
   * doors that re-decide identity.
   */
  // A remote session left on the browser that is becoming the screen. (The
  // recorder answers every table with its fixture rows, so the session is
  // staged as the pairing family's own — the eviction path is identical for
  // a foreign one: read, revoke, clear.)
  const STALE_SESSION = {
    id: "stale-1",
    family_id: FAMILY_A,
    archive_id: ARCHIVE_A,
    person_id: null,
    role: null,
    session_version: 1,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    revoked_at: null,
  };

  it("pairing a screen revokes and clears any remote family session it finds", async () => {
    world();
    recorder.responses.family_sessions = [STALE_SESSION];

    const res = await request(app)
      .post("/api/family/pair-screen")
      .set("Cookie", ["recall_family=left-over-token"])
      .send(GOOD);
    expect(res.status).toBe(200);

    // Revoked server-side, not merely forgotten by this browser…
    const revokes = recorder
      .forTable("family_sessions")
      .filter((q) => q.op === "update")
      .filter((q) => !!(q.payload as Record<string, unknown>)?.revoked_at);
    expect(revokes.length).toBeGreaterThan(0);

    // …and the cookie cleared, so the jar holds one identity, not two.
    const raw = (res.headers["set-cookie"] ?? []) as unknown as string[];
    expect(raw.some((c) => c.startsWith("recall_family=;"))).toBe(true);
  });

  it("an installation sign-in evicts a stale family session too", async () => {
    recorder.reset({
      installations: [
        {
          id: "aaaaaaaa-0000-0000-0000-0000000000f1",
          username: "the-screen",
          secret_hash: await argon2.hash("ABCD12345678", { type: argon2.argon2id }),
          revoked_at: null,
          archive_id: ARCHIVE_A,
        },
      ],
      families: [familyRow()],
      family_sessions: [STALE_SESSION],
    });

    const res = await request(app)
      .post("/api/auth/installation/sign-in")
      .set("Cookie", ["recall_family=left-over-token"])
      .send({ username: "the-screen", secret: "ABCD-12345678" });

    expect(res.status).toBe(200);
    const revokes = recorder
      .forTable("family_sessions")
      .filter((q) => q.op === "update")
      .filter((q) => !!(q.payload as Record<string, unknown>)?.revoked_at);
    expect(revokes.length).toBeGreaterThan(0);
    const raw = (res.headers["set-cookie"] ?? []) as unknown as string[];
    expect(raw.some((c) => c.startsWith("recall_family=;"))).toBe(true);
  });
});

describe("adversarial — the archive comes from the verified row, never the request", () => {
  it("ignores an archive smuggled into the pairing body", async () => {
    const res = await pair({ ...GOOD, archive_id: ARCHIVE_B, is_trusted: false });

    expect(res.status).toBe(200);
    const inserts = recorder.forTable("installations").filter((q) => q.op === "insert");
    expect((inserts[0].payload as Record<string, unknown>).archive_id).toBe(ARCHIVE_A);

    // The cookie itself names the family's archive, not the smuggled one.
    const device = cookiesOf(res)
      .find((c) => c.startsWith("recall_device="))!
      .split("=")
      .slice(1)
      .join("=");
    const claims = jwt.verify(device, SECRET) as { archiveId?: string };
    expect(claims.archiveId).toBe(ARCHIVE_A);
  });

  it("ignores an archive smuggled into the remote sign-in body", async () => {
    const res = await request(app)
      .post("/api/family/login")
      .send({ ...GOOD, archive_id: ARCHIVE_B });

    expect(res.status).toBe(200);
    const inserts = recorder.forTable("family_sessions").filter((q) => q.op === "insert");
    expect(inserts).toHaveLength(1);
    expect((inserts[0].payload as Record<string, unknown>).archive_id).toBe(ARCHIVE_A);
  });
});
