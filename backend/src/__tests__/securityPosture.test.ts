import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The boot check's second question: is the database still deny-all?
 * (29 Sep 2026 review, finding 23; migration 067.)
 *
 * The client is a stub that answers `rpc("security_posture_report")` with
 * whatever the case needs and every column probe with success, so what is
 * under test is the reading of the answer — including the answer "there is
 * no such function", which is what a database without 067 says.
 */

let rpcAnswer: { data: unknown; error: { message: string } | null } = { data: [], error: null };
const rpcCalls: string[] = [];

vi.mock("../config/supabase.js", () => ({
  supabase: {
    from: () => ({ select: () => ({ limit: async () => ({ data: [], error: null }) }) }),
    rpc: async (fn: string) => {
      rpcCalls.push(fn);
      return rpcAnswer;
    },
  },
}));

const { bootDecision, checkSchema, checkSecurityPosture, describeFailures, POSTURE_REPORT } = await import(
  "../services/schemaPreflight.js"
);

beforeEach(() => {
  rpcAnswer = { data: [], error: null };
  rpcCalls.length = 0;
});

describe("the database answers deny-all", () => {
  it("passes when the report is empty", async () => {
    expect(await checkSecurityPosture()).toEqual([]);
    expect(rpcCalls).toEqual(["security_posture_report"]);
  });

  it("is asked at boot, beside the column lists", async () => {
    expect(await checkSchema()).toEqual([]);
    expect(rpcCalls).toContain("security_posture_report");
  });
});

describe("a departure is reported like a missing column", () => {
  it("reports every row the function returns", async () => {
    rpcAnswer = {
      data: [
        { problem: "rls_disabled", object: "archive_service_requests", detail: "row level security is not enabled" },
        { problem: "policy", object: "people", detail: 'policy "Public read" (SELECT to public)' },
        { problem: "table_grant", object: "families", detail: "anon holds SELECT" },
      ],
      error: null,
    };

    const failures = await checkSchema();
    expect(failures.map((f) => [f.label, f.table])).toEqual([
      ["rls_disabled", "archive_service_requests"],
      ["policy", "people"],
      ["table_grant", "families"],
    ]);
    expect(failures.every((f) => f.kind === "posture")).toBe(true);

    const message = describeFailures(failures);
    expect(message).toContain("archive_service_requests");
    expect(message).toContain("anon holds SELECT");
    expect(message).toContain("row level security");
    expect(message).toContain("supabase/migrations/");
    // The outcome belongs to the call site (M223), as for columns.
    expect(message).not.toMatch(/refus/i);
    // And it does not claim a column is missing when none is.
    expect(message).not.toContain("columns it does not have");
  });

  /*
    Before 067 runs, the function does not exist. "We could not tell" must
    not read as "fine": it is a failure, and the message names the migration.
  */
  it("treats a missing report as a failure that names migration 067", async () => {
    rpcAnswer = {
      data: null,
      error: { message: "Could not find the function public.security_posture_report without parameters in the schema cache" },
    };

    const failures = await checkSecurityPosture();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ kind: "posture", label: POSTURE_REPORT });

    const message = describeFailures(failures);
    expect(message).toContain("067_revoke_default_grants.sql");
    expect(message).toContain("Could not find the function");
  });

  it("treats an answer that is not a list as a failure", async () => {
    rpcAnswer = { data: { ok: true }, error: null };
    const failures = await checkSecurityPosture();
    expect(failures).toHaveLength(1);
    expect(failures[0].label).toBe(POSTURE_REPORT);
  });

  it("describes columns and posture together when both are wrong", () => {
    const message = describeFailures([
      { label: "PERSON_ADMIN_COLUMNS", table: "people", message: "column people.admin_note does not exist" },
      { kind: "posture", label: "rls_disabled", table: "new_table", message: "row level security is not enabled" },
    ]);
    expect(message).toContain("admin_note");
    expect(message).toContain("new_table");
  });
});

