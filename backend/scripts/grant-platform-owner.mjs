/**
 * Grants the platform-owner role to one family row, and sets its password.
 *
 * The platform owner is whoever runs Recall itself — **not** a family owner,
 * who administers one archive. This row owns no archive on purpose: no shelf,
 * no profiles, no memories, and therefore no way to reach a family's content
 * even by accident. Its password opens exactly one page, `/owner`.
 *
 * There is deliberately no route and no screen that does this. A form that
 * could grant platform ownership would be a form worth attacking, so the
 * grant lives here, needs the service-role key, and is run by hand.
 *
 * Usage — the password is read from the environment, never from a flag, so
 * it stays out of shell history and out of this file:
 *
 *   OWNER_EMAIL=you@example.com OWNER_NAME="Your Name" \
 *   OWNER_PASSWORD='…' node scripts/grant-platform-owner.mjs
 *
 * Re-running is safe: it updates the row it made last time.
 */
import { createClient } from "@supabase/supabase-js";
import argon2 from "argon2";
import ws from "ws";
import { config } from "dotenv";
import { assertWriteTarget } from "./lib/target.mjs";

config({ path: ".env.local" });
config();

const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
const name = process.env.OWNER_NAME?.trim();
const password = process.env.OWNER_PASSWORD;

if (!email || !name || !password) {
  console.error("Set OWNER_EMAIL, OWNER_NAME and OWNER_PASSWORD in the environment.");
  process.exit(1);
}
if (password.length < 10) {
  console.error("That password is too short for the one account that sees every family.");
  process.exit(1);
}

// Node 20 has no native WebSocket; the realtime client insists on one even
// though nothing here subscribes to anything.
assertWriteTarget();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws },
});

const password_hash = await argon2.hash(password.normalize("NFKC"), { type: argon2.argon2id });
const now = new Date().toISOString();

const { data: existing } = await supabase
  .from("families")
  .select("id, archive_id, platform_owner")
  .ilike("email", email)
  .maybeSingle();

if (existing?.archive_id) {
  console.error(
    `Refusing: ${email} already owns archive ${existing.archive_id}. The platform owner must ` +
      `own no archive, so that the role can never be a way into a family's memories. Use an ` +
      `address that is not already a family.`
  );
  process.exit(1);
}

/*
 * Taking the role from somebody is a decision, not a side effect.
 *
 * This used to stand every other platform owner down silently, so that the
 * grant could never collide with 030's one-owner index. That is a
 * dethronement disguised as a convenience: running this script for a
 * throwaway address quietly transferred the whole platform's ownership away
 * from whoever actually held it. It happened — a verification account took
 * the role from the real owner, and only the fact that somebody noticed
 * within the minute kept it from persisting.
 *
 * So the incumbent is named and the script stops. `--force` is how you say
 * you meant it, and it has to be typed by a person who has just read who
 * they are about to replace.
 */
const { data: owners } = await supabase
  .from("families")
  .select("id, email")
  .eq("platform_owner", true);

// Held by somebody else — the only case where anything is taken away.
const incumbents = (owners ?? []).filter((o) => o.email.toLowerCase() !== email);
const forced = process.env.OWNER_FORCE === "1";

/*
 * More than one owner should be impossible — 030's partial unique index says
 * so. If it has happened, a previous silent run split the crown, and quietly
 * collapsing it would hide the very thing worth knowing.
 */
if (owners && owners.length > 1) {
  console.error(
    `Stop: ${owners.length} families hold platform_owner — ${owners
      .map((o) => o.email)
      .join(", ")}. That should be impossible. Sort out which one is real before granting it.`
  );
  process.exit(1);
}

if (incumbents.length > 0 && !forced) {
  console.error(
    `${incumbents[0].email} already holds platform ownership.\n\n` +
      `Granting it to ${email} would take it away from them — there is only one, by design. ` +
      `Re-run with OWNER_FORCE=1 to transfer it.\n` +
      `If you only wanted a look at /owner, sign in as ${incumbents[0].email} instead.`
  );
  process.exit(1);
}

// The dangerous write, now reachable only on the forced path and only against
// the family actually named — never blindly against everyone else.
for (const previous of incumbents) {
  console.warn(`Transferring platform ownership: ${previous.email} → ${email}`);
  await supabase.from("families").update({ platform_owner: false }).eq("id", previous.id);
}

const row = {
  email,
  display_name: name,
  password_hash,
  password_set_at: now,
  platform_owner: true,
  status: "active",
  email_verified_at: now,
  archive_id: null,
};

const { data, error } = existing
  ? await supabase.from("families").update(row).eq("id", existing.id).select("id").single()
  : await supabase.from("families").insert(row).select("id").single();

if (error) {
  console.error(`Could not grant it: ${error.message}`);
  process.exit(1);
}

// The password is never printed, and never written anywhere but the hash.
console.log(`${email} is the platform owner (family ${data.id}). It owns no archive.`);
console.log("Sign in at /login with that address, then open /owner.");
