import { randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import heicConvert from "heic-convert";
import { supabase } from "../config/supabase.js";

export const CHANNEL_MEDIA_BUCKET = "channel-media";
export const PROFILE_PICTURES_BUCKET = "profile-pictures";

const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const ALLOWED_VIDEO_MIME = new Set(["video/mp4", "video/quicktime", "video/webm"]);
/*
  What a voice message arrives as. `audio/mpeg` is an mp3, `audio/mp4` an
  m4a, and the ogg pair is what Firefox's recorder writes. Chrome's recorder
  is the awkward one — see the container note in `verifyFile`.
*/
const ALLOWED_AUDIO_MIME = new Set([
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/ogg",
  "audio/opus",
  "audio/wav",
  "audio/vnd.wave",
]);

/**
 * Formats that are accepted but cannot be stored as they arrive.
 *
 * HEIC is what an iPhone and macOS Photos produce by default, so refusing it
 * refuses most of the camera roll — but no browser renders it, so keeping the
 * original would put a file on her screen that shows nothing. It is converted
 * on arrival instead, and JPEG is what gets stored.
 */
const CONVERT_TO_JPEG_MIME = new Set(["image/heic", "image/heif"]);

/** Visually lossless at photograph sizes, and roughly a third of the bytes. */
const JPEG_QUALITY = 0.92;

export interface VerifiedFile {
  buffer: Buffer;
  mime: string;
  extension: string;
  kind: "image" | "video" | "audio";
}

/**
 * Determines the real type from the file's magic bytes. The client-supplied
 * mimetype and filename are never trusted, so a renamed executable or an SVG
 * carrying script content cannot slip through.
 *
 * A HEIC photograph is converted to JPEG here rather than in each route, so
 * every path that accepts a file — channel media, profile photos, step images
 * — gets the same treatment and stores something a browser can draw.
 */
export async function verifyFile(
  buffer: Buffer,
  allow: "image" | "media" | "voice"
): Promise<VerifiedFile | null> {
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected) return null;

  if (CONVERT_TO_JPEG_MIME.has(detected.mime)) {
    try {
      // Decoding holds the bitmap in memory alongside the original, so this
      // roughly triples peak usage for the file being converted. The upload
      // limits (50 MB each, 20 at a time) are what keep that bounded.
      const jpeg = await heicConvert({
        buffer: new Uint8Array(buffer),
        format: "JPEG",
        quality: JPEG_QUALITY,
      });

      return {
        buffer: Buffer.from(jpeg),
        mime: "image/jpeg",
        extension: "jpg",
        kind: "image",
      };
    } catch (err) {
      // A file that says HEIC and will not decode is not a photograph we can
      // show, whatever it is. Refused like any other unsupported file.
      console.error("[media] HEIC could not be converted", err);
      return null;
    }
  }

  const isImage = ALLOWED_IMAGE_MIME.has(detected.mime);
  const isVideo = allow === "media" && ALLOWED_VIDEO_MIME.has(detected.mime);
  const isAudio = allow === "voice" && ALLOWED_AUDIO_MIME.has(detected.mime);

  /*
    The container problem, stated rather than papered over. Chrome's
    MediaRecorder writes audio-only recordings into a WebM container, and
    WebM's magic bytes (EBML) are IDENTICAL whether the file holds a voice or
    a film — the difference is in the track list, not the header. So in
    "voice" mode the two container formats a recorder can produce are
    accepted and classified as audio.

    What this does NOT weaken: the magic bytes still decide the container
    allowlist — a renamed executable is refused exactly as before. And
    "voice" mode is only reachable for a channel whose content_type is
    `stories`, which is authenticated admin input. The worst mislabel is a
    video stored as `audio` on a voice channel, where the display's <audio>
    element plays its soundtrack — degraded, not dangerous.
  */
  const isRecorderContainer =
    allow === "voice" && (detected.mime === "video/webm" || detected.mime === "video/mp4");

  if (!isImage && !isVideo && !isAudio && !isRecorderContainer) return null;

  return {
    buffer,
    mime: detected.mime,
    extension: detected.ext,
    kind: isAudio || isRecorderContainer ? "audio" : isVideo ? "video" : "image",
  };
}

export function buildStoragePath(prefix: string, extension: string): string {
  return `${prefix}/${randomUUID()}.${extension}`;
}

export async function uploadToBucket(
  bucket: string,
  path: string,
  file: VerifiedFile
): Promise<void> {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file.buffer, { contentType: file.mime });

  if (error) throw new Error(`Upload failed: ${error.message}`);
}

export async function removeFromBucket(bucket: string, paths: string[]): Promise<void> {
  if (!paths.length) return;
  const { error } = await supabase.storage.from(bucket).remove(paths);
  if (error) throw new Error(`Storage delete failed: ${error.message}`);
}

/*
 * There is no signed-URL helper here any more, on purpose. Buckets are
 * private and every file is streamed through a backend route (routes/media.ts,
 * the owner's print photo in routes/owner.ts): archive-scoped, behind the
 * guards, revocable. A Supabase signed URL is a bearer link into storage that
 * carries the project ref and outlives every revocation (M165, F60; the last
 * caller went with the 29 Sep review, secrets-3).
 */
