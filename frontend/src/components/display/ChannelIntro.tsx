import { px } from "@/lib/designSpace";

/**
 * The words column every content channel shares — spec 24, §6.
 *
 * Words only. Who added it is `ContributorChip`, which has one fixed place
 * on the screen and is not part of this ramp — see that file for why.
 *
 * One ramp, one order, on the film screen, the album and the voice message:
 *
 *   **type · date** — one mono line, not two
 *   **title** — as the family authored it
 *   an optional **accent line** — the one amber thing on the screen
 *   **description**
 *   **who it is from**
 *
 * The order is the correction. This column used to run type → title → date →
 * text, with the date on its own line under the title, which reads as a
 * subtitle to the memory rather than as a fact about it. In the design the
 * date sits **next to the type** in the same small mono line — the two pieces
 * of filing information together, above the thing itself.
 *
 * Shared rather than copied because 24d, 24e and 24b are the same column with
 * different words. Two copies drift, and the drift shows up as one screen's
 * title being a size the other's is not.
 */

const CREAM = "#F2F1EE";
const MUTED = "rgba(242,241,238,.55)";
const BODY = "rgba(242,241,238,.72)";
const ACCENT_TEXT = "#E29A68";

/** `AUGUST 2024` — the month a memory belongs to, never the exact day. */
export function monthOf(date: string | null | undefined): string | null {
  if (!date) return null;
  const when = new Date(date);
  if (Number.isNaN(when.getTime())) return null;
  return when.toLocaleDateString("en-GB", { month: "long", year: "numeric" }).toUpperCase();
}

/** `A FILM · AUGUST 2024`, or just `A FILM` when nothing dates it. */
export function eyebrow(kind: string, date: string | null | undefined): string {
  const month = monthOf(date);
  return month ? `${kind} · ${month}` : kind;
}

export function ChannelIntro({
  eyebrow: eyebrowText,
  title,
  titleSize = 48,
  accent,
  description,
  descriptionSize = 20,
}: {
  eyebrow: string;
  title: string;
  /** 48 on the film, 56 on the album — the spec's own two sizes. */
  titleSize?: number;
  /** The one amber line: the album's per-photograph date. */
  accent?: string | null;
  description?: string | null;
  /** 20 on the film, 22 on the album — the spec's own two sizes. */
  descriptionSize?: number;
}) {
  return (
    <>
      <p
        className="font-mono uppercase"
        style={{ fontSize: px(12), letterSpacing: ".26em", color: MUTED }}
      >
        {eyebrowText}
      </p>

      {/* As the family wrote it — their language, their capitals. */}
      <h1
        style={{
          font: `700 ${px(titleSize)}/1.12 Roboto, sans-serif`,
          color: CREAM,
          marginTop: px(20),
        }}
      >
        {title}
      </h1>

      {/* Amber is spent on exactly one thing per screen: the thing that
          changes. On the album that is the date, which moves with the
          photograph — so it is never given to something that sits still. */}
      {accent && (
        <p
          style={{
            /* italic lives in the shorthand — see Overview.tsx: `font:` resets
               font-style, and an inline style outranks the utility class. */
            font: `italic 300 ${px(24)}/1.3 Roboto, sans-serif`,
            color: ACCENT_TEXT,
            marginTop: px(14),
          }}
        >
          {accent}
        </p>
      )}

      {description && (
        <p
          style={{
            font: `300 ${px(descriptionSize)}/1.55 Roboto, sans-serif`,
            color: BODY,
            marginTop: px(18),
            maxWidth: "24ch",
            textWrap: "pretty",
          }}
        >
          {description}
        </p>
      )}

    </>
  );
}
