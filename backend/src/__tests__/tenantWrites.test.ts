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
 * The write-scoping cases table (F68 / M176 layer 2).
 *
 * The global backstop (`support/tenantWriteGuard.ts`) is the safety net: it
 * fails any tenant-table update/delete that carries no scope filter. But it can
 * only judge a write some test actually executes — and a handful of write
 * routes are exercised nowhere in the suite, so their scope was invisible to
 * it. F68 #2 was exactly that: `POST /settings/photo` issued no query anywhere,
 * so deleting `.eq("archive_id", …)` from it stayed green.
 *
 * This file's job is to *run* those otherwise-untested write routes, which does
 * two things at once: it feeds the backstop (so the general net now sees them),
 * and it pins the positive shape directly here. It is documentation of which
 * write routes exist and what scopes them — NOT the safety net (that's the
 * backstop). A write route with no case here and no other test is still
 * invisible; closing *that* is the route census (layer 3, a separate mission).
 */

const SECRET = "test-session-secret-that-is-long-enough-32";
const ARCHIVE_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const INSTALL_A = "aaaaaaaa-0000-0000-0000-0000000000f1";
const ADMIN_A = "aaaaaaaa-0000-0000-0000-0000000000ad";

function cookies() {
  const device = jwt.sign({ installationId: INSTALL_A, archiveId: ARCHIVE_A }, SECRET, {
    expiresIn: 3600,
  });
  const profile = jwt.sign(
    { personId: ADMIN_A, name: "Admin A", role: "admin", archiveId: ARCHIVE_A },
    SECRET,
    { expiresIn: 3600 }
  );
  return [`recall_device=${device}`, `recall_profile=${profile}`];
}

/** A minimal but real JPEG, so magic-byte validation passes (same bytes as tenancy). */
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

function world() {
  recorder.reset({
    installations: [{ id: INSTALL_A, archive_id: ARCHIVE_A, is_trusted: true, revoked_at: null }],
    families: [{ id: "fam-a", archive_id: ARCHIVE_A, password_set_at: null, sessions_valid_from: null }],
    people: [
      { id: ADMIN_A, name: "Admin A", role: "admin", status: "active", archived_at: null, archive_id: ARCHIVE_A },
    ],
    settings: [{ archive_id: ARCHIVE_A, display_name: "Margaret", photo_path: "subject/old.jpg" }],
  });
}

beforeEach(() => world());

/**
 * Each case runs a write route the backstop would otherwise never see, and
 * pins its scope directly. `scopeCol` is the column the write must filter on;
 * the recorder ignores filters, so a passing status can't prove the scope — the
 * query shape is asserted.
 */
interface WriteCase {
  name: string;
  seam?: string;
  table: string;
  scopeCol: string;
  scopeVal: string;
  run: () => request.Test;
}

const CASES: WriteCase[] = [
  {
    name: "POST /settings/photo writes the subject's portrait scoped to its archive",
    seam: "F68 #2",
    table: "settings",
    scopeCol: "archive_id",
    scopeVal: ARCHIVE_A,
    run: () =>
      request(app).post("/api/settings/photo").set("Cookie", cookies()).attach("photo", JPEG, "face.jpg"),
  },
];

describe("tenant-write routes carry their scope (backstop-fed positive shapes)", () => {
  for (const c of CASES) {
    it(`${c.name}${c.seam ? ` (${c.seam})` : ""}`, async () => {
      const res = await c.run();
      // The route reached its write (not refused before it) — otherwise there
      // is nothing to scope and the case proves nothing.
      expect(res.status).toBeLessThan(400);

      const writes = recorder
        .forTable(c.table)
        .filter((q) => q.op === "update" || q.op === "delete");
      expect(writes.length).toBeGreaterThan(0);
      for (const w of writes) {
        expect(
          w.filters.some((f) => f.method === "eq" && f.column === c.scopeCol && f.value === c.scopeVal),
          `${c.table} ${w.op} must carry .eq("${c.scopeCol}", <this archive>)`
        ).toBe(true);
      }
    });
  }
});
