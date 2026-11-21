import { Router } from "express";
import { readFile, writeFile } from "node:fs/promises";
import { supabase } from "../config/supabase.js";
import { env } from "../config/env.js";
import { readUpload, upload, uploadGate } from "../middleware/upload.js";
import { requireRole, requireArchive } from "../middleware/auth.js";
import { CAN_DELETE, CAN_WRITE_CONTENT } from "../services/accessCodes.js";
import {
  CHANNEL_MEDIA_BUCKET,
  buildStoragePath,
  removeFromBucket,
  uploadToBucket,
  verifyFile,
} from "../services/media.js";
import { fail } from "../lib/errors.js";
import { logActivity, actorName } from "../services/activityLog.js";
import { evaluateChannel } from "../services/suggestions.js";
import {
  resolvePlace,
  resolvePlacesAligned,
  setMediaPeople,
} from "../services/vocabulary.js";

export const mediaFilesRouter = Router();

/**
 * Multer gives a single string when one value is sent and an array when many,
 * so per-file metadata is normalised to an array aligned with `files`.
 */
function asList(value: unknown): (string | null)[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).map((v) =>
    typeof v === "string" && v.trim() ? v.trim() : null
  );
}

/**
 * How much of a date the family actually told us (059).
 *
 * Month is the default rather than day on purpose. Every screen that writes a
 * date is a month picker, so a client that says nothing means "month"; reading
 * silence as "day" is what made the display state a day nobody chose.
 */
const PRECISIONS = ["year", "month", "day"] as const;
function precisionOf(value: unknown): "year" | "month" | "day" {
  return (PRECISIONS as readonly string[]).includes(String(value))
    ? (value as "year" | "month" | "day")
    : "month";
}

/**
 * The person ids a form sent for one photograph, as JSON.
 *
 * Anything that is not a list of id-shaped strings is read as "nobody" — the
 * field is optional, and a malformed one must not sink an upload of
 * photographs that are otherwise perfectly fine.
 */
const ID_SHAPE = /^[0-9a-f-]{36}$/i;
function parseIdList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && ID_SHAPE.test(v));
  } catch {
    return [];
  }
}

