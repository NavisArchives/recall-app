import { supabase } from "../config/supabase.js";
import {
  PERSON_COLUMNS,
  PERSON_MEMBER_COLUMNS,
  PERSON_ADMIN_COLUMNS,
  PERSON_SELF_COLUMNS,
  PROFILE_AUTH_COLUMNS,
  CHANNEL_COLUMNS,
  MEDIA_FILE_COLUMNS,
  PLACE_COLUMNS,
  TAG_COLUMNS,
  CARD_COLUMNS,
  OWNER_FAMILY_COLUMNS,
  OWNER_CHANNEL_COLUMNS,
  OWNER_PERSON_COLUMNS,
  OWNER_MEDIA_COLUMNS,
  OWNER_INSTALLATION_COLUMNS,
  FAMILY_SCREEN_COLUMNS,
  OWNER_ACTIVITY_COLUMNS,
  OWNER_VISIT_COLUMNS,
  SETTINGS_DISPLAY_COLUMNS,
  SETTINGS_MEMBER_COLUMNS,
  SETTINGS_ADMIN_COLUMNS,
  FAMILY_PAYMENT_COLUMNS,
  CONSENT_COLUMNS,
  FAMILY_SIGN_IN_COLUMNS,
  OWNER_SECOND_FACTOR_COLUMNS,
  OWNER_AUDIT_COLUMNS,
  PIN_COUNTER_COLUMNS,
} from "./dto.js";

/**
 * Does the database actually have the columns this build asks for?
 *
 * Twice in one evening (20 Aug 2026) a commit shipped a column list ahead of
 * the migration that creates the column, and both times the product simply
 * broke with a sentence that pointed somewhere else. `admin_note` went into
 * `PERSON_ADMIN_COLUMNS` while the column did not exist, so every admin load
 * of the people list answered 500 "The contributors could not be loaded" —
 * which reads as a data problem, or a bug in the page, or the network. The
 * owner reported it as "contributors don't work at all". Nobody looks for an
 * unrun migration, because the failure never says migration.
 *
 * So the process asks at boot, and refuses to start if the answer is no. A
 * server that will 500 every admin request is not healthy, and saying so at
 * startup — once, loudly, naming the column — costs one round trip and saves
 * an evening of looking in the wrong place. On Cloud Run a failed boot keeps
 * the previous revision serving, which is exactly the right outcome: the last
 * build that matched the database goes on working.
 *
 * WHY A MAP RATHER THAN A LIST OF COLUMN NAMES: the pairs below are derived
 * from the DTO constants themselves, not retyped. A hand-maintained list of
 * columns would share the blind spot that let this through — someone adds a
 * column to a DTO and forgets the checklist, which is the same mistake one
 * layer along. Here the constant IS the check, and `schemaPreflight.test.ts`
 * fails if a newly exported `*_COLUMNS` is not registered here, so a new list
 * cannot be quietly omitted either.
 */
