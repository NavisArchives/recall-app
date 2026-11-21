import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { recorder } from "./support/supabaseRecorder.js";
import {
  OWNER_ACTIVITY_COLUMNS,
  OWNER_CHANNEL_COLUMNS,
  OWNER_FAMILY_COLUMNS,
  OWNER_INSTALLATION_COLUMNS,
  OWNER_MEDIA_COLUMNS,
  OWNER_PERSON_COLUMNS,
  OWNER_VISIT_COLUMNS,
} from "../services/dto";

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => recorder.client,
}));

/*
  The bucket, as a spy. "Was anything read from storage?" is the question the
  media test below has to answer — a status code alone passed for a year
  against a path no route matched (access-12).
*/
const { openMedia } = vi.hoisted(() => ({
  openMedia: vi.fn(async (_bucket: string, storagePath: string) => {
    const { Readable } = await import("node:stream");
    const bytes = Buffer.from(`bytes of ${storagePath}`);
    return { stream: Readable.from([bytes]), size: bytes.length, fromCache: false };
  }),
}));
vi.mock("../services/mediaCache.js", () => ({
  openMedia,
  cacheStats: async () => ({ files: 0, bytes: 0, maxBytes: 0 }),
}));
// The offline index writes to disk; nothing here is about it.
vi.mock("../services/mediaIndex.js", () => ({
  rememberMedia: async () => undefined,
  lookupMedia: async () => null,
}));

const { createApp } = await import("../app.js");
const app = createApp();

/**
 * The platform owner's dashboard (M55).
 *
 * Two boundaries, and they pull in opposite directions — which is why both
 * need proving:
 *
 *   **Outward.** These three routes are the one sanctioned exception to
 *   per-archive scoping in the codebase, so everything that is not the
 *   platform owner has to bounce off them, and bounce off identically. Not
 *   403 — 403 confirms the surface exists. The same 404 a missing route
 *   gives, for a family admin, a stranger and an outage alike.
 *
 *   **Inward.** Being the platform owner buys information about families and
 *   nothing else. It is not a master key: the media routes do not know the
 *   flag exists, so the owner's own session is refused another family's
 *   pictures exactly like anybody else's would be. That is the half a
 *   dashboard mission could quietly skip, so it is tested first.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";

const MINE = "aaaaaaaa-0000-0000-0000-00000000000a";
const THEIRS = "bbbbbbbb-0000-0000-0000-00000000000b";
const INSTALL = "aaaaaaaa-0000-0000-0000-0000000000f1";
const ME = "aaaaaaaa-0000-0000-0000-0000000000ad";

function session(archiveId: string) {
  void archiveId;
  return ["recall_family=owner-session-token"];
}

/** The signed-in family is, or is not, the platform owner. */
function asOwner(isOwner: boolean, over: Record<string, unknown[]> = {}) {
  recorder.reset({
    families: [
      {
        id: "fam-1",
        archive_id: MINE,
        display_name: "Fournier",
        email: "andy@example.invalid",
        created_at: "2026-01-01T00:00:00.000Z",
        platform_owner: isOwner,
        status: "active",
        session_version: 1,
      },
    ],
    family_sessions: [{
      id: "owner-session",
      family_id: "fam-1",
      archive_id: MINE,
      person_id: null,
      role: null,
      session_version: 1,
      expires_at: "2099-01-01T00:00:00.000Z",
      revoked_at: null,
    }],
    installations: [{ id: INSTALL, archive_id: MINE, revoked_at: null, is_trusted: true }],
    people: [
      {
        id: ME,
        name: "Andy",
        role: "admin",
        status: "active",
        archived_at: null,
        archive_id: MINE,
      },
    ],
    channels: [],
    media_files: [],
    activity_log: [],
    channel_visits: [],
    ...over,
  });
}

const ROUTES = ["/api/owner/families", "/api/owner/health", "/api/owner/events"];

beforeEach(() => recorder.reset({}));

