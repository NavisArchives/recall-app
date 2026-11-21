/**
 * The wordmark (design frames 16a–16f, owner 17 Sep 2026).
 *
 * RECALL in Roboto Bold, all caps, with the dot sitting after the last L
 * like a full stop — nothing behind the word, nothing overlapping it. The
 * dot rests ON the baseline rather than centred on it, which is what makes
 * it read as punctuation instead of a bullet, and the tight tracking closes
 * the caps up enough that the dot belongs to the word.
 *
 * Every number here is proportional, so one component serves every size the
 * design draws — 76px on a title card down to 19px in the header. Measured
 * off the design's own samples:
 *
 *   dot diameter   0.21em   (16/76, 12/56, 11/52, 10/46, 8/38, 4/19)
 *   gap            0.055em
 *   tracking      -0.025em
 *   baseline nudge 0.02em
 *
 * COLOUR. The word takes whatever text colour it is standing in, so it is
 * correct on the ground, on a panel, and on cream without being told. The
 * dot is `--accent` — the token, never a hex. That is the whole reason it
 * is a token: in the dark workspace the accent is amber, and on the light
 * door it is the website's vermillion, which is exactly what each of those
 * two places should show. The design frame 16b makes the same argument from
 * the other end: a hard-coded red in the logo would be the one colour the
 * system already spends on `--destructive`, so the mark would carry the
 * colour of *delete*.
 *
 * The one exception is over a photograph (16e): amber against a warm blurred
 * photo disappears, so there the dot goes cream with the word. Pass
 * `onPhoto`.
 *
 * Weight is 700, not the 900 the reference leans toward: the workspace's own
 * type never goes above 700, and the design says either works but only one
 * should ship.
 *
 * Below about 18px the caps stop holding and the dot alone carries the mark
 * — which is why the favicon is one amber disc with no letter in it
 * (public/favicon.svg).
 */
export function Wordmark({
  size = 19,
  onPhoto = false,
  className,
  style,
}: {
  /** Cap size in pixels. The dot, gap and tracking all follow it. */
  size?: number;
  /** Over a photograph the dot goes cream with the word (16e). */
  onPhoto?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "flex-end",
        /*
          The design's gap is 0.055em, which is 4px beside 76px caps and a
          useless 0.9px beside 16px ones — at header size the dot sat against
          the L and read as part of the letter. The floor keeps the full stop
          a full stop at every size; above about 36px the relative value takes
          over again and matches the reference exactly.
        */
        gap: "max(2px, 0.055em)",
        fontSize: size,
        lineHeight: 0.8,
        ...style,
      }}
    >
      <span
        style={{
          font: "700 1em/0.8 Roboto, Helvetica, Arial, sans-serif",
          letterSpacing: "-.025em",
          color: "inherit",
        }}
      >
        RECALL
      </span>
      <span
        aria-hidden
        style={{
          width: "0.21em",
          height: "0.21em",
          borderRadius: "50%",
          background: onPhoto ? "currentColor" : "var(--accent)",
          marginBottom: "0.02em",
          flex: "none",
        }}
      />
    </span>
  );
}
