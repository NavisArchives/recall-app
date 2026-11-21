import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { recorder } from "./support/supabaseRecorder.js";

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => recorder.client,
}));

const { createApp } = await import("../app.js");
const { forgetVerifiedInstallations } = await import("../middleware/auth.js");
const app = createApp();

/**
 * The one trusted screen (M42, completing M06).
 *
 * Two properties, and both were fiction before this. Revoking a device did
 * nothing until its cookie happened to expire — thirty days of a screen that
 * had supposedly been removed, which makes "revoke" a word rather than an
 * action. And the subject's profile appeared on every chooser, so her face
 * and her PIN worked from any browser that had ever been paired, when her
 * whole model is that her world is one room.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";
const ARCHIVE = "aaaaaaaa-0000-0000-0000-00000000000a";
const INSTALL = "aaaaaaaa-0000-0000-0000-0000000000f1";
const SUBJECT = "aaaaaaaa-0000-0000-0000-0000000000c1";
const ADMIN = "aaaaaaaa-0000-0000-0000-0000000000ad";

const device = `recall_device=${jwt.sign({ installationId: INSTALL, archiveId: ARCHIVE }, SECRET, { expiresIn: 3600 })}`;

function installation(over: Record<string, unknown> = {}) {
  return { id: INSTALL, archive_id: ARCHIVE, revoked_at: null, is_trusted: true, ...over };
}

const PEOPLE = [
  {
    id: SUBJECT,
    name: "Margaret",
    role: "user",
    status: "active",
    archived_at: null,
    archive_id: ARCHIVE,
    pin_hash: null,
    failed_pin_attempts: 0,
    locked_until: null,
    profile_picture_path: null,
  },
  {
    id: ADMIN,
    name: "Andy",
    role: "admin",
    status: "active",
    archived_at: null,
    archive_id: ARCHIVE,
    pin_hash: null,
    failed_pin_attempts: 0,
    locked_until: null,
    profile_picture_path: null,
  },
];

beforeEach(() => {
  recorder.reset({});
  // The outage cache is process state; carried between tests it would let one
  // test's verification answer another's outage.
  forgetVerifiedInstallations();
});

describe("revoking a screen takes effect at once", () => {
  it("accepts a device whose row is live", async () => {
    recorder.reset({ installations: [installation()], people: PEOPLE, settings: [] });
    const res = await request(app).get("/api/settings").set("Cookie", device);

    expect(res.status).toBe(200);
  });

  it("refuses the very next request after the row is revoked", async () => {
    recorder.reset({ installations: [installation()], people: PEOPLE, settings: [] });
    expect((await request(app).get("/api/settings").set("Cookie", device)).status).toBe(200);

    // The cookie is untouched and still unexpired — only the row changed.
    recorder.reset({
      installations: [installation({ revoked_at: new Date().toISOString() })],
      people: PEOPLE,
      settings: [],
    });
    const after = await request(app).get("/api/settings").set("Cookie", device);

    expect(after.status).toBe(401);
  });

  it("refuses a device whose row no longer exists", async () => {
    recorder.reset({ installations: [], people: PEOPLE, settings: [] });
    const res = await request(app).get("/api/settings").set("Cookie", device);

    expect(res.status).toBe(401);
  });

  it("refuses a cookie that names a different family than its row", async () => {
    recorder.reset({
      installations: [installation({ archive_id: "bbbbbbbb-0000-0000-0000-00000000000b" })],
      people: PEOPLE,
      settings: [],
    });
    const res = await request(app).get("/api/settings").set("Cookie", device);

    expect(res.status).toBe(401);
  });

  it("keeps the display alive when the database cannot be reached", async () => {
    // The outage the offline fallback exists for. Failing closed here would
    // make the outage itself the thing that blanks the living room. The door
    // only opens on the last-known-good rule, so the device is verified once
    // before the plug is pulled — which is what the display's constant
    // polling does in life.
    recorder.reset({ installations: [installation()], people: PEOPLE, settings: [] });
    expect((await request(app).get("/api/settings").set("Cookie", device)).status).toBe(200);

    recorder.failure = { message: "connection refused" };
    const res = await request(app).get(`/api/media/${INSTALL}/file`).set("Cookie", device);

    // Not 401: the device got through. What it gets is the media route's own
    // answer, which is a different question.
    expect(res.status).not.toBe(401);
  });

  it("gives an outage nothing for a device it has never verified", async () => {
    // The outage door opens on memory, and there is none: a cookie this
    // process has never seen verified gets a temporary refusal, not a
    // fallback. 503, not 401 — an outage is not a sign-out.
    recorder.failure = { message: "connection refused" };

    const res = await request(app).get("/api/settings").set("Cookie", device);

    expect(res.status).toBe(503);
  });

  it("keeps refusing a revoked device during an outage", async () => {
    // The exact weakening an outage must not perform: revoked while the
    // database was up, the revocation is remembered — pulling the plug does
    // not un-revoke the screen.
    recorder.reset({
      installations: [installation({ revoked_at: new Date().toISOString() })],
      people: PEOPLE,
      settings: [],
    });
    expect((await request(app).get("/api/settings").set("Cookie", device)).status).toBe(401);

    recorder.failure = { message: "connection refused" };
    const res = await request(app).get("/api/settings").set("Cookie", device);

    expect(res.status).toBe(401);
  });
});

describe("a PIN guess that cannot be counted is refused, not free", () => {
  it("answers 503 when the failure counter cannot record", async () => {
    // Same rule as the remote chooser: the counter is the protection, so a
    // guess the database could not count is refused rather than answered
    // like a counted one.
    recorder.reset({
      installations: [installation()],
      people: [{ ...PEOPLE[1], pin_hash: "not-a-real-hash" }],
    });
    recorder.failNext = {
      table: "rpc:record_pin_failure",
      op: "select",
      error: { message: "connection refused" },
    };

    const res = await request(app)
      .post(`/api/auth/profiles/${ADMIN}/unlock`)
      .set("Cookie", device)
      .send({ pin: "000000" });

    expect(res.status).toBe(503);
  });
});

describe("the subject exists on one screen only", () => {
  it("shows her face on the trusted device", async () => {
    recorder.reset({ installations: [installation()], people: PEOPLE });
    const res = await request(app).get("/api/auth/profiles").set("Cookie", device);

    expect(res.status).toBe(200);
    expect(res.body.map((p: { name: string }) => p.name)).toContain("Margaret");
  });

  it("omits her entirely everywhere else — absent, not greyed", async () => {
    recorder.reset({ installations: [installation({ is_trusted: false })], people: PEOPLE });
    const res = await request(app).get("/api/auth/profiles").set("Cookie", device);

    expect(res.status).toBe(200);
    const names = res.body.map((p: { name: string }) => p.name);
    expect(names).not.toContain("Margaret");
    // The rest of the family is still there: this hides one profile, not the
    // chooser.
    expect(names).toContain("Andy");
  });

  it("refuses to unlock her from an untrusted device, PIN or no PIN", async () => {
    recorder.reset({
      installations: [installation({ is_trusted: false })],
      people: [PEOPLE[0]],
    });
    const res = await request(app)
      .post(`/api/auth/profiles/${SUBJECT}/unlock`)
      .set("Cookie", device)
      .send({ pin: "123456" });

    // The same answer as a person who does not exist — because on this
    // device, she does not.
    expect(res.status).toBe(404);
  });

  it("opens her profile on the trusted device", async () => {
    recorder.reset({ installations: [installation()], people: [PEOPLE[0]], device_sessions: [] });
    const res = await request(app)
      .post(`/api/auth/profiles/${SUBJECT}/unlock`)
      .set("Cookie", device)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Margaret");
  });
});
