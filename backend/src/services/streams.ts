import { supabase } from "../config/supabase.js";
import { visibleMission, type ChannelScope } from "./channelVisibility.js";

/**
 * M103 — the upgraded backend's data streams.
 *
 * One fact, one source. Each stream is a pure, archive-scoped function
 * returning a stable, documented shape; the routes are thin wrappers, and
 * every consumer — the dashboard, Insights, the future ask bar — reads the
 * same function, so no fact is ever computed two ways.
 *
 * Two disciplines run through the file:
 *
 * **Named fields only.** Nothing here spreads a database row into a
 * response. Every output field is picked by name, which is what keeps a
 * column added later — or a contact detail already present — from leaking
 * through a stream that never meant to carry it.
 *
 * **Declared gaps.** A fact the schema cannot support (software version,
 * storage, backup) comes back explicitly `null`, never invented. A gap
 * declared is owed; a gap faked ships a lie (F21).
 *
 * **Channel privacy (access-1).** Every stream that says anything about a
 * channel takes the reader's `ChannelScope` and counts, lists and names only
 * what it allows. The scope is required, not defaulted: a caller that forgets
 * it should fail to compile, not serve a co-author a private channel's title.
 */

// ───────────────────────────────────────────────────────────────── shared

/** A query error is thrown to the route, which answers with `fail()`. */
function must<T>(
  result: { data: unknown; error: { message: string } | null },
  what: string
): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return (result.data ?? []) as T;
}

/** PostgREST types an embedded row as an array; it is one row here. */
function one<T>(embed: T | T[] | null | undefined): T | null {
  if (!embed) return null;
  return Array.isArray(embed) ? (embed[0] ?? null) : embed;
}

/**
 * The screen sleeps after half an hour of stillness, so that is the longest
 * a visit left open can honestly be said to have lasted. Same rule Insights
 * has always used — now in one place.
 */
const OPEN_CAP_SECONDS = 30 * 60;

function elapsed(row: {
  started_at: string;
  ended_at?: string | null;
  duration_seconds?: number | null;
}): number {
  if (typeof row.duration_seconds === "number") return row.duration_seconds;
  const since = Math.round((Date.now() - new Date(row.started_at).getTime()) / 1000);
  return Math.max(0, Math.min(since, OPEN_CAP_SECONDS));
}

/**
 * The screen is only "on" while it is being watched; after five minutes of
 * silence the honest answer is what she saw last, not what is technically
 * still loaded. One rule, shared by every consumer that says "on screen".
 */
const SCREEN_LIVE_MS = 5 * 60 * 1000;

export interface ScreenNow {
  live: boolean;
  channel_number: number | null;
  /*
    Which photograph is up, as the display reported it (040). 0-based index;
    readers add one for people. Null together means "not reported" — an
    older display build or a channel with nothing to page through — and the
    UI stays silent about position rather than guessing. Only meaningful
    while `live`; a dark screen has no current photograph, so both go null
    with the channel.
  */
  photo_index: number | null;
  photo_count: number | null;
  synced_at: string | null;
  last_channel_number: number | null;
  last_seen_at: string | null;
  /**
   * What the family calls the screen in the living room (M146) — the
   * installation's own label, and null when it has none rather than a
   * borrowed one. It is read before anybody has chosen a profile, so it is
   * the *only* thing about the machine that comes out of here: the
   * installation's username is its internal credential identity (M111) and
   * stays on the server.
   */
  display_name: string | null;
}

