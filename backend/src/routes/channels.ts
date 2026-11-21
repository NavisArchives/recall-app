import { Router } from "express";
import { supabase } from "../config/supabase.js";
import { env } from "../config/env.js";
import { requireRole, actingProfile, requireDevice, requireArchive } from "../middleware/auth.js";
import { CAN_WRITE_CONTENT, CAN_DELETE, CAN_MANAGE_PEOPLE } from "../services/accessCodes.js";
import {
  PERSON_COLUMNS,
  CHANNEL_COLUMNS,
  MEDIA_FILE_COLUMNS,
  toPublicPerson,
} from "../services/dto.js";
import { CHANNEL_MEDIA_BUCKET, removeFromBucket } from "../services/media.js";
import { purgeMedia } from "../services/mediaCache.js";
import { forgetMedia } from "../services/mediaIndex.js";
import { fail } from "../lib/errors.js";
import {
  peopleInMedia,
  placeNames,
  resolveTags,
  setChannelTags,
  tagsOnChannels,
} from "../services/vocabulary.js";
import { withSnapshot } from "../services/snapshot.js";
import { RESERVED_CHANNEL_NUMBERS } from "../lib/channelNumbers.js";
import { logActivity, actorName, channelLabel } from "../services/activityLog.js";
import { evaluateChannel } from "../services/suggestions.js";
import { mayReadChannel, readableChannelIds } from "../services/channelVisibility.js";

/**
 * The photographs, dressed for a client (059).
 *
 * The storage path never leaves — media is served through this backend — and
 * the place and the people ride along as the names and ids a screen can show
 * without asking a second time. Both are optional, and a channel where nobody
 * filled them in reads exactly as it did before: `place` null, `people` empty.
 *
 * Two extra reads per channel, both archive-scoped, both skipped entirely when
 * no photograph has a place or the channel has no media.
 */
async function decorateMedia(
  archiveId: string,
  media: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const ids = media.map((m) => m.id as string);
  const [places, people] = await Promise.all([
    placeNames(archiveId, media.map((m) => (m.place_id as string | null) ?? "")),
    peopleInMedia(archiveId, ids),
  ]);

  return media.map(({ storage_path, ...item }) => ({
    ...item,
    place: item.place_id ? places.get(item.place_id as string) ?? null : null,
    people: people.get(item.id as string) ?? [],
    url: `${env.publicUrl}/api/media/${item.id}/file`,
  }));
}

export const channelsRouter = Router();

function parseChannelNumber(value: unknown): number | null {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 99) return null;
  if (RESERVED_CHANNEL_NUMBERS.has(number)) return null;
  return number;
}

/**
 * Privacy:
 *   1 private  - the subject and admins only
 *   2 selected - plus the co-authors named in channel_access
 *   3 everyone - any profile
 *
 * The display itself is unauthenticated and shows everything, since it lives
 * in Margaret's own home and is the whole point of the archive. Privacy
 * applies to what other people see in the management area.
 */
channelsRouter.get("/", requireDevice, async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;
  // Family-session members are people, not the display (M125/F39).
  const profile = await actingProfile(req);

  // media_count lets the admin dashboard show totals without a second request.
  let query = supabase
    .from("channels")
    .select(
      `${CHANNEL_COLUMNS}, media_files(id, display_order, file_type, caption, archived_at), author:people!channels_author_id_fkey(id, name)`
    )
    .eq("archive_id", archive)
    .is("archived_at", null);

  const { data, error } = await query.order("number");

  if (error) return fail(res, 500, "The channels could not be loaded.", error);

  // The first photo doubles as the channel's cover on the overview shelf.
  let rows = data.map(({ media_files, ...channel }) => {
    /*
     * A photograph in the bin has left the shelf (M127).
     *
     * This embed carried no archived filter, so a removed photograph still
     * counted in `photo_count`, still asked to be described through
     * `undescribed_count`, and — because the cover is simply the
     * lowest-ordered image — could still *be* the channel's cover. Removing
     * the first photo of a channel left it on her display. The detail route
     * has always filtered; only this list did not.
     */
    const items = ((media_files ?? []) as unknown as {
      id: string;
      display_order: number;
      file_type: string;
      caption: string | null;
      archived_at: string | null;
    }[]).filter((m) => !m.archived_at);
    const cover = items
      .filter((m) => m.file_type === "image")
      .sort((a, b) => a.display_order - b.display_order)[0];

    return {
      ...channel,
      media_count: items.length,
      // Per-type counts feed the dashboard's MEDIA column ("8 photos · 1 video").
      photo_count: items.filter((m) => m.file_type === "image").length,
      video_count: items.filter((m) => m.file_type === "video").length,
      undescribed_count: items.filter(
        (m) => m.file_type === "image" && !(m.caption ?? "").trim()
      ).length,
      cover_url: cover ? `${env.publicUrl}/api/media/${cover.id}/file` : null,
    };
  });

  const readable = await readableChannelIds(
    archive,
    rows,
    profile,
    req.device?.isTrusted === true && !profile
  );
  rows = rows.filter((channel) => readable.has(channel.id));

  res.json(rows);
});