mediaFilesRouter.post("/", requireRole(CAN_WRITE_CONTENT), uploadGate, upload.array("files"), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;
  const { channel_id } = req.body;
  const files = req.files as Express.Multer.File[] | undefined;
  const captions = asList(req.body.captions);
  const takenOn = asList(req.body.taken_on);
  const takenPrecision = asList(req.body.taken_precision);
  /*
    Who and where (059), one entry per file like every other piece of
    per-file metadata. `people` arrives as a JSON array of person ids because
    a form field cannot hold a list — a second parallel array would have to
    line up with `files` twice over, and would not survive one person adding
    a field.
  */
  const placeNamesSent = asList(req.body.places);
  const peopleSent = asList(req.body.people);

  if (typeof channel_id !== "string" || !channel_id) {
    return res.status(400).json({ error: "Missing channel." });
  }
  if (!files?.length) {
    return res.status(400).json({ error: "No files were provided." });
  }

  const { data: channel, error: channelError } = await supabase
    .from("channels")
    .select("id, created_by, content_type")
    .eq("id", channel_id)
    .eq("archive_id", archive)
    .is("archived_at", null)
    .maybeSingle();

  if (channelError) return fail(res, 500, "The channel could not be verified.", channelError);
  if (!channel) return res.status(404).json({ error: "Channel not found." });

  // The same rule the delete and reorder paths apply: knowing a channel's id
  // is not permission to put photographs in it.
  if (req.profile!.role !== "admin" && channel.created_by !== req.profile!.personId) {
    return res.status(403).json({ error: "This channel is not yours." });
  }

  /*
   * Verify everything before storing anything — but one file at a time.
   *
   * The bytes live on disk now, so this pass loads each file, checks its
   * magic bytes, and keeps only the verdict: mime, extension, kind. A HEIC
   * photograph is converted here and the JPEG written back over its temp
   * file, so the upload pass below streams the bytes that will actually be
   * stored. Peak memory is one file and its decode, never the batch.
   */
  /*
    A stories channel takes a voice as well as its picture (051, spec 24b) —
    so its uploads verify in "voice" mode, which admits the audio formats and
    classifies a recorder's ambiguous WebM container as audio. Every other
    type keeps exactly the old allowlist: the channel's type is what widens
    the gate, never anything the client claims about the file.
  */
  const mode = channel.content_type === "stories" ? ("voice" as const) : ("media" as const);
  const verified: {
    path: string;
    mime: string;
    extension: string;
    kind: "image" | "video" | "audio";
  }[] = [];
  for (const file of files) {
    const buffer = await readUpload(file);
    const result = await verifyFile(buffer, mode);
    if (!result) {
      return res.status(400).json({
        error:
          `Unsupported file: ${file.originalname}. Accepted formats: JPEG, PNG, WebP, GIF, MP4, MOV, WebM` +
          (mode === "voice" ? ", MP3, M4A, OGG, WAV." : "."),
      });
    }
    if (result.buffer !== buffer) await writeFile(file.path, result.buffer);
    verified.push({
      path: file.path,
      mime: result.mime,
      extension: result.extension,
      kind: result.kind,
    });
  }

  const { data: existing } = await supabase
    .from("media_files")
    .select("display_order")
    .eq("channel_id", channel_id)
    .eq("archive_id", archive)
    .order("display_order", { ascending: false })
    .limit(1);

  let nextOrder = (existing?.[0]?.display_order ?? -1) + 1;
  const firstOrder = nextOrder;

  // Before the rows, because place_id is part of the row. One read and at
  // most one insert for the whole batch, however many files named a place.
  let placeIds: (string | null)[];
  try {
    placeIds = await resolvePlacesAligned(archive, placeNamesSent, req.profile?.personId ?? null);
  } catch (err) {
    return fail(res, 500, "The places could not be saved.", err);
  }

  // Upload everything first, then insert as one batch, so a mid-way failure
  // never leaves a channel with a partial set of media rows.
  const uploadedPaths: string[] = [];
  const rows = [];

  try {
    for (const [i, file] of verified.entries()) {
      const storagePath = buildStoragePath(`channels/${channel_id}`, file.extension);
      // Loaded here, released when the iteration moves on — the sequencing
      // that keeps peak memory at one file.
      const buffer = await readFile(file.path);
      await uploadToBucket(CHANNEL_MEDIA_BUCKET, storagePath, {
        buffer,
        mime: file.mime,
        extension: file.extension,
        kind: file.kind,
      });
      uploadedPaths.push(storagePath);

      rows.push({
        // The family the row belongs to travels with it — the media route
        // refuses to serve a file whose archive does not match the viewer.
        archive_id: archive,
        channel_id,
        storage_path: storagePath,
        file_type: file.kind,
        caption: captions[i] ?? null,
        // A malformed date is dropped rather than sinking the whole upload.
        taken_on: /^\d{4}-\d{2}-\d{2}$/.test(takenOn[i] ?? "") ? takenOn[i] : null,
        /*
          What the family actually told us (059). Every screen that writes a
          date today is a MONTH picker that appends "-01", so an absent
          precision means month, not day — defaulting the other way is how a
          photograph dated "August 1978" came to be read aloud as "1 August
          1978" to someone who cannot check it.
        */
        taken_precision: /^\d{4}-\d{2}-\d{2}$/.test(takenOn[i] ?? "")
          ? precisionOf(takenPrecision[i])
          : null,
        // Where it was taken (059). Optional, and a name nobody typed stays
        // null rather than becoming a place called "".
        place_id: placeIds[i] ?? null,
        display_order: nextOrder++,
        created_by: req.profile?.personId ?? null,
      });
    }
  } catch (err) {
    await removeFromBucket(CHANNEL_MEDIA_BUCKET, uploadedPaths).catch(() => {});
    return fail(res, 500, "The upload failed.", err);
  }

  const { data, error } = await supabase
    .from("media_files")
    .insert(rows)
    .select("id, display_order");

  if (error) {
    await removeFromBucket(CHANNEL_MEDIA_BUCKET, uploadedPaths).catch(() => {});
    return fail(res, 500, "The media could not be saved.", error);
  }

  const count = data.length;

  /*
    Who is in each photograph (059), once the rows have ids.

    Matched by display_order, not by the order the insert answered in. This
    route assigns display_order itself, one per file, unique inside the
    channel — so it is a key we own. The order of returned rows is not
    promised by anything, and quietly attaching Marie to the wrong photograph
    is the kind of wrong that nobody ever notices is wrong.

    A failure here does not undo the upload. The photographs are the thing
    that was asked for and they are safely in; deleting twenty files because
    a name did not attach would be a far worse answer than saying so. So it
    is said so, in the response, and the page shows it.
  */
  let detailProblem: string | null = null;
  const orderToId = new Map(
    (data ?? []).map((row) => [row.display_order as number, row.id as string])
  );

  for (const [i] of verified.entries()) {
    const ids = parseIdList(peopleSent[i]);
    if (!ids.length) continue;
    const mediaId = orderToId.get(firstOrder + i);
    if (!mediaId) continue;
    try {
      await setMediaPeople(archive, mediaId, ids, req.profile?.personId ?? null);
    } catch (err) {
      console.error("[media-files] the people on a photograph could not be saved", err);
      detailProblem = "The photographs were saved, but the people on them were not.";
    }
  }

  /*
    The log names what was actually added (M120/F34).
  
    "added 2 files" was both bland and load-bearing: the mobile Overview
    builds its "+2" mark by finding a count and a noun in this sentence, and
    "files" is not one of the nouns it knows — so a real two-photo upload
    rendered no mark at all and the feature was unreachable. Nobody would
    find that by reading either side on its own; the prose *is* the contract
    between them, which is the argument for M103 eventually carrying a
    structured count and kind so nothing has to parse English.
  
    The kind is the magic-byte-verified `file_type`, not the client's claim
    about its own upload. A mixed batch says "memories" rather than picking
    a side.
  */
  const kinds = new Set(rows.map((r) => r.file_type));
  const noun =
    kinds.size !== 1
      ? count === 1 ? "memory" : "memories"
      : kinds.has("video")
        ? count === 1 ? "film" : "films"
        : count === 1 ? "photograph" : "photographs";

  logActivity(
    req.profile,
    "media_added",
    `${actorName(req.profile)} added ${count} ${noun}`,
    channel_id
  );
  void evaluateChannel(channel_id, archive);

  res.status(201).json({ count, ...(detailProblem ? { detail_problem: detailProblem } : {}) });
});

