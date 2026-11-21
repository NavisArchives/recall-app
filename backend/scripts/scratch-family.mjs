/**
 * Creates (or removes) a throwaway family, so screens that need a session can
 * actually be looked at.
 *
 * Every management screen in this product is behind a family session, which
 * means "does this look right on a phone?" is unanswerable without one — and
 * the alternative, borrowing a real family's account, means changing a real
 * person's password to see a layout. This makes a disposable one instead, with
 * its own archive, its own founding invitation, and nothing in it that
 * belongs to anybody.
 *
 *   node scripts/scratch-family.mjs create   # prints email + password
 *   node scripts/scratch-family.mjs remove   # takes it all back out
 *
 * The password is generated here and printed once; it is never stored in a
 * file. Scratch families are named so `remove` can find every one of them.
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { createHmac, randomBytes } from "node:crypto";
import argon2 from "argon2";
import ws from "ws";
import { config } from "dotenv";
import { SCENES, SCENE_MIME, SCENE_EXT } from "./lib/scene.mjs";
import { assertWriteTarget } from "./lib/target.mjs";

config({ path: ".env.local" });
config();

const MARK = "scratch-ux";
const EMAIL = `${MARK}@example.invalid`;

/*
 * Where the credentials live between runs.
 *
 * Two sessions share this fixture — the builder verifies a screen, the
 * advisor verifies it again — and each `create` used to mint a fresh
 * password, silently locking the other one out mid-pass. So `create` now
 * reuses the standing family and its password when one is already there, and
 * `--fresh` is how you say you actually want a new one.
 *
 * Gitignored: it holds a working password, and a scratch password in the
 * history is still a password in the history.
 */
const CREDENTIALS = new URL("../.scratch-family.json", import.meta.url).pathname;

assertWriteTarget();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws },
});

/**
 * Fills one album and one guide with pictures.
 *
 * The guide's steps are ordered and captioned, because that is what a guide
 * *is* on the display: `display_order` walks them and `caption` is the
 * instruction. An album's captions are the per-photograph detail instead.
 */
async function seedMedia(archiveId, made, personId) {
  const find = (number) => made.find((c) => c.number === number)?.id;

  const sets = [
    {
      channelId: find(3),
      items: [
        ["kettle", "Fill the kettle and switch it on.", "1998-06-14"],
        ["pouring", "Once it clicks off, pour the water over the coffee.", "1998-06-14"],
        ["cup", "Let it stand a moment, then it is ready.", "1998-06-14"],
      ],
    },
    {
      channelId: find(1),
      items: [
        ["house", "The front of the house, the summer we moved in.", "1998-06-14"],
        ["garden", "The apple tree at the bottom of the garden.", "1998-10-02"],
        ["table", "Sunday lunch laid out, before anyone sat down.", "1999-03-21"],
      ],
    },
  ];

  for (const set of sets) {
    if (!set.channelId) continue;
    const rows = [];

    for (const [scene, caption, takenOn] of set.items) {
      const storagePath = `channels/${set.channelId}/${randomBytes(16).toString("hex")}.png`;
      const { error } = await supabase.storage
        .from("channel-media")
        .upload(storagePath, SCENES[scene](), { contentType: "image/png" });

      if (error) {
        console.error(`  could not upload ${scene}: ${error.message}`);
        continue;
      }
      rows.push({
        archive_id: archiveId,
        channel_id: set.channelId,
        storage_path: storagePath,
        file_type: "image",
        caption,
        taken_on: takenOn,
        display_order: rows.length,
        created_by: personId,
      });
    }

    if (rows.length) await supabase.from("media_files").insert(rows);
  }
}

/** Same domain separation the app uses; a founder token is not an invite. */
const hashFounder = (token) =>
  createHmac("sha256", process.env.CODE_PEPPER).update(`founder:${token}`).digest("hex");
const hashReceipt = (receipt) =>
  createHmac("sha256", process.env.CODE_PEPPER).update(`receipt:${receipt}`).digest("hex");

/**
 * A channel nobody is recorded as having made (M214).
 *
 * `created_by` is nullable and the app writes null itself —
 * `channels.ts:233` is `created_by: req.profile?.personId ?? null`, so any
 * creation running without an acting profile records exactly this. The
 * backend already treats it as a real state, guarding `if
 * (channel.created_by)` at :160 and :321.
 *
 * Every other scratch channel carries a creator, which is why this state had
 * never been seen on a screen: the mobile shelf told a non-admin "Somebody
 * else created this, so only they can add to it" — naming a person who does
 * not exist and pointing them at nobody — and no fixture could open the
 * state for anyone to notice.
 *
 * Idempotent, so it can be added to a family that is already standing.
 */
