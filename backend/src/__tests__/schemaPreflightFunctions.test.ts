import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The boot check knows the functions and columns 064–066 added.
 *
 * Before these, a deploy ahead of its migration failed the way the preflight
 * exists to prevent: every family sign-in refused with the ordinary "did not
 * match" sentence (064's columns), every public email held back (066's
 * function), exports refused (065's table) — and nothing said "migration".
 *
 * The client is a stub: column probes succeed unless a table is named in
 * `missingTables`, and each rpc answers from `rpcErrors` or with an empty
 * list. What is under test is what gets asked, with what, and how a missing
 * answer is described.
 */

const rpcCalls: Array<{ fn: string; args: Record<string, unknown> | undefined }> = [];
const selects: Array<{ table: string; columns: string }> = [];
let rpcErrors: Record<string, string> = {};
let missingTables: Record<string, string> = {};

vi.mock("../config/supabase.js", () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => ({
        limit: async () => {
          selects.push({ table, columns });
          return missingTables[table]
            ? { data: null, error: { message: missingTables[table] } }
            : { data: [], error: null };
        },
      }),
    }),
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return rpcErrors[fn] ? { data: null, error: { message: rpcErrors[fn] } } : { data: [], error: null };
    },
  },
}));

const { checkSchema, describeFailures, CHECKED_FUNCTIONS, CHECKED_SELECTS } = await import(
  "../services/schemaPreflight.js"
);
const { FAMILY_SIGN_IN_COLUMNS, OWNER_SECOND_FACTOR_COLUMNS, OWNER_AUDIT_COLUMNS, PIN_COUNTER_COLUMNS } =
  await import("../services/dto.js");

beforeEach(() => {
  rpcCalls.length = 0;
  selects.length = 0;
  rpcErrors = {};
  missingTables = {};
});

const NIL = "00000000-0000-0000-0000-000000000000";

describe("the columns 064 and 065 added are asked for at boot", () => {
  it("probes the sign-in, second-factor, audit and PIN-counter lists on their tables", async () => {
    expect(await checkSchema()).toEqual([]);
    expect(selects).toContainEqual({ table: "families", columns: FAMILY_SIGN_IN_COLUMNS });
    expect(selects).toContainEqual({ table: "families", columns: OWNER_SECOND_FACTOR_COLUMNS });
    expect(selects).toContainEqual({ table: "owner_audit_log", columns: OWNER_AUDIT_COLUMNS });
    expect(selects).toContainEqual({ table: "people", columns: PIN_COUNTER_COLUMNS });
    expect(PIN_COUNTER_COLUMNS).toContain("pin_lock_count");
  });

  it("a missing audit table is a column failure naming the table", async () => {
    missingTables.owner_audit_log = 'relation "public.owner_audit_log" does not exist';
    const failures = await checkSchema();
    expect(failures).toEqual([
      { label: "OWNER_AUDIT_COLUMNS", table: "owner_audit_log", message: missingTables.owner_audit_log },
    ]);
  });

  it("the sign-in routes read the dto constants, not a private copy", () => {
    for (const [file, name] of [
      ["../routes/family.ts", "FAMILY_SIGN_IN_COLUMNS"],
      ["../routes/owner.ts", "OWNER_SECOND_FACTOR_COLUMNS"],
    ] as const) {
      const src = readFileSync(new URL(file, import.meta.url).pathname, "utf8");
      expect(src, file).not.toMatch(new RegExp(`const ${name}\\s*=`));
      expect(src, file).toMatch(new RegExp(`\\.select\\(${name}\\)`));
    }
  });
});

