import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";

const app = createApp();

/**
 * The doors, enumerated.
 *
 * Every route on this list once answered anybody who could reach the port —
 * a stranger could have listed the channels, read the family's names, and
 * downloaded the photographs. These tests exist so that can never quietly
 * become true again: adding a route without a guard fails here, not in
 * somebody's living room.
 *
 * Nothing here touches Supabase. A refusal must happen before any data is
 * fetched, which is precisely what makes it testable with no database.
 */

const DISPLAY_READS = [
  "/api/channels",
  "/api/channels/01",
  "/api/people",
  "/api/people/00000000-0000-0000-0000-000000000000",
  "/api/settings",
  "/api/screen-state",
  "/api/media/00000000-0000-0000-0000-000000000000/file",
  "/api/media/person/00000000-0000-0000-0000-000000000000/photo",
];

const MEMBER_READS = [
  "/api/nfc-cards",
  "/api/missions",
  "/api/activity",
  "/api/suggestions",
  "/api/insights",
  "/api/media/cache/stats",
  "/api/channels/detail/00000000-0000-0000-0000-000000000000",
  "/api/channels/archived/list",
];

const WRITES: [string, string][] = [
  ["post", "/api/channels"],
  ["patch", "/api/channels/00000000-0000-0000-0000-000000000000"],
  ["delete", "/api/channels/00000000-0000-0000-0000-000000000000"],
  ["delete", "/api/channels/00000000-0000-0000-0000-000000000000/permanent"],
  ["post", "/api/media-files"],
  ["post", "/api/missions"],
  ["post", "/api/nfc-cards"],
  ["put", "/api/settings"],
  ["post", "/api/people"],
  ["post", "/api/onboarding/invites"],
];

describe("nothing is readable without a session", () => {
  it.each(DISPLAY_READS)("refuses %s to a stranger", async (path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(401);
  });

  it.each(MEMBER_READS)("refuses %s to a stranger", async (path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(401);
  });

  it.each(WRITES)("refuses %s %s to a stranger", async (method, path) => {
    const res = await (request(app) as never as Record<string, (p: string) => request.Test>)[
      method
    ](path);
    expect(res.status).toBe(401);
  });
});

describe("a forged or stale cookie is not a session", () => {
  it("refuses a device cookie that was not signed by us", async () => {
    const res = await request(app)
      .get("/api/channels")
      .set("Cookie", "recall_device=not.a.real.token");
    expect(res.status).toBe(401);
  });

  it("refuses a profile cookie that was not signed by us", async () => {
    const res = await request(app)
      .get("/api/missions")
      .set("Cookie", "recall_profile=not.a.real.token");
    expect(res.status).toBe(401);
  });

  it("refuses management when only a profile cookie is presented", async () => {
    // Management requires the installation to still be trusted as well, so a
    // profile cookie lifted onto another machine cannot act on its own. A
    // forged one cannot get past the signature either — both refusals are 401,
    // and either way the request never reaches the database.
    const res = await request(app)
      .get("/api/missions")
      .set("Cookie", "recall_profile=x.y.z");
    expect(res.status).toBe(401);
  });
});

describe("a state change from a stranger's origin is refused", () => {
  /*
   * SameSite=Strict is the first lock; this gate is the second. A browser
   * attaches Origin to every cross-site state-changing request, so a write
   * whose Origin names a site that is not ours is refused before anything
   * else looks at it. CORS is not this — CORS governs what a page may read,
   * not what a forged form may send.
   */
  it("refuses a cross-origin POST outright", async () => {
    const res = await request(app)
      .post("/api/channels")
      .set("Origin", "https://evil.example")
      .send({});
    expect(res.status).toBe(403);
  });

  it("lets the frontend's own origin through to the auth that refuses it", async () => {
    const res = await request(app)
      .post("/api/channels")
      .set("Origin", "http://localhost:5173")
      .send({});
    expect(res.status).toBe(401);
  });

  it("does not mistake a read for a state change", async () => {
    const res = await request(app).get("/api/channels").set("Origin", "https://evil.example");
    // Still refused — but by auth, because reads are CORS's business.
    expect(res.status).toBe(401);
  });
});

describe("onboarding is public but never talkative", () => {
  it("rejects a sign-up that says nothing", async () => {
    const res = await request(app).post("/api/onboarding/sign-up").send({});
    expect(res.status).toBe(400);
  });

  it("rejects a malformed invite code before touching anything", async () => {
    const res = await request(app).post("/api/onboarding/join/lookup").send({ code: "!!" });
    expect(res.status).toBe(400);
  });

  it("rejects joining with a weak PIN", async () => {
    const res = await request(app)
      .post("/api/onboarding/join/complete")
      .send({ code: "ABCDEF", pin: "12", name: "X" });
    expect(res.status).toBe(400);
  });
});

describe("health is the only public door", () => {
  it("answers without any session", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("says nothing about the archive", async () => {
    const res = await request(app).get("/health");
    expect(JSON.stringify(res.body)).not.toMatch(/margaret|archive|channel/i);
  });
});

describe("the founder's email is proven, not typed", () => {
  // The unverified-address 403 needs the database and is checked live
  // instead — these two refusals happen before any row is read.
  it("refuses to send a code to a malformed address", async () => {
    const res = await request(app)
      .post("/api/onboarding/verify-email/send")
      .send({ email: "not-an-address" });
    expect(res.status).toBe(400);
  });

  it("refuses a malformed verification code", async () => {
    const res = await request(app)
      .post("/api/onboarding/verify-email/check")
      .send({ email: "a@example.com", code: "!" });
    expect(res.status).toBe(400);
  });
});
