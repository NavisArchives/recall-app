export interface Author {
  id: string;
  name: string;
  relationship: string | null;
  profile_picture_url: string | null;
  description: string | null;
  birthday: string | null;
  created_at: string;
  // Only present for an admin; never sent to the display.
  email?: string | null;
  contact_number?: string | null;
  role?: "user" | "admin" | "co_author";
  /*
    The ACCESS axis (043). "remembered" is a contributor who has died — it
    withdraws sign-in like "deactivated" but means something entirely
    different to a family, and is never shown in the same words.
  */
  status?: "pending" | "active" | "deactivated" | "remembered";
  /** The VISIBILITY axis (043): does her screen show this face. */
  show_on_display?: boolean;
  /*
    When a PIN lockout expires, or null. NOT a status (frame 12m): a locked
    person is still `active` and their pill stays green — this is a live fact
    with a clock on it, sitting beside the status rather than replacing it.
  */
  locked_until?: string | null;
  /**
   * When they accepted an invitation, or null for a face an admin put on the
   * shelf who has never signed in. The invite flow tells the two apart by it.
   */
  joined_at?: string | null;
  /** Admin-only, like the two contact fields above (frame 12a, DETAILS). */
  address?: string | null;
  /**
   * The last time they signed in, or null if never (frames 12a, 12k, 12m).
   *
   * Admin-only: it is a record kept *about* somebody, which is why "My Info"
   * does not show it back to them.
   */
  last_seen_at?: string | null;
  /**
   * The private note administrators keep about a person (frame 12, 044).
   *
   * Never in the member or display column sets — it is as private as the
   * phone number, and sometimes considerably more delicate.
   */
  admin_note?: string | null;
  /** Who added them to the archive (frame 12a, DETAILS · ADDED BY). */
  created_by?: string | null;
}

export type ChannelContentType = "album" | "video" | "documentary" | "instruction" | "stories";

export interface Channel {
  id: string;
  number: number;
  title: string;
  description: string | null;
  content_type: ChannelContentType;
  date: string | null;
  author_id: string | null;
  created_by?: string | null;
  privacy_level?: 1 | 2 | 3;
  author?: Author | null;
  created_at: string;
  /** Present on the channel list, used by the admin dashboard totals. */
  media_count?: number;
  photo_count?: number;
  video_count?: number;
  /** Photos with no words yet — what a describe mission counts down. */
  undescribed_count?: number;
  /** First photo of the channel, used as its cover on the overview shelf. */
  cover_url?: string | null;
}

/** The person the archive is for — the one row of `settings`. */
export interface SubjectProfile {
  /** When the archive was opened — the postcard's provenance line (23a). */
  archive_since?: string | null;
  /** The postal address postcards go to, as printed on the envelope (053). */
  delivery_address?: string | null;
  display_name: string;
  full_name: string | null;
  birth_date: string | null;
  residence: string | null;
  preferred_language: string | null;
  care_since: string | null;
  /** The things that reliably reach her — shown as "Loves: …". */
  important_anchors: string | null;
  note: string | null;
  photo_url: string | null;
}

/** `audio` since 051 — a voice message is a media file like any other. */
export type MediaFileType = "image" | "video" | "audio";

export interface MediaFile {
  id: string;
  channel_id: string;
  file_type: MediaFileType;
  display_order: number;
  /** Optional per-photo detail; the channel's description/date is the fallback. */
  caption: string | null;
  taken_on: string | null;
  /**
   * How much of `taken_on` the family actually told us (059). Never print the
   * day unless this says "day": every screen that writes a date is a month
   * picker that appends "-01", so a missing precision means month.
   */
  taken_precision: "year" | "month" | "day" | null;
  /** Where it was taken, from the archive's own list of places (059). */
  place_id: string | null;
  /** That place's name, when a route that reads photographs supplies it. */
  place?: string | null;
  /** Who is in it, as person ids (059). Empty when nobody has said. */
  people?: string[];
  /** Short-lived signed URL minted by the backend; null if signing failed. */
  url: string | null;
}

export type ChannelWithMedia = Channel & {
  author: Author | null;
  media: MediaFile[];
  /**
   * Whether this viewer may change the channel — decided by the server, so
   * the screen states the rule instead of deriving it a second time and
   * risking a different answer (M49).
   */
  can_edit?: boolean;
  /** Who may change it, by name — for the lock a non-editor sees. */
  created_by_name?: string | null;
};
