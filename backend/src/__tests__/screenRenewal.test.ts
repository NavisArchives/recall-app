import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { recorder } from "./support/supabaseRecorder.js";

vi.mock("../services/email.js", () => ({
  sendScreenRenewalEmail: vi.fn(async () => ({ success: true })),
  sendScreenReplacementEmail: vi.fn(async () => ({ success: true })),
  sendFamilyRecoveryEmail: vi.fn(async () => ({ success: true })),
  sendPinResetEmail: vi.fn(async () => ({ success: true })),
  sendInviteEmail: vi.fn(async () => ({ success: true })),
  sendVerificationEmail: vi.fn(async () => ({ success: true })),
  sendAccountExistsEmail: vi.fn(async () => ({ success: true })),
  sendWelcomeEmail: vi.fn(async () => ({ success: true })),
  sendTestEmail: vi.fn(async () => ({ success: true })),
  sendInvitationRequestReceipt: vi.fn(async () => ({ success: true })),
  sendInvitationRequestNotice: vi.fn(async () => ({ success: true })),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => recorder.client,
}));

const { createApp } = await import("../app.js");
const email = await import("../services/email.js");
const app = createApp();

/**
 * The renewal cadence (056) — owner's numbers, 17 Sep 2026: 90 days
 * standard, the admin renews from the workspace before it ever lapses, a
 * 14-day advance notice, admin-only, by email and in the workspace.
 *
 * Two things must both hold, and they pull in opposite directions: the
 * *renewal* route must never be reachable except by an admin who can manage
 * people on a session the row still recognises (never by the device cookie
 * that would let a lapsed or revoked screen extend its own life); the
 * *notice* must fire once per approach to the date and never nag on every
 * page load once it has.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";
const ARCHIVE = "aaaaaaaa-0000-0000-0000-00000000000a";
const INSTALL = "aaaaaaaa-0000-0000-0000-0000000000f1";
const SCREEN = "aaaaaaaa-0000-0000-0000-0000000000f2";
const ADMIN = "aaaaaaaa-0000-0000-0000-0000000000ad";
const CO_AUTHOR = "aaaaaaaa-0000-0000-0000-0000000000c0";

function deviceOnly() {
  return [`recall_device=${jwt.sign({ installationId: INSTALL, archiveId: ARCHIVE }, SECRET, { expiresIn: 3600 })}`];
}
function session(personId: string, role: string) {
  return [
    ...deviceOnly(),
    `recall_profile=${jwt.sign({ personId, name: "Someone", role, archiveId: ARCHIVE }, SECRET, { expiresIn: 3600 })}`,
  ];
}

function days(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString();
}

// The recorder answers every query by TABLE, never by filter — a second row
// in `people` would silently stand in for the first regardless of `.eq(id)`.
// Each world therefore carries exactly one person: whichever the test means
// to authenticate as.
function world(
  screenExpiresAt: string | null,
  notifiedAt: string | null = null,
  person: { id: string; role: string } = { id: ADMIN, role: "admin" }
) {
  recorder.reset({
    people: [
      { id: person.id, archive_id: ARCHIVE, name: "Someone", role: person.role, status: "active", archived_at: null },
    ],
    installations: [
      {
        id: SCREEN,
        archive_id: ARCHIVE,
        name: "The family screen",
        is_trusted: true,
        is_recall_device: false,
        revoked_at: null,
        trusted_at: "2026-01-01T00:00:00.000Z",
        last_used_at: null,
        software_version: null,
        session_expires_at: screenExpiresAt,
        renewal_notified_at: notifiedAt,
      },
    ],
    families: [{ archive_id: ARCHIVE, email: "family@example.invalid", display_name: "Fournier" }],
  });
}

beforeEach(() => world(days(90)));

describe("who may renew the screen", () => {
  it("the device cookie alone cannot renew — a lapsed or revoked screen must not extend itself", async () => {
    const res = await request(app).post("/api/settings/screens/renew").set("Cookie", deviceOnly());
    expect(res.status).toBe(401);
    expect(recorder.forTable("installations").filter((q) => q.op === "update")).toHaveLength(0);
  });

  it("a co-author (cannot manage people) is refused", async () => {
    world(days(90), null, { id: CO_AUTHOR, role: "co_author" });
    const res = await request(app).post("/api/settings/screens/renew").set("Cookie", session(CO_AUTHOR, "co_author"));
    expect(res.status).toBe(403);
    expect(recorder.forTable("installations").filter((q) => q.op === "update")).toHaveLength(0);
  });

  it("anonymous is refused", async () => {
    const res = await request(app).post("/api/settings/screens/renew");
    expect(res.status).toBe(401);
  });

  it("an admin renews: the date moves ~90 days out and the notice flag clears for the next cycle", async () => {
    const res = await request(app).post("/api/settings/screens/renew").set("Cookie", session(ADMIN, "admin"));
    expect(res.status).toBe(200);

    const update = recorder.forTable("installations").find((q) => q.op === "update");
    expect(update?.payload).toMatchObject({ renewal_notified_at: null });
    const filters = update?.filters ?? [];
    expect(filters).toEqual(
      expect.arrayContaining([
        { method: "eq", column: "archive_id", value: ARCHIVE },
        { method: "eq", column: "is_trusted", value: true },
      ])
    );
    const daysOut = (Date.parse((update?.payload as Record<string, unknown>).session_expires_at as string) - Date.now()) / 86_400_000;
    expect(daysOut).toBeGreaterThan(89);
    expect(daysOut).toBeLessThan(91);
  });
});

describe("the 14-day notice, riding on GET /settings/screens", () => {
  it("stays quiet more than 14 days out", async () => {
    world(days(20));
    await request(app).get("/api/settings/screens").set("Cookie", session(ADMIN, "admin"));
    await new Promise((r) => setImmediate(r));
    expect(email.sendScreenRenewalEmail).not.toHaveBeenCalled();
  });

  it("fires once inside the 14-day window and stamps renewal_notified_at", async () => {
    const dueAt = days(10);
    world(dueAt);
    const receipt = vi.mocked(email.sendScreenRenewalEmail);
    receipt.mockClear();

    const res = await request(app).get("/api/settings/screens").set("Cookie", session(ADMIN, "admin"));
    expect(res.status).toBe(200);
    // The read itself is never held up by the notification side effect.
    expect(res.body[0]).toMatchObject({ id: SCREEN });

    await vi.waitFor(() => expect(receipt).toHaveBeenCalled());
    expect(receipt).toHaveBeenCalledWith("family@example.invalid", "Fournier", dueAt);

    const update = recorder.forTable("installations").find((q) => q.op === "update");
    expect(update?.payload).toMatchObject({ renewal_notified_at: expect.any(String) });
  });

  it("does not send twice for the same cycle", async () => {
    world(days(5), new Date().toISOString()); // already notified this cycle
    const receipt = vi.mocked(email.sendScreenRenewalEmail);
    receipt.mockClear();

    await request(app).get("/api/settings/screens").set("Cookie", session(ADMIN, "admin"));
    await new Promise((r) => setImmediate(r));
    expect(receipt).not.toHaveBeenCalled();
  });

  it("fires again for an overdue screen nobody has renewed yet", async () => {
    world(days(-3));
    const receipt = vi.mocked(email.sendScreenRenewalEmail);
    receipt.mockClear();

    await request(app).get("/api/settings/screens").set("Cookie", session(ADMIN, "admin"));
    await vi.waitFor(() => expect(receipt).toHaveBeenCalled());
  });
});
