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
 * One family must not be able to name another family's rows.
 *
 * The existing boundary suite proves a stranger is turned away. This one proves
 * something harder: that a *legitimate* caller, holding a valid session, cannot
 * reach across into another archive. Every query a route issues against a
 * family's table has to say which family it means — in the filter for reads and
 * writes, in the payload for inserts. A route that identifies a row by its UUID
 * alone is a route that will hand Archive A's row to Archive B for the asking.
 *
 * Nothing here needs a database. The defect is in the question, not the answer.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";

const ARCHIVE_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const INSTALL_A = "aaaaaaaa-0000-0000-0000-0000000000f1";
const ADMIN_A = "aaaaaaaa-0000-0000-0000-0000000000ad";

/** A real row id that belongs to the *other* family. */
const FOREIGN_ID = "bbbbbbbb-0000-0000-0000-00000000000b";

/**
 * Tables that hold a family's own data. Every one carries `archive_id`.
 *
 * `installations`, `accounts`, `archives`, `archive_memberships`, `invitations`
 * and `email_verifications` are deliberately absent: they are how an archive is
 * discovered or joined in the first place, so requiring the archive to be known
 * before reading them would be circular.
 */
const FAMILY_TABLES = new Set([
  "people",
  "channels",
  "media_files",
  "settings",
  "nfc_cards",
  "channel_visits",
  "device_sessions",
  "channel_access",
  "suggestions",
  "missions",
  "activity_log",
  "access_codes",
]);

/**
 * The one legitimately unscoped read: `requireRole` reloading the caller to find
 * out who — and therefore where — they are. It cannot filter by an archive it
 * has not established yet.
 */
const SESSION_RELOAD_SELECT = "id, name, role, status, archived_at, archive_id";

function isSessionReload(query: { table: string; select?: string }) {
  return query.table === "people" && query.select === SESSION_RELOAD_SELECT;
}

function cookies(archiveId = ARCHIVE_A) {
  const device = jwt.sign({ installationId: INSTALL_A, archiveId }, SECRET, { expiresIn: 3600 });
  const profile = jwt.sign(
    { personId: ADMIN_A, name: "Admin A", role: "admin", archiveId },
    SECRET,
    { expiresIn: 3600 }
  );
  return [`recall_device=${device}`, `recall_profile=${profile}`];
}

/** Rows the routes read while doing their work. All belong to Archive A. */
function archiveARows() {
  return {
    /*
     * The device's own row.
     *
     * requireDevice reads it on every request now (M42), so revoking a
     * screen takes effect immediately rather than whenever its cookie
     * happens to expire. Every fixture that carries a device cookie has to
     * carry the installation behind it, which is the point: a token whose
     * row is gone is a token that stops working.
     */
    installations: [
      { id: INSTALL_A, archive_id: ARCHIVE_A, revoked_at: null, is_trusted: true },
    ],
    people: [
      {
        id: ADMIN_A,
        name: "Admin A",
        role: "admin",
        status: "active",
        archived_at: null,
        archive_id: ARCHIVE_A,
        pin_hash: null,
        failed_pin_attempts: 0,
        locked_until: null,
        profile_picture_path: null,
      },
    ],
    channels: [{ id: FOREIGN_ID, number: 1, archive_id: ARCHIVE_A, created_by: ADMIN_A }],
    media_files: [
      { id: FOREIGN_ID, channel_id: FOREIGN_ID, archive_id: ARCHIVE_A, storage_path: "x/y.jpg" },
    ],
    missions: [{ id: FOREIGN_ID, archive_id: ARCHIVE_A }],
    nfc_cards: [{ id: FOREIGN_ID, archive_id: ARCHIVE_A, channel_number: 1 }],
    device_sessions: [{ id: FOREIGN_ID, archive_id: ARCHIVE_A, installation_id: INSTALL_A }],
    channel_visits: [{ id: FOREIGN_ID, archive_id: ARCHIVE_A }],
    channel_access: [{ channel_id: FOREIGN_ID, person_id: ADMIN_A, archive_id: ARCHIVE_A }],
    settings: [{ id: FOREIGN_ID, archive_id: ARCHIVE_A }],
  };
}

interface Case {
  name: string;
  method: "get" | "post" | "patch" | "put" | "delete";
  path: string;
  body?: Record<string, unknown>;
}

/**
 * Every route that takes a row id and could be handed one from another family.
 */
