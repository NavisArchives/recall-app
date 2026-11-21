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
 * M159 / F55 — a password reset actually signs the remote tiers out.
 *
 * The reset writes `families.password_set_at` and revokes the opaque family
 * sessions, but the two signed-JWT tiers survived it: a device or profile
 * cookie from before the reset kept working, because the guards wrote the
 * cutoff and never compared it. These tests hold the guards to the rule the
 * reset promises — a token issued before the last password change is refused
 * — and to the owner's line: her trusted screen is left alone (M29).
 */

const SECRET = "test-session-secret-that-is-long-enough-32";

const ARCHIVE_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const FAMILY_A = "aaaaaaaa-0000-0000-0000-0000000000fa";
const ADMIN_A = "aaaaaaaa-0000-0000-0000-0000000000ad";
const INSTALL_A = "aaaaaaaa-0000-0000-0000-0000000000f1";

// A second family, for the cross-family isolation pin (M164).
const ARCHIVE_B = "bbbbbbbb-0000-0000-0000-00000000000b";
const FAMILY_B = "bbbbbbbb-0000-0000-0000-0000000000fb";
const INSTALL_B = "bbbbbbbb-0000-0000-0000-0000000000f1";

/** Two instants either side of the reset. */
const BEFORE = Date.now() - 60 * 60 * 1000; // an hour ago
const RESET_AT = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min ago
const AFTER = Date.now(); // just now

/** A cookie whose token carries a chosen issue time (seconds). */
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

/** The world after a reset at RESET_AT, with a device of the given trust. */
function world(isTrusted: boolean) {
  recorder.reset({
    installations: [{ id: INSTALL_A, archive_id: ARCHIVE_A, is_trusted: isTrusted, revoked_at: null }],
    families: [{ id: FAMILY_A, archive_id: ARCHIVE_A, password_set_at: RESET_AT }],
    family_sessions: [],
    people: [{ id: ADMIN_A, name: "Anne", role: "admin", status: "active", archived_at: null, archive_id: ARCHIVE_A }],
    channels: [],
  });
}

beforeEach(() => world(false));

describe("the device tier, after a reset", () => {
  it("refuses an untrusted device whose cookie predates the reset", async () => {
    const res = await request(app).get("/api/channels").set("Cookie", device(BEFORE));
    expect(res.status).toBe(401);
  });

  it("accepts an untrusted device whose cookie was issued after the reset", async () => {
    const res = await request(app).get("/api/channels").set("Cookie", device(AFTER));
    expect(res.status).not.toBe(401);
  });

  it("leaves the trusted screen alone — her display keeps playing (M29)", async () => {
    world(true);
    const res = await request(app).get("/api/channels").set("Cookie", device(BEFORE));
    // Exempt: a stale iat on the ONE trusted device is not a sign-out.
    expect(res.status).not.toBe(401);
  });
});

