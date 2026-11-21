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
 * M161 / F55-twin — "Sign out everywhere" actually signs out everywhere.
 *
 * The admin's button revoked the opaque family sessions and left the two
 * signed-JWT tiers alive, exactly as the password reset did before M159. It
 * cannot reuse `password_set_at` (no password changes on a logout), so it
 * gets its own cutoff — `sessions_valid_from` — and the guards refuse a token
 * older than the LATER of the two. These tests hold that: a pre-logout token
 * is refused, a reset cutoff and a logout cutoff coexist without shadowing,
 * and the trusted screen is left alone (M29, the owner's call for this
 * surface too).
 */

const SECRET = "test-session-secret-that-is-long-enough-32";

const ARCHIVE_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const FAMILY_A = "aaaaaaaa-0000-0000-0000-0000000000fa";
const ADMIN_A = "aaaaaaaa-0000-0000-0000-0000000000ad";
const INSTALL_A = "aaaaaaaa-0000-0000-0000-0000000000f1";

const HOUR = 60 * 60 * 1000;
const LONG_AGO = Date.now() - 3 * HOUR;
const RESET_AT = new Date(Date.now() - 2 * HOUR).toISOString(); // older cutoff
const LOGOUT_AT = new Date(Date.now() - 1 * HOUR).toISOString(); // newer cutoff
const BETWEEN = Date.now() - 1.5 * HOUR; // after the reset, before the logout
const NOW = Date.now();

function cookieAt(name: string, claims: Record<string, unknown>, issuedMs: number): string {
  const token = jwt.sign({ ...claims, iat: Math.floor(issuedMs / 1000) }, SECRET);
  return `${name}=${token}`;
}
const device = (issuedMs: number) =>
  cookieAt("recall_device", { installationId: INSTALL_A, archiveId: ARCHIVE_A }, issuedMs);
const profile = (issuedMs: number) =>
  cookieAt(
    "recall_profile",
    { personId: ADMIN_A, name: "Anne", role: "admin", archiveId: ARCHIVE_A },
    issuedMs
  );

function world(over: { isTrusted?: boolean; reset?: string | null; logout?: string | null } = {}) {
  recorder.reset({
    installations: [
      { id: INSTALL_A, archive_id: ARCHIVE_A, is_trusted: over.isTrusted ?? false, revoked_at: null },
    ],
    families: [
      {
        id: FAMILY_A,
        archive_id: ARCHIVE_A,
        password_set_at: over.reset ?? null,
        sessions_valid_from: over.logout ?? null,
      },
    ],
    family_sessions: [],
    people: [{ id: ADMIN_A, name: "Anne", role: "admin", status: "active", archived_at: null, archive_id: ARCHIVE_A }],
    channels: [],
  });
}

beforeEach(() => world({ logout: LOGOUT_AT }));

describe("after 'sign out everywhere'", () => {
  it("refuses an untrusted device whose cookie predates the sign-out", async () => {
    const res = await request(app).get("/api/channels").set("Cookie", device(LONG_AGO));
    expect(res.status).toBe(401);
  });

  it("refuses a management session whose profile cookie predates the sign-out", async () => {
    const res = await request(app)
      .get("/api/nfc-cards")
      .set("Cookie", [device(NOW), profile(LONG_AGO)]);
    expect(res.status).toBe(401);
  });

  it("accepts a session issued after the sign-out", async () => {
    const res = await request(app).get("/api/channels").set("Cookie", device(NOW));
    expect(res.status).not.toBe(401);
  });

  it("leaves the trusted screen alone (M29)", async () => {
    world({ isTrusted: true, logout: LOGOUT_AT });
    const res = await request(app).get("/api/channels").set("Cookie", device(LONG_AGO));
    expect(res.status).not.toBe(401);
  });
});

describe("the reset and logout cutoffs coexist — the later one governs", () => {
  it("refuses a token newer than the reset but older than the sign-out", async () => {
    world({ reset: RESET_AT, logout: LOGOUT_AT });
    // Issued after the password reset, before the sign-out-everywhere: still stale.
    const res = await request(app).get("/api/channels").set("Cookie", device(BETWEEN));
    expect(res.status).toBe(401);
  });

  it("accepts a token newer than both cutoffs", async () => {
    world({ reset: RESET_AT, logout: LOGOUT_AT });
    const res = await request(app).get("/api/channels").set("Cookie", device(NOW));
    expect(res.status).not.toBe(401);
  });

  it("a reset still governs on its own when no sign-out has happened", async () => {
    world({ reset: LOGOUT_AT, logout: null });
    const res = await request(app).get("/api/channels").set("Cookie", device(LONG_AGO));
    expect(res.status).toBe(401);
  });
});