/**
 * Saves a new display order for a channel's photos in one call. The list is
 * the whole truth: every live media id of the channel, in the order to keep.
 *
 * Registered before "/:id" — Express matches in order, and a literal
 * "reorder" must never be read as a media id.
 */
mediaFilesRouter.patch("/reorder", requireRole(CAN_WRITE_CONTENT), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;
  const { channel_id, ordered_ids } = req.body ?? {};

  if (typeof channel_id !== "string" || !channel_id) {
    return res.status(400).json({ error: "Missing channel." });
  }
  if (!Array.isArray(ordered_ids) || ordered_ids.some((v) => typeof v !== "string")) {
    return res.status(400).json({ error: "Invalid order." });
  }

  const { data: channel, error: chanError } = await supabase
    .from("channels")
    .select("id, created_by")
    .eq("id", channel_id)
    .eq("archive_id", archive)
    .is("archived_at", null)
    .maybeSingle();

  if (chanError) return fail(res, 500, "The order could not be saved.", chanError);
  if (!channel) return res.status(404).json({ error: "Channel not found." });

  if (req.profile!.role !== "admin" && channel.created_by !== req.profile!.personId) {
    return res.status(403).json({ error: "This channel is not yours." });
  }

  const { data: existing, error: listError } = await supabase
    .from("media_files")
    .select("id")
    .eq("channel_id", channel_id)
    .eq("archive_id", archive)
    .is("archived_at", null);

  if (listError) return fail(res, 500, "The order could not be saved.", listError);

  const live = new Set((existing ?? []).map((m) => m.id));
  const sameSet =
    live.size === ordered_ids.length && ordered_ids.every((id: string) => live.has(id));
  if (!sameSet) {
    return res.status(409).json({
      error: "The list no longer matches the channel. Reload the page.",
    });
  }

  for (const [index, id] of ordered_ids.entries()) {
    const { error } = await supabase
      .from("media_files")
      .update({ display_order: index })
      .eq("id", id)
      .eq("archive_id", archive);
    if (error) return fail(res, 500, "The order could not be saved.", error);
  }

  res.json({ count: ordered_ids.length });
});

