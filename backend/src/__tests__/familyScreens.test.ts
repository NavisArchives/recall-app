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
 * 047 — the screens a family can see, and the one it may not retire.
 *
 * Two gaps closed at once, and they are different kinds of gap.
 *
 * The product never answered *"which device is our display?"*. Settings could
 * sign the current browser out and that was all, so a household could not
 * tell a screen that was asleep from one that had been retired, and — if the
 * machine was gone — had no way to free the slot except a link posted to the
 * family inbox. No mail leaves production yet, so that was not a slow path,
 * it was no path.
 *
 * And the exclusivity rule counted every trusted row the same. A family
 * shipped a Recall device had spent its only slot on hardware it never chose
 * to spend it on, while Settings could happily retire the device Recall
 * shipped them — which is not theirs to retire.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";
const ARCHIVE = "aaaaaaaa-0000-0000-0000-00000000000a";
const OTHER_ARCHIVE = "bbbbbbbb-0000-0000-0000-00000000000b";
const ADMIN = "aaaaaaaa-0000-0000-0000-0000000000ad";
const CO_AUTHOR = "aaaaaaaa-0000-0000-0000-0000000000c1";
const INSTALL = "aaaaaaaa-0000-0000-0000-0000000000f1";

const session = (personId: string, role: string) => [
  `recall_device=${jwt.sign({ installationId: INSTALL, archiveId: ARCHIVE }, SECRET, { expiresIn: 3600 })}`,
  `recall_profile=${jwt.sign({ personId, name: "Someone", role, archiveId: ARCHIVE }, SECRET, {
    expiresIn: 3600,
  })}`,
];

const admin = session(ADMIN, "admin");

const person = (id: string, role: string) => ({
  id,
  archive_id: ARCHIVE,
  name: "Someone",
  role,
  status: "active",
  archived_at: null,
});

const HARDWARE = {
  id: "the-hardware",
  archive_id: ARCHIVE,
  name: "Living-room display",
  is_trusted: true,
  is_recall_device: true,
  trusted_at: "2026-01-01T00:00:00.000Z",
  last_used_at: "2026-08-20T00:00:00.000Z",
  software_version: "1.4.0",
  revoked_at: null,
  username: "recall-hw-01",
  secret_hash: "never-leaves-the-row",
};

const BROWSER = {
  id: "their-laptop",
  archive_id: ARCHIVE,
  name: "The family screen",
  is_trusted: true,
  is_recall_device: false,
  trusted_at: "2026-02-01T00:00:00.000Z",
  last_used_at: null,
  software_version: null,
  revoked_at: null,
  username: "web-abc123",
  secret_hash: "never-leaves-the-row",
};

/*
  The caller is always the first `people` row, and the screen under test is
  always the first `installations` row.

  The recorder RECORDS filters and does not apply them — `maybeSingle()`
  hands back `rows[0]` whatever the query asked for. So a fixture is the
  answer the database would have given, and anything about *scoping* has to
  be asserted from the recorded query rather than from what came back. Two
  of these tests were written the other way round first and passed on the
  fake's indifference rather than on the route.
*/
function world(installations: Record<string, unknown>[], caller = person(ADMIN, "admin")) {
  recorder.reset({
    people: [caller],
    installations,
    activity_log: [],
  });
}

beforeEach(() => world([HARDWARE, BROWSER]));

const list = (cookie: string[]) => request(app).get("/api/settings/screens").set("Cookie", cookie);
const retire = (id: string, cookie: string[]) =>
  request(app).post(`/api/settings/screens/${id}/retire`).set("Cookie", cookie);