describe("the cutoff read asks for the logout stamp (F59-style pin on M161's line)", () => {
  it("names sessions_valid_from in the families select, not password_set_at alone", async () => {
    /*
      The one line M161 is made of is `.select("password_set_at,
      sessions_valid_from")`. The recorder returns the fixture row whole, so
      no outcome test sees the column vanish — mutating the select back to
      `password_set_at` alone (the F55 bug, and the exact string sitting one
      line away in the migration-042 fallback) keeps every behavioural test
      green. So the select's shape is asserted directly: a device request
      goes straight down the device path (no readFamilySession), leaving the
      cutoff read as the only families select, and it must ask for the logout
      stamp.
    */
    world({ logout: LOGOUT_AT });
    await request(app).get("/api/channels").set("Cookie", device(NOW));

    const cutoffRead = recorder
      .forTable("families")
      .find((q) => q.op === "select" && (q.select ?? "").includes("password_set_at"));
    expect(cutoffRead).toBeDefined();
    expect(cutoffRead!.select).toContain("sessions_valid_from");
  });

  it("reads the cutoff scoped to the caller's own archive (M164, sibling of the reset pin)", async () => {
    // The logout cutoff shares familyCutoff with the reset, so the same
    // archive-scope guarantee is pinned here too: the read carries this
    // family's id, and dropping .eq("archive_id", …) turns this red.
    world({ logout: LOGOUT_AT });
    await request(app).get("/api/channels").set("Cookie", device(NOW));

    const cutoffReads = recorder.forTable("families").filter((q) => q.op === "select");
    expect(cutoffReads.length).toBeGreaterThan(0);
    for (const q of cutoffReads) {
      expect(q.filters.some((f) => f.column === "archive_id" && f.value === ARCHIVE_A)).toBe(true);
    }
  });
});

describe("the route stamps the cutoff", () => {
  it("writes sessions_valid_from when an admin signs everyone out", async () => {
    // An admin's live family session.
    recorder.reset({
      family_sessions: [
        {
          id: "sess-admin",
          family_id: FAMILY_A,
          archive_id: ARCHIVE_A,
          person_id: ADMIN_A,
          role: "admin",
          session_version: 1,
          expires_at: new Date(Date.now() + HOUR).toISOString(),
          revoked_at: null,
        },
      ],
      families: [{ id: FAMILY_A, archive_id: ARCHIVE_A, session_version: 1, status: "active" }],
      people: [{ id: ADMIN_A, name: "Anne", role: "admin", archive_id: ARCHIVE_A, archived_at: null, status: "active" }],
    });

    const res = await request(app)
      .post("/api/family/logout-everywhere")
      .set("Cookie", "recall_family=an-opaque-admin-token");

    expect(res.status).toBe(200);
    const stamp = recorder
      .forTable("families")
      .find((q) => q.op === "update");
    expect(stamp).toBeDefined();
    expect((stamp!.payload as Record<string, unknown>).sessions_valid_from).toBeTruthy();
    // Scoped to this one family — the recorder ignores filters, so dropping
    // `.eq("id", session.familyId)` stamps the sign-out onto every family on
    // the platform with no behavioural tell. The write's shape is asserted
    // directly (F68 #5).
    expect(
      stamp!.filters.some((f) => f.method === "eq" && f.column === "id" && f.value === FAMILY_A)
    ).toBe(true);
    // Revoking the opaque tier still happens too.
    expect(recorder.forTable("family_sessions").some((q) => q.op === "update")).toBe(true);
  });
});

describe("the button is robust — stamp first, version bump, retryable (F62/F63)", () => {
  function adminWorld() {
    recorder.reset({
      family_sessions: [
        {
          id: "sess-admin",
          family_id: FAMILY_A,
          archive_id: ARCHIVE_A,
          person_id: ADMIN_A,
          role: "admin",
          session_version: 1,
          expires_at: new Date(Date.now() + HOUR).toISOString(),
          revoked_at: null,
        },
      ],
      families: [{ id: FAMILY_A, archive_id: ARCHIVE_A, session_version: 1, status: "active" }],
      people: [{ id: ADMIN_A, name: "Anne", role: "admin", archive_id: ARCHIVE_A, archived_at: null, status: "active" }],
    });
  }

  /** The one opaque-tier write that revokes — not readFamilySession's last_seen_at touch. */
  const isRevoke = (q: { table: string; op: string; payload?: unknown }) =>
    q.table === "family_sessions" &&
    q.op === "update" &&
    !!q.payload &&
    typeof q.payload === "object" &&
    "revoked_at" in q.payload;

  it("bumps session_version alongside the cutoff — the opaque-tier backstop (F62)", async () => {
    adminWorld();
    await request(app).post("/api/family/logout-everywhere").set("Cookie", "recall_family=t");
    const stamp = recorder.forTable("families").find((q) => q.op === "update");
    expect((stamp!.payload as Record<string, unknown>).session_version).toBe(2);
  });

  it("stamps the family row BEFORE revoking the opaque sessions (F63 — retryable order)", async () => {
    adminWorld();
    await request(app).post("/api/family/logout-everywhere").set("Cookie", "recall_family=t");
    const stampIdx = recorder.queries.findIndex((q) => q.table === "families" && q.op === "update");
    const revokeIdx = recorder.queries.findIndex(isRevoke);
    expect(stampIdx).toBeGreaterThanOrEqual(0);
    expect(revokeIdx).toBeGreaterThan(stampIdx);
  });

  it("on a stamp error, 500s and does NOT revoke — nothing irreversible, retry works (F63)", async () => {
    adminWorld();
    // The pre-042 / outage failure on the family row write.
    recorder.failNext = { table: "families", op: "update", error: { message: "no column", code: "PGRST204" } };
    const res = await request(app).post("/api/family/logout-everywhere").set("Cookie", "recall_family=t");

    expect(res.status).toBe(500);
    // The opaque tier was never touched, so the admin's own session survives
    // and the button can be pressed again.
    expect(recorder.queries.some(isRevoke)).toBe(false);
  });
});
