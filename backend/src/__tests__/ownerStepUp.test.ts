import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { recorder } from "./support/supabaseRecorder.js";

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => recorder.client,
}));

const { openMedia } = vi.hoisted(() => ({
  openMedia: vi.fn(async (_bucket: string, storagePath: string) => {
    const { Readable } = await import("node:stream");
    const bytes = Buffer.from(`bytes of ${storagePath}`);
    return { stream: Readable.from([bytes]), size: bytes.length, fromCache: false };
  }),
}));
vi.mock("../services/mediaCache.js", () => ({
  openMedia,
  cacheStats: async () => ({ files: 0, bytes: 0, maxBytes: 0 }),
}));

const { createApp } = await import("../app.js");
const { forgetSecondFactorFailures } = await import("../routes/owner.js");
const { hashPassword } = await import("../services/familyAuth.js");
const { codeAt, openTotpSecret, sealTotpSecret } = await import("../services/totp.js");
const app = createApp();

/**
 * The platform owner's password was the whole credential behind every
 * family's archive (security review 29 Sep 2026, access-5).
 *
 * What these hold:
 *   · export and print answer 401 `step_up_required` to the owner's session
 *     alone, before anything of the family's is read;
 *   · the step-up takes the password, and the authenticator code once
 *     two-step sign-in is on — and a code is spent once;
 *   · the step-up is bound to the session it was earned on, and to its kind;
 *   · every export, print and step-up leaves a row, and a row that cannot be
 *     written stops the act;
 *   · the print photograph comes through the backend, scoped to the card's
 *     archive, never as a Supabase URL (secrets-3, database-9);
 *   · two-step sign-in is enrolled in two steps and turned off with a code;
 *   · five wrong answers on one session end that session.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";
const OWNER = "cccccccc-0000-0000-0000-0000000000fc";
const SESSION = "owner-session";
const ARCHIVE = "aaaaaaaa-0000-0000-0000-00000000000a";
const CARD = "aaaaaaaa-0000-0000-0000-0000000000cd";
const MEDIA = "aaaaaaaa-0000-0000-0000-0000000000e1";
const PASSWORD = "a long enough owner passphrase";
const TOTP = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

let passwordHash = "";
beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

const FAMILY_COOKIE = "recall_family=owner-session-token";

function stepUpToken(claims: Record<string, unknown> = {}, expiresIn = 600) {
  return jwt.sign(
    { kind: "owner_step_up", familyId: OWNER, sessionId: SESSION, ...claims },
    SECRET,
    { expiresIn, algorithm: "HS256" }
  );
}

const steppedUp = (token = stepUpToken()) => [FAMILY_COOKIE, `recall_owner_step_up=${token}`];

function currentStep() {
  return Math.floor(Date.now() / 1000 / 30);
}

/** The platform owner — no archive, as in production — and one queued card. */
function world(owner: Record<string, unknown> = {}) {
  recorder.reset({
    families: [
      {
        id: OWNER,
        archive_id: null,
        email: "owner@example.invalid",
        platform_owner: true,
        status: "active",
        session_version: 1,
        password_hash: passwordHash,
        password_locked_until: null,
        owner_totp_secret: null,
        owner_totp_enabled_at: null,
        owner_totp_last_step: null,
        ...owner,
      },
    ],
    family_sessions: [{
      id: SESSION,
      family_id: OWNER,
      archive_id: null,
      person_id: null,
      role: null,
      session_version: 1,
      expires_at: "2099-01-01T00:00:00.000Z",
      revoked_at: null,
    }],
    nfc_cards: [{
      id: CARD,
      kind: "postcard",
      state: "queued",
      archive_id: ARCHIVE,
      media_file_id: MEDIA,
      created_at: "2026-09-01T00:00:00.000Z",
      channel: { number: 21, title: "Onze bruiloft", description: null },
      sender: { name: "Marie", relationship: "Dochter" },
      recipient: { name: "Margaret" },
    }],
    media_files: [{ id: MEDIA, archive_id: ARCHIVE, storage_path: `${ARCHIVE}/wedding.jpg` }],
    settings: [{ archive_id: ARCHIVE, display_name: "Margaret", full_name: null, delivery_address: "Kerkstraat 1" }],
    archives: [{ id: ARCHIVE, created_at: "2026-01-01T00:00:00.000Z" }],
  });
}

