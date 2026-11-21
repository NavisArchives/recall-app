import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import argon2 from "argon2";
import { recorder } from "./support/supabaseRecorder.js";

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => recorder.client,
}));

const { createApp } = await import("../app.js");
const app = createApp();

/**
 * M117 — the trusted-device replacement ceremony.
 *
 * identity-model.md § "The one trusted device": replacing it "is an explicit
 * ceremony gated by the family email, and minting the new credential revokes
 * the old one." The family password deliberately cannot do this (M116) —
 * whoever reads the family inbox speaks for the household. The ceremony is
 * the flow M116's refusal copy points at, and it must leave the old row in a
 * state 027's partial index no longer counts, or the family is refused a
 * screen forever.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";

const ARCHIVE_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const ARCHIVE_B = "bbbbbbbb-0000-0000-0000-00000000000b";
const FAMILY_A = "aaaaaaaa-0000-0000-0000-0000000000fa";
const SUBJECT_A = "aaaaaaaa-0000-0000-0000-0000000000c1";
const OLD_SCREEN = "aaaaaaaa-0000-0000-0000-0000000000f1";

function familyRow(over: Record<string, unknown> = {}) {
  return {
    id: FAMILY_A,
    archive_id: ARCHIVE_A,
    /*
     * The address is on the row, because that is where the ceremony reads it.
     *
     * The link is sent to the family's *stored* address rather than to
     * whatever the caller typed — otherwise a request that derives the family
     * from a session (the chooser, which sends no address at all) would have
     * nowhere to deliver to. This fixture omitted `email`, so it modelled a
     * family that cannot exist: it is the login identity.
     */
    email: "family@example.invalid",
    display_name: "The Tree Family",
    status: "active",
    ...over,
  };
}

function tokenRow(over: Record<string, unknown> = {}) {
  return { family_id: FAMILY_A, ...over };
}

function world(over: {
  families?: unknown[];
  tokens?: unknown[];
  installations?: unknown[];
  people?: unknown[];
} = {}) {
  recorder.reset({
    families: (over.families ?? [familyRow()]) as Record<string, unknown>[],
    family_recovery_tokens: (over.tokens ?? [tokenRow()]) as Record<string, unknown>[],
    installations: (over.installations ?? []) as Record<string, unknown>[],
    people: (over.people ?? [
      {
        id: SUBJECT_A,
        name: "Margaret",
        role: "user",
        status: "active",
        archive_id: ARCHIVE_A,
        archived_at: null,
      },
    ]) as Record<string, unknown>[],
  });
}

const complete = (body: Record<string, unknown>) =>
  request(app).post("/api/family/replace-screen/complete").send(body);

/** The jar as a browser resolves it: last line per name wins, empties leave. */
function cookiesOf(res: request.Response): string[] {
  const raw = (res.headers["set-cookie"] ?? []) as unknown as string[];
  const jar = new Map<string, string>();
  for (const line of raw) {
    const pair = line.split(";")[0];
    jar.set(pair.split("=")[0], pair);
  }
  return [...jar.values()].filter((pair) => pair.split("=").slice(1).join("=").length > 0);
}

beforeEach(() => world());