const CASES: Case[] = [
  // M01 — profile listing and unlock
  { name: "list profiles", method: "get", path: "/api/auth/profiles" },
  { name: "unlock a profile", method: "post", path: `/api/auth/profiles/${FOREIGN_ID}/unlock`, body: { pin: "1234" } },

  // M03 — people
  { name: "edit a person", method: "patch", path: `/api/people/${FOREIGN_ID}`, body: { name: "Renamed" } },
  { name: "change a role", method: "patch", path: `/api/people/${FOREIGN_ID}/role`, body: { role: "co_author" } },
  { name: "change a status", method: "patch", path: `/api/people/${FOREIGN_ID}/status`, body: { status: "deactivated" } },
  { name: "reset a PIN", method: "post", path: `/api/people/${FOREIGN_ID}/reset-pin` },
  { name: "archive a person", method: "delete", path: `/api/people/${FOREIGN_ID}` },

  // M03 — missions
  { name: "update a mission", method: "patch", path: `/api/missions/${FOREIGN_ID}`, body: { status: "completed" } },
  { name: "delete a mission", method: "delete", path: `/api/missions/${FOREIGN_ID}` },

  // M03 — NFC cards
  { name: "update a card", method: "patch", path: `/api/nfc-cards/${FOREIGN_ID}`, body: { channel_number: 7 } },
  { name: "delete a card", method: "delete", path: `/api/nfc-cards/${FOREIGN_ID}` },

  // M03 — media files
  { name: "caption a media file", method: "patch", path: `/api/media-files/${FOREIGN_ID}`, body: { caption: "A day at the sea" } },
  { name: "archive a media file", method: "delete", path: `/api/media-files/${FOREIGN_ID}` },
  { name: "reorder channel media", method: "patch", path: "/api/media-files/reorder", body: { channel_id: FOREIGN_ID, ordered_ids: [FOREIGN_ID] } },

  // M03 — sessions
  { name: "end a session", method: "post", path: `/api/sessions/${FOREIGN_ID}/end` },
  { name: "end a visit", method: "post", path: `/api/sessions/visits/${FOREIGN_ID}/end` },

  // M05 — channel access
  { name: "read channel access", method: "get", path: `/api/channels/${FOREIGN_ID}/access` },
  { name: "replace channel access", method: "put", path: `/api/channels/${FOREIGN_ID}/access`, body: { person_ids: [ADMIN_A] } },

  // The rest of the surface. The contract is not "the routes someone audited"
  // — it is every route, so the next one written is covered before it ships.
  { name: "list channels", method: "get", path: "/api/channels" },
  { name: "read a channel by number", method: "get", path: "/api/channels/01" },
  { name: "create a channel", method: "post", path: "/api/channels", body: { number: 12, title: "New", content_type: "album" } },
  { name: "read channel detail", method: "get", path: `/api/channels/detail/${FOREIGN_ID}` },
  { name: "edit a channel", method: "patch", path: `/api/channels/${FOREIGN_ID}`, body: { title: "Renamed" } },
  { name: "delete a channel", method: "delete", path: `/api/channels/${FOREIGN_ID}` },
  { name: "restore a channel", method: "post", path: `/api/channels/${FOREIGN_ID}/restore` },
  { name: "list archived channels", method: "get", path: "/api/channels/archived/list" },
  { name: "list people", method: "get", path: "/api/people" },
  { name: "read a person", method: "get", path: `/api/people/${FOREIGN_ID}` },
  { name: "list missions", method: "get", path: "/api/missions" },
  { name: "list cards", method: "get", path: "/api/nfc-cards" },
  { name: "read settings", method: "get", path: "/api/settings" },
  { name: "read screen state", method: "get", path: "/api/screen-state" },
  { name: "write screen state", method: "post", path: "/api/screen-state", body: { number: 1 } },
  { name: "read activity", method: "get", path: "/api/activity" },
  { name: "read suggestions", method: "get", path: "/api/suggestions" },
  { name: "read insights", method: "get", path: "/api/insights" },

  // M103/M104 — the upgraded backend's streams and the archive search.
  { name: "read the subject stream", method: "get", path: "/api/streams/subject" },
  { name: "read the content stream", method: "get", path: "/api/streams/content" },
  { name: "read the people stream", method: "get", path: "/api/streams/people" },
  { name: "read the nfc stream", method: "get", path: "/api/streams/nfc" },
  { name: "read the missions stream", method: "get", path: "/api/streams/missions" },
  { name: "read the engagement stream", method: "get", path: "/api/streams/engagement" },
  { name: "read the activity stream", method: "get", path: "/api/streams/activity" },
  { name: "read the device stream", method: "get", path: "/api/streams/device" },
  { name: "search the archive", method: "get", path: "/api/search?q=garden" },
];

function expectEveryQueryScoped() {
  const touched = recorder.queries.filter(
    (q) => FAMILY_TABLES.has(q.table) && !isSessionReload(q)
  );

  // A route that never reached its query proves nothing. If this fires, the
  // request was rejected earlier than intended and the case needs a better
  // body — not a weaker assertion.
  expect(touched.length, "route issued no family-table query").toBeGreaterThan(0);

  for (const query of touched) {
    const scoped =
      query.op === "insert" || query.op === "upsert"
        ? [query.payload].flat().every(
            (row) => (row as Record<string, unknown>)?.archive_id === ARCHIVE_A
          )
        : query.filters.some((f) => f.column === "archive_id" && f.value === ARCHIVE_A);

    expect(
      scoped,
      `${query.op} on "${query.table}" is not constrained to the caller's archive`
    ).toBe(true);
  }
}

describe("every query names the family it means", () => {
  beforeEach(() => {
    recorder.reset(archiveARows());
  });

  it.each(CASES)("$name", async ({ method, path, body }) => {
    const call = request(app)[method](path).set("Cookie", cookies());
    if (body) call.send(body);
    await call;

    expectEveryQueryScoped();
  });

  /**
   * Stamping the caller's archive onto a row that points somewhere else writes
   * a false claim of ownership, and every later archive-filtered query then
   * believes it. A mission is the sharpest case: its select joins the channel
   * back in, so an accepted foreign id returns another family's channel number
   * and title straight into this family's list.
   */
  it("refuses a mission aimed at another family's channel", async () => {
    // The channel lookup finds nothing, because it is not this archive's.
    recorder.reset({ ...archiveARows(), channels: [] });

    const res = await request(app)
      .post("/api/missions")
      .set("Cookie", cookies())
      .send({ title: "Describe these", channel_id: FOREIGN_ID, task_kind: "describe_photos" });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(recorder.forTable("missions").some((q) => q.op === "insert")).toBe(false);
  });

  // Uploading is the one route that carries a file, so it cannot ride the table
  // above — but it is also the route that writes the most personal rows, so it
  // is the last one that should be left unchecked.
  it("upload media", async () => {
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
    ]);

    await request(app)
      .post("/api/media-files")
      .set("Cookie", cookies())
      .field("channel_id", FOREIGN_ID)
      .attach("files", jpeg, "photo.jpg");

    expectEveryQueryScoped();
  });
});
