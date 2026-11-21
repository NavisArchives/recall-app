/**
 * Gives an ownerless archive an owner account and a membership.
 *
 * Archives created before the accounts table existed have no
 * `owner_account_id` and no rows in `archive_memberships` — their admin is a
 * `people` row and nothing else. That was fine while the kiosk chooser was
 * the only way in. It stops being fine at M12, where authorization reads
 * memberships: switching the middleware with none present would lock the
 * founder out of his own archive.
 *
 * This is a repair, not a migration. The email belongs to one deployment and
 * has no business in a chain every future install runs, so it is asked for
 * here and never guessed.
 *
 * Usage:
 *   node scripts/adopt-archive.mjs --archive <uuid> --email <address> [--dry-run]
 */
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { config } from "dotenv";
import { assertWriteTarget } from "./lib/target.mjs";

config();

const args = process.argv.slice(2);
const value = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
};

const archiveId = value("--archive");
const rawEmail = value("--email");
const dryRun = args.includes("--dry-run");

if (!archiveId || !rawEmail || archiveId.startsWith("--") || rawEmail.startsWith("--")) {
  console.error("Usage: node scripts/adopt-archive.mjs --archive <uuid> --email <address> [--dry-run]");
  process.exit(1);
}
if (!/^[0-9a-f-]{36}$/i.test(archiveId)) {
  console.error(`Not an archive id: ${archiveId}`);
  process.exit(1);
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
  console.error(`Not an email address: ${rawEmail}`);
  process.exit(1);
}

const email = rawEmail.trim().toLowerCase();
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

assertWriteTarget();
const supabase = createClient(url, key, {
  auth: { persistSession: false },
  realtime: { transport: ws },
});

const { data: archive, error: archiveError } = await supabase
  .from("archives")
  .select("id, name, owner_account_id")
  .eq("id", archiveId)
  .maybeSingle();

if (archiveError) {
  console.error("Could not read the archive:", archiveError.message);
  process.exit(1);
}
if (!archive) {
  console.error(`No archive with id ${archiveId}.`);
  process.exit(1);
}
if (archive.owner_account_id) {
  console.error(`${archive.name} already has an owner. Nothing to do.`);
  process.exit(1);
}

// The admin on the shelf becomes the account holder. More than one is not a
// decision a script should make.
const { data: admins } = await supabase
  .from("people")
  .select("id, name, email")
  .eq("archive_id", archiveId)
  .eq("role", "admin")
  .eq("status", "active")
  .is("archived_at", null)
  .order("created_at");

if (!admins?.length) {
  console.error(`${archive.name} has no active admin to adopt it.`);
  process.exit(1);
}
if (admins.length > 1) {
  console.error(`${archive.name} has ${admins.length} admins — say which with --person:`);
  for (const a of admins) console.error(`  ${a.id}  ${a.name}`);
  process.exit(1);
}

const admin = admins[0];

console.log(`Archive : ${archive.name}`);
console.log(`Admin   : ${admin.name} (${admin.id})`);
console.log(`Account : ${email}`);

if (dryRun) {
  console.log("\nWould create the account, set it as owner, and add an admin membership.");
  process.exit(0);
}

const { data: existing } = await supabase
  .from("families")
  .select("id")
  .ilike("email", email)
  .maybeSingle();

let accountId = existing?.id;
if (accountId) {
  console.log("\nAccount already existed — reusing it.");
} else {
  const { data: account, error } = await supabase
    .from("families")
    .insert({
      email,
      display_name: admin.name,
      // The address is the one already trusted for this archive: they have
      // been administering it. Verification would be theatre.
      email_verified_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) {
    console.error("Could not create the account:", error.message);
    process.exit(1);
  }
  accountId = account.id;
  console.log("\nAccount created.");
}

const { error: ownerError } = await supabase
  .from("archives")
  .update({ owner_account_id: accountId })
  .eq("id", archiveId)
  .is("owner_account_id", null);

if (ownerError) {
  console.error("Could not set the owner:", ownerError.message);
  process.exit(1);
}
console.log("Owner set.");

const { data: member } = await supabase
  .from("archive_memberships")
  .select("id")
  .eq("archive_id", archiveId)
  .eq("account_id", accountId)
  .maybeSingle();

if (member) {
  console.log("Membership already existed.");
} else {
  const { error } = await supabase.from("archive_memberships").insert({
    archive_id: archiveId,
    account_id: accountId,
    person_id: admin.id,
    role: "admin",
    status: "active",
  });
  if (error) {
    console.error("Could not create the membership:", error.message);
    process.exit(1);
  }
  console.log("Membership created.");
}

// The person and the account should agree about the address.
if (!admin.email) {
  await supabase.from("people").update({ email }).eq("id", admin.id);
  console.log("Admin profile now carries the address too.");
}

console.log(`\n${archive.name} is adopted.`);
