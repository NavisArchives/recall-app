import { Router } from "express";
import { supabase } from "../config/supabase.js";
import { requireDevice, requireDeviceOrChooser, requireRole, archiveOf, actingProfile } from "../middleware/auth.js";
import { CAN_MANAGE_PEOPLE } from "../services/accessCodes.js";
import { CHANNEL_MEDIA_BUCKET, PROFILE_PICTURES_BUCKET } from "../services/media.js";
import { openMedia, cacheStats } from "../services/mediaCache.js";
import { hotGet, hotPut, coalesce, resizeImage, THUMB_WIDTHS } from "../services/mediaHotCache.js";
import { rememberMedia, lookupMedia } from "../services/mediaIndex.js";
import { mayReadChannel } from "../services/channelVisibility.js";

export const mediaRouter = Router();

const RESOLVE_TTL_MS = 5 * 60 * 1000;
const resolveMemo = new Map<string, { path: string; at: number }>();

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  /*
    The voice formats (051). Without these a recording served as
    application/octet-stream — Chrome shrugs and plays it, Safari can refuse
    to, and the difference would surface as "the voice message works on the
    laptop and not on the iPad", which is the worst kind of bug report.
    Found by the night sweep, not by a browser, which is the reason the
    sweep exists.
  */
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".wav": "audio/wav",
};

function contentTypeFor(storagePath: string): string {
  const dot = storagePath.lastIndexOf(".");
  const extension = dot === -1 ? "" : storagePath.slice(dot).toLowerCase();
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}

/**
 * Finds which file an id refers to, asking Supabase first and falling back to
 * the local index. Without the fallback a cached photo would still fail
 * offline, because resolving the id is itself a database read.
 */
async function resolve(
  id: string,
  table: string,
  column: string,
  bucket: string,
  archive: string | null
): Promise<{ bucket: string; path: string } | null> {
  /*
   * A caller with no archive resolves nothing (M152 / F50).
   *
   * The platform owner's session carries a null archive by design — its
   * family owns none — and by rule it reaches no family's content. Without
   * this line the query below scoped by id alone whenever the archive was
   * null, so `/api/media/person/:id/photo` served any household's face to
   * that one credential. The sibling `lookupMedia` already opens this way;
   * the two resolvers agreeing is the fix. Refusing here rather than at the
   * route guards every caller of `resolve()`, present and future, and the
   * null answer is the same 404 a genuinely missing id gets — no oracle.
   */
  if (!archive) return null;

  /*
    The last ~150ms of every image request was this database round trip,
    repeated for a path that cannot change (storage paths are written once;
    replacing a photo is a new row). Memoized per (table, id, ARCHIVE) — the
    archive is in the key, so a cached answer can never cross a tenancy
    boundary — for five minutes, positives only: a deletion stops serving
    within the memo window, which is already inside the hour the browser is
    allowed to keep showing it.
  */
  const memoKey = `${table}:${id}:${archive}`;
  const memoised = resolveMemo.get(memoKey);
  if (memoised && Date.now() - memoised.at < RESOLVE_TTL_MS) {
    return { bucket, path: memoised.path };
  }

  const query = supabase.from(table).select(column).eq("id", id).eq("archive_id", archive);

  const { data, error } = await query.maybeSingle();

  const path = (data as Record<string, string | null> | null)?.[column];

  if (!error && path) {
    // Only recorded once the database has confirmed whose it is. Without an
    // archive there is nothing to record, and an unattributed entry is one the
    // fallback could hand to anybody.
    if (archive) void rememberMedia(id, bucket, path, archive);
    resolveMemo.set(memoKey, { path, at: Date.now() });
    if (resolveMemo.size > 5000) {
      // Oldest-first sweep; 5000 entries of a string each is a few hundred KB.
      const cutoff = Date.now() - RESOLVE_TTL_MS;
      for (const [k, v] of resolveMemo) {
        if (v.at >= cutoff && resolveMemo.size <= 4000) break;
        resolveMemo.delete(k);
      }
    }
    return { bucket, path };
  }

  // The fallback exists for one case only: the database could not be reached,
  // and a photograph already on this disk should still reach her screen.
  //
  // It must never cover the other case. A reachable database that has no such
  // row is not an outage — it is a deletion, and answering it from a local
  // index would keep serving a family's photograph after they removed it.
  if (!error) return null;

  return lookupMedia(id, archive);
}