describe("a family can see which machines are its screens", () => {
  it("lists both kinds and says which is hardware", async () => {
    const res = await list(admin);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const hardware = res.body.find((s: { id: string }) => s.id === "the-hardware");
    const browser = res.body.find((s: { id: string }) => s.id === "their-laptop");
    expect(hardware.is_recall_device).toBe(true);
    expect(browser.is_recall_device).toBe(false);
    expect(hardware.name).toBe("Living-room display");
  });

  /*
    The pairing credential never travels. `username` and `secret_hash` are
    the installation's internal identity (M111) and no Settings page needs
    either — the same discipline the chooser's pill was held to in M146.
  */
  it("never sends the machine's own credential", async () => {
    const res = await list(admin);

    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/secret_hash|never-leaves-the-row/);
    expect(body).not.toMatch(/username|web-abc123|recall-hw-01/);
  });

  /*
    Scoping, asserted from the query the route issued (the invariant every
    archive-scoped read is held to) rather than from rows the fake would
    have returned regardless.
  */
  it("asks only for this archive's screens, and only for trusted ones", async () => {
    await list(admin);

    const read = recorder
      .forTable("installations")
      .find((q) => q.op === "select" && q.filters.some((f) => f.column === "is_trusted"));
    expect(read?.filters).toEqual(
      expect.arrayContaining([
        { method: "eq", column: "archive_id", value: ARCHIVE },
        { method: "eq", column: "is_trusted", value: true },
      ])
    );
    // And never `select("*")`.
    expect(read?.select).toBeTruthy();
    expect(read?.select).not.toContain("*");
  });

  /*
    M221's rule, applied to a new route on the way in rather than after
    somebody is hurt by it. Answering 200 with `[]` here would tell a family
    that nothing is paired — the one sentence that sends somebody to spend a
    slot they have already spent.
  */
  it("fails the read rather than reporting an empty house", async () => {
    recorder.failNext = {
      table: "installations",
      op: "select",
      error: { message: "connection refused" },
    };

    const res = await list(admin);

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(Array.isArray(res.body)).toBe(false);
  });

  it("is administrators only, like the rest of Settings", async () => {
    // The row decides, not the cookie — `requireRole` reloads the caller.
    world([HARDWARE, BROWSER], person(CO_AUTHOR, "co_author"));

    const res = await list(session(CO_AUTHOR, "co_author"));

    expect(res.status).toBe(403);
  });

  it("refuses a caller with no session at all", async () => {
    const res = await request(app).get("/api/settings/screens");

    expect(res.status).toBe(401);
  });
});

describe("retiring a screen", () => {
  it("retires a browser screen the family paired", async () => {
    world([BROWSER, HARDWARE]);

    const res = await retire("their-laptop", admin);

    expect(res.status).toBe(200);

    // By mechanism: the row is untrusted and revoked, not merely reported.
    const writes = recorder.forTable("installations").filter((q) => q.op === "update");
    expect(writes).toHaveLength(1);
    expect(writes[0].payload).toMatchObject({ is_trusted: false });
    expect((writes[0].payload as Record<string, unknown>).revoked_at).toBeTruthy();
  });

  /*
    The heart of it. A Recall device is hardware this project ships; a family
    cannot create one and does not get to retire one. Refused by the ROW —
    the id is looked up and the flag read from the database — rather than by
    anything the caller said about it.
  */
  it("refuses a Recall device, and writes nothing", async () => {
    world([HARDWARE, BROWSER]);

    const res = await retire("the-hardware", admin);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Recall device/i);
    expect(recorder.forTable("installations").filter((q) => q.op === "update")).toHaveLength(0);
  });

  /*
    The fake cannot refuse a cross-tenant row for us, so this asserts the
    thing that does: the lookup is scoped to the caller's archive, and the
    write is scoped again — belt and braces, because a route that finds the
    right row and then writes by id alone is one refactor from writing
    somebody else's.
  */
  it("scopes both the lookup and the write to the caller's archive", async () => {
    world([BROWSER, HARDWARE]);

    await retire("their-laptop", admin);

    const [read] = recorder.forTable("installations").filter((q) => q.op === "select");
    const [write] = recorder.forTable("installations").filter((q) => q.op === "update");

    for (const query of [read, write]) {
      expect(query?.filters).toEqual(
        expect.arrayContaining([{ method: "eq", column: "archive_id", value: ARCHIVE }])
      );
    }
    // And the write refuses hardware a second time, in the statement itself.
    expect(write?.filters).toEqual(
      expect.arrayContaining([{ method: "eq", column: "is_recall_device", value: false }])
    );
  });

  it("refuses a screen that is not trusted, and writes nothing", async () => {
    world([{ ...BROWSER, is_trusted: false }]);

    const res = await retire("their-laptop", admin);

    expect(res.status).toBe(404);
    expect(recorder.forTable("installations").filter((q) => q.op === "update")).toHaveLength(0);
  });

  it("is administrators only", async () => {
    world([BROWSER, HARDWARE], person(CO_AUTHOR, "co_author"));

    const res = await retire("their-laptop", session(CO_AUTHOR, "co_author"));

    expect(res.status).toBe(403);
    expect(recorder.forTable("installations").filter((q) => q.op === "update")).toHaveLength(0);
  });
});
