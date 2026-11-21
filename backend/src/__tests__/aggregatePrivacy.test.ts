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
 * Channel privacy holds on every aggregate read (review 29 Sep, access-1).
 *
 * The per-channel routes always asked `readableChannelIds`; the dashboards
 * never did. Streams, Insights, the activity log, the archive check, the
 * mission board and the card registry each joined a channel's title — or a
 * photo's caption, or a sentence naming the channel — into what every
 * co-author was served. So a channel an admin marked private announced its
 * title to exactly the helpers it was hidden from.
 *
 * The world below has one public channel, one private channel (privacy 1)
 * and one selected channel (privacy 2) that this co-author was not granted.
 * The recorder answers every select with the whole fixture, embeds and all,
 * so any row that is not filtered carries its secret straight into the JSON.
 * Each endpoint is then read as that co-author, and nothing about either
 * hidden channel may come back — while the admin still sees all of it.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";
const ARCHIVE = "aaaaaaaa-0000-0000-0000-00000000000a";
const INSTALL = "aaaaaaaa-0000-0000-0000-0000000000f1";
const ADMIN = "aaaaaaaa-0000-0000-0000-0000000000ad";
const HELPER = "aaaaaaaa-0000-0000-0000-0000000000c0";

const PUBLIC = "aaaaaaaa-0000-0000-0000-00000000ch01";
const PRIVATE = "aaaaaaaa-0000-0000-0000-00000000ch07";
const SELECTED = "aaaaaaaa-0000-0000-0000-00000000ch08";

/**
 * Words that exist only inside the hidden channels — including Channel 09,
 * "Old debts", a private channel since permanently deleted, whose history
 * and missions lost their pointer to it (`on delete set null`), and Channel
 * 07's title before it was renamed.
 */
const HIDDEN = ["Hospital letters", "Diagnosis day", "Money matters", "Old debts", "Bank letters", PRIVATE, SELECTED];

function cookiesFor(personId: string, role: string) {
  return [
    `recall_device=${jwt.sign({ installationId: INSTALL, archiveId: ARCHIVE }, SECRET, { expiresIn: 3600 })}`,
    `recall_profile=${jwt.sign({ personId, name: "Someone", role, archiveId: ARCHIVE }, SECRET, { expiresIn: 3600 })}`,
  ];
}

function todayEarly() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return new Date(start.getTime() + 60_000).toISOString();
}

const channelEmbed = {
  [PUBLIC]: { id: PUBLIC, number: 1, title: "The wedding" },
  [PRIVATE]: { id: PRIVATE, number: 7, title: "Hospital letters" },
  [SELECTED]: { id: SELECTED, number: 8, title: "Money matters" },
};

