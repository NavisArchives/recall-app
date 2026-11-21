/**
 * Seeds demonstration missions into one archive.
 *
 * This content used to live inside `015_mission_media_target.sql`, where it
 * was gated on a global title check: whichever archive a migration reached
 * first received a mission nobody asked for, in a row indistinguishable from
 * the family's own work (M21). Structural migrations alter structure. Content
 * that exists to show a feature off belongs here, where it is run on purpose.
 *
 * The archive id is required and never guessed. There is no "the first one".
 *
 * Usage:
 *   node scripts/seed-demo-missions.mjs --archive <uuid> [--dry-run]
 */
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { config } from "dotenv";
import { assertWriteTarget } from "./lib/target.mjs";

config();

const args = process.argv.slice(2);
const archiveId = args[args.indexOf("--archive") + 1];
const dryRun = args.includes("--dry-run");

if (!args.includes("--archive") || !archiveId || archiveId.startsWith("--")) {
  console.error("Usage: node scripts/seed-demo-missions.mjs --archive <uuid> [--dry-run]");
  process.exit(1);
}
if (!/^[0-9a-f-]{36}$/i.test(archiveId)) {
  console.error(`Not an archive id: ${archiveId}`);
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

// Node < 22 has no native WebSocket, so the realtime client needs the `ws`
// polyfill — the same one src/config/supabase.ts uses.
assertWriteTarget();
const supabase = createClient(url, key, {
  auth: { persistSession: false },
  realtime: { transport: ws },
});

const { data: archive, error: archiveError } = await supabase
  .from("archives")
  .select("id, name")
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

// Everything below is scoped to this archive, and reads nothing outside it.
const { data: channels } = await supabase
  .from("channels")
  .select("id, number, title")
  .eq("archive_id", archiveId)
  .is("archived_at", null)
  .order("number");

const first = (channels ?? [])[0];
if (!first) {
  console.error(`${archive.name} has no channels yet — nothing to point a mission at.`);
  process.exit(1);
}

const { data: media } = await supabase
  .from("media_files")
  .select("id, display_order")
  .eq("archive_id", archiveId)
  .eq("channel_id", first.id)
  .is("archived_at", null)
  .order("display_order");

const label = `Channel ${String(first.number).padStart(2, "0")} — ${first.title}`;
const target = (media ?? [])[3] ?? (media ?? [])[0] ?? null;

const missions = [
  {
    archive_id: archiveId,
    channel_id: first.id,
    media_id: target?.id ?? null,
    title: `Add a description to a photo in ${label}`,
    detail: "A sentence is enough: where it was taken, who is in it.",
    status: "suggested",
    origin: "human",
    task_kind: "describe_photos",
    task_count: 1,
  },
];

if (dryRun) {
  console.log(`Would seed ${missions.length} mission(s) into ${archive.name}:`);
  for (const m of missions) console.log(`  · ${m.title}`);
  process.exit(0);
}

const { error } = await supabase.from("missions").insert(missions);
if (error) {
  console.error("Could not seed:", error.message);
  process.exit(1);
}

console.log(`Seeded ${missions.length} mission(s) into ${archive.name}.`);
