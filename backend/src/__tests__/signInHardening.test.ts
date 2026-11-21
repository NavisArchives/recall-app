import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import argon2 from "argon2";
import { readFileSync } from "node:fs";
import { recorder, type RecordedQuery } from "./support/supabaseRecorder.js";

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => recorder.client,
}));

vi.mock("../services/email.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/email.js")>()),
  sendFamilyRecoveryEmail: vi.fn(async () => ({ success: true })),
  sendScreenPairedEmail: vi.fn(async () => ({ success: true })),
}));

const { createApp } = await import("../app.js");
const { hashPin, checkPin, verifyPin } = await import("../services/pins.js");
const { DUMMY_PASSWORD_HASH, NO_FAMILY } = await import("../services/familyAuth.js");
const { sealTotpSecret, newTotpSecret, codeAt } = await import("../services/totp.js");
const email = await import("../services/email.js");
const app = createApp();

/**
 * The sign-in doors, after the 29 Sep 2026 review (064).
 *
 * input-1 / authn-1 / database-1 — /recover matched a typed address as an
 * ILIKE pattern and mailed the reset link to the typed address.
 * authn-3 / edge-2 — the family password had no per-account lockout.
 * access-5 — the platform owner's password was the whole credential.
 * access-2 — the family password alone paired a trusted screen.
 * access-3 — a PIN-less profile promoted past `user` opened with no PIN.
 * authn-8 — the PIN lockout reopened every fifteen minutes, forever.
 * SKEPTIC authn — PINs unpeppered; installation sign-in timing.
 * authn-5 — JWTs verified without a pinned algorithm or a token type.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";

const ARCHIVE_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const FAMILY_A = "aaaaaaaa-0000-0000-0000-0000000000fa";
const OWNER = "00000000-0000-0000-0000-0000000000ff";
const SUBJECT_A = "aaaaaaaa-0000-0000-0000-0000000000c1";
const ADMIN_A = "aaaaaaaa-0000-0000-0000-0000000000d1";
const COAUTHOR_A = "aaaaaaaa-0000-0000-0000-0000000000d2";
const INSTALL_A = "aaaaaaaa-0000-0000-0000-0000000000f1";

const STORED_EMAIL = "jan.peeters@example.invalid";
const PASSWORD = "a-long-family-passphrase";
const PASSWORD_HASH = await argon2.hash(PASSWORD, { type: argon2.argon2id });
const ADMIN_PIN = "482915";
const ADMIN_PIN_HASH = await hashPin(ADMIN_PIN);
const ADMIN_SELECT = "id, name, role, status, archived_at, pin_hash, locked_until";

/*
 * The recorder returns a table's rows whatever the filters say — a property
 * of the question, not the answer, is what it was built to check. These
 * doors are about the answer: a pattern that matched a stranger's row. So in
 * this file `ilike` is evaluated the way Postgres evaluates it once
 * PostgREST has handed it over: `%` and `_` are wildcards unless escaped with
 * a backslash, and PostgREST turns `*` into `%`.
 */
