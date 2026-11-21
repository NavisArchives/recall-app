/**
 * "This file knows about failure, and this call site does not." (M213)
 *
 * The narrow cut. A wider question — *which query reads don't check for
 * failure?* — returns 39 sites, and 39 is a wall: each needs a judgement
 * about whether the result reaches rendered text, and a list nobody can
 * read in one sitting gets rubber-stamped. That is how a false exemption
 * survived for months in `absenceClaims`.
 *
 * This asks the sharper one instead: **within a file that handles a query
 * failure somewhere, which call sites don't?** The author demonstrably had
 * the concept in hand and applied it once. Every one of the seven instances
 * found so far fits it — a second query in a file whose first was guarded.
 *
 * It targets the population where a miss is least defensible rather than
 * the population where it is merely possible.
 *
 * ── The predicate, and the correction it needed ──────────────────────────
 *
 * First version matched only `isError`, and produced **2 false positives in
 * a list of 23** — `ContributorProfilePage` and `EditChannel` both
 * destructure `error:` and handle it properly. A 9% false-positive rate on
 * first contact is how an instrument gets a reputation before it gets a
 * chance; people learn to skim a list that cried wolf twice.
 *
 * So a site counts as handled if it takes **`isError` or `error`**.
 *
 *   node scripts/unguarded-reads.mjs
 *
 * ── What it does NOT tell you ────────────────────────────────────────────
 *
 * Nothing here is a finding. A site is a **candidate**, and the hand walk of
 * the first 23 came back **6 real, 7 mild, 8 benign** — so roughly a
 * quarter. Each still needs a person to ask whether the result reaches
 * something a family reads. It also only sees files that ship (M209) and
 * cannot see the prose half of the class at all (M197).
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const shipped = new Set(
  JSON.parse(readFileSync("src/lib/__tests__/shipped-modules.json", "utf8")).modules
);

const files = execFileSync("git", ["ls-files", "--", "*.ts", "*.tsx"], {
  cwd: "src",
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean)
  .filter((f) => !f.includes("__tests__") && !f.startsWith("dev/"));

/** Only hooks that actually wrap `useQuery`, read from the hooks file. */
const hooks = new Set(
  [...readFileSync("src/hooks/useAdminData.ts", "utf8").matchAll(/export const (use\w+) =\s*\(/g)].map(
    (m) => m[1]
  )
);
hooks.add("useQuery");

const CALL = /(const\s*\{[^}]*\}|const\s+\w+)\s*=\s*(use[A-Z]\w*)\(/g;
/*
  `error:` counts as handling it. That is the whole correction — see above.
  `isError` alone called two careful files careless.
*/
const HANDLES = /\bisError\b|\berror\s*:/;

let total = 0;
let handled = 0;
const candidates = [];

for (const rel of files) {
  if (!shipped.has(rel)) continue;
  const src = readFileSync(`src/${rel}`, "utf8");

  const sites = [...src.matchAll(CALL)]
    .filter((m) => hooks.has(m[2]))
    .map((m) => ({ lhs: m[1], name: m[2], line: src.slice(0, m.index).split("\n").length }));
  if (!sites.length) continue;

  const fileKnows = sites.some((s) => HANDLES.test(s.lhs));

  for (const site of sites) {
    total++;
    if (HANDLES.test(site.lhs)) handled++;
    else if (fileKnows) candidates.push(`${rel}:${site.line}  ${site.name}`);
  }
}

console.log(`shipped query-hook call sites            : ${total}`);
console.log(`  handle failure (isError or error)      : ${handled}`);
console.log(`  NARROW CUT — file knows, site does not  : ${candidates.length}\n`);
for (const c of candidates) console.log(`   ${c}`);
console.log(
  "\nCandidates, not findings. The first hand walk of 23 was 6 real, 7 mild, 8 benign."
);