describe("the profile/management tier, after a reset", () => {
  it("refuses a management session whose profile cookie predates the reset", async () => {
    // A departed admin's device+profile pair, both from before the reset.
    const res = await request(app)
      .get("/api/nfc-cards")
      .set("Cookie", [device(AFTER), profile(BEFORE)]);
    expect(res.status).toBe(401);
  });

  it("accepts a management session whose profile cookie is newer than the reset", async () => {
    const res = await request(app)
      .get("/api/nfc-cards")
      .set("Cookie", [device(AFTER), profile(AFTER)]);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

describe("the management tier answers to the row, not just the reset stamp (M171)", () => {
  it("refuses a management session whose person has been archived, however fresh the tokens", async () => {
    /*
      `requireRole` re-reads the person on every request precisely so the
      database can revoke — `if (!data || data.archived_at)`. The family-cookie
      branch's version of this is pinned (familySessions), but the
      device+profile branch's was not: deleting `|| data.archived_at` here
      stayed green, so an admin archived off the roster kept managing from a
      standing device+profile pair until the JWT expired. The tokens are minted
      AFTER the reset, so only the archived row can turn this away.
    */
    recorder.reset({
      installations: [{ id: INSTALL_A, archive_id: ARCHIVE_A, is_trusted: false, revoked_at: null }],
      families: [{ id: FAMILY_A, archive_id: ARCHIVE_A, password_set_at: RESET_AT }],
      family_sessions: [],
      people: [
        {
          id: ADMIN_A,
          name: "Anne",
          role: "admin",
          status: "active",
          archived_at: new Date().toISOString(),
          archive_id: ARCHIVE_A,
        },
      ],
      nfc_cards: [],
    });
    const res = await request(app)
      .get("/api/nfc-cards")
      .set("Cookie", [device(AFTER), profile(AFTER)]);
    expect(res.status).toBe(401);
  });
});

describe("the cutoff is per family — a reset in one never signs out another", () => {
  it("does not refuse a token whose family has no reset stamp", async () => {
    recorder.reset({
      installations: [{ id: INSTALL_A, archive_id: ARCHIVE_A, is_trusted: false, revoked_at: null }],
      // No password_set_at: nothing to enforce, so an old token still works.
      families: [{ id: FAMILY_A, archive_id: ARCHIVE_A, password_set_at: null }],
      family_sessions: [],
      channels: [],
    });
    const res = await request(app).get("/api/channels").set("Cookie", device(BEFORE));
    expect(res.status).not.toBe(401);
  });

  it("reads the cutoff scoped to the caller's own archive, never unscoped (F59)", async () => {
    /*
      The scoping is the whole tenancy guarantee — a reset in family A must
      never read (or act on) family B's cutoff. The recorder does not apply
      filters, so a 401/200 outcome alone can't prove the read was scoped;
      this asserts the query itself carries `.eq("archive_id", …)` with this
      family's id. Dropping that filter is the mutation the outcome tests
      cannot see, so it is pinned here directly.
    */
    await request(app).get("/api/channels").set("Cookie", device(BEFORE));
    const cutoffReads = recorder
      .forTable("families")
      .filter((q) => q.op === "select");
    expect(cutoffReads.length).toBeGreaterThan(0);
    for (const q of cutoffReads) {
      expect(q.filters.some((f) => f.column === "archive_id" && f.value === ARCHIVE_A)).toBe(true);
    }
  });

  it("a second family reads its OWN cutoff, never the first's (M164)", async () => {
    /*
      The two families are shown one at a time on purpose: the recorder does
      not apply filters, so a single fixture holding both would resolve family
      B's installation lookup to family A's row and fail at the archive
      mismatch before the cutoff is even read. Isolation is instead proven by
      the pair — family A's request (above) reads A's cutoff, family B's reads
      B's — each scoped to its own archive, never the other's. Dropping
      `.eq("archive_id", …)` from familyCutoff turns BOTH assertions red, which
      is the drift M164 exists to catch.
    */
    recorder.reset({
      installations: [{ id: INSTALL_B, archive_id: ARCHIVE_B, is_trusted: false, revoked_at: null }],
      families: [{ id: FAMILY_B, archive_id: ARCHIVE_B, password_set_at: RESET_AT }],
      channels: [],
    });
    const deviceB = cookieAt(
      "recall_device",
      { installationId: INSTALL_B, archiveId: ARCHIVE_B },
      BEFORE
    );
    await request(app).get("/api/channels").set("Cookie", deviceB);

    const cutoffReads = recorder.forTable("families").filter((q) => q.op === "select");
    expect(cutoffReads.length).toBeGreaterThan(0);
    for (const q of cutoffReads) {
      expect(q.filters.some((f) => f.column === "archive_id" && f.value === ARCHIVE_B)).toBe(true);
      // And never the other family's archive.
      expect(q.filters.some((f) => f.column === "archive_id" && f.value === ARCHIVE_A)).toBe(false);
    }
  });
});