function enrolled(lastStep: number | null = null) {
  world({
    owner_totp_secret: sealTotpSecret(TOTP),
    owner_totp_enabled_at: "2026-09-29T00:00:00.000Z",
    owner_totp_last_step: lastStep,
  });
}

const auditRows = () => recorder.forTable("owner_audit_log").map((q) => q.payload as Record<string, unknown>);

beforeEach(() => {
  world();
  forgetSecondFactorFailures();
  openMedia.mockClear();
});

describe("content does not leave on the owner's session alone", () => {
  it.each([
    `/api/owner/fulfilment/${CARD}/print`,
    `/api/owner/fulfilment/${CARD}/photo`,
    "/api/owner/families/fam-x/export",
  ])("%s answers step_up_required and reads nothing of the family's", async (path) => {
    const res = await request(app).get(path).set("Cookie", [FAMILY_COOKIE]);

    expect(res.status).toBe(401);
    expect(res.body.step_up_required).toBe(true);
    expect(res.body.code).toBe("step_up_required");
    for (const table of ["nfc_cards", "media_files", "settings", "owner_audit_log"]) {
      expect(recorder.forTable(table), table).toHaveLength(0);
    }
    expect(openMedia).not.toHaveBeenCalled();
  });

  it("a stranger still meets the same 404, not a step-up prompt", async () => {
    world({ platform_owner: false });
    const res = await request(app).get(`/api/owner/fulfilment/${CARD}/print`).set("Cookie", steppedUp());
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found." });
  });

  it.each([
    ["another session", () => stepUpToken({ sessionId: "someone-elses-session" })],
    ["another family", () => stepUpToken({ familyId: "another-family" })],
    ["another kind of token", () => jwt.sign({ familyId: OWNER, sessionId: SESSION }, SECRET, { expiresIn: 600 })],
    ["an expired step-up", () => stepUpToken({}, -10)],
    ["a token signed with another key", () =>
      jwt.sign({ kind: "owner_step_up", familyId: OWNER, sessionId: SESSION }, "x".repeat(40), { expiresIn: 600 })],
  ])("a step-up cookie for %s is no step-up", async (_label, mint) => {
    const res = await request(app)
      .get(`/api/owner/fulfilment/${CARD}/print`)
      .set("Cookie", steppedUp(mint()));
    expect(res.status).toBe(401);
    expect(res.body.step_up_required).toBe(true);
  });
});