async function ensureNoCreatorChannel(archiveId) {
  const { data: existing } = await supabase
    .from("channels")
    .select("id")
    .eq("archive_id", archiveId)
    .eq("number", 7)
    .maybeSingle();
  if (existing) return;

  await supabase.from("channels").insert({
    number: 7,
    title: "Found in a drawer",
    content_type: "album",
    archive_id: archiveId,
    created_by: null,
    author_id: null,
    date: "1996-03-02",
    privacy_level: 3,
  });
}

/**
 * Put a channel on her screen, now (M216).
 *
 * The LIVE badge had **never rendered in any test, on any fork, for
 * anybody** — this seeder never touched screen state at all, so three
 * surfaces carried a guard for a state no fixture could open. That is the
 * second fixture gap of the cycle after M214's `created_by: null`, and the
 * same shape: correct by construction, never once seen.
 *
 * ── Why it is a command and not a seed ───────────────────────────────────
 *
 * Liveness is a five-minute window: `streams.ts` computes
 * `Date.now() - screen_synced_at < SCREEN_LIVE_MS`. A timestamp written at
 * install time is stale before anybody opens the page, so seeding it once
 * would be a fixture that works for five minutes and then silently stops —
 * a fixture-shaped intention, which is precisely what M214 taught.
 *
 * So it is re-stampable. `create` calls it, and you can call it again the
 * moment before you look:
 *
 *   node scripts/scratch-family.mjs live       # channel 01 on screen
 *   node scripts/scratch-family.mjs live 12    # a particular one
 */
async function screenLive(archiveId, number = 1) {
  const { error } = await supabase
    .from("settings")
    .update({
      current_channel_number: number,
      current_photo_index: 0,
      current_photo_count: 5,
      screen_synced_at: new Date().toISOString(),
    })
    .eq("archive_id", archiveId);
  if (error) throw new Error(`screen state: ${error.message}`);
  console.log(`Channel ${String(number).padStart(2, "0")} is on her screen for the next 5 minutes.`);
}

async function remove() {
  const { data: families } = await supabase
    .from("families")
    .select("id, archive_id")
    .ilike("email", `%${MARK}%`);

  for (const family of families ?? []) {
    /*
     * The files first, while the rows that name them still exist.
     *
     * Deleting the archive cascades the `media_files` rows away, but storage
     * is a separate world with no foreign keys into it: drop the rows first
     * and the objects are orphaned in the bucket with nothing left pointing
     * at them. `remove` is supposed to take it *all* back out.
     */
    if (family.archive_id) {
      const { data: files } = await supabase
        .from("media_files")
        .select("storage_path")
        .eq("archive_id", family.archive_id);

      const paths = (files ?? []).map((f) => f.storage_path).filter(Boolean);
      if (paths.length) await supabase.storage.from("channel-media").remove(paths);

      await supabase.from("archives").delete().eq("id", family.archive_id);
    }
    await supabase.from("family_sessions").delete().eq("family_id", family.id);
    await supabase.from("families").delete().eq("id", family.id);
  }
  await supabase.from("founding_invitations").delete().ilike("email", `%${MARK}%`);
  await supabase.from("email_verifications").delete().ilike("email", `%${MARK}%`);
  await supabase.from("invitation_requests").delete().ilike("email", `%${MARK}%`);

  if (existsSync(CREDENTIALS)) unlinkSync(CREDENTIALS);
  console.log(`Removed ${families?.length ?? 0} scratch famil${families?.length === 1 ? "y" : "ies"}.`);
}

