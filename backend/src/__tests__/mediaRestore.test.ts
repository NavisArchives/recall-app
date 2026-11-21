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
 * M127 — a removed photo gets the door it was promised.
 *
 * The remove has always archived rather than destroyed; the confirm copy has
 * always said "Recently deleted"; and until now nothing let the family walk
 * through that door. These pin the new restore route to the remove's own
 * rules — same tier, same ownership, same archive scoping — and pin the
 * forever-promise: a permanent delete includes the archived rows, so nothing
 * orphaned survives it.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";
const ARCHIVE_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const INSTALL_A = "aaaaaaaa-0000-0000-0000-0000000000f1";
const ADMIN_A = "aaaaaaaa-0000-0000-0000-0000000000ad";
const COAUTHOR = "aaaaaaaa-0000-0000-0000-0000000000cc";
const CH = "aaaaaaaa-0000-0000-0000-00000000ch01";
const MEDIA = "aaaaaaaa-0000-0000-0000-0000000000m1";

function cookies(person = { id: ADMIN_A, name: "Claire", role: "admin" }) {
  const device = jwt.sign({ installationId: INSTALL_A, archiveId: ARCHIVE_A }, SECRET, {
    expiresIn: 3600,
  });
  const profile = jwt.sign(
    { personId: person.id, name: person.name, role: person.role, archiveId: ARCHIVE_A },
    SECRET,
    { expiresIn: 3600 }
  );
  return [`recall_device=${device}`, `recall_profile=${profile}`];
}

function world(over: Record<string, Record<string, unknown>[]> = {}) {
  recorder.reset({
    installations: [{ id: INSTALL_A, archive_id: ARCHIVE_A, revoked_at: null, is_trusted: true }],
    people: [
      {
        id: ADMIN_A,
        name: "Claire",
        role: "admin",
        status: "active",
        archived_at: null,
        archive_id: ARCHIVE_A,
      },
    ],
    media_files: [
      {
        id: MEDIA,
        channel_id: CH,
        archive_id: ARCHIVE_A,
        storage_path: "a/probe.jpg",
        file_type: "image",
        display_order: 3,
        caption: "The probe",
        archived_at: "2026-08-08T10:00:00.000Z",
        channels: { created_by: COAUTHOR },
        channel: { id: CH, number: 1, title: "The garden at Vaux" },
      },
    ],
    channels: [
      {
        id: CH,
        number: 1,
        title: "The garden at Vaux",
        archive_id: ARCHIVE_A,
        archived_at: "2026-08-08T10:00:00.000Z",
        created_by: COAUTHOR,
      },
    ],
    ...over,
  });
}

beforeEach(() => world());

describe("the media restore door", () => {
  it("refuses an anonymous caller", async () => {
    const res = await request(app).post(`/api/media-files/${MEDIA}/restore`);
    expect(res.status).toBe(401);
    expect(recorder.forTable("media_files").filter((q) => q.op === "update")).toHaveLength(0);
  });

  it("clears archived_at, scoped to the caller's archive and the archived state", async () => {
    const res = await request(app)
      .post(`/api/media-files/${MEDIA}/restore`)
      .set("Cookie", cookies());

    expect(res.status).toBe(204);

    const updates = recorder.forTable("media_files").filter((q) => q.op === "update");
    expect(updates).toHaveLength(1);
    expect((updates[0].payload as Record<string, unknown>).archived_at).toBe(null);
    // The tenancy invariant: never restore by id alone.
    expect(updates[0].filters).toContainEqual({ method: "eq", column: "archive_id", value: ARCHIVE_A });
    expect(updates[0].filters).toContainEqual({ method: "eq", column: "id", value: MEDIA });
    // And only a file that is actually in the bin comes back through it.
    expect(
      updates[0].filters.some((f) => f.method === "not" && f.column === "archived_at")
    ).toBe(true);
  });

  it("follows the remove's ownership rule: a co-author only on their own channel", async () => {
    // The channel belongs to COAUTHOR; a different co-author may not restore.
    world({
      people: [
        {
          id: "aaaaaaaa-0000-0000-0000-0000000000c9",
          name: "Paul",
          role: "co_author",
          status: "active",
          archived_at: null,
          archive_id: ARCHIVE_A,
        },
      ],
    });
    const res = await request(app)
      .post(`/api/media-files/${MEDIA}/restore`)
      .set("Cookie", cookies({ id: "aaaaaaaa-0000-0000-0000-0000000000c9", name: "Paul", role: "co_author" }));

    expect(res.status).toBe(403);
    expect(recorder.forTable("media_files").filter((q) => q.op === "update")).toHaveLength(0);
  });

  it("lets the owning co-author restore their own", async () => {
    world({
      people: [
        {
          id: COAUTHOR,
          name: "Anne",
          role: "co_author",
          status: "active",
          archived_at: null,
          archive_id: ARCHIVE_A,
        },
      ],
    });
    const res = await request(app)
      .post(`/api/media-files/${MEDIA}/restore`)
      .set("Cookie", cookies({ id: COAUTHOR, name: "Anne", role: "co_author" }));

    expect(res.status).toBe(204);
  });
});

