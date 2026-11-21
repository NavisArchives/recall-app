import { supabase } from "../config/supabase.js";
import type { ProfileSession } from "../middleware/auth.js";

export interface ChannelVisibilityRow {
  id: string;
  created_by: string | null;
  privacy_level: number;
}

/**
 * Applies the channel privacy rule to every read surface.
 *
 * The subject's trusted screen and active admins may read the full archive.
 * Co-authors may read public channels, channels they created, and selected
 * channels explicitly granted to them. An unidentified, non-screen device
 * receives nothing.
 */
export async function readableChannelIds(
  archiveId: string,
  channels: ChannelVisibilityRow[],
  profile: ProfileSession | null,
  trustedDisplay: boolean
): Promise<Set<string>> {
  if (trustedDisplay || profile?.role === "admin" || profile?.role === "user") {
    return new Set(channels.map((channel) => channel.id));
  }
  if (!profile || profile.role !== "co_author") return new Set();

  const selected = channels.filter(
    (channel) =>
      channel.privacy_level === 2 && channel.created_by !== profile.personId
  );
  let granted = new Set<string>();

  if (selected.length > 0) {
    const { data, error } = await supabase
      .from("channel_access")
      .select("channel_id")
      .eq("archive_id", archiveId)
      .eq("person_id", profile.personId)
      .in("channel_id", selected.map((channel) => channel.id));

    // Privacy fails closed. Callers deliberately present the same absence as
    // a private or missing channel, so a database fault cannot widen access.
    if (!error) granted = new Set((data ?? []).map((row) => row.channel_id as string));
  }

  return new Set(
    channels
      .filter(
        (channel) =>
          channel.created_by === profile.personId ||
          channel.privacy_level === 3 ||
          (channel.privacy_level === 2 && granted.has(channel.id))
      )
      .map((channel) => channel.id)
  );
}

export async function mayReadChannel(
  archiveId: string,
  channel: ChannelVisibilityRow,
  profile: ProfileSession | null,
  trustedDisplay: boolean
): Promise<boolean> {
  return (await readableChannelIds(archiveId, [channel], profile, trustedDisplay)).has(channel.id);
}

/**
 * Which channels one reader may see, resolved once for an aggregate read.
 *
 * The per-channel routes always asked `readableChannelIds`; the dashboards
 * did not. Streams, insights, the activity log, suggestions, missions and the
 * card registry all join a channel's title (or a caption, or a sentence that
 * names it) into rows served to every co-author, so a private channel's name
 * reached exactly the helpers its privacy level was set to keep it from
 * (review 29 Sep, access-1). Every one of those reads now resolves this
 * scope first and drops what it does not allow.
 *
 * Archived channels are included: a channel in the trash is exactly as
 * private as it was on the shelf, and the activity log still names it.
 *
 * A failed channel read throws, so the route answers with `fail()` rather
 * than with an unfiltered payload.
 */
export interface ChannelScope {
  /** An admin or the subject's own screen: nothing is filtered. */
  whole: boolean;
  /**
   * Whether a row about this channel may be shown. A row about no channel
   * is not a channel's secret and is allowed; an id this reader cannot see
   * — or one that no longer exists — is not.
   */
  allows(channelId: string | null | undefined): boolean;
  /**
   * "Channel 04 — Title" for every channel this reader may NOT see, for
   * rows whose text names a channel without pointing at it.
   */
  hiddenLabels: string[];
  /**
   * Whether a sentence names a channel this reader may not see — or one it
   * cannot vouch for.
   *
   * `hiddenLabels` only knows channels that still exist. A permanently
   * deleted channel leaves its history behind with the pointer set to null
   * (`on delete set null`), and its label is in no list any more, so a line
   * like "Claire created Channel 09 — Old debts" passed every test. So any
   * label-shaped phrase ("Channel NN — ") is allowed only when it begins
   * the label of a channel this reader can read; a label that no longer
   * belongs to anything is treated as hidden.
   */
  mentionsHidden(text: string | null | undefined): boolean;
}

export const WHOLE_ARCHIVE: ChannelScope = {
  whole: true,
  allows: () => true,
  hiddenLabels: [],
  mentionsHidden: () => false,
};

/** The label every channel sentence is written with (routes/channels.ts channelLabel). */
function labelOf(channel: { number: number; title: string }): string {
  return `Channel ${String(channel.number).padStart(2, "0")} — ${channel.title}`;
}

/** The start of a label, whatever channel it was. */
const LABEL_START = /Channel \d{2} — /g;

export async function channelScope(
  archiveId: string,
  profile: ProfileSession | null,
  trustedDisplay: boolean
): Promise<ChannelScope> {
  if (trustedDisplay || profile?.role === "admin" || profile?.role === "user") {
    return WHOLE_ARCHIVE;
  }

  const { data, error } = await supabase
    .from("channels")
    .select("id, number, title, created_by, privacy_level")
    .eq("archive_id", archiveId);
  if (error) throw new Error(`channel scope: ${error.message}`);

  const channels = (data ?? []) as (ChannelVisibilityRow & { number: number; title: string })[];
  const readable = await readableChannelIds(archiveId, channels, profile, false);

  const hiddenLabels = channels
    .filter((channel) => !readable.has(channel.id) && channel.title)
    .map(labelOf);
  const readableLabels = channels.filter((channel) => readable.has(channel.id)).map(labelOf);

  return {
    whole: false,
    allows: (channelId) => !channelId || readable.has(channelId),
    hiddenLabels,
    mentionsHidden: (text) => {
      if (!text) return false;
      if (hiddenLabels.some((label) => text.includes(label))) return true;
      for (const match of text.matchAll(LABEL_START)) {
        const at = match.index ?? 0;
        if (!readableLabels.some((label) => text.startsWith(label, at))) return true;
      }
      return false;
    },
  };
}

/**
 * Whether one mission may reach this reader (access-1). The same three
 * tests as a history line (services/streams.ts visibleEvent): its channel; a mission Recall wrote whose channel
 * is gone (its title always quotes the channel's label); and its title.
 */
export function visibleMission(
  m: { channel_id?: string | null; origin?: string | null; title?: string | null },
  scope: ChannelScope
): boolean {
  if (scope.whole) return true;
  if (!scope.allows(m.channel_id ?? null)) return false;
  if (!m.channel_id && m.origin === "recall") return false;
  return !scope.mentionsHidden(m.title);
}