async function create({ fresh = false } = {}) {
  if (!fresh && existsSync(CREDENTIALS)) {
    const saved = JSON.parse(readFileSync(CREDENTIALS, "utf8"));
    const { data: alive } = await supabase
      .from("families")
      .select("id, archive_id")
      .ilike("email", EMAIL)
      .maybeSingle();

    if (alive?.archive_id) {
      /*
        Top up the fixtures a standing family predates (M214).

        `create` returns early when a scratch family already exists, so a
        fixture added later would only ever appear for whoever wiped and
        rebuilt — which is nobody, most days. That is how the no-creator
        channel stayed unseen: the state was reachable in production and
        unreachable on any developer's screen.
      */
      await ensureNoCreatorChannel(alive.archive_id);
      await screenLive(alive.archive_id, 1);
      console.log("Scratch family already standing — reusing it.");
      console.log(`  email    ${EMAIL}`);
      console.log(`  password ${saved.password}`);
      console.log(`  PIN      123456   (Claire, admin) · 010101 (Marie, co-author)`);
      console.log(`  archive  ${alive.archive_id}`);
      console.log("Rebuild it from scratch with: node scripts/scratch-family.mjs create --fresh");
      return;
    }
  }

  await remove();

  const password = `scratch-${randomBytes(9).toString("base64url")}`;
  const receipt = randomBytes(32).toString("base64url");
  const founder = randomBytes(32).toString("base64url");

  await supabase.from("email_verifications").insert({
    email: EMAIL,
    code_hash: MARK,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    purpose: "signup",
    receipt_hash: hashReceipt(receipt),
    receipt_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    verified_at: new Date().toISOString(),
  });

  await supabase.from("founding_invitations").insert({
    email: EMAIL,
    note: "scratch, for looking at screens",
    token_hash: hashFounder(founder),
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  });

  const { data, error } = await supabase.rpc("create_household", {
    p_receipt_hash: hashReceipt(receipt),
    p_email: EMAIL,
    p_display_name: "Fournier",
    p_admin_name: "Claire Fournier",
    p_admin_pin_hash: await argon2.hash("123456", { type: argon2.argon2id }),
    p_relationship: "Daughter",
    p_about: "someone",
    p_subject_name: "Margaret Fournier",
    p_birth_date: "1948-04-02",
    p_residence: "Namur",
    p_install_name: "scratch browser",
    p_install_username: `web-${randomBytes(6).toString("hex")}`,
    p_install_secret: await argon2.hash(randomBytes(16).toString("hex"), { type: argon2.argon2id }),
    p_password_hash: await argon2.hash(password, { type: argon2.argon2id }),
    p_founder_hash: hashFounder(founder),
  });

  if (error) {
    console.error(`Could not create it: ${error.message}`);
    process.exit(1);
  }

  const row = Array.isArray(data) ? data[0] : data;

  // A shelf with something on it, so list screens are not judged empty.
  const channels = [
    { number: 1, title: "The house on Rue Verte", content_type: "album" },
    { number: 2, title: "Sunday lunches", content_type: "album" },
    { number: 3, title: "Making coffee", content_type: "instruction" },
    // A guide with nothing in it yet, for the same reason Marie carries a PIN:
    // the empty state is a screen somebody will meet, and one that cannot be
    // looked at is one that ships unlooked-at. This is the only channel that
    // renders "No steps yet."
    { number: 5, title: "Watering the plants", content_type: "instruction" },
    { number: 12, title: "The wedding film", content_type: "video" },
    // The fourth content type, present for one reason: the eyebrow used to
    // call this "video" (M91), and a type with no channel is a type whose
    // display nobody can look at. Which fixture exercises the criterion?
    // This one.
    { number: 13, title: "A life in Rue Verte", content_type: "documentary" },
  ];
  const { data: made } = await supabase
    .from("channels")
    .insert(
      channels.map((c) => ({
        ...c,
        archive_id: row.archive_id,
        created_by: row.person_id,
        author_id: row.person_id,
        date: "1998-06-14",
        privacy_level: 3,
      }))
    )
    .select("id, number");

  /*
   * Two channels with something actually in them (M91).
   *
   * Every scratch channel used to be empty, which made the display's whole
   * behaviour unverifiable: the photo arrows, the caption wrap, the guide —
   * none of them can be looked at on a channel with nothing to look at. So
   * one album and one guide are seeded with real PNG bytes, written to the
   * same bucket and the same path shape the upload route uses, so what the
   * display serves here is what it would serve for a family.
   */
  await seedMedia(row.archive_id, made ?? [], row.person_id);

  /*
   * Marie carries a PIN and Paul does not, on purpose.
   *
   * A co-author who can actually be signed in as is the only way to see the
   * screens a co-author sees — the locks on channels they did not create
   * (M49/M59), the read-only surfaces, the missions scoped to them. Without
   * one, every verification pass runs as an admin, for whom nothing is ever
   * locked, and the locked states ship unlooked-at. Paul stays unclaimed so
   * the "has not joined yet" state has a subject too.
   */
  const mariePin = await argon2.hash("010101", { type: argon2.argon2id });
  const { data: marie } = await supabase
    .from("people")
    .insert([
      {
        archive_id: row.archive_id,
        name: "Marie Fournier",
        role: "co_author",
        status: "active",
        relationship: "Daughter",
        pin_hash: mariePin,
        pin_set_at: new Date().toISOString(),
        joined_at: new Date().toISOString(),
      },
      { archive_id: row.archive_id, name: "Paul Fournier", role: "co_author", status: "pending", relationship: "Son" },
      // Active, on the shelf, but never claimed — the "invited, not joined
      // yet" row (M41/M67). Paul is `pending` and so is filtered out of the
      // chooser entirely; this one is the state that actually renders, and
      // without it that row cannot be looked at.
      { archive_id: row.archive_id, name: "Sophie Fournier", role: "co_author", status: "active", relationship: "Grandchild" },
    ])
    .select("id")
    .limit(1);

  // A channel Marie made, so an admin also has one they did not create — the
  // lock is a two-sided fact and needs both sides present to be seen.
  if (marie?.[0]?.id) {
    await supabase.from("channels").insert({
      number: 4,
      title: "Marie's own album",
      content_type: "album",
      archive_id: row.archive_id,
      created_by: marie[0].id,
      author_id: marie[0].id,
      date: "2001-09-08",
      privacy_level: 3,
    });
  }

  await ensureNoCreatorChannel(row.archive_id);
  await screenLive(row.archive_id, 1);

  await supabase.from("missions").insert([
    { archive_id: row.archive_id, title: "Describe the photos in Sunday lunches", status: "suggested", task_kind: "describe_photos", origin: "recall" },
    { archive_id: row.archive_id, title: "Add photos to The wedding film", status: "suggested", task_kind: "add_photos", task_count: 4, origin: "recall" },
  ]);

  writeFileSync(CREDENTIALS, JSON.stringify({ email: EMAIL, password }, null, 2) + "\n", {
    mode: 0o600,
  });

  console.log("Scratch family ready — sign in at /login");
  console.log(`  email    ${EMAIL}`);
  console.log(`  password ${password}`);
  console.log(`  PIN      123456   (Claire, admin) · 010101 (Marie, co-author)`);
  console.log(`  archive  ${row.archive_id}`);
  console.log("Remove it with: node scripts/scratch-family.mjs remove");
  console.log(`Credentials saved to ${CREDENTIALS} so a second session can read them.`);
}

