import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { recorder } from "./support/supabaseRecorder.js";
import { SETTINGS_DISPLAY_COLUMNS } from "../services/dto.js";

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => recorder.client,
}));

const { createApp } = await import("../app.js");
const app = createApp();

/**
 * Where the postcards go is not the screen's business (053, launch sweep).
 *
 * Migration 053 added `settings.delivery_address` with the promise that it is
 * read "never by any display route". The route behind requireDevice then
 * selected it, with her birth date, residence and the family's note, for
 * whoever held a device cookie — the 30-day tier her kiosk runs on. The fix
 * chooses the column list by who is asking, before the query is issued, the
 * same way /people does. Like displayPeopleList.test.ts these tests assert on
 * the QUERY the route sent, because the browser cannot render a column that
 * never left the database.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";
const ARCHIVE = "aaaaaaaa-0000-0000-0000-00000000000a";
const INSTALL = "aaaaaaaa-0000-0000-0000-0000000000f1";
const ADMIN = "aaaaaaaa-0000-0000-0000-0000000000ad";
const AUNT = "aaaaaaaa-0000-0000-0000-0000000000a1";

const deviceOnly = [
  `recall_device=${jwt.sign({ installationId: INSTALL, archiveId: ARCHIVE }, SECRET, {
    expiresIn: 3600,
  })}`,
];

function withProfile(personId: string, role: string) {
  return [
    ...deviceOnly,
    `recall_profile=${jwt.sign({ personId, name: "Someone", role, archiveId: ARCHIVE }, SECRET, {
      expiresIn: 3600,
    })}`,
  ];
}

beforeEach(() => {
  recorder.reset({
    people: [
      { id: ADMIN, archive_id: ARCHIVE, name: "Claire", role: "admin", status: "active", archived_at: null },
      { id: AUNT, archive_id: ARCHIVE, name: "Aunt", role: "user", status: "active", archived_at: null },
    ],
    installations: [{ id: INSTALL, archive_id: ARCHIVE, is_trusted: true, revoked_at: null }],
    settings: [
      {
        archive_id: ARCHIVE,
        display_name: "Margaret",
        full_name: "Margaret F.",
        birth_date: "1941-03-02",
        residence: "Bruges",
        note: "Likes the sea",
        photo_path: null,
        delivery_address: "Voorbeeldstraat 12, 1000 Brussel",
      },
    ],
    archives: [{ id: ARCHIVE, created_at: "2025-01-10T00:00:00Z" }],
  });
});

/** The column list the route asked the settings table for. */
async function settingsColumns(cookie: string[]): Promise<string> {
  const res = await request(app).get("/api/settings").set("Cookie", cookie);
  expect(res.status).toBe(200);
  const q = recorder.forTable("settings").find((x) => x.op === "select");
  return q?.select ?? "";
}

describe("GET /api/settings chooses its columns by who is asking", () => {
  it("her screen is sent the name and the photo, never the address, birth date or note", async () => {
    const cols = await settingsColumns(deviceOnly);
    expect(cols).toContain("display_name");
    expect(cols).not.toContain("delivery_address");
    expect(cols).not.toContain("birth_date");
    expect(cols).not.toContain("note");
    expect(cols).not.toContain("residence");
  });

  it("a family member reads what the Settings page shows about her, not where the cards go", async () => {
    recorder.responses.people = [
      { id: AUNT, archive_id: ARCHIVE, name: "Aunt", role: "co_author", status: "active", archived_at: null },
      { id: ADMIN, archive_id: ARCHIVE, name: "Claire", role: "admin", status: "active", archived_at: null },
    ];
    const cols = await settingsColumns(withProfile(AUNT, "co_author"));
    expect(cols).toContain("birth_date");
    expect(cols).not.toContain("delivery_address");
  });

  /*
    access-8. Pairing gives her screen her own `user` profile, so "somebody
    is acting" was true on the one machine the display set was written for,
    and her screen was sent her birth date, residence and the note.
  */
  it("her screen carrying her own profile is still the display", async () => {
    recorder.responses.people = [
      { id: AUNT, archive_id: ARCHIVE, name: "Margaret", role: "user", status: "active", archived_at: null },
      { id: ADMIN, archive_id: ARCHIVE, name: "Claire", role: "admin", status: "active", archived_at: null },
    ];
    const cols = await settingsColumns(withProfile(AUNT, "user"));
    expect(cols).toBe(SETTINGS_DISPLAY_COLUMNS);
    expect(cols).not.toContain("birth_date");
    expect(cols).not.toContain("note");
  });

  it("someone who manages people reads the delivery address", async () => {
    const cols = await settingsColumns(withProfile(ADMIN, "admin"));
    expect(cols).toContain("delivery_address");
  });
});
