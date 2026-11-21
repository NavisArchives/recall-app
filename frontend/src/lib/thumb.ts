/**
 * A media URL at grid size.
 *
 * The backend resizes on `?w=` from a CLOSED list (320 / 640 / 1280 —
 * mediaHotCache.ts). A 200px tile fed a full original was most of "pictures
 * load slow": right for the lightbox, absurd for a grid. Only media-file
 * URLs understand the parameter; anything else is returned untouched, so
 * this is safe to wrap around any src.
 */
export function thumb(url: string | null | undefined, w: 320 | 640 | 1280): string | undefined {
  if (!url) return undefined;
  if (!url.includes("/media/") || !url.includes("/file")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}w=${w}`;
}