/**
 * Pairs a trusted screen for the standing scratch family.
 *
 * The kiosk half of the product — the display at `/`, her profile on the
 * chooser, the pairing rules — is only reachable with a *device* session, and
 * `create` mints an installation whose secret it immediately throws away. So
 * neither session could ever look at those screens. This adds one with a
 * known secret and writes it beside the password, without disturbing the
 * family that is already standing.
 */
async function device() {
  const { data: family } = await supabase
    .from("families")
    .select("archive_id")
    .ilike("email", EMAIL)
    .maybeSingle();

  if (!family?.archive_id) {
    console.error("No scratch family standing — run `create` first.");
    process.exit(1);
  }

  /*
   * The shape the sign-in route actually accepts.
   *
   * `normaliseSecret` uppercases, strips the dash and demands exactly
   * `AAAA-BBBBBBBB` — so a random base64url string is rejected before the
   * hash is ever compared, and the screen would look mis-paired when the
   * fixture was simply speaking the wrong language. Generated in the
   * product's own alphabet, hashed in its normalised form, printed with the
   * dash a person would type.
   */
  const ALPHABET = "ABCDEFGHJKLMNPQRTUVWXYZ2346789";
  const pick = (n) =>
    Array.from({ length: n }, () => ALPHABET[randomBytes(1)[0] % ALPHABET.length]).join("");

  const username = `scratch-screen-${randomBytes(3).toString("hex")}`;
  const secret = `${pick(4)}-${pick(8)}`;
  const stored = secret.replace("-", "");

  /*
   * The family already has its one trusted screen — `create_household` pairs
   * the signing-up browser and 030's partial unique index allows no second
   * (M42). So this re-credentials *that* screen rather than adding another:
   * inserting one is refused, correctly, and working around the invariant to
   * make a fixture convenient would be the wrong trade.
   */
  const { data: screen } = await supabase
    .from("installations")
    .select("id")
    .eq("archive_id", family.archive_id)
    .eq("is_trusted", true)
    .maybeSingle();

  if (!screen) {
    console.error("That family has no trusted screen to re-credential.");
    process.exit(1);
  }

  const { error } = await supabase
    .from("installations")
    .update({
      name: "Living-room screen",
      username,
      secret_hash: await argon2.hash(stored, { type: argon2.argon2id }),
      revoked_at: null,
    })
    .eq("id", screen.id);

  if (error) {
    console.error(`Could not pair it: ${error.message}`);
    process.exit(1);
  }

  const saved = existsSync(CREDENTIALS) ? JSON.parse(readFileSync(CREDENTIALS, "utf8")) : {};
  writeFileSync(
    CREDENTIALS,
    JSON.stringify({ ...saved, install_username: username, install_secret: secret }, null, 2) + "\n",
    { mode: 0o600 }
  );

  console.log("Trusted screen paired — sign in at /login/device");
  console.log(`  installation ${username}`);
  console.log(`  access code  ${secret}`);
}

/** The standing family's archive id, for commands that only touch it. */

