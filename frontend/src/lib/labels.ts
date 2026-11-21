import type { Channel } from "@/types";

/**
 * The role in the family's words — or null when we were not told one.
 *
 * This used to return "User" for anything it did not recognise, **including
 * `undefined`**, and that is the fabrication class this codebase has spent a
 * week removing. `/people/:id` narrows its columns by the reader's role, so
 * a non-admin genuinely receives a person with no `role` field — and the
 * profile page printed "Daughter · User" for somebody who may well be an
 * administrator. It then branched on that invention: the ACCESS block is
 * hidden for a `user`, so an unknown role quietly changed what the page
 * offered.
 *
 * Returning null makes the absence visible at every call site, which is
 * where the decision about how to say "we don't know" belongs.
 */
export function roleLabel(role?: string): string | null {
  if (role === "admin") return "Admin";
  if (role === "co_author") return "Co-author";
  if (role === "user") return "User";
  return null;
}

/** Who can see a channel, in words rather than icons. */
export function accessLabel(privacy?: number): string {
  if (privacy === 1) return "Private";
  if (privacy === 2) return "Selected";
  return "All contributors";
}

/** "2h 05" past the hour, "24 min" under it, "0 min" honestly. */
export function durationLabel(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}`;
}

/** "just now", "4 min ago", "2 h ago", then the date. */
export function agoLabel(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** "8 photos · 1 video" — whichever parts exist. */
export function mediaLabel(channel: Channel): string {
  const parts: string[] = [];
  const photos = channel.photo_count ?? 0;
  const videos = channel.video_count ?? 0;
  if (photos) parts.push(`${photos} photo${photos > 1 ? "s" : ""}`);
  if (videos) parts.push(`${videos} video${videos > 1 ? "s" : ""}`);
  return parts.join(" · ") || "—";
}

/**
 * "Margaret's" when we know her name, "her" when we do not.
 *
 * Two sites on the contributor profile built this by hand and each got the
 * case the other handled: one wrote `{name || "her"}'s screen`, which reads
 * "her's screen" whenever the name is missing, and the other wrote
 * `{name || "her"} screen`, which reads "Margaret screen" whenever it is
 * present. Both are always wrong for exactly half their traffic, and the
 * only fix that survives is to make the possessive part of the word rather
 * than punctuation bolted on beside it.
 *
 * The subject is a real person with a real name, so this must read for any
 * name, not just the one in the fixtures. A name already ending in "s" takes
 * a plain apostrophe — "Jess' screen" — which is the gentler of the two
 * accepted forms to read aloud, and this text is read aloud to families.
 */
export function subjectPossessive(name: string | null | undefined): string {
  const trimmed = name?.trim();
  if (!trimmed) return "her";
  return /s$/i.test(trimmed) ? `${trimmed}\u2019` : `${trimmed}\u2019s`;
}