describe("the bin's Files list", () => {
  it("lists only this archive's archived media, with the channel it returns to", async () => {
    const res = await request(app)
      .get("/api/media-files/archived/list")
      .set("Cookie", cookies());

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: MEDIA,
      display_order: 3,
      channel: { number: 1, title: "The garden at Vaux" },
    });
    // No storage path reaches the browser — the thumbnail is a backend URL.
    expect(JSON.stringify(res.body)).not.toContain("probe.jpg");

    const selects = recorder.forTable("media_files").filter((q) => q.op === "select");
    for (const q of selects) {
      expect(q.filters).toContainEqual({ method: "eq", column: "archive_id", value: ARCHIVE_A });
    }
  });

  it("refuses an anonymous caller", async () => {
    const res = await request(app).get("/api/media-files/archived/list");
    expect(res.status).toBe(401);
  });
});

describe("a photo in the bin has left the shelf", () => {
  /*
   * Found by M127's own probe: the channels list embeds `media_files` with
   * no archived filter, so a removed photograph still counted — and worse,
   * still qualified as the channel's cover, which is a picture the family
   * deleted continuing to appear on her display. The detail route already
   * filters; only the list did not.
   */
  it("counts and covers only live media", async () => {
    recorder.reset({
      installations: [{ id: INSTALL_A, archive_id: ARCHIVE_A, revoked_at: null, is_trusted: true }],
      people: [
        {
          id: ADMIN_A,
          name: "Claire",
          role: "admin",
          status: "active",
          archived_at: null,
          archive_id: ARCHIVE_A,
        },
      ],
      channels: [
        {
          id: CH,
          number: 1,
          title: "The garden at Vaux",
          archive_id: ARCHIVE_A,
          archived_at: null,
          created_by: ADMIN_A,
          media_files: [
            // The removed one sorts first, so it would have been the cover.
            {
              id: "gone",
              display_order: 0,
              file_type: "image",
              caption: null,
              archived_at: "2026-08-08T10:00:00.000Z",
            },
            {
              id: "live",
              display_order: 1,
              file_type: "image",
              caption: "The roses",
              archived_at: null,
            },
          ],
        },
      ],
    });

    const res = await request(app).get("/api/channels").set("Cookie", cookies());

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      media_count: 1,
      photo_count: 1,
      // The removed photograph had no caption; it must not ask the family to
      // describe a picture they deleted.
      undescribed_count: 0,
    });
    expect(res.body[0].cover_url).toContain("live");
    expect(res.body[0].cover_url).not.toContain("gone");
  });
});

describe("the forever-promise includes the bin", () => {
  it("permanent delete selects and deletes media without excluding the archived", async () => {
    await request(app).delete(`/api/channels/${CH}/permanent`).set("Cookie", cookies());

    const mediaQueries = recorder.forTable("media_files");
    const select = mediaQueries.find((q) => q.op === "select");
    const del = mediaQueries.find((q) => q.op === "delete");
    expect(select).toBeTruthy();
    expect(del).toBeTruthy();

    // The queries must not carve archived rows out of "forever": no filter
    // on archived_at anywhere in the purge path.
    for (const q of [select!, del!]) {
      expect(q.filters.some((f) => f.column === "archived_at")).toBe(false);
      expect(q.filters).toContainEqual({ method: "eq", column: "channel_id", value: CH });
      expect(q.filters).toContainEqual({ method: "eq", column: "archive_id", value: ARCHIVE_A });
    }
  });
});
