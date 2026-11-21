/*
 * The write-side backstop (F68 / M176 layer 1).
 *
 * The suite learned to assert `record.filters` on READS (F59/M164) and never
 * extended it to WRITES — so six of F68's ten unpinned seams were UPDATEs whose
 * scoping filter could be deleted with no test reddening. A cases table would
 * only re-create the sweep's own blind spot (a route nobody added looks
 * covered), so this flips the default instead: after every test, every
 * update/delete any route issued against a tenant table must carry a scope
 * filter, or the test that ran it fails. A missing scope is now caught by
 * default; the only way past is an entry in one of the two maps below — a
 * greppable line with a reason, never a silent omission.
 *
 * What it does NOT cover, on purpose (see M176 / Feedback):
 *  - Upserts scope through ON CONFLICT / the payload, not filters, so a
 *    filter-reading net cannot judge them. They are skipped, not waved through.
 *  - It only sees writes some test actually executes. A write route with no
 *    test at all issues no query and is invisible here — that is the route
 *    census (layer 3), a separate mission.
 */
import { afterEach, expect } from "vitest";
import { recorder } from "./supabaseRecorder.js";

/*
 * The scope column(s) that make a write single-tenant. A tenant-table
 * update/delete must carry at least one. Non-uniform on purpose: most tables
 * are keyed by `archive_id`, but the family tables are keyed by their own
 * identity, and a unique row `id` is itself single-tenant — so where a route
 * writes a family/session/installation by its own id, that id IS the scope.
 * Tables that take an id from user input (people, channels, media_files, …)
 * are deliberately `archive_id`-only: an id alone there could name another
 * family's row (the M152 posture, on the write side).
 */
const TENANT_SCOPE: Record<string, string[]> = {
  channels: ["archive_id"],
  media_files: ["archive_id"],
  people: ["archive_id"],
  settings: ["archive_id"],
  nfc_cards: ["archive_id"],
  channel_access: ["archive_id"],
  channel_visits: ["archive_id"],
  device_sessions: ["archive_id"],
  suggestions: ["archive_id"],
  missions: ["archive_id"],
  installations: ["archive_id", "id"],
  families: ["id"],
  invitations: ["id"],
  family_sessions: ["id", "family_id", "token_hash"],
  family_recovery_tokens: ["family_id", "token_hash"],
  // The family's own words and the joins that use them (059). Every one of
  // these tables carries archive_id for exactly this reason: a place, a tag,
  // who is in a photograph — all of it is one family's and nobody else's.
  places: ["archive_id"],
  tags: ["archive_id"],
  media_people: ["archive_id"],
  channel_tags: ["archive_id"],
};

/*
 * Tables whose writes are legitimately unscoped by any tenant key — each with
 * the reason it is safe. These are pre-family: they run before an archive
 * exists, so there is no tenant to scope to. An exemption here is a line
 * someone had to write; a missing scope everywhere else fails.
 */
const NON_TENANT: Record<string, string> = {
  email_verifications: "pre-family: a signup email proof, keyed by email/id before any archive exists",
  invitation_requests: "pre-family: keyed by email before an archive exists",
};

afterEach(() => {
  for (const q of recorder.queries) {
    if (q.op !== "update" && q.op !== "delete") continue;
    if (q.table in NON_TENANT) continue;

    const scope = TENANT_SCOPE[q.table];
    // Fail-by-default: a table nobody has classified stops the suite until its
    // scope is declared or it is exempted with a reason.
    expect(
      scope,
      `tenantWriteGuard: unclassified write to "${q.table}" (${q.op}). Add its scope column(s) to TENANT_SCOPE, or exempt it in NON_TENANT with a reason.`
    ).toBeDefined();

    const scoped = q.filters.some((f) => scope!.includes(f.column));
    expect(
      scoped,
      `tenantWriteGuard: ${q.op} on "${q.table}" carried no tenant scope — needs one of [${scope!.join(", ")}], but its filters were [${q.filters.map((f) => f.column).join(", ") || "none"}]. An unscoped write reaches every family's rows.`
    ).toBe(true);
  }
});
