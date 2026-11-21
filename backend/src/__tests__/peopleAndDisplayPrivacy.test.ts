import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { recorder } from "./support/supabaseRecorder.js";

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => recorder.client,
}));

const mail = vi.hoisted(() => ({
  sendTestEmail: vi.fn(async (_to: string) => ({
    success: false,
    reason: "Invalid login: 535 5.7.8 smtp.gmail.com EMAIL_PASS",
  })),
  sendWelcomeEmail: vi.fn(async () => ({ success: true })),
}));
vi.mock("../services/email.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/email.js")>()),
  sendTestEmail: mail.sendTestEmail,
  sendWelcomeEmail: mail.sendWelcomeEmail,
}));

const { createApp } = await import("../app.js");
const {
  PERSON_ADMIN_COLUMNS,
  PERSON_COLUMNS,
  PERSON_SELF_COLUMNS,
} = await import("../services/dto.js");
const app = createApp();

/**
 * The people half of the 29 Sep review, and the display's own writes.
 *
 * access-4  a co-author saving their own details was answered with the
 *           admin's view of them: the private note, last seen, the lockout.
 * access-3  promoting a PIN-less `user` left a co-author or admin with no PIN.
 * access-7  display-only writes accepted any installation and any member.
 * access-8  her screen, carrying her own `user` profile, was read as a member.
 * test-email took any recipient from the body and echoed the transport's text.
 *
 * As elsewhere, column assertions are made on the QUERY the route sent: the
 * recorder answers every select with the whole row, so the column list is
 * where the disclosure is decided.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";
const ARCHIVE = "aaaaaaaa-0000-0000-0000-00000000000a";
const TRUSTED = "aaaaaaaa-0000-0000-0000-0000000000f1";
const LAPTOP = "aaaaaaaa-0000-0000-0000-0000000000f2";
const ADMIN = "aaaaaaaa-0000-0000-0000-0000000000ad";
const HELPER = "aaaaaaaa-0000-0000-0000-0000000000c0";
const SUBJECT = "aaaaaaaa-0000-0000-0000-0000000000c1";
const GRANDCHILD = "aaaaaaaa-0000-0000-0000-0000000000c2";

function device(installationId: string) {
  return `recall_device=${jwt.sign({ installationId, archiveId: ARCHIVE }, SECRET, { expiresIn: 3600 })}`;
}
function profile(personId: string, role: string) {
  return `recall_profile=${jwt.sign({ personId, name: "Someone", role, archiveId: ARCHIVE }, SECRET, { expiresIn: 3600 })}`;
}

const person = (id: string, role: string, extra: Record<string, unknown> = {}) => ({
  id,
  archive_id: ARCHIVE,
  name: `Person ${id.slice(-2)}`,
  role,
  status: "active",
  archived_at: null,
  email: `${id.slice(-2)}@example.invalid`,
  contact_number: "+3200000000",
  admin_note: "Doesn't read email, call her instead",
  last_seen_at: "2026-09-01T00:00:00.000Z",
  ...extra,
});

function world(people: Record<string, unknown>[], installationId = TRUSTED, trusted = true) {
  recorder.reset({
    people,
    installations: [{ id: installationId, archive_id: ARCHIVE, is_trusted: trusted, revoked_at: null }],
    settings: [{ archive_id: ARCHIVE, display_name: "Margaret", birth_date: "1941-03-02", note: "Likes the sea" }],
    families: [{ archive_id: ARCHIVE, email: "family@example.invalid" }],
    archives: [{ id: ARCHIVE, created_at: "2025-01-10T00:00:00Z" }],
    device_sessions: [{ id: "s1", archive_id: ARCHIVE, started_at: new Date().toISOString(), ended_at: null }],
    channel_visits: [{ id: "v1", archive_id: ARCHIVE, started_at: new Date().toISOString() }],
  });
}

beforeEach(() => {
  mail.sendTestEmail.mockClear();
  mail.sendWelcomeEmail.mockClear();
});

// ─────────────────────────────────────────────────────────────── access-4

describe("PATCH /api/people/:id answers with what the caller may read", () => {
  it("a co-author editing themselves gets the self columns, never the admin's note or last seen", async () => {
    world([person(HELPER, "co_author"), person(ADMIN, "admin")], LAPTOP, false);
    const res = await request(app)
      .patch(`/api/people/${HELPER}`)
      .set("Cookie", [device(LAPTOP), profile(HELPER, "co_author")])
      .send({ relationship: "Granddaughter" });

    expect(res.status).toBe(200);
    const update = recorder.forTable("people").find((q) => q.op === "update");
    expect(update?.select).toBe(PERSON_SELF_COLUMNS);
    expect(update?.select).not.toContain("admin_note");
    expect(update?.select).not.toContain("last_seen_at");
    expect(update?.select).not.toContain("locked_until");
  });

  it("an admin still reads the admin set back", async () => {
    world([person(ADMIN, "admin"), person(HELPER, "co_author")], LAPTOP, false);
    await request(app)
      .patch(`/api/people/${HELPER}`)
      .set("Cookie", [device(LAPTOP), profile(ADMIN, "admin")])
      .send({ relationship: "Granddaughter" });

    const update = recorder.forTable("people").find((q) => q.op === "update");
    expect(update?.select).toBe(PERSON_ADMIN_COLUMNS);
  });
});

// ─────────────────────────────────────────────────────────────── access-3

describe("promoting a PIN-less profile gives it a PIN", () => {
  it("mints one, stores only its hash, and returns it once", async () => {
    world([person(ADMIN, "admin"), person(GRANDCHILD, "user", { pin_hash: null })], LAPTOP, false);
    recorder.opResponses["people:select:id, pin_hash"] = [{ id: GRANDCHILD, pin_hash: null }];

    const res = await request(app)
      .patch(`/api/people/${GRANDCHILD}/role`)
      .set("Cookie", [device(LAPTOP), profile(ADMIN, "admin")])
      .send({ role: "co_author" });

    expect(res.status).toBe(200);
    expect(res.body.pin).toMatch(/^\d{6}$/);
    expect(res.body.emailed).toEqual({ success: true });

    const update = recorder.forTable("people").find((q) => q.op === "update");
    const payload = update?.payload as Record<string, unknown>;
    expect(payload.role).toBe("co_author");
    expect(typeof payload.pin_hash).toBe("string");
    expect(payload.pin_hash).not.toBe(res.body.pin);
    expect(JSON.stringify(res.body)).not.toContain(String(payload.pin_hash));
    expect(mail.sendWelcomeEmail).toHaveBeenCalledTimes(1);
  });

  it("leaves an existing PIN alone", async () => {
    world([person(ADMIN, "admin"), person(HELPER, "co_author")], LAPTOP, false);
    recorder.opResponses["people:select:id, pin_hash"] = [{ id: HELPER, pin_hash: "$argon2id$existing" }];

    const res = await request(app)
      .patch(`/api/people/${HELPER}/role`)
      .set("Cookie", [device(LAPTOP), profile(ADMIN, "admin")])
      .send({ role: "admin" });

    expect(res.status).toBe(200);
    expect(res.body.pin).toBeUndefined();
    const payload = recorder.forTable("people").find((q) => q.op === "update")?.payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty("pin_hash");
    expect(mail.sendWelcomeEmail).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────── access-7

describe("only her screen writes what her screen shows", () => {
  const settingsWrites = () => recorder.forTable("settings").filter((q) => q.op === "update");

  it("the trusted screen still reports", async () => {
    world([person(SUBJECT, "user")]);
    const res = await request(app).post("/api/screen-state").set("Cookie", [device(TRUSTED)]).send({ number: 4 });
    expect(res.status).toBe(204);
    expect(settingsWrites()).toHaveLength(1);
  });

  it("the trusted screen carrying her own profile still reports", async () => {
    world([person(SUBJECT, "user")]);
    const res = await request(app)
      .post("/api/screen-state")
      .set("Cookie", [device(TRUSTED), profile(SUBJECT, "user")])
      .send({ number: 4 });
    expect(res.status).toBe(204);
    expect(settingsWrites()).toHaveLength(1);
  });

  it("an untrusted installation writes nothing", async () => {
    world([person(SUBJECT, "user")], LAPTOP, false);
    const res = await request(app)
      .post("/api/screen-state")
      .set("Cookie", [device(LAPTOP)])
      .send({ number: 4, software_version: "evil" });
    expect(res.status).toBe(204);
    expect(settingsWrites()).toHaveLength(0);
    expect(recorder.forTable("installations").filter((q) => q.op === "update")).toHaveLength(0);
  });

  it("an admin working at the trusted machine writes nothing", async () => {
    world([person(ADMIN, "admin")]);
    const res = await request(app)
      .post("/api/screen-state")
      .set("Cookie", [device(TRUSTED), profile(ADMIN, "admin")])
      .send({ number: 4 });
    expect(res.status).toBe(204);
    expect(settingsWrites()).toHaveLength(0);
  });

  it("an untrusted installation cannot open, close or rewrite her sessions and visits", async () => {
    world([person(SUBJECT, "user")], LAPTOP, false);
    const cookie = [device(LAPTOP)];
    await request(app).post("/api/sessions").set("Cookie", cookie).send({});
    await request(app).post("/api/sessions/s1/end").set("Cookie", cookie).send({});
    await request(app).post("/api/sessions/visits").set("Cookie", cookie).send({ channel_number: 4 });
    await request(app).post("/api/sessions/visits/v1/end").set("Cookie", cookie).send({ media_viewed_count: 99 });

    const writes = [...recorder.forTable("device_sessions"), ...recorder.forTable("channel_visits")].filter(
      (q) => q.op !== "select"
    );
    expect(writes).toHaveLength(0);
  });

  it("the trusted screen still closes its own visit", async () => {
    world([person(SUBJECT, "user")]);
    const res = await request(app)
      .post("/api/sessions/visits/v1/end")
      .set("Cookie", [device(TRUSTED)])
      .send({ media_viewed_count: 3 });
    expect(res.status).toBe(204);
    expect(recorder.forTable("channel_visits").filter((q) => q.op === "update")).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────── access-8

describe("her screen with her own profile is served the display's columns", () => {
  const cookie = [device(TRUSTED), profile(SUBJECT, "user")];

  it("GET /api/people: the display set, filtered on the server", async () => {
    world([person(SUBJECT, "user"), person(ADMIN, "admin")]);
    const res = await request(app).get("/api/people").set("Cookie", cookie);
    expect(res.status).toBe(200);

    const read = recorder.forTable("people").find((q) => q.select === PERSON_COLUMNS);
    expect(read).toBeDefined();
    expect(read?.select).not.toContain("email");
    expect(read?.filters).toContainEqual({ method: "neq", column: "role", value: "user" });
  });

  it("GET /api/people/:id about herself: never her own email or phone", async () => {
    world([person(SUBJECT, "user")]);
    await request(app).get(`/api/people/${SUBJECT}`).set("Cookie", cookie);
    const reads = recorder.forTable("people").filter((q) => q.op === "select" && q.filters.some((f) => f.column === "id" && f.value === SUBJECT));
    const routeRead = reads[reads.length - 1];
    expect(routeRead?.select).toBe(PERSON_COLUMNS);
    expect(routeRead?.select).not.toContain("contact_number");
  });
});

// ─────────────────────────────────────────────────────────────── test email

describe("POST /api/people/test-email", () => {
  const adminCookie = [device(LAPTOP), profile(ADMIN, "admin")];

  it("ignores a recipient in the body and sends to the caller's own address", async () => {
    world([person(ADMIN, "admin")], LAPTOP, false);
    const res = await request(app)
      .post("/api/people/test-email")
      .set("Cookie", adminCookie)
      .send({ to: "stranger@example.com" });

    expect(res.status).toBe(200);
    expect(mail.sendTestEmail).toHaveBeenCalledWith("ad@example.invalid");
    expect(JSON.stringify(res.body)).not.toContain("stranger@example.com");
  });

  it("falls back to the family's address when the caller has none", async () => {
    world([person(ADMIN, "admin", { email: null })], LAPTOP, false);
    await request(app).post("/api/people/test-email").set("Cookie", adminCookie).send({});
    expect(mail.sendTestEmail).toHaveBeenCalledWith("family@example.invalid");
  });

  it("answers a failure in one sentence, not the transport's words", async () => {
    world([person(ADMIN, "admin")], LAPTOP, false);
    const res = await request(app).post("/api/people/test-email").set("Cookie", adminCookie).send({});
    expect(res.body.success).toBe(false);
    expect(res.body.reason).toBe("The test email could not be sent.");
    expect(JSON.stringify(res.body)).not.toMatch(/gmail|EMAIL_PASS|535/i);
  });
});
