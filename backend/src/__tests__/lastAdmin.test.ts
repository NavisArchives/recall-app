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
 * The family must never be left with nobody who can administer it.
 *
 * Two of the three routes that can remove an admin already refused the obvious
 * version — you cannot change your own role, and you cannot pause or remember
 * yourself. `DELETE /people/:id` refused nothing. It archived whatever row it
 * was handed, so the only admin could archive themselves, and no route that
 * could appoint a replacement is reachable without an admin to call it. The
 * archive stays readable and becomes permanently unmanageable.
 *
 * These tests are about the state after the call, not the wording of it: each
 * one asserts that no write reached the database, because a 400 with the row
 * already updated would be the same disaster with better manners.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";
const ARCHIVE = "aaaaaaaa-0000-0000-0000-00000000000a";
const ADMIN = "aaaaaaaa-0000-0000-0000-0000000000ad";
const ADMIN_TWO = "aaaaaaaa-0000-0000-0000-0000000000a2";
const CO_AUTHOR = "aaaaaaaa-0000-0000-0000-0000000000c1";
const INSTALL = "aaaaaaaa-0000-0000-0000-0000000000f1";

const session = (personId: string) => [
  `recall_device=${jwt.sign({ installationId: INSTALL, archiveId: ARCHIVE }, SECRET, { expiresIn: 3600 })}`,
  `recall_profile=${jwt.sign({ personId, name: "Someone", role: "admin", archiveId: ARCHIVE }, SECRET, {
    expiresIn: 3600,
  })}`,
];

const person = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  archive_id: ARCHIVE,
  name: "Someone",
  role: "admin",
  status: "active",
  show_on_display: true,
  archived_at: null,
  ...over,
});

/*
  The caller is always the first row — that is the one `requireRole` reloads.
  Everything after it is the rest of the family, and it is what the guard
  counts.
*/
function family(...rest: Record<string, unknown>[]) {
  recorder.reset({
    people: [person(ADMIN), ...rest],
    installations: [{ id: INSTALL, archive_id: ARCHIVE, is_trusted: true, revoked_at: null }],
  });
}

const writes = () =>
  recorder.forTable("people").filter((q) => q.op === "update" || q.op === "delete");

beforeEach(() => family());

describe("the last admin cannot be removed", () => {
  // This one fails against the unguarded route: 204, row archived, family
  // locked out. It is the reason the rest of this file exists.
  it("refuses to archive them — the route that had no guard at all", async () => {
    const res = await request(app).delete(`/api/people/${ADMIN}`).set("Cookie", session(ADMIN));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only admin/i);
    // The refusal is worth nothing if the row was archived on the way to it.
    expect(writes()).toHaveLength(0);
  });

  /*
    These next two pass against the unguarded routes as well, and that is the
    honest reading: the self-guard already catches them, because an admin
    caller is themselves an active admin, so removing a *different* admin can
    never be removing the last one. The backstop is a second line — it earns
    its place the day someone relaxes the self-guard, which is exactly how the
    delete route came to have no guard at all.
  */
  it("refuses to demote them", async () => {
    const res = await request(app)
      .patch(`/api/people/${ADMIN}/role`)
      .set("Cookie", session(ADMIN))
      .send({ role: "co_author" });

    expect(res.status).toBe(400);
    expect(writes()).toHaveLength(0);
  });

  it("refuses to pause or remember them", async () => {
    for (const status of ["deactivated", "remembered"]) {
      family();
      const res = await request(app)
        .patch(`/api/people/${ADMIN}/status`)
        .set("Cookie", session(ADMIN))
        .send({ status });

      expect(res.status, `${status} was allowed`).toBe(400);
      expect(writes()).toHaveLength(0);
    }
  });

  /*
    The pin for the fail-closed operand itself (M185/F73): `error || !data`
    must answer "cannot remove", and this is the only test that reddens if it
    answers "can".

    The `select` key is what makes it honest. This route reads `people`
    twice — requireRole reloads the caller, then the guard counts — and the
    first version of this test failed the *next* people select, which was the
    middleware's. The request died before the guard ran, `.not.toBe(204)`
    passed vacuously, and flipping the operand to fail-open left all 416
    tests green. Keying the outage to the guard's exact select shape, with a
    SECOND admin standing so nothing else can refuse for it, means the 400
    below can only come from the guard's own error branch.

    Operand sweep (M171 doctrine), so nobody re-runs it blind: flipping the
    branch to `return false` reddens exactly this test — that is the pin.
    Deleting either operand alone stays green, and both are fail-safe
    redundancies rather than holes: an errored read always carries
    `data: null`, so `!data` alone still refuses; and a list select answers
    `[]`, never null-without-error, so `error` alone loses nothing (a null
    would throw in the count, not approve). Neither gets a pin.
  */
  it("refuses when it cannot count them — not knowing is not permission", async () => {
    // Two able admins: without the outage this delete would be a clean 204,
    // so no self-guard or last-admin count is available to mask the answer.
    family(person(ADMIN_TWO));
    recorder.failNext = {
      table: "people",
      op: "select",
      select: "id, role, status", // the guard's count — not the middleware reload
      error: { message: "connection lost" },
    };

    const res = await request(app).delete(`/api/people/${ADMIN}`).set("Cookie", session(ADMIN));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only admin/i);
    expect(writes()).toHaveLength(0);
    // The outage reached the guard, not the middleware: the reload succeeded
    // and the count query was recorded before it died.
    const counts = recorder
      .forTable("people")
      .filter((q) => q.op === "select" && q.select === "id, role, status");
    expect(counts).toHaveLength(1);
  });
});

describe("what the guard must not block", () => {
  it("lets an admin go when a second one is left standing", async () => {
    family(person(ADMIN_TWO));

    const res = await request(app).delete(`/api/people/${ADMIN}`).set("Cookie", session(ADMIN));

    expect(res.status).toBe(204);
    expect(recorder.forTable("people").some((q) => q.op === "update")).toBe(true);
  });

  it("does not count a paused admin as a standing one", async () => {
    // Two admin rows, but only one of them can sign in — so this is still
    // the last admin, and the count has to know that.
    family(person(ADMIN_TWO, { status: "deactivated" }));

    const res = await request(app).delete(`/api/people/${ADMIN}`).set("Cookie", session(ADMIN));

    expect(res.status).toBe(400);
    expect(writes()).toHaveLength(0);
  });

  it("does not count a remembered admin either", async () => {
    family(person(ADMIN_TWO, { status: "remembered" }));

    const res = await request(app).delete(`/api/people/${ADMIN}`).set("Cookie", session(ADMIN));

    expect(res.status).toBe(400);
    expect(writes()).toHaveLength(0);
  });

  it("leaves ordinary people alone — a co-author is not an admin", async () => {
    family(person(CO_AUTHOR, { role: "co_author" }));

    const res = await request(app)
      .delete(`/api/people/${CO_AUTHOR}`)
      .set("Cookie", session(ADMIN));

    expect(res.status).toBe(204);
  });

  it("still lets the last admin be promoted to admin — a no-op, not a removal", async () => {
    const res = await request(app)
      .patch(`/api/people/${ADMIN_TWO}/role`)
      .set("Cookie", session(ADMIN))
      .send({ role: "admin" });

    expect(res.status).not.toBe(400);
  });
});