describe("the step-up", () => {
  it("takes the password and sets a short, httpOnly, strict cookie", async () => {
    const res = await request(app)
      .post("/api/owner/step-up")
      .set("Cookie", [FAMILY_COOKIE])
      .send({ password: PASSWORD });

    expect(res.status).toBe(200);
    const cookie = ([] as string[]).concat(res.headers["set-cookie"] ?? []).find((c) => c.startsWith("recall_owner_step_up="));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Max-Age=600/);
    expect(cookie).toMatch(/Path=\/api\/owner/);
    expect(auditRows()).toEqual([expect.objectContaining({ family_id: OWNER, action: "step_up" })]);

    // And the cookie it set opens the print sheet.
    const token = cookie!.split(";")[0].split("=")[1];
    const print = await request(app).get(`/api/owner/fulfilment/${CARD}/print`).set("Cookie", steppedUp(token));
    expect(print.status).toBe(200);
  });

  it("refuses a wrong password and sets nothing", async () => {
    const res = await request(app)
      .post("/api/owner/step-up")
      .set("Cookie", [FAMILY_COOKIE])
      .send({ password: "not the passphrase at all" });

    expect(res.status).toBe(401);
    expect(String(res.headers["set-cookie"] ?? "")).not.toContain("recall_owner_step_up=");
    expect(auditRows().map((r) => r.action)).toEqual(["step_up_failed"]);
    // Counted on the family row too — the lockout every instance shares (064).
    const counted = recorder.forTable("rpc:record_family_password_failure");
    expect(counted).toHaveLength(1);
    expect(counted[0].payload).toMatchObject({ p_family: OWNER });
  });

  it("honours the password lock the sign-in uses", async () => {
    world({ password_locked_until: new Date(Date.now() + 60_000).toISOString() });
    const res = await request(app)
      .post("/api/owner/step-up")
      .set("Cookie", [FAMILY_COOKIE])
      .send({ password: PASSWORD });
    expect(res.status).toBe(429);
    expect(String(res.headers["set-cookie"] ?? "")).not.toContain("recall_owner_step_up=");
  });

  it("does not step up when the audit row cannot be written", async () => {
    recorder.failNext = { table: "owner_audit_log", op: "insert", error: { message: "connection refused" } };
    const res = await request(app)
      .post("/api/owner/step-up")
      .set("Cookie", [FAMILY_COOKIE])
      .send({ password: PASSWORD });
    expect(res.status).toBe(500);
    expect(String(res.headers["set-cookie"] ?? "")).not.toContain("recall_owner_step_up=");
  });

  it("says whether one is live and whether a code will be asked for", async () => {
    enrolled();
    const idle = await request(app).get("/api/owner/step-up").set("Cookie", [FAMILY_COOKIE]);
    expect(idle.body).toMatchObject({ active: false, code_required: true });

    const live = await request(app).get("/api/owner/step-up").set("Cookie", steppedUp());
    expect(live.body.active).toBe(true);
  });

  describe("with two-step sign-in on", () => {
    it("the password alone is not enough", async () => {
      enrolled();
      const res = await request(app)
        .post("/api/owner/step-up")
        .set("Cookie", [FAMILY_COOKIE])
        .send({ password: PASSWORD });
      expect(res.status).toBe(401);
    });

    it("the password and a current code are, and the code is spent", async () => {
      enrolled();
      const step = currentStep();
      const res = await request(app)
        .post("/api/owner/step-up")
        .set("Cookie", [FAMILY_COOKIE])
        .send({ password: PASSWORD, code: codeAt(TOTP, step) });

      expect(res.status).toBe(200);
      // Spent in one conditional statement: only if newer than the last one.
      const spend = recorder.forTable("families").find((q) => q.op === "update");
      expect(spend?.payload).toMatchObject({ owner_totp_last_step: expect.any(Number) });
      expect(spend?.filters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ method: "eq", column: "id", value: OWNER }),
          expect.objectContaining({ method: "or" }),
        ])
      );
    });

    it("a code already used is refused (replay)", async () => {
      const step = currentStep();
      enrolled(step);
      const res = await request(app)
        .post("/api/owner/step-up")
        .set("Cookie", [FAMILY_COOKIE])
        .send({ password: PASSWORD, code: codeAt(TOTP, step) });
      expect(res.status).toBe(401);
      expect(recorder.forTable("families").some((q) => q.op === "update")).toBe(false);
    });

    /*
      Sign-in spends its code; the authenticator shows the same one for the
      rest of its 30 seconds. An owner who clicks Export straight after
      signing in types it again — rightly. That is not a wrong password:
      it gets its own answer, and counts toward neither lockout.
    */
    it("a right code already spent by sign-in gets its own answer, and counts nothing", async () => {
      const step = currentStep();
      enrolled(step);
      let last: request.Response | null = null;
      for (let i = 0; i < 6; i += 1) {
        last = await request(app)
          .post("/api/owner/step-up")
          .set("Cookie", [FAMILY_COOKIE])
          .send({ password: PASSWORD, code: codeAt(TOTP, step) });
        expect(last.status).toBe(401);
        expect(last.body.code).toBe("code_used");
        expect(last.body.error).toMatch(/next code/);
      }
      // Six times over: never signed out, never counted on the family row.
      expect(last!.body.code).not.toBe("signed_out");
      expect(recorder.forTable("rpc:record_family_password_failure")).toHaveLength(0);
      expect(
        recorder.forTable("family_sessions").some((q) => q.op === "update" && (q.payload as Record<string, unknown>).revoked_at)
      ).toBe(false);
    });

    it("a spent code with the WRONG password is still a wrong answer", async () => {
      const step = currentStep();
      enrolled(step);
      const res = await request(app)
        .post("/api/owner/step-up")
        .set("Cookie", [FAMILY_COOKIE])
        .send({ password: "not the passphrase at all", code: codeAt(TOTP, step) });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("step_up_refused");
      expect(recorder.forTable("rpc:record_family_password_failure")).toHaveLength(1);
    });

    it("a wrong code is refused", async () => {
      enrolled();
      const wrong = codeAt(TOTP, currentStep() + 10);
      const res = await request(app)
        .post("/api/owner/step-up")
        .set("Cookie", [FAMILY_COOKIE])
        .send({ password: PASSWORD, code: wrong });
      expect(res.status).toBe(401);
    });
  });

  it("five wrong answers on one session end the session", async () => {
    let last: request.Response | null = null;
    for (let i = 0; i < 5; i += 1) {
      last = await request(app)
        .post("/api/owner/step-up")
        .set("Cookie", [FAMILY_COOKIE])
        .send({ password: `wrong guess number ${i}` });
    }
    expect(last!.status).toBe(401);
    expect(last!.body.code).toBe("signed_out");
    const revoke = recorder
      .forTable("family_sessions")
      .find((q) => q.op === "update" && (q.payload as Record<string, unknown>).revoked_at);
    expect(revoke?.filters).toEqual(expect.arrayContaining([expect.objectContaining({ column: "id", value: SESSION })]));
  });
});

