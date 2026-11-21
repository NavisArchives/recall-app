import { Router, type Request, type Response } from "express";
import { supabase } from "../config/supabase.js";
import { requireRole, requireArchive } from "../middleware/auth.js";
import { CAN_MANAGE_PEOPLE, CAN_WRITE_CONTENT } from "../services/accessCodes.js";
import { CARD_COLUMNS } from "../services/dto.js";
import { env } from "../config/env.js";
import { fail } from "../lib/errors.js";
import { logActivity, actorName } from "../services/activityLog.js";
import { evaluateChannel } from "../services/suggestions.js";
import { channelScope, type ChannelScope } from "../services/channelVisibility.js";

export const nfcRouter = Router();

/*
  The card, plus the three things a postcard is made of (047): the photograph
  on its front and the two people on its back. Every line on the printed card
  is pulled rather than typed — "From Lucie, your granddaughter" is a name and
  a relationship this archive already holds — so the embeds are how the card
  gets its words, not a convenience.

  `email` and `contact_number` are NOT embedded from either person. A card
  carries a name and a relationship; contact details reach an authenticated
  admin only and have no business on an object that goes through the post.
*/
const CARD_SELECT = `${CARD_COLUMNS}, channel:channels!nfc_cards_channel_id_fkey(id, number, title, description), linker:people!nfc_cards_linked_by_fkey(id, name), photo:media_files!nfc_cards_media_file_id_fkey(id, channel_id, storage_path, caption), sender:people!nfc_cards_from_person_id_fkey(id, name, relationship), recipient:people!nfc_cards_to_person_id_fkey(id, name)`;

/** The row as the routes actually use it; the select is too dynamic to infer. */
type CardRow = Record<string, unknown> & { id: string; label?: string; channel_id?: string | null };

/**
 * The front photograph as a URL the browser can use.
 *
 * `storage_path` never leaves the backend — the same rule the rest of the
 * media layer follows. And it is the stable route rather than a signed
 * Supabase URL, which would expire in an hour and break a card someone opens
 * tomorrow.
 */
function withPhotoUrl<T>(row: T): T {
  const card = row as unknown as { photo?: { id: string; storage_path?: string } | null };
  if (card?.photo?.id) {
    const { storage_path: _drop, ...rest } = card.photo;
    (card as { photo?: unknown }).photo = {
      ...rest,
      url: `${env.publicUrl}/api/media/${card.photo.id}/file`,
    };
  }
  return row;
}

/**
 * The card as this reader may see it (access-1).
 *
 * A card that opens a channel the reader cannot see is not theirs to see at
 * all — the list leaves it out, the single-card routes answer 404 — so this
 * only has the photograph left to check: a front photo taken from a channel
 * the reader cannot see keeps its secret (the image and its caption) and the
 * card keeps the rest.
 */
function forReader<T>(row: T, scope: ChannelScope): T {
  const card = row as unknown as { photo?: { channel_id?: string | null } | null };
  if (card?.photo && !scope.allows(card.photo.channel_id ?? null)) {
    (card as { photo?: unknown }).photo = null;
  }
  return withPhotoUrl(row);
}

/**
 * What a card may point at, checked before it is written (access-1).
 *
 * Every id is this family's, and every channel — the card's own, and the one
 * its front photo comes from — is one the writer may read. The answer embeds
 * the channel's title, the photo's caption and both people's names, so an id
 * that fails either test would otherwise read them back. Refused as not
 * found, the same answer the channel routes give.
 */
async function refuseTargets(
  archive: string,
  scope: ChannelScope,
  targets: { channel_id?: unknown; media_file_id?: unknown; people?: unknown[] }
): Promise<string | null> {
  if (targets.channel_id) {
    const { data: channel } = await supabase
      .from("channels")
      .select("id")
      .eq("id", targets.channel_id as string)
      .eq("archive_id", archive)
      .maybeSingle();
    if (!channel || !scope.allows(channel.id as string)) return "Channel not found.";
  }
  if (targets.media_file_id) {
    const { data: media } = await supabase
      .from("media_files")
      .select("id, channel_id")
      .eq("id", targets.media_file_id as string)
      .eq("archive_id", archive)
      .maybeSingle();
    if (!media || !media.channel_id || !scope.allows(media.channel_id as string)) {
      return "Media not found.";
    }
  }
  for (const personId of targets.people ?? []) {
    if (!personId) continue;
    const { data: person } = await supabase
      .from("people")
      .select("id")
      .eq("id", personId as string)
      .eq("archive_id", archive)
      .maybeSingle();
    if (!person) return "Person not found.";
  }
  return null;
}

