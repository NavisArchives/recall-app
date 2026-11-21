import { useNavigate } from "react-router-dom";

/**
 * The way back, everywhere — one shape, drawn once.
 *
 * A long rule with a chevron head, in a thin circle. It carries no word: the
 * circle is the control and the arrow is the sentence, which is why the
 * accessible name does the talking instead (owner, 17 Sep 2026 — "you can
 * just have our beautiful return signal, an arrow and a circle around it").
 *
 * THERE WERE THREE OF THESE. The admin kit had one, the channel-creation page
 * had its own copy, and the public pages had a literal "←" character in a
 * string — a different arrow with a different weight, which is exactly the
 * drift the owner spotted. They all point here now, so the next one cannot
 * disagree with the others.
 *
 * `to` navigates somewhere specific; with neither `to` nor `onClick` it goes
 * back one entry in history, which is what a page reached from several places
 * wants.
 */
export function BackCircle({
  to,
  onClick,
  label,
  size = 44,
  onScrim = false,
}: {
  to?: string;
  onClick?: () => void;
  /** What a screen reader says — "Back", "Terug", "Retour". */
  label: string;
  size?: number;
  /**
   * Standing on a dark scrim rather than on a page — beside the photograph
   * pop-up, for instance. It draws light instead of dark and fills solid
   * under the pointer (owner, 17 Sep 2026: "if you hover it, it becomes
   * solid"), which is the one place this control answers a hover with more
   * than a colour.
   *
   * The two appearances live in `.back-scrim` in index.css rather than here,
   * because a hover state written as an inline style needs a React
   * `onMouseLeave` to undo it — and that leave does not always arrive. See
   * the rule's own note.
   */
  onScrim?: boolean;
}) {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        if (onClick) onClick();
        else if (to) navigate(to);
        else navigate(-1);
      }}
      className={`pressable inline-flex flex-none items-center justify-center rounded-full ${
        onScrim ? "back-scrim" : "transition-colors"
      }`}
      style={{
        width: size,
        height: size,
        ...(onScrim ? {} : { border: "1px solid rgba(var(--ink),.22)", color: "var(--fg-muted)" }),
      }}
    >
      <svg
        width={Math.round(size * 0.36)}
        height={Math.round(size * 0.36)}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M19 12H5" />
        <path d="M12 19l-7-7 7-7" />
      </svg>
    </button>
  );
}
