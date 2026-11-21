import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Author, Channel } from "@/types";

/**
 * A physical card that opens a channel — a tag someone taps, or a postcard
 * Recall prints and posts (design §18, migration 047).
 *
 * Nothing the channel already knows is stored on the card: the number, title
 * and description come through the embed, so correcting a channel corrects
 * every card that opens it. That is the brief's rule — "the channel is the
 * source of truth" — expressed as a type.
 */
/*
  The DATA word stays `nfc`; the PRODUCT word is "connected card" (naming
  decision, 20-product-backlog.md, binding): postcards / Recall cards are
  the product, NFC is never its name in the UI. Renaming the enum would
  churn the database for a vocabulary choice — the boundary is the label
  layer, and every visible string says "connected".
*/
export type CardKind = "nfc" | "postcard";
/** Postcards only. A tag has no send lifecycle, so its state is null (047). */
export type CardState =
  | "draft"
  | "ready"
  | "queued"
  | "printing"
  | "shipped"
  | "sent"
  | "delivered"
  | "returned"
  /* 050. A card the print house could not produce — internal to the
     fulfilment queue (18j); the family is never shown it, and its reason
     is deliberately absent from CARD_COLUMNS. It is in this union because
     the state can still reach a workspace read, and a union that omits it
     would make `state` lie about what the server can send. */
  | "failed";

export interface NfcCard {
  id: string;
  label: string;
  tag_code: string | null;
  channel_id: string | null;
  linked_object: string | null;
  created_at: string;
  kind: CardKind;
  state: CardState | null;
  media_file_id: string | null;
  recurrence: "once" | "weekly" | "monthly";
  photo_mode: "chosen" | "newest";
  next_send_at: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  returned_at: string | null;
  failed_at: string | null;
  shipping_carrier: string | null;
  shipping_reference: string | null;
  /**
   * When the archive was opened — NOT a column on nfc_cards. The postcard
   * back's provenance block reads it (23a); callers that hold the settings
   * payload spread it in before handing a card to the preview. Optional so
   * the API's own rows, which never carry it, still satisfy the type.
   */
  archive_since?: string | null;
  channel?: { id: string; number: number; title: string; description?: string | null } | null;
  linker?: { id: string; name: string } | null;
  photo?: { id: string; url: string; caption: string | null } | null;
  sender?: { id: string; name: string; relationship: string | null } | null;
  recipient?: { id: string; name: string } | null;
}

export interface Mission {
  id: string;
  title: string;
  detail: string | null;
  status: "suggested" | "in_progress" | "completed";
  assigned_to: string | null;
  created_at: string;
  completed_at: string | null;
  assignee?: { id: string; name: string } | null;
  /** Where the mission happens, and what counts as done. */
  channel_id: string | null;
  media_id: string | null;
  task_kind:
    | "describe_photos"
    | "link_nfc"
    | "add_photos"
    | "record"
    | "custom"
    | "create_channel"
    | null;
  task_count: number | null;
  /** Who wrote it: a person, or the rule engine mirroring a finding. */
  origin: "human" | "recall";
  rule_key: string | null;
  assigned_by: string | null;
  assigner?: { id: string; name: string } | null;
  channel?: { id: string; number: number; title: string } | null;
}

export interface ActivityRow {
  id: string;
  action_type: string;
  description: string;
  created_at: string;
  author?: { id: string; name: string } | null;
}

export interface SuggestionRow {
  id: string;
  channel_id: string | null;
  rule_key: string;
  message: string;
  severity: "info" | "warning";
  channel?: { id: string; number: number; title: string } | null;
}

export interface SuggestionsPayload {
  items: SuggestionRow[];
  groups: { rule_key: string; count: number; label: string }[];
  health: number;
}

export interface ScreenState {
  /** True while the display has reported within the liveness window. */
  live: boolean;
  current_channel_number: number | null;
  /*
    Which photograph is up, as the display reported it (040). 0-based —
    readers add one for people. Null together means "not reported", and the
    UI says nothing about position rather than guessing.
  */
  photo_index: number | null;
  photo_count: number | null;
  screen_synced_at: string | null;
  last_channel_number: number | null;
  last_seen_at: string | null;
  /** What the family calls the screen, or null when it has no name (M146). */
  display_name: string | null;
}

export type InsightsRange = "today" | "week" | "month";

export interface InsightsPayload {
  range: InsightsRange;
  /*
    `seconds` is screen-awake time (device_sessions); `channel_seconds` is
    time inside channels (channel_visits). Two measurements, never one
    sentence — see the note on EngagementStream in backend streams.ts.
    The block covers the asked-for window (M115 strand 3).
  */
  window: {
    range: InsightsRange;
    seconds: number;
    sessions: number;
    channel_seconds: number;
    visits: number;
    channels: number;
  };
  most_visited: { id: string; number: number; title: string; seconds: number; visits: number }[];
  quiet: { id: string; number: number; title: string }[];
  entry_methods: { key: string; label: string; count: number; percent: number }[];
  has_data: boolean;
}

export const useChannels = () =>
  useQuery({ queryKey: ["channels"], queryFn: () => api.get<Channel[]>("/channels") });

/**
 * Everyone in the family, for anyone in the family.
 *
 * This used to be called as `usePeople(isAdmin)`, so a co-author's Overview
 * rendered the Contributors heading above nothing at all — the faces of the
 * people she works alongside, withheld from her. The API has always allowed
 * the read; only the fetch was gated. What a helper may *change* about a
 * person is still the server's business, and still admin-only.
 */
export const usePeople = (enabled = true) =>
  useQuery({ queryKey: ["people"], queryFn: () => api.get<Author[]>("/people"), enabled });

