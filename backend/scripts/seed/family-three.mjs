/**
 * Builds a third family to click around in.
 *
 * Goes through the real HTTP API wherever a route exists, so this exercises
 * archive scoping, magic-byte verification and storage the same way a browser
 * would — a seed that bypassed all that would prove nothing and could hide the
 * next tenancy bug.
 *
 * Photographs are generated, not found: flat colour fields with a numeral, so
 * you can always tell which channel a photo belongs to and which step is third.
 * Nothing here is a picture of anybody.
 */
import "dotenv/config";
import argon2 from "argon2";
import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { makeScene } from "./scenes.mjs";
import { assertWriteTarget } from "../lib/target.mjs";

const BASE = `http://localhost:${process.env.PORT ?? 4000}`;
const SECRET = process.env.SESSION_SECRET;
assertWriteTarget();
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws },
});

const PIN = "010101";
const EMAIL = "family-three@example.invalid";
const INSTALL_USER = "family-three";
const INSTALL_SECRET = "TEST-FAMTHREE"; // alphabet omits 0/O, 1/I/L

const SUBJECT = "Margaret Fournier";
const FOUNDER = "Claire Fournier";

const CONTRIBUTORS = [
  ["Thomas Fournier", "Son"],
  ["Sophie Bernard", "Grandchild"],
  ["Anne Fournier", "Sister"],
  ["Paul Fournier", "Brother"],
];

// 10 channels. 10 and 11 are reserved by the display, so they are skipped.
const CHANNELS = [
  { number: 1, title: "The garden at Vaux", type: "album", scene: "garden", photos: 4 },
  { number: 2, title: "Summer in Brittany", type: "album", scene: "beach", photos: 4 },
  { number: 3, title: "The wedding", type: "album", scene: "wedding", photos: 4 },
  { number: 4, title: "The grandchildren", type: "album", scene: "children", photos: 4 },
  { number: 5, title: "Sunday lunches", type: "album", scene: "table", photos: 4 },
  { number: 6, title: "The old house", type: "album", scene: "house", photos: 3 },
  { number: 7, title: "Christmas, every year", type: "album", scene: "christmas", photos: 3 },
  { number: 8, title: "A message from Thomas", type: "video", scene: "video", photos: 2 },
  {
    number: 9,
    title: "How to make coffee",
    type: "instruction",
    scene: "coffee",
    steps: [
      "Fill the kettle and switch it on.",
      "Put two spoons of coffee in the pot.",
      "Pour the water in slowly, up to the line.",
      "Wait while the clock's big hand moves once.",
      "Press the plunger down, gently, all the way.",
    ],
  },
  {
    number: 12,
    title: "Getting ready for bed",
    type: "instruction",
    scene: "night",
    steps: [
      "Lock the front door. The key hangs by the frame.",
      "Turn off the lamp in the sitting room.",
      "Take the small white tablet with a glass of water.",
      "Brush your teeth. Your brush is the blue one.",
      "The bedroom light switch is by the door.",
    ],
  },
];

const CAPTIONS = [
  "A summer afternoon, everyone squinting.",
  "Nobody remembers who took this one.",
  "The light was going by then.",
  "Taken from the kitchen window.",
];

const log = (...a) => console.log(...a);

// ── 1. The family ────────────────────────────────────────────────────────
const receiptHash = `seed-receipt-${Date.now()}`;

const { error: seedErr } = await sb.from("email_verifications").insert({
  email: EMAIL,
  code_hash: `seed-code-${Date.now()}`,
  receipt_hash: receiptHash,
  purpose: "signup",
  verified_at: new Date().toISOString(),
  receipt_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
});
if (seedErr) {
  console.error("Could not seed the verification receipt:", seedErr.message);
  process.exit(1);
}

const { data: made, error: houseErr } = await sb.rpc("create_household", {
  p_receipt_hash: receiptHash,
  p_email: EMAIL,
  p_display_name: FOUNDER,
  p_admin_name: FOUNDER,
  p_admin_pin_hash: await argon2.hash(PIN, { type: argon2.argon2id }),
  p_relationship: "Daughter",
  p_about: "someone",
  p_subject_name: SUBJECT,
  p_birth_date: "1938-04-12",
  p_residence: "Rennes, France",
  p_install_name: "The living room screen",
  p_install_username: INSTALL_USER,
  // `normaliseSecret` uppercases and strips the dash before comparing, so the
  // stored hash has to be of the dashless form or sign-in fails with a flat
  // 401 and no clue why.
  p_install_secret: await argon2.hash(INSTALL_SECRET.replace(/-/g, ""), {
    type: argon2.argon2id,
  }),
});

