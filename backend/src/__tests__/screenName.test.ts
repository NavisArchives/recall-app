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
 * M146 — the pre-auth pill names the real screen.
 *
 * The chooser's pill said "The family screen" because nothing exposed the
 * installation's own name before a profile was chosen, and the mockup's
 * "Living-room display" was a name to be earned, not typed in. The row has
 * always carried a name; this is the field reaching the pill.
 *
 * The discipline that matters is what does *not* come with it: this payload
 * is read before anybody has said who they are, so it may carry the
 * display's own label and nothing else. The installation's `username` is
 * its internal credential identity (M111) and must never appear here.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";
const ARCHIVE_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const INSTALL_A = "aaaaaaaa-0000-0000-0000-0000000000f1";

const device = `recall_device=${jwt.sign(
  { installationId: INSTALL_A, archiveId: ARCHIVE_A },
  SECRET,
  { expiresIn: 3600 }
)}`;

function world(installation: Record<string, unknown> | null) {
  recorder.reset({
    installations: installation ? [installation] : [],
    settings: [
      {
        archive_id: ARCHIVE_A,
        current_channel_number: 6,
        screen_synced_at: new Date().toISOString(),
      },
    ],
    channel_visits: [],
  });
}

const TRUSTED = {
  id: INSTALL_A,
  archive_id: ARCHIVE_A,
  name: "Living-room display",
  is_trusted: true,
  revoked_at: null,
  // Present on the row, and never allowed out of this door.
  username: "web-3f9c22d1",
  secret_hash: "$argon2id$v=19$m=65536,t=3,p=4$aaaa$bbbb",
};

beforeEach(() => world(TRUSTED));

describe("the screen-state payload names the display", () => {
  it("carries the installation's real name", async () => {
    const res = await request(app).get("/api/screen-state").set("Cookie", device);

    expect(res.status).toBe(200);
    expect(res.body.display_name).toBe("Living-room display");
    // The fact the pill already drew still works.
    expect(res.body.current_channel_number).toBe(6);
  });

  it("never lets the internal identity out with it", async () => {
    const res = await request(app).get("/api/screen-state").set("Cookie", device);

    const text = JSON.stringify(res.body);
    expect(text).not.toContain("web-3f9c22d1");
    expect(text).not.toContain("argon2");
    // The allow-list, extended deliberately for 040: `live` and the photo
    // position are display facts. The installation's username and secret
    // remain the things this test exists to keep in.
    expect(Object.keys(res.body).sort()).toEqual(
      [
        "current_channel_number",
        "display_name",
        "last_channel_number",
        "last_seen_at",
        "live",
        "photo_count",
        "photo_index",
        "screen_synced_at",
      ].sort()
    );
  });

  it("says null when the screen genuinely has no name, rather than inventing one", async () => {
    world({ ...TRUSTED, name: null });
    const res = await request(app).get("/api/screen-state").set("Cookie", device);

    expect(res.body.display_name).toBe(null);
  });

  it("says null when the family has no trusted screen at all", async () => {
    world({ ...TRUSTED, is_trusted: false });
    const res = await request(app).get("/api/screen-state").set("Cookie", device);

    expect(res.body.display_name).toBe(null);
  });
});
