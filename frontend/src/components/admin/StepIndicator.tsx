import { Check } from "lucide-react";

/**
 * Overhead progress for a multi-step form. Completed steps stay clickable so
 * someone can go back and correct an answer without losing what they typed;
 * steps ahead are not, since they may depend on what has not been filled in.
 */
export function StepIndicator({
  steps,
  current,
  furthest,
  onSelect,
}: {
  steps: string[];
  current: number;
  furthest: number;
  onSelect: (index: number) => void;
}) {
  return (
    <ol className="flex items-center gap-2">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        const reachable = i <= furthest;

        return (
          <li key={i} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              onClick={() => reachable && onSelect(i)}
              disabled={!reachable}
              aria-current={active ? "step" : undefined}
              className="flex items-center gap-3 disabled:cursor-default"
            >
              <span
                className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-sm font-medium transition-colors"
                style={{
                  background: done ? "var(--accent)" : active ? "var(--accent-tint)" : "transparent",
                  border: `1px solid ${done || active ? "var(--accent)" : "var(--line)"}`,
                  color: done ? "var(--accent-foreground)" : active ? "var(--accent-soft)" : "var(--fg-faint)",
                }}
              >
                {done ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
              </span>

              {/*
                Only when the label says something the circle does not. The
                signup passes names ("Family", "You") and those render; the
                describe sequence passes plain numbers, and the circle
                already says the number — "② 2" twice per step, six times
                across the rail, was pure noise.
              */}
              {label !== String(i + 1) && (
                <span
                  className="whitespace-nowrap text-sm"
                  style={{ color: active ? "var(--fg)" : "var(--fg-faint)" }}
                >
                  {label}
                </span>
              )}
            </button>

            {i < steps.length - 1 && (
              <span
                aria-hidden
                className="h-px flex-1 transition-colors"
                style={{ background: done ? "var(--accent)" : "var(--line-soft)" }}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
