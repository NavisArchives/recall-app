/**
 * How far the archive has come, counted upward.
 *
 * This number used to be "ARCHIVE HEALTH 32%" over an amber-to-red bar, and
 * M63 removed it: a family two days in met a failing mark on their mother's
 * archive, and a score is a verdict. The owner's answer to that question
 * (QUESTIONS.md Q1) was not to delete the number but to turn it around —
 * "30% has been done shows the family has to work, no need for red."
 *
 * So the same value now reads as progress. It counts up toward a full shelf
 * rather than down from a broken one, it is never red or amber in any state,
 * and it is fine that it is not 100%: the gap is the invitation. The factual
 * lines underneath say *what* is left; this says *how far*.
 *
 * One component for both surfaces, so the desktop sidebar and the phone can
 * never quietly disagree about the same number.
 */
export function ArchiveProgress({
  health,
  className = "",
}: {
  /** The `health` field from /api/suggestions — 0-100. */
  health: number;
  className?: string;
}) {
  const percent = Math.max(0, Math.min(100, Math.round(health)));

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] tracking-[0.16em] text-fg-faint">
          READY FOR THE SCREEN
        </span>
        <span className="text-[13px] font-medium" style={{ color: "var(--accent-soft)" }}>
          {percent}%
        </span>
      </div>

      {/*
        A calm bar: the accent at tint strength for the track, the accent
        itself for the distance covered. No conditional colour — a low number
        is early, not wrong, and nothing here should ever alarm.
      */}
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full"
        style={{ background: "var(--accent-tint)" }}
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="How much of the archive is ready for the screen"
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${percent}%`, background: "var(--accent)" }}
        />
      </div>
    </div>
  );
}