/**
 * Serves a media file through this backend rather than a signed Supabase URL.
 *
 * The bytes are cached on disk, so the display keeps working with no internet
 * and pages load without a round trip.
 *
 * These are private family photographs, so the response is marked private —
 * never storable by a shared cache — and kept for an hour rather than a year.
 * A path is immutable, but permission to see it is not: an hour bounds how
 * long a browser can keep showing something the family has since deleted.
 */
async function serve(
  res: import("express").Response,
  found: { bucket: string; path: string } | null,
  width?: number
) {
  if (!found) return res.status(404).json({ error: "Media not found." });

  const type = contentTypeFor(found.path);

  /*
    The hot path (mediaHotCache.ts, measured 6 Sep: every request was a full
    330–630ms Supabase round trip, second request as much as the first).
    Small files and thumbnails answer from bounded RAM; concurrent requests
    for the same object share one upstream fetch. Videos and anything over
    the entry cap stream exactly as before.

    `width` only means anything for an image, and only from the closed list —
    an open pixel parameter would let one client mint unlimited cache keys.
  */
  const wantThumb = width !== undefined && type.startsWith("image/");
  const key = `${found.bucket}:${found.path}${wantThumb ? `:w${width}` : ""}`;

  const cached = hotGet(key);
  if (cached) {
    res.setHeader("Content-Type", wantThumb ? "image/jpeg" : type);
    res.setHeader("Cache-Control", "private, max-age=3600, must-revalidate");
    res.setHeader("X-Recall-Cache", "hot");
    res.setHeader("Content-Length", String(cached.length));
    return res.end(cached);
  }

  if (wantThumb) {
    const bytes = await coalesce(key, async () => {
      const original = await coalesce(`${found.bucket}:${found.path}`, async () => {
        const f = await openMedia(found.bucket, found.path);
        if (!f) return null;
        const chunks: Buffer[] = [];
        for await (const chunk of f.stream) chunks.push(chunk as Buffer);
        const whole = Buffer.concat(chunks);
        hotPut(`${found.bucket}:${found.path}`, whole);
        return whole;
      });
      if (!original) return null;
      try {
        const resized = await resizeImage(original, width!);
        hotPut(key, resized);
        return resized;
      } catch {
        /* An image sharp cannot decode is served whole — degraded, never a
           broken tile. */
        return original;
      }
    });
    if (!bytes) return res.status(503).json({ error: "Media unavailable." });
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=3600, must-revalidate");
    res.setHeader("X-Recall-Cache", "resized");
    res.setHeader("Content-Length", String(bytes.length));
    return res.end(bytes);
  }

  const file = await openMedia(found.bucket, found.path);
  if (!file) return res.status(503).json({ error: "Media unavailable." });

  /*
    Full-size images small enough for the entry cap are collected into RAM on
    the way through, so the next viewer skips the round trip. The buffering
    this route was rebuilt to avoid was UNBOUNDED buffering of videos; a
    ≤2MB image held briefly in a 64MB LRU is a different animal, and anything
    larger still streams chunk by chunk.
  */
  if (type.startsWith("image/") && file.size !== undefined && file.size <= 2 * 1024 * 1024 && !file.fromCache) {
    const chunks: Buffer[] = [];
    file.stream.on("data", (c) => chunks.push(c as Buffer));
    file.stream.on("end", () => hotPut(key, Buffer.concat(chunks)));
  }

  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "private, max-age=3600, must-revalidate");
  res.setHeader("X-Recall-Cache", file.fromCache ? "hit" : "miss");
  if (file.size !== undefined) res.setHeader("Content-Length", String(file.size));

  /*
   * Piped, not buffered. A 50 MB video used to become 50 MB of process memory
   * on its way out, once per viewer at the same time.
   *
   * Two failure modes to close, both after the headers have gone: the source
   * can die mid-file, and the viewer can navigate away. Once bytes are on the
   * wire there is no status code left to send, so the honest end is to drop
   * the connection — a truncated response the browser can detect — and to let
   * go of the read either way, because a stream nobody is draining holds its
   * slot open.
   */
  file.stream.on("error", (err) => {
    console.error("[media] stream failed mid-response:", err);
    res.destroy();
  });
  res.on("close", () => file.stream.destroy());

  file.stream.pipe(res);
}