channelsRouter.get("/:number", requireDevice, async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;
  const number = Number(req.params.number);
  if (!Number.isInteger(number)) {
    return res.status(400).json({ error: "Invalid channel number." });
  }

  const profile = await actingProfile(req);

  // Kept as a snapshot so a Supabase outage shows Margaret the archive she
  // saw yesterday rather than an error. Media URLs point at this backend and
  // are served from the on-disk cache, so a stale page still shows its photos.
  let result;
  try {
    result = await withSnapshot(`channel-${archive}-${number}`, async () => {
      const { data: channel, error } = await supabase
        .from("channels")
        .select(`${CHANNEL_COLUMNS}, author:people!channels_author_id_fkey(${PERSON_COLUMNS})`)
        .eq("archive_id", archive)
        .eq("number", number)
        .is("archived_at", null)
        .maybeSingle();

      if (error) throw error;
      if (!channel) return null;

      const { data: media, error: mediaError } = await supabase
        .from("media_files")
        .select(MEDIA_FILE_COLUMNS)
        .eq("channel_id", channel.id)
        .eq("archive_id", archive)
        .is("archived_at", null)
        .order("display_order");

      if (mediaError) throw mediaError;

      /*
   * Who may change this, by name.
   *
   * The lock a non-editor sees says "Only Thomas and the admins can change
   * this", and the person it must name is the *creator* — `created_by` — not
   * the channel's credited author, which is a different field and is often
   * empty. Just the name: contact details belong to an admin's screens, and
   * this one is read by every helper.
   */
  let creatorName: string | null = null;
  if (channel.created_by) {
    const { data: creator } = await supabase
      .from("people")
      .select("name")
      .eq("id", channel.created_by)
      .eq("archive_id", archive)
      .maybeSingle();
    creatorName = creator?.name ?? null;
  }

  const { author, ...channelFields } = channel as typeof channel & { author: unknown };

      return {
        ...channelFields,
        author: await toPublicPerson(author as never),
        media: await decorateMedia(archive, media as Record<string, unknown>[]),
      };
    });
  } catch (err) {
    /*
      The last French string in the product (M175/M28).

      It survived the M28 sweep because it is reached only when the archive is
      unreachable *and* the offline cache cannot answer — a path nobody walks
      on a good day, and so a path no English pass ever rendered. Her screen
      is the one that meets it, which makes it the worst place for a language
      she is not being shown anywhere else.
    */
    return fail(res, 503, "This channel is unavailable offline.", err);
  }

  if (!result.data) return res.status(404).json({ error: "Channel not found." });
  if (
    !(await mayReadChannel(
      archive,
      result.data,
      profile,
      req.device?.isTrusted === true && !profile
    ))
  ) {
    return res.status(404).json({ error: "Channel not found." });
  }
  res.json(result.stale ? { ...result.data, stale: true } : result.data);
});

