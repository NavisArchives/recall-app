import { supabase } from "../config/supabase.js";

/**
 * Rule-based checks on how complete the archive is.
 *
 * Every open finding is also one individual mission: not "4 channels
 * without an NFC card" as commentary, but "Link a card to Channel 04" as
 * work someone can press and do. The engine writes these missions itself
 * (origin 'recall'), and completes them the way every mission concludes —
 * when the work actually happens and the finding disappears. It never
 * touches a mission a person wrote.
 */

export type RuleKey =
  | "empty_channel"
  | "min_photos"
  | "missing_description"
  | "short_description"
  | "missing_thumbnail"
  | "missing_photo_description"
  | "no_nfc_card";

interface Finding {
  rule_key: RuleKey;
  message: string;
  severity: "info" | "warning";
  /** How much work the matching mission asks for, when countable. */
  task_count?: number;
}

const MIN_PHOTOS = 10;
const SHORT_DESCRIPTION = 30;

/** How each open rule is summarised in the sidebar's "needs attention". */
export const RULE_SUMMARY: Record<RuleKey, (count: number) => string> = {
  empty_channel: (n) => `${n} empty channel${n > 1 ? "s" : ""}`,
  min_photos: (n) => `${n} channel${n > 1 ? "s" : ""} with fewer than ${MIN_PHOTOS} photos`,
  missing_description: (n) => `${n} channel${n > 1 ? "s" : ""} without a description`,
  short_description: (n) => `${n} very short description${n > 1 ? "s" : ""}`,
  missing_thumbnail: (n) => `${n} channel${n > 1 ? "s" : ""} missing a thumbnail`,
  missing_photo_description: (n) => `${n} channel${n > 1 ? "s" : ""} with undescribed photos`,
  no_nfc_card: (n) => `${n} channel${n > 1 ? "s" : ""} without an NFC card`,
};

interface ChannelForRules {
  id: string;
  number: number;
  title: string;
  description: string | null;
  content_type: string;
}

function evaluate(
  channel: ChannelForRules,
  media: { file_type: string; caption?: string | null }[],
  hasCard: boolean
): Finding[] {
  const label = `Channel ${String(channel.number).padStart(2, "0")} — ${channel.title}`;
  const photos = media.filter((m) => m.file_type === "image").length;
  const findings: Finding[] = [];

  if (media.length === 0) {
    findings.push({
      rule_key: "empty_channel",
      severity: "warning",
      message: `${label} has no content yet.`,
    });
  } else if (photos === 0) {
    // The cover is the channel's first photograph; with none, the shelf
    // shows a blank tile even though the channel has content.
    findings.push({
      rule_key: "missing_thumbnail",
      severity: "warning",
      message: `${label} is missing a thumbnail.`,
    });
  }

  if (channel.content_type === "album" && media.length > 0 && photos < MIN_PHOTOS) {
    findings.push({
      rule_key: "min_photos",
      severity: "info",
      message: `${label} has ${photos} photo${photos === 1 ? "" : "s"}. More would give her more to find.`,
      task_count: MIN_PHOTOS - photos,
    });
  }

  const description = channel.description?.trim() ?? "";
  if (!description) {
    findings.push({
      rule_key: "missing_description",
      severity: "info",
      message: `${label} has no description.`,
    });
  } else if (description.length < SHORT_DESCRIPTION) {
    findings.push({
      rule_key: "short_description",
      severity: "info",
      message: `${label} has a very short description.`,
    });
  }

  // A photograph with no words is a photograph her screen can say nothing
  // about. Counted per channel, so the list stays short.
  const wordless = media.filter(
    (m) => m.file_type === "image" && !(m.caption ?? "").trim()
  ).length;
  if (wordless > 0) {
    findings.push({
      rule_key: "missing_photo_description",
      severity: "info",
      message: `${label} has ${wordless} photo${wordless === 1 ? "" : "s"} without a description.`,
      task_count: wordless,
    });
  }

  if (!hasCard) {
    findings.push({
      rule_key: "no_nfc_card",
      severity: "info",
      message: `${label} has no NFC card linked.`,
    });
  }

  return findings;
}

/** Which kind of mission each finding asks for, and how to word it. */
const RULE_KIND: Record<RuleKey, "add_photos" | "describe_photos" | "link_nfc" | "custom"> = {
  empty_channel: "add_photos",
  min_photos: "add_photos",
  missing_thumbnail: "add_photos",
  missing_photo_description: "describe_photos",
  no_nfc_card: "link_nfc",
  missing_description: "custom",
  short_description: "custom",
};

