/**
 * First-run setup: creates the installation (level 1) and issues PINs (level 2).
 *
 * A fresh install has no credentials, so nobody could sign in. Running this
 * requires shell access to the server, which is the trust boundary for
 * bootstrapping.
 *
 * Usage:
 *   node scripts/setup.mjs installation <username>
 *   node scripts/setup.mjs pin "<person name>"
 *   node scripts/setup.mjs list
 *
 * Secrets are printed once and cannot be recovered afterwards.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import argon2 from "argon2";
import { randomInt } from "node:crypto";
import { assertWriteTarget } from "./lib/target.mjs";

config();

assertWriteTarget();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws },
});

// No easily-confused characters (0/O, 1/I/L).
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const pick = (n) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
const hash = (v) => argon2.hash(v, { type: argon2.argon2id });

const [, , command, argument] = process.argv;

async function createInstallation(username) {
  if (!username) {
    console.error('Usage: node scripts/setup.mjs installation <username>');
    process.exit(1);
  }

  const secret = `${pick(4)}-${pick(8)}`;

  const { error } = await supabase.from("installations").insert({
    username,
    // Stored without the dash, matching how the server normalises input.
    secret_hash: await hash(secret.replace("-", "")),
  });

  if (error) {
    console.error("Could not create the installation:", error.message);
    process.exit(1);
  }

  console.log(`\n  Installation: ${username}`);
  console.log(`  Access code:  ${secret}\n`);
  console.log("Write this down. It is hashed and cannot be shown again.");
}

async function issuePin(name) {
  if (!name) {
    console.error('Usage: node scripts/setup.mjs pin "<person name>"');
    process.exit(1);
  }

  const { data: person } = await supabase
    .from("people")
    .select("id, name, role")
    .ilike("name", name)
    .is("archived_at", null)
    .maybeSingle();

  if (!person) {
    console.error(`No person called "${name}".`);
    process.exit(1);
  }
  if (person.role === "user") {
    console.error(`${person.name} is the subject of the archive and signs in without a PIN.`);
    process.exit(1);
  }

  const pin = Array.from({ length: 6 }, () => randomInt(10)).join("");

  const { error } = await supabase
    .from("people")
    .update({
      pin_hash: await hash(pin),
      pin_set_at: new Date().toISOString(),
      failed_pin_attempts: 0,
      locked_until: null,
    })
    .eq("id", person.id);

  if (error) {
    console.error("Could not set the PIN:", error.message);
    process.exit(1);
  }

  console.log(`\n  ${person.name} — ${person.role}`);
  console.log(`  PIN: ${pin}\n`);
  console.log("Write this down. It is hashed and cannot be shown again.");
}

async function list() {
  const { data: installations } = await supabase
    .from("installations")
    .select("username, last_used_at, revoked_at");

  const { data: people } = await supabase
    .from("people")
    .select("name, role, status, pin_hash")
    .is("archived_at", null)
    .order("name");

  console.log("\nInstallations:");
  for (const i of installations ?? []) {
    console.log(`  ${i.username}${i.revoked_at ? "  (revoked)" : ""}`);
  }

  console.log("\nProfiles:");
  for (const p of people ?? []) {
    const pin = p.role === "user" ? "no PIN needed" : p.pin_hash ? "PIN set" : "NO PIN — run: pin";
    console.log(`  ${p.name.padEnd(18)} ${p.role.padEnd(10)} ${p.status.padEnd(12)} ${pin}`);
  }
  console.log();
}

const commands = { installation: createInstallation, pin: issuePin, list };

if (!commands[command]) {
  console.error("Usage: node scripts/setup.mjs <installation|pin|list> [argument]");
  process.exit(1);
}

await commands[command](argument);
