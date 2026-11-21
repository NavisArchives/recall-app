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
 * 043 — access and visibility are two axes, not one switch.
 *
 * `status` used to decide both: deactivating somebody blocked their sign-in
 * AND was the only way to take their face off the subject's display. An admin
 * could not do one without the other.
 *
 * The half that must not go wrong is the new state. `remembered` — a
 * contributor who has died — has to withdraw sign-in exactly as `deactivated`
 * does. A status that *looks* like it closes a door and silently does not is
 * worse than no status at all, and this file exists mostly to hold that line.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";
const ARCHIVE = "aaaaaaaa-0000-0000-0000-00000000000a";
const ADMIN = "aaaaaaaa-0000-0000-0000-0000000000ad";
const OTHER = "aaaaaaaa-0000-0000-0000-0000000000c1";

const INSTALL = "aaaaaaaa-0000-0000-0000-0000000000f1";

/* Both cookies: these routes want a trusted machine AND a signed-in person. */
const session = (personId: string, role = "admin") => [
  `recall_device=${jwt.sign({ installationId: INSTALL, archiveId: ARCHIVE }, SECRET, { expiresIn: 3600 })}`,
  `recall_profile=${jwt.sign({ personId, name: "Someone", role, archiveId: ARCHIVE }, SECRET, {
    expiresIn: 3600,
  })}`,
];

const person = (over: Record<string, unknown> = {}) => ({
  id: ADMIN,
  archive_id: ARCHIVE,
  name: "Claire",
  role: "admin",
  status: "active",
  show_on_display: true,
  archived_at: null,
  ...over,
});

function world(caller: Record<string, unknown> = {}) {
  // The recorder answers requireRole's reload with the first row.
  recorder.reset({
    people: [person(caller)],
    installations: [
      { id: INSTALL, archive_id: ARCHIVE, is_trusted: true, revoked_at: null },
    ],
  });
}

beforeEach(() => world());

/*
  The gate lives in `requireRole`, so it must be probed with a route that
  uses it. GET /api/people does not — it is device-gated with an optional
  profile — and probing that returned a cheerful 200 for a deactivated
  caller, which reads as "the gate is broken" when it means "wrong door".
  A write route is the honest probe.
*/
const guarded = (cookie: string[]) =>
  request(app).patch(`/api/people/${OTHER}/visibility`).set("Cookie", cookie).send({
    show_on_display: false,
  });

describe("the access axis closes the door at both ends", () => {
  it("refuses a remembered profile, exactly as it refuses a deactivated one", async () => {
    for (const status of ["deactivated", "remembered"]) {
      world({ status });
      const res = await guarded(session(ADMIN));
      expect(res.status, `${status} was allowed through`).toBe(403);
    }
  });

  it("says why in words that fit the state", async () => {
    world({ status: "remembered" });
    const res = await guarded(session(ADMIN));
    // A family member must never read "deactivated" over their mother's name.
    expect(res.body.error).toMatch(/memory/i);
    expect(res.body.error).not.toMatch(/deactivated/i);

    world({ status: "deactivated" });
    const other = await guarded(session(ADMIN));
    expect(other.body.error).toMatch(/deactivated/i);
  });

  it("an active profile still gets through", async () => {
    const res = await guarded(session(ADMIN));
    expect(res.status).not.toBe(403);
  });
});

describe("setting the access axis", () => {
  it("accepts remembered", async () => {
    const res = await request(app)
      .patch(`/api/people/${OTHER}/status`)
      .set("Cookie", session(ADMIN))
      .send({ status: "remembered" });
    expect(res.status).not.toBe(400);
    const write = recorder.forTable("people").find((q) => q.op === "update");
    expect(write?.payload).toMatchObject({ status: "remembered" });
  });

  it("refuses a status it does not know", async () => {
    const res = await request(app)
      .patch(`/api/people/${OTHER}/status`)
      .set("Cookie", session(ADMIN))
      .send({ status: "gone" });
    expect(res.status).toBe(400);
  });

  it("nobody marks themselves remembered — the misclick that locks the family out", async () => {
    const res = await request(app)
      .patch(`/api/people/${ADMIN}/status`)
      .set("Cookie", session(ADMIN))
      .send({ status: "remembered" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/yourself/i);
    expect(recorder.forTable("people").filter((q) => q.op === "update")).toHaveLength(0);
  });
});

describe("the visibility axis moves on its own", () => {
  it("hides a face without touching their access", async () => {
    const res = await request(app)
      .patch(`/api/people/${OTHER}/visibility`)
      .set("Cookie", session(ADMIN))
      .send({ show_on_display: false });
    expect(res.status).not.toBe(400);

    const write = recorder.forTable("people").find((q) => q.op === "update");
    expect(write?.payload).toMatchObject({ show_on_display: false });
    // The whole point of 043: this must not be a status change in disguise.
    expect(write?.payload).not.toHaveProperty("status");
  });

  it("is scoped to the caller's own archive", async () => {
    await request(app)
      .patch(`/api/people/${OTHER}/visibility`)
      .set("Cookie", session(ADMIN))
      .send({ show_on_display: false });
    const write = recorder.forTable("people").find((q) => q.op === "update");
    const columns = (write?.filters ?? []).map((f) => f.column);
    expect(columns).toContain("archive_id");
    expect(write?.filters.find((f) => f.column === "archive_id")?.value).toBe(ARCHIVE);
  });

  it("refuses anything that is not a boolean", async () => {
    for (const bad of ["yes", 1, null, undefined]) {
      world();
      const res = await request(app)
        .patch(`/api/people/${OTHER}/visibility`)
        .set("Cookie", session(ADMIN))
        .send({ show_on_display: bad });
      expect(res.status, `accepted ${JSON.stringify(bad)}`).toBe(400);
      expect(recorder.forTable("people").filter((q) => q.op === "update")).toHaveLength(0);
    }
  });
});