function ilikeMatches(pattern: string, value: unknown): boolean {
  if (typeof value !== "string") return false;
  let regex = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length) {
      regex += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (c === "%" || c === "*") {
      regex += ".*";
    } else if (c === "_") {
      regex += ".";
    } else {
      regex += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${regex}$`, "is").test(value);
}

type RowsFor = (record: RecordedQuery) => Record<string, unknown>[];
const recorderInternals = recorder as unknown as { rowsFor: RowsFor };
const originalRowsFor = recorderInternals.rowsFor.bind(recorder);
recorderInternals.rowsFor = (record) =>
  originalRowsFor(record).filter((row) =>
    record.filters.every((f) => f.method !== "ilike" || ilikeMatches(String(f.value), row[f.column]))
  );
afterAll(() => {
  recorderInternals.rowsFor = originalRowsFor;
});

function familyRow(over: Record<string, unknown> = {}) {
  return {
    id: FAMILY_A,
    email: STORED_EMAIL,
    display_name: "The Peeters Family",
    archive_id: ARCHIVE_A,
    password_hash: PASSWORD_HASH,
    session_version: 1,
    status: "active",
    platform_owner: false,
    failed_password_attempts: 0,
    password_locked_until: null,
    password_lock_count: 0,
    ...over,
  };
}

function subjectRow() {
  return {
    id: SUBJECT_A,
    name: "Margaret",
    role: "user",
    status: "active",
    archived_at: null,
    archive_id: ARCHIVE_A,
    pin_hash: null,
    failed_pin_attempts: 0,
    locked_until: null,
  };
}

function adminRow(over: Record<string, unknown> = {}) {
  return {
    id: ADMIN_A,
    name: "Andy",
    role: "admin",
    status: "active",
    archived_at: null,
    archive_id: ARCHIVE_A,
    pin_hash: ADMIN_PIN_HASH,
    failed_pin_attempts: 0,
    locked_until: null,
    ...over,
  };
}

function rpcCalls(fn: string): Record<string, unknown>[] {
  return recorder.forTable(`rpc:${fn}`).map((q) => (q.payload ?? {}) as Record<string, unknown>);
}

function cookieNames(res: request.Response): string[] {
  const raw = (res.headers["set-cookie"] ?? []) as unknown as string[];
  return raw
    .map((line) => line.split(";")[0])
    .filter((pair) => pair.split("=").slice(1).join("=").length > 0)
    .map((pair) => pair.split("=")[0]);
}

function login(body: Record<string, unknown>) {
  return request(app).post("/api/family/login").send(body);
}

beforeEach(() => {
  recorder.reset({ families: [familyRow()] });
  vi.mocked(email.sendFamilyRecoveryEmail).mockClear();
  vi.mocked(email.sendScreenPairedEmail).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────── /recover

describe("/recover matches the address exactly and mails the stored one (input-1)", () => {
  it("a `_` in the typed address matches nothing: no token, no mail", async () => {
    const res = await request(app).post("/api/family/recover").send({ email: "jan_peeters@example.invalid" });

    expect(res.status).toBe(200);
    expect(recorder.forTable("family_recovery_tokens").filter((q) => q.op === "insert")).toHaveLength(0);
    expect(email.sendFamilyRecoveryEmail).not.toHaveBeenCalled();
  });

  it("a `%` in the typed address matches nothing", async () => {
    const res = await request(app).post("/api/family/recover").send({ email: "jan%@example.invalid" });

    expect(res.status).toBe(200);
    expect(recorder.forTable("family_recovery_tokens").filter((q) => q.op === "insert")).toHaveLength(0);
    expect(email.sendFamilyRecoveryEmail).not.toHaveBeenCalled();
  });

  it("a `*` never even reaches the database", async () => {
    const res = await request(app).post("/api/family/recover").send({ email: "j*@example.invalid" });

    expect(res.status).toBe(200);
    expect(recorder.forTable("families")).toHaveLength(0);
    expect(email.sendFamilyRecoveryEmail).not.toHaveBeenCalled();
  });

  it("the three answers are identical to an unknown address's", async () => {
    const unknown = await request(app).post("/api/family/recover").send({ email: "nobody@example.invalid" });
    const wildcard = await request(app).post("/api/family/recover").send({ email: "j_n%@example.invalid" });
    expect(wildcard.body).toEqual(unknown.body);
  });

  it("the exact address in a different case still works — and the mail goes to the stored address", async () => {
    const res = await request(app).post("/api/family/recover").send({ email: "  JAN.Peeters@Example.invalid " });

    expect(res.status).toBe(200);
    expect(recorder.forTable("family_recovery_tokens").filter((q) => q.op === "insert")).toHaveLength(1);
    expect(email.sendFamilyRecoveryEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(email.sendFamilyRecoveryEmail).mock.calls[0][0]).toBe(STORED_EMAIL);
  });
});

describe("every identifier lookup is exact (authn-2)", () => {
  it("/login escapes LIKE metacharacters before they reach ilike", async () => {
    await login({ email: "jan_peeters@example.invalid", password: PASSWORD });

    const lookup = recorder.forTable("families").find((q) => q.filters.some((f) => f.method === "ilike"));
    expect(lookup?.filters.find((f) => f.method === "ilike")?.value).toBe("jan\\_peeters@example.invalid");
  });

  it("/login with a wildcard address and the right password is refused", async () => {
    const res = await login({ email: "jan%@example.invalid", password: PASSWORD });
    expect(res.status).toBe(401);
    expect(recorder.forTable("family_sessions").filter((q) => q.op === "insert")).toHaveLength(0);
  });

  it("/replace-screen does not mint a link for a pattern", async () => {
    await request(app).post("/api/family/replace-screen").send({ email: "jan_peeters@example.invalid" });
    expect(recorder.forTable("family_recovery_tokens").filter((q) => q.op === "insert")).toHaveLength(0);
  });

  it("installation sign-in matches the username exactly", async () => {
    recorder.reset({
      installations: [
        {
          id: INSTALL_A,
          username: "the-screen",
          secret_hash: await argon2.hash("ABCD12345678", { type: argon2.argon2id }),
          revoked_at: null,
          archive_id: ARCHIVE_A,
        },
      ],
    });
    const res = await request(app)
      .post("/api/auth/installation/sign-in")
      .send({ username: "the_screen", secret: "ABCD-12345678" });

    expect(res.status).toBe(401);
    expect(recorder.forTable("installations")[0].filters).toContainEqual({
      method: "ilike",
      column: "username",
      value: "the\\_screen",
    });
  });
});

// ─────────────────────────────────────────────── the password's lockout

describe("a per-family password lockout in the database (authn-3)", () => {
  it("claims the attempt on the family row before the password is checked", async () => {
    const res = await login({ email: STORED_EMAIL, password: "not-the-password" });

    expect(res.status).toBe(401);
    const calls = rpcCalls("begin_family_password_attempt");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ p_family: FAMILY_A, p_max: 10, p_lockout: "15 minutes", p_ceiling: "24 hours" });
    // Counted once, by the claim — nothing is written after a wrong password.
    expect(rpcCalls("record_family_password_failure")).toHaveLength(0);
  });

  it("an address that is not a family's is claimed with the nil id, which counts nothing", async () => {
    await login({ email: "nobody@example.invalid", password: "not-the-password" });
    expect(rpcCalls("begin_family_password_attempt")).toEqual([
      expect.objectContaining({ p_family: NO_FAMILY }),
    ]);
    expect(rpcCalls("record_family_password_failure")).toHaveLength(0);
  });

  /*
    The timing finding: a known family's wrong password used to await one
    more database write than an unknown address. The two now ask the
    database exactly the same questions, in the same order.
  */
  it("a wrong password and an unknown address make the same database calls", async () => {
    const shape = () => recorder.queries.map((q) => `${q.table}:${q.op}`);
    await login({ email: STORED_EMAIL, password: "not-the-password" });
    const known = shape();
    recorder.reset({ families: [] });
    await login({ email: STORED_EMAIL, password: "not-the-password" });
    const unknown = shape();

    expect(known).toEqual(["families:select", "rpc:begin_family_password_attempt:select"]);
    expect(unknown).toEqual(known);
  });

  it("a claim the database refuses is not checked, and answers as a wrong password", async () => {
    const wrong = await login({ email: STORED_EMAIL, password: "not-the-password" });
    recorder.reset({ families: [familyRow()], "rpc:begin_family_password_attempt": [{ allowed: false }] });
    const spy = vi.spyOn(argon2, "verify");
    const locked = await login({ email: STORED_EMAIL, password: PASSWORD });

    expect(locked.status).toBe(401);
    expect(locked.body).toEqual(wrong.body);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe(DUMMY_PASSWORD_HASH);
  });

  it("a claimed attempt that succeeds is always undone", async () => {
    recorder.reset({ families: [familyRow()], "rpc:begin_family_password_attempt": [{ allowed: true }] });
    const res = await login({ email: STORED_EMAIL, password: PASSWORD });

    expect(res.status).toBe(200);
    const reset = recorder
      .forTable("families")
      .filter((q) => q.op === "update")
      .map((q) => q.payload as Record<string, unknown>);
    expect(reset).toContainEqual({ failed_password_attempts: 0, password_locked_until: null, password_lock_count: 0 });
  });

  /*
    Guesses in flight together. Counting after the check let every request
    that read the row before the tenth failure landed be checked against the
    real hash. Played against a counter that behaves like the SQL function,
    thirty simultaneous guesses get ten real checks, not thirty.
  */
  it("a burst of parallel guesses gets no more real checks than the limit", async () => {
    const { supabase } = await import("../config/supabase.js");
    let attempts = 0;
    const realRpc = supabase.rpc.bind(supabase);
    vi.spyOn(supabase, "rpc").mockImplementation(((fn: string, args?: Record<string, unknown>) => {
      if (fn !== "begin_family_password_attempt") return realRpc(fn, args);
      attempts += 1;
      return Promise.resolve({ data: [{ allowed: attempts <= 10 }], error: null });
    }) as typeof supabase.rpc);
    const spy = vi.spyOn(argon2, "verify");

    const answers = await Promise.all(
      Array.from({ length: 30 }, (_, i) => login({ email: STORED_EMAIL, password: `guess-number-${i}` }))
    );

    expect(answers.every((r) => r.status === 401)).toBe(true);
    const real = spy.mock.calls.filter((call) => call[0] === PASSWORD_HASH);
    expect(real).toHaveLength(10);
  });

  it("while locked, the right password is not checked and the answer is a wrong password's", async () => {
    const wrong = await login({ email: STORED_EMAIL, password: "not-the-password" });

    recorder.reset({
      families: [familyRow({ password_locked_until: new Date(Date.now() + 600_000).toISOString(), password_lock_count: 1 })],
    });
    const spy = vi.spyOn(argon2, "verify");
    const locked = await login({ email: STORED_EMAIL, password: PASSWORD });

    expect(locked.status).toBe(401);
    expect(locked.body).toEqual(wrong.body);
    expect(cookieNames(locked)).not.toContain("recall_family");
    // The time is still spent — on the dummy, never on the family's hash.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe(DUMMY_PASSWORD_HASH);
  });

  it("answers an unknown address exactly as a locked one", async () => {
    recorder.reset({ families: [] });
    const unknown = await login({ email: STORED_EMAIL, password: PASSWORD });
    recorder.reset({
      families: [familyRow({ password_locked_until: new Date(Date.now() + 600_000).toISOString() })],
    });
    const locked = await login({ email: STORED_EMAIL, password: PASSWORD });

    expect(unknown.status).toBe(locked.status);
    expect(unknown.body).toEqual(locked.body);
  });

  it("a lock that has passed lets the right password in", async () => {
    recorder.reset({
      families: [familyRow({ password_locked_until: new Date(Date.now() - 1000).toISOString(), password_lock_count: 2 })],
    });
    const res = await login({ email: STORED_EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it("with no answer from the claim, falls back on the lock read with the row", async () => {
    // The recorder answers an rpc with no rows: the claim could not decide.
    recorder.reset({
      families: [familyRow({ password_locked_until: new Date(Date.now() + 600_000).toISOString() })],
    });
    const res = await login({ email: STORED_EMAIL, password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it("a right password resets the attempts and the lock count", async () => {
    recorder.reset({ families: [familyRow({ failed_password_attempts: 4, password_lock_count: 2 })] });
    const res = await login({ email: STORED_EMAIL, password: PASSWORD });

    expect(res.status).toBe(200);
    const reset = recorder
      .forTable("families")
      .filter((q) => q.op === "update")
      .map((q) => q.payload as Record<string, unknown>);
    expect(reset).toContainEqual({ failed_password_attempts: 0, password_locked_until: null, password_lock_count: 0 });
  });

  it("an ordinary sign-in with nothing to clear writes nothing to the family row", async () => {
    const res = await login({ email: STORED_EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(recorder.forTable("families").filter((q) => q.op === "update")).toHaveLength(0);
  });

  it("/pair-screen claims its attempt too", async () => {
    await request(app).post("/api/family/pair-screen").send({ email: STORED_EMAIL, password: "nope-nope-nope" });
    expect(rpcCalls("begin_family_password_attempt")).toEqual([expect.objectContaining({ p_family: FAMILY_A })]);
  });

  it("changing the password claims an attempt first, and refuses while locked", async () => {
    const session = {
      id: "sess-admin",
      family_id: FAMILY_A,
      archive_id: ARCHIVE_A,
      person_id: ADMIN_A,
      role: "admin",
      session_version: 1,
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      revoked_at: null,
    };
    recorder.reset({ family_sessions: [session], families: [familyRow()], people: [adminRow()] });
    const wrong = await request(app)
      .post("/api/family/password")
      .set("Cookie", ["recall_family=opaque"])
      .send({ current: "not-the-password", password: "a-brand-new-family-passphrase" });
    expect(wrong.status).toBe(401);
    expect(rpcCalls("begin_family_password_attempt")).toEqual([expect.objectContaining({ p_family: FAMILY_A })]);
    expect(recorder.forTable("families").filter((q) => q.op === "update")).toHaveLength(0);

    recorder.reset({
      family_sessions: [session],
      families: [familyRow({ password_locked_until: new Date(Date.now() + 600_000).toISOString() })],
      people: [adminRow()],
    });
    const locked = await request(app)
      .post("/api/family/password")
      .set("Cookie", ["recall_family=opaque"])
      .send({ current: PASSWORD, password: "a-brand-new-family-passphrase" });
    expect(locked.status).toBe(401);
    expect(recorder.forTable("families").filter((q) => q.op === "update")).toHaveLength(0);

    // And when the claim itself says locked, even the right current password is refused.
    recorder.reset({
      family_sessions: [session],
      families: [familyRow()],
      people: [adminRow()],
      "rpc:begin_family_password_attempt": [{ allowed: false }],
    });
    const claimedLocked = await request(app)
      .post("/api/family/password")
      .set("Cookie", ["recall_family=opaque"])
      .send({ current: PASSWORD, password: "a-brand-new-family-passphrase" });
    expect(claimedLocked.status).toBe(401);
    expect(recorder.forTable("families").filter((q) => q.op === "update")).toHaveLength(0);
  });
});

// ─────────────────────────────── the way back in past somebody's guessing

describe("a completed recovery gets its browser past a re-armed lock", () => {
  const LOCKED_CLAIM = { "rpc:begin_family_password_attempt": [{ allowed: false }] };

  async function recover(): Promise<string> {
    recorder.reset({ "rpc:recover_family_password": [FAMILY_A as unknown as Record<string, unknown>] });
    const res = await request(app)
      .post("/api/family/recover/complete")
      .send({ token: "the-token-from-the-inbox", password: PASSWORD });
    expect(res.status).toBe(200);
    const raw = (res.headers["set-cookie"] ?? []) as unknown as string[];
    const line = raw.find((l) => l.startsWith("recall_recovered="));
    expect(line).toBeDefined();
    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/SameSite=Strict/i);
    expect(line).toMatch(/Path=\/api\/family/);
    return line!.split(";")[0];
  }

  it("signs in with the right password although somebody locked it again", async () => {
    const cookie = await recover();
    recorder.reset({ families: [familyRow()], ...LOCKED_CLAIM });
    const res = await login({ email: STORED_EMAIL, password: PASSWORD }).set("Cookie", [cookie]);

    expect(res.status).toBe(200);
    // The lock is cleared for everyone, and the cookie is spent.
    const reset = recorder.forTable("families").filter((q) => q.op === "update").map((q) => q.payload);
    expect(reset).toContainEqual({ failed_password_attempts: 0, password_locked_until: null, password_lock_count: 0 });
    const cleared = ((res.headers["set-cookie"] ?? []) as unknown as string[]).some((l) =>
      /^recall_recovered=;/.test(l)
    );
    expect(cleared).toBe(true);
  });

  it("buys one attempt: a wrong password spends it", async () => {
    const cookie = await recover();
    recorder.reset({ families: [familyRow()], ...LOCKED_CLAIM });
    const res = await login({ email: STORED_EMAIL, password: "not-the-password" }).set("Cookie", [cookie]);

    expect(res.status).toBe(401);
    const cleared = ((res.headers["set-cookie"] ?? []) as unknown as string[]).some((l) =>
      /^recall_recovered=;/.test(l)
    );
    expect(cleared).toBe(true);
  });

  it("is no use for another family's address", async () => {
    const cookie = await recover();
    const OTHER = "bbbbbbbb-0000-0000-0000-0000000000fb";
    recorder.reset({ families: [familyRow({ id: OTHER })], ...LOCKED_CLAIM });
    const spy = vi.spyOn(argon2, "verify");
    const res = await login({ email: STORED_EMAIL, password: PASSWORD }).set("Cookie", [cookie]);

    expect(res.status).toBe(401);
    expect(spy.mock.calls.every((call) => call[0] === DUMMY_PASSWORD_HASH)).toBe(true);
  });

  it("a forged cookie is ignored", async () => {
    const forged = `recall_recovered=${jwt.sign({ kind: "family_recovered", familyId: FAMILY_A }, "not-the-secret-at-all-but-long-enough")}`;
    recorder.reset({ families: [familyRow()], ...LOCKED_CLAIM });
    const res = await login({ email: STORED_EMAIL, password: PASSWORD }).set("Cookie", [forged]);
    expect(res.status).toBe(401);
  });
});

// ───────────────────────────────────────── the platform owner's second factor

describe("the platform owner signs in with a code as well (access-5)", () => {
  const TOTP = newTotpSecret();
  const step = () => Math.floor(Date.now() / 1000 / 30);

  function owner(over: Record<string, unknown> = {}) {
    return familyRow({
      id: OWNER,
      archive_id: null,
      platform_owner: true,
      owner_totp_secret: sealTotpSecret(TOTP),
      owner_totp_enabled_at: "2026-09-29T10:00:00Z",
      owner_totp_last_step: null,
      ...over,
    });
  }

  it("asks for the code after a right password, and opens no session", async () => {
    recorder.reset({ families: [owner()] });
    const res = await login({ email: STORED_EMAIL, password: PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.needs_code).toBe(true);
    expect(recorder.forTable("family_sessions").filter((q) => q.op === "insert")).toHaveLength(0);
    expect(cookieNames(res)).not.toContain("recall_family");
    // Not a failure: the password was right, the code simply had not come yet.
    expect(rpcCalls("record_family_password_failure")).toHaveLength(0);
  });

  it("never asks a wrong password for a code", async () => {
    recorder.reset({ families: [owner()] });
    const res = await login({ email: STORED_EMAIL, password: "not-the-password" });
    expect(res.status).toBe(401);
    expect(res.body.needs_code).toBeUndefined();
  });

  it("signs in with the current code and stores its step", async () => {
    recorder.reset({ families: [owner()] });
    const now = step();
    const res = await login({ email: STORED_EMAIL, password: PASSWORD, code: codeAt(TOTP, now) });

    expect(res.status).toBe(200);
    expect(res.body.next).toBe("/owner");
    const stored = recorder
      .forTable("families")
      .filter((q) => q.op === "update")
      .map((q) => q.payload as Record<string, unknown>)
      .find((p) => "owner_totp_last_step" in p);
    expect(stored?.owner_totp_last_step).toBe(now);
  });

  /** Nothing reset the family's count: no update that zeroes it. */
  function countCleared(): boolean {
    return recorder
      .forTable("families")
      .filter((q) => q.op === "update")
      .some((q) => (q.payload as Record<string, unknown>).failed_password_attempts === 0);
  }

  it("a wrong code stays counted: its attempt was claimed, and nothing clears it", async () => {
    recorder.reset({ families: [owner()], "rpc:begin_family_password_attempt": [{ allowed: true }] });
    const wrongCode = codeAt(TOTP, step()) === "000000" ? "111111" : "000000";
    const res = await login({ email: STORED_EMAIL, password: PASSWORD, code: wrongCode });

    expect(res.status).toBe(401);
    expect(rpcCalls("begin_family_password_attempt")).toHaveLength(1);
    expect(countCleared()).toBe(false);
    expect(recorder.forTable("family_sessions").filter((q) => q.op === "insert")).toHaveLength(0);
  });

  it("refuses a replayed code, and it stays counted", async () => {
    const now = step();
    recorder.reset({
      families: [owner({ owner_totp_last_step: now })],
      "rpc:begin_family_password_attempt": [{ allowed: true }],
    });
    const res = await login({ email: STORED_EMAIL, password: PASSWORD, code: codeAt(TOTP, now) });

    expect(res.status).toBe(401);
    expect(rpcCalls("begin_family_password_attempt")).toHaveLength(1);
    expect(countCleared()).toBe(false);
    expect(recorder.forTable("family_sessions").filter((q) => q.op === "insert")).toHaveLength(0);
  });

  it("the password alone never clears the owner's count: not at /login, not at /pair-screen", async () => {
    recorder.reset({ families: [owner({ failed_password_attempts: 9 })], "rpc:begin_family_password_attempt": [{ allowed: true }] });
    const asked = await login({ email: STORED_EMAIL, password: PASSWORD });
    expect(asked.body.needs_code).toBe(true);
    expect(countCleared()).toBe(false);

    for (const path of ["/api/family/pair-screen/admins", "/api/family/pair-screen"]) {
      recorder.reset({ families: [owner({ failed_password_attempts: 9 })], "rpc:begin_family_password_attempt": [{ allowed: true }] });
      const res = await request(app).post(path).send({ email: STORED_EMAIL, password: PASSWORD });
      expect(res.status, path).toBe(409);
      expect(countCleared(), path).toBe(false);
    }
  });

  /*
    The reset hole, end to end: nine wrong codes, then the right password at
    /pair-screen/admins, which used to zero the count, then a tenth wrong
    code — which must lock. Played against a counter that behaves like
    begin_family_password_attempt and is cleared by exactly the update the
    routes write.
  */
  it("nine wrong codes, a pairing call, and a tenth wrong code: the next attempt is locked", async () => {
    const { supabase } = await import("../config/supabase.js");
    let count = 0;
    let lockedUntil = 0;
    const realRpc = supabase.rpc.bind(supabase);
    vi.spyOn(supabase, "rpc").mockImplementation(((fn: string, args?: Record<string, unknown>) => {
      if (fn !== "begin_family_password_attempt") return realRpc(fn, args);
      if (lockedUntil > Date.now()) return Promise.resolve({ data: [{ allowed: false }], error: null });
      count += 1;
      if (count >= 10) {
        count = 0;
        lockedUntil = Date.now() + 15 * 60_000;
      }
      return Promise.resolve({ data: [{ allowed: true }], error: null });
    }) as typeof supabase.rpc);
    const settle = () => {
      if (countCleared()) {
        count = 0;
        lockedUntil = 0;
      }
    };
    const wrongCode = codeAt(TOTP, step()) === "000000" ? "111111" : "000000";

    for (let i = 0; i < 9; i++) {
      recorder.reset({ families: [owner()] });
      expect((await login({ email: STORED_EMAIL, password: PASSWORD, code: wrongCode })).status).toBe(401);
      settle();
    }
    recorder.reset({ families: [owner()] });
    expect((await request(app).post("/api/family/pair-screen/admins").send({ email: STORED_EMAIL, password: PASSWORD })).status).toBe(409);
    settle();

    recorder.reset({ families: [owner()] });
    await login({ email: STORED_EMAIL, password: PASSWORD, code: wrongCode });
    settle();
    expect(lockedUntil).toBeGreaterThan(Date.now());

    // Locked: even the right password and the right code are not checked now.
    recorder.reset({ families: [owner()] });
    const res = await login({ email: STORED_EMAIL, password: PASSWORD, code: codeAt(TOTP, step()) });
    expect(res.status).toBe(401);
    expect(res.body.needs_code).toBeUndefined();
  });

  it("an owner not yet enrolled signs in as before", async () => {
    recorder.reset({ families: [owner({ owner_totp_enabled_at: null })] });
    const res = await login({ email: STORED_EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it("a family row is never asked for a code, even with a stray secret", async () => {
    recorder.reset({ families: [familyRow({ owner_totp_enabled_at: "2026-09-29T10:00:00Z" })] });
    const res = await login({ email: STORED_EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
  });
});

// ──────────────────────────────────────── pairing needs an admin's PIN

describe("pairing a screen needs an admin's PIN, and tells the family (access-2)", () => {
  function world(admins: unknown[] = [adminRow()]) {
    recorder.reset(
      { families: [familyRow()], installations: [], people: [subjectRow()] },
      { [`people:select:${ADMIN_SELECT}`]: admins as Record<string, unknown>[] }
    );
  }
  const PASSWORD_ONLY = { email: STORED_EMAIL, password: PASSWORD };

  it("the password alone pairs nothing", async () => {
    world();
    const res = await request(app).post("/api/family/pair-screen").send(PASSWORD_ONLY);

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("admin_required");
    expect(recorder.forTable("installations").filter((q) => q.op === "insert")).toHaveLength(0);
    expect(cookieNames(res)).not.toContain("recall_device");
    expect(email.sendScreenPairedEmail).not.toHaveBeenCalled();
  });

  it("lists who can confirm — first names, never a hash", async () => {
    world([adminRow(), adminRow({ id: "no-pin", name: "Nobody", pin_hash: null })]);
    const res = await request(app).post("/api/family/pair-screen/admins").send(PASSWORD_ONLY);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ admins: [{ id: ADMIN_A, name: "Andy" }] });
  });

  it("the admin list is behind the password too", async () => {
    world();
    const res = await request(app)
      .post("/api/family/pair-screen/admins")
      .send({ email: STORED_EMAIL, password: "not-the-password" });
    expect(res.status).toBe(401);
    expect(res.body.admins).toBeUndefined();
  });

  it("a wrong admin PIN is counted against that admin, escalating, and pairs nothing", async () => {
    world();
    const res = await request(app)
      .post("/api/family/pair-screen")
      .send({ ...PASSWORD_ONLY, admin_person_id: ADMIN_A, pin: "000000" });

    expect(res.status).toBe(401);
    const calls = rpcCalls("record_pin_failure");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ p_person: ADMIN_A, p_archive: ARCHIVE_A, p_ceiling: "24 hours" });
    expect(recorder.forTable("installations").filter((q) => q.op === "insert")).toHaveLength(0);
  });

  it("a co-author cannot confirm, even with their right PIN", async () => {
    world([adminRow({ id: COAUTHOR_A, role: "co_author" })]);
    const res = await request(app)
      .post("/api/family/pair-screen")
      .send({ ...PASSWORD_ONLY, admin_person_id: COAUTHOR_A, pin: ADMIN_PIN });

    expect(res.status).toBe(409);
    expect(recorder.forTable("installations").filter((q) => q.op === "insert")).toHaveLength(0);
  });

  it("an id that is not one of this family's admins is refused", async () => {
    world();
    const res = await request(app)
      .post("/api/family/pair-screen")
      .send({ ...PASSWORD_ONLY, admin_person_id: "someone-else", pin: ADMIN_PIN });

    expect(res.status).toBe(401);
    expect(recorder.forTable("installations").filter((q) => q.op === "insert")).toHaveLength(0);
  });

  it("a locked admin cannot confirm", async () => {
    world([adminRow({ locked_until: new Date(Date.now() + 600_000).toISOString() })]);
    const res = await request(app)
      .post("/api/family/pair-screen")
      .send({ ...PASSWORD_ONLY, admin_person_id: ADMIN_A, pin: ADMIN_PIN });

    expect(res.status).toBe(429);
    expect(recorder.forTable("installations").filter((q) => q.op === "insert")).toHaveLength(0);
  });

  it("a family with no admin PIN is pointed at the emailed ceremony", async () => {
    world([]);
    const res = await request(app)
      .post("/api/family/pair-screen")
      .send({ ...PASSWORD_ONLY, admin_person_id: ADMIN_A, pin: ADMIN_PIN });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("no_admin");
  });

  it("pairs with the admin's PIN and mails the family's stored address", async () => {
    world();
    const res = await request(app)
      .post("/api/family/pair-screen")
      .send({ ...PASSWORD_ONLY, admin_person_id: ADMIN_A, pin: ADMIN_PIN });

    expect(res.status).toBe(200);
    expect(cookieNames(res)).toContain("recall_device");
    expect(email.sendScreenPairedEmail).toHaveBeenCalledTimes(1);
    expect(vi.mocked(email.sendScreenPairedEmail).mock.calls[0]).toEqual([STORED_EMAIL, "The Peeters Family"]);
  });

  it("a failed notice does not un-pair the screen", async () => {
    world();
    vi.mocked(email.sendScreenPairedEmail).mockRejectedValueOnce(new Error("smtp down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await request(app)
      .post("/api/family/pair-screen")
      .send({ ...PASSWORD_ONLY, admin_person_id: ADMIN_A, pin: ADMIN_PIN });

    expect(res.status).toBe(200);
    expect(cookieNames(res)).toContain("recall_device");
  });
});

// ─────────────────────────────────────────── PIN-less profiles (access-3)

describe("only the subject opens without a PIN (access-3)", () => {
  const device = `recall_device=${jwt.sign({ installationId: INSTALL_A, archiveId: ARCHIVE_A }, SECRET, { expiresIn: 3600 })}`;
  const trusted = { id: INSTALL_A, archive_id: ARCHIVE_A, is_trusted: true, revoked_at: null };

  for (const role of ["admin", "co_author"] as const) {
    it(`a promoted ${role} with no PIN is refused on the trusted screen`, async () => {
      recorder.reset({
        installations: [trusted],
        people: [adminRow({ role, pin_hash: null })],
        families: [familyRow()],
      });
      const res = await request(app).post(`/api/auth/profiles/${ADMIN_A}/unlock`).set("Cookie", device).send({});

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/not been claimed/);
      expect(cookieNames(res)).not.toContain("recall_profile");
    });
  }

  /*
    The chooser must say the same thing unlock enforces. A promoted admin
    with no PIN reported requires_pin: false, so the display — which falls
    back to "the face that needs no PIN" after a lockout, from a list sorted
    by name — could pick them before her, get a 403, and stay on the chooser.
  */
  it("the chooser never marks anyone but the subject as openable without a PIN", async () => {
    recorder.reset({
      installations: [trusted],
      people: [
        adminRow({ id: "a-first", name: "Aaron", role: "admin", pin_hash: null }),
        adminRow({ id: "b-co", name: "Bea", role: "co_author", pin_hash: null }),
        subjectRow(),
        adminRow(),
      ],
      families: [familyRow()],
    });
    const res = await request(app).get("/api/auth/profiles").set("Cookie", device);

    expect(res.status).toBe(200);
    const pinFree = (res.body as { name: string; role: string; requires_pin: boolean }[]).filter(
      (p) => !p.requires_pin
    );
    expect(pinFree.map((p) => p.name)).toEqual(["Margaret"]);
    expect(pinFree[0].role).toBe("user");
  });

  it("the display returns to her by role, not by the first PIN-free face", () => {
    const page = readFileSync(
      new URL("../../../frontend/src/pages/ProfilesPage.tsx", import.meta.url).pathname,
      "utf8"
    );
    expect(page).toMatch(/const home = profiles\?\.find\(\(p\) => p\.role === "user"\)/);
    expect(page).not.toMatch(/const home = profiles\?\.find\(\(p\) => !p\.requires_pin\)/);
  });

  it("the subject still opens straight away on her screen", async () => {
    recorder.reset({ installations: [trusted], people: [subjectRow()], families: [familyRow()] });
    const res = await request(app).post(`/api/auth/profiles/${SUBJECT_A}/unlock`).set("Cookie", device).send({});

    expect(res.status).toBe(200);
    expect(cookieNames(res)).toContain("recall_profile");
  });

  it("the remote chooser refuses a PIN-less co-author too", async () => {
    recorder.reset({
      family_sessions: [
        {
          id: "sess-chooser",
          family_id: FAMILY_A,
          archive_id: ARCHIVE_A,
          person_id: null,
          role: null,
          session_version: 1,
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          revoked_at: null,
        },
      ],
      families: [familyRow()],
      people: [adminRow({ id: COAUTHOR_A, role: "co_author", pin_hash: null })],
    });
    const res = await request(app)
      .post(`/api/family/profiles/${COAUTHOR_A}/enter`)
      .set("Cookie", ["recall_family=opaque"])
      .send({ pin: "123456" });

    expect(res.status).toBe(403);
  });
});

// ──────────────────────────────────────────── the PIN lockout escalates

describe("the PIN lockout escalates and is seen (authn-8)", () => {
  const device = `recall_device=${jwt.sign({ installationId: INSTALL_A, archiveId: ARCHIVE_A }, SECRET, { expiresIn: 3600 })}`;
  const trusted = { id: INSTALL_A, archive_id: ARCHIVE_A, is_trusted: true, revoked_at: null };

  it("sends the ceiling with every counted failure", async () => {
    recorder.reset({ installations: [trusted], people: [adminRow()], families: [familyRow()] });
    await request(app).post(`/api/auth/profiles/${ADMIN_A}/unlock`).set("Cookie", device).send({ pin: "000000" });

    expect(rpcCalls("record_pin_failure")[0]).toMatchObject({
      p_person: ADMIN_A,
      p_archive: ARCHIVE_A,
      p_max: 5,
      p_lockout: "15 minutes",
      p_ceiling: "24 hours",
    });
  });

  it("writes a repeated lock to the family's activity", async () => {
    recorder.reset({
      installations: [trusted],
      people: [adminRow()],
      families: [familyRow()],
      "rpc:record_pin_failure": [{ locked: true, lock_count: 3 }],
      activity_log: [],
    });
    const res = await request(app)
      .post(`/api/auth/profiles/${ADMIN_A}/unlock`)
      .set("Cookie", device)
      .send({ pin: "000000" });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/locked/);

    // logActivity is fire-and-forget; let it land.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const lines = recorder.forTable("activity_log").filter((q) => q.op === "insert");
    expect(lines).toHaveLength(1);
    const line = lines[0].payload as Record<string, unknown>;
    expect(line.archive_id).toBe(ARCHIVE_A);
    expect(line.action_type).toBe("profile_locked");
    expect(String(line.description)).toMatch(/Andy's profile was locked again/);
  });

  it("does not write a first lock to the activity", async () => {
    recorder.reset({
      installations: [trusted],
      people: [adminRow()],
      families: [familyRow()],
      "rpc:record_pin_failure": [{ locked: true, lock_count: 1 }],
    });
    await request(app).post(`/api/auth/profiles/${ADMIN_A}/unlock`).set("Cookie", device).send({ pin: "000000" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(recorder.forTable("activity_log").filter((q) => q.op === "insert")).toHaveLength(0);
  });

  it("a right PIN resets the lock count as well as the attempts", async () => {
    recorder.reset({ installations: [trusted], people: [adminRow()], families: [familyRow()] });
    const res = await request(app)
      .post(`/api/auth/profiles/${ADMIN_A}/unlock`)
      .set("Cookie", device)
      .send({ pin: ADMIN_PIN });

    expect(res.status).toBe(200);
    const reset = recorder
      .forTable("people")
      .filter((q) => q.op === "update")
      .map((q) => q.payload as Record<string, unknown>);
    expect(reset[0]).toMatchObject({ failed_pin_attempts: 0, locked_until: null, pin_lock_count: 0 });
    // Already peppered: nothing to re-hash.
    expect(reset[0].pin_hash).toBeUndefined();
  });
});

// ───────────────────────────────────────────────── peppered PINs (SKEPTIC)

describe("PINs are peppered, and old hashes move over on use", () => {
  it("a new hash does not verify against the raw PIN", async () => {
    const hash = await hashPin("123456");
    expect(await argon2.verify(hash, "123456")).toBe(false);
    expect(await checkPin(hash, "123456")).toEqual({ ok: true, legacy: false });
    expect(await verifyPin(hash, "654321")).toBe(false);
  });

  it("a hash from before the pepper still verifies, and says so", async () => {
    const legacy = await argon2.hash("123456", { type: argon2.argon2id });
    expect(await checkPin(legacy, "123456")).toEqual({ ok: true, legacy: true });
    expect(await checkPin(legacy, "000000")).toEqual({ ok: false, legacy: false });
  });

  it("unlocking with a legacy hash re-hashes it to the peppered form", async () => {
    const device = `recall_device=${jwt.sign({ installationId: INSTALL_A, archiveId: ARCHIVE_A }, SECRET, { expiresIn: 3600 })}`;
    recorder.reset({
      installations: [{ id: INSTALL_A, archive_id: ARCHIVE_A, is_trusted: true, revoked_at: null }],
      people: [adminRow({ pin_hash: await argon2.hash(ADMIN_PIN, { type: argon2.argon2id }) })],
      families: [familyRow()],
    });
    const res = await request(app)
      .post(`/api/auth/profiles/${ADMIN_A}/unlock`)
      .set("Cookie", device)
      .send({ pin: ADMIN_PIN });

    expect(res.status).toBe(200);
    const update = recorder.forTable("people").find((q) => q.op === "update");
    const rehashed = (update?.payload as Record<string, unknown>).pin_hash as string;
    expect(rehashed).toBeTruthy();
    expect(await checkPin(rehashed, ADMIN_PIN)).toEqual({ ok: true, legacy: false });
    expect(update?.filters).toContainEqual({ method: "eq", column: "archive_id", value: ARCHIVE_A });
  });
});

// ───────────────────────────────────── installation sign-in timing (SKEPTIC)

describe("installation sign-in spends the same work on a missing username", () => {
  it("verifies against the dummy hash when there is no such installation", async () => {
    recorder.reset({ installations: [] });
    const spy = vi.spyOn(argon2, "verify");
    const res = await request(app)
      .post("/api/auth/installation/sign-in")
      .send({ username: "nobody-here", secret: "ABCD-12345678" });

    expect(res.status).toBe(401);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe(DUMMY_PASSWORD_HASH);
  });

  it("and when the installation is revoked", async () => {
    recorder.reset({
      installations: [
        {
          id: INSTALL_A,
          username: "the-screen",
          secret_hash: await argon2.hash("ABCD12345678", { type: argon2.argon2id }),
          revoked_at: "2026-09-01T00:00:00Z",
          archive_id: ARCHIVE_A,
        },
      ],
    });
    const spy = vi.spyOn(argon2, "verify");
    const res = await request(app)
      .post("/api/auth/installation/sign-in")
      .send({ username: "the-screen", secret: "ABCD-12345678" });

    expect(res.status).toBe(401);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe(DUMMY_PASSWORD_HASH);
  });

  it("a `*` username is refused without a query, after the same work", async () => {
    recorder.reset({ installations: [] });
    const spy = vi.spyOn(argon2, "verify");
    const res = await request(app)
      .post("/api/auth/installation/sign-in")
      .send({ username: "the-*", secret: "ABCD-12345678" });

    expect(res.status).toBe(401);
    expect(recorder.forTable("installations")).toHaveLength(0);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// ────────────────────────────────────────── token algorithm and type (authn-5)

describe("tokens carry their type, and only HS256 verifies (authn-5)", () => {
  const trusted = { id: INSTALL_A, archive_id: ARCHIVE_A, is_trusted: true, revoked_at: null };

  function world() {
    recorder.reset({
      installations: [trusted],
      people: [adminRow()],
      families: [familyRow()],
    });
  }

  it("issued cookies say which kind they are", async () => {
    world();
    const device = `recall_device=${jwt.sign({ installationId: INSTALL_A, archiveId: ARCHIVE_A }, SECRET, { expiresIn: 3600 })}`;
    const res = await request(app)
      .post(`/api/auth/profiles/${ADMIN_A}/unlock`)
      .set("Cookie", device)
      .send({ pin: ADMIN_PIN });
    const raw = (res.headers["set-cookie"] as unknown as string[]).find((l) => l.startsWith("recall_profile="))!;
    const token = raw.split(";")[0].split("=").slice(1).join("=");
    expect((jwt.verify(token, SECRET) as { typ?: string }).typ).toBe("profile");
  });

  it("a token typed as a profile is not a device, whatever claims it carries", async () => {
    world();
    const confused = jwt.sign(
      { installationId: INSTALL_A, archiveId: ARCHIVE_A, typ: "profile" },
      SECRET,
      { expiresIn: 3600 }
    );
    const res = await request(app).get("/api/auth/session").set("Cookie", [`recall_device=${confused}`]);
    expect(res.body.device).toBe(false);
  });

  it("a token typed as a device is not a profile", async () => {
    world();
    const device = `recall_device=${jwt.sign({ installationId: INSTALL_A, archiveId: ARCHIVE_A, typ: "device" }, SECRET, { expiresIn: 3600 })}`;
    const confused = jwt.sign(
      { personId: ADMIN_A, name: "Andy", role: "admin", archiveId: ARCHIVE_A, typ: "device" },
      SECRET,
      { expiresIn: 3600 }
    );
    const res = await request(app)
      .get("/api/auth/session")
      .set("Cookie", [device, `recall_profile=${confused}`]);
    expect(res.body.device).toBe(true);
    expect(res.body.profile).toBeNull();
  });

  it("tokens minted before the type existed keep working — her screen is never signed out", async () => {
    world();
    const device = `recall_device=${jwt.sign({ installationId: INSTALL_A, archiveId: ARCHIVE_A }, SECRET, { expiresIn: 3600 })}`;
    const profile = `recall_profile=${jwt.sign(
      { personId: ADMIN_A, name: "Andy", role: "admin", archiveId: ARCHIVE_A },
      SECRET,
      { expiresIn: 3600 }
    )}`;
    const res = await request(app).get("/api/auth/session").set("Cookie", [device, profile]);
    expect(res.body.device).toBe(true);
    expect(res.body.profile).toMatchObject({ id: ADMIN_A });
  });

  it("a token signed with another HMAC algorithm does not verify", async () => {
    world();
    const hs512 = jwt.sign({ installationId: INSTALL_A, archiveId: ARCHIVE_A }, SECRET, {
      expiresIn: 3600,
      algorithm: "HS512",
    });
    const res = await request(app).get("/api/auth/session").set("Cookie", [`recall_device=${hs512}`]);
    expect(res.body.device).toBe(false);
  });
});
