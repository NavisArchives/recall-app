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
 * M165 / F60 — no route hands a signed Supabase URL to the browser.
 *
 * The kiosk chooser and the display's own settings used to return
 * `signUrl(...)` — a project-ref-bearing, hour-lived bearer URL into private
 * storage — on the living-room machine, pre-PIN, outliving every revocation.
 * Every private photo is served through the backend now: archive-scoped,
 * behind our guards, revocable. The recorder's signed-URL stub answers
 * `https://example.invalid/x`, so a leak would be visible as that host; the
 * backend URL is our own `/api/media/...`.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";
const ARCHIVE_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const INSTALL_A = "aaaaaaaa-0000-0000-0000-0000000000f1";
const SUBJECT_A = "aaaaaaaa-0000-0000-0000-0000000000c1";

const trustedDevice = `recall_device=${jwt.sign(
  { installationId: INSTALL_A, archiveId: ARCHIVE_A },
  SECRET,
  { expiresIn: 3600 }
)}`;

/** A session whose family owns no archive — the platform owner (M152). */
const nullArchiveDevice = `recall_device=${jwt.sign(
  { installationId: "cccccccc-0000-0000-0000-0000000000f1" },
  SECRET,
  { expiresIn: 3600 }
)}`;

beforeEach(() => {
  recorder.reset({
    installations: [{ id: INSTALL_A, archive_id: ARCHIVE_A, is_trusted: true, revoked_at: null }],
    families: [{ id: "fam", archive_id: ARCHIVE_A, session_version: 1, status: "active", password_set_at: null, sessions_valid_from: null }],
    people: [
      {
        id: SUBJECT_A,
        name: "Margaret",
        relationship: null,
        role: "user",
        status: "active",
        profile_picture_path: "subject/face.jpg",
        pin_hash: null,
        locked_until: null,
        archived_at: null,
      },
    ],
    settings: [{ archive_id: ARCHIVE_A, display_name: "Margaret", photo_path: "subject/face.jpg" }],
  });
});

describe("the kiosk chooser serves faces through the backend", () => {
  it("returns a backend media URL, never a signed Supabase one (M165)", async () => {
    const res = await request(app).get("/api/auth/profiles").set("Cookie", trustedDevice);
    expect(res.status).toBe(200);
    const url = res.body[0]?.photo_url as string;
    expect(url).toContain(`/api/media/person/${SUBJECT_A}/photo`);
    expect(url).not.toContain("example.invalid");
    expect(url).not.toContain("token");
  });
});

describe("the display's settings serve her portrait through the backend", () => {
  it("returns /api/media/subject/photo, never a signed URL (M165 twin)", async () => {
    const res = await request(app).get("/api/settings").set("Cookie", trustedDevice);
    expect(res.status).toBe(200);
    expect(res.body.photo_url).toContain("/api/media/subject/photo");
    expect(res.body.photo_url).not.toContain("example.invalid");
  });

  it("serves nothing to a null-archive session — no cross-tenant face (M152 shape)", async () => {
    // The device's own row carries a null archive (the platform-owner shape);
    // a real family's settings photo sits in the table it must not reach.
    recorder.reset({
      installations: [{ id: INSTALL_A, archive_id: null, is_trusted: false, revoked_at: null }],
      families: [{ id: "fam", archive_id: ARCHIVE_A, session_version: 1, status: "active" }],
      settings: [{ archive_id: ARCHIVE_A, photo_path: "subject/face.jpg" }],
    });
    const res = await request(app).get("/api/media/subject/photo").set("Cookie", nullArchiveDevice);
    // No archive → the route refuses before it reads settings: same 404 as a
    // missing photo, never family A's face.
    expect(res.status).toBe(404);
  });
});

/*
 * The last caller of the signed-URL helpers was the owner's print sheet
 * (29 Sep review, secrets-3); its photo is streamed through the backend now
 * and the helpers are gone. A new `createSignedUrl` anywhere in shipped code
 * would bring back the bearer link these tests exist to keep out.
 */
describe("nothing in the backend mints a signed storage URL", () => {
  it("no source file outside the tests calls createSignedUrl(s)", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = new URL("..", import.meta.url).pathname;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          if (name !== "__tests__") walk(full);
        } else if (name.endsWith(".ts") && /createSignedUrls?\(/.test(readFileSync(full, "utf8"))) {
          offenders.push(full.slice(root.length));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
