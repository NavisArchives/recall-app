import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { Readable } from "node:stream";
import { recorder } from "./support/supabaseRecorder.js";

vi.mock("@supabase/supabase-js", () => ({ createClient: () => recorder.client }));
vi.mock("../services/snapshot.js", () => ({
  withSnapshot: async (_name: string, read: () => Promise<unknown>) => ({ data: await read(), stale: false }),
}));
vi.mock("../services/mediaCache.js", () => ({
  openMedia: async () => ({
    stream: Readable.from(Buffer.from("PRIVATE-PHOTO")),
    size: 13,
    fromCache: true,
  }),
  cacheStats: async () => ({}),
  purgeMedia: async () => {},
}));
vi.mock("../services/mediaIndex.js", () => ({
  rememberMedia: async () => {},
  lookupMedia: async () => null,
  forgetMedia: async () => {},
}));

const { createApp } = await import("../app.js");
const { hashPin } = await import("../services/pins.js");
const app = createApp();

const ARCHIVE = "aaaaaaaa-0000-0000-0000-00000000000a";
const PERSON = "aaaaaaaa-0000-0000-0000-0000000000ad";
const INSTALLATION = "aaaaaaaa-0000-0000-0000-0000000000f1";
const CHANNEL = "aaaaaaaa-0000-0000-0000-0000000000c1";
const SECRET = "test-session-secret-that-is-long-enough-32";
const pinHash = await hashPin("482915");

function deviceCookies(tokenRole = "admin") {
  return [
    `recall_device=${jwt.sign({ installationId: INSTALLATION, archiveId: ARCHIVE }, SECRET, { expiresIn: 3600 })}`,
    `recall_profile=${jwt.sign(
      { personId: PERSON, name: "Audit", role: tokenRole, archiveId: ARCHIVE },
      SECRET,
      { expiresIn: 3600 }
    )}`,
  ];
}

function world(role = "admin", status = "active") {
  recorder.reset({
    installations: [{ id: INSTALLATION, archive_id: ARCHIVE, is_trusted: true, revoked_at: null }],
    families: [{
      id: "family-a",
      archive_id: ARCHIVE,
      status: "active",
      session_version: 1,
      password_set_at: null,
      sessions_valid_from: null,
      platform_owner: false,
    }],
    family_sessions: [{
      id: "session-a",
      family_id: "family-a",
      archive_id: ARCHIVE,
      person_id: PERSON,
      role,
      session_version: 1,
      expires_at: "2099-01-01T00:00:00.000Z",
      revoked_at: null,
    }],
    people: [{
      id: PERSON,
      name: "Audit",
      role,
      status,
      archive_id: ARCHIVE,
      archived_at: null,
      pin_hash: pinHash,
      locked_until: null,
    }],
    channels: [{
      id: CHANNEL,
      number: 12,
      title: "Private secret",
      description: "Secret history",
      privacy_level: 1,
      created_by: "another-person",
      archive_id: ARCHIVE,
      author: null,
      media_files: [],
    }],
    media_files: [{
      id: "photo-a",
      channel_id: CHANNEL,
      caption: "Private secret caption",
      file_type: "image",
      storage_path: "audit.jpg",
      display_order: 0,
      archived_at: null,
    }],
    channel_access: [],
    settings: [{ display_name: "Subject", delivery_address: "Sensitive postal address" }],
  });
}

beforeEach(() => world());

describe("public request safety", () => {
  it("rejects a non-string nested subject name and keeps serving requests", async () => {
    const malformed = await request(app).post("/api/onboarding/sign-up").send({
      about: "someone",
      your_name: "Andy",
      email: "andy@example.invalid",
      pin: "482915",
      subject: { full_name: 123 },
    });
    expect(malformed.status).toBe(400);
    expect((await request(app).get("/health")).status).toBe(200);
  });
});