/** The caller first: requireRole's reload answers with the first person. */
function world(caller: { id: string; role: string }) {
  const helper = { id: HELPER, name: "Lucie", role: "co_author", status: "active", archived_at: null, archive_id: ARCHIVE, relationship: "Granddaughter", joined_at: null };
  const admin = { id: ADMIN, name: "Claire", role: "admin", status: "active", archived_at: null, archive_id: ARCHIVE, relationship: "Daughter", joined_at: null };
  recorder.reset({
    people: caller.id === ADMIN ? [admin, helper] : [helper, admin],
    installations: [{ id: INSTALL, archive_id: ARCHIVE, is_trusted: false, revoked_at: null }],
    archives: [{ id: ARCHIVE, created_at: "2026-01-15T00:00:00.000Z" }],
    settings: [{ archive_id: ARCHIVE, display_name: "Margaret", current_channel_number: null, screen_synced_at: null }],
    channels: [
      { ...channelEmbed[PUBLIC], archive_id: ARCHIVE, privacy_level: 3, created_by: ADMIN, author_id: ADMIN, content_type: "album", description: "Our day", created_at: "2026-02-01T00:00:00.000Z", archived_at: null },
      { ...channelEmbed[PRIVATE], archive_id: ARCHIVE, privacy_level: 1, created_by: ADMIN, author_id: ADMIN, content_type: "album", description: "Letters", created_at: "2026-02-02T00:00:00.000Z", archived_at: null },
      { ...channelEmbed[SELECTED], archive_id: ARCHIVE, privacy_level: 2, created_by: ADMIN, author_id: ADMIN, content_type: "album", description: "Accounts", created_at: "2026-02-03T00:00:00.000Z", archived_at: null },
    ],
    // Nobody granted the helper the selected channel.
    channel_access: [],
    media_files: [
      { id: "m1", channel_id: PUBLIC, archive_id: ARCHIVE, file_type: "image", caption: "The church", created_at: new Date().toISOString(), display_order: 0, archived_at: null, created_by: ADMIN },
      { id: "m2", channel_id: PRIVATE, archive_id: ARCHIVE, file_type: "image", caption: "Diagnosis day", created_at: new Date().toISOString(), display_order: 0, archived_at: null, created_by: ADMIN },
    ],
    channel_visits: [
      // The longest sit today is in the private channel.
      { id: "v1", archive_id: ARCHIVE, channel_id: PRIVATE, channel_number: 7, started_at: todayEarly(), ended_at: todayEarly(), duration_seconds: 1200, entry_method: "keyboard" },
      { id: "v2", archive_id: ARCHIVE, channel_id: PUBLIC, channel_number: 1, started_at: todayEarly(), ended_at: todayEarly(), duration_seconds: 300, entry_method: "keyboard" },
    ],
    device_sessions: [{ id: "s1", archive_id: ARCHIVE, started_at: todayEarly(), ended_at: todayEarly(), duration_seconds: 3600 }],
    nfc_cards: [
      { id: "card1", archive_id: ARCHIVE, label: "Letters card", channel_id: PRIVATE, archived_at: null, channel: channelEmbed[PRIVATE], photo: { id: "m2", channel_id: PRIVATE, storage_path: "x/m2.jpg", caption: "Diagnosis day" } },
      // A public card whose front photograph was taken from the private channel.
      { id: "card2", archive_id: ARCHIVE, label: "Wedding card", channel_id: PUBLIC, archived_at: null, channel: channelEmbed[PUBLIC], photo: { id: "m2", channel_id: PRIVATE, storage_path: "x/m2.jpg", caption: "Diagnosis day" } },
    ],
    missions: [
      { id: "mi1", archive_id: ARCHIVE, title: "Add more photos to Channel 07 — Hospital letters", status: "suggested", channel_id: PRIVATE, created_at: new Date().toISOString(), archived_at: null, channel: channelEmbed[PRIVATE], assignee: null },
      { id: "mi2", archive_id: ARCHIVE, title: "Describe the wedding photos", status: "in_progress", channel_id: PUBLIC, created_at: new Date().toISOString(), archived_at: null, channel: channelEmbed[PUBLIC], assignee: null },
      // Recall's own mission about the purged Channel 09: its pointer is gone.
      { id: "mi3", archive_id: ARCHIVE, origin: "recall", title: "Add more photos to Channel 09 — Old debts", status: "completed", channel_id: null, created_at: new Date().toISOString(), archived_at: null, channel: null, assignee: null },
      // A family's own mission about no channel at all stays visible.
      { id: "mi4", archive_id: ARCHIVE, origin: "human", title: "Buy frames for the hallway", status: "suggested", channel_id: null, created_at: new Date().toISOString(), archived_at: null, channel: null, assignee: null },
    ],
    suggestions: [
      { id: "g1", archive_id: ARCHIVE, channel_id: PRIVATE, rule_key: "missing_description", message: "Channel 07 — Hospital letters has no description.", severity: "info", resolved: false, created_at: new Date().toISOString(), channel: channelEmbed[PRIVATE] },
      { id: "g2", archive_id: ARCHIVE, channel_id: SELECTED, rule_key: "empty_channel", message: "Channel 08 — Money matters has no content yet.", severity: "warning", resolved: false, created_at: new Date().toISOString(), channel: channelEmbed[SELECTED] },
      { id: "g3", archive_id: ARCHIVE, channel_id: PUBLIC, rule_key: "min_photos", message: "Channel 01 — The wedding has 1 photo.", severity: "info", resolved: false, created_at: new Date().toISOString(), channel: channelEmbed[PUBLIC] },
    ],
    activity_log: [
      { id: "a1", archive_id: ARCHIVE, action_type: "channel_created", description: "Claire created Channel 07 — Hospital letters", target_channel_id: PRIVATE, created_at: new Date().toISOString(), author: null },
      // Purged: the row is gone, so the line points at nothing.
      { id: "a2", archive_id: ARCHIVE, action_type: "channel_purged", description: "Claire permanently deleted Channel 09 — Old debts", target_channel_id: null, created_at: new Date().toISOString(), author: null },
      // Written before completed missions pointed at their channel.
      { id: "a3", archive_id: ARCHIVE, action_type: "mission_completed", description: 'Claire completed "Add more photos to Channel 08 — Money matters"', target_channel_id: null, created_at: new Date().toISOString(), author: null },
      { id: "a4", archive_id: ARCHIVE, action_type: "channel_edited", description: "Claire edited Channel 01 — The wedding", target_channel_id: PUBLIC, created_at: new Date().toISOString(), author: null },
      // The purged private Channel 09's earlier history: every pointer was
      // set to null when its row was deleted.
      { id: "a5", archive_id: ARCHIVE, action_type: "channel_created", description: "Claire created Channel 09 — Old debts", target_channel_id: null, created_at: new Date().toISOString(), author: null },
      { id: "a6", archive_id: ARCHIVE, action_type: "channel_deleted", description: "Claire moved Channel 09 — Old debts to deleted", target_channel_id: null, created_at: new Date().toISOString(), author: null },
      { id: "a7", archive_id: ARCHIVE, action_type: "mission_completed", description: 'Claire completed "Add more photos to Channel 09 — Old debts"', target_channel_id: null, created_at: new Date().toISOString(), author: null },
      // An old line naming Channel 07 by the title it had before a rename.
      { id: "a8", archive_id: ARCHIVE, action_type: "mission_completed", description: 'Claire completed "Add more photos to Channel 07 — Bank letters"', target_channel_id: null, created_at: new Date().toISOString(), author: null },
      // An old line naming the public channel, with no pointer: still shown.
      { id: "a9", archive_id: ARCHIVE, action_type: "mission_completed", description: 'Claire completed "Describe Channel 01 — The wedding"', target_channel_id: null, created_at: new Date().toISOString(), author: null },
      // A line about no channel at all.
      { id: "a10", archive_id: ARCHIVE, action_type: "contributor_added", description: "Claire invited Lucie", target_channel_id: null, created_at: new Date().toISOString(), author: null },
    ],
  });
}

