import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { recorder } from "./support/supabaseRecorder.js";

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => recorder.client,
}));

const { createApp } = await import("../app.js");
const app = createApp();

/**
 * M152 / F50 — the media resolver refuses a null-archive session.
 *
 * The platform owner's session carries a null archive by design (its family
 * owns none), and by rule it reaches no family's content. The person-photo
 * route admits a chooser-stage family session, so this session reached it —
 * and the resolver, scoping by archive only `if (archive)`, then read by id
 * alone across every household. These tests hold the resolver to the rule
 * its sibling `lookupMedia` already keeps: no archive, nothing resolved.
 */

const ARCHIVE_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const FAMILY_A = "aaaaaaaa-0000-0000-0000-0000000000fa";
const PLATFORM_FAMILY = "cccccccc-0000-0000-0000-0000000000fc";
const FOREIGN_PERSON = "aaaaaaaa-0000-0000-0000-0000000000c1";
const MISSING_PERSON = "dddddddd-0000-0000-0000-0000000000d0";

/** The photo route for a person id. */
const photo = (id: string, cookie: string) =>
  request(app).get(`/api/media/person/${id}/photo`).set("Cookie", cookie);

/** The `people` selects a request issued, in order. */
function peopleSelects() {
  return recorder.forTable("people").filter((q) => q.op === "select");
}

/**
 * The platform owner's world: a session whose family owns no archive. The
 * chooser stage — no person chosen — is exactly where the leak lived.
 */
function platformOwnerWorld(foreignPhoto: string | null = "a/real/family/face.jpg") {
  recorder.reset({
    family_sessions: [
      {
        id: "sess-owner",
        family_id: PLATFORM_FAMILY,
        archive_id: null,
        person_id: null,
        role: null,
        session_version: 1,
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        revoked_at: null,
      },
    ],
    families: [{ id: PLATFORM_FAMILY, archive_id: null, session_version: 1, status: "active" }],
    // Family A's real person, sitting in the table the resolver would read.
    people: [{ id: FOREIGN_PERSON, archive_id: ARCHIVE_A, profile_picture_path: foreignPhoto }],
  });
}

/** An ordinary family's own chooser-stage session. */
function ownFamilyWorld() {
  recorder.reset({
    family_sessions: [
      {
        id: "sess-a",
        family_id: FAMILY_A,
        archive_id: ARCHIVE_A,
        person_id: null,
        role: null,
        session_version: 1,
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        revoked_at: null,
      },
    ],
    families: [{ id: FAMILY_A, archive_id: ARCHIVE_A, session_version: 1, status: "active" }],
    people: [{ id: FOREIGN_PERSON, archive_id: ARCHIVE_A, profile_picture_path: "own/face.jpg" }],
  });
}

const OWNER_COOKIE = "recall_family=an-opaque-owner-token";
const FAMILY_COOKIE = "recall_family=an-opaque-family-token";

beforeEach(() => platformOwnerWorld());

describe("a null-archive session resolves no family's media", () => {
  it("refuses a foreign person's photo — 404, and never reads it by id alone", async () => {
    const res = await photo(FOREIGN_PERSON, OWNER_COOKIE);

    // The refusal reads as a missing file, not a forbidden one.
    expect(res.status).toBe(404);

    // The mechanism: either no people query fired, or every one that did
    // carried an archive filter. The resolver must never read by id alone.
    for (const q of peopleSelects()) {
      const scoped = q.filters.some((f) => f.method === "eq" && f.column === "archive_id");
      expect(scoped).toBe(true);
    }
    // And in fact it short-circuits before any read.
    expect(peopleSelects()).toHaveLength(0);
  });

  it("gives no oracle — a real foreign id answers exactly as a missing one", async () => {
    const real = await photo(FOREIGN_PERSON, OWNER_COOKIE);

    platformOwnerWorld();
    recorder.responses.people = []; // the id exists nowhere
    const missing = await photo(MISSING_PERSON, OWNER_COOKIE);

    expect(real.status).toBe(missing.status);
    expect(real.status).toBe(404);
  });
});

describe("an ordinary family still resolves its own photos", () => {
  it("scopes the lookup to the session's own archive (no regression)", async () => {
    ownFamilyWorld();
    await photo(FOREIGN_PERSON, FAMILY_COOKIE);

    const selects = peopleSelects();
    expect(selects.length).toBeGreaterThan(0);
    // Every read carried this family's archive — nobody else's.
    for (const q of selects) {
      expect(q.filters.some((f) => f.column === "archive_id" && f.value === ARCHIVE_A)).toBe(true);
    }
  });
});