describe("the fulfilment queue list", () => {
  /*
    The list had no step-up and no audit row, and handed every in-flight
    family's name and home address to the owner's session alone. The
    address is half of what the print sheet guards; it leaves only there.
  */
  it("says whose card and whether an address exists — never the address", async () => {
    const res = await request(app).get("/api/owner/fulfilment").set("Cookie", [FAMILY_COOKIE]);

    expect(res.status).toBe(200);
    expect(res.body.cards[0].deliver_to).toEqual({ name: "Margaret", has_address: true });
    expect(JSON.stringify(res.body)).not.toContain("Kerkstraat");
  });

  it("flags a family with no address, so the queue can still warn", async () => {
    world();
    recorder.responses.settings = [{ archive_id: ARCHIVE, display_name: "Margaret", full_name: null, delivery_address: "  " }];
    const res = await request(app).get("/api/owner/fulfilment").set("Cookie", [FAMILY_COOKIE]);
    expect(res.body.cards[0].deliver_to).toEqual({ name: "Margaret", has_address: false });
  });

  it("the address is on the stepped-up, audited print sheet", async () => {
    const res = await request(app).get(`/api/owner/fulfilment/${CARD}/print`).set("Cookie", steppedUp());
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain("Kerkstraat 1");
    expect(auditRows().map((r) => r.action)).toEqual(["print"]);
  });
});

describe("the print sheet page reads once per opening", () => {
  /*
    Every read writes a 'print' audit row. Closing the browser's print
    dialog refocuses the window; with refetch-on-focus that left several
    rows per printed card, and raised the password dialog over an open
    sheet once the step-up lapsed.
  */
  it("never refetches on focus, and asks for the password only before a card is shown", async () => {
    const { readFileSync } = await import("node:fs");
    const page = readFileSync(
      new URL("../../../frontend/src/pages/owner/OwnerDashboard.tsx", import.meta.url).pathname,
      "utf8"
    );
    const sheet = page.slice(page.indexOf("function PrintSheet("), page.indexOf("function QueueButton("));
    expect(sheet).toMatch(/refetchOnWindowFocus: false/);
    expect(sheet).toMatch(/staleTime: Infinity/);
    expect(sheet).toMatch(/gcTime: 0/);
    expect(sheet).toMatch(/const stepUp = isError && needsStepUp\(error\) && !data;/);
  });
});