/**
 * A photo's own words. Follows the channel's edit rights, like every other
 * change to its contents.
 */
mediaFilesRouter.patch("/:id", requireRole(CAN_WRITE_CONTENT), async (req, res) => {
  const { caption, taken_on, taken_precision, place, people } = req.body ?? {};

  if (caption !== undefined && typeof caption !== "string" && caption !== null) {
    return res.status(400).json({ error: "Invalid description." });
  }
  if (typeof caption === "string" && caption.length > 200) {
    return res.status(400).json({ error: "Descriptions are limited to 200 characters." });
  }
  // Both are optional and both can be cleared: `place: null` means "no place
  // any more", `people: []` means "nobody in it any more". Undefined leaves
  // them exactly as they were, which is what every other field here does.
  if (place !== undefined && place !== null && typeof place !== "string") {
    return res.status(400).json({ error: "Invalid place." });
  }
  if (typeof place === "string" && place.trim().length > 80) {
    return res.status(400).json({ error: "A place name is limited to 80 characters." });
  }
  if (people !== undefined && (!Array.isArray(people) || people.some((v) => typeof v !== "string"))) {
    return res.status(400).json({ error: "Invalid people." });
  }

  const archive = requireArchive(req, res);
  if (!archive) return;

  const { data: row, error: findError } = await supabase
    .from("media_files")
    .select("id, channel_id, channels(created_by)")
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .is("archived_at", null)
    .maybeSingle();

  if (findError) return fail(res, 500, "The description could not be saved.", findError);
  if (!row) return res.status(404).json({ error: "Media not found." });

  const owner = (row as unknown as { channels: { created_by: string | null } | null }).channels
    ?.created_by;
  if (req.profile!.role !== "admin" && owner !== req.profile!.personId) {
    return res.status(403).json({ error: "This channel is not yours." });
  }

  let placeId: string | null = null;
  if (place !== undefined) {
    try {
      placeId = await resolvePlace(archive, place, req.profile?.personId ?? null);
    } catch (err) {
      return fail(res, 500, "The place could not be saved.", err);
    }
  }

  const { error } = await supabase
    .from("media_files")
    .update({
      ...(caption !== undefined && { caption: caption?.trim() || null }),
      ...(place !== undefined && { place_id: placeId }),
      ...(taken_on !== undefined && {
        taken_on: /^\d{4}-\d{2}-\d{2}$/.test(String(taken_on ?? "")) ? taken_on : null,
        // The two columns are one fact: a date can never be written without
        // saying how much of it is real.
        taken_precision: /^\d{4}-\d{2}-\d{2}$/.test(String(taken_on ?? ""))
          ? precisionOf(taken_precision)
          : null,
      }),
    })
    .eq("id", req.params.id)
    .eq("archive_id", archive);

  if (error) return fail(res, 500, "The description could not be saved.", error);

  if (people !== undefined) {
    try {
      await setMediaPeople(archive, req.params.id as string, people as string[], req.profile?.personId ?? null);
    } catch (err) {
      return fail(res, 500, "The people could not be saved.", err);
    }
  }

  void evaluateChannel(row.channel_id, archive);
  res.status(204).end();
});