/**
 * One postcard in every state (18a, 18h, 18j, 18k).
 *
 * WHY THIS EXISTS: the card screens are almost entirely state. The overview
 * draws a different tile per state, the detail page draws a timeline out of
 * one, and the fulfilment queue only shows rows an operator still has work
 * in — so a fixture with no cards renders every one of those as its empty
 * state, and "does this look right?" cannot be asked at all. Verifying by
 * reading the source instead is how a layout ships wrong.
 *
 * States are written straight to the table rather than driven through the
 * routes. That is deliberate: `queued` is reachable by sending, but `shipped`,
 * `returned` and `failed` are reached by an operator or by the post, and
 * waiting for real ones is not a fixture. The states themselves are still the
 * product's — the check constraint refuses anything invented here.
 */
async function cards() {
  const archiveId = await standingArchive();

  const { data: channels } = await supabase
    .from("channels")
    .select("id, number, title")
    .eq("archive_id", archiveId)
    .not("number", "is", null)
    .order("number");

  if (!channels?.length) {
    console.error("That family has no numbered channels — run `create` first.");
    process.exit(1);
  }

  const { data: people } = await supabase
    .from("people")
    .select("id, name, role")
    .eq("archive_id", archiveId);

  /*
    A photograph for the front. Without one the card draws its "no photograph
    chosen yet" placeholder, which is a real state but not the one these
    screens are mostly about — and it silently hides Duplicate on the detail
    page, because a card with no photo has nothing to duplicate. A fixture
    that never reaches the ordinary path is not exercising the page.
  */
  const { data: media } = await supabase
    .from("media_files")
    .select("id, channel_id, file_type")
    .eq("archive_id", archiveId)
    .neq("file_type", "video");

  const photoFor = (channelId) => media?.find((m) => m.channel_id === channelId)?.id ?? null;

  const subject = people?.find((p) => p.role === "user") ?? people?.[0];
  const senders = people?.filter((p) => p.id !== subject?.id) ?? [];

  // Whole days back, so a date on screen is a date and not "3 hours ago".
  const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

  /*
    `front` marks the states whose screens are mostly about the card itself —
    18h's detail page for a delivered card, 18k's failed-delivery panel, 18j's
    shipped row. Photograph-bearing channels are scarce in this archive (three
    of twelve), so they are spent there rather than on a draft nobody opens.
    The states left over render the "no photograph chosen yet" placeholder,
    which is a real state and worth having in the set.
  */
  const PLAN = [
    { state: "delivered", age: 9,  sent: 8, delivered: 6, front: true },
    { state: "returned",  age: 12, sent: 11, returned: 7, front: true },
    { state: "shipped",   age: 5,  sent: 5, carrier: "bpost", ref: "JJBE2214", front: true },
    { state: "draft",     age: 0 },
    { state: "ready",     age: 1 },
    { state: "queued",    age: 2, monthly: true },
    { state: "printing",  age: 3 },
    { state: "failed",    age: 4, failure_reason: "printer error" },
    { state: "sent",      age: 6, sent: 6 },
  ];

  await supabase.from("nfc_cards").delete().eq("archive_id", archiveId).eq("label", "Scratch postcard");

  /*
    Channels that actually hold a photograph go first, so most cards render a
    real front. NOT by borrowing a photo from another channel to fill the gap:
    a card says "opens channel 12" on its face, and putting channel 03's
    photograph on it would make the fixture teach something false about what a
    card is. The tail keeps the photo-less channels, which is the placeholder
    state — worth having one of, not seven.
  */
  const withPhotos = channels.filter((c) => media?.some((m) => m.channel_id === c.id));
  const without = channels.filter((c) => !withPhotos.includes(c));
  let nextWith = 0;
  let nextWithout = 0;
  const channelFor = (step) => {
    /* A `front` card takes a photograph-bearing channel if one is left — and
       falls back rather than failing, because an archive with no photographs
       at all must still seed. NOT by borrowing another channel's photo: a
       card says "opens channel 12" on its face, and putting channel 03's
       picture on it would make the fixture teach something false. */
    if (step.front && nextWith < withPhotos.length) return withPhotos[nextWith++];
    if (without.length) return without[nextWithout++ % without.length];
    return withPhotos[nextWith++ % withPhotos.length];
  };

  const rows = PLAN.map((step, i) => {
    const channel = channelFor(step);
    const sender = senders[i % Math.max(senders.length, 1)] ?? null;
    return {
      archive_id: archiveId,
      label: "Scratch postcard",
      kind: "postcard",
      state: step.state,
      channel_id: channel.id,
      from_person_id: sender?.id ?? null,
      to_person_id: subject?.id ?? null,
      // The monthly one carries no photo on purpose: "newest in the channel"
      // is a standing instruction, and the route refuses the combination.
      media_file_id: step.monthly ? null : photoFor(channel.id),
      recurrence: step.monthly ? "monthly" : "once",
      photo_mode: step.monthly ? "newest" : "chosen",
      next_send_at: step.monthly ? daysAgo(-4) : null,
      created_at: daysAgo(step.age),
      sent_at: step.sent ? daysAgo(step.sent) : null,
      delivered_at: step.delivered ? daysAgo(step.delivered) : null,
      returned_at: step.returned ? daysAgo(step.returned) : null,
      failed_at: step.state === "failed" ? daysAgo(step.age) : null,
      failure_reason: step.failure_reason ?? null,
      shipping_carrier: step.carrier ?? null,
      shipping_reference: step.ref ?? null,
    };
  });

  const { error } = await supabase.from("nfc_cards").insert(rows);
  if (error) {
    console.error(`Could not seed the cards: ${error.message}`);
    process.exit(1);
  }

  console.log(`Seeded ${rows.length} postcards, one per state:`);
  console.log(`  ${PLAN.map((s) => s.state).join(", ")}`);
  console.log("  /admin/cards to see them · /owner for the fulfilment queue");
}

