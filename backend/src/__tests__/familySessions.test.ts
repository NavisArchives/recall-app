import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { recorder } from "./support/supabaseRecorder.js";

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => recorder.client,
}));

const { createApp } = await import("../app.js");
const app = createApp();

/**
 * M40 — a family session signed in from anywhere can actually manage.
 *
 * The old rule was "profile cookie AND device cookie, or nothing", which is
 * right for the kitchen screen and wrong for a daughter on her phone: she
 * signs in perfectly — password, face, PIN — and every management route
 * refuses her. The login flow was a well-built corridor into a locked room.
 *
 * The trap on the other side is worse. Deleting the device check would let a
 * bare profile JWT, lifted from anywhere, manage the archive. So there are
 * exactly two accepted shapes and nothing else, and these tests hold that
 * line from both directions.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";
const PEPPER = "test-code-pepper-that-is-long-enough-32ch";

const ARCHIVE_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const ARCHIVE_B = "bbbbbbbb-0000-0000-0000-00000000000b";
const ADMIN_A = "aaaaaaaa-0000-0000-0000-0000000000ad";
const FAMILY_A = "aaaaaaaa-0000-0000-0000-0000000000fa";
const INSTALL_A = "aaaaaaaa-0000-0000-0000-0000000000f1";

/** What `readFamilySession` expects to find behind a cookie. */
function sessionRow(over: Record<string, unknown> = {}) {
  return {
    id: "sess-1",
    family_id: FAMILY_A,
    archive_id: ARCHIVE_A,
    person_id: ADMIN_A,
    role: "admin",
    session_version: 1,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    revoked_at: null,
    ...over,
  };
}

function familyRow(over: Record<string, unknown> = {}) {
  return { id: FAMILY_A, archive_id: ARCHIVE_A, session_version: 1, status: "active", ...over };
}

function personRow(over: Record<string, unknown> = {}) {
  return {
    id: ADMIN_A,
    name: "Andy",
    role: "admin",
    status: "active",
    archive_id: ARCHIVE_A,
    archived_at: null,
    ...over,
  };
}

/**
 * The recorder answers per table, and this route reads three in sequence:
 * the session, the family, then the person. Each test says what each holds.
 */
function world(over: { session?: unknown; family?: unknown; person?: unknown } = {}) {
  recorder.reset({
    family_sessions: over.session === null ? [] : [over.session ?? sessionRow()],
    families: over.family === null ? [] : [over.family ?? familyRow()],
    people: over.person === null ? [] : [over.person ?? personRow()],
    channels: [],
  });
}

const remoteCookie = ["recall_family=any-opaque-token"];

/** The kitchen screen's shape, unchanged by any of this. */
function householdCookies(archiveId = ARCHIVE_A) {
  const device = jwt.sign({ installationId: INSTALL_A, archiveId }, SECRET, { expiresIn: 3600 });
  const profile = jwt.sign(
    { personId: ADMIN_A, name: "Andy", role: "admin", archiveId },
    SECRET,
    { expiresIn: 3600 }
  );
  return [`recall_device=${device}`, `recall_profile=${profile}`];
}

beforeEach(() => {
  process.env.CODE_PEPPER = PEPPER;
  recorder.reset({});
});

describe("the remote shape is accepted", () => {
  it("lets a member with only a family session manage", async () => {
    world();
    const res = await request(app).get("/api/channels").set("Cookie", remoteCookie);

    expect(res.status).toBe(200);
  });

  it("carries the archive, so downstream queries stay scoped", async () => {
    world();
    await request(app).get("/api/channels").set("Cookie", remoteCookie);

    // Every archive-scoped read must still name the family it means.
    const channelReads = recorder.forTable("channels").filter((q) => q.op === "select");
    expect(channelReads.length).toBeGreaterThan(0);
    for (const query of channelReads) {
      expect(query.filters.some((f) => f.column === "archive_id" && f.value === ARCHIVE_A)).toBe(
        true
      );
    }
  });

  it("resolves the session by its token hash, never by cookie presence alone (F68 #11)", async () => {
    /*
      readFamilySession's whole security is `.eq("token_hash", hashToken(token))`:
      delete that operand and the lookup matches any row, so any opaque cookie
      resolves to a session — the token stops being a secret. The recorder
      returns the seeded row regardless of filters, so no status code sees the
      operand vanish; the lookup's shape is asserted directly. This is the read
      seam Feedback found bare (F68 #11).
    */
    world();
    await request(app).get("/api/channels").set("Cookie", remoteCookie);

    const lookups = recorder.forTable("family_sessions").filter((q) => q.op === "select");
    expect(lookups.length).toBeGreaterThan(0);
    for (const q of lookups) {
      expect(q.filters.some((f) => f.method === "eq" && f.column === "token_hash")).toBe(true);
    }
  });
});

