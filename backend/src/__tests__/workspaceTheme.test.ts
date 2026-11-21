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
 * The colour a person works in (058) — a preference, not an administration.
 *
 * The property that matters is who may write it: your own row and nobody
 * else's. An admin has no override here, because repainting a colleague's
 * workspace is not an administrative act; it is just wrong. The route proves
 * it by comparing the id in the path to the person the SESSION resolved to,
 * never to a claim carried in the token.
 */

const SECRET = "test-session-secret-that-is-long-enough-32";
const ARCHIVE = "aaaaaaaa-0000-0000-0000-00000000000a";
const INSTALL = "aaaaaaaa-0000-0000-0000-0000000000f1";
const ME = "aaaaaaaa-0000-0000-0000-0000000000ad";
const SOMEBODY_ELSE = "aaaaaaaa-0000-0000-0000-0000000000c0";

function session(role = "admin") {
  return [
    `recall_device=${jwt.sign({ installationId: INSTALL, archiveId: ARCHIVE }, SECRET, { expiresIn: 3600 })}`,
    `recall_profile=${jwt.sign({ personId: ME, name: "Andy", role, archiveId: ARCHIVE }, SECRET, { expiresIn: 3600 })}`,
  ];
}

beforeEach(() => {
  recorder.reset({
    people: [
      {
        id: ME,
        archive_id: ARCHIVE,
        name: "Andy",
        role: "admin",
        status: "active",
        archived_at: null,
        workspace_theme: "dark",
      },
    ],
    installations: [{ id: INSTALL, archive_id: ARCHIVE, is_trusted: true, revoked_at: null }],
  });
});

const updates = () => recorder.forTable("people").filter((q) => q.op === "update");

describe("who may repaint a workspace", () => {
  it("you may set your own", async () => {
    const res = await request(app)
      .patch(`/api/people/${ME}/theme`)
      .set("Cookie", session())
      .send({ workspace_theme: "blue" });

    expect(res.status).toBe(200);
    expect(updates()[0]?.payload).toMatchObject({ workspace_theme: "blue" });
    // Scoped to the archive as every person write is.
    expect(updates()[0]?.filters).toEqual(
      expect.arrayContaining([
        { method: "eq", column: "id", value: ME },
        { method: "eq", column: "archive_id", value: ARCHIVE },
      ])
    );
  });

  it("a co-author may set their own too — it is a preference, not a power", async () => {
    recorder.reset({
      people: [
        { id: ME, archive_id: ARCHIVE, name: "Jan", role: "co_author", status: "active", archived_at: null, workspace_theme: "dark" },
      ],
      installations: [{ id: INSTALL, archive_id: ARCHIVE, is_trusted: true, revoked_at: null }],
    });
    const res = await request(app)
      .patch(`/api/people/${ME}/theme`)
      .set("Cookie", session("co_author"))
      .send({ workspace_theme: "green" });
    expect(res.status).toBe(200);
  });

  it("an ADMIN may not repaint somebody else's workspace", async () => {
    const res = await request(app)
      .patch(`/api/people/${SOMEBODY_ELSE}/theme`)
      .set("Cookie", session())
      .send({ workspace_theme: "paper" });

    expect(res.status).toBe(403);
    expect(updates()).toHaveLength(0);
  });

  it("anonymous is refused", async () => {
    const res = await request(app).patch(`/api/people/${ME}/theme`).send({ workspace_theme: "paper" });
    expect(res.status).toBe(401);
    expect(updates()).toHaveLength(0);
  });

  it("only the four colours are accepted — nothing else reaches the row", async () => {
    for (const bad of ["purple", "", "DARK", null, 7]) {
      const res = await request(app)
        .patch(`/api/people/${ME}/theme`)
        .set("Cookie", session())
        .send({ workspace_theme: bad });
      expect(res.status).toBe(400);
    }
    expect(updates()).toHaveLength(0);
  });

  it("dark is accepted, so a person can always go back", async () => {
    const res = await request(app)
      .patch(`/api/people/${ME}/theme`)
      .set("Cookie", session())
      .send({ workspace_theme: "dark" });
    expect(res.status).toBe(200);
    expect(updates()[0]?.payload).toMatchObject({ workspace_theme: "dark" });
  });
});