channelsRouter.post("/", requireRole(CAN_WRITE_CONTENT), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;
  const { number, title, description, content_type, date, author_id, privacy_level, tags } = req.body;

  const parsedNumber = parseChannelNumber(number);
  if (parsedNumber === null) {
    return res.status(400).json({
      error: "Invalid number. Choose a number between 1 and 99, outside the reserved ones.",
    });
  }

  if (typeof title !== "string" || !title.trim()) {
    return res.status(400).json({ error: "The title is required." });
  }

  const TYPES = ["album", "video", "documentary", "instruction", "stories"];
  if (!TYPES.includes(content_type)) {
    return res.status(400).json({ error: "Invalid content type." });
  }

  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    return res.status(400).json({ error: "Invalid date. Use the format 2026-08-01." });
  }

  /*
    What the channel is about, in the family's own words (059) — childhood,
    holiday, travel, hometown, or anything they invent. Names, not ids: the
    field is a box you type in, and a tag exists because somebody used it.
  */
  if (tags !== undefined && (!Array.isArray(tags) || tags.some((t) => typeof t !== "string"))) {
    return res.status(400).json({ error: "Invalid tags." });
  }

  const { data, error } = await supabase
    .from("channels")
    .insert({
      number: parsedNumber,
      title: title.trim(),
      description: description || null,
      content_type,
      date: date || null,
      author_id: author_id || null,
      privacy_level: [1, 2, 3].includes(Number(privacy_level)) ? Number(privacy_level) : 3,
      created_by: req.profile?.personId ?? null,
      archive_id: archive,
    })
    .select(CHANNEL_COLUMNS)
    .single();

  if (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "This channel number already exists." });
    }
    return fail(res, 500, "The channel could not be created.", error);
  }

  /*
    The tags come after the channel, because they name a row that has to
    exist first. A failure here leaves the channel standing — it is a made
    channel with no tags, which is the state every channel starts in and
    nothing downstream treats as broken. Losing the channel over a word
    would be the worse answer.
  */
  let tagNames: string[] = [];
  if (Array.isArray(tags) && tags.length) {
    try {
      const ids = await resolveTags(archive, tags as string[], req.profile?.personId ?? null);
      await setChannelTags(archive, data.id, ids);
      tagNames = (await tagsOnChannels(archive, [data.id])).get(data.id) ?? [];
    } catch (err) {
      console.error("[channels] the tags could not be saved", err);
    }
  }

  logActivity(
    req.profile,
    "channel_created",
    `${actorName(req.profile)} created ${channelLabel(data.number, data.title)}`,
    data.id
  );
  void evaluateChannel(data.id, archive);
  res.status(201).json({ ...data, tags: tagNames });
});

/** A single channel by id, with its media — what the edit screen loads. */
channelsRouter.get("/detail/:id", requireRole(CAN_WRITE_CONTENT), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;
  const { data: channel, error } = await supabase
    .from("channels")
    .select(`${CHANNEL_COLUMNS}, author:people!channels_author_id_fkey(${PERSON_COLUMNS})`)
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .is("archived_at", null)
    .maybeSingle();

  // Editing is a management action and needs live data — no snapshot here,
  // since saving against a stale copy would overwrite someone else's change.
  if (error) return fail(res, 500, "The channel could not be loaded.", error);
  if (!channel) return res.status(404).json({ error: "Channel not found." });

  /*
   * A co-author may open any channel they are allowed to *see*, and change
   * only their own (M49).
   *
   * This used to refuse the read as well, which meant somebody invited to
   * enjoy the archive could not look at most of it — the shelf dimmed those
   * cards to 35% and opening one gave a refusal. Seeing and changing are
   * different questions: privacy answers the first, authorship the second.
   * Every write path below still checks `created_by` and still returns 403.
   */
  const isAdmin = req.profile!.role === "admin";
  const mine = channel.created_by === req.profile!.personId;
  const mayRead = await mayReadChannel(archive, channel, req.profile!, false);

  // A channel they may not see is not "forbidden", it simply is not there —
  // the same answer a stranger's channel gives.
  if (!mayRead) return res.status(404).json({ error: "Channel not found." });

  const { data: media, error: mediaError } = await supabase
    .from("media_files")
    .select(MEDIA_FILE_COLUMNS)
    .eq("channel_id", channel.id)
    .eq("archive_id", archive)
    .is("archived_at", null)
    .order("display_order");

  if (mediaError) return fail(res, 500, "The media could not be loaded.", mediaError);

  /*
   * Who may change this, by name.
   *
   * The lock a non-editor sees says "Only Thomas and the admins can change
   * this", and the person it must name is the *creator* — `created_by` — not
   * the channel's credited author, which is a different field and is often
   * empty. Just the name: contact details belong to an admin's screens, and
   * this one is read by every helper.
   */
  let creatorName: string | null = null;
  if (channel.created_by) {
    const { data: creator } = await supabase
      .from("people")
      .select("name")
      .eq("id", channel.created_by)
      .eq("archive_id", archive)
      .maybeSingle();
    creatorName = creator?.name ?? null;
  }

  const { author, ...channelFields } = channel as typeof channel & { author: unknown };

  res.json({
    // Whether this person may change it — so the screen states the rule
    // rather than deriving it a second time and risking a different answer.
    can_edit: isAdmin || mine,
    created_by_name: creatorName,
    ...channelFields,
    author: await toPublicPerson(author as never),
    media: await decorateMedia(archive, media as Record<string, unknown>[]),
    // What this channel is about, in the family's own words (059).
    tags: (await tagsOnChannels(archive, [channel.id])).get(channel.id) ?? [],
  });
});

