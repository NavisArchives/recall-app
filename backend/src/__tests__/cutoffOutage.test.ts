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
 * M162 / F57 — the session cutoff does not fail open during a database outage.
 *
 * The reset/logout cutoff was the one requireDevice check with neither a
 * fail-closed rule nor a remembered-state rule: a failed read read as "no
 * cutoff", and the offline branch returned before the cutoff ran, so a
 * departed member's pre-reset device rode its grace window through an outage.
 * These tests hold the two surfaces closed — while the trusted screen still
 * rides through, because her display must not blank (M29).
 */

const SECRET = "test-session-secret-that-is-long-enough-32";
const ARCHIVE_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const INSTALL_A = "aaaaaaaa-0000-0000-0000-0000000000f1";

const HOUR = 60 * 60 * 1000;
const RESET_AT = new Date(Date.now() - HOUR).toISOString();
const BEFORE = Date.now() - 2 * HOUR; // predates the reset
const AFTER = Date.now(); // after the reset

function device(issuedMs: number): string {
  const token = jwt.sign(
    { installationId: INSTALL_A, archiveId: ARCHIVE_A, iat: Math.floor(issuedMs / 1000) },
    SECRET
  );
  return `recall_device=${token}`;
}

function world(isTrusted: boolean, stamp: string | null = RESET_AT) {
  recorder.reset({
    installations: [{ id: INSTALL_A, archive_id: ARCHIVE_A, is_trusted: isTrusted, revoked_at: null }],
    families: [{ id: "fam-a", archive_id: ARCHIVE_A, password_set_at: stamp, sessions_valid_from: null }],
    channels: [],
  });
}

const channels = (cookie: string) => request(app).get("/api/channels").set("Cookie", cookie);

beforeEach(() => {
  forgetVerifiedInstallations();
  world(false);
});

describe("online: a genuine cutoff-read error fails closed", () => {
  it("refuses an untrusted device when the families read errors — not 'no cutoff'", async () => {
    // installations resolves; the families (cutoff) read errors with no
    // undefined-column code — an outage, not a schema state.
    recorder.failNext = { table: "families", op: "select", error: { message: "connection reset" } };
    // Even a device NEWER than the reset is refused: the guard could not
    // confirm the cutoff, so it does not fall open.
    const res = await channels(device(AFTER));
    expect(res.status).toBe(401);
  });

  it("still enforces the reset cutoff when only sessions_valid_from is missing (pre-042)", async () => {
    // The undefined-column code is the one benign case: retry password_set_at.
    recorder.failNext = {
      table: "families",
      op: "select",
      error: { message: 'column "sessions_valid_from" does not exist', code: "42703" },
    };
    const res = await channels(device(BEFORE));
    // Retry succeeds, reset cutoff applies, pre-reset device refused — M161's
    // resilience preserved by the fix, not broken.
    expect(res.status).toBe(401);
  });
});

describe("outage: the cutoff holds from remembered state", () => {
  it("refuses an untrusted device that predates the remembered cutoff", async () => {
    // One online request reads the families stamp and remembers it — even as
    // it refuses this pre-reset device, so the cutoff is left behind.
    expect((await channels(device(BEFORE))).status).toBe(401);

    // Now Supabase falls over. The installations read errors → offline branch.
    recorder.failure = { message: "supabase unreachable" };
    const res = await channels(device(BEFORE));
    // The remembered cutoff refuses it; it does not ride the grace window.
    expect(res.status).toBe(401);
  });

  it("keeps the trusted screen playing through the outage (M29)", async () => {
    world(true);
    // Warm the trusted screen (exempt from the cutoff, remembered as trusted).
    await channels(device(BEFORE));

    recorder.failure = { message: "supabase unreachable" };
    const res = await channels(device(BEFORE));
    // Not refused at the guard — her display rides the outage, as it must.
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(503);
  });

  it("her screen never pays the cutoff read — the real M29 protection (F65)", async () => {
    /*
      The offline branch's `!known.trusted` clause looks like what protects
      her display, but today it is unreachable: a trusted device skips the
      cutoff read, so its remembered cutoff is always null and the stale
      check is always false regardless of that clause. The actual protection
      — and the performance promise the online comment makes — is that a
      trusted device issues NO `families` select at all. Pinning THAT, rather
      than the redundant clause, is what keeps her screen safe the day the
      branches are unified or a feature populates the trusted cutoff: the
      clause becomes load-bearing then, and this test is what stops it being
      deleted as dead code in the meantime.
    */
    world(true);
    await channels(device(BEFORE));
    expect(recorder.forTable("families").filter((q) => q.op === "select")).toHaveLength(0);
  });

  it("lets a device newer than the cutoff ride the outage", async () => {
    // Warm with a device issued after the reset (passes, cutoff remembered).
    await channels(device(AFTER));

    recorder.failure = { message: "supabase unreachable" };
    const res = await channels(device(AFTER));
    // The boundary is a cutoff, not a block: a valid device keeps working.
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(503);
  });

  it("still 503s an unknown device — an outage is not a way in", async () => {
    // No warm request: this device was never verified.
    recorder.failure = { message: "supabase unreachable" };
    const res = await channels(device(AFTER));
    expect(res.status).toBe(503);
  });
});

/**
 * The management surface fails closed on its own cutoff read too (M171).
 *
 * The header promises "the two surfaces", but the tests above drive only
 * `requireDevice` (via /api/channels). `requireRole` — an admin working from a
 * device+profile pair — has the same `cutoff.readFailed` fail-closed line, and
 * nothing exercised it: deleting that 503 stayed green, so a families-read
 * outage would have waved a stale management token straight through. There is
 * no trusted-screen to spare here (her display never manages), so the whole
 * surface owes a 503, never an allow.
 */
describe("online: management fails closed when its own cutoff read errors", () => {
  const PROFILE_ADMIN = "aaaaaaaa-0000-0000-0000-0000000000ad";
  const profile = (issuedMs: number) =>
    `recall_profile=${jwt.sign(
      { personId: PROFILE_ADMIN, name: "Anne", role: "admin", archiveId: ARCHIVE_A, iat: Math.floor(issuedMs / 1000) },
      SECRET
    )}`;

  function manageWorld() {
    recorder.reset({
      installations: [{ id: INSTALL_A, archive_id: ARCHIVE_A, is_trusted: false, revoked_at: null }],
      families: [{ id: "fam-a", archive_id: ARCHIVE_A, password_set_at: RESET_AT, sessions_valid_from: null }],
      people: [
        { id: PROFILE_ADMIN, name: "Anne", role: "admin", status: "active", archived_at: null, archive_id: ARCHIVE_A },
      ],
      nfc_cards: [],
    });
  }

  it("503s a management request when the cutoff read errors — even a fresh profile", async () => {
    manageWorld();
    // The person read resolves; the families (cutoff) read is the one that
    // errors, so the guard cannot confirm the token is post-reset. A profile
    // NEWER than the reset is still refused — the outage decides nothing.
    recorder.failNext = { table: "families", op: "select", error: { message: "connection reset" } };
    const res = await request(app)
      .get("/api/nfc-cards")
      .set("Cookie", [device(AFTER), profile(AFTER)]);
    expect(res.status).toBe(503);
  });
});
