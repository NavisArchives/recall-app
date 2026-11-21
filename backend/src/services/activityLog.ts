import { supabase } from "../config/supabase.js";
import type { ProfileSession } from "../middleware/auth.js";

export type ActionType =
  | "channel_created"
  | "channel_edited"
  | "channel_deleted"
  | "channel_restored"
  | "channel_purged"
  | "media_added"
  | "media_removed"
  | "media_restored"
  | "contributor_added"
  | "contributor_edited"
  | "nfc_linked"
  | "nfc_unlinked"
  | "mission_completed"
  | "profile_edited"
  // 047 — a screen the family retired from Settings. No DB constraint backs
  // this column, so the union is the whole rule; adding one here is the
  // entire change.
  | "screen_retired"
  // Her word (054): who agrees to the archive, recorded or withdrawn.
  | "consent_recorded"
  | "consent_withdrawn"
  // 056: the trusted screen's renewal date was bumped from the workspace.
  | "screen_renewed"
  // 064: a profile locked again after repeated wrong PINs (authn-8).
  | "profile_locked";

/**
 * How close together two identical entries have to be to count as one event.
 *
 * Long enough to absorb a form saved three times while somebody fiddles with
 * it, short enough that genuinely doing the same thing again after a coffee
 * is still its own line in the family's history.
 */
const SAME_EVENT_WINDOW_MS = 2 * 60 * 1000;

/**
 * Writes one line of the archive's own history.
 *
 * Deliberately best-effort and never awaited for correctness: if the log
 * write fails, the action it describes has already happened and must still
 * succeed. A missing history line is a smaller harm than a refused upload.
 *
 * **The same fact is not written twice (M62).** Saving one form three times
 * is one event, and the sidebar was spending all three of its visible slots
 * saying "Anne updated Anne Fournier's profile" — the least informative thing
 * on the least-changing screen in the app. The duplicate is skipped at the
 * source rather than collapsed at render, so every reader of this log
 * benefits and the table does not quietly grow a hundred copies of one edit.
 */
export function logActivity(
  profile: ProfileSession | null | undefined,
  action_type: ActionType,
  description: string,
  target_channel_id?: string | null
): void {
  const archive_id = profile?.archiveId ?? null;

  void (async () => {
    try {
      /*
       * Scoped to the archive, like every other query.
       *
       * A global "most recent identical row" would let one family's edit
       * suppress another family's — two admins named Anne updating a profile
       * a minute apart, and the second family loses its history line.
       */
      let recent = supabase
        .from("activity_log")
        .select("id, description, created_at")
        .eq("action_type", action_type)
        .gte("created_at", new Date(Date.now() - SAME_EVENT_WINDOW_MS).toISOString())
        .order("created_at", { ascending: false })
        .limit(1);

      recent = archive_id
        ? recent.eq("archive_id", archive_id)
        : recent.is("archive_id", null);

      const { data: last, error: readError } = await recent.maybeSingle();

      // A hiccup reading must never cost the family the line itself: on
      // error we simply write, which is the behaviour this function had
      // before the dedup existed.
      if (!readError && last?.description === description) return;

      const { error } = await supabase.from("activity_log").insert({
        author_id: profile?.personId ?? null,
        action_type,
        description,
        target_channel_id: target_channel_id ?? null,
        // Which family's history this line belongs to.
        archive_id,
      });
      if (error) console.error("[activity] could not record:", error.message);
    } catch (err) {
      console.error("[activity] could not record:", err);
    }
  })();
}

/** "Andy created Channel 03 — Our wedding" reads better than a bare verb. */
export function actorName(profile: ProfileSession | null | undefined): string {
  return profile?.name?.split(" ")[0] ?? "Someone";
}

export function channelLabel(number: number | string, title: string): string {
  return `Channel ${String(number).padStart(2, "0")} — ${title}`;
}