/** The reader's scope, or an answered request when it cannot be read. */
async function scopeFor(
  req: Request,
  res: Response,
  archive: string
): Promise<ChannelScope | null> {
  try {
    return await channelScope(archive, req.profile ?? null, false);
  } catch (err) {
    fail(res, 500, "The card registry could not be loaded.", err);
    return null;
  }
}

/** What a card may be, and where a postcard may be in its life (047). */
const KINDS = ["nfc", "postcard"] as const;
const STATES = ["draft", "ready", "queued", "printing", "shipped", "sent", "delivered", "returned", "failed"] as const;
const RECURRENCES = ["once", "weekly", "monthly"] as const;
const PHOTO_MODES = ["chosen", "newest"] as const;

/**
 * The registry of physical cards. Every profile may read it — the shelf
 * shows which channels have a card — but only an admin changes what a
 * card means, because a mislinked card confuses Margaret at her screen.
 */
nfcRouter.get("/", requireRole(CAN_WRITE_CONTENT), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;
  /*
    18a's filter chips: All / Postcards / NFC cards / Draft / Ready to send.
    Unknown values are refused rather than ignored — a filter that silently
    returns everything is how a family concludes they have no drafts.
  */
  const { kind, state } = req.query;
  if (kind !== undefined && !KINDS.includes(kind as (typeof KINDS)[number])) {
    return res.status(400).json({ error: "Unknown card kind." });
  }
  if (state !== undefined && !STATES.includes(state as (typeof STATES)[number])) {
    return res.status(400).json({ error: "Unknown card state." });
  }

  let query = supabase
    .from("nfc_cards")
    .select(CARD_SELECT)
    .eq("archive_id", archive)
    .is("archived_at", null);

  if (kind !== undefined) query = query.eq("kind", kind as string);
  if (state !== undefined) query = query.eq("state", state as string);

  const { data, error } = await query.order("created_at");

  if (error) return fail(res, 500, "The card registry could not be loaded.", error);

  const scope = await scopeFor(req, res, archive);
  if (!scope) return;
  res.json(
    ((data ?? []) as unknown as CardRow[])
      .filter((card) => scope.allows(card.channel_id ?? null))
      .map((card) => forReader(card, scope))
  );
});

/**
 * A postcard — the four steps of §18 collapsed into one write.
 *
 * The flow asks four questions (CHANNEL → PHOTO → CHECK → SEND) but nothing
 * is worth persisting until the family has answered them, so the wizard holds
 * its own state and this route takes the finished card. It is a separate
 * route from the tag registry below because almost nothing is shared: a
 * postcard has no tag code, and a tag has no photograph, recipient or state.
 *
 * "The channel is the source of truth" is the brief's rule, so a card never
 * stores anything the channel already knows — no title, no description, no
 * number. Those are read through the embed when the card is rendered, which
 * means correcting a channel's title corrects every card that opens it.
 */