/**
 * Who may see a "selected people" channel. Admin only — the grant list is
 * itself information about the family.
 */
channelsRouter.get("/:id/access", requireRole(CAN_MANAGE_PEOPLE), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;

  // The channel is confirmed to be this family's before its grant list is read.
  // Filtering the grants alone would still answer for a channel belonging to
  // someone else — and the answer is a list of who may see their photographs.
  const { data: channel, error: channelError } = await supabase
    .from("channels")
    .select("id")
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .maybeSingle();

  if (channelError) return fail(res, 500, "The access list could not be loaded.", channelError);
  if (!channel) return res.status(404).json({ error: "Channel not found." });

  const { data, error } = await supabase
    .from("channel_access")
    .select("person_id")
    .eq("channel_id", req.params.id)
    .eq("archive_id", archive);

  if (error) return fail(res, 500, "The access list could not be loaded.", error);
  res.json((data ?? []).map((row) => row.person_id));
});

/** Replaces the grant list in one call, so the UI state is the whole truth. */
channelsRouter.put("/:id/access", requireRole(CAN_MANAGE_PEOPLE), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;
  const ids: string[] = req.body?.person_ids;
  if (!Array.isArray(ids) || ids.some((v) => typeof v !== "string")) {
    return res.status(400).json({ error: "Invalid list of people." });
  }

  const { data: channel, error: channelError } = await supabase
    .from("channels")
    .select("id")
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .maybeSingle();

  if (channelError) return fail(res, 500, "The access list could not be saved.", channelError);
  if (!channel) return res.status(404).json({ error: "Channel not found." });

  // Everyone named has to be one of this family's people. Stamping the
  // caller's archive onto a grant that joins someone else's person would write
  // a false claim of ownership — and one that every later archive-filtered
  // query would then believe.
  const wanted = [...new Set(ids)];
  if (wanted.length > 0) {
    const { data: members, error: memberError } = await supabase
      .from("people")
      .select("id")
      .eq("archive_id", archive)
      .in("id", wanted);

    if (memberError) return fail(res, 500, "The access list could not be saved.", memberError);
    if ((members ?? []).length !== wanted.length) {
      // The whole request is refused rather than the strangers dropped: a
      // partly-applied grant list looks identical to a complete one.
      return res.status(400).json({ error: "Invalid list of people." });
    }
  }

  const { data: current, error: currentError } = await supabase
    .from("channel_access")
    .select("person_id")
    .eq("channel_id", req.params.id)
    .eq("archive_id", archive);

  if (currentError) return fail(res, 500, "The access list could not be saved.", currentError);

  const held = new Set((current ?? []).map((row) => row.person_id as string));
  const toRemove = [...held].filter((id) => !wanted.includes(id));
  const toAdd = wanted.filter((id) => !held.has(id));

  // Only the difference is touched, so a failure part-way costs the difference
  // rather than the whole list. Removals go first: the failure that leaves
  // someone short of access is safer than the one that leaves them with it.
  //
  // This is not yet atomic. Making it so needs a Postgres function doing the
  // whole exchange in one statement — see docs/missions/M05.
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from("channel_access")
      .delete()
      .eq("channel_id", req.params.id)
      .eq("archive_id", archive)
      .in("person_id", toRemove);
    if (error) return fail(res, 500, "The access list could not be saved.", error);
  }

  if (toAdd.length > 0) {
    const rows = toAdd.map((person_id) => ({
      channel_id: req.params.id,
      person_id,
      archive_id: archive,
      granted_by: req.profile?.personId ?? null,
    }));
    const { error } = await supabase.from("channel_access").insert(rows);
    if (error) return fail(res, 500, "The access list could not be saved.", error);
  }

  res.json({ count: wanted.length });
});