describe("the flag is not a master key", () => {
  const THEIR_MEDIA = "bbbbbbbb-0000-0000-0000-0000000000e1";
  const THEIR_PERSON = "bbbbbbbb-0000-0000-0000-0000000000c1";
  const THEIR_SCREEN = "bbbbbbbb-0000-0000-0000-0000000000f1";

  /*
    The real platform owner's shape (M55, M152): a family row with NO archive
    and a session to match. The fixture above gives the owner an archive for
    the dashboard's sake; here the point is the owner as they actually are.
  */
  function realOwnerWorld() {
    recorder.reset({
      families: [
        { id: "fam-owner", archive_id: null, platform_owner: true, status: "active", session_version: 1 },
      ],
      family_sessions: [{
        id: "owner-session",
        family_id: "fam-owner",
        archive_id: null,
        person_id: null,
        role: null,
        session_version: 1,
        expires_at: "2099-01-01T00:00:00.000Z",
        revoked_at: null,
      }],
      media_files: [{ id: THEIR_MEDIA, archive_id: THEIRS, channel_id: "c-theirs", storage_path: `${THEIRS}/wedding.jpg` }],
      people: [{ id: THEIR_PERSON, archive_id: THEIRS, profile_picture_path: `${THEIRS}/face.jpg` }],
      installations: [{ id: THEIR_SCREEN, archive_id: THEIRS, revoked_at: null, is_trusted: true }],
      channels: [],
    });
  }

  const MEDIA_ROUTES = [
    `/api/media/${THEIR_MEDIA}/file`,
    `/api/media/person/${THEIR_PERSON}/photo`,
  ];

  beforeEach(() => openMedia.mockClear());

  it.each(MEDIA_ROUTES)("refuses the platform owner another family's media: %s", async (path) => {
    realOwnerWorld();

    // First, that this really is a platform-owner session: the console opens.
    const console_ = await request(app).get("/api/owner/health").set("Cookie", session(MINE));
    expect(console_.status).toBe(200);

    // The owner's own, real, authenticated session — and a media route,
    // which has never heard of `platform_owner`.
    const res = await request(app).get(path).set("Cookie", session(MINE));

    expect([403, 404]).toContain(res.status);
    expect(res.headers["content-type"]).not.toMatch(/^image\//);
    // The claim itself: nothing was read out of the bucket.
    expect(openMedia).not.toHaveBeenCalled();
  });

  /*
    The positive control (access-12). Without it the test above passes on any
    path that matches no route at all — the app's catch-all 404 — which is
    exactly how its predecessor passed while requesting `/api/media/file/:id`,
    a route that does not exist. Here the same two paths, the same rows and
    the same bucket serve the family's own screen. So the refusal above is the
    media guards deciding, and if they ever let the owner through, openMedia
    is called and the test above goes red.
  */
  it.each(MEDIA_ROUTES)("serves the same media to the family's own trusted screen: %s", async (path) => {
    realOwnerWorld();
    const device = jwt.sign({ installationId: THEIR_SCREEN, archiveId: THEIRS }, SECRET, { expiresIn: 3600 });

    const res = await request(app).get(path).set("Cookie", [`recall_device=${device}`]);

    expect(res.status).toBe(200);
    expect(openMedia).toHaveBeenCalledTimes(1);
  });

  it("never reads a family's content columns while building the dashboard", async () => {
    asOwner(true);
    await request(app).get("/api/owner/families").set("Cookie", session(MINE));

    /*
     * The disclosure is decided at the query, not at the component. If a
     * dashboard read ever asks for a title, a name, a caption or a storage
     * path, it has already left the database — whether or not anything
     * renders it.
     */
    const forbidden = ["title", "caption", "storage_path", "description", "contact_number", "name"];
    const dashboardReads = recorder.queries.filter(
      (q) => q.select && q.table !== "people" && q.table !== "families"
    );

    for (const query of dashboardReads) {
      for (const column of forbidden) {
        expect(
          query.select!.split(",").map((c) => c.trim()),
          `${query.table} selected "${column}"`
        ).not.toContain(column);
      }
    }

    // `people` is read for a count only — ids, never who they are.
    const peopleReads = recorder.forTable("people").filter((q) => q.select?.includes("archive_id"));
    for (const query of peopleReads) {
      expect(query.select).toBe("id, archive_id");
    }
  });
});

describe("every refusal is the same 404", () => {
  it.each(ROUTES)("turns away a family admin who is not the platform owner: %s", async (path) => {
    asOwner(false);

    const res = await request(app).get(path).set("Cookie", session(MINE));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found." });
  });

  it.each(ROUTES)("turns away a caller with no session at all: %s", async (path) => {
    asOwner(false);

    const res = await request(app).get(path);

    // Byte for byte the same answer as the admin above: the surface does not
    // confirm it exists to either of them.
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found." });
  });

  it("turns away an admin whose family row cannot be read", async () => {
    asOwner(true);
    recorder.failure = { message: "connection refused" };

    const res = await request(app).get("/api/owner/families").set("Cookie", session(MINE));

    // "I cannot confirm you are the platform owner" and "you are not" lead to
    // the same place. Guessing the other way is the expensive mistake.
    expect(res.status).toBe(404);
  });
});

describe("what the platform owner sees", () => {
  it("reports one row per family, with counts", async () => {
    asOwner(true, {
      channels: [{ id: "c1", archive_id: MINE, created_at: "2026-02-01T00:00:00.000Z" }],
      media_files: [{ id: "m1", archive_id: MINE, created_at: "2026-03-01T00:00:00.000Z" }],
    });

    const res = await request(app).get("/api/owner/families").set("Cookie", session(MINE));

    expect(res.status).toBe(200);
    expect(res.body.families).toHaveLength(1);
    const row = res.body.families[0];
    expect(row.archive_id).toBe(MINE);
    expect(row.members).toBe(1);
    expect(row.channels).toBe(1);
    expect(row.media_files).toBe(1);
    // The billing seam renders and nothing else.
    expect(row.subscription).toBe("—");
  });

  it("takes last_activity as the max across visits, actions and uploads", async () => {
    const older = "2026-01-01T00:00:00.000Z";
    const newest = "2026-06-06T00:00:00.000Z";

    // Each of the three sources in turn is the newest thing that happened.
    for (const source of ["channel_visits", "activity_log", "media_files"] as const) {
      asOwner(true, {
        channel_visits: [{ id: "v", archive_id: MINE, started_at: source === "channel_visits" ? newest : older }],
        activity_log: [{ id: "a", archive_id: MINE, action_type: "x", created_at: source === "activity_log" ? newest : older }],
        media_files: [{ id: "m", archive_id: MINE, created_at: source === "media_files" ? newest : older }],
      });

      const res = await request(app).get("/api/owner/families").set("Cookie", session(MINE));

      expect(res.body.families[0].last_activity, `when ${source} is newest`).toBe(newest);
    }
  });

  /*
    M221 — this test used to inject nothing.

    It asserted only that a `database` key exists, and its own comment said
    failing the probe alone "is not possible with one switch". The recorder
    has had `failNext` — keyed on table, op AND select — since F64, and the
    probe is the only `families` read selecting `"id"`. So the down path was
    testable all along and simply was not tested; the test's title claimed a
    guarantee its body never exercised.

    That matters more than an ordinary gap: the owner's dashboard is the one
    screen that reports whether the platform is alright, and the branch that
    says "it is not" had no coverage at all.
  */
  it("reports the database down when the probe actually fails", async () => {
    asOwner(true);
    recorder.failNext = {
      table: "families",
      op: "select",
      select: "id",
      error: { message: "connection refused" },
    };

    const res = await request(app).get("/api/owner/health").set("Cookie", session(MINE));

    expect(res.status).toBe(200); // the outage IS the answer; it must still draw
    expect(res.body.database).not.toBe("up");
    expect(res.body.detail).toBe("connection refused");
    /*
      And every figure is null rather than 0. "0 families" on the morning
      after launch is the exact sentence this page must never say from a
      failed read.
    */
    expect(res.body.families).toBeNull();
    expect(res.body.memories).toBeNull();
    expect(res.body.subscriptions).toBeNull();
    expect(res.body.errors_24h).toBeNull();
  });

  /*
    The positive control. Without it the assertions above pass just as well
    against a route that always answers null — and "no families yet" is a
    TRUE and expected state on launch day, which the fix must not make
    unsayable.
  */
  it("still reports a real zero as a zero when the database is fine", async () => {
    asOwner(true);
    const res = await request(app).get("/api/owner/health").set("Cookie", session(MINE));

    expect(res.body.database).toBe("up");
    expect(res.body.families).not.toBeNull();
    expect(typeof res.body.families).toBe("number");
  });

  /*
    M221's headline. `/owner/families` caught its own read error and answered
    **200** with `families: []`, so React Query never set `isError` and the
    page's `isPending || isError` gate could not fire. The table rendered as
    "no families exist" — to the owner, on the morning after launch, during a
    database hiccup.

    Everything built this week assumes a failed read arrives as a failure.
    Here the transport laundered it into an empty success, and no guard
    downstream of a 200 can help.
  */
  it("fails the request when the families read fails, rather than answering empty", async () => {
    asOwner(true);
    recorder.failNext = {
      table: "families",
      op: "select",
      select: OWNER_FAMILY_COLUMNS,
      error: { message: "connection refused" },
    };

    const res = await request(app).get("/api/owner/families").set("Cookie", session(MINE));

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.body.families).toBeUndefined();
  });

  /*
    The same fault on the sibling query, found while making this page
    observable (M221).

    `/owner/door` caught its read error and answered 200 with two empty
    arrays, so the dashboard printed "Nobody is waiting at the door" about a
    query that never came back — and the page-side guard written for this
    mission could not fire, because nothing had failed as far as the browser
    could tell. Somebody asking to join could go unanswered for a week with
    the screen confirming daily that nobody had asked.
  */
  it("fails the doorstep read rather than answering an empty doorstep", async () => {
    asOwner(true);
    recorder.failNext = {
      table: "invitation_requests",
      op: "select",
      error: { message: "connection refused" },
    };

    const res = await request(app).get("/api/owner/door").set("Cookie", session(MINE));

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.body.requests).toBeUndefined();
    expect(res.body.invitations).toBeUndefined();
  });

  /*
    Its positive control, and not a formality: "nobody is at the door" is the
    normal state of this page for most of its life. The fix must leave that
    sentence sayable, or it has traded a false quiet for a permanent alarm.
  */
  it("still answers an empty doorstep as empty when the reads succeed", async () => {
    asOwner(true);
    const res = await request(app).get("/api/owner/door").set("Cookie", session(MINE));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.requests)).toBe(true);
    expect(Array.isArray(res.body.invitations)).toBe(true);
  });

  /*
    `/owner/events` had both halves of the fault: a 200-with-empty-feed on a
    families error, and `installations` never checked at all — so a failed
    installations read produced a feed with no paired screens in it, which
    reads as "no screen was ever paired".

    Nothing renders this route today. It is pinned anyway, because an
    unconsumed route with this shape is a fault waiting for its first
    consumer, and that is precisely how the doorstep above got here.
  */
  it("fails the events feed when EITHER of its two reads fails", async () => {
    /*
      Keyed on the `select` as well as the table, and that is not tidiness.
      `{ table: "families", op: "select" }` alone is eaten by
      `requirePlatformOwner`'s own families read, which then answers **404**
      — a refusal, not an outage, and the route under test never runs. A
      `toBeGreaterThanOrEqual(400)` here would have gone green on a 404 and
      pinned nothing at all.
    */
    const reads = [
      { table: "families", select: OWNER_FAMILY_COLUMNS },
      { table: "installations", select: OWNER_INSTALLATION_COLUMNS },
    ];

    for (const { table, select } of reads) {
      asOwner(true);
      recorder.failNext = { table, op: "select", select, error: { message: "connection refused" } };

      const res = await request(app).get("/api/owner/events").set("Cookie", session(MINE));

      expect(res.status, `when ${table} fails`).toBeGreaterThanOrEqual(500);
      expect(res.body.events, `when ${table} fails`).toBeUndefined();
    }
  });

  /*
    The control for the pair above: with nothing injected the feed answers,
    so the two assertions are reading the failure branch rather than a route
    that never worked.
  */
  it("answers the events feed when both reads succeed", async () => {
    asOwner(true);
    const res = await request(app).get("/api/owner/events").set("Cookie", session(MINE));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.events)).toBe(true);
  });

  /*
    The six reads beside the family list, one at a time (M221).

    These exist because a **mutation survived**. Forcing
    `counted = { members: true, channels: true, media: true }` — the exact
    fabrication this mission is about — left all 438 tests green. The three
    guards were real and nothing tested them, which is the same standing as
    not having written them: the next person to tidy this file removes them
    and every suite agrees.

    Three of the six were not guarded at all. I logged all six and guarded
    half, and the half I left out contained the worst one — see the comment
    on `counted.screens`.

    Each case pins the field that read fills, and pins that the OTHER fields
    still answer. A whole row of dashes would pass "is it null" while being
    a different and much worse bug.
  */
  it("nulls only the figures whose own read failed", async () => {
    const cases = [
      { table: "people", select: OWNER_PERSON_COLUMNS, field: "members" },
      { table: "channels", select: OWNER_CHANNEL_COLUMNS, field: "channels" },
      { table: "media_files", select: OWNER_MEDIA_COLUMNS, field: "media_files" },
      { table: "installations", select: OWNER_INSTALLATION_COLUMNS, field: "screen_paired" },
      { table: "activity_log", select: OWNER_ACTIVITY_COLUMNS, field: "last_activity" },
      { table: "channel_visits", select: OWNER_VISIT_COLUMNS, field: "last_activity" },
    ];

    for (const { table, select, field } of cases) {
      asOwner(true);
      recorder.failNext = { table, op: "select", select, error: { message: "connection refused" } };

      const res = await request(app).get("/api/owner/families").set("Cookie", session(MINE));

      expect(res.status, `when ${table} fails`).toBe(200);
      const row = res.body.families[0];
      expect(row[field], `when ${table} fails, ${field}`).toBeNull();

      /*
        The other half of the claim: the list itself is still true, so it
        still draws. "One figure could not be counted" must not become "the
        platform has no families", which is the fault at the top of this
        file.
      */
      expect(row.family_name, `when ${table} fails`).toBe("Fournier");
    }
  });

  /*
    Its positive control, and the one that makes the six above mean
    anything: with nothing injected every figure is a real value, and
    `screen_paired` is `true` rather than merely not-null — the fixture
    gives this family a trusted screen, so a route that always answered
    null would fail here.
  */
  it("reports real figures, including a paired screen, when all six reads succeed", async () => {
    asOwner(true);
    const res = await request(app).get("/api/owner/families").set("Cookie", session(MINE));

    const row = res.body.families[0];
    expect(typeof row.members).toBe("number");
    expect(typeof row.channels).toBe("number");
    expect(typeof row.media_files).toBe("number");
    expect(row.screen_paired).toBe(true);
  });

  /*
    `screen_paired` deserves its own sentence because it is the only one of
    the six whose failure reads as a **fact about the family** rather than
    as a missing number. `false` means "they never put a screen on the
    wall"; that is a family somebody would ring. It must not be what an
    unread table produces.
  */
  it("does not report a family as having no screen when the screens are unreadable", async () => {
    asOwner(true);
    recorder.failNext = {
      table: "installations",
      op: "select",
      select: OWNER_INSTALLATION_COLUMNS,
      error: { message: "connection refused" },
    };

    const res = await request(app).get("/api/owner/families").set("Cookie", session(MINE));

    expect(res.body.families[0].screen_paired).not.toBe(false);
    expect(res.body.families[0].screen_last_seen).toBeNull();
  });

  it("answers with GET only — nothing here mutates anything", async () => {
    asOwner(true);

    for (const method of ["post", "patch", "delete"] as const) {
      const res = await request(app)[method]("/api/owner/families").set("Cookie", session(MINE));
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
  });
});