describe("the password alone opens the chooser and nothing more", () => {
  /*
   * The identity spec's two-stage rule, held at the door. A session that has
   * cleared the password but chosen nobody is the chooser stage; if it could
   * already read the channels, the people and the photographs, the PIN would
   * be a decoration. The refusal is 403 with its own code, so the frontend
   * can send the browser to the chooser rather than back to login.
   */
  it("refuses archive reads for a chooser-stage session", async () => {
    world({ session: sessionRow({ person_id: null, role: null }) });
    const res = await request(app).get("/api/channels").set("Cookie", remoteCookie);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("profile_required");
  });

  it("still serves the chooser's own faces at the password stage", async () => {
    // The chooser page draws profile photos through /api/media/person/:id/photo,
    // which opts into chooser-stage access — front-door information, scoped to
    // the session's own archive. The door opens; whether a photo exists is the
    // route's own answer.
    world({ session: sessionRow({ person_id: null, role: null }) });
    const res = await request(app)
      .get(`/api/media/person/${ADMIN_A}/photo`)
      .set("Cookie", remoteCookie);

    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("opens the same routes once the session is elevated", async () => {
    world();
    const res = await request(app).get("/api/channels").set("Cookie", remoteCookie);

    expect(res.status).toBe(200);
  });
});

describe("a PIN guess that cannot be counted is refused, not free", () => {
  it("answers 503 when the failure counter cannot record", async () => {
    /*
     * The counter is the brute-force protection; a guess it could not count
     * would otherwise be a free one. So a database failure at exactly that
     * moment refuses the attempt outright — 503, not the 401 a counted
     * wrong guess earns.
     */
    world({
      session: sessionRow({ person_id: null, role: null }),
      person: personRow({
        role: "co_author",
        pin_hash: "not-a-real-hash",
        failed_pin_attempts: 0,
        locked_until: null,
      }),
    });
    recorder.failNext = {
      table: "rpc:record_pin_failure",
      op: "select",
      error: { message: "connection refused" },
    };

    const res = await request(app)
      .post(`/api/family/profiles/${ADMIN_A}/enter`)
      .set("Cookie", remoteCookie)
      .send({ pin: "123456" });

    expect(res.status).toBe(503);
  });

  it("still answers a counted wrong guess with 401", async () => {
    world({
      session: sessionRow({ person_id: null, role: null }),
      person: personRow({
        role: "co_author",
        pin_hash: "not-a-real-hash",
        failed_pin_attempts: 0,
        locked_until: null,
      }),
    });

    const res = await request(app)
      .post(`/api/family/profiles/${ADMIN_A}/enter`)
      .set("Cookie", remoteCookie)
      .send({ pin: "123456" });

    expect(res.status).toBe(401);
    // And the count went through the atomic move, not a read-modify-write.
    expect(recorder.forTable("rpc:record_pin_failure")).toHaveLength(1);
  });
});

describe("the household shape still works", () => {
  it("accepts the kitchen screen exactly as before", async () => {
    recorder.reset({
      // The kitchen screen's own row — verified on every request now (M42).
      installations: [{ id: INSTALL_A, archive_id: ARCHIVE_A, revoked_at: null, is_trusted: true }],
      people: [personRow()],
      channels: [],
    });
    const res = await request(app).get("/api/channels").set("Cookie", householdCookies());

    expect(res.status).toBe(200);
    // No family session was consulted: the display's path is untouched.
    expect(recorder.forTable("family_sessions")).toHaveLength(0);
  });
});

describe("everything else is refused", () => {
  it("refuses a bare profile cookie with no device and no family session", async () => {
    recorder.reset({ people: [personRow()], channels: [] });
    const profile = jwt.sign(
      { personId: ADMIN_A, name: "Andy", role: "admin", archiveId: ARCHIVE_A },
      SECRET,
      { expiresIn: 3600 }
    );

    const res = await request(app)
      .get("/api/channels")
      .set("Cookie", [`recall_profile=${profile}`]);

    expect(res.status).toBe(401);
  });

  it("refuses the very next request after the session is revoked", async () => {
    world();
    expect((await request(app).get("/api/channels").set("Cookie", remoteCookie)).status).toBe(200);

    world({ session: sessionRow({ revoked_at: new Date().toISOString() }) });
    const after = await request(app).get("/api/channels").set("Cookie", remoteCookie);

    expect(after.status).toBe(401);
  });

  it("refuses an expired session", async () => {
    world({ session: sessionRow({ expires_at: new Date(Date.now() - 1000).toISOString() }) });
    const res = await request(app).get("/api/channels").set("Cookie", remoteCookie);

    expect(res.status).toBe(401);
  });

  it("refuses every outstanding session when the family password is rotated", async () => {
    // The session was minted under version 1; the family is now on 2.
    world({ family: familyRow({ session_version: 2 }) });
    const res = await request(app).get("/api/channels").set("Cookie", remoteCookie);

    expect(res.status).toBe(401);
  });

  it("refuses a suspended family", async () => {
    world({ family: familyRow({ status: "suspended" }) });
    const res = await request(app).get("/api/channels").set("Cookie", remoteCookie);

    expect(res.status).toBe(401);
  });

  it("refuses a deactivated member, however valid their session row", async () => {
    world({ person: personRow({ status: "deactivated" }) });
    const res = await request(app).get("/api/channels").set("Cookie", remoteCookie);

    expect(res.status).toBe(401);
  });

  it("refuses a member archived since the session was opened", async () => {
    world({ person: personRow({ archived_at: new Date().toISOString() }) });
    const res = await request(app).get("/api/channels").set("Cookie", remoteCookie);

    expect(res.status).toBe(401);
  });
});

describe("one family's session cannot reach another's", () => {
  it("refuses when the person has moved to a different archive", async () => {
    // The session says Archive A; the person now belongs to Archive B.
    world({ person: personRow({ archive_id: ARCHIVE_B }) });
    const res = await request(app).get("/api/channels").set("Cookie", remoteCookie);

    expect(res.status).toBe(401);
  });

  it("refuses when the family's archive no longer matches the session's", async () => {
    world({ family: familyRow({ archive_id: ARCHIVE_B }) });
    const res = await request(app).get("/api/channels").set("Cookie", remoteCookie);

    expect(res.status).toBe(401);
  });

  it("never lets a remote session read outside its own archive", async () => {
    world();
    await request(app).get("/api/channels").set("Cookie", remoteCookie);

    // Not one query names the other family.
    const namedB = recorder.queries.some((q) =>
      q.filters.some((f) => f.value === ARCHIVE_B)
    );
    expect(namedB).toBe(false);
  });
});

describe("the role on the row is the truth, not the one in the cookie", () => {
  it("refuses an action above the member's current role", async () => {
    // The session says admin; the person has since become a co-author, and
    // managing people is admin-only.
    world({ person: personRow({ role: "co_author" }) });
    // Adding a person to the family is admin-only, and stays that way: a
    // helper sees everyone and changes no one.
    const res = await request(app)
      .post("/api/people")
      .set("Cookie", remoteCookie)
      .send({ name: "A newcomer" });

    expect(res.status).toBe(403);
  });
});

/**
 * M89 — the full sign-out closes every door it names.
 *
 * `clearSessions` predates the family cookie (M20) and never learned it, so
 * "Sign this screen out of the archive" — whose own copy promises the access
 * code will be needed again — left a family session standing on the machine.
 * The switch must stay narrow, though: it ends the person and keeps both the
 * trusted machine and the family, or a remote member switching profile is
 * thrown back to the password screen. So the two paths are asserted against
 * each other, not just individually.
 */
describe("signing out closes exactly the doors it names", () => {
  /** A `Set-Cookie` that empties `name` — the browser's instruction to forget. */
  function clears(res: { headers: Record<string, unknown> }, name: string): boolean {
    const header = res.headers["set-cookie"];
    const all = Array.isArray(header) ? header : header ? [String(header)] : [];
    return all.some((c) => new RegExp(`^${name}=;`).test(c));
  }

  it("the full sign-out clears the profile, the device and the family", async () => {
    world();
    const res = await request(app).post("/api/auth/sign-out").set("Cookie", remoteCookie);

    expect(res.status).toBe(200);
    expect(clears(res, "recall_profile")).toBe(true);
    expect(clears(res, "recall_device")).toBe(true);
    expect(clears(res, "recall_family")).toBe(true);
  });

  it("and revokes the family session server-side, not just in this browser", async () => {
    // The family session is opaque and lives in the database: forgetting the
    // cookie leaves the row usable to anyone holding the value.
    world();
    await request(app).post("/api/auth/sign-out").set("Cookie", remoteCookie);

    const revokes = recorder
      .forTable("family_sessions")
      .filter((q) => q.op === "update" && "revoked_at" in (q.payload ?? {}));
    expect(revokes).toHaveLength(1);
    expect(revokes[0].filters.some((f) => f.column === "id" && f.value === "sess-1")).toBe(true);
  });

  it("the profile switch ends the person and keeps the machine and the family", async () => {
    world();
    const res = await request(app).post("/api/auth/profiles/sign-out").set("Cookie", remoteCookie);

    expect(res.status).toBe(200);
    expect(clears(res, "recall_profile")).toBe(true);
    expect(clears(res, "recall_device")).toBe(false);
    expect(clears(res, "recall_family")).toBe(false);
    // And nothing was revoked: the session is still the one to come back to.
    // (It *is* updated — M90 steps it back to the chooser — so this asks the
    // narrower question it always meant to ask.)
    const revokes = recorder
      .forTable("family_sessions")
      .filter((q) => q.op === "update" && "revoked_at" in (q.payload ?? {}));
    expect(revokes).toHaveLength(0);
  });
});

/**
 * M90 — switching profile stops the server naming the person you left.
 *
 * A remote family session carries its identity on the session row, not in a
 * profile cookie: `/session` reads the person from there, which is the only
 * thing that names a daughter signed in from her own phone. So clearing the
 * profile cookie on a switch left the server still answering with whoever had
 * just stepped away — the cookie said nobody, the row said the previous
 * person, and the row is what gets read.
 *
 * The fix is the inverse of `elevateSession`, not a change to that fallback:
 * the session returns to the person-less chooser state it was in between the
 * password and the face.
 */
describe("switching profile steps the family session back to its chooser", () => {
  it("clears the person and the role stamped on the session", async () => {
    world();
    await request(app).post("/api/auth/profiles/sign-out").set("Cookie", remoteCookie);

    const demotes = recorder
      .forTable("family_sessions")
      .filter((q) => q.op === "update" && (q.payload as Record<string, unknown>)?.person_id === null);

    expect(demotes).toHaveLength(1);
    const payload = demotes[0].payload as Record<string, unknown>;
    expect(payload.role).toBeNull();
    // The identifier rotates at every step that changes what a session can
    // do, and stepping back out of a profile is such a step.
    expect(payload.token_hash).toEqual(expect.any(String));
    // Scoped to this session, in this archive, and only while it is live.
    expect(demotes[0].filters.some((f) => f.column === "id" && f.value === "sess-1")).toBe(true);
    expect(
      demotes[0].filters.some((f) => f.column === "archive_id" && f.value === ARCHIVE_A)
    ).toBe(true);
  });

  it("leaves the family signed in — a switch is not a password re-entry", async () => {
    world();
    const res = await request(app).post("/api/auth/profiles/sign-out").set("Cookie", remoteCookie);

    // The family cookie is re-issued, not cleared: still signed in, nobody chosen.
    const header = res.headers["set-cookie"];
    const all = Array.isArray(header) ? header : [String(header)];
    const family = all.find((c) => c.startsWith("recall_family="));
    expect(family).toBeDefined();
    expect(family).not.toMatch(/^recall_family=;/);
  });

  it("reports nobody afterwards, while the family stays signed in", async () => {
    // What the session row looks like once the demote has landed.
    world({ session: sessionRow({ person_id: null, role: null }) });
    const res = await request(app).get("/api/auth/session").set("Cookie", remoteCookie);

    expect(res.status).toBe(200);
    expect(res.body.family).toBe(true);
    expect(res.body.profile).toBeNull();
  });

  it("names only the new person once a second profile is entered", async () => {
    const OTHER = "aaaaaaaa-0000-0000-0000-0000000000c0";
    world({
      session: sessionRow({ person_id: OTHER, role: "co_author" }),
      person: personRow({ id: OTHER, name: "Marie", role: "co_author" }),
    });
    const res = await request(app).get("/api/auth/session").set("Cookie", remoteCookie);

    expect(res.body.profile).toMatchObject({ id: OTHER, name: "Marie", role: "co_author" });
  });

  it("does not touch a trusted device's switch, which carries no family session", async () => {
    recorder.reset({
      installations: [{ id: INSTALL_A, archive_id: ARCHIVE_A, revoked_at: null, is_trusted: true }],
      people: [personRow()],
      family_sessions: [],
    });
    const res = await request(app)
      .post("/api/auth/profiles/sign-out")
      .set("Cookie", householdCookies());

    expect(res.status).toBe(200);
    // No family session to step back: the kitchen screen's switch is the
    // profile cookie and nothing else, exactly as before.
    expect(recorder.forTable("family_sessions").filter((q) => q.op === "update")).toHaveLength(0);
  });
});

/**
 * M95 — `/session` stops greeting a person who no longer exists.
 *
 * This endpoint echoed its claim: the profile cookie's name and role went out
 * with no read at all, and the family-stamp path read the row but fell back
 * to `name: ""`, so a deleted person came back as a nameless somebody rather
 * than as nobody. Nothing was ever *reachable* — `requireRole` re-reads the
 * row and fails closed — but the screen greeted someone the archive no longer
 * had. The doctrine is already written in this file's own middleware: the
 * cookie is a claim, the database is the truth.
 */
describe("the session endpoint tests its claim against the database", () => {
  /** A device+profile pair naming someone, as the household screen holds it. */
  function profileCookies(personId = ADMIN_A, archiveId = ARCHIVE_A) {
    const device = jwt.sign({ installationId: INSTALL_A, archiveId }, SECRET, { expiresIn: 3600 });
    const profile = jwt.sign(
      { personId, name: "Andy", role: "admin", archiveId },
      SECRET,
      { expiresIn: 3600 }
    );
    return [`recall_device=${device}`, `recall_profile=${profile}`];
  }

  it("reports nobody when the profile cookie names a deleted person", async () => {
    recorder.reset({ people: [], family_sessions: [], families: [] });
    const res = await request(app).get("/api/auth/session").set("Cookie", profileCookies());

    expect(res.status).toBe(200);
    expect(res.body.profile).toBeNull();
    // The session's own truth is unaffected — only the claim about a person.
    expect(res.body.device).toBe(true);
  });

  it("retires the dead claim so the browser stops presenting it", async () => {
    recorder.reset({ people: [], family_sessions: [], families: [] });
    const res = await request(app).get("/api/auth/session").set("Cookie", profileCookies());

    const header = res.headers["set-cookie"];
    const all = Array.isArray(header) ? header : header ? [String(header)] : [];
    expect(all.some((c) => /^recall_profile=;/.test(c))).toBe(true);
    // The device is a separate power and is not touched.
    expect(all.some((c) => /^recall_device=;/.test(c))).toBe(false);
  });

  it("reports nobody for a deactivated or archived person", async () => {
    for (const dead of [{ status: "deactivated" }, { archived_at: new Date().toISOString() }]) {
      recorder.reset({ people: [personRow(dead)], family_sessions: [], families: [] });
      const res = await request(app).get("/api/auth/session").set("Cookie", profileCookies());
      expect(res.body.profile).toBeNull();
    }
  });

  it("still names a live person, from the row rather than the token", async () => {
    // The cookie says "Andy, admin"; the row is the truth and says otherwise.
    recorder.reset({
      people: [personRow({ name: "Andrea", role: "co_author" })],
      family_sessions: [],
      families: [],
    });
    const res = await request(app).get("/api/auth/session").set("Cookie", profileCookies());

    expect(res.body.profile).toMatchObject({ id: ADMIN_A, name: "Andrea", role: "co_author" });
  });

  /*
   * The family-stamp path, and what this actually proves.
   *
   * M95 was written believing both claim paths could echo a dead person. They
   * cannot: `readFamilySession` re-reads the stamped person and returns null
   * if they are missing, archived, deactivated or moved — so the whole
   * session goes before `/session` ever reaches its fallback. The bug was
   * only ever in the profile-cookie path, which did no read at all.
   *
   * This pins that fact rather than claiming a fix: a dead stamped person
   * ends the session itself, so both `family` and `profile` report nobody.
   * The validation now in `/session` is defence in depth on this path, not a
   * live gap it closed.
   */
  it("loses the whole family session when its stamped person is gone", async () => {
    world({ person: null });
    const res = await request(app).get("/api/auth/session").set("Cookie", remoteCookie);

    expect(res.body.family).toBe(false);
    expect(res.body.profile).toBeNull();
  });
});
