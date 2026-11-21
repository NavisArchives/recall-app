import { supabase } from "../config/supabase.js";
import { CHANNEL_MEDIA_BUCKET, PROFILE_PICTURES_BUCKET } from "./media.js";
import { warmMedia, isCached, cacheStats } from "./mediaCache.js";
import { rememberMedia } from "./mediaIndex.js";

/**
 * Pulls one archive's media down in the background, so the display never waits.
 *
 * Without this, the first person to open a channel after new photos are added
 * waits for the download. Margaret should never be the one waiting, so the
 * machine fetches quietly while nobody is looking.
 *
 * It is bound to a single archive, and that is not a detail. This was written
 * for a kiosk in one family's living room, where holding that family's
 * photographs on the local disk is exactly right. Run unbound on a shared
 * server it means something else entirely: every replica downloading every
 * customer's private media, startup that grows with the customer list, and a
 * local cache that is a mirror of the whole product. One machine, one family.
 *
 * Deliberately slow and sequential: this must never compete with somebody
 * actually using the app, and there is no deadline.
 */

const PAUSE_BETWEEN_FILES_MS = 250;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function prefetchMedia(archive: string): Promise<void> {
  if (!archive) throw new Error("prefetchMedia requires an archive");

  try {
    const [{ data: media }, { data: people }] = await Promise.all([
      supabase
        .from("media_files")
        .select("id, storage_path")
        .eq("archive_id", archive)
        .is("archived_at", null),
      supabase
        .from("people")
        .select("id, profile_picture_path")
        .eq("archive_id", archive)
        .is("archived_at", null),
    ]);

    const wanted: Array<[string, string]> = [];

    // Record the id -> file mapping as we go, so these stay reachable when
    // Supabase cannot be asked which file an id refers to.
    for (const row of media ?? []) {
      await rememberMedia(row.id, CHANNEL_MEDIA_BUCKET, row.storage_path, archive);
      wanted.push([CHANNEL_MEDIA_BUCKET, row.storage_path]);
    }
    for (const row of people ?? []) {
      if (!row.profile_picture_path) continue;
      await rememberMedia(row.id, PROFILE_PICTURES_BUCKET, row.profile_picture_path, archive);
      wanted.push([PROFILE_PICTURES_BUCKET, row.profile_picture_path]);
    }

    let fetched = 0;
    let failed = 0;

    for (const [bucket, storagePath] of wanted) {
      if (await isCached(bucket, storagePath)) continue;

      const result = await warmMedia(bucket, storagePath);
      if (result) fetched += 1;
      else failed += 1;

      await sleep(PAUSE_BETWEEN_FILES_MS);
    }

    const stats = await cacheStats();
    const megabytes = (stats.bytes / 1024 / 1024).toFixed(0);

    if (fetched || failed) {
      console.log(
        `[prefetch] downloaded ${fetched}, failed ${failed}. Cache: ${stats.files} files, ${megabytes} MB.`
      );
    } else {
      console.log(`[prefetch] already complete. Cache: ${stats.files} files, ${megabytes} MB.`);
    }
  } catch (err) {
    // Offline at boot is a normal state, not a failure: whatever is already
    // cached still serves, and the next start will catch up.
    console.warn(
      "[prefetch] skipped —",
      err instanceof Error ? err.message : String(err)
    );
  }
}