describe("the print sheet", () => {
  it("hands back a backend photo address, never a storage URL, and records the print", async () => {
    const res = await request(app).get(`/api/owner/fulfilment/${CARD}/print`).set("Cookie", steppedUp());

    expect(res.status).toBe(200);
    expect(res.body.photo_url).toMatch(new RegExp(`/api/owner/fulfilment/${CARD}/photo$`));
    expect(JSON.stringify(res.body)).not.toMatch(/supabase|token=|example\.invalid\/x|storage_path|wedding\.jpg/);
    expect(auditRows()).toEqual([
      expect.objectContaining({ family_id: OWNER, action: "print", archive_id: ARCHIVE, card_id: CARD }),
    ]);
  });

  it("reads the card's media inside the card's own archive", async () => {
    await request(app).get(`/api/owner/fulfilment/${CARD}/print`).set("Cookie", steppedUp());
    const reads = recorder.forTable("media_files");
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read.filters).toEqual(expect.arrayContaining([
        expect.objectContaining({ column: "archive_id", value: ARCHIVE }),
      ]));
    }
  });

  it("does not open when the audit row cannot be written", async () => {
    recorder.failNext = { table: "owner_audit_log", op: "insert", error: { message: "connection refused" } };
    const res = await request(app).get(`/api/owner/fulfilment/${CARD}/print`).set("Cookie", steppedUp());
    expect(res.status).toBe(500);
    expect(res.body.photo_url).toBeUndefined();
  });

  it("streams the photograph through the backend, scoped and uncached", async () => {
    const res = await request(app)
      .get(`/api/owner/fulfilment/${CARD}/photo`)
      .set("Cookie", steppedUp())
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(res.headers["cache-control"]).toContain("no-store");
    expect((res.body as Buffer).toString()).toBe(`bytes of ${ARCHIVE}/wedding.jpg`);
    expect(openMedia).toHaveBeenCalledWith("channel-media", `${ARCHIVE}/wedding.jpg`);
    for (const read of recorder.forTable("media_files")) {
      expect(read.filters).toEqual(expect.arrayContaining([
        expect.objectContaining({ column: "archive_id", value: ARCHIVE }),
      ]));
    }
    expect(auditRows().map((r) => r.action)).toEqual(["print_photo"]);
  });

  it("a card that has left the queue has no photograph to hand out", async () => {
    recorder.responses.nfc_cards = [];
    const res = await request(app).get(`/api/owner/fulfilment/${CARD}/photo`).set("Cookie", steppedUp());
    expect(res.status).toBe(404);
    expect(openMedia).not.toHaveBeenCalled();
  });
});

