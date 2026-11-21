/**
 * Removes a seeded family and everything it owns.
 *
 *   node teardown-family-three.tmp.mjs <archive-id>
 *
 * Refuses without an explicit archive id, and prints what it is about to
 * remove before removing it — a teardown that can be run by accident against
 * the wrong archive is worse than no teardown.
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { assertWriteTarget } from "../lib/target.mjs";

const ARCHIVE = process.argv[2];
if (!ARCHIVE) {
  console.error("Usage: node teardown-family-three.tmp.mjs <archive-id>");
  process.exit(1);
}

assertWriteTarget();
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws },
});

const { data: archive } = await sb
  .from("archives")
  .select("id, name, owner_account_id")
  .eq("id", ARCHIVE)
  .maybeSingle();

if (!archive) {
  console.error(`No archive ${ARCHIVE}. Nothing done.`);
  process.exit(1);
}

console.log(`About to remove: ${archive.name} (${archive.id})`);

// Storage objects first — a deleted row is an orphaned file otherwise.
const { data: media } = await sb
  .from("media_files")
  .select("id, storage_path")
  .eq("archive_id", ARCHIVE);
const paths = (media ?? []).map((m) => m.storage_path).filter(Boolean);
if (paths.length) {
  const { error } = await sb.storage.from("channel-media").remove(paths);
  console.log(`  storage: ${error ? "FAILED " + error.message : paths.length + " objects removed"}`);
}

const { data: people } = await sb.from("people").select("profile_picture_path").eq("archive_id", ARCHIVE);
const photos = (people ?? []).map((p) => p.profile_picture_path).filter(Boolean);
if (photos.length) await sb.storage.from("profile-pictures").remove(photos);

// Children before parents.
for (const table of [
  "suggestions", "missions", "nfc_cards", "channel_access", "channel_visits",
  "device_sessions", "activity_log", "media_files", "step_items", "steps",
  "channels", "settings", "installations", "invitations", "people",
]) {
  const { error, count } = await sb
    .from(table)
    .delete({ count: "exact" })
    .eq("archive_id", ARCHIVE);
  if (error && !/does not exist|column/.test(error.message)) {
    console.log(`  ${table.padEnd(18)} ${error.message}`);
  } else if (count) {
    console.log(`  ${table.padEnd(18)} ${count} removed`);
  }
}

await sb.from("archives").delete().eq("id", ARCHIVE);
if (archive.owner_account_id) await sb.from("families").delete().eq("id", archive.owner_account_id);

const { count: left } = await sb
  .from("archives")
  .select("*", { count: "exact", head: true })
  .eq("id", ARCHIVE);
console.log(left === 0 ? "\n✅ archive gone" : `\n⚠️  archive ${ARCHIVE} still present — check by hand`);