const MISSION_TITLE: Record<RuleKey, (label: string, n?: number) => string> = {
  empty_channel: (l) => `Add the first memories to ${l}`,
  min_photos: (l) => `Add more photos to ${l}`,
  missing_thumbnail: (l) => `Add a photo to ${l}`,
  missing_photo_description: (l, n) =>
    `Describe ${n === 1 ? "the photo" : `the ${n ?? ""} photos`.replace("  ", " ")} in ${l}`,
  no_nfc_card: (l) => `Link a card to ${l}`,
  missing_description: (l) => `Write a description for ${l}`,
  short_description: (l) => `Lengthen the description of ${l}`,
};

/**
 * At most this many Recall-generated missions are open at once, archive-wide.
 *
 * The engine can detect a great deal — six rules across every channel — and
 * materialising all of it turns the board into a wall of homework nobody
 * reads. The sidebar's grouped summary is the right place for the long tail;
 * the board is for what somebody might actually do next. Missions a person
 * wrote are never counted here and never displaced.
 */
export const MAX_GENERATED_MISSIONS = 10;

/**
 * Keeps Recall's own missions in step with the findings: one open mission
 * per open finding, completed the moment the finding resolves. Missions
 * people wrote (origin 'human') are never read, closed, or duplicated over.
 */
async function syncMissions(
  channel: ChannelForRules,
  findings: Finding[],
  archive: string
): Promise<void> {
  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from("missions")
    .select("id, rule_key")
    .eq("channel_id", channel.id)
    .eq("archive_id", archive)
    .eq("origin", "recall")
    .neq("status", "completed");

  const openRules = new Set<string>(findings.map((f) => f.rule_key));
  const stale = (existing ?? []).filter((m) => m.rule_key && !openRules.has(m.rule_key));
  if (stale.length > 0) {
    await supabase
      .from("missions")
      .update({ status: "completed", completed_at: now })
      .eq("archive_id", archive)
      .in("id", stale.map((m) => m.id));
  }

  const have = new Set((existing ?? []).map((m) => m.rule_key));
  let fresh = findings.filter((f) => !have.has(f.rule_key));

  if (fresh.length > 0) {
    /*
     * The cap, counted across the whole archive rather than this channel.
     *
     * Two preferences when there is room for only some: a channel that has
     * no mission yet comes before a second mission for a channel that
     * already has one, and a warning comes before an observation. So a
     * family with twelve thin channels sees one prompt for each of ten
     * rather than six prompts about the first two.
     */
    const { count: openGenerated } = await supabase
      .from("missions")
      .select("id", { count: "exact", head: true })
      .eq("archive_id", archive)
      .eq("origin", "recall")
      .neq("status", "completed")
      .is("archived_at", null);

    const room = MAX_GENERATED_MISSIONS - (openGenerated ?? 0);
    if (room <= 0) return;

    const alreadyHere = (existing ?? []).length;
    const severityFirst = [...fresh].sort((a, b) =>
      a.severity === b.severity ? 0 : a.severity === "warning" ? -1 : 1
    );
    // A channel with nothing on the board earns one before anyone gets two.
    fresh = severityFirst.slice(0, alreadyHere === 0 ? Math.min(room, 1) : room);
    if (fresh.length === 0) return;
  }

  if (fresh.length > 0) {
    const label = `Channel ${String(channel.number).padStart(2, "0")} — ${channel.title}`;
    await supabase.from("missions").insert(
      fresh.map((f) => ({
        archive_id: archive,
        channel_id: channel.id,
        origin: "recall",
        rule_key: f.rule_key,
        title: MISSION_TITLE[f.rule_key](label, f.task_count),
        detail: f.message,
        status: "suggested",
        task_kind: RULE_KIND[f.rule_key],
        task_count: f.task_count ?? null,
      }))
    );
  }
}