/**
 * A photograph in every channel (spec 24).
 *
 * `create` seeded two channels and left the rest empty, which was fine while
 * the display drew flat panels. Spec 24 puts the channel's current photograph
 * behind every channel screen, blurred to 46px, and on every card in channel
 * 00 — so an empty channel is now a screen that cannot be looked at, and nine
 * empty channels are nine.
 *
 * Re-runnable: it clears what it seeded before and lays it down again, so
 * regenerating the artwork is one command rather than a fresh family.
 */
const PHOTO_SETS = [
  /*
    Albums the size a real album is (owner, 17 Sep 2026: "nobody's going to
    make an album with three pictures — that's not even realistic").

    There are twelve scenes in lib/scenes, so an album of eight reuses some of
    them. That is fine and true to life: families photograph the same house,
    the same table and the same street for thirty years, and the captions and
    dates are what make each print its own. The instruction channels stay
    short on purpose — an instruction with eight steps is a worse instruction.
  */
  { number: 1, scenes: [
      ["house", "The front of the house, the summer we moved in.", "1998-06-14"],
      ["garden", "The apple tree at the bottom of the garden.", "1998-10-02"],
      ["street", "Rue Verte, looking down towards the corner.", "1999-05-08"],
      ["house", "The same view in winter, the year of the heavy snow.", "2001-01-20"],
      ["garden", "The garden after your father finally cut the hedge.", "2002-07-11"],
      ["table", "The kitchen table, before we changed the chairs.", "2004-03-05"],
      ["street", "The corner shop, back when it was still a bakery.", "2006-09-30"],
      ["house", "The front door, the day the new one went on.", "2009-05-18"]] },
  { number: 2, scenes: [
      ["table", "Sunday lunch laid out, before anyone sat down.", "1999-03-21"],
      ["table", "The long table, pulled out into the garden.", "2000-06-25"],
      ["garden", "Coffee afterwards, under the apple tree.", "2001-08-12"],
      ["cup", "The good cups, which only came out on Sundays.", "2003-04-13"],
      ["table", "Christmas lunch, the year everyone came.", "2005-12-25"],
      ["house", "Everyone on the step afterwards, squinting.", "2007-07-08"]] },
  { number: 3, scenes: [
      ["kettle", "Fill the kettle and switch it on.", "1998-06-14"],
      ["pouring", "Once it clicks off, pour the water over the coffee.", "1998-06-14"],
      ["cup", "Let it stand a moment, then it is ready.", "1998-06-14"]] },
  { number: 4, scenes: [
      ["album", "The prints she kept loose, never in a book.", "1996-08-30"],
      ["drawer", "The tin they lived in, at the back of the dresser.", "1996-08-30"],
      ["album", "A page she did start, and never finished.", "1997-02-14"],
      ["street", "Somewhere in Ostend, nobody is sure which year.", "1988-07-01"],
      ["wedding", "A wedding — not ours. We think it is Jeanne's.", "1979-05-26"],
      ["farm", "The farm, from the album rather than the wall.", "1985-08-15"]] },
  { number: 5, scenes: [
      ["plants", "The sill in the front room. They want water on Sundays.", "2001-04-11"],
      ["pouring", "A small jug is enough — the big one drowns them.", "2001-04-11"],
      ["plants", "The one by the window drinks more than it looks.", "2001-04-11"]] },
  { number: 6, scenes: [
      ["farm", "The farm in August, the year of the long summer.", "1994-08-02"],
      ["garden", "The field behind the barn, before it was sold.", "1994-08-04"],
      ["table", "Lunch outside, every day of those three weeks.", "1995-08-09"],
      ["farm", "The barn, the summer before it came down.", "1996-08-21"],
      ["street", "The lane up to the house, walked twice a day.", "1997-08-03"],
      ["house", "The last August, with all the cousins.", "1998-08-16"]] },
  { number: 7, scenes: [
      ["drawer", "What was in the drawer, laid out on the good cloth.", "2003-01-19"],
      ["album", "Photographs with nothing written on the back.", "2003-01-19"],
      ["wedding", "A wedding we cannot place. Somebody will know.", "1962-06-09"],
      ["street", "A street that might be Borgerhout.", "1958-04-01"],
      ["house", "A house nobody recognises at all.", "1960-01-01"],
      ["cup", "The cup from the set that got broken.", "1971-11-30"]] },
  { number: 12, scenes: [
      ["wedding", "The tables after the speeches.", "1971-06-12"]] },
  { number: 13, scenes: [
      ["street", "The street she has lived on for fifty years.", "1975-09-01"]] },
];