export async function screenNow(archiveId: string): Promise<ScreenNow> {
  const [settingsRes, visitRes, screenRes] = await Promise.all([
    supabase
      .from("settings")
      .select("current_channel_number, current_photo_index, current_photo_count, screen_synced_at")
      .eq("archive_id", archiveId)
      .maybeSingle(),
    supabase
      .from("channel_visits")
      .select("channel_number, started_at")
      .eq("archive_id", archiveId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // The name only. Widening this select is how a pre-auth pill starts
    // disclosing a machine's credentials.
    supabase
      .from("installations")
      .select("name, is_trusted, revoked_at")
      .eq("archive_id", archiveId)
      .eq("is_trusted", true)
      .limit(1),
  ]);

  if (settingsRes.error) throw new Error(`screen state: ${settingsRes.error.message}`);
  const settings = settingsRes.data as {
    current_channel_number?: number | null;
    current_photo_index?: number | null;
    current_photo_count?: number | null;
    screen_synced_at?: string | null;
  } | null;
  const lastVisit = visitRes.data as {
    channel_number?: number | null;
    started_at?: string | null;
  } | null;

  const syncedAt = settings?.screen_synced_at ? new Date(settings.screen_synced_at).getTime() : 0;
  const live = Date.now() - syncedAt < SCREEN_LIVE_MS;

  const screen = ((screenRes.data ?? []) as { name?: string | null; is_trusted?: boolean; revoked_at?: string | null }[])
    .find((row) => row.is_trusted === true && !row.revoked_at);

  return {
    live,
    channel_number: live ? (settings?.current_channel_number ?? null) : null,
    photo_index: live ? (settings?.current_photo_index ?? null) : null,
    photo_count: live ? (settings?.current_photo_count ?? null) : null,
    synced_at: settings?.screen_synced_at ?? null,
    last_channel_number: lastVisit?.channel_number ?? settings?.current_channel_number ?? null,
    last_seen_at: lastVisit?.started_at ?? null,
    display_name: screen?.name ?? null,
  };
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Midnight on the server's own calendar — "today" as the household means it. */
function todayStartIso(): string {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

// ──────────────────────────────────────────────────────────────── subject

export interface SubjectStream {
  subject: {
    display_name: string;
    full_name: string | null;
    birth_date: string | null;
    residence: string | null;
  } | null;
  archive_since: string | null;
  on_screen: ScreenNow;
}

/** Who the archive is about, how long it has existed, what is on screen. */
export async function subjectStream(archiveId: string): Promise<SubjectStream> {
  const [settingsRes, archiveRes, on_screen] = await Promise.all([
    supabase
      .from("settings")
      .select("display_name, full_name, birth_date, residence")
      .eq("archive_id", archiveId)
      .maybeSingle(),
    supabase.from("archives").select("id, created_at").eq("id", archiveId).maybeSingle(),
    screenNow(archiveId),
  ]);

  if (settingsRes.error) throw new Error(`subject: ${settingsRes.error.message}`);
  const s = settingsRes.data as {
    display_name?: string;
    full_name?: string | null;
    birth_date?: string | null;
    residence?: string | null;
  } | null;

  return {
    subject: s
      ? {
          display_name: s.display_name ?? "",
          full_name: s.full_name ?? null,
          birth_date: s.birth_date ?? null,
          residence: s.residence ?? null,
        }
      : null,
    archive_since: (archiveRes.data as { created_at?: string } | null)?.created_at ?? null,
    on_screen,
  };
}

// ──────────────────────────────────────────────────────────────── content

export interface ShelfEntry {
  id: string;
  number: number;
  title: string;
  content_type: string;
  photo_count: number;
  video_count: number;
  cover_media_id: string | null;
  live: boolean;
}

export interface ContentStream {
  channels: number;
  photos: number;
  videos: number;
  /** Of photographs only — a captioned video does not describe a photo. */
  described: { captioned: number; photos: number; pct: number | null };
  additions: {
    total: number;
    this_week: number;
    this_month: number;
    by_month: { month: string; count: number }[];
  };
  shelf: ShelfEntry[];
}

/** What the archive holds and how it has grown. */
export async function contentStream(
  archiveId: string,
  scope: ChannelScope
): Promise<ContentStream> {
  const [channelsRes, mediaRes, screen] = await Promise.all([
    supabase
      .from("channels")
      .select("id, number, title, content_type, created_at")
      .eq("archive_id", archiveId)
      .is("archived_at", null)
      .order("number"),
    supabase
      .from("media_files")
      .select("id, channel_id, file_type, caption, created_at, display_order")
      .eq("archive_id", archiveId)
      .is("archived_at", null),
    screenNow(archiveId),
  ]);

  // What this reader may see is the whole of what the stream counts: a
  // co-author's totals are the totals of the shelf they are shown.
  const channels = must<
    { id: string; number: number; title: string; content_type: string; created_at: string }[]
  >(channelsRes, "content: channels").filter((c) => scope.allows(c.id));
  const media = must<
    {
      id: string;
      channel_id: string;
      file_type: string;
      caption: string | null;
      created_at: string;
      display_order: number;
    }[]
  >(mediaRes, "content: media").filter((m) => !!m.channel_id && scope.allows(m.channel_id));

  const photos = media.filter((m) => m.file_type === "image");
  const captioned = photos.filter((m) => !!m.caption?.trim());

  const weekAgo = daysAgoIso(7);
  const monthAgo = daysAgoIso(30);

  // Twelve calendar months ending now, keyed "YYYY-MM", zeros included so a
  // chart can draw the quiet months as quiet rather than missing.
  const by_month: { month: string; count: number }[] = [];
  const cursor = new Date();
  cursor.setDate(1);
  for (let i = 11; i >= 0; i--) {
    const d = new Date(cursor.getFullYear(), cursor.getMonth() - i, 1);
    by_month.push({
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      count: 0,
    });
  }
  const monthIndex = new Map(by_month.map((m, i) => [m.month, i]));
  for (const m of media) {
    const d = new Date(m.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const at = monthIndex.get(key);
    if (at !== undefined) by_month[at].count += 1;
  }

  const byChannel = new Map<string, { photos: number; videos: number; cover: string | null; coverOrder: number }>();
  for (const m of media) {
    const entry =
      byChannel.get(m.channel_id) ?? { photos: 0, videos: 0, cover: null, coverOrder: Infinity };
    if (m.file_type === "image") {
      entry.photos += 1;
      if (m.display_order < entry.coverOrder) {
        entry.cover = m.id;
        entry.coverOrder = m.display_order;
      }
    } else {
      entry.videos += 1;
    }
    byChannel.set(m.channel_id, entry);
  }

  return {
    channels: channels.length,
    photos: photos.length,
    videos: media.length - photos.length,
    described: {
      captioned: captioned.length,
      photos: photos.length,
      pct: photos.length ? Math.round((captioned.length / photos.length) * 100) : null,
    },
    additions: {
      total: media.length,
      this_week: media.filter((m) => m.created_at >= weekAgo).length,
      this_month: media.filter((m) => m.created_at >= monthAgo).length,
      by_month,
    },
    shelf: channels.map((c) => ({
      id: c.id,
      number: c.number,
      title: c.title,
      content_type: c.content_type,
      photo_count: byChannel.get(c.id)?.photos ?? 0,
      video_count: byChannel.get(c.id)?.videos ?? 0,
      cover_media_id: byChannel.get(c.id)?.cover ?? null,
      live: screen.live && screen.channel_number === c.number,
    })),
  };
}

// ───────────────────────────────────────────────────────────────── people

export interface PeopleStream {
  /** Members of the family circle, the subject not counted among them. */
  contributors: number;
  circle: {
    id: string;
    name: string;
    relationship: string | null;
    role: string;
    status: string;
    joined_at: string | null;
    /** Channels carrying this person as `author_id` — whose channel it is. */
    channels_authored: number;
    /** Channels this person `created_by` — who did the work. The live data
     *  records authorship here; the tree family is 10/10 created, 0 authored. */
    channels_created: number;
    media_added: number;
  }[];
}

/** The family circle and what each member has put in. No contact details. */
export async function peopleStream(
  archiveId: string,
  scope: ChannelScope
): Promise<PeopleStream> {
  const [peopleRes, channelsRes, mediaRes] = await Promise.all([
    supabase
      .from("people")
      .select("id, name, relationship, role, status, joined_at")
      .eq("archive_id", archiveId)
      .is("archived_at", null)
      /*
        Paused people stay in this stream (M222).

        `.neq("status", "deactivated")` used to live here, and it made the
        contributor profile tell a family that someone who had been paused
        contributed nothing. The read succeeded; the person simply was not in
        it; and the page printed "Nothing added yet." over everything they
        ever gave — which for a contributor who has died, or who stepped back
        from caring, is the cruellest sentence the archive could produce.

        Pausing withdraws a sign-in. It does not unmake what somebody gave,
        and this stream is what the admin reads to see what that was. It is
        an admin surface only — the display never reads it — so there is no
        one here to protect from seeing a paused name.
      */
      .order("name"),
    supabase
      .from("channels")
      .select("id, author_id, created_by")
      .eq("archive_id", archiveId)
      .is("archived_at", null),
    supabase
      .from("media_files")
      .select("id, channel_id, created_by")
      .eq("archive_id", archiveId)
      .is("archived_at", null),
  ]);

  const people = must<
    {
      id: string;
      name: string;
      relationship: string | null;
      role: string;
      status: string;
      joined_at: string | null;
    }[]
  >(peopleRes, "people");
  // Counted over what this reader may see, so a contributor's profile never
  // reports work on a channel the page itself cannot list.
  const channels = must<{ id: string; author_id: string | null; created_by: string | null }[]>(
    channelsRes,
    "people: channels"
  ).filter((c) => scope.allows(c.id));
  const media = must<{ id: string; channel_id: string | null; created_by: string | null }[]>(
    mediaRes,
    "people: media"
  ).filter((m) => !!m.channel_id && scope.allows(m.channel_id));

  const authored = new Map<string, number>();
  const created = new Map<string, number>();
  for (const c of channels) {
    if (c.author_id) authored.set(c.author_id, (authored.get(c.author_id) ?? 0) + 1);
    if (c.created_by) created.set(c.created_by, (created.get(c.created_by) ?? 0) + 1);
  }
  const added = new Map<string, number>();
  for (const m of media) {
    if (m.created_by) added.set(m.created_by, (added.get(m.created_by) ?? 0) + 1);
  }

  return {
    contributors: people.filter((p) => p.role !== "user").length,
    circle: people.map((p) => ({
      id: p.id,
      name: p.name,
      relationship: p.relationship ?? null,
      role: p.role,
      status: p.status,
      joined_at: p.joined_at ?? null,
      channels_authored: authored.get(p.id) ?? 0,
      channels_created: created.get(p.id) ?? 0,
      media_added: added.get(p.id) ?? 0,
    })),
  };
}

// ──────────────────────────────────────────────────────────────────── nfc

export interface NfcStream {
  cards: number;
  linked: number;
  unlinked: { id: string; label: string }[];
  per_channel: { channel_id: string; cards: number }[];
}

/** The physical cards and what they open. */
export async function nfcStream(archiveId: string, scope: ChannelScope): Promise<NfcStream> {
  const cardsRes = await supabase
    .from("nfc_cards")
    .select("id, label, channel_id")
    .eq("archive_id", archiveId)
    .is("archived_at", null)
    .order("created_at");

  // A card that opens a channel this reader cannot see is left out whole,
  // the same answer GET /api/nfc gives.
  const cards = must<{ id: string; label: string; channel_id: string | null }[]>(
    cardsRes,
    "nfc"
  ).filter((c) => scope.allows(c.channel_id));

  const perChannel = new Map<string, number>();
  for (const card of cards) {
    if (card.channel_id) perChannel.set(card.channel_id, (perChannel.get(card.channel_id) ?? 0) + 1);
  }

  return {
    cards: cards.length,
    linked: cards.filter((c) => !!c.channel_id).length,
    unlinked: cards.filter((c) => !c.channel_id).map((c) => ({ id: c.id, label: c.label })),
    per_channel: [...perChannel.entries()].map(([channel_id, count]) => ({
      channel_id,
      cards: count,
    })),
  };
}

// ──────────────────────────────────────────────────────────────── missions

export interface MissionsStream {
  total: number;
  done: number;
  by_status: { suggested: number; in_progress: number; completed: number };
  list: {
    id: string;
    title: string;
    status: string;
    created_at: string;
    channel: { id: string; number: number; title: string } | null;
    assignee: { id: string; name: string } | null;
  }[];
}

/**
 * The work people have taken on. Deliberately the `missions` table, not the
 * `suggestions` engine: what the data itself is missing lives there and
 * resolves on its own — a mission is something somebody decided to do.
 */
export async function missionsStream(
  archiveId: string,
  scope: ChannelScope
): Promise<MissionsStream> {
  const missionsRes = await supabase
    .from("missions")
    .select(
      "id, title, status, created_at, channel_id, origin, assignee:people!missions_assigned_to_fkey(id, name), channel:channels!missions_channel_id_fkey(id, number, title)"
    )
    .eq("archive_id", archiveId)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  /*
    A mission about a channel this reader cannot see is left out whole, not
    merely stripped of its channel: Recall's own missions carry the channel's
    label in their title ("Add more photos to Channel 04 — …") — and so is
    one of Recall's whose channel has since been permanently deleted.
  */
  const rows = must<
    {
      id: string;
      title: string;
      status: string;
      created_at: string;
      channel_id?: string | null;
      origin?: string | null;
      assignee?: unknown;
      channel?: unknown;
    }[]
  >(missionsRes, "missions").filter((m) => visibleMission(m, scope));

  const by_status = { suggested: 0, in_progress: 0, completed: 0 };
  for (const m of rows) {
    if (m.status in by_status) by_status[m.status as keyof typeof by_status] += 1;
  }

  return {
    total: rows.length,
    done: by_status.completed,
    by_status,
    list: rows.map((m) => {
      const channel = one(m.channel as { id: string; number: number; title: string } | null);
      const assignee = one(m.assignee as { id: string; name: string } | null);
      return {
        id: m.id,
        title: m.title,
        status: m.status,
        created_at: m.created_at,
        channel: channel ? { id: channel.id, number: channel.number, title: channel.title } : null,
        assignee: assignee ? { id: assignee.id, name: assignee.name } : null,
      };
    }),
  };
}

// ────────────────────────────────────────────────────────────── engagement

export interface EngagementStream {
  watched_today: { seconds: number; visits: number };
  longest_sit: {
    seconds: number;
    channel_id: string | null;
    channel_number: number | null;
    channel_title: string | null;
  } | null;
  by_day: { day: string; seconds: number; visits: number }[];
  /*
    Two different measurements, kept apart on purpose (M115/F31).

    `seconds` is device_sessions — how long the *screen was awake*. The rest
    come from channel_visits — time spent *inside* channels. They answer
    different questions and they do not agree: one response had 61 awake
    minutes over a returns-list totalling 30. Welded into one sentence that
    reads as an hour spent in one channel, which nothing measured.

    The block is the *asked-for* window (M115 strand 3): today, the last
    seven days, or the last thirty — `range` names which, so three tabs can
    stop answering identically.
  */
  window: {
    range: EngagementRange;
    /** Screen-awake time. Not "watched" — nobody knows if she was looking. */
    seconds: number;
    sessions: number;
    /** Time inside channels, the returns-list's own total. */
    channel_seconds: number;
    visits: number;
    channels: number;
  };
  /*
    The returns-list, scoped to the same window the block above reports.
    It was built from the thirty-day fetch — a month's list sitting under a
    tab that says "This week".
  */
  per_channel: { id: string; number: number; title: string; seconds: number; visits: number }[];
  quiet: { id: string; number: number; title: string }[];
  entry_methods: { key: string; label: string; count: number; percent: number }[];
  has_data: boolean;
}

/** The three windows a consumer may ask for. */
export type EngagementRange = "today" | "week" | "month";

export function isEngagementRange(value: unknown): value is EngagementRange {
  return value === "today" || value === "week" || value === "month";
}

/**
 * How the archive is used, descriptively — nothing here scores Margaret.
 * "Today" is the server's own calendar day; a visit still open counts for
 * the time it has actually lasted, capped at the screen's sleep threshold.
 */
export async function engagementStream(
  archiveId: string,
  scope: ChannelScope,
  range: EngagementRange = "week"
): Promise<EngagementStream> {
  const month = daysAgoIso(30);
  const today = todayStartIso();
  const windowStart = range === "today" ? today : range === "week" ? daysAgoIso(7) : month;

  const [sessionsRes, visitsRes, channelsRes] = await Promise.all([
    supabase
      .from("device_sessions")
      .select("id, started_at, ended_at, duration_seconds")
      .eq("archive_id", archiveId)
      .gte("started_at", windowStart),
    supabase
      .from("channel_visits")
      .select("id, channel_id, channel_number, started_at, ended_at, duration_seconds, entry_method")
      .eq("archive_id", archiveId)
      .gte("started_at", month),
    supabase
      .from("channels")
      .select("id, number, title")
      .eq("archive_id", archiveId)
      .is("archived_at", null)
      .order("number"),
  ]);

  const sessions = must<
    { id: string; started_at: string; ended_at: string | null; duration_seconds: number | null }[]
  >(sessionsRes, "engagement: sessions");
  const visits = must<
    {
      id: string;
      channel_id: string | null;
      channel_number: number;
      started_at: string;
      ended_at: string | null;
      duration_seconds: number | null;
      entry_method: string;
    }[]
  >(visitsRes, "engagement: visits");
  /*
    Her screen time is hers, whichever channel it was spent in, so the
    session and visit totals stay whole. What names a channel — the
    returns-list, the quiet list, the longest sit — names only channels this
    reader may see.
  */
  const channels = must<{ id: string; number: number; title: string }[]>(
    channelsRes,
    "engagement: channels"
  ).filter((c) => scope.allows(c.id));

  const titles = new Map(channels.map((c) => [c.id, c]));

  const todays = visits.filter((v) => v.started_at >= today);
  const longest = todays.reduce(
    (best: (typeof visits)[number] | null, v) =>
      !best || elapsed(v) > elapsed(best) ? v : best,
    null
  );

  const by_day: { day: string; seconds: number; visits: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    by_day.push({ day: d.toISOString().slice(0, 10), seconds: 0, visits: 0 });
  }
  const dayIndex = new Map(by_day.map((d, i) => [d.day, i]));
  for (const v of visits) {
    const local = new Date(v.started_at);
    local.setHours(0, 0, 0, 0);
    const at = dayIndex.get(local.toISOString().slice(0, 10));
    if (at !== undefined) {
      by_day[at].seconds += elapsed(v);
      by_day[at].visits += 1;
    }
  }

  /*
    `totals` stays on the thirty-day fetch because `quiet` is derived from it:
    a channel nobody has opened in a month is quiet, and narrowing that to a
    week would call an ordinary fortnight's gap neglect.
  */
  const totals = new Map<string, { seconds: number; visits: number }>();
  for (const v of visits) {
    if (!v.channel_id) continue;
    const entry = totals.get(v.channel_id) ?? { seconds: 0, visits: 0 };
    entry.seconds += elapsed(v);
    entry.visits += 1;
    totals.set(v.channel_id, entry);
  }

  // Re-asserted on the rows as well as in the query, so the window is a
  // property of the arithmetic and not only of the fetch that fed it.
  const windowSessions = sessions.filter((s) => s.started_at >= windowStart);
  const windowVisits = visits.filter((v) => v.started_at >= windowStart);

  // What the returns-list reports: exactly the asked-for window.
  const windowTotals = new Map<string, { seconds: number; visits: number }>();
  for (const v of windowVisits) {
    if (!v.channel_id) continue;
    const entry = windowTotals.get(v.channel_id) ?? { seconds: 0, visits: 0 };
    entry.seconds += elapsed(v);
    entry.visits += 1;
    windowTotals.set(v.channel_id, entry);
  }

  // The reader types the channel number exactly as a person would, so a tag
  // and a keypress are the same event here.
  const methodCounts = new Map<string, number>();
  for (const v of visits) {
    const key = v.entry_method === "nfc" ? "keyboard" : v.entry_method || "keyboard";
    methodCounts.set(key, (methodCounts.get(key) ?? 0) + 1);
  }
  const LABELS: Record<string, string> = {
    keyboard: "Number entered",
    overview: "From the overview",
    direct: "Opened directly",
  };

  return {
    watched_today: {
      seconds: todays.reduce((sum, v) => sum + elapsed(v), 0),
      visits: todays.length,
    },
    longest_sit: longest
      ? scope.allows(longest.channel_id)
        ? {
            seconds: elapsed(longest),
            channel_id: longest.channel_id,
            channel_number:
              (longest.channel_id ? titles.get(longest.channel_id)?.number : null) ??
              longest.channel_number ??
              null,
            channel_title: (longest.channel_id ? titles.get(longest.channel_id)?.title : null) ?? null,
          }
        : { seconds: elapsed(longest), channel_id: null, channel_number: null, channel_title: null }
      : null,
    by_day,
    window: {
      range,
      seconds: windowSessions.reduce((sum, s) => sum + elapsed(s), 0),
      sessions: windowSessions.length,
      channel_seconds: windowVisits.reduce((sum, v) => sum + elapsed(v), 0),
      visits: windowVisits.length,
      channels: new Set(windowVisits.map((v) => v.channel_id).filter(Boolean)).size,
    },
    per_channel: channels
      .map((c) => ({
        id: c.id,
        number: c.number,
        title: c.title,
        seconds: windowTotals.get(c.id)?.seconds ?? 0,
        visits: windowTotals.get(c.id)?.visits ?? 0,
      }))
      .filter((row) => row.visits > 0)
      .sort((a, b) => b.seconds - a.seconds || b.visits - a.visits),
    quiet: channels
      .filter((c) => !totals.has(c.id))
      .map((c) => ({ id: c.id, number: c.number, title: c.title })),
    entry_methods: [...methodCounts.entries()]
      .map(([key, count]) => ({
        key,
        label: LABELS[key] ?? key,
        count,
        percent: visits.length ? Math.round((count / visits.length) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count),
    has_data: sessions.length > 0 || visits.length > 0,
  };
}

// ──────────────────────────────────────────────────────────────── activity

export interface ActivityStream {
  events: {
    id: string;
    action_type: string;
    description: string;
    target_channel_id: string | null;
    created_at: string;
    author: { id: string; name: string } | null;
  }[];
}

/**
 * The history lines that are always written pointing at a channel. One of
 * these with no pointer lost it when its channel was permanently deleted
 * (`on delete set null`), so whose channel it was can no longer be read.
 */
const CHANNEL_LINES = new Set([
  "channel_created",
  "channel_edited",
  "channel_deleted",
  "channel_restored",
  "channel_purged",
]);

/**
 * Whether one history line may reach this reader (access-1).
 *
 * A line's description is a sentence with the channel's label written into
 * it, so hiding the channel means hiding the line. Three tests, in order:
 * the channel it points at; for a line about a channel that has been
 * permanently deleted — which points at nothing because the row is gone —
 * the fact that its privacy can no longer be read, so it is shown only to
 * someone who sees everything; and, for every line, whether the text names
 * a channel this reader cannot see or cannot vouch for (a completed mission
 * quoting a purged channel's title, or an old title since renamed).
 */
function visibleEvent(
  e: { action_type: string; description: string; target_channel_id: string | null },
  scope: ChannelScope
): boolean {
  if (scope.whole) return true;
  if (!scope.allows(e.target_channel_id)) return false;
  if (!e.target_channel_id && CHANNEL_LINES.has(e.action_type)) return false;
  return !scope.mentionsHidden(e.description);
}

/** What has happened in the archive lately, newest first. */
export async function activityStream(
  archiveId: string,
  scope: ChannelScope,
  limit = 100
): Promise<ActivityStream> {
  const res = await supabase
    .from("activity_log")
    .select(
      "id, action_type, description, target_channel_id, created_at, author:people!activity_log_author_id_fkey(id, name)"
    )
    .eq("archive_id", archiveId)
    .order("created_at", { ascending: false })
    .limit(Math.min(limit, 200));

  const rows = must<
    {
      id: string;
      action_type: string;
      description: string;
      target_channel_id: string | null;
      created_at: string;
      author?: unknown;
    }[]
  >(res, "activity").filter((e) => visibleEvent(e, scope));

  return {
    events: rows.map((e) => {
      const author = one(e.author as { id: string; name: string } | null);
      return {
        id: e.id,
        action_type: e.action_type,
        description: e.description,
        target_channel_id: e.target_channel_id ?? null,
        created_at: e.created_at,
        author: author ? { id: author.id, name: author.name } : null,
      };
    }),
  };
}

// ────────────────────────────────────────────────────────────────── device

export interface DeviceStream {
  display: { paired: boolean; online: boolean; last_seen_at: string | null };
  /*
    The build the trusted screen last reported (041). Null means the machine
    has never said — paired before the column existed, or running a build too
    old to report — and the card stays silent rather than inventing a number.
  */
  software_version: string | null;
  /** Declared gaps (F21): nothing reports these yet. Null means "not
   *  measured", never "zero". Storage is M132's. */
  storage: null;
  backup: null;
}

/** The family screen's presence, and the facts we honestly do not have. */
export async function deviceStream(archiveId: string): Promise<DeviceStream> {
  const [installRes, screen] = await Promise.all([
    supabase
      .from("installations")
      .select("id, is_trusted, last_used_at, revoked_at, software_version")
      .eq("archive_id", archiveId),
    screenNow(archiveId),
  ]);

  const installations = must<
    {
      id: string;
      is_trusted: boolean;
      last_used_at: string | null;
      revoked_at: string | null;
      software_version: string | null;
    }[]
  >(installRes, "device");

  const trusted = installations.find((i) => i.is_trusted && !i.revoked_at);
  const candidates = [screen.synced_at, screen.last_seen_at, trusted?.last_used_at ?? null].filter(
    (t): t is string => !!t
  );
  const last_seen_at = candidates.length
    ? candidates.reduce((a, b) => (new Date(a) > new Date(b) ? a : b))
    : null;

  return {
    display: { paired: !!trusted, online: screen.live, last_seen_at },
    // The trusted screen's build — the family's one display, not whichever
    // installation happened to sort first.
    software_version: trusted?.software_version ?? null,
    storage: null,
    backup: null,
  };
}