const ENDPOINTS = [
  "/api/streams/content",
  "/api/streams/engagement?range=today",
  "/api/streams/nfc",
  "/api/streams/missions",
  "/api/streams/activity",
  "/api/streams/people",
  "/api/insights?range=today",
  "/api/activity",
  "/api/suggestions",
  "/api/missions",
  "/api/nfc-cards",
];

describe("an ungranted co-author reads nothing about a hidden channel", () => {
  beforeEach(() => world({ id: HELPER, role: "co_author" }));

  for (const path of ENDPOINTS) {
    it(`GET ${path}`, async () => {
      const res = await request(app).get(path).set("Cookie", cookiesFor(HELPER, "co_author"));
      expect(res.status).toBe(200);
      const text = JSON.stringify(res.body);
      for (const secret of HIDDEN) expect(text).not.toContain(secret);
    });
  }

  it("still sees the public channel wherever it appears", async () => {
    const shelf = await request(app).get("/api/streams/content").set("Cookie", cookiesFor(HELPER, "co_author"));
    expect(shelf.body.shelf.map((c: { id: string }) => c.id)).toEqual([PUBLIC]);
    expect(shelf.body.photos).toBe(1);

    const log = await request(app).get("/api/activity").set("Cookie", cookiesFor(HELPER, "co_author"));
    expect(log.body.map((e: { id: string }) => e.id)).toEqual(["a4", "a9", "a10"]);

    const board = await request(app).get("/api/missions").set("Cookie", cookiesFor(HELPER, "co_author"));
    expect(board.body.map((m: { id: string }) => m.id)).toEqual(["mi2", "mi4"]);
    const stream = await request(app).get("/api/streams/missions").set("Cookie", cookiesFor(HELPER, "co_author"));
    expect(stream.body.list.map((m: { id: string }) => m.id)).toEqual(["mi2", "mi4"]);
    const feed = await request(app).get("/api/streams/activity").set("Cookie", cookiesFor(HELPER, "co_author"));
    expect(feed.body.events.map((e: { id: string }) => e.id)).toEqual(["a4", "a9", "a10"]);

    const check = await request(app).get("/api/suggestions").set("Cookie", cookiesFor(HELPER, "co_author"));
    expect(check.body.items.map((s: { id: string }) => s.id)).toEqual(["g3"]);
  });

  it("keeps her screen time whole but does not name where the longest sit was", async () => {
    const res = await request(app)
      .get("/api/streams/engagement?range=today")
      .set("Cookie", cookiesFor(HELPER, "co_author"));
    expect(res.body.watched_today.seconds).toBe(1500);
    expect(res.body.longest_sit).toMatchObject({ seconds: 1200, channel_id: null, channel_title: null });
    expect(res.body.per_channel.map((c: { id: string }) => c.id)).toEqual([PUBLIC]);
  });

  it("keeps a public card but not a photograph taken from a hidden channel", async () => {
    const res = await request(app).get("/api/nfc-cards").set("Cookie", cookiesFor(HELPER, "co_author"));
    expect(res.body.map((c: { id: string }) => c.id)).toEqual(["card2"]);
    expect(res.body[0].photo).toBeNull();
  });

  it("cannot point a new mission or card at a hidden channel", async () => {
    const cookie = cookiesFor(HELPER, "co_author");
    // The existence check finds the channel: it is this family's, just not theirs.
    recorder.opResponses["channels:select:id"] = [{ id: PRIVATE }];
    const mission = await request(app).post("/api/missions").set("Cookie", cookie).send({ title: "Look", channel_id: PRIVATE });
    expect(mission.status).toBe(404);
    const card = await request(app).post("/api/nfc-cards").set("Cookie", cookie).send({ label: "Tag", channel_id: PRIVATE });
    expect(card.status).toBe(404);
    const inserts = [...recorder.forTable("missions"), ...recorder.forTable("nfc_cards")].filter((q) => q.op === "insert");
    expect(inserts).toHaveLength(0);
  });

  it("cannot move a mission on a hidden channel it was never shown", async () => {
    recorder.opResponses["missions:select:id, channel_id"] = [{ id: "mi1", channel_id: PRIVATE }];
    const res = await request(app)
      .patch("/api/missions/mi1")
      .set("Cookie", cookiesFor(HELPER, "co_author"))
      .send({ status: "completed" });
    expect(res.status).toBe(404);
    expect(recorder.forTable("missions").filter((q) => q.op === "update")).toHaveLength(0);
  });
});