describe("requesting a replacement link", () => {
  it("answers an unknown address identically to a known one", async () => {
    world({ families: [] });
    const unknown = await request(app)
      .post("/api/family/replace-screen")
      .send({ email: "nobody@example.invalid" });

    world();
    const known = await request(app)
      .post("/api/family/replace-screen")
      .send({ email: "family@example.invalid" });

    expect(unknown.status).toBe(200);
    expect(known.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
  });

  it("stores only a hash, purpose-bound and short-lived, superseding the last link", async () => {
    await request(app)
      .post("/api/family/replace-screen")
      .send({ email: "family@example.invalid" });

    const queries = recorder.forTable("family_recovery_tokens");
    // The previous unconsumed link dies first — one live link per family.
    expect(queries.some((q) => q.op === "delete")).toBe(true);

    const inserts = queries.filter((q) => q.op === "insert");
    expect(inserts).toHaveLength(1);
    const payload = inserts[0].payload as Record<string, unknown>;
    expect(payload.purpose).toBe("device");
    expect(payload.family_id).toBe(FAMILY_A);
    // A hash landed, never the token itself.
    expect(String(payload.token_hash)).toMatch(/^[0-9a-f]{64}$/);
  });

  /*
   * The chooser's own way in (F-review).
   *
   * The chooser asks for this link from inside the house and has no family
   * address to send — it posts an empty body. The route read no address and
   * returned its anti-enumeration answer, so the screen announced that an
   * email was on its way while no token had been minted: a success message
   * covering an action that never happened. Nothing covered this path, which
   * is exactly how it shipped broken, so the shape is pinned here.
   */
  it("mints a link from the session when the body carries no address", async () => {
    // `world()` does not model sessions, and `readFamilySession` also matches
    // the family's `session_version` against the row's — so both go in, or
    // the session resolves to nobody and this proves nothing.
    world({ families: [familyRow({ session_version: 1 })] });
    recorder.responses.family_sessions = [
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
    ];

    const res = await request(app)
      .post("/api/family/replace-screen")
      .set("Cookie", ["recall_family=an-opaque-token"])
      .send({});

    expect(res.status).toBe(200);
    const inserts = recorder
      .forTable("family_recovery_tokens")
      .filter((q) => q.op === "insert");
    // The whole point: a real token, from an empty body.
    expect(inserts).toHaveLength(1);
    expect((inserts[0].payload as Record<string, unknown>).purpose).toBe("device");
  });

  it("mints nothing for an empty body with no session at all", async () => {
    // The other half of the same rule: deriving the family from a session is
    // not the same as accepting a request that names nobody.
    const res = await request(app).post("/api/family/replace-screen").send({});

    expect(res.status).toBe(200);
    expect(
      recorder.forTable("family_recovery_tokens").filter((q) => q.op === "insert")
    ).toHaveLength(0);
  });

  it("never mints a link for the platform owner's screenless row", async () => {
    world({ families: [familyRow({ archive_id: null })] });
    const res = await request(app)
      .post("/api/family/replace-screen")
      .send({ email: "owner@example.invalid" });

    expect(res.status).toBe(200);
    expect(recorder.forTable("family_recovery_tokens").filter((q) => q.op === "insert")).toHaveLength(0);
  });
});

describe("completing the ceremony on the new screen", () => {
  it("retires the old screen, then mints the new one — in that order", async () => {
    const res = await complete({ token: "a-fresh-emailed-token" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, next: "/" });

    // The token was consumed conditionally: single-use even against itself.
    const consume = recorder
      .forTable("family_recovery_tokens")
      .find((q) => q.op === "update");
    expect(consume).toBeDefined();
    expect(consume!.filters.some((f) => f.column === "purpose" && f.value === "device")).toBe(true);
    expect(consume!.filters.some((f) => f.method === "is" && f.column === "consumed_at")).toBe(true);
    // …and only while it is still live. The recorder ignores `.gt`, so an
    // expired link consumes just the same in these fixtures — the deadline is
    // asserted as query shape, or a dead link would still move a screen (F68 #7).
    expect(consume!.filters.some((f) => f.method === "gt" && f.column === "expires_at")).toBe(true);

    // The old screen retires before the new one exists: untrusted, so the
    // one-per-family index frees the slot, and revoked, so its cookie 401s.
    const ops = recorder.forTable("installations");
    const retire = ops.findIndex((q) => q.op === "update");
    const mint = ops.findIndex((q) => q.op === "insert");
    expect(retire).toBeGreaterThanOrEqual(0);
    expect(mint).toBeGreaterThan(retire);

    const retirePayload = ops[retire].payload as Record<string, unknown>;
    expect(retirePayload.is_trusted).toBe(false);
    expect(retirePayload.revoked_at).toBeTruthy();
    expect(ops[retire].filters.some((f) => f.column === "archive_id" && f.value === ARCHIVE_A)).toBe(true);
    expect(ops[retire].filters.some((f) => f.column === "is_trusted" && f.value === true)).toBe(true);

    // Exactly one new trusted row, in the token's own archive.
    const mintPayload = ops[mint].payload as Record<string, unknown>;
    expect(mintPayload.is_trusted).toBe(true);
    expect(mintPayload.archive_id).toBe(ARCHIVE_A);

    // The new screen leaves with the device session and the subject's.
    const cookies = cookiesOf(res);
    expect(cookies.some((c) => c.startsWith("recall_device="))).toBe(true);
    expect(cookies.some((c) => c.startsWith("recall_profile="))).toBe(true);
  });

  it("refuses a dead, spent, or unknown link with one sentence", async () => {
    world({ tokens: [] });
    const res = await complete({ token: "a-link-that-was-never-minted" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not valid any more/i);
    // Nothing was retired and nothing was minted on a refused link.
    expect(recorder.forTable("installations")).toHaveLength(0);
    expect(cookiesOf(res).some((c) => c.startsWith("recall_device="))).toBe(false);
  });

  it("ignores an archive smuggled into the completion body", async () => {
    const res = await complete({ token: "a-fresh-emailed-token", archive_id: ARCHIVE_B });

    expect(res.status).toBe(200);
    const mint = recorder
      .forTable("installations")
      .find((q) => q.op === "insert");
    // The archive is the token's family's — the request body has no say.
    expect((mint!.payload as Record<string, unknown>).archive_id).toBe(ARCHIVE_A);
  });

  it("no ordinary path reaches the revocation — only the ceremony retires a screen", async () => {
    /*
      The 30-day recall_device session exists so her display is never
      interrupted; the emailed token is the ONLY door to revoking it. Every
      everyday act a family performs — signing in (same family), stepping a
      profile back out, entering a profile — must leave the installations
      table untouched. The one deliberate exception outside the ceremony is
      the device's own /auth/sign-out, which relinquishes only the
      presenting machine's slot (pinned in pairScreen.test.ts).
    */
    const argonHash = await argon2.hash("a-long-family-passphrase", { type: argon2.argon2id });
    recorder.reset({
      families: [
        {
          id: FAMILY_A,
          archive_id: ARCHIVE_A,
          password_hash: argonHash,
          session_version: 1,
          status: "active",
          platform_owner: false,
        },
      ],
      family_sessions: [
        {
          id: "sess-1",
          family_id: FAMILY_A,
          archive_id: ARCHIVE_A,
          person_id: null,
          role: "admin",
          session_version: 1,
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          revoked_at: null,
        },
      ],
      installations: [
        { id: OLD_SCREEN, archive_id: ARCHIVE_A, is_trusted: true, revoked_at: null },
      ],
      people: [],
    });
    const sameFamilyDevice = `recall_device=${jwt.sign(
      { installationId: OLD_SCREEN, archiveId: ARCHIVE_A },
      SECRET,
      { expiresIn: 3600 }
    )}`;

    // A same-family sign-in on the household screen.
    await request(app)
      .post("/api/family/login")
      .set("Cookie", [sameFamilyDevice])
      .send({ email: "family@example.invalid", password: "a-long-family-passphrase" });
    // A person stepping back to the chooser.
    await request(app)
      .post("/api/auth/profiles/sign-out")
      .set("Cookie", [sameFamilyDevice, "recall_family=any-opaque-token"]);

    const writes = recorder
      .forTable("installations")
      .filter((q) => q.op === "update" || q.op === "delete");
    expect(writes).toHaveLength(0);
  });

  it("the old screen's cookie stops answering once its row is retired", async () => {
    /*
      The two halves of the acceptance criterion, by mechanism. The ceremony
      writes { is_trusted: false, revoked_at } to the old row (pinned above);
      requireDevice re-reads the row on every request and refuses a revoked
      one (M42). Here is that refusal, against the exact row state the
      ceremony leaves behind.
    */
    recorder.reset({
      installations: [
        {
          id: OLD_SCREEN,
          archive_id: ARCHIVE_A,
          is_trusted: false,
          revoked_at: new Date().toISOString(),
        },
      ],
    });
    const oldCookie = `recall_device=${jwt.sign(
      { installationId: OLD_SCREEN, archiveId: ARCHIVE_A },
      SECRET,
      { expiresIn: 3600 }
    )}`;

    const res = await request(app).get("/api/settings").set("Cookie", oldCookie);
    expect(res.status).toBe(401);
  });
});