export const CHECKED_SELECTS: ReadonlyArray<{ table: string; columns: string; label: string }> = [
  { table: "people", columns: PERSON_COLUMNS, label: "PERSON_COLUMNS" },
  { table: "people", columns: PERSON_MEMBER_COLUMNS, label: "PERSON_MEMBER_COLUMNS" },
  { table: "people", columns: PERSON_ADMIN_COLUMNS, label: "PERSON_ADMIN_COLUMNS" },
  { table: "people", columns: PERSON_SELF_COLUMNS, label: "PERSON_SELF_COLUMNS" },
  { table: "people", columns: PROFILE_AUTH_COLUMNS, label: "PROFILE_AUTH_COLUMNS" },
  { table: "channels", columns: CHANNEL_COLUMNS, label: "CHANNEL_COLUMNS" },
  { table: "media_files", columns: MEDIA_FILE_COLUMNS, label: "MEDIA_FILE_COLUMNS" },
  { table: "places", columns: PLACE_COLUMNS, label: "PLACE_COLUMNS" },
  { table: "tags", columns: TAG_COLUMNS, label: "TAG_COLUMNS" },
  { table: "nfc_cards", columns: CARD_COLUMNS, label: "CARD_COLUMNS" },
  { table: "families", columns: OWNER_FAMILY_COLUMNS, label: "OWNER_FAMILY_COLUMNS" },
  { table: "channels", columns: OWNER_CHANNEL_COLUMNS, label: "OWNER_CHANNEL_COLUMNS" },
  { table: "people", columns: OWNER_PERSON_COLUMNS, label: "OWNER_PERSON_COLUMNS" },
  { table: "media_files", columns: OWNER_MEDIA_COLUMNS, label: "OWNER_MEDIA_COLUMNS" },
  { table: "installations", columns: OWNER_INSTALLATION_COLUMNS, label: "OWNER_INSTALLATION_COLUMNS" },
  { table: "installations", columns: FAMILY_SCREEN_COLUMNS, label: "FAMILY_SCREEN_COLUMNS" },
  { table: "activity_log", columns: OWNER_ACTIVITY_COLUMNS, label: "OWNER_ACTIVITY_COLUMNS" },
  { table: "channel_visits", columns: OWNER_VISIT_COLUMNS, label: "OWNER_VISIT_COLUMNS" },
  { table: "settings", columns: SETTINGS_DISPLAY_COLUMNS, label: "SETTINGS_DISPLAY_COLUMNS" },
  { table: "settings", columns: SETTINGS_MEMBER_COLUMNS, label: "SETTINGS_MEMBER_COLUMNS" },
  { table: "settings", columns: SETTINGS_ADMIN_COLUMNS, label: "SETTINGS_ADMIN_COLUMNS" },
  { table: "families", columns: FAMILY_PAYMENT_COLUMNS, label: "FAMILY_PAYMENT_COLUMNS" },
  { table: "archive_consents", columns: CONSENT_COLUMNS, label: "CONSENT_COLUMNS" },
  { table: "families", columns: FAMILY_SIGN_IN_COLUMNS, label: "FAMILY_SIGN_IN_COLUMNS" },
  { table: "families", columns: OWNER_SECOND_FACTOR_COLUMNS, label: "OWNER_SECOND_FACTOR_COLUMNS" },
  { table: "owner_audit_log", columns: OWNER_AUDIT_COLUMNS, label: "OWNER_AUDIT_COLUMNS" },
  { table: "people", columns: PIN_COUNTER_COLUMNS, label: "PIN_COUNTER_COLUMNS" },
];

/** A nil id: a counter called with it updates no row. */
const NO_ROW = "00000000-0000-0000-0000-000000000000";

/**
 * The database functions this build calls, each with arguments that make the
 * call a no-op, so asking changes nothing.
 *
 * A column list cannot see a function, and a function that is missing — or
 * still has the shape an earlier migration gave it — fails exactly like a
 * missing column: every sign-in refused (064), every public email held back
 * (066), and neither says "migration". PostgREST resolves an rpc by its
 * argument names, so passing every argument the code passes checks the
 * signature too: before 064, `record_pin_failure` has no `p_ceiling` and the
 * call is refused.
 *
 * Why these are no-ops: the counters UPDATE the row whose id they are given,
 * and no row has the nil id (the claim finds no row and returns nothing). `claim_mail_send` with a limit of 0 answers "not
 * allowed" before it inserts anything; the one thing it does first is prune
 * rows older than a day, which every real call does anyway.
 * `security_posture_report` (067) is asked separately, below, because its
 * answer is read as well as its existence.
 */
