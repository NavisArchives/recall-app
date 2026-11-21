import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, stat, unlink, utimes } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { env } from "../config/env.js";

/**
 * On-disk cache of the media files.
 *
 * The display sits in Margaret's living room and has to keep working when the
 * internet does not. Because it runs the backend on the same machine, caching
 * here is enough: a photo fetched once is served from disk from then on, with
 * no round trip and no dependency on Supabase being reachable.
 *
 * Caching the bytes rather than the link is what makes this work — signed URLs
 * expire after an hour, so a cached URL would break. Storage paths are
 * server-generated UUIDs that are never reused, so a cached file can never go
 * stale and needs no invalidation.
 */

const CACHE_DIR = path.resolve(process.cwd(), ".cache/media");
const MAX_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

/** Flat filename from the storage path, so nested paths need no directories. */
function cacheKey(bucket: string, storagePath: string): string {
  const hash = createHash("sha256").update(`${bucket}/${storagePath}`).digest("hex");
  const extension = path.extname(storagePath) || "";
  return `${hash}${extension}`;
}

async function ensureDir() {
  await mkdir(CACHE_DIR, { recursive: true });
}

export interface OpenedMedia {
  /** Piped straight to the response — the bytes never gather in one place. */
  stream: Readable;
  /** Known for a cached file and for a download; omitted when it is not. */
  size?: number;
  fromCache: boolean;
}

/*
 * On the concurrency ceiling that is deliberately *not* here.
 *
 * A draft of this file queued downloads behind a semaphore, on the theory
 * that simultaneous videos pressure the process. Streaming is what actually
 * removes that pressure: a download in flight now holds one chunk, not one
 * file, so twenty at once cost twenty socket buffers rather than a gigabyte.
 * With the memory argument gone, the ceiling only bought a new failure —
 * slots are given back when a stream closes, so a handful of clients that
 * stall mid-file (a phone that slept, a tab left open on a train) would hold
 * every slot and wedge the door for everyone behind them, including her
 * screen on a cache miss. A bound whose worst case is "no photographs at all"
 * is a worse bound than none.
 *
 * The real ceiling for a fleet belongs at the gateway, with the shared rate
 * limiter — the same place, for the same reason: per-process counters cannot
 * see the fleet, and a wedged process cannot be reasoned with from inside.
 */

/**
 * Fetches an object as a genuine byte stream.
 *
 * Not `supabase.storage.download()`, deliberately. That returns a `Blob`,
 * and a Blob is the whole body already in memory — calling `.stream()` on one
 * only re-reads what has been buffered. Measured against real storage, a
 * 1.5 MB photograph arrived as a single 1.5 MB chunk, which is the buffering
 * this was supposed to remove wearing a stream's clothes.
 *
 * The storage REST endpoint hands back a real `ReadableStream`, so the bytes
 * cross the process a chunk at a time and a 50 MB video costs a chunk rather
 * than 50 MB. The service key never leaves the server; this is the same
 * credential the SDK sends, on the same host.
 */
async function fetchObject(
  bucket: string,
  storagePath: string
): Promise<{ stream: Readable; size?: number } | null> {
  const encoded = storagePath.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(
    `${env.supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encoded}`,
    {
      headers: {
        apikey: env.supabaseServiceRoleKey,
        Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
      },
    }
  );

  if (!res.ok || !res.body) {
    // A missing object is not an outage, and storage answers for it with both
    // 404 and 400 — neither is worth a line in the log, because a deleted
    // photograph is an ordinary thing. Anything else is the server having a
    // problem, and that is worth saying out loud.
    if (res.status !== 404 && res.status !== 400) {
      console.error("[cache] storage refused", storagePath, res.status);
    }
    return null;
  }

  const declared = Number(res.headers.get("content-length"));
  return {
    stream: Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
    size: Number.isFinite(declared) && declared > 0 ? declared : undefined,
  };
}

/**
 * Opens the file for reading, from disk when possible and from storage when
 * not. A download failure while a cached copy exists is not an error: that is
 * exactly the offline case this exists for.
 *
 * **Nothing is buffered whole.** This used to return a `Buffer`, so every
 * request for a 50 MB video briefly put 50 MB in the process — and a handful
 * of simultaneous viewers put a handful of those there together, on the
 * machine that also has to keep a screen alive in a living room. Bytes now
 * travel as a stream from disk or from storage to the socket, and the only
 * thing held is a chunk at a time.
 */