/** Edits a channel. An admin may edit any; a co_author only their own. */
channelsRouter.patch("/:id", requireRole(CAN_WRITE_CONTENT), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;
  const { title, description, date, content_type, author_id, privacy_level, tags } = req.body;

  const { data: existing, error: findError } = await supabase
    .from("channels")
    .select("id, created_by")
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .is("archived_at", null)
    .maybeSingle();

  if (findError) return fail(res, 500, "The channel could not be updated.", findError);
  if (!existing) return res.status(404).json({ error: "Channel not found." });

  if (req.profile!.role !== "admin" && existing.created_by !== req.profile!.personId) {
    return res.status(403).json({ error: "This channel is not yours." });
  }

  if (title !== undefined && (typeof title !== "string" || !title.trim())) {
    return res.status(400).json({ error: "The title is required." });
  }
  if (
    content_type !== undefined &&
    !["album", "video", "documentary", "instruction", "stories"].includes(content_type)
  ) {
    return res.status(400).json({ error: "Invalid content type." });
  }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    return res.status(400).json({ error: "Invalid date. Use the format 2026-08-01." });
  }
  if (tags !== undefined && (!Array.isArray(tags) || tags.some((t) => typeof t !== "string"))) {
    return res.status(400).json({ error: "Invalid tags." });
  }

  // The number is deliberately not editable: tags in the house are printed
  // with it, so changing it would silently break a physical object.
  const { data, error } = await supabase
    .from("channels")
    .update({
      ...(title !== undefined && { title: title.trim() }),
      ...(description !== undefined && { description: description || null }),
      ...(date !== undefined && { date: date || null }),
      ...(content_type !== undefined && { content_type }),
      ...(author_id !== undefined && { author_id: author_id || null }),
      ...(privacy_level !== undefined &&
        [1, 2, 3].includes(Number(privacy_level)) && {
          privacy_level: Number(privacy_level),
        }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .select(CHANNEL_COLUMNS)
    .single();

  if (error) return fail(res, 500, "The channel could not be updated.", error);

  // `tags: []` clears them; an absent `tags` leaves them alone — the same
  // rule every other field on this route follows.
  if (tags !== undefined) {
    try {
      const ids = await resolveTags(archive, tags as string[], req.profile?.personId ?? null);
      await setChannelTags(archive, req.params.id as string, ids);
    } catch (err) {
      return fail(res, 500, "The tags could not be saved.", err);
    }
  }

  logActivity(
    req.profile,
    "channel_edited",
    `${actorName(req.profile)} edited ${channelLabel(data.number, data.title)}`,
    data.id
  );
  void evaluateChannel(data.id, archive);
  res.json({ ...data, tags: (await tagsOnChannels(archive, [data.id])).get(data.id) ?? [] });
});

/**
 * Archives rather than deletes. Family photos are irreplaceable, so a mistake
 * here must be recoverable: the rows and the stored files both stay, and the
 * channel simply stops appearing on the display.
 */
channelsRouter.delete("/:id", requireRole(CAN_DELETE), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;
  const archivedAt = new Date().toISOString();

  const { data, error } = await supabase
    .from("channels")
    .update({ archived_at: archivedAt })
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .is("archived_at", null)
    .select("id, number, title")
    .maybeSingle();

  if (error) return fail(res, 500, "The channel could not be archived.", error);
  if (!data) return res.status(404).json({ error: "Channel not found." });

  logActivity(
    req.profile,
    "channel_deleted",
    `${actorName(req.profile)} moved ${channelLabel(data.number, data.title)} to deleted`,
    data.id
  );
  void evaluateChannel(data.id, archive);

  await supabase
    .from("media_files")
    .update({ archived_at: archivedAt })
    .eq("channel_id", req.params.id)
    .eq("archive_id", archive)
    .is("archived_at", null);

  res.status(204).end();
});

