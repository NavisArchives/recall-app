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
 * Who, where and when (059) — the optional detail the owner asked for:
 * "each and every added item also deserves to have people, locations, a more
 * specific date."
 *
 * The tests here are about the two ways this feature can be quietly wrong.
 *
 * FIRST, ATTACHING A NAME TO THE WRONG PHOTOGRAPH. The upload writes the
 * photographs and then writes who is in each one, which means it has to match
 * the ids it got back to the files it sent. Matching by the order the database
 * answered in would work almost always and fail silently the rest of the time
 * — Marie recorded as being in a photograph she is not in, in an archive whose
 * whole purpose is to be trusted by someone who cannot check it.
 *
 * SECOND, A LIST THAT BECOMES USELESS. One spelling per archive is what makes
 * "places" a list rather than forty near-duplicates, and the test for it is
 * that the same word typed twice inserts once.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";
const ARCHIVE = "aaaaaaaa-0000-0000-0000-00000000000a";
const INSTALL = "aaaaaaaa-0000-0000-0000-0000000000f1";
const ADMIN = "aaaaaaaa-0000-0000-0000-0000000000ad";
const MARIE = "aaaaaaaa-0000-0000-0000-0000000000m1".replace("m1", "b1");
const PAUL = "aaaaaaaa-0000-0000-0000-0000000000c1";
const CHANNEL = "aaaaaaaa-0000-0000-0000-0000000000ch";

function cookies() {
  const device = jwt.sign({ installationId: INSTALL, archiveId: ARCHIVE }, SECRET, { expiresIn: 3600 });
  const profile = jwt.sign(
    { personId: ADMIN, name: "Admin", role: "admin", archiveId: ARCHIVE },
    SECRET,
    { expiresIn: 3600 }
  );
  return [`recall_device=${device}`, `recall_profile=${profile}`];
}

/** A real JPEG header, so magic-byte validation admits it. */
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

/**
 * The world every test starts in.
 *
 * `media_files:insert` answers in REVERSED order on purpose. Nothing promises
 * the order an insert answers in, so the route must not lean on it; a stub
 * that answers tidily would let a route that leans on it stay green forever.
 */
function world(over: Record<string, Record<string, unknown>[]> = {}) {
  recorder.reset(
    {
      installations: [{ id: INSTALL, archive_id: ARCHIVE, is_trusted: true, revoked_at: null }],
      families: [{ id: "fam", archive_id: ARCHIVE, password_set_at: null, sessions_valid_from: null }],
      people: [
        { id: ADMIN, name: "Admin", role: "admin", status: "active", archived_at: null, archive_id: ARCHIVE },
      ],
      channels: [{ id: CHANNEL, archive_id: ARCHIVE, created_by: ADMIN, content_type: "album", number: 7, title: "Ostend" }],
      media_files: [{ display_order: 4 }],
      places: [],
      tags: [],
      channel_tags: [],
      media_people: [],
      ...over,
    },
    {
      "media_files:insert": [
        { id: "photo-second", display_order: 6 },
        { id: "photo-first", display_order: 5 },
      ],
      // The people the vocabulary service checks belong to this archive. Its
      // read selects "id"; requireRole's read of the same table selects far
      // more, so the two do not collide.
      "people:select:id": [{ id: MARIE }, { id: PAUL }],
    }
  );
}

beforeEach(() => world());

function upload(fields: Record<string, string[]>) {
  let req = request(app)
    .post("/api/media-files")
    .set("Cookie", cookies())
    .field("channel_id", CHANNEL)
    .attach("files", JPEG, "one.jpg")
    .attach("files", JPEG, "two.jpg");
  for (const [name, values] of Object.entries(fields)) {
    for (const value of values) req = req.field(name, value);
  }
  return req;
}

describe("who is in a photograph travels with the right photograph", () => {
  it("matches people to files by the order this route assigned, not the order the database answered in", async () => {
    const response = await upload({
      captions: ["", ""],
      taken_on: ["", ""],
      taken_precision: ["", ""],
      places: ["", ""],
      people: [JSON.stringify([MARIE]), JSON.stringify([PAUL])],
    });

    expect(response.status).toBe(201);

    /*
      One call to attach people per file that named any, in file order. The
      claim under test is which media id each call used: the stub answers the
      insert REVERSED, so a route that read the answer positionally would put
      the first file's people on the second file's row.

      Asserted through the delete each call issues, because that is where the
      media id appears as a filter rather than inside a payload the stub also
      shapes.
    */
    const touched = recorder
      .forTable("media_people")
      .filter((q) => q.op === "delete")
      .map((q) => q.filters.find((f) => f.column === "media_file_id")?.value);

    expect(touched).toEqual(["photo-first", "photo-second"]);

    const firstCall = recorder
      .forTable("media_people")
      .filter((q) => q.op === "insert")
      .flatMap((q) => (Array.isArray(q.payload) ? q.payload : [q.payload!]))
      .filter((row) => (row as { media_file_id: string }).media_file_id === "photo-first");
    expect(firstCall.length).toBeGreaterThan(0);
  });

  it("names the family on every row it writes, and on the delete that precedes it", async () => {
    await upload({
      captions: ["", ""],
      taken_on: ["", ""],
      taken_precision: ["", ""],
      places: ["", ""],
      people: [JSON.stringify([MARIE]), "[]"],
    });

    const rows = recorder
      .forTable("media_people")
      .filter((q) => q.op === "insert")
      .flatMap((q) => (Array.isArray(q.payload) ? q.payload : [q.payload!]));
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((row) => expect(row).toMatchObject({ archive_id: ARCHIVE }));

    recorder
      .forTable("media_people")
      .filter((q) => q.op === "delete")
      .forEach((q) =>
        expect(q.filters).toContainEqual(
          expect.objectContaining({ method: "eq", column: "archive_id", value: ARCHIVE })
        )
      );
  });

  it("a malformed people field costs the detail, never the photographs", async () => {
    const response = await upload({
      captions: ["", ""],
      taken_on: ["", ""],
      taken_precision: ["", ""],
      places: ["", ""],
      people: ["not json at all", JSON.stringify(["not-a-uuid"])],
    });

    expect(response.status).toBe(201);
    expect(response.body.count).toBe(2);
    expect(recorder.forTable("media_people").filter((q) => q.op === "insert")).toHaveLength(0);
  });
});