async function photos() {
  const archiveId = await standingArchive();

  const { data: channels } = await supabase
    .from("channels")
    .select("id, number, title")
    .eq("archive_id", archiveId)
    .not("number", "is", null);

  const { data: people } = await supabase
    .from("people")
    .select("id, role")
    .eq("archive_id", archiveId);
  const author = people?.find((p) => p.role === "admin")?.id ?? people?.[0]?.id ?? null;

  /* Clear only what a previous run of THIS command put here. Captions are the
     marker: they are written above and nowhere else, so a photograph somebody
     uploaded by hand to look at something survives a re-seed. */
  const mine = PHOTO_SETS.flatMap((s) => s.scenes.map(([, caption]) => caption));
  await supabase.from("media_files").delete().eq("archive_id", archiveId).in("caption", mine);

  let made = 0;
  for (const set of PHOTO_SETS) {
    const channel = channels?.find((c) => c.number === set.number);
    if (!channel) continue;

    const rows = [];
    for (const [scene, caption, takenOn] of set.scenes) {
      const storagePath = `channels/${channel.id}/${randomBytes(16).toString("hex")}.${SCENE_EXT}`;
      const { error } = await supabase.storage
        .from("channel-media")
        .upload(storagePath, SCENES[scene](), { contentType: SCENE_MIME });
      if (error) {
        console.error(`  ${set.number}: could not upload ${scene} — ${error.message}`);
        continue;
      }
      rows.push({
        archive_id: archiveId,
        channel_id: channel.id,
        storage_path: storagePath,
        file_type: "image",
        caption,
        taken_on: takenOn,
        display_order: rows.length,
        created_by: author,
      });
    }
    if (rows.length) {
      const { error } = await supabase.from("media_files").insert(rows);
      if (error) console.error(`  ${set.number}: ${error.message}`);
      else made += rows.length;
    }
  }

  console.log(`Seeded ${made} photographs across ${PHOTO_SETS.length} channels.`);
  console.log("  Re-run after regenerating the artwork; it replaces its own rows.");
}

/**
 * Faces and a sentence for the family screen (24f).
 *
 * 24f is a slider of 350×460 portraits whose focused face also becomes the
 * blurred room behind her, with one warm sentence from each person's profile
 * in the left column. A family of dashed initials with empty descriptions
 * renders every part of that as its fallback, so the screen could not be
 * judged at all — and the owner judged the flat-colour stand-ins it did have
 * as exactly what they were.
 *
 * The portraits are drawn in the same hand as the channel scenes and live
 * beside them in scripts/lib/scenes/people/.
 */
const FAMILY_FACES = [
  { name: "Marie Fournier", face: "marie",
    description: "She lives in Namur, and she comes on Sundays with the girls." },
  { name: "Paul Fournier", face: "paul",
    description: "He rings on Thursday evenings, always at seven." },
  { name: "Sophie Fournier", face: "sophie",
    description: "Your granddaughter — she is studying in Ghent this year." },
  { name: "Claire Fournier", face: "claire",
    description: "She looks after the archive and the little screen." },
  { name: "Margaret Fournier", face: "margaret", description: null },
];

/**
 * A voice message to look at (24b).
 *
 * The channel goes through the same table the admin flow writes, the audio
 * through the same bucket — but the audio bytes here are a generated tone,
 * not a voice: a fixture that shipped a recorded human voice would be a
 * person in the repo. A sine sweep proves the player, the waveform, the
 * clock and the going-home; only listening tells you it is not Odette.
 */
