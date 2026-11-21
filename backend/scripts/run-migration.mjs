/**
 * Applies a SQL file to the Supabase project via the Management API.
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_... node scripts/run-migration.mjs <file.sql>
 *
 * The token is read from the environment (or backend/.env.local) and is never
 * printed. Statements are sent as one transactional batch.
 */
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { assertWriteTarget } from "./lib/target.mjs";

config({ path: ".env.local" });
config();

const token = process.env.SUPABASE_ACCESS_TOKEN;
const file = process.argv[2];

if (!token) {
  console.error("Missing SUPABASE_ACCESS_TOKEN (expected in backend/.env.local).");
  process.exit(1);
}
if (!file) {
  console.error("Usage: node scripts/run-migration.mjs <file.sql>");
  process.exit(1);
}

assertWriteTarget();
const projectRef = new URL(process.env.SUPABASE_URL).hostname.split(".")[0];
const query = readFileSync(file, "utf8");

const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
});

const body = await res.text();

if (!res.ok) {
  console.error(`Migration failed (HTTP ${res.status}):\n${body}`);
  process.exit(1);
}

console.log(`Applied ${file} to project ${projectRef}.`);
console.log(body);