export const CHECKED_FUNCTIONS: ReadonlyArray<{ name: string; args: Record<string, unknown>; migration: string }> = [
  {
    name: "record_family_password_failure",
    migration: "064_sign_in_hardening.sql",
    args: { p_family: NO_ROW, p_max: 1, p_lockout: "0 minutes", p_ceiling: "0 minutes" },
  },
  {
    name: "begin_family_password_attempt",
    migration: "064_sign_in_hardening.sql",
    args: { p_family: NO_ROW, p_max: 1, p_lockout: "0 minutes", p_ceiling: "0 minutes" },
  },
  {
    name: "record_pin_failure",
    migration: "064_sign_in_hardening.sql",
    args: { p_person: NO_ROW, p_archive: NO_ROW, p_max: 1, p_lockout: "0 minutes", p_ceiling: "0 minutes" },
  },
  {
    name: "claim_mail_send",
    migration: "066_mail_throttle.sql",
    args: {
      p_recipient_hash: "schema-preflight",
      p_template: "schema-preflight",
      p_counted_templates: [],
      p_recipient_limit: 0,
      p_recipient_window: "1 hour",
      p_global_limit: 0,
      p_global_window: "1 day",
    },
  },
];

export interface PreflightFailure {
  label: string;
  table: string;
  message: string;
  /**
   * What kind of mismatch. Absent means a column list (the original check);
   * "function" is a database function the code calls; "posture" is the
   * access check below. All refuse the same way.
   */
  kind?: "columns" | "function" | "posture";
}

/**
 * Ask the database for each column list, cheapest possible question.
 *
 * `limit(0)` returns no rows and still validates every column name — the
 * planner resolves the select list before it decides there is nothing to
 * return. A missing column comes back as an error rather than as empty data,
 * which is the distinction that matters: absent and broken must not look
 * alike (the same rule the display's own guards live by).
 *
 * Then one more question of the same weight: is the database still deny-all
 * (checkSecurityPosture, below)?
 */
export async function checkSchema(): Promise<PreflightFailure[]> {
  const failures: PreflightFailure[] = [];

  for (const { table, columns, label } of CHECKED_SELECTS) {
    const { error } = await supabase.from(table).select(columns).limit(0);
    if (error) failures.push({ label, table, message: error.message });
  }

  for (const { name, args, migration } of CHECKED_FUNCTIONS) {
    const { error } = await supabase.rpc(name, args);
    if (error) failures.push({ kind: "function", label: name, table: migration, message: error.message });
  }

  failures.push(...(await checkSecurityPosture()));

  return failures;
}

/** The function migration 067 installs; the name the failures carry. */
export const POSTURE_REPORT = "security_posture_report";

interface PostureRow {
  problem: string;
  object: string;
  detail: string;
}

/**
 * Is the database still deny-all?
 *
 * RLS enabled with no policy on every table was the product's only lock for
 * its first two months, and nothing ever looked at it after a migration ran
 * (29 Sep 2026 review, finding 23). Migration 067 took anon's and
 * authenticated's grants back — a second lock — and installed
 * `security_posture_report()`, which lists every departure: a table without
 * RLS, any policy in public, any privilege those two roles hold. Healthy is
 * an empty answer.
 *
 * A departure is reported like a missing column, and so is a missing
 * report: before 067 has run the function does not exist, and "we could not
 * tell" must not read as "fine" — the same rule as absent-versus-broken
 * above. But it never stops the server (bootDecision): it is logged at error
 * level, in every environment, and the display keeps its API.
 */
export async function checkSecurityPosture(): Promise<PreflightFailure[]> {
  const { data, error } = await supabase.rpc(POSTURE_REPORT);

  if (error) {
    return [{ kind: "posture", label: POSTURE_REPORT, table: "-", message: error.message }];
  }
  if (!Array.isArray(data)) {
    return [
      { kind: "posture", label: POSTURE_REPORT, table: "-", message: "answered with something other than a list" },
    ];
  }

  return (data as PostureRow[]).map((row) => ({
    kind: "posture",
    label: row.problem,
    table: row.object,
    message: row.detail,
  }));
}

