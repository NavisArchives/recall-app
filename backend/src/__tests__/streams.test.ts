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
 * M103 — the upgraded backend's clean data streams.
 *
 * One fact, one source: each stream is an archive-scoped service function
 * with a stable, documented shape, and every consumer — the future
 * dashboard, Insights, the ask bar — reads the same function. These tests
 * hold the shapes, the arithmetic, and the honesty rules: a fact the data
 * cannot support comes back explicitly null, never invented.
 *
 * The recorder answers every select with the whole fixture row regardless
 * of the column list, which makes it a leak detector for free: a stream
 * that spreads rows instead of naming fields would carry the fixture's
 * contact details into its output, and the assertions below would catch it.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";
const ARCHIVE_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const INSTALL_A = "aaaaaaaa-0000-0000-0000-0000000000f1";
const ADMIN_A = "aaaaaaaa-0000-0000-0000-0000000000ad";
const SUBJECT_A = "aaaaaaaa-0000-0000-0000-0000000000c1";
const CH_GARDEN = "aaaaaaaa-0000-0000-0000-00000000ch03";
const CH_WEDDING = "aaaaaaaa-0000-0000-0000-00000000ch01";

function cookies() {
  const device = jwt.sign({ installationId: INSTALL_A, archiveId: ARCHIVE_A }, SECRET, {
    expiresIn: 3600,
  });
  const profile = jwt.sign(
    { personId: ADMIN_A, name: "Claire", role: "admin", archiveId: ARCHIVE_A },
    SECRET,
    { expiresIn: 3600 }
  );
  return [`recall_device=${device}`, `recall_profile=${profile}`];
}

const now = Date.now();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
function iso(msAgo: number) {
  return new Date(now - msAgo).toISOString();
}
/** Early on the server's own calendar day, however the clock reads. */
function todayEarly() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  // A visit one minute after local midnight is unambiguously "today".
  return new Date(start.getTime() + 60_000).toISOString();
}

/**
 * The tree family in miniature: enough rows that every stream has real
 * arithmetic to get right, small enough to verify by hand.
 */
