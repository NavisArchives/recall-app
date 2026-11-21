import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { recorder } from "./support/supabaseRecorder.js";

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => recorder.client,
}));

const { createApp } = await import("../app.js");
const { forgetVerifiedInstallations } = await import("../middleware/auth.js");
const { rememberMedia, forgetMedia } = await import("../services/mediaIndex.js");

const app = createApp();

/**
 * What the display may fall back to when Supabase cannot be reached.
 *
 * The online path checks the archive in the database. The offline path cannot
 * — that is the whole point of it — so the archive has to be recorded in the
 * index at the time the file was first served. Without it a family's
 * photograph can be fetched by any device that knows its id, and only during
 * an outage, when nobody is watching.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";

const ARCHIVE_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const ARCHIVE_B = "bbbbbbbb-0000-0000-0000-00000000000b";
// A distinct id per case, so the index needs no resetting between them.
const MEDIA_OF_B = "bbbbbbbb-1111-1111-1111-111111111111";
const MEDIA_OF_A = "aaaaaaaa-1111-1111-1111-111111111111";
const MEDIA_DELETED = "aaaaaaaa-2222-2222-2222-222222222222";

function deviceOf(archiveId: string) {
  const token = jwt.sign(
    { installationId: "11111111-1111-1111-1111-111111111111", archiveId },
    SECRET,
    { expiresIn: 3600 }
  );
  return `recall_device=${token}`;
}

/**
 * The outage door only opens for a device this process has already verified
 * (the last-known-good rule): an unverified cookie gets 503, not a fallback.
 * The display polls constantly, so in life its entry is always warm — here
 * the warmth is arranged by one successful request before the plug is pulled.
 */
async function warmDevice() {
  recorder.reset({
    installations: [
      {
        id: "11111111-1111-1111-1111-111111111111",
        archive_id: ARCHIVE_A,
        revoked_at: null,
        is_trusted: true,
      },
    ],
    people: [],
  });
  const res = await request(app).get("/api/people").set("Cookie", deviceOf(ARCHIVE_A));
  expect(res.status).toBe(200);
}

describe("the offline fallback keeps families apart", () => {
  beforeEach(() => {
    recorder.reset({});
    forgetVerifiedInstallations();
  });

  it("refuses another archive's media during an outage", async () => {
    await rememberMedia(MEDIA_OF_B, "channel-media", "b/secret.jpg", ARCHIVE_B);
    await warmDevice();
    recorder.failure = { message: "connection refused" };

    const res = await request(app)
      .get(`/api/media/${MEDIA_OF_B}/file`)
      .set("Cookie", deviceOf(ARCHIVE_A));

    expect(res.status).toBe(404);
  });

  it("still serves the device's own media during an outage", async () => {
    await rememberMedia(MEDIA_OF_A, "channel-media", "a/holiday.jpg", ARCHIVE_A);
    await warmDevice();
    recorder.failure = { message: "connection refused" };

    const res = await request(app)
      .get(`/api/media/${MEDIA_OF_A}/file`)
      .set("Cookie", deviceOf(ARCHIVE_A));

    // The bytes are not on this disk, so 503 — but the id resolved, which is
    // what the fallback is for. A 404 here would mean offline mode is broken.
    expect(res.status).toBe(503);
  });

  it("never serves a file that has been deleted", async () => {
    await rememberMedia(MEDIA_DELETED, "channel-media", "a/gone.jpg", ARCHIVE_A);
    await forgetMedia(MEDIA_DELETED);
    await warmDevice();
    recorder.failure = { message: "connection refused" };

    const res = await request(app)
      .get(`/api/media/${MEDIA_DELETED}/file`)
      .set("Cookie", deviceOf(ARCHIVE_A));

    expect(res.status).toBe(404);
  });
});

/**
 * The subject's own portrait gets the same outage fallback (M173).
 *
 * Her face lives on `settings`, not a row with an id, so M165 first served it
 * through a bare read that had no local fallback — on the one screen the
 * fallback exists for, her face would blank the moment Supabase blinked. It is
 * cached under a namespaced `subject:<archive>` key now and reads back the same
 * way channel media does, and must keep every wall channel media keeps: another
 * family's face during an outage, and her own after it is removed, stay out.
 */
describe("the subject photo falls back like any other face", () => {
  beforeEach(async () => {
    recorder.reset({});
    forgetVerifiedInstallations();
    // The media index outlives recorder.reset; these keys recur across the
    // cases below, so clear them or one test's warm cache warms the next.
    await forgetMedia(`subject:${ARCHIVE_A}`);
    await forgetMedia(`subject:${ARCHIVE_B}`);
  });

  it("still serves her own portrait during an outage", async () => {
    await rememberMedia(`subject:${ARCHIVE_A}`, "profile-pictures", "a/margaret.jpg", ARCHIVE_A);
    await warmDevice();
    recorder.failure = { message: "connection refused" };

    const res = await request(app)
      .get("/api/media/subject/photo")
      .set("Cookie", deviceOf(ARCHIVE_A));

    // 503, not 404: the path resolved from the index — the bytes just are not
    // on this disk. A 404 would mean the settings-row fallback never ran.
    expect(res.status).toBe(503);
  });

  it("refuses another archive's subject photo during an outage", async () => {
    await rememberMedia(`subject:${ARCHIVE_B}`, "profile-pictures", "b/face.jpg", ARCHIVE_B);
    await warmDevice();
    recorder.failure = { message: "connection refused" };

    const res = await request(app)
      .get("/api/media/subject/photo")
      .set("Cookie", deviceOf(ARCHIVE_A));

    // The device is archive A; only B's face is cached. Namespaced by archive,
    // so A computes `subject:A`, finds nothing, and serves nothing.
    expect(res.status).toBe(404);
  });

  it("never serves her portrait once the settings row no longer names it", async () => {
    // Cache warm, but the database is reachable and the photo is gone: a
    // deletion, not an outage. The reachable-empty read must refuse before it
    // ever consults the index — the same wall `resolve()` keeps.
    await rememberMedia(`subject:${ARCHIVE_A}`, "profile-pictures", "a/margaret.jpg", ARCHIVE_A);
    await warmDevice();
    recorder.reset({
      installations: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          archive_id: ARCHIVE_A,
          revoked_at: null,
          is_trusted: false,
        },
      ],
      settings: [{ archive_id: ARCHIVE_A, photo_path: null }],
    });

    const res = await request(app)
      .get("/api/media/subject/photo")
      .set("Cookie", deviceOf(ARCHIVE_A));

    expect(res.status).toBe(404);
  });
});