describe("one channel privacy policy protects every read path", () => {
  it("hides a private numbered channel from an ungranted co-author", async () => {
    world("co_author");
    const response = await request(app)
      .get("/api/channels/12")
      .set("Cookie", ["recall_family=opaque-audit-session"]);
    expect(response.status).toBe(404);
  });

  it("excludes private channel text and captions from search", async () => {
    world("co_author");
    const response = await request(app)
      .get("/api/search?q=secret")
      .set("Cookie", ["recall_family=opaque-audit-session"]);
    expect(response.status).toBe(200);
    expect(response.body.results).toEqual([]);
  });

  it("refuses bytes belonging to a private channel", async () => {
    world("co_author");
    const response = await request(app)
      .get("/api/media/photo-a/file")
      .set("Cookie", ["recall_family=opaque-audit-session"]);
    expect(response.status).toBe(404);
  });
});

describe("authorization follows current database state", () => {
  it("does not select admin-only contact fields after demotion or deactivation", async () => {
    for (const status of ["active", "deactivated", "remembered"]) {
      world("co_author", status);
      await request(app).get("/api/people").set("Cookie", deviceCookies("admin"));
      expect(
        recorder
          .forTable("people")
          .some((query) => query.select?.includes("admin_note") || query.select?.includes("contact_number"))
      ).toBe(false);
    }
  });

  it("rejects management writes from a revoked installation", async () => {
    recorder.responses.installations[0].revoked_at = new Date().toISOString();
    const response = await request(app)
      .patch("/api/people/another-person/visibility")
      .set("Cookie", deviceCookies())
      .send({ show_on_display: false });
    expect(response.status).toBe(401);
    expect(recorder.forTable("people").some((query) => query.op === "update")).toBe(false);
  });

  it("does not let a remembered profile reactivate itself", async () => {
    world("admin", "remembered");
    const response = await request(app)
      .post(`/api/auth/profiles/${PERSON}/unlock`)
      .set("Cookie", [deviceCookies()[0]])
      .send({ pin: "482915" });
    expect(response.status).toBe(404);
    expect(recorder.forTable("people").some((query) => query.op === "update")).toBe(false);
  });

  it("does not accept the removed profile-cookie platform-owner fallback", async () => {
    recorder.responses.families[0].platform_owner = true;
    const response = await request(app)
      .get("/api/owner/door")
      .set("Cookie", [deviceCookies()[1]]);
    expect(response.status).toBe(404);
  });

  it("revokes a copied local profile token when that profile signs out", async () => {
    const cookies = deviceCookies();
    const signedOut = await request(app).post("/api/auth/profiles/sign-out").set("Cookie", cookies);
    expect(signedOut.status).toBe(200);
    const stamp = recorder
      .forTable("people")
      .find((query) => query.op === "update" && "profile_sessions_valid_from" in (query.payload ?? {}));
    expect(stamp).toBeDefined();

    recorder.responses.people[0].profile_sessions_valid_from = new Date(Date.now() + 1_000).toISOString();
    const replay = await request(app)
      .patch("/api/people/another-person/visibility")
      .set("Cookie", cookies)
      .send({ show_on_display: false });
    expect(replay.status).toBe(401);
  });
});

describe("failure states are honest and normal batches parse", () => {
  it("reports a failed installation revocation instead of successful sign-out", async () => {
    recorder.failNext = {
      table: "installations",
      op: "update",
      error: { message: "revocation failed" },
    };
    const response = await request(app).post("/api/auth/sign-out").set("Cookie", deviceCookies());
    expect(response.status).toBe(503);
    expect(response.body.ok).toBeUndefined();
  });

  it("parses the supported metadata for a four-photo desktop batch", async () => {
    let upload = request(app)
      .post("/api/media-files")
      .set("Cookie", deviceCookies())
      .field("channel_id", CHANNEL);
    for (let index = 0; index < 4; index += 1) {
      upload = upload
        .attach("files", Buffer.from("not-a-real-photo"), {
          filename: `photo-${index}.jpg`,
          contentType: "image/jpeg",
        })
        .field("captions", "")
        .field("taken_on", "")
        .field("taken_precision", "")
        .field("places", "")
        .field("people", "[]");
    }
    const response = await upload;
    expect(response.status).toBe(400);
    expect(response.body.error).not.toBe("Upload refused.");
  }, 10_000);
});