/** Puts an archived channel back on the display. */
channelsRouter.post("/:id/restore", requireRole(CAN_DELETE), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;
  const { data, error } = await supabase
    .from("channels")
    .update({ archived_at: null })
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .not("archived_at", "is", null)
    .select("id, number, title")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "This channel number is already in use." });
    }
    return fail(res, 500, "The channel could not be restored.", error);
  }
  if (!data) return res.status(404).json({ error: "Archived channel not found." });

  logActivity(
    req.profile,
    "channel_restored",
    `${actorName(req.profile)} restored ${channelLabel(data.number, data.title)}`,
    data.id
  );
  void evaluateChannel(data.id, archive);

  await supabase
    .from("media_files")
    .update({ archived_at: null })
    .eq("channel_id", req.params.id)
    .eq("archive_id", archive);

  res.status(204).end();
});

/** Archived channels, for the management area only. */
channelsRouter.get("/archived/list", requireRole(CAN_DELETE), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;
  const { data, error } = await supabase
    .from("channels")
    .select(CHANNEL_COLUMNS + ", archived_at")
    .eq("archive_id", archive)
    .not("archived_at", "is", null)
    .order("archived_at", { ascending: false });

  if (error) return fail(res, 500, "The archived channels could not be loaded.", error);

  // Covers for the deleted list. Without the archive this read every image in
  // the database to find a thumbnail for one family's bin.
  const { data: covers } = await supabase
    .from("media_files")
    .select("id, channel_id, file_type, display_order")
    .eq("file_type", "image")
    .eq("archive_id", archive)
    .order("display_order");

  const coverByChannel = new Map<string, string>();
  for (const m of covers ?? []) {
    if (!coverByChannel.has(m.channel_id)) coverByChannel.set(m.channel_id, m.id);
  }

  // The dynamic column string defeats supabase-js type inference here.
  const rows = (data ?? []) as unknown as Array<Record<string, unknown> & { id: string }>;

  res.json(
    rows.map((channel) => ({
      ...channel,
      cover_url: coverByChannel.has(channel.id)
        ? `${env.publicUrl}/api/media/${coverByChannel.get(channel.id)}/file`
        : null,
    }))
  );
});

/**
 * Permanent deletion — the only unrecoverable action in the system, so it
 * only applies to channels already in the archive, and the storage objects
 * go too. A failure to clear a file never blocks the removal of the rows.
 */
channelsRouter.delete("/:id/permanent", requireRole(CAN_DELETE), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;
  const { data: channel, error: findError } = await supabase
    .from("channels")
    .select("id, number, title, archived_at")
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .maybeSingle();

  if (findError) return fail(res, 500, "Could not delete this channel.", findError);
  if (!channel) return res.status(404).json({ error: "Channel not found." });
  if (!channel.archived_at) {
    return res.status(409).json({
      error: "Only channels in Recently deleted can be permanently removed.",
    });
  }

  const { data: media } = await supabase
    .from("media_files")
    .select("id, storage_path")
    .eq("channel_id", channel.id)
    .eq("archive_id", archive);

  const files = media ?? [];
  const paths = files.map((m) => m.storage_path);
  let storageCleared = true;
  if (paths.length > 0) {
    try {
      await removeFromBucket(CHANNEL_MEDIA_BUCKET, paths);
    } catch (err) {
      storageCleared = false;
      console.error("[error] Storage purge incomplete", err);
    }
  }

  // Deleting from storage is not enough while this machine still holds copies
  // and still knows which id they belong to. Both go, or the photograph is
  // only gone in the places nobody was looking.
  for (const file of files) {
    await purgeMedia(CHANNEL_MEDIA_BUCKET, file.storage_path);
    await forgetMedia(file.id);
  }

  await supabase
    .from("channel_access")
    .delete()
    .eq("channel_id", channel.id)
    .eq("archive_id", archive);
  await supabase
    .from("media_files")
    .delete()
    .eq("channel_id", channel.id)
    .eq("archive_id", archive);
  const { error } = await supabase
    .from("channels")
    .delete()
    .eq("id", channel.id)
    .eq("archive_id", archive);

  if (error) return fail(res, 500, "Could not delete this channel.", error);

  // No target_channel_id: the row it would point at no longer exists.
  logActivity(
    req.profile,
    "channel_purged",
    `${actorName(req.profile)} permanently deleted ${channelLabel(channel.number, channel.title)}`
  );

  res.json({
    deleted: true,
    storage_cleared: storageCleared,
  });
});