function world(over: Record<string, Record<string, unknown>[]> = {}) {
  recorder.reset({
    installations: [
      {
        id: INSTALL_A,
        archive_id: ARCHIVE_A,
        revoked_at: null,
        is_trusted: true,
        last_used_at: iso(2 * HOUR),
      },
    ],
    archives: [{ id: ARCHIVE_A, created_at: "2026-01-15T00:00:00.000Z" }],
    settings: [
      {
        archive_id: ARCHIVE_A,
        display_name: "Margaret",
        full_name: "Margaret Fournier",
        birth_date: "1942-03-01",
        residence: "Brussels",
        note: null,
        photo_path: null,
        current_channel_number: 3,
        screen_synced_at: iso(60_000), // a minute ago: the screen is live
      },
    ],
    people: [
      // The caller first: the recorder answers `requireRole`'s session
      // reload with the first row, whatever the filters said.
      {
        id: ADMIN_A,
        name: "Claire",
        relationship: "Daughter",
        description: "Keeps the archive",
        birthday: null,
        role: "admin",
        status: "active",
        joined_at: "2026-01-15T00:00:00.000Z",
        archived_at: null,
        archive_id: ARCHIVE_A,
        // Present in the row, must never surface in a stream.
        email: "claire@example.invalid",
        contact_number: "+3222222222",
        profile_picture_path: null,
      },
      {
        id: SUBJECT_A,
        name: "Margaret",
        relationship: null,
        description: null,
        birthday: "1942-03-01",
        role: "user",
        status: "active",
        joined_at: null,
        archived_at: null,
        archive_id: ARCHIVE_A,
        email: "margaret@example.invalid",
        contact_number: "+3211111111",
        profile_picture_path: null,
      },
    ],
    channels: [
      {
        id: CH_WEDDING,
        number: 1,
        title: "The wedding",
        content_type: "album",
        author_id: ADMIN_A,
        created_by: ADMIN_A,
        created_at: "2026-02-01T00:00:00.000Z",
        archived_at: null,
        archive_id: ARCHIVE_A,
      },
      {
        id: CH_GARDEN,
        number: 3,
        title: "The garden",
        content_type: "album",
        author_id: ADMIN_A,
        created_by: ADMIN_A,
        created_at: "2026-03-01T00:00:00.000Z",
        archived_at: null,
        archive_id: ARCHIVE_A,
      },
    ],
    media_files: [
      // Three photographs, two captioned; one video, whose caption must not
      // count toward the described percentage of photographs.
      { id: "m1", channel_id: CH_WEDDING, archive_id: ARCHIVE_A, file_type: "image", caption: "The church", created_at: iso(2 * DAY), display_order: 0, archived_at: null },
      { id: "m2", channel_id: CH_WEDDING, archive_id: ARCHIVE_A, file_type: "image", caption: null, created_at: iso(3 * DAY), display_order: 1, archived_at: null },
      { id: "m3", channel_id: CH_GARDEN, archive_id: ARCHIVE_A, file_type: "image", caption: "Roses in June", created_at: iso(40 * DAY), display_order: 0, archived_at: null },
      { id: "m4", channel_id: CH_GARDEN, archive_id: ARCHIVE_A, file_type: "video", caption: "A pan of the lawn", created_at: iso(40 * DAY), display_order: 1, archived_at: null },
    ],
    channel_visits: [
      // Today: 10 minutes on the garden, 20 minutes on the wedding.
      { id: "v1", archive_id: ARCHIVE_A, channel_id: CH_GARDEN, channel_number: 3, started_at: todayEarly(), ended_at: todayEarly(), duration_seconds: 600, entry_method: "keyboard" },
      { id: "v2", archive_id: ARCHIVE_A, channel_id: CH_WEDDING, channel_number: 1, started_at: todayEarly(), ended_at: todayEarly(), duration_seconds: 1200, entry_method: "overview" },
      // Two days ago, outside "today" but inside the week and month.
      { id: "v3", archive_id: ARCHIVE_A, channel_id: CH_GARDEN, channel_number: 3, started_at: iso(2 * DAY), ended_at: iso(2 * DAY), duration_seconds: 300, entry_method: "keyboard" },
      // Twenty days ago: only the month window sees it (M115 strand 3).
      { id: "v4", archive_id: ARCHIVE_A, channel_id: CH_WEDDING, channel_number: 1, started_at: iso(20 * DAY), ended_at: iso(20 * DAY), duration_seconds: 500, entry_method: "keyboard" },
    ],
    device_sessions: [
      // Unambiguously today, so the "today" window is deterministic whatever
      // the clock reads when the suite runs.
      { id: "s1", archive_id: ARCHIVE_A, started_at: todayEarly(), ended_at: todayEarly(), duration_seconds: 3600 },
      // Twenty days ago: only the month window sees it.
      { id: "s2", archive_id: ARCHIVE_A, started_at: iso(20 * DAY), ended_at: iso(20 * DAY), duration_seconds: 1000 },
    ],
    nfc_cards: [
      { id: "card1", archive_id: ARCHIVE_A, label: "The wedding card", channel_id: CH_WEDDING, archived_at: null },
      { id: "card2", archive_id: ARCHIVE_A, label: "Spare card", channel_id: null, archived_at: null },
    ],
    missions: [
      { id: "mi1", archive_id: ARCHIVE_A, title: "Describe the wedding photos", status: "completed", channel_id: CH_WEDDING, assigned_to: ADMIN_A, created_at: iso(5 * DAY), archived_at: null },
      { id: "mi2", archive_id: ARCHIVE_A, title: "Link the garden card", status: "in_progress", channel_id: CH_GARDEN, assigned_to: ADMIN_A, created_at: iso(4 * DAY), archived_at: null },
      { id: "mi3", archive_id: ARCHIVE_A, title: "Add spring photos", status: "suggested", channel_id: null, assigned_to: null, created_at: iso(3 * DAY), archived_at: null },
    ],
    activity_log: [
      { id: "a1", archive_id: ARCHIVE_A, action_type: "channel_created", description: "Claire created The garden", target_channel_id: CH_GARDEN, created_at: iso(DAY) },
    ],
    ...over,
  });
}

function get(path: string) {
  return request(app).get(path).set("Cookie", cookies());
}

beforeEach(() => world());

// ─────────────────────────────────────────────────────────────── subject