if (houseErr) {
  console.error("create_household failed:", houseErr.code, houseErr.message);
  await sb.from("email_verifications").delete().eq("receipt_hash", receiptHash);
  process.exit(1);
}

const row = Array.isArray(made) ? made[0] : made;
const { archive_id: ARCHIVE, person_id: ADMIN_ID, installation_id: INSTALL_ID } = row;
log(`✅ family created — archive ${ARCHIVE}`);

// ── 2. The people who help ───────────────────────────────────────────────
const pinHash = await argon2.hash(PIN, { type: argon2.argon2id });
const now = new Date().toISOString();

const { error: peopleErr } = await sb.from("people").insert(
  CONTRIBUTORS.map(([name, relationship]) => ({
    archive_id: ARCHIVE,
    name,
    relationship,
    role: "co_author",
    status: "active",
    pin_hash: pinHash,
    pin_set_at: now,
  }))
);
if (peopleErr) console.error("contributors:", peopleErr.message);
else log(`✅ ${CONTRIBUTORS.length} co-authors, every PIN ${PIN}`);

// ── 3. A session, so the rest goes through the real routes ───────────────
const cookie = [
  `recall_device=${jwt.sign({ installationId: INSTALL_ID, archiveId: ARCHIVE }, SECRET, { expiresIn: 3600 })}`,
  `recall_profile=${jwt.sign(
    { personId: ADMIN_ID, name: FOUNDER, role: "admin", archiveId: ARCHIVE },
    SECRET,
    { expiresIn: 3600 }
  )}`,
].join("; ");

const api = async (path, body) => {
  const res = await fetch(`${BASE}/api${path}`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status} ${text.slice(0, 160)}`);
  return JSON.parse(text);
};

// ── 4. Channels and their contents ───────────────────────────────────────
let uploaded = 0;

for (const spec of CHANNELS) {
  let channel;
  try {
    channel = await api("/channels", {
      number: spec.number,
      title: spec.title,
      description:
        spec.type === "instruction"
          ? "Read one step at a time. The next one waits."
          : "Photographs the family added together.",
      content_type: spec.type,
      date: null,
    });
  } catch (err) {
    console.error(`channel ${spec.number}: ${err.message}`);
    continue;
  }

  // A guide's pictures carry their step number; an album's do not need one.
  const items = spec.steps
    ? spec.steps.map((text, n) => ({ label: String(n + 1), caption: text }))
    : Array.from({ length: spec.photos }, (_, n) => ({
        label: undefined,
        caption: CAPTIONS[n % CAPTIONS.length],
      }));

  const form = new FormData();
  form.set("channel_id", channel.id);
  for (const [n, item] of items.entries()) {
    const png = makeScene(spec.scene, item.label);
    form.append("files", new Blob([png], { type: "image/png" }), `${spec.scene}-${n + 1}.png`);
    form.append("captions", item.caption);
    form.append("taken_on", "");
  }

  const res = await fetch(`${BASE}/api/media-files`, {
    method: "POST",
    headers: { Cookie: cookie },
    body: form,
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`  channel ${spec.number} media → ${res.status} ${body.slice(0, 140)}`);
    continue;
  }
  uploaded += items.length;
  log(`  ${String(spec.number).padStart(2, "0")} ${spec.title.padEnd(26)} ${spec.type.padEnd(12)} ${items.length} items`);
}

log(`\n✅ ${CHANNELS.length} channels, ${uploaded} images`);
log(`\n── how to get in ──`);
log(`  /login   username: ${INSTALL_USER}   secret: ${INSTALL_SECRET}`);
log(`  every PIN: ${PIN}`);
log(`  family email: ${EMAIL}  (change it if you need real mail)`);
log(`\n  archive id: ${ARCHIVE}`);
log(`  teardown:   node teardown-family-three.tmp.mjs ${ARCHIVE}`);