nfcRouter.post("/postcards", requireRole(CAN_WRITE_CONTENT), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;

  const {
    channel_id,
    media_file_id,
    from_person_id,
    to_person_id,
    recurrence = "once",
    photo_mode = "chosen",
    next_send_at,
    state = "draft",
  } = req.body ?? {};

  if (typeof channel_id !== "string" || !channel_id) {
    return res.status(400).json({ error: "A card has to open a channel." });
  }
  if (!RECURRENCES.includes(recurrence)) {
    return res.status(400).json({ error: "Unknown schedule." });
  }
  if (!PHOTO_MODES.includes(photo_mode)) {
    return res.status(400).json({ error: "Unknown photo choice." });
  }
  if (state !== "draft" && state !== "ready") {
    return res.status(400).json({ error: "A new card is a draft or ready to send." });
  }

  /*
    A chosen photo means a photograph; "newest in the channel" (18i) means a
    standing instruction and CANNOT carry one, because the whole point is that
    next month's card shows next month's photograph. Storing a media id
    alongside it would freeze the ritual on its first picture.
  */
  if (photo_mode === "chosen" && typeof media_file_id !== "string") {
    return res.status(400).json({ error: "Choose the photo for the front." });
  }
  if (photo_mode === "newest" && media_file_id) {
    return res.status(400).json({ error: "A card that picks the newest photo cannot also fix one." });
  }
  if (recurrence !== "once" && !next_send_at) {
    return res.status(400).json({ error: "A repeating card needs a date to start from." });
  }

  const scope = await scopeFor(req, res, archive);
  if (!scope) return;
  const refused = await refuseTargets(archive, scope, {
    channel_id,
    media_file_id: photo_mode === "chosen" ? media_file_id : null,
    people: [from_person_id, to_person_id],
  });
  if (refused) return res.status(404).json({ error: refused });

  const { data, error } = await supabase
    .from("nfc_cards")
    .insert({
      archive_id: archive,
      kind: "postcard",
      state,
      // The label is for the family's own list; the printed card takes its
      // words from the channel.
      label: typeof req.body?.label === "string" && req.body.label.trim() ? req.body.label.trim() : "Postcard",
      channel_id,
      media_file_id: photo_mode === "chosen" ? media_file_id : null,
      from_person_id: from_person_id || req.profile!.personId,
      to_person_id: to_person_id || null,
      recurrence,
      photo_mode,
      next_send_at: next_send_at || null,
      linked_by: req.profile!.personId,
    })
    .select(CARD_SELECT)
    .single();

  if (error) return fail(res, 500, "The card could not be saved.", error);

  const card = forReader(data, scope) as unknown as CardRow;
  logActivity(
    req.profile,
    "nfc_linked",
    `${actorName(req.profile)} made a postcard`,
    (card.channel_id as string) ?? undefined
  );
  res.status(201).json(card);
});

/**
 * Send it (18e → 18g).
 *
 * The family presses one button and the card leaves their hands: `queued` is
 * what the fulfilment queue reads (18j) and "preparing for delivery" is what
 * the family is shown (18g) — one row, two readerships.
 *
 * Only a draft or a ready card can be sent. Sending an already-queued card
 * twice would print it twice, so the guard is on the state rather than on the
 * button, which a double-click or a stale tab can defeat.
 */
nfcRouter.post("/:id/send", requireRole(CAN_WRITE_CONTENT), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;

  const { data: existing, error: readError } = await supabase
    .from("nfc_cards")
    .select("id, kind, state, media_file_id, photo_mode, channel_id")
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .is("archived_at", null)
    .maybeSingle();

  if (readError) return fail(res, 500, "The card could not be read.", readError);
  if (!existing) return res.status(404).json({ error: "Card not found." });

  const card = existing as unknown as CardRow;
  const scope = await scopeFor(req, res, archive);
  if (!scope) return;
  if (!scope.allows(card.channel_id ?? null)) {
    return res.status(404).json({ error: "Card not found." });
  }
  if (card.kind !== "postcard") {
    return res.status(400).json({ error: "Only a postcard is posted." });
  }
  if (card.state !== "draft" && card.state !== "ready") {
    return res.status(409).json({
      error: card.state === "sent" ? "This card has already been sent." : "This card is already on its way.",
      code: "already_sent",
    });
  }
  if (card.photo_mode === "chosen" && !card.media_file_id) {
    return res.status(400).json({ error: "This card has no photograph on its front yet." });
  }

  const { data, error } = await supabase
    .from("nfc_cards")
    .update({ state: "queued", updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    // Refuse to move a card somebody else just moved: the state we read is
    // the state we are allowed to change.
    .in("state", ["draft", "ready"])
    .select(CARD_SELECT)
    .maybeSingle();

  if (error) return fail(res, 500, "The card could not be sent.", error);
  if (!data) return res.status(409).json({ error: "This card is already on its way.", code: "already_sent" });

  logActivity(
    req.profile,
    "nfc_linked",
    `${actorName(req.profile)} sent a postcard`,
    (card.channel_id as string) ?? undefined
  );
  res.json(forReader(data, scope));
});

nfcRouter.post("/", requireRole(CAN_WRITE_CONTENT), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;
  const { label, tag_code, channel_id, linked_object, ordered } = req.body;

  if (typeof label !== "string" || !label.trim()) {
    return res.status(400).json({ error: "Give the card a name." });
  }

  /*
    An NFC card the family does not hold yet (owner-directed): Recall ships
    it, sticker and code already on it. `ordered: true` puts it in the same
    fulfilment queue the postcards travel — `queued` is what the owner's
    table reads — and its tag code is linked when it is in their hands, not
    invented here. An ordered card carrying a tag code would be a claim
    about a sticker nobody has chosen yet.
  */
  if (ordered && tag_code) {
    return res.status(400).json({ error: "An ordered card gets its code when it arrives." });
  }

  const scope = await scopeFor(req, res, archive);
  if (!scope) return;
  const refused = await refuseTargets(archive, scope, { channel_id });
  if (refused) return res.status(404).json({ error: refused });

  const { data, error } = await supabase
    .from("nfc_cards")
    .insert({
      label: label.trim(),
      tag_code: tag_code || null,
      channel_id: channel_id || null,
      linked_object: linked_object || null,
      linked_by: channel_id ? req.profile!.personId : null,
      archive_id: archive,
      ...(ordered ? { state: "queued" } : {}),
    })
    .select(CARD_SELECT)
    .single();

  if (error) return fail(res, 500, "The card could not be saved.", error);

  logActivity(
    req.profile,
    "nfc_linked",
    `${actorName(req.profile)} registered the card "${data.label}"`,
    data.channel_id
  );
  if (data.channel_id) void evaluateChannel(data.channel_id, archive);
  res.status(201).json(forReader(data, scope));
});

