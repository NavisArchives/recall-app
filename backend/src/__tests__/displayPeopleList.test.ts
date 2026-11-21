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
 * Her screen is only sent the people it may show (M210).
 *
 * The defect this pins was live on the normal path, every load of channel 10.
 * The display has a device session and no acting profile, so it was served
 * `PERSON_COLUMNS` — which carries neither `role` nor `show_on_display` — and
 * the two guards in `Social.tsx` compared `undefined` against "user" and
 * `false`. `undefined !== "user"` and `undefined !== false` are both true, so
 * both guards passed everything: the subject appeared in her own list of the
 * people in her life, and anyone a family had switched off appeared anyway.
 *
 * The fix does not widen the payload. It filters before sending, so the
 * browser cannot render what it never receives — which means these tests
 * assert on the QUERY the route issues, not on the fields in the response.
 * That is the honest instrument for a fix of this shape: the question is no
 * longer "did the field arrive?" but "did the row ever leave?".
 */

const SECRET = "test-session-secret-that-is-long-enough-32";
const ARCHIVE = "aaaaaaaa-0000-0000-0000-00000000000a";
const INSTALL = "aaaaaaaa-0000-0000-0000-0000000000f1";
const ADMIN = "aaaaaaaa-0000-0000-0000-0000000000ad";

/** Her screen: a trusted machine, nobody signed in on it. */
const deviceOnly = [
  `recall_device=${jwt.sign({ installationId: INSTALL, archiveId: ARCHIVE }, SECRET, {
    expiresIn: 3600,
  })}`,
];

/** A person on their own phone: device plus a profile. */
const withProfile = [
  ...deviceOnly,
  `recall_profile=${jwt.sign(
    { personId: ADMIN, name: "Claire", role: "admin", archiveId: ARCHIVE },
    SECRET,
    { expiresIn: 3600 }
  )}`,
];

function world() {
  recorder.reset({
    people: [
      {
        id: ADMIN,
        archive_id: ARCHIVE,
        name: "Claire",
        role: "admin",
        status: "active",
        show_on_display: true,
        archived_at: null,
      },
    ],
    installations: [{ id: INSTALL, archive_id: ARCHIVE, is_trusted: true, revoked_at: null }],
  });
}

beforeEach(world);

/** The filters the route put on the people query, as (column → value). */
async function peopleQueryFilters(cookie: string[]) {
  await request(app).get("/api/people").set("Cookie", cookie);
  const q = recorder.forTable("people").find((x) => x.op === "select");
  return new Map((q?.filters ?? []).map((f) => [`${f.method}:${f.column}`, f.value]));
}

describe("the display is never sent people it must not show", () => {
  it("excludes the subject — she is not a visitor to her own life", async () => {
    const filters = await peopleQueryFilters(deviceOnly);
    expect(filters.get("neq:role")).toBe("user");
  });

  it("excludes anyone the family switched off — the criterion that failed", async () => {
    const filters = await peopleQueryFilters(deviceOnly);
    expect(filters.get("eq:show_on_display")).toBe(true);
  });

  it("still scopes to the archive — the new filters are additions, not a replacement", async () => {
    const filters = await peopleQueryFilters(deviceOnly);
    expect(filters.get("eq:archive_id")).toBe(ARCHIVE);
    expect(filters.has("is:archived_at")).toBe(true);
  });
});

describe("what the fix must not break", () => {
  /*
    The positive control. A fix that simply hid people would pass every test
    above and be a worse bug than the one it replaced — "her family
    disappearing off her wall" is the failure this mission weighs as worse
    than the one it is fixing.
  */
  it("does not narrow the list for a person on their own phone", async () => {
    const filters = await peopleQueryFilters(withProfile);
    expect(filters.has("neq:role")).toBe(false);
    expect(filters.has("eq:show_on_display")).toBe(false);
  });

  it("answers the display at all — the request still succeeds", async () => {
    const res = await request(app).get("/api/people").set("Cookie", deviceOnly);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe("the display's payload stays as narrow as it was", () => {
  /*
    The whole argument for filtering server-side rather than widening the
    column list: the kiosk gains no new field. `email`, `contact_number` and
    `address` were never in it and must not arrive now — and neither should
    `role` or `show_on_display`, because the display no longer needs them.
  */
  it("sends no contact detail, and no new field either", async () => {
    await request(app).get("/api/people").set("Cookie", deviceOnly);
    const selected = recorder.forTable("people").find((q) => q.op === "select")?.select ?? "";

    for (const forbidden of ["email", "contact_number", "address"]) {
      expect(selected, `${forbidden} reached the display`).not.toContain(forbidden);
    }
    // Not needed any more, so not sent — this is the trade the fix makes.
    expect(selected).not.toContain("role");
    expect(selected).not.toContain("show_on_display");
  });
});