async function story() {
  const archiveId = await standingArchive();
  const { data: people } = await supabase
    .from("people").select("id, name, role").eq("archive_id", archiveId);
  const author = people?.find((p) => p.name === "Marie Fournier") ?? people?.find((p) => p.role === "co_author");

  const NUMBER = 9;
  const { data: existing } = await supabase
    .from("channels").select("id").eq("archive_id", archiveId).eq("number", NUMBER).maybeSingle();
  let channelId = existing?.id;
  if (!channelId) {
    const { data, error } = await supabase.from("channels").insert({
      archive_id: archiveId,
      number: NUMBER,
      title: "Un message de Marie",
      description: "A little hello for Sunday morning.",
      content_type: "stories",
      date: "2026-08-01",
      created_by: author?.id ?? null,
      /* The CREDITED author — the display's chip and the amber "Marie is
         talking to you." both read author_id, not created_by. */
      author_id: author?.id ?? null,
    }).select("id").single();
    if (error) { console.error(error.message); process.exit(1); }
    channelId = data.id;
  } else {
    await supabase.from("channels").update({ content_type: "stories" }).eq("id", channelId);
  }

  // Clear this seeder's own media and lay it down again.
  await supabase.from("media_files").delete().eq("channel_id", channelId);

  // The picture: Marie's portrait scene fits a message from her.
  const photo = readFileSync(new URL("./lib/scenes/garden.jpg", import.meta.url).pathname);
  const photoPath = `channels/${channelId}/${randomBytes(12).toString("hex")}.jpg`;
  await supabase.storage.from("channel-media").upload(photoPath, photo, { contentType: "image/jpeg" });

  /*
    The audio: a 20-second WAV, three soft tones — generated right here so
    the fixture is self-contained. 8kHz mono 16-bit; small, and every browser
    plays it.
  */
  const RATE = 8000, SECONDS = 20;
  const samples = RATE * SECONDS;
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const tSec = i / RATE;
    const freq = 220 + 40 * Math.sin(tSec / 2.5);
    const fade = Math.min(1, tSec / 0.5, (SECONDS - tSec) / 0.5);
    const v = Math.sin(2 * Math.PI * freq * tSec) * 0.28 * fade
            + Math.sin(2 * Math.PI * freq * 1.5 * tSec) * 0.1 * fade;
    pcm.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  const wav = Buffer.concat([header, pcm]);
  const wavPath = `channels/${channelId}/${randomBytes(12).toString("hex")}.wav`;
  await supabase.storage.from("channel-media").upload(wavPath, wav, { contentType: "audio/wav" });

  const { error } = await supabase.from("media_files").insert([
    { archive_id: archiveId, channel_id: channelId, storage_path: photoPath,
      file_type: "image", caption: null, display_order: 0, created_by: author?.id ?? null },
    { archive_id: archiveId, channel_id: channelId, storage_path: wavPath,
      file_type: "audio", caption: null, display_order: 1, created_by: author?.id ?? null },
  ]);
  if (error) { console.error(error.message); process.exit(1); }
  console.log(`Channel ${String(NUMBER).padStart(2, "0")} is a voice message from ${author?.name ?? "?"} — /channel/09`);
}

async function faces() {
  const archiveId = await standingArchive();
  const { data: people } = await supabase
    .from("people")
    .select("id, name")
    .eq("archive_id", archiveId);

  let done = 0;
  for (const spec of FAMILY_FACES) {
    const person = people?.find((p) => p.name === spec.name);
    if (!person) continue;

    const bytes = readFileSync(
      new URL(`./lib/scenes/people/${spec.face}.jpg`, import.meta.url).pathname
    );
    const storagePath = `people/${person.id}/${randomBytes(12).toString("hex")}.jpg`;
    const { error: up } = await supabase.storage
      .from("profile-pictures")
      .upload(storagePath, bytes, { contentType: "image/jpeg" });
    if (up) {
      console.error(`  ${spec.name}: upload failed — ${up.message}`);
      continue;
    }
    const { error } = await supabase
      .from("people")
      .update({
        profile_picture_path: storagePath,
        ...(spec.description ? { description: spec.description } : {}),
      })
      .eq("id", person.id);
    if (error) console.error(`  ${spec.name}: ${error.message}`);
    else done++;
  }
  console.log(`Gave ${done} people a face${done ? " and a sentence" : ""}.`);
}

async function standingArchive() {
  const { data } = await supabase
    .from("families")
    .select("archive_id")
    .ilike("email", EMAIL)
    .maybeSingle();
  if (!data?.archive_id) {
    console.error("No scratch family standing. Run: node scripts/scratch-family.mjs create");
    process.exit(1);
  }
  return data.archive_id;
}

const command = process.argv[2];
if (command === "live") {
  const n = Number(process.argv[3] ?? 1);
  await screenLive(await standingArchive(), Number.isFinite(n) ? n : 1);
} else if (command === "remove") await remove();
else if (command === "device") await device();
else if (command === "create") await create({ fresh: process.argv.includes("--fresh") });
else if (command === "cards") await cards();
else if (command === "photos") await photos();
else if (command === "faces") await faces();
else if (command === "story") await story();
else {
  console.error("Usage: node scripts/scratch-family.mjs create|remove|device|cards|photos|faces|story|live [channel]");
  process.exit(1);
}