describe("two-step sign-in", () => {
  it("setting it up needs a step-up", async () => {
    const res = await request(app).post("/api/owner/totp/setup").set("Cookie", [FAMILY_COOKIE]).send({});
    expect(res.status).toBe(401);
    expect(res.body.step_up_required).toBe(true);
  });

  it("set-up issues a secret once, stores it sealed and not yet on", async () => {
    const res = await request(app).post("/api/owner/totp/setup").set("Cookie", steppedUp()).send({});

    expect(res.status).toBe(200);
    expect(res.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(res.body.uri).toContain(`secret=${res.body.secret}`);
    expect(res.body.uri).toMatch(/^otpauth:\/\/totp\//);

    const write = recorder.forTable("families").find((q) => q.op === "update");
    const payload = write!.payload as Record<string, unknown>;
    expect(payload.owner_totp_secret).not.toContain(res.body.secret);
    expect(openTotpSecret(payload.owner_totp_secret as string)).toBe(res.body.secret);
    expect(payload.owner_totp_enabled_at).toBeNull();
    // Never over an enrolled secret.
    expect(write!.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "is", column: "owner_totp_enabled_at", value: null }),
    ]));
  });

  it("set-up refuses while it is already on", async () => {
    enrolled();
    const res = await request(app).post("/api/owner/totp/setup").set("Cookie", steppedUp()).send({});
    expect(res.status).toBe(409);
    expect(recorder.forTable("families").some((q) => q.op === "update")).toBe(false);
  });

  it("the status never includes the secret", async () => {
    enrolled();
    const res = await request(app).get("/api/owner/totp").set("Cookie", [FAMILY_COOKIE]);
    expect(res.body.enrolled).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(TOTP);
    expect(JSON.stringify(res.body)).not.toContain("v1.");
  });

  it("confirm turns it on only with a code from the pending secret", async () => {
    world({ owner_totp_secret: sealTotpSecret(TOTP) });

    const wrong = await request(app)
      .post("/api/owner/totp/confirm")
      .set("Cookie", [FAMILY_COOKIE])
      .send({ code: codeAt(TOTP, currentStep() + 10) });
    expect(wrong.status).toBe(401);
    expect(recorder.forTable("families").some((q) => q.op === "update")).toBe(false);

    const right = await request(app)
      .post("/api/owner/totp/confirm")
      .set("Cookie", [FAMILY_COOKIE])
      .send({ code: codeAt(TOTP, currentStep()) });
    expect(right.status).toBe(200);
    const write = recorder.forTable("families").find((q) => q.op === "update");
    expect(write!.payload).toMatchObject({ owner_totp_enabled_at: expect.any(String), owner_totp_last_step: expect.any(Number) });
    expect(auditRows().map((r) => r.action)).toContain("totp_enabled");
  });

  it("turning it off needs a valid, unspent code", async () => {
    const step = currentStep();
    enrolled(step);

    const replay = await request(app)
      .post("/api/owner/totp/disable")
      .set("Cookie", [FAMILY_COOKIE])
      .send({ code: codeAt(TOTP, step) });
    expect(replay.status).toBe(401);
    expect(recorder.forTable("families").some((q) => q.op === "update")).toBe(false);

    enrolled(step - 5);
    const ok = await request(app)
      .post("/api/owner/totp/disable")
      .set("Cookie", [FAMILY_COOKIE])
      .send({ code: codeAt(TOTP, step) });
    expect(ok.status).toBe(200);
    const off = recorder.forTable("families").filter((q) => q.op === "update").at(-1);
    expect(off!.payload).toEqual({ owner_totp_secret: null, owner_totp_enabled_at: null, owner_totp_last_step: null });
    expect(auditRows().map((r) => r.action)).toContain("totp_disabled");
  });

  it("is the same 404 to anyone who is not the platform owner", async () => {
    world({ platform_owner: false });
    for (const [method, path] of [
      ["get", "/api/owner/totp"],
      ["post", "/api/owner/totp/setup"],
      ["post", "/api/owner/totp/confirm"],
      ["post", "/api/owner/totp/disable"],
      ["get", "/api/owner/step-up"],
      ["post", "/api/owner/step-up"],
    ] as const) {
      const res = await request(app)[method](path).set("Cookie", steppedUp()).send({ password: PASSWORD });
      expect(res.status, path).toBe(404);
    }
  });
});

describe("the doorstep matches addresses exactly (input-1 residue)", () => {
  it("escapes LIKE wildcards in the address it looks up", async () => {
    recorder.responses.families = [recorder.responses.families[0]];
    recorder.opResponses["families:select:id"] = [];
    recorder.opResponses["founding_invitations:insert"] = [{ id: "inv-1", expires_at: "2026-10-10T00:00:00.000Z" }];

    const res = await request(app)
      .post("/api/owner/door/invitations")
      .set("Cookie", [FAMILY_COOKIE])
      .send({ email: "j_n%x@example.org" });

    expect(res.status).toBe(201);
    const lookups = recorder.queries.filter((q) => q.filters.some((f) => f.method === "ilike"));
    expect(lookups.length).toBe(2);
    for (const q of lookups) {
      const f = q.filters.find((x) => x.method === "ilike")!;
      expect(f.value).toBe("j\\_n\\%x@example.org");
    }
  });

  it("an address with * matches nothing rather than everything", async () => {
    recorder.opResponses["founding_invitations:insert"] = [{ id: "inv-1", expires_at: "2026-10-10T00:00:00.000Z" }];

    const res = await request(app)
      .post("/api/owner/door/invitations")
      .set("Cookie", [FAMILY_COOKIE])
      .send({ email: "*@example.org" });

    // Treated as "no family has it": no pattern query, and no request row
    // marked invited by a wildcard.
    expect(res.status).toBe(201);
    expect(recorder.queries.some((q) => q.filters.some((f) => f.method === "ilike"))).toBe(false);
    expect(recorder.forTable("invitation_requests")).toHaveLength(0);
  });
});
