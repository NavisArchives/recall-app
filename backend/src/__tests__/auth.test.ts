import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import {
  CAN_OPEN_ADMIN,
  CAN_WRITE_CONTENT,
  CAN_DELETE,
  CAN_MANAGE_PEOPLE,
  LANDING_PATH,
  normaliseSecret,
} from "../services/accessCodes.js";
import { isValidPinFormat, isLocked, generatePin, PIN_LENGTH } from "../services/pins.js";

const app = createApp();

describe("health", () => {
  it("responds ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe("level 1 — installation", () => {
  it("rejects a malformed secret without revealing why", async () => {
    const res = await request(app)
      .post("/api/auth/installation/sign-in")
      .send({ username: "recall", secret: "nope" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid credentials.");
  });

  it("rejects a missing username", async () => {
    const res = await request(app)
      .post("/api/auth/installation/sign-in")
      .send({ secret: "ABCD-EFGHJKMN" });
    expect(res.status).toBe(401);
  });

  it("gives one message for every kind of bad input", async () => {
    const cases = [
      { username: "recall", secret: "too-short" },
      { username: "", secret: "ABCD-EFGHJKMN" },
      {},
    ];

    const bodies = await Promise.all(
      cases.map((body) =>
        request(app).post("/api/auth/installation/sign-in").send(body).then((r) => r.body.error)
      )
    );

    expect(new Set(bodies).size).toBe(1);
  });
});

describe("level 2 — profiles", () => {
  it("will not list profiles to an untrusted machine", async () => {
    const res = await request(app).get("/api/auth/profiles");
    expect(res.status).toBe(401);
  });

  it("will not unlock a profile from an untrusted machine", async () => {
    const res = await request(app).post("/api/auth/profiles/some-id/unlock").send({ pin: "123456" });
    expect(res.status).toBe(401);
  });

  it("reports no session when nothing is signed in", async () => {
    const res = await request(app).get("/api/auth/session");
    // `family` joined the two cookie tiers when the frontend finally learned
    // that signing in with the family password is a way of being somebody
    // here. Its own field, never folded into `device`: a device is a machine
    // the family trusts and may show the subject; a family session is a
    // person elsewhere and never may.
    expect(res.body).toEqual({ device: false, family: false, profile: null });
  });

  it("ignores a forged device cookie", async () => {
    const res = await request(app)
      .get("/api/auth/profiles")
      .set("Cookie", "recall_device=not-a-real-token");
    expect(res.status).toBe(401);
  });
});

describe("every write rejects anonymous callers", () => {
  const routes: Array<[string, "post" | "delete" | "patch" | "put", string]> = [
    ["create channel", "post", "/api/channels"],
    ["archive channel", "delete", "/api/channels/some-id"],
    ["restore channel", "post", "/api/channels/some-id/restore"],
    ["create person", "post", "/api/people"],
    ["change role", "patch", "/api/people/some-id/role"],
    ["change status", "patch", "/api/people/some-id/status"],
    ["reset pin", "post", "/api/people/some-id/reset-pin"],
    ["upload media", "post", "/api/media-files"],
    ["remove media", "delete", "/api/media-files/some-id"],
    ["reorder media", "patch", "/api/media-files/reorder"],
    ["read channel access", "get", "/api/channels/some-id/access"],
    ["replace channel access", "put", "/api/channels/some-id/access"],
    ["update settings", "put", "/api/settings"],
    ["upload subject photo", "post", "/api/settings/photo"],
    ["edit person", "patch", "/api/people/some-id"],
    ["permanent delete", "delete", "/api/channels/some-id/permanent"],
  ];

  it.each(routes)("%s returns 401", async (_label, method, path) => {
    const res = await request(app)[method](path).send({});
    expect(res.status).toBe(401);
  });
});

describe("role permissions", () => {
  it("keeps the subject of the archive out of the management area", () => {
    expect(CAN_OPEN_ADMIN).not.toContain("user");
    expect(CAN_WRITE_CONTENT).not.toContain("user");
    expect(CAN_DELETE).not.toContain("user");
    expect(CAN_MANAGE_PEOPLE).not.toContain("user");
  });

  it("lets a co_author add but never delete or manage people", () => {
    expect(CAN_WRITE_CONTENT).toContain("co_author");
    expect(CAN_DELETE).not.toContain("co_author");
    expect(CAN_MANAGE_PEOPLE).not.toContain("co_author");
  });

  it("reserves deleting and managing people for admins", () => {
    expect(CAN_DELETE).toEqual(["admin"]);
    expect(CAN_MANAGE_PEOPLE).toEqual(["admin"]);
  });

  it("sends each role to the right place", () => {
    expect(LANDING_PATH.user).toBe("/");
    expect(LANDING_PATH.admin).toBe("/admin");
    expect(LANDING_PATH.co_author).toBe("/admin");
  });
});

describe("installation secret parsing", () => {
  it("accepts a code with or without the dash, any case", () => {
    expect(normaliseSecret(" abcd-efghjkmn ")).toBe("ABCDEFGHJKMN");
    expect(normaliseSecret("ABCDEFGHJKMN")).toBe("ABCDEFGHJKMN");
  });

  it("rejects wrong lengths and non-strings", () => {
    expect(normaliseSecret("ABCD-EFG")).toBeNull();
    expect(normaliseSecret(12345678)).toBeNull();
    expect(normaliseSecret(null)).toBeNull();
  });
});

describe("PINs", () => {
  it("generates six digits", () => {
    for (let i = 0; i < 20; i++) {
      expect(generatePin()).toMatch(new RegExp(`^\\d{${PIN_LENGTH}}$`));
    }
  });

  it("accepts only six-digit strings", () => {
    expect(isValidPinFormat("012345")).toBe(true);
    expect(isValidPinFormat("12345")).toBe(false);
    expect(isValidPinFormat("1234567")).toBe(false);
    expect(isValidPinFormat("12345a")).toBe(false);
    expect(isValidPinFormat(123456)).toBe(false);
  });

  it("treats a future lockout as locked and a past one as clear", () => {
    expect(isLocked(new Date(Date.now() + 60_000).toISOString())).toBe(true);
    expect(isLocked(new Date(Date.now() - 60_000).toISOString())).toBe(false);
    expect(isLocked(null)).toBe(false);
  });
});
