import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { recorder } from "./support/supabaseRecorder.js";

vi.mock("@supabase/supabase-js", () => ({ createClient: () => recorder.client }));

const { createApp } = await import("../app.js");
const app = createApp();

/**
 * Making and sending a postcard (design §18, migrations 047/048).
 *
 * The rules worth pinning are the ones a UI cannot enforce for you: a card
 * that picks "the newest photo" must not also carry a fixed one, and a card
 * already on its way must not be sent twice. Both cost somebody a real thing
 * — a frozen ritual, or a second card through a door.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";
const ARCHIVE = "aaaaaaaa-0000-0000-0000-00000000000a";
const ADMIN = "aaaaaaaa-0000-0000-0000-0000000000ad";
const INSTALL = "aaaaaaaa-0000-0000-0000-0000000000f1";
const CHANNEL = "aaaaaaaa-0000-0000-0000-0000000000c0";
const PHOTO = "aaaaaaaa-0000-0000-0000-0000000000m0";
const CARD = "aaaaaaaa-0000-0000-0000-0000000000cd";

const session = () => [
  `recall_device=${jwt.sign({ installationId: INSTALL, archiveId: ARCHIVE }, SECRET, { expiresIn: 3600 })}`,
  `recall_profile=${jwt.sign({ personId: ADMIN, name: "Andy", role: "admin", archiveId: ARCHIVE }, SECRET, { expiresIn: 3600 })}`,
];

function world(card: Record<string, unknown> = {}) {
  recorder.reset({
    people: [{ id: ADMIN, archive_id: ARCHIVE, name: "Andy", role: "admin", status: "active", archived_at: null }],
    installations: [{ id: INSTALL, archive_id: ARCHIVE, is_trusted: true, revoked_at: null }],
    // What a card points at has to exist in this archive (access-1): the
    // route now checks the channel and the photo before it writes.
    channels: [{ id: CHANNEL, archive_id: ARCHIVE, number: 4, title: "The garden", privacy_level: 3, created_by: ADMIN }],
    media_files: [{ id: PHOTO, archive_id: ARCHIVE, channel_id: CHANNEL }],
    nfc_cards: [
      {
        id: CARD,
        archive_id: ARCHIVE,
        kind: "postcard",
        state: "ready",
        channel_id: CHANNEL,
        media_file_id: PHOTO,
        photo_mode: "chosen",
        archived_at: null,
        ...card,
      },
    ],
  });
}

const post = (path: string, body: unknown = {}) =>
  request(app).post(path).set("Cookie", session()).send(body as object);

beforeEach(() => world());

describe("making a postcard", () => {
  it("needs a channel — a card that opens nothing is not a card", async () => {
    const res = await post("/api/nfc-cards/postcards", { media_file_id: PHOTO });
    expect(res.status).toBe(400);
    expect(recorder.forTable("nfc_cards").filter((q) => q.op === "insert")).toHaveLength(0);
  });

  it("needs a photograph when the family chose one", async () => {
    const res = await post("/api/nfc-cards/postcards", { channel_id: CHANNEL, photo_mode: "chosen" });
    expect(res.status).toBe(400);
  });

  /*
    The one that matters for 18i. "Newest in the channel" is a standing
    instruction, so a fixed photograph alongside it would freeze the monthly
    ritual on its first picture — and it would look right for a month.
  */
  it("refuses a newest-photo card that also fixes a photograph", async () => {
    const res = await post("/api/nfc-cards/postcards", {
      channel_id: CHANNEL,
      photo_mode: "newest",
      media_file_id: PHOTO,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot also fix/i);
  });

  it("accepts a newest-photo card on its own, and stores no photograph", async () => {
    const res = await post("/api/nfc-cards/postcards", {
      channel_id: CHANNEL,
      photo_mode: "newest",
      recurrence: "monthly",
      next_send_at: "2026-09-01",
    });
    expect(res.status).not.toBe(400);
    const write = recorder.forTable("nfc_cards").find((q) => q.op === "insert");
    expect(write?.payload).toMatchObject({ kind: "postcard", photo_mode: "newest", media_file_id: null });
  });

  it("refuses a repeating card with no date to start from", async () => {
    const res = await post("/api/nfc-cards/postcards", {
      channel_id: CHANNEL,
      photo_mode: "newest",
      recurrence: "monthly",
    });
    expect(res.status).toBe(400);
  });

  it("refuses a schedule it does not know", async () => {
    const res = await post("/api/nfc-cards/postcards", {
      channel_id: CHANNEL,
      media_file_id: PHOTO,
      recurrence: "fortnightly",
    });
    expect(res.status).toBe(400);
  });
});

describe("sending it", () => {
  it("moves a ready card into the queue", async () => {
    const res = await post(`/api/nfc-cards/${CARD}/send`);
    expect(res.status).not.toBe(409);
    const write = recorder.forTable("nfc_cards").find((q) => q.op === "update");
    expect(write?.payload).toMatchObject({ state: "queued" });
  });

  /*
    The guard is on the STATE, not on the button: a double click, a stale tab
    or a back-navigation would otherwise print a second card and post it.
  */
  it("refuses a card that is already on its way", async () => {
    world({ state: "queued" });
    const res = await post(`/api/nfc-cards/${CARD}/send`);
    expect(res.status).toBe(409);
    expect(recorder.forTable("nfc_cards").filter((q) => q.op === "update")).toHaveLength(0);
  });

  it("refuses one that has already been sent", async () => {
    world({ state: "sent" });
    const res = await post(`/api/nfc-cards/${CARD}/send`);
    expect(res.status).toBe(409);
  });

  it("will not post a tag — only a postcard goes through the letterbox", async () => {
    world({ kind: "nfc", state: null });
    const res = await post(`/api/nfc-cards/${CARD}/send`);
    expect(res.status).toBe(400);
    expect(recorder.forTable("nfc_cards").filter((q) => q.op === "update")).toHaveLength(0);
  });

  it("refuses a card whose front is still empty", async () => {
    world({ media_file_id: null });
    const res = await post(`/api/nfc-cards/${CARD}/send`);
    expect(res.status).toBe(400);
  });

  it("scopes the write to the caller's own archive", async () => {
    await post(`/api/nfc-cards/${CARD}/send`);
    const write = recorder.forTable("nfc_cards").find((q) => q.op === "update");
    expect((write?.filters ?? []).map((f) => f.column)).toContain("archive_id");
  });
});

describe("the overview's filters", () => {
  it("refuses a kind it does not know, rather than returning everything", async () => {
    const res = await request(app).get("/api/nfc-cards?kind=flyer").set("Cookie", session());
    expect(res.status).toBe(400);
  });

  it("refuses a state it does not know", async () => {
    const res = await request(app).get("/api/nfc-cards?state=posted").set("Cookie", session());
    expect(res.status).toBe(400);
  });

  it("passes a known filter through to the query", async () => {
    await request(app).get("/api/nfc-cards?kind=postcard&state=draft").set("Cookie", session());
    const read = recorder.forTable("nfc_cards").find((q) => q.op === "select");
    const cols = new Map((read?.filters ?? []).map((f) => [f.column, f.value]));
    expect(cols.get("kind")).toBe("postcard");
    expect(cols.get("state")).toBe("draft");
  });
});
