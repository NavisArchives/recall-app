import sharp from "sharp";

/**
 * The hot cache — bounded RAM for the pictures being looked at right now.
 *
 * Why this exists: `openMedia` deliberately keeps NO durable copy on an api
 * process (a shared server mirroring families' photographs onto its own disk
 * would be an uncontrolled second copy of the product — mediaCache.ts's
 * boundary, which stands). The cost of that boundary, measured on 6 Sep:
 * every image request was a full Supabase round trip, 330–630ms for a 60KB
 * file, cache=miss on the second request as much as the first. A grid of
 * twelve photographs paid it twelve times, every page view, for every viewer.
 *
 * What this is NOT: a mirror. Entries are small (≤2MB), few (64MB total),
 * short-lived (10 minutes), and evicted least-recently-used — the working
 * set of what is on screens right now, gone when attention moves on. Nothing
 * durable, nothing enumerable, nothing that outlives the process.
 *
 * It also coalesces: ten viewers opening the same channel used to mean ten
 * identical Supabase fetches in flight at once. Now the first fetch is
 * shared and nine wait on it.
 */

const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY_BYTES = 2 * 1024 * 1024;
const TTL_MS = 10 * 60 * 1000;

interface Entry {
  bytes: Buffer;
  at: number;
}

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<Buffer | null>>();
let totalBytes = 0;

function evictUntilFits(incoming: number): void {
  const deadline = Date.now() - TTL_MS;
  // Map iteration order is insertion order; re-set on hit makes this LRU.
  for (const [key, entry] of cache) {
    if (totalBytes + incoming <= MAX_TOTAL_BYTES && entry.at >= deadline) break;
    cache.delete(key);
    totalBytes -= entry.bytes.length;
  }
}

export function hotGet(key: string): Buffer | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > TTL_MS) {
    cache.delete(key);
    totalBytes -= entry.bytes.length;
    return null;
  }
  // Re-insert so iteration order stays least-recent-first.
  cache.delete(key);
  cache.set(key, entry);
  return entry.bytes;
}

export function hotPut(key: string, bytes: Buffer): void {
  if (bytes.length > MAX_ENTRY_BYTES) return;
  const existing = cache.get(key);
  if (existing) totalBytes -= existing.bytes.length;
  evictUntilFits(bytes.length);
  cache.set(key, { bytes, at: Date.now() });
  totalBytes += bytes.length;
}

/**
 * One fetch per key, however many arrive at once. The loader runs for the
 * first caller; everyone else gets the same promise.
 */
export function coalesce(key: string, loader: () => Promise<Buffer | null>): Promise<Buffer | null> {
  const running = inFlight.get(key);
  if (running) return running;
  const p = loader().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

/**
 * The widths a thumbnail may be — a closed list, because the cache key
 * includes the width and an open parameter would let one client mint one
 * cache entry per pixel value.
 */
export const THUMB_WIDTHS = new Set([320, 640, 1280]);

/**
 * A resized JPEG of an image, for the grids.
 *
 * The structural half of "pictures load slow": a shelf tile is 200px wide
 * and was being fed the original — fine for the drawn fixtures at 60KB,
 * brutal for a real family's 4MB phone photograph. `rotate()` with no
 * arguments applies the EXIF orientation, which phone photos rely on.
 */
export async function resizeImage(bytes: Buffer, width: number): Promise<Buffer> {
  return sharp(bytes)
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
}

export function hotStats(): { entries: number; bytes: number } {
  return { entries: cache.size, bytes: totalBytes };
}
