import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CHECKED_SELECTS, describeFailures, mustRefuseOnMismatch } from "../services/schemaPreflight.js";

/**
 * The boot check has to know about every column list, including the next one.
 *
 * A guard that reads a hand-maintained list of columns would share the exact
 * blind spot that let `admin_note` reach production ahead of its migration:
 * somebody adds a column and forgets the other place. So the check consumes
 * the DTO constants themselves — and this file closes the remaining gap by
 * reading `dto.ts` and failing if a newly exported `*_COLUMNS` was never
 * registered. Forgetting to register one is then a red test rather than a
 * silent hole, which is the difference between a backstop and a list.
 */

const DTO_SOURCE = new URL("../services/dto.ts", import.meta.url).pathname;

function exportedColumnLists(): string[] {
  const src = readFileSync(DTO_SOURCE, "utf8");
  return [...src.matchAll(/^export const ([A-Z0-9_]*COLUMNS)\b/gm)].map((m) => m[1]);
}

describe("every column list the code exports is checked at boot", () => {
  it("registers each exported *_COLUMNS constant", () => {
    const registered = new Set(CHECKED_SELECTS.map((s) => s.label));
    const missing = exportedColumnLists().filter((name) => !registered.has(name));

    expect(
      missing,
      `these column lists are exported from dto.ts but never checked at boot: ${missing.join(", ")}`
    ).toEqual([]);
  });

  it("found some lists at all — the reader must not silently match nothing", () => {
    // Guards the guard: if the regex stopped matching, the test above would
    // pass by comparing two empty sets, which is the false-pin shape.
    expect(exportedColumnLists().length).toBeGreaterThan(5);
    expect(CHECKED_SELECTS.length).toBeGreaterThan(5);
  });

  it("names a real table for every list", () => {
    for (const { label, table } of CHECKED_SELECTS) {
      expect(table, `${label} has no table`).toMatch(/^[a-z_]+$/);
    }
  });
});

describe("what a person reads when it refuses", () => {
  it("names the column, the list and the likely cause", () => {
    const message = describeFailures([
      {
        label: "PERSON_ADMIN_COLUMNS",
        table: "people",
        message: "column people.admin_note does not exist",
      },
    ]);

    // The three things somebody needs at 2am: what is missing, where it is
    // asked for, and what to do about it.
    expect(message).toContain("admin_note");
    expect(message).toContain("PERSON_ADMIN_COLUMNS");
    expect(message).toContain("supabase/migrations/");
    // It says what breaks meanwhile, so the reader knows this is not cosmetic.
    expect(message).toContain("500");

    /*
      And it must NOT claim an outcome. The shared text is printed both where
      the server refuses and where it serves anyway (M223), so a sentence like
      "Refusing to start" belongs at the call site that knows which happened —
      not in a message that would then contradict itself on a laptop.
    */
    expect(message).not.toMatch(/refus/i);
  });
});

describe("where a mismatched build refuses, and where it serves", () => {
  /*
    The first version refused everywhere and took the development server down
    within the hour (M223). Refusing is protective only where a previous
    revision keeps serving — on a laptop it just means no server, and no way
    to reach the product to fix what the guard is complaining about.
  */
  it("serves on a laptop, so the developer can still work", () => {
    expect(mustRefuseOnMismatch({ RECALL_ENV: "development" })).toBe(false);
  });

  it("serves under test, where the client is a recorder", () => {
    expect(mustRefuseOnMismatch({ NODE_ENV: "test" })).toBe(false);
  });

  it("refuses in production", () => {
    expect(mustRefuseOnMismatch({ NODE_ENV: "production" })).toBe(true);
  });

  /*
    The direction that matters. A production deploy that loses its variables
    must not quietly decide it is a laptop — so absence, emptiness and
    nonsense all fall through to refusing.
  */
  it("refuses when the signal is absent, empty or unreadable", () => {
    for (const env of [{}, { RECALL_ENV: "" }, { RECALL_ENV: "dev" }, { RECALL_ENV: "DEVELOPMENT" }, { NODE_ENV: "" }]) {
      expect(mustRefuseOnMismatch(env), JSON.stringify(env)).toBe(true);
    }
  });
});