describe("the subject stream", () => {
  it("names the subject, the archive's age, and what is on screen now", async () => {
    const res = await get("/api/streams/subject");

    expect(res.status).toBe(200);
    expect(res.body.subject).toMatchObject({
      display_name: "Margaret",
      full_name: "Margaret Fournier",
      birth_date: "1942-03-01",
      residence: "Brussels",
    });
    expect(res.body.archive_since).toBe("2026-01-15T00:00:00.000Z");
    expect(res.body.on_screen).toMatchObject({ live: true, channel_number: 3 });
  });

  it("reports a silent screen as not live, keeping what she saw last", async () => {
    world({
      settings: [
        {
          archive_id: ARCHIVE_A,
          display_name: "Margaret",
          full_name: null,
          birth_date: null,
          residence: null,
          current_channel_number: 3,
          screen_synced_at: iso(20 * 60_000), // twenty minutes of silence
        },
      ],
    });
    const res = await get("/api/streams/subject");

    expect(res.body.on_screen.live).toBe(false);
    expect(res.body.on_screen.channel_number).toBe(null);
    expect(res.body.on_screen.last_channel_number).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────── content

describe("the content stream", () => {
  it("counts channels and photographs, and describes only photographs", async () => {
    const res = await get("/api/streams/content");

    expect(res.status).toBe(200);
    expect(res.body.channels).toBe(2);
    expect(res.body.photos).toBe(3);
    expect(res.body.videos).toBe(1);
    // Two of three photographs carry captions; the captioned video does not count.
    expect(res.body.described).toEqual({ captioned: 2, photos: 3, pct: 67 });
  });

  it("buckets additions by week, month, and a twelve-month series", async () => {
    const res = await get("/api/streams/content");

    expect(res.body.additions.total).toBe(4);
    expect(res.body.additions.this_week).toBe(2);
    expect(res.body.additions.by_month).toHaveLength(12);
    const counted = res.body.additions.by_month.reduce(
      (sum: number, m: { count: number }) => sum + m.count,
      0
    );
    expect(counted).toBe(4);
  });

  it("marks the on-screen channel LIVE on its shelf entry", async () => {
    const res = await get("/api/streams/content");

    const garden = res.body.shelf.find((c: { number: number }) => c.number === 3);
    const wedding = res.body.shelf.find((c: { number: number }) => c.number === 1);
    expect(garden.live).toBe(true);
    expect(wedding.live).toBe(false);
    expect(wedding).toMatchObject({ title: "The wedding", photo_count: 2, video_count: 0 });
  });

  it("answers an empty archive with zeros and an honest null percentage", async () => {
    world({ channels: [], media_files: [] });
    const res = await get("/api/streams/content");

    expect(res.body.channels).toBe(0);
    expect(res.body.described).toEqual({ captioned: 0, photos: 0, pct: null });
  });
});

// ─────────────────────────────────────────────────────────────── people

describe("the people stream", () => {
  it("counts contributors without the subject, and never leaks contact details", async () => {
    const res = await get("/api/streams/people");

    expect(res.status).toBe(200);
    expect(res.body.contributors).toBe(1); // Claire; Margaret is the subject
    const claire = res.body.circle.find((p: { id: string }) => p.id === ADMIN_A);
    // Two different facts: `author_id` says whose channel it is,
    // `created_by` says who did the work. The tree family's real rows carry
    // authorship only on created_by, so the circle must count both.
    expect(claire).toMatchObject({
      name: "Claire",
      role: "admin",
      channels_authored: 2,
      channels_created: 2,
    });

    // The fixture rows carry emails and phone numbers; the stream must not.
    const text = JSON.stringify(res.body);
    expect(text).not.toContain("example.invalid");
    expect(text).not.toContain("+32");
  });
});

// ─────────────────────────────────────────────────────────────── nfc

describe("the nfc stream", () => {
  it("counts linked and names the unlinked", async () => {
    const res = await get("/api/streams/nfc");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ cards: 2, linked: 1 });
    expect(res.body.unlinked).toEqual([{ id: "card2", label: "Spare card" }]);
  });
});

// ─────────────────────────────────────────────────────────────── missions

describe("the missions stream", () => {
  it("counts done of total and lists by status", async () => {
    const res = await get("/api/streams/missions");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.done).toBe(1);
    expect(res.body.by_status).toEqual({ suggested: 1, in_progress: 1, completed: 1 });
    expect(res.body.list).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────── engagement

describe("the engagement stream", () => {
  it("sums today's watching and finds the longest sit with its channel", async () => {
    const res = await get("/api/streams/engagement");

    expect(res.status).toBe(200);
    expect(res.body.watched_today).toEqual({ seconds: 1800, visits: 2 });
    expect(res.body.longest_sit).toMatchObject({
      seconds: 1200,
      channel_number: 1,
      channel_title: "The wedding",
    });
  });

  it("carries the window block and per-channel totals Insights needs", async () => {
    const res = await get("/api/streams/engagement");

    expect(res.body.window).toMatchObject({
      range: "week",
      seconds: 3600,
      sessions: 1,
      visits: 3,
      channels: 2,
    });
    const garden = res.body.per_channel.find((c: { number: number }) => c.number === 3);
    expect(garden.seconds).toBe(900); // 600 today + 300 two days ago
    expect(res.body.has_data).toBe(true);
  });

  it("honours ?range — today, week and month answer differently (M115)", async () => {
    const today = await get("/api/streams/engagement?range=today");
    expect(today.body.window).toMatchObject({ range: "today", visits: 2, channel_seconds: 1800 });

    const month = await get("/api/streams/engagement?range=month");
    expect(month.body.window).toMatchObject({
      range: "month",
      visits: 4,
      channel_seconds: 2600,
      seconds: 4600, // both sessions: today's hour + the old 1000s
    });

    // The month window's returns-list carries the old wedding visit too.
    const wedding = month.body.per_channel.find((c: { number: number }) => c.number === 1);
    expect(wedding.seconds).toBe(1700);
    const weddingThisWeek = (await get("/api/streams/engagement")).body.per_channel.find(
      (c: { number: number }) => c.number === 1
    );
    expect(weddingThisWeek.seconds).toBe(1200);
  });

  it("refuses an unknown range in words", async () => {
    const res = await get("/api/streams/engagement?range=fortnight");
    expect(res.status).toBe(400);
  });

  it("answers a day with no visits honestly", async () => {
    world({ channel_visits: [], device_sessions: [] });
    const res = await get("/api/streams/engagement");

    expect(res.body.watched_today).toEqual({ seconds: 0, visits: 0 });
    expect(res.body.longest_sit).toBe(null);
    expect(res.body.has_data).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────── activity

describe("the activity stream", () => {
  it("returns the timeline, newest first, explicitly mapped", async () => {
    const res = await get("/api/streams/activity");

    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0]).toMatchObject({
      action_type: "channel_created",
      description: "Claire created The garden",
    });
  });
});

// ─────────────────────────────────────────────────────────────── device

describe("the device stream", () => {
  it("reports the display's presence, and its gaps as explicitly unknown", async () => {
    const res = await get("/api/streams/device");

    expect(res.status).toBe(200);
    expect(res.body.display.paired).toBe(true);
    expect(res.body.display.online).toBe(true);
    expect(res.body.display.last_seen_at).toBeTruthy();

    // F21: no source yet — declared, never fabricated.
    expect(res.body.software_version).toBe(null);
    expect(res.body.storage).toBe(null);
    expect(res.body.backup).toBe(null);
  });

  it("reports an unpaired family plainly", async () => {
    world({ installations: [{ id: INSTALL_A, archive_id: ARCHIVE_A, revoked_at: null, is_trusted: false, last_used_at: null }] });
    const res = await get("/api/streams/device");

    expect(res.body.display.paired).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────── the seams

describe("the streams hold the boundary", () => {
  it("refuses an anonymous caller on every stream", async () => {
    for (const name of ["subject", "content", "people", "nfc", "missions", "engagement", "activity", "device"]) {
      const res = await request(app).get(`/api/streams/${name}`);
      expect(res.status, name).toBe(401);
    }
  });

  it("scopes every family-table query to the caller's archive", async () => {
    const FAMILY_TABLES = new Set([
      "people", "channels", "media_files", "settings", "nfc_cards",
      "channel_visits", "device_sessions", "missions", "activity_log", "installations",
    ]);
    for (const name of ["subject", "content", "people", "nfc", "missions", "engagement", "activity", "device"]) {
      world();
      await get(`/api/streams/${name}`);
      const touched = recorder.queries.filter(
        (q) =>
          FAMILY_TABLES.has(q.table) &&
          // requireRole's session reload happens before the archive is known.
          !(q.table === "people" && q.select === "id, name, role, status, archived_at, archive_id")
      );
      expect(touched.length, name).toBeGreaterThan(0);
      for (const q of touched) {
        expect(
          q.filters.some((f) => f.column === "archive_id" && f.value === ARCHIVE_A),
          `${name}: ${q.table} ${q.op} must be archive-scoped`
        ).toBe(true);
      }
    }
  });

  it("Insights answers from the shared engagement stream, one source per fact", async () => {
    const res = await get("/api/insights");

    expect(res.status).toBe(200);
    // The same arithmetic the stream returned — computed once, in one place.
    expect(res.body.range).toBe("week");
    expect(res.body.window).toMatchObject({ seconds: 3600, sessions: 1, visits: 3, channels: 2 });
    expect(res.body.most_visited[0]).toMatchObject({ number: 1, seconds: 1200 });
    expect(res.body.has_data).toBe(true);
  });

  it("Insights honours ?range, so the three tabs stop answering identically (M115)", async () => {
    const today = await get("/api/insights?range=today");
    const month = await get("/api/insights?range=month");

    expect(today.body.range).toBe("today");
    expect(month.body.range).toBe("month");
    expect(today.body.window.visits).toBe(2);
    expect(month.body.window.visits).toBe(4);
    // The returns-list follows its window rather than wearing a fixed month.
    const wedding = (n: { number: number }) => n.number === 1;
    expect(today.body.most_visited.find(wedding).seconds).toBe(1200);
    expect(month.body.most_visited.find(wedding).seconds).toBe(1700);
  });
});
