import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { recorder } from "./support/supabaseRecorder.js";

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => recorder.client,
}));

const { createApp } = await import("../app.js");
const app = createApp();

/**
 * M108 — the remote chooser's tiles say who a face is.
 *
 * Frame 2a puts "name · relationship · role" on every tile, so the route
 * gains `relationship` — a fact about the family, like the role, not a
 * contact detail. The recorder answers with the whole fixture row whatever
 * the select said, which makes these tests the leak detector too: the row
 * offers an email and a phone number, and the response must not.
 */

const ARCHIVE_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const FAMILY_A = "aaaaaaaa-0000-0000-0000-0000000000fa";
const ADMIN_A = "aaaaaaaa-0000-0000-0000-0000000000ad";

beforeEach(() => {
  recorder.reset({
    family_sessions: [
      {
        id: "sess-1",
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
    archives: [{ id: ARCHIVE_A }],
    people: [
      {
        id: ADMIN_A,
        name: "Claire Fournier",
        relationship: "Daughter",
        role: "admin",
        status: "active",
        archived_at: null,
        archive_id: ARCHIVE_A,
        pin_hash: "some-hash",
        locked_until: null,
        profile_picture_path: "profiles/claire.jpg",
        email: "claire@example.invalid",
        contact_number: "+3222222222",
      },
    ],
  });
});

describe("the family chooser's tiles", () => {
  /*
   * The spec's own words for this screen: "a password alone gets you this
   * list and no further, so it says as little as a front door does — a
   * first name and a face." The face was the half never delivered: the
   * route reported `has_photo` — that a photograph exists — and then kept
   * it, so every tile drew initials for people who had uploaded a picture
   * of themselves. The URL is the stable backend one, never the storage
   * path.
   */
  it("carry the face people actually uploaded", async () => {
    const res = await request(app)
      .get("/api/family/profiles")
      .set("Cookie", ["recall_family=any-opaque-token"]);

    expect(res.status).toBe(200);
    expect(res.body.profiles[0].photo_url).toBe(
      `http://localhost:4000/api/media/person/${ADMIN_A}/photo`
    );
    // The private storage path never leaves the server.
    expect(JSON.stringify(res.body)).not.toContain("profiles/claire.jpg");
  });

  it("reads the roster scoped to the session's own archive, never every family's (F68 #12)", async () => {
    /*
      Deleting `.eq("archive_id", session.archiveId)` from the roster read
      returns every family's people into this remote chooser. The recorder
      ignores filters and answers with the seeded row whatever the query said,
      so no response body sees the scope vanish — the read's shape is asserted
      directly. This is the seam Feedback found bare (F68 #12).
    */
    await request(app)
      .get("/api/family/profiles")
      .set("Cookie", ["recall_family=any-opaque-token"]);

    const rosterReads = recorder.forTable("people").filter((q) => q.op === "select");
    expect(rosterReads.length).toBeGreaterThan(0);
    for (const q of rosterReads) {
      expect(
        q.filters.some((f) => f.method === "eq" && f.column === "archive_id" && f.value === ARCHIVE_A)
      ).toBe(true);
    }
  });

  it("says null rather than a broken image when there is no photograph", async () => {
    recorder.responses.people = [
      {
        id: ADMIN_A,
        name: "Claire Fournier",
        relationship: "Daughter",
        role: "admin",
        status: "active",
        archived_at: null,
        archive_id: ARCHIVE_A,
        pin_hash: "some-hash",
        locked_until: null,
        profile_picture_path: null,
      },
    ];

    const res = await request(app)
      .get("/api/family/profiles")
      .set("Cookie", ["recall_family=any-opaque-token"]);

    expect(res.body.profiles[0].photo_url).toBe(null);
  });

  it("carry the relationship, and never a contact detail", async () => {
    const res = await request(app)
      .get("/api/family/profiles")
      .set("Cookie", ["recall_family=any-opaque-token"]);

    expect(res.status).toBe(200);
    expect(res.body.profiles[0]).toMatchObject({
      name: "Claire Fournier",
      relationship: "Daughter",
      role: "admin",
    });

    const text = JSON.stringify(res.body);
    expect(text).not.toContain("example.invalid");
    expect(text).not.toContain("+32");
    expect(text).not.toContain("hash");
  });
});

describe("the pre-auth pill's name (M146)", () => {
  /*
   * The chooser is the *only* call an un-elevated family session may make —
   * the elevation gate (launch hardening) closed `/screen-state` to it, which
   * silently left the 2a pill with no data at all. So the display's own label
   * rides here, where the pill can actually read it.
   *
   * The label, and nothing else. The channel she is watching right now is a
   * fact about *her*, and the gate took it out of pre-auth deliberately —
   * restoring it to satisfy a pill would undo somebody's security work for a
   * cosmetic gain.
   */
  it("names the family's screen, without saying what is playing on it", async () => {
    recorder.responses.installations = [
      {
        id: "aaaaaaaa-0000-0000-0000-0000000000f1",
        archive_id: ARCHIVE_A,
        name: "Living-room display",
        is_trusted: true,
        revoked_at: null,
        username: "web-9d21aa77",
      },
    ];
    recorder.responses.settings = [
      { archive_id: ARCHIVE_A, current_channel_number: 6, screen_synced_at: new Date().toISOString() },
    ];

    const res = await request(app)
      .get("/api/family/profiles")
      .set("Cookie", ["recall_family=any-opaque-token"]);

    expect(res.status).toBe(200);
    expect(res.body.display_name).toBe("Living-room display");
    // Not what is on her screen, and never the machine's own credential id.
    expect(res.body).not.toHaveProperty("current_channel_number");
    expect(JSON.stringify(res.body)).not.toContain("web-9d21aa77");
  });

  it("says null when the family has no trusted screen", async () => {
    recorder.responses.installations = [];
    const res = await request(app)
      .get("/api/family/profiles")
      .set("Cookie", ["recall_family=any-opaque-token"]);

    expect(res.body.display_name).toBe(null);
  });
});
