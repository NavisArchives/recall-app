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
 * 040 — the display reports which photograph it is on.
 *
 * "NOW SHOWING · PHOTO 4 OF 9" was a registered placeholder: screen state
 * recorded the channel, never the position. These tests pin the two halves
 * of making it real — the display's report is validated as a coherent pair,
 * and the workspace reads the position only while the screen is live.
 *
 * The refusals matter as much as the acceptance. A report with an index and
 * no count, or an index past the end, is a malformed instrument reading;
 * stored, it would surface as a confident wrong number on the Overview.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";
const ARCHIVE_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const INSTALL_A = "aaaaaaaa-0000-0000-0000-0000000000f1";

const device = `recall_device=${jwt.sign(
  { installationId: INSTALL_A, archiveId: ARCHIVE_A },
  SECRET,
  { expiresIn: 3600 }
)}`;

function world(settings: Record<string, unknown>) {
  recorder.reset({
    installations: [
      {
        id: INSTALL_A,
        archive_id: ARCHIVE_A,
        name: "Living-room display",
        is_trusted: true,
        revoked_at: null,
      },
    ],
    settings: [{ archive_id: ARCHIVE_A, ...settings }],
    channel_visits: [],
  });
}

beforeEach(() =>
  world({
    current_channel_number: 6,
    current_photo_index: null,
    current_photo_count: null,
    screen_synced_at: new Date().toISOString(),
  })
);

describe("the display reports its photo position", () => {
  it("stores a coherent pair alongside the channel", async () => {
    const res = await request(app)
      .post("/api/screen-state")
      .set("Cookie", device)
      .send({ number: 6, photo_index: 3, photo_count: 9 });
    expect(res.status).toBe(204);

    // The recorder stores queries, not state: assert on what was written.
    const update = recorder.forTable("settings").find((q) => q.op === "update");
    expect(update?.payload).toMatchObject({
      current_channel_number: 6,
      current_photo_index: 3,
      current_photo_count: 9,
    });
  });

  it("a channel-only report clears the position rather than leaving it stale", async () => {
    world({
      current_channel_number: 6,
      current_photo_index: 3,
      current_photo_count: 9,
      screen_synced_at: new Date().toISOString(),
    });
    const res = await request(app)
      .post("/api/screen-state")
      .set("Cookie", device)
      .send({ number: 7 });
    expect(res.status).toBe(204);
    const update = recorder.forTable("settings").find((q) => q.op === "update");
    expect(update?.payload).toMatchObject({
      current_channel_number: 7,
      current_photo_index: null,
      current_photo_count: null,
    });
  });

  it("refuses an index without a count, and one past the end", async () => {
    const lone = await request(app)
      .post("/api/screen-state")
      .set("Cookie", device)
      .send({ number: 6, photo_index: 3 });
    expect(lone.status).toBe(400);

    const past = await request(app)
      .post("/api/screen-state")
      .set("Cookie", device)
      .send({ number: 6, photo_index: 9, photo_count: 9 });
    expect(past.status).toBe(400);

    const fractional = await request(app)
      .post("/api/screen-state")
      .set("Cookie", device)
      .send({ number: 6, photo_index: 1.5, photo_count: 9 });
    expect(fractional.status).toBe(400);

    // None of the refusals wrote anything.
    expect(recorder.forTable("settings").filter((q) => q.op === "update")).toHaveLength(0);
  });
});

describe("the workspace reads the position", () => {
  it("serves photo_index and photo_count while live", async () => {
    world({
      current_channel_number: 6,
      current_photo_index: 3,
      current_photo_count: 9,
      screen_synced_at: new Date().toISOString(),
    });
    const res = await request(app).get("/api/screen-state").set("Cookie", device);
    expect(res.status).toBe(200);
    expect(res.body.live).toBe(true);
    expect(res.body.photo_index).toBe(3);
    expect(res.body.photo_count).toBe(9);
  });

  it("a dark screen has no position, whatever the row still holds", async () => {
    world({
      current_channel_number: 6,
      current_photo_index: 3,
      current_photo_count: 9,
      // Long past SCREEN_LIVE_MS — the screen is not live.
      screen_synced_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    const res = await request(app).get("/api/screen-state").set("Cookie", device);
    expect(res.status).toBe(200);
    expect(res.body.live).toBe(false);
    expect(res.body.photo_index).toBeNull();
    expect(res.body.photo_count).toBeNull();
  });
});
