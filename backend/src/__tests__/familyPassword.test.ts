import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { recorder } from "./support/supabaseRecorder.js";

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => recorder.client,
}));

const { createApp } = await import("../app.js");
const app = createApp();

/**
 * F68 #1 — changing the family password writes only the caller's own row.
 *
 * `POST /api/family/password` had no test at all, so the one `.eq("id", …)` on
 * its UPDATE — the entire boundary between an admin setting their own family's
 * password and setting every household's on the platform — was covered by
 * nothing. It cannot live in tenancy.test.ts: `families` is deliberately
 * outside its FAMILY_TABLES and no `/api/family/*` route is in its cases. The
 * recorder returns the fixture row whole and ignores `.eq()` filters, so a
 * status code cannot see the scope vanish — the query shape is asserted
 * directly. Drop `.eq("id", family.id)` from the update and this reddens.
 */

const ARCHIVE_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const FAMILY_A = "aaaaaaaa-0000-0000-0000-0000000000fa";
const ADMIN_A = "aaaaaaaa-0000-0000-0000-0000000000ad";

const NEW_PASSWORD = "a-brand-new-family-passphrase";

function session(role: "admin" | "co_author") {
  return {
    id: `sess-${role}`,
    family_id: FAMILY_A,
    archive_id: ARCHIVE_A,
    person_id: ADMIN_A,
    role,
    session_version: 1,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    revoked_at: null,
  };
}

function world(role: "admin" | "co_author" = "admin") {
  recorder.reset({
    family_sessions: [session(role)],
    // No password yet: the first-set path, so no current-password check runs.
    families: [
      { id: FAMILY_A, archive_id: ARCHIVE_A, password_hash: null, session_version: 1, status: "active" },
    ],
    // The session names a person, so readFamilySession takes the role from the
    // person's own row — the database is the truth, even for the family tier.
    people: [
      { id: ADMIN_A, name: "Anne", role, status: "active", archived_at: null, archive_id: ARCHIVE_A },
    ],
  });
}

beforeEach(() => world());

describe("POST /api/family/password scopes its write to the caller's family (F68 #1)", () => {
  it("updates families filtered by this family's id, never platform-wide", async () => {
    const res = await request(app)
      .post("/api/family/password")
      .set("Cookie", "recall_family=an-opaque-admin-token")
      .send({ password: NEW_PASSWORD });

    expect(res.status).toBe(200);

    const update = recorder.forTable("families").find((q) => q.op === "update");
    expect(update).toBeDefined();
    // The password_hash really is what is being written — so an unscoped write
    // would set every family's password, not merely touch every row.
    expect((update!.payload as Record<string, unknown>).password_hash).toBeTruthy();
    // The seam: the write must name this one family's id.
    expect(
      update!.filters.some((f) => f.method === "eq" && f.column === "id" && f.value === FAMILY_A)
    ).toBe(true);
  });

  it("refuses a non-admin family session and writes nothing", async () => {
    world("co_author");
    const res = await request(app)
      .post("/api/family/password")
      .set("Cookie", "recall_family=an-opaque-token")
      .send({ password: NEW_PASSWORD });

    expect(res.status).toBe(403);
    expect(recorder.forTable("families").some((q) => q.op === "update")).toBe(false);
  });
});