export const useNfcCards = () =>
  useQuery({ queryKey: ["nfc-cards"], queryFn: () => api.get<NfcCard[]>("/nfc-cards") });

export const useMissions = () =>
  useQuery({ queryKey: ["missions"], queryFn: () => api.get<Mission[]>("/missions") });

export const useActivity = (limit = 100) =>
  useQuery({
    queryKey: ["activity", limit],
    queryFn: () => api.get<ActivityRow[]>(`/activity?limit=${limit}`),
  });

export const useSuggestions = () =>
  useQuery({
    queryKey: ["suggestions"],
    queryFn: () => api.get<SuggestionsPayload>("/suggestions"),
  });

export const useInsights = (range: InsightsRange = "week", enabled = true) =>
  useQuery({
    queryKey: ["insights", range],
    queryFn: () => api.get<InsightsPayload>(`/insights?range=${range}`),
    enabled,
  });

/*
 * M103 — the upgraded backend's streams, as the frontend reads them.
 * Shapes mirror `backend/src/services/streams.ts`, the one source of every
 * fact below; only the fields the workspace consumes are typed here.
 */
export interface ContentStreamPayload {
  channels: number;
  photos: number;
  videos: number;
  described: { captioned: number; photos: number; pct: number | null };
  additions: {
    total: number;
    this_week: number;
    this_month: number;
    by_month: { month: string; count: number }[];
  };
  shelf: {
    id: string;
    number: number;
    title: string;
    content_type: string;
    photo_count: number;
    video_count: number;
    cover_media_id: string | null;
    live: boolean;
  }[];
}

export interface EngagementStreamPayload {
  watched_today: { seconds: number; visits: number };
  longest_sit: {
    seconds: number;
    channel_id: string | null;
    channel_number: number | null;
    channel_title: string | null;
  } | null;
  by_day: { day: string; seconds: number; visits: number }[];
  has_data: boolean;
}

export interface DeviceStreamPayload {
  display: { paired: boolean; online: boolean; last_seen_at: string | null };
  /*
    The build the trusted screen last reported (041). Null means it has never
    said — the card stays quiet rather than printing a dash.
  */
  software_version: string | null;
  /** Still-declared gaps — null means "not measured", never zero. */
  storage: null;
  backup: null;
}

export interface PeopleStreamPayload {
  contributors: number;
  circle: {
    id: string;
    name: string;
    relationship: string | null;
    role: string;
    status: string;
    joined_at: string | null;
    channels_authored: number;
    channels_created: number;
    media_added: number;
  }[];
}

export const usePeopleStream = () =>
  useQuery({
    queryKey: ["streams", "people"],
    queryFn: () => api.get<PeopleStreamPayload>("/streams/people"),
  });

export const useContentStream = () =>
  useQuery({
    queryKey: ["streams", "content"],
    queryFn: () => api.get<ContentStreamPayload>("/streams/content"),
  });

export const useEngagementStream = () =>
  useQuery({
    queryKey: ["streams", "engagement"],
    queryFn: () => api.get<EngagementStreamPayload>("/streams/engagement"),
  });

/** The synced line breathes with the display, so it asks again each minute. */
export const useDeviceStream = () =>
  useQuery({
    queryKey: ["streams", "device"],
    queryFn: () => api.get<DeviceStreamPayload>("/streams/device"),
    refetchInterval: 60_000,
  });

/** The shelf marks one card ON SCREEN, so it asks again every half minute. */
export const useScreenState = () =>
  useQuery({
    queryKey: ["screen-state"],
    queryFn: () => api.get<ScreenState>("/screen-state"),
    refetchInterval: 30_000,
  });

/*
  The ask (8a→8b, M104's retrieval root). One snippet per matched thing,
  each carrying its provenance; the page groups them into "the channels
  that hold it". Fires only on a submitted question — the dropdown while
  typing shows the action and recents, never half-fetched results.
*/
/**
 * Where a match happened, in characters, in the snippet's own `text`
 * (M154). Produced by the matcher itself so the card can mark the exact
 * words that caused the result — never re-derived here, which would put a
 * second copy of the matching rule in the browser.
 */
export interface MatchRange {
  start: number;
  end: number;
}

export interface AskSnippet {
  source: "channel" | "photo" | "person";
  text: string;
  matched_terms: string[];
  matches: MatchRange[];
  provenance:
    | {
        channel_id: string;
        channel_number: number;
        channel_title: string;
        media_id?: string;
        media_url?: string;
      }
    | { person_id: string; name: string };
}

/*
  What the archive *recognised* in the question, which is rarely the whole
  question. The page used to quote the sentence back — "'Did She Hang Out
  With A Cat' has been found in 4 channels" — and that reads as a claim
  that the archive holds that sentence. It holds one word of it.

  `label` is the thing worth naming: a person in the archive's own spelling
  (type "helene", the archive knows Hélène), else the words that
  actually matched, else null when nothing did.
*/
export interface AskSubject {
  label: string | null;
  people: { id: string; name: string; relationship: string | null }[];
  terms: string[];
}

export interface AskResult {
  query: string;
  subject: AskSubject;
  results: AskSnippet[];
  corpus: {
    channels: number;
    captioned_photos: number;
    people: number;
    voice_notes: { available: false; reason: string };
  };
}

export const useAsk = (question: string) =>
  useQuery({
    queryKey: ["ask", question],
    queryFn: () => api.get<AskResult>(`/search?q=${encodeURIComponent(question)}`),
    enabled: question.trim().length > 0,
    staleTime: 60_000,
  });