describe("a place is written once, however many photographs name it", () => {
  it("inserts one row for the same word typed twice, in two spellings", async () => {
    await upload({
      captions: ["", ""],
      taken_on: ["", ""],
      taken_precision: ["", ""],
      places: ["Ostend", "  ostend "],
      people: ["[]", "[]"],
    });

    const inserted = recorder
      .forTable("places")
      .filter((q) => q.op === "insert")
      .flatMap((q) => (Array.isArray(q.payload) ? q.payload : [q.payload!]));

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ name: "Ostend", archive_id: ARCHIVE });
  });

  it("uses the place the archive already has rather than inventing a second", async () => {
    world({ places: [{ id: "place-ostend", name: "Ostend" }] });

    await upload({
      captions: ["", ""],
      taken_on: ["", ""],
      taken_precision: ["", ""],
      places: ["ostend", "OSTEND"],
      people: ["[]", "[]"],
    });

    expect(recorder.forTable("places").filter((q) => q.op === "insert")).toHaveLength(0);

    const rows = recorder
      .forTable("media_files")
      .filter((q) => q.op === "insert")
      .flatMap((q) => (Array.isArray(q.payload) ? q.payload : [q.payload!]));
    expect(rows.every((row) => row.place_id === "place-ostend")).toBe(true);
  });

  it("reads the archive's own places and nobody else's", async () => {
    const response = await request(app).get("/api/places").set("Cookie", cookies());
    expect(response.status).toBe(200);
    expect(recorder.forTable("places")[0].filters).toContainEqual(
      expect.objectContaining({ method: "eq", column: "archive_id", value: ARCHIVE })
    );
  });
});

describe("a date says how much of itself is real", () => {
  it("keeps the day when the family chose one", async () => {
    await upload({
      captions: ["", ""],
      taken_on: ["1978-08-03", "1978-08-01"],
      taken_precision: ["day", "month"],
      places: ["", ""],
      people: ["[]", "[]"],
    });

    const rows = recorder
      .forTable("media_files")
      .filter((q) => q.op === "insert")
      .flatMap((q) => (Array.isArray(q.payload) ? q.payload : [q.payload!]));

    expect(rows[0]).toMatchObject({ taken_on: "1978-08-03", taken_precision: "day" });
    expect(rows[1]).toMatchObject({ taken_on: "1978-08-01", taken_precision: "month" });
  });

  it("reads a silent client as month, because every date field in the product is a month picker", async () => {
    await upload({
      captions: ["", ""],
      taken_on: ["1978-08-01", ""],
      places: ["", ""],
      people: ["[]", "[]"],
    });

    const rows = recorder
      .forTable("media_files")
      .filter((q) => q.op === "insert")
      .flatMap((q) => (Array.isArray(q.payload) ? q.payload : [q.payload!]));

    expect(rows[0]).toMatchObject({ taken_precision: "month" });
    // No date at all means no precision to state — the two are one fact.
    expect(rows[1]).toMatchObject({ taken_on: null, taken_precision: null });
  });
});

describe("a channel can say what it is about, in the family's own words", () => {
  it("creates the tags it has never seen and links them to the channel, scoped to the archive", async () => {
    world({ channels: [{ id: "new-channel", number: 12, title: "Summers" }] });

    const response = await request(app)
      .post("/api/channels")
      .set("Cookie", cookies())
      .send({ number: 12, title: "Summers", content_type: "album", tags: ["Childhood", "childhood", "Holiday"] });

    expect(response.status).toBe(201);

    const made = recorder
      .forTable("tags")
      .filter((q) => q.op === "insert")
      .flatMap((q) => (Array.isArray(q.payload) ? q.payload : [q.payload!]));

    // "Childhood" and "childhood" are one word, so two rows, not three.
    expect(made.map((row) => row.name)).toEqual(["Childhood", "Holiday"]);
    made.forEach((row) => expect(row).toMatchObject({ archive_id: ARCHIVE }));

    recorder
      .forTable("channel_tags")
      .forEach((q) =>
        expect(q.filters.concat(
          Array.isArray(q.payload)
            ? q.payload.map((row) => ({
                method: "eq",
                column: "archive_id",
                value: (row as { archive_id: string }).archive_id,
              }))
            : []
        )).toContainEqual(
          expect.objectContaining({ method: "eq", column: "archive_id", value: ARCHIVE })
        )
      );
  });

  it("refuses a tags field that is not a list of words", async () => {
    const response = await request(app)
      .post("/api/channels")
      .set("Cookie", cookies())
      .send({ number: 12, title: "Summers", content_type: "album", tags: [{ name: "childhood" }] });

    expect(response.status).toBe(400);
    expect(recorder.forTable("tags").filter((q) => q.op === "insert")).toHaveLength(0);
  });
});
