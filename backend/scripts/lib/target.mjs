/**
 * Name the database you are about to write to.
 *
 * There is one Supabase project, and it is production: the laptop's .env, the
 * scratch-family seeder, the scene seeders and the migration runner all point
 * at it. Until 16 Sep 2026 nothing stood between `node scripts/anything.mjs`
 * and the paying families' rows except the operator remembering that.
 *
 * Every script that builds a service-role client calls this first. It refuses
 * unless RECALL_TARGET names the project ref the URL resolves to — so the
 * confirmation is the ref itself, typed on purpose, never a generic "yes":
 *
 *   RECALL_TARGET=REPLACE_ME_PROJECT_REF node scripts/scratch-family.mjs device
 *
 * A second project (a real staging database) needs no change here: its ref is
 * the word you type.
 */
export function assertWriteTarget() {
  const url = process.env.SUPABASE_URL ?? "";
  let ref = "";
  try {
    ref = new URL(url).hostname.split(".")[0];
  } catch {
    ref = "";
  }
  if (!ref) {
    console.error("SUPABASE_URL is not set, so there is no database to write to.");
    process.exit(2);
  }
  if (process.env.RECALL_TARGET !== ref) {
    console.error(
      [
        `This script writes to Supabase project "${ref}".`,
        `Confirm the target by naming it:  RECALL_TARGET=${ref} node ${process.argv.slice(1).join(" ")}`,
        "(Refused, nothing was written.)",
      ].join("\n")
    );
    process.exit(2);
  }
  return ref;
}