/*
  The preflight runs on every container start — including a replacement
  instance of the revision already serving, which has no previous revision
  behind it. A posture departure arriving out of band (a table made from the
  dashboard) must not take the API, and her display, down at the next cold
  start.
*/
describe("what the boot does with the answer", () => {
  const PRODUCTION = {};
  const LAPTOP = { RECALL_ENV: "development" };
  const posture = { kind: "posture" as const, label: "rls_disabled", table: "new_table", message: "row level security is not enabled" };
  const unanswered = { kind: "posture" as const, label: "security_posture_report", table: "-", message: "Could not find the function" };
  const column = { label: "PERSON_ADMIN_COLUMNS", table: "people", message: "column people.admin_note does not exist" };
  const fn = { kind: "function" as const, label: "claim_mail_send", table: "066_mail_throttle.sql", message: "missing" };

  it("serves when there is nothing to say", () => {
    expect(bootDecision([], PRODUCTION)).toBe("serve");
  });

  it("never refuses in production over posture alone — it warns and serves", () => {
    expect(bootDecision([posture], PRODUCTION)).toBe("warn");
    expect(bootDecision([unanswered], PRODUCTION)).toBe("warn");
    expect(bootDecision([posture, unanswered], PRODUCTION)).toBe("warn");
  });

  it("still refuses in production over a missing column or function", () => {
    expect(bootDecision([column], PRODUCTION)).toBe("refuse");
    expect(bootDecision([fn], PRODUCTION)).toBe("refuse");
    expect(bootDecision([posture, column], PRODUCTION)).toBe("refuse");
  });

  it("serves on a laptop whatever is wrong, as before", () => {
    expect(bootDecision([column, posture], LAPTOP)).toBe("warn");
  });

  it("server.ts exits only on the refuse decision", () => {
    const server = readFileSync(new URL("../server.ts", import.meta.url).pathname, "utf8");
    expect(server).toMatch(/bootDecision\(failures\)/);
    // The one exit is inside the refuse branch.
    expect(server.match(/process\.exit\(1\)/g)).toHaveLength(1);
    expect(server).toMatch(/if \(decision === "refuse"\) \{[^}]*process\.exit\(1\)/);
  });
});

describe("migration 067", () => {
  const sql = readFileSync(
    new URL("../../../supabase/migrations/067_revoke_default_grants.sql", import.meta.url).pathname,
    "utf8"
  );

  it("takes back what anon and authenticated hold, now and for new objects", () => {
    expect(sql).toMatch(/revoke all on all tables\s+in schema public from anon, authenticated;/);
    expect(sql).toMatch(/revoke all on all sequences\s+in schema public from anon, authenticated;/);
    expect(sql).toMatch(/revoke all on all routines\s+in schema public from public, anon, authenticated;/);
    expect(sql).toMatch(/alter default privileges for role postgres in schema public\s+revoke all on tables from anon, authenticated;/);
    // PUBLIC's EXECUTE on new functions is global; only the global form removes it.
    expect(sql).toMatch(/alter default privileges for role postgres\s+revoke execute on functions from public;/);
  });

  it("keeps the backend's key working", () => {
    expect(sql).toMatch(/grant all\s+on all tables\s+in schema public to service_role;/);
    expect(sql).toMatch(/grant execute on all routines\s+in schema public to service_role;/);
  });

  it("installs the report as service_role only, with a fixed search_path", () => {
    expect(sql).toMatch(/create or replace function security_posture_report\(\)/);
    expect(sql).toMatch(/set search_path = public/);
    expect(sql).toMatch(/revoke all on function security_posture_report\(\) from public, anon, authenticated;/);
    expect(sql).toMatch(/grant execute on function security_posture_report\(\) to service_role;/);
    expect(sql).not.toMatch(/security definer/);
  });

  it("counts a grant on some columns as a grant", () => {
    // has_table_privilege is false after `grant select (email) on people to
    // anon`; has_any_column_privilege is true (checked on PGlite).
    expect(sql).toMatch(/has_any_column_privilege\(r\.rolname, c\.oid, priv\.name\)/);
    for (const priv of ["SELECT", "INSERT", "UPDATE", "REFERENCES"]) {
      expect(sql).toContain(`('${priv}', true)`);
    }
    for (const priv of ["DELETE", "TRUNCATE", "TRIGGER"]) {
      expect(sql).toContain(`('${priv}', false)`);
    }
  });

  it("leaves extension members out of the table, sequence and function checks alike", () => {
    const report = sql.slice(sql.indexOf("create or replace function security_posture_report"), sql.indexOf("revoke all on function security_posture_report"));
    expect(report.match(/d\.classid = 'pg_class'::regclass/g)).toHaveLength(3);
    expect(report.match(/d\.classid = 'pg_proc'::regclass/g)).toHaveLength(1);
    expect(report.match(/d\.deptype = 'e'/g)).toHaveLength(4);
  });

  it("says which role ran it, and changes that role's defaults too", () => {
    expect(sql).toMatch(/select 'migrations run as postgres' as check/);
    expect(sql).toMatch(/if current_user <> 'postgres' then/);
    expect(sql).toMatch(/alter default privileges for role %I in schema public revoke all on tables from anon, authenticated/);
    expect(sql).toMatch(/d\.defaclrole in \('postgres'::regrole, current_user::text::regrole\)/);
  });

  it("creates no policy", () => {
    expect(sql).not.toMatch(/^\s*create policy/im);
  });
});