export async function openMedia(bucket: string, storagePath: string): Promise<OpenedMedia | null> {
  /*
   * Only a kiosk keeps bytes (the same line env.ts draws for prefetch).
   *
   * The cache exists because Margaret's machine runs this backend in her
   * own living room, and her family's photographs on her own disk is the
   * offline story working as designed. A shared `api` process serves every
   * family, and the same code there quietly accumulated up to 5 GB of
   * customers' media on whatever disk the server happened to have — an
   * on-demand mirror of the product, with none of the storage bucket's
   * access control. So an api process streams through and retains nothing;
   * only a machine that has said "I am a kiosk, and whose" caches.
   */
  if (env.role !== "kiosk") {
    try {
      const object = await fetchObject(bucket, storagePath);
      return object ? { ...object, fromCache: false } : null;
    } catch (err) {
      console.error("[cache] could not open", storagePath, err);
      return null;
    }
  }

  await ensureDir();
  const file = path.join(CACHE_DIR, cacheKey(bucket, storagePath));

  try {
    const info = await stat(file);
    // Touch it so eviction can tell what is actually being looked at.
    const now = new Date();
    void utimes(file, now, now).catch(() => {});
    return { stream: createReadStream(file), size: info.size, fromCache: true };
  } catch {
    // Not cached yet — fall through and fetch it.
  }

  if (!(await downloadToCache(bucket, storagePath, file))) return null;

  try {
    const info = await stat(file);
    return { stream: createReadStream(file), size: info.size, fromCache: false };
  } catch {
    return null;
  }
}

/**
 * Fetches one file into the cache, streaming it to disk. Returns whether the
 * file is now on disk.
 *
 * Written to a temporary name first so a crash mid-write cannot leave a
 * truncated file that would then be served as if it were whole.
 */
async function downloadToCache(
  bucket: string,
  storagePath: string,
  file: string
): Promise<boolean> {
  const temporary = `${file}.${process.pid}.${Math.floor(performance.now())}.tmp`;
  try {
    const object = await fetchObject(bucket, storagePath);
    if (!object) return false;

    await pipeline(object.stream, createWriteStream(temporary));
    await rename(temporary, file);
    void evictIfOverBudget().catch(() => {});
    return true;
  } catch (err) {
    console.error("[cache] could not store", storagePath, err);
    await unlink(temporary).catch(() => {});
    return false;
  }
}

/**
 * Warms the cache without handing the bytes back — what the prefetcher wants.
 * It only ever asked "did this arrive?", and returning a whole file to answer
 * a yes/no was how a background job came to hold photographs in memory.
 */
export async function warmMedia(bucket: string, storagePath: string): Promise<boolean> {
  if (env.role !== "kiosk") return false;
  await ensureDir();
  const file = path.join(CACHE_DIR, cacheKey(bucket, storagePath));
  return downloadToCache(bucket, storagePath, file);
}

/**
 * Removes one file from this machine. Permanent deletion has to reach here:
 * the object can be gone from storage and the row gone from the database, and
 * a copy on this disk would still answer the next request for it.
 */
export async function purgeMedia(bucket: string, storagePath: string): Promise<void> {
  await unlink(path.join(CACHE_DIR, cacheKey(bucket, storagePath))).catch(() => {});
}

/** Drops the least recently read files until the cache is back under budget. */
export async function evictIfOverBudget(): Promise<void> {
  await ensureDir();
  const names = await readdir(CACHE_DIR);

  const files = [];
  let total = 0;

  for (const name of names) {
    if (name.endsWith(".tmp")) continue;
    const full = path.join(CACHE_DIR, name);
    try {
      const info = await stat(full);
      files.push({ full, size: info.size, atime: info.atimeMs });
      total += info.size;
    } catch {
      // Vanished underneath us; nothing to account for.
    }
  }

  if (total <= MAX_BYTES) return;

  files.sort((a, b) => a.atime - b.atime);

  for (const file of files) {
    if (total <= MAX_BYTES) break;
    try {
      await unlink(file.full);
      total -= file.size;
    } catch {
      // Already gone.
    }
  }
}

export async function cacheStats(): Promise<{ files: number; bytes: number; maxBytes: number }> {
  await ensureDir();
  const names = await readdir(CACHE_DIR);

  let bytes = 0;
  let files = 0;

  for (const name of names) {
    if (name.endsWith(".tmp")) continue;
    try {
      bytes += (await stat(path.join(CACHE_DIR, name))).size;
      files += 1;
    } catch {
      // Ignore.
    }
  }

  return { files, bytes, maxBytes: MAX_BYTES };
}

/** True when the file is already on disk, without fetching it. */
export async function isCached(bucket: string, storagePath: string): Promise<boolean> {
  try {
    await stat(path.join(CACHE_DIR, cacheKey(bucket, storagePath)));
    return true;
  } catch {
    return false;
  }
}