nfcRouter.patch("/:id", requireRole(CAN_WRITE_CONTENT), async (req, res) => {
  const { label, tag_code, channel_id, linked_object } = req.body;

  const archive = requireArchive(req, res);
  if (!archive) return;

  const { data: previous } = await supabase
    .from("nfc_cards")
    .select("channel_id")
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .maybeSingle();

  if (label !== undefined && (typeof label !== "string" || !label.trim())) {
    return res.status(400).json({ error: "The card's name cannot be empty." });
  }

  // A card on a channel this reader cannot see is one the list never showed
  // them; and a relink may only point at a channel they can read.
  const scope = await scopeFor(req, res, archive);
  if (!scope) return;
  if (previous && !scope.allows((previous.channel_id as string | null) ?? null)) {
    return res.status(404).json({ error: "Card not found." });
  }
  const refused = await refuseTargets(archive, scope, { channel_id });
  if (refused) return res.status(404).json({ error: refused });

  const { data, error } = await supabase
    .from("nfc_cards")
    .update({
      ...(label !== undefined && { label: label.trim() }),
      ...(tag_code !== undefined && { tag_code: tag_code || null }),
      // channel_id: null unlinks; a new id relinks and records who did it.
      ...(channel_id !== undefined && {
        channel_id: channel_id || null,
        linked_by: channel_id ? req.profile!.personId : null,
      }),
      ...(linked_object !== undefined && { linked_object: linked_object || null }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .is("archived_at", null)
    .select(CARD_SELECT)
    .maybeSingle();

  if (error) return fail(res, 500, "The card could not be updated.", error);
  if (!data) return res.status(404).json({ error: "Card not found." });

  if (channel_id !== undefined) {
    // PostgREST types an embedded row as an array; it is one row here.
    const channel = (data as unknown as { channel?: { number: number; title: string } | null })
      .channel;
    logActivity(
      req.profile,
      channel_id ? "nfc_linked" : "nfc_unlinked",
      channel_id && channel
        ? `${actorName(req.profile)} linked "${data.label}" to Channel ${String(channel.number).padStart(2, "0")}`
        : `${actorName(req.profile)} unlinked the card "${data.label}"`,
      data.channel_id
    );
    // Both sides of a move are re-checked: the channel that lost a card and
    // the one that gained it.
    if (previous?.channel_id) void evaluateChannel(previous.channel_id, archive);
    if (data.channel_id) void evaluateChannel(data.channel_id, archive);
  }
  res.json(forReader(data, scope));
});

nfcRouter.delete("/:id", requireRole(CAN_MANAGE_PEOPLE), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;

  const { data: card } = await supabase
    .from("nfc_cards")
    .select("channel_id")
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .maybeSingle();

  const { error } = await supabase
    .from("nfc_cards")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .is("archived_at", null);

  if (error) return fail(res, 500, "The card could not be removed.", error);
  if (card?.channel_id) void evaluateChannel(card.channel_id, archive);
  res.status(204).end();
});
