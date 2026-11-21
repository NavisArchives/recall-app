import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { recorder } from "./support/supabaseRecorder.js";

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => recorder.client,
}));

const mail = vi.hoisted(() => ({
  sendWelcomeEmail: vi.fn(async () => ({ success: true })),
  sendPinResetEmail: vi.fn(async () => ({ success: true })),
}));
vi.mock("../services/email.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/email.js")>()),
  sendWelcomeEmail: mail.sendWelcomeEmail,
  sendPinResetEmail: mail.sendPinResetEmail,
}));

const { createApp } = await import("../app.js");
const app = createApp();

/**
 * The PIN lockout escalates (064, authn-8): each consecutive lock doubles the
 * next, counted in `people.pin_lock_count`. A right PIN resets it in
 * services/pins.ts. These are the three places an ADMIN decides the slate is
 * clean — clearing a lock, issuing a new PIN, and the PIN minted on promotion
 * — and each must reset the escalation too. Otherwise the next typo after an
 * admin's deliberate reset costs the person hours instead of fifteen minutes.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";
const ARCHIVE = "aaaaaaaa-0000-0000-0000-00000000000a";
const LAPTOP = "aaaaaaaa-0000-0000-0000-0000000000f2";
const ADMIN = "aaaaaaaa-0000-0000-0000-0000000000ad";
const HELPER = "aaaaaaaa-0000-0000-0000-0000000000c0";
const GRANDCHILD = "aaaaaaaa-0000-0000-0000-0000000000c2";

const cookies = [
  `recall_device=${jwt.sign({ installationId: LAPTOP, archiveId: ARCHIVE }, SECRET, { expiresIn: 3600 })}`,
  `recall_profile=${jwt.sign({ personId: ADMIN, name: "Anne", role: "admin", archiveId: ARCHIVE }, SECRET, { expiresIn: 3600 })}`,
];

const person = (id: string, role: string, extra: Record<string, unknown> = {}) => ({
  id,
  archive_id: ARCHIVE,
  name: `Person ${id.slice(-2)}`,
  role,
  status: "active",
  archived_at: null,
  email: `${id.slice(-2)}@example.invalid`,
  locked_until: new Date(Date.now() + 3_600_000).toISOString(),
  failed_pin_attempts: 3,
  pin_lock_count: 4,
  ...extra,
});

function world(people: Record<string, unknown>[]) {
  recorder.reset({
    people,
    installations: [{ id: LAPTOP, archive_id: ARCHIVE, is_trusted: false, revoked_at: null }],
  });
}

const peopleUpdate = () =>
  recorder.forTable("people").find((q) => q.op === "update")?.payload as Record<string, unknown> | undefined;

beforeEach(() => {
  mail.sendWelcomeEmail.mockClear();
  mail.sendPinResetEmail.mockClear();
});

describe("an admin's reset starts the PIN escalation again", () => {
  it("clearing a lockout resets pin_lock_count with the attempts", async () => {
    world([person(ADMIN, "admin"), person(HELPER, "co_author")]);
    const res = await request(app).post(`/api/people/${HELPER}/clear-lockout`).set("Cookie", cookies);

    expect(res.status).toBe(200);
    expect(peopleUpdate()).toMatchObject({ locked_until: null, failed_pin_attempts: 0, pin_lock_count: 0 });
  });

  it("issuing a new PIN resets pin_lock_count", async () => {
    world([person(ADMIN, "admin"), person(HELPER, "co_author")]);
    const res = await request(app).post(`/api/people/${HELPER}/reset-pin`).set("Cookie", cookies);

    expect(res.status).toBe(200);
    expect(res.body.pin).toMatch(/^\d{6}$/);
    expect(peopleUpdate()).toMatchObject({ locked_until: null, failed_pin_attempts: 0, pin_lock_count: 0 });
  });

  it("the PIN minted on promotion starts with a clean count", async () => {
    world([person(ADMIN, "admin"), person(GRANDCHILD, "user", { pin_hash: null })]);
    recorder.opResponses["people:select:id, pin_hash"] = [{ id: GRANDCHILD, pin_hash: null }];

    const res = await request(app)
      .patch(`/api/people/${GRANDCHILD}/role`)
      .set("Cookie", cookies)
      .send({ role: "co_author" });

    expect(res.status).toBe(200);
    expect(peopleUpdate()).toMatchObject({ failed_pin_attempts: 0, locked_until: null, pin_lock_count: 0 });
  });
});