describe("an admin still reads the whole archive", () => {
  beforeEach(() => world({ id: ADMIN, role: "admin" }));

  it("sees every channel on the shelf, in the log and in the check", async () => {
    const cookie = cookiesFor(ADMIN, "admin");
    const shelf = await request(app).get("/api/streams/content").set("Cookie", cookie);
    expect(shelf.body.shelf).toHaveLength(3);

    const log = await request(app).get("/api/activity").set("Cookie", cookie);
    expect(log.body).toHaveLength(10);
    expect(JSON.stringify(log.body)).toContain("Old debts");

    const board = await request(app).get("/api/missions").set("Cookie", cookie);
    expect(board.body).toHaveLength(4);

    const check = await request(app).get("/api/suggestions").set("Cookie", cookie);
    expect(JSON.stringify(check.body)).toContain("Hospital letters");

    const engagement = await request(app).get("/api/streams/engagement?range=today").set("Cookie", cookie);
    expect(engagement.body.longest_sit.channel_title).toBe("Hospital letters");

    const cards = await request(app).get("/api/nfc-cards").set("Cookie", cookie);
    expect(cards.body).toHaveLength(2);
    expect(cards.body[1].photo).toMatchObject({ id: "m2", caption: "Diagnosis day" });
    // The storage path still never leaves the backend.
    expect(JSON.stringify(cards.body)).not.toContain("x/m2.jpg");
  });

  it("does not pay a channel read to find out it may see everything", async () => {
    await request(app).get("/api/activity").set("Cookie", cookiesFor(ADMIN, "admin"));
    expect(recorder.forTable("channels")).toHaveLength(0);
    expect(recorder.forTable("channel_access")).toHaveLength(0);
  });
});

describe("a failed privacy read fails closed", () => {
  it("answers 500 rather than an unfiltered log", async () => {
    world({ id: HELPER, role: "co_author" });
    recorder.failNext = { table: "channels", op: "select", error: { message: "boom" } };
    const res = await request(app).get("/api/activity").set("Cookie", cookiesFor(HELPER, "co_author"));
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("Hospital letters");
  });
});