/** The sentence a person reads at 2am, written for the person who did not write this. */
export function describeFailures(failures: PreflightFailure[]): string {
  const columns = failures.filter((f) => f.kind !== "posture" && f.kind !== "function");
  const functions = failures.filter((f) => f.kind === "function");
  const posture = failures.filter((f) => f.kind === "posture");
  const parts: string[] = [];

  if (columns.length || functions.length) {
    parts.push(
      columns.length && functions.length
        ? "This build asks the database for columns and functions it does not have."
        : functions.length
          ? "This build calls database functions the database does not have."
          : "This build asks the database for columns it does not have.",
      "",
      ...columns.map((f) => `  ${f.label} (table "${f.table}") — ${f.message}`),
      ...functions.map((f) => `  ${f.label}() (installed by ${f.table}) — ${f.message}`),
      "",
      "Almost always this means a migration in supabase/migrations/ has not been",
      "run yet. Apply the outstanding migrations. Until then, every route that",
      "uses what is named above fails, usually with a 500 — and that failure does",
      "not look like a migration, which is why this says so here instead."
    );
  }

  if (posture.length) {
    if (parts.length) parts.push("");
    const unanswered = posture.some((f) => f.label === POSTURE_REPORT);
    parts.push(
      "The database is not deny-all, or cannot say whether it is.",
      "",
      ...posture.map((f) =>
        f.label === POSTURE_REPORT
          ? `  ${f.label}() — ${f.message}`
          : `  ${f.label}: ${f.table} — ${f.message}`
      ),
      ""
    );
    parts.push(
      ...(unanswered
        ? [
            "The report is installed by supabase/migrations/067_revoke_default_grants.sql.",
            "Run that migration; until then nothing checks who else can read the tables.",
          ]
        : [
            "Every table in public needs row level security with no policy, and anon and",
            "authenticated must hold nothing (067). A new table was probably created",
            "without `enable row level security`, or a grant came back. Fix it with a",
            "migration in supabase/migrations/.",
          ])
    );
  }

  return parts.join("\n");
}

/**
 * What the boot does with the preflight's answer.
 *
 * A missing column or function refuses in production, as it always has: it
 * arrives with a deploy, and a NEW revision that fails to become ready
 * leaves the previous one serving.
 *
 * A posture departure never refuses. It arrives out of band — a later
 * migration, a table or extension added from the dashboard — and the
 * preflight runs on every container start, not only a new deploy: Cloud Run
 * replacing its one warm instance, scaling out, or restarting after a crash
 * starts the revision ALREADY serving, and there is no previous revision
 * behind it. Refusing there took api.example.com down, and Margaret's
 * display with it (M186: her screen runs against that API), over a
 * hygiene alarm. So it is logged at error level, loudly, with the whole
 * report, and the server serves.
 */
export type BootDecision = "serve" | "warn" | "refuse";

export function bootDecision(
  failures: PreflightFailure[],
  env: { RECALL_ENV?: string; NODE_ENV?: string } = process.env
): BootDecision {
  if (!failures.length) return "serve";
  const schemaMismatch = failures.some((f) => f.kind !== "posture");
  return schemaMismatch && mustRefuseOnMismatch(env) ? "refuse" : "warn";
}

/**
 * Must a mismatched build refuse to serve?
 *
 * Yes in production, where a refusal is protective: Cloud Run keeps the
 * previous revision serving, so the last build that matched the database goes
 * on working. No on a laptop, where there is no previous revision — refusing
 * preserves nothing, it just means no server, and the developer cannot reach
 * the product to fix the very thing being complained about. The first version
 * of this guard refused everywhere and took the development server down
 * within the hour (M223).
 *
 * The signal is explicit and greppable — `RECALL_ENV`, set in package.json's
 * dev script — and its ABSENCE means refuse. The dangerous direction is a
 * production deploy quietly deciding it is a laptop; the harmless direction
 * is a laptop being told to set a variable.
 */
export function mustRefuseOnMismatch(
  env: { RECALL_ENV?: string; NODE_ENV?: string } = process.env
): boolean {
  return !(env.RECALL_ENV === "development" || env.NODE_ENV === "test");
}