describe("the functions 064 and 066 installed are asked for at boot", () => {
  it("calls each one, with arguments that change nothing", async () => {
    await checkSchema();
    const byName = Object.fromEntries(rpcCalls.map((c) => [c.fn, c.args]));

    // Both counters UPDATE the row they are given; no row has the nil id.
    expect(byName.record_family_password_failure).toMatchObject({ p_family: NIL });
    // The claim finds no row for the nil id and returns nothing.
    expect(byName.begin_family_password_attempt).toMatchObject({ p_family: NIL });
    expect(byName.record_pin_failure).toMatchObject({ p_person: NIL, p_archive: NIL });
    // A limit of 0 answers "not allowed" before anything is inserted.
    expect(byName.claim_mail_send).toMatchObject({ p_global_limit: 0, p_recipient_limit: 0 });
    // And the posture report is still asked (067).
    expect(Object.keys(byName)).toContain("security_posture_report");
  });

  it("a missing function is a failure that names it and its migration", async () => {
    rpcErrors.record_pin_failure =
      "Could not find the function public.record_pin_failure(p_archive, p_ceiling, p_lockout, p_max, p_person) in the schema cache";
    const failures = await checkSchema();
    expect(failures).toEqual([
      {
        kind: "function",
        label: "record_pin_failure",
        table: "064_sign_in_hardening.sql",
        message: rpcErrors.record_pin_failure,
      },
    ]);

    const message = describeFailures(failures);
    expect(message).toContain("record_pin_failure()");
    expect(message).toContain("064_sign_in_hardening.sql");
    expect(message).toContain("supabase/migrations/");
    expect(message).not.toContain("columns it does not have");
    expect(message).not.toMatch(/refus/i);
  });

  it("describes a missing column and a missing function together", () => {
    const message = describeFailures([
      { label: "FAMILY_SIGN_IN_COLUMNS", table: "families", message: "column families.password_lock_count does not exist" },
      { kind: "function", label: "claim_mail_send", table: "066_mail_throttle.sql", message: "Could not find the function" },
    ]);
    expect(message).toContain("columns and functions");
    expect(message).toContain("password_lock_count");
    expect(message).toContain("claim_mail_send()");
  });
});

/*
 * PostgREST resolves an rpc by its argument NAMES. The boot check only
 * proves something if it passes the same names the code passes and the
 * migration declares — so all three are compared here, from source.
 */
describe("the boot check, the code and the migrations agree on each signature", () => {
  const migrationsDir = new URL("../../../supabase/migrations/", import.meta.url).pathname;

  function declaredParams(migration: string, fn: string): string[] {
    const sql = readFileSync(migrationsDir + migration, "utf8");
    const match = sql.match(new RegExp(`create (?:or replace )?function ${fn}\\(([^)]*)\\)`, "i"));
    expect(match, `${fn} is not created in ${migration}`).not.toBeNull();
    return match![1]
      .split(",")
      .map((part) => part.trim().split(/\s+/)[0])
      .filter(Boolean)
      .sort();
  }

  function calledParams(sourceFile: string, fn: string): string[] {
    const src = readFileSync(new URL(sourceFile, import.meta.url).pathname, "utf8");
    const match = src.match(new RegExp(`rpc\\("${fn}",\\s*\\{([\\s\\S]*?)\\}\\)`));
    expect(match, `${sourceFile} does not call ${fn}`).not.toBeNull();
    return [...match![1].matchAll(/(p_[a-z_]+)\s*:/g)].map((m) => m[1]).sort();
  }

  const callers: Record<string, string> = {
    record_family_password_failure: "../services/familyAuth.ts",
    begin_family_password_attempt: "../services/familyAuth.ts",
    record_pin_failure: "../services/pins.ts",
    claim_mail_send: "../services/email.ts",
  };

  it("checks every function the code calls through these migrations", () => {
    expect(CHECKED_FUNCTIONS.map((f) => f.name).sort()).toEqual(Object.keys(callers).sort());
  });

  for (const { name, args, migration } of CHECKED_FUNCTIONS) {
    it(`${name}: preflight, caller and ${migration} name the same arguments`, () => {
      const declared = declaredParams(migration, name);
      expect(Object.keys(args).sort()).toEqual(declared);
      expect(calledParams(callers[name], name)).toEqual(declared);
    });
  }

  it("every table the column lists name is one a migration creates", () => {
    const all = readFileSync(migrationsDir + "065_owner_audit.sql", "utf8");
    expect(all).toMatch(/create table if not exists owner_audit_log/);
    expect(CHECKED_SELECTS.some((s) => s.table === "owner_audit_log")).toBe(true);
  });
});