async function persist(
  channel: ChannelForRules,
  findings: Finding[],
  archive: string
): Promise<void> {
  const now = new Date().toISOString();
  const channelId = channel.id;

  if (findings.length > 0) {
    await supabase.from("suggestions").upsert(
      findings.map((f) => ({
        channel_id: channelId,
        rule_key: f.rule_key,
        message: f.message,
        severity: f.severity,
        resolved: false,
        updated_at: now,
        archive_id: archive,
      })),
      { onConflict: "channel_id,rule_key" }
    );
  }

  // A rule that no longer applies is resolved rather than deleted, so the
  // history of what was once missing is not silently erased.
  const open = findings.map((f) => f.rule_key);
  let query = supabase
    .from("suggestions")
    .update({ resolved: true, updated_at: now })
    .eq("channel_id", channelId)
    .eq("archive_id", archive)
    .eq("resolved", false);

  if (open.length > 0) query = query.not("rule_key", "in", `(${open.join(",")})`);
  await query;

  await syncMissions(channel, findings, archive);
}

/**
 * Re-checks one channel. Called after anything that changes its content.
 *
 * The archive is required rather than read from the channel: this runs
 * fire-and-forget after a write, so a caller passing a channel id from another
 * family would have had it silently re-evaluated — and its suggestions and
 * missions rewritten — on the strength of an id alone.
 */
export async function evaluateChannel(channelId: string, archiveId: string): Promise<void> {
  const { data: channel } = await supabase
    .from("channels")
    .select("id, number, title, description, content_type, archived_at, archive_id")
    .eq("id", channelId)
    .eq("archive_id", archiveId)
    .maybeSingle();

  // An archived channel is nobody's homework: close everything open on it,
  // including the missions Recall itself wrote about it.
  if (!channel || channel.archived_at) {
    const now = new Date().toISOString();
    await supabase
      .from("suggestions")
      .update({ resolved: true, updated_at: now })
      .eq("channel_id", channelId)
      .eq("archive_id", archiveId)
      .eq("resolved", false);
    await supabase
      .from("missions")
      .update({ status: "completed", completed_at: now })
      .eq("channel_id", channelId)
      .eq("archive_id", archiveId)
      .eq("origin", "recall")
      .neq("status", "completed");
    return;
  }

  const [{ data: media }, { data: cards }] = await Promise.all([
    supabase
      .from("media_files")
      .select("file_type, caption")
      .eq("channel_id", channelId)
      .eq("archive_id", archiveId)
      .is("archived_at", null),
    supabase
      .from("nfc_cards")
      .select("id")
      .eq("channel_id", channelId)
      .eq("archive_id", archiveId)
      .is("archived_at", null),
  ]);

  await persist(
    channel as ChannelForRules,
    evaluate(channel as ChannelForRules, media ?? [], (cards ?? []).length > 0),
    archiveId
  );
}

/**
 * Re-checks every live channel in one archive — cheap at this scale, run on
 * dashboard load. Scoped to a single family: one household's gaps are not
 * another's, and an unscoped sweep here would read everyone's rows.
 */
export async function evaluateAll(archive: string): Promise<number> {
  const [{ data: channels }, { data: media }, { data: cards }] = await Promise.all([
    supabase
      .from("channels")
      .select("id, number, title, description, content_type")
      .eq("archive_id", archive)
      .is("archived_at", null),
    supabase.from("media_files").select("channel_id, file_type, caption").eq("archive_id", archive).is("archived_at", null),
    supabase.from("nfc_cards").select("channel_id").eq("archive_id", archive).is("archived_at", null),
  ]);

  const mediaByChannel = new Map<string, { file_type: string; caption?: string | null }[]>();
  for (const m of media ?? []) {
    const list = mediaByChannel.get(m.channel_id) ?? [];
    list.push({ file_type: m.file_type, caption: (m as { caption?: string | null }).caption });
    mediaByChannel.set(m.channel_id, list);
  }
  const carded = new Set((cards ?? []).map((c) => c.channel_id).filter(Boolean));

  for (const channel of channels ?? []) {
    await persist(
      channel as ChannelForRules,
      evaluate(channel as ChannelForRules, mediaByChannel.get(channel.id) ?? [], carded.has(channel.id)),
      archive
    );
  }

  return (channels ?? []).length;
}

/**
 * Archive health, from the open findings themselves rather than a separate
 * tally: a warning costs 10 points, a smaller gap costs 4.
 */
export function healthFrom(open: { severity: string }[]): number {
  const warnings = open.filter((s) => s.severity === "warning").length;
  const infos = open.length - warnings;
  return Math.max(0, Math.min(100, 100 - warnings * 10 - infos * 4));
}
