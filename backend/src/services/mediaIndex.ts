import { readSnapshot, saveSnapshot } from "./snapshot.js";

/**
 * Remembers which file each media id points at, and whose it is.
 *
 * The bytes being on disk is not enough to serve them: the route still has to
 * turn an id into a storage path, and that lookup lives in Supabase. Offline
 * that lookup fails and a perfectly good cached photo would 503. This keeps a
 * local copy of the mapping so the cache is actually reachable.
 *
 * The archive is part of the entry, not a detail. Online, the database answers
 * "whose file is this?" — offline there is nothing else to ask, so the index
 * has to have written it down at the time the file was first served. An index
 * without it can only answer "does this id exist", and answering that to any
 * device that asks is how one family's photograph reaches another's screen
 * during an outage, when nobody is watching.
 *
 * A path is immutable — a media id always refers to the same object — so an
 * entry is never rewritten, only tombstoned when the memory is deleted.
 */

type Entry = { bucket: string; path: string; archive: string; deleted?: true };
type Index = Record<string, Entry>;

/**
 * v2 carries the archive. Entries written by v1 cannot be upgraded — nothing
 * records whose they were, and guessing is the exact failure this exists to
 * prevent — so the old file is simply not read. The index is a cache; it costs
 * a rebuild and nothing else.
 */
const SNAPSHOT = "media-index-v2";

let cache: Index | null = null;
let writeScheduled = false;

async function load(): Promise<Index> {
  if (cache) return cache;
  const stored = await readSnapshot<Index>(SNAPSHOT);
  cache = stored?.data ?? {};
  return cache;
}

/** Batches writes: prefetch adds hundreds of entries in a tight loop. */
function scheduleWrite() {
  if (writeScheduled) return;
  writeScheduled = true;

  setTimeout(() => {
    writeScheduled = false;
    if (cache) void saveSnapshot(SNAPSHOT, cache);
  }, 1000).unref?.();
}

export async function rememberMedia(
  id: string,
  bucket: string,
  path: string,
  archive: string
): Promise<void> {
  const index = await load();
  const existing = index[id];
  if (existing && existing.path === path && existing.archive === archive && !existing.deleted) {
    return;
  }

  index[id] = { bucket, path, archive };
  scheduleWrite();
}

/**
 * Resolves an id for one archive. A mismatch answers exactly as a missing
 * entry does — the caller learns nothing about what belongs to anyone else.
 */
export async function lookupMedia(id: string, archive: string | null): Promise<Entry | null> {
  if (!archive) return null;

  const entry = (await load())[id];
  if (!entry || entry.deleted) return null;
  if (entry.archive !== archive) return null;

  return entry;
}

/**
 * Marks an id as gone. Called when a memory is permanently deleted.
 *
 * A tombstone rather than a removal: deletion and an in-flight offline request
 * can overlap, and a removed key is indistinguishable from one this machine
 * never cached — which would let the entry be written again by the very
 * request that was racing the deletion.
 */
export async function forgetMedia(id: string): Promise<Entry | null> {
  const index = await load();
  const entry = index[id] ?? null;

  if (entry && !entry.deleted) {
    index[id] = { ...entry, deleted: true };
    scheduleWrite();
  }

  return entry;
}
