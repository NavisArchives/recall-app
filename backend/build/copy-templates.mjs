import { cp, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Carries `src/templates` into `dist` (M241).
 *
 * `tsc` compiles TypeScript and copies nothing else, and the Dockerfile ships
 * only `dist`. A template left behind is a route that works on every laptop
 * and throws ENOENT the first time the owner presses Export in production —
 * the worst shape of bug this codebase has a name for.
 *
 * So this runs as part of `npm run build` and REFUSES to succeed quietly: if
 * the source directory is missing, or nothing lands in dist, it exits non-zero
 * and the image never builds.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const from = path.join(here, "..", "src", "templates");
const to = path.join(here, "..", "dist", "templates");

async function countFiles(dir) {
  let n = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += await countFiles(path.join(dir, entry.name));
    else n += 1;
  }
  return n;
}

try {
  await stat(from);
} catch {
  console.error(`[build] no templates directory at ${from}`);
  process.exit(1);
}

const expected = await countFiles(from);
if (expected === 0) {
  console.error("[build] the templates directory is empty — nothing to ship");
  process.exit(1);
}

await cp(from, to, { recursive: true });

const landed = await countFiles(to);
if (landed < expected) {
  console.error(`[build] copied ${landed} of ${expected} template files`);
  process.exit(1);
}

console.log(`[build] templates: ${landed} file(s) -> dist/templates`);