/**
 * Removing a photo is part of editing its channel, so it follows edit rights:
 * an admin may touch any channel, a co_author only their own. It archives
 * rather than destroys — the file stays and the row keeps its order.
 */
mediaFilesRouter.delete("/:id", requireRole(CAN_WRITE_CONTENT), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;

  const { data: row, error: findError } = await supabase
    .from("media_files")
    .select("id, channel_id, channels(created_by)")
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .is("archived_at", null)
    .maybeSingle();

  if (findError) return fail(res, 500, "The media could not be archived.", findError);
  if (!row) return res.status(404).json({ error: "Media not found." });

  const owner = (row as unknown as { channels: { created_by: string | null } | null }).channels
    ?.created_by;
  if (req.profile!.role !== "admin" && owner !== req.profile!.personId) {
    return res.status(403).json({ error: "This channel is not yours." });
  }

  const { error } = await supabase
    .from("media_files")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("archive_id", archive);

  if (error) return fail(res, 500, "The media could not be archived.", error);

  logActivity(req.profile, "media_removed", `${actorName(req.profile)} removed a file`, row.channel_id);
  void evaluateChannel(row.channel_id, archive);
  res.status(204).end();
});


/**
 * The bin's Files half (M127): every archived file of this archive, newest
 * removal first, with the channel it would return to. Lives at the tier of
 * the page that shows it — Recently deleted is an admin's room. The browser
 * gets a backend media URL, never a storage path.
 */
mediaFilesRouter.get("/archived/list", requireRole(CAN_DELETE), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;

  const { data, error } = await supabase
    .from("media_files")
    .select(
      "id, channel_id, file_type, caption, display_order, archived_at, channel:channels!media_files_channel_id_fkey(id, number, title)"
    )
    .eq("archive_id", archive)
    .not("archived_at", "is", null)
    .order("archived_at", { ascending: false });

  if (error) return fail(res, 500, "The archived files could not be loaded.", error);

  res.json(
    (data ?? []).map((m) => {
      const embed = (m as unknown as { channel?: { id: string; number: number; title: string } | { id: string; number: number; title: string }[] | null }).channel;
      const channel = Array.isArray(embed) ? (embed[0] ?? null) : (embed ?? null);
      return {
        id: m.id,
        file_type: m.file_type,
        caption: m.caption ?? null,
        display_order: m.display_order,
        archived_at: m.archived_at,
        channel: channel ? { id: channel.id, number: channel.number, title: channel.title } : null,
        // Absolute, like every other media URL the browser is handed — the
        // storage path itself never leaves the server.
        url: `${env.publicUrl}/api/media/${m.id}/file`,
      };
    })
  );
});

/**
 * The door the remove's confirm has always promised (M127). Restoring is
 * part of editing the channel, exactly like removing: an admin may touch any
 * channel, a co-author only their own — the same rights, walked backwards.
 * Only a file actually in the bin comes back through it, and never by id
 * alone: the archive scopes both the find and the write.
 */
mediaFilesRouter.post("/:id/restore", requireRole(CAN_WRITE_CONTENT), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;

  const { data: row, error: findError } = await supabase
    .from("media_files")
    .select("id, channel_id, channels(created_by)")
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .not("archived_at", "is", null)
    .maybeSingle();

  if (findError) return fail(res, 500, "The media could not be restored.", findError);
  if (!row) return res.status(404).json({ error: "Media not found." });

  const owner = (row as unknown as { channels: { created_by: string | null } | null }).channels
    ?.created_by;
  if (req.profile!.role !== "admin" && owner !== req.profile!.personId) {
    return res.status(403).json({ error: "This channel is not yours." });
  }

  const { error } = await supabase
    .from("media_files")
    .update({ archived_at: null })
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .not("archived_at", "is", null);

  if (error) return fail(res, 500, "The media could not be restored.", error);

  logActivity(req.profile, "media_restored", `${actorName(req.profile)} restored a file`, row.channel_id);
  void evaluateChannel(row.channel_id, archive);
  res.status(204).end();
});