// Every one of these needs a trusted installation. The display has one and no
// profile, so this is the guard that lets her screen work while still keeping
// the archive off the open internet.
mediaRouter.get("/:id/file", requireDevice, async (req, res) => {
  const archive = archiveOf(req);
  const profile = await actingProfile(req);
  const trustedDisplay = req.device?.isTrusted === true && !profile;

  // A trusted display must be able to use its local media index offline. Every
  // person-facing request, however, re-authorizes the media's parent channel
  // before either a memoized path or cached bytes can be served.
  if (!trustedDisplay) {
    if (!archive || !profile) return res.status(404).json({ error: "Media not found." });

    const { data: media, error: mediaError } = await supabase
      .from("media_files")
      .select("id, channel_id")
      .eq("id", req.params.id)
      .eq("archive_id", archive)
      .is("archived_at", null)
      .maybeSingle();
    if (mediaError) return res.status(503).json({ error: "Media unavailable." });
    if (!media?.channel_id) return res.status(404).json({ error: "Media not found." });

    const { data: channel, error: channelError } = await supabase
      .from("channels")
      .select("id, created_by, privacy_level")
      .eq("id", media.channel_id)
      .eq("archive_id", archive)
      .is("archived_at", null)
      .maybeSingle();
    if (channelError) return res.status(503).json({ error: "Media unavailable." });
    if (!channel || !(await mayReadChannel(archive, channel, profile, false))) {
      return res.status(404).json({ error: "Media not found." });
    }
  }

  const w = Number(req.query.w);
  const width = THUMB_WIDTHS.has(w) ? w : undefined;
  await serve(res, await resolve(req.params.id as string, "media_files", "storage_path", CHANNEL_MEDIA_BUCKET, archive), width);
});

/**
 * Profile photos, shown beside a memory and in the profile chooser.
 *
 * Chooser-stage on purpose: the family chooser draws these faces before any
 * PIN has been entered, and a face on the front door is what the password
 * alone is allowed to see. Still scoped to the session's own archive.
 */
mediaRouter.get("/person/:id/photo", requireDeviceOrChooser, async (req, res) => {
  await serve(
    res,
    await resolve(req.params.id as string, "people", "profile_picture_path", PROFILE_PICTURES_BUCKET, archiveOf(req))
  );
});

/**
 * The subject's own portrait, from her settings row.
 *
 * The offline twin of `resolve()`, for the one photo that lives on `settings`
 * rather than a row with an id (M173). M165 closed the signed-URL leak but
 * served this through a bare read, so her face — loaded on every kiosk page —
 * lost the local-cache fallback the rest of her screen has and would blank
 * during a Supabase outage, on the one screen the fallback exists for. This
 * caches the path under a namespaced key and reads it back when the database
 * cannot be reached, keeping the M152 posture: a null archive resolves
 * nothing, and a reachable-but-empty read is a deletion (serve nothing), not
 * an outage (serve the last known face).
 */
async function resolveSubjectPhoto(
  archive: string | null
): Promise<{ bucket: string; path: string } | null> {
  if (!archive) return null;
  // Namespaced so the archive id can never collide with a media id in the
  // shared offline index; `lookupMedia` still checks the archive matches.
  const key = `subject:${archive}`;

  const { data, error } = await supabase
    .from("settings")
    .select("photo_path")
    .eq("archive_id", archive)
    .maybeSingle();

  const path = (data as { photo_path?: string | null } | null)?.photo_path;
  if (!error && path) {
    void rememberMedia(key, PROFILE_PICTURES_BUCKET, path, archive);
    return { bucket: PROFILE_PICTURES_BUCKET, path };
  }
  // Reachable database, no photo: unset or removed — not an outage.
  if (!error) return null;

  const entry = await lookupMedia(key, archive);
  return entry ? { bucket: entry.bucket, path: entry.path } : null;
}

mediaRouter.get("/subject/photo", requireDeviceOrChooser, async (req, res) => {
  await serve(res, await resolveSubjectPhoto(archiveOf(req)));
});

/** Operational detail about this machine — an administrator's business. */
mediaRouter.get("/cache/stats", requireRole(CAN_MANAGE_PEOPLE), async (_req, res) => {
  res.json(await cacheStats());
});
