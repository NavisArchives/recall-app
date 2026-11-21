import { StepIndicator } from "@/components/admin/StepIndicator";

/**
 * An ordered list of things, worked one at a time, with overhead progress.
 *
 * Built for M39 — a mission that asks for four photographs used to hand over
 * all four at once, with four description boxes, no sense of which one you
 * were on and no way to tell when you were done. It is the same interaction
 * an instruction channel needs (M38): a sequence of photographs with words,
 * walked through in order. Whichever came first was to build it; this is it.
 * The second must use it rather than copy it.
 *
 * Three rules it exists to keep:
 *
 * **One item on screen.** Everything that is not the current item recedes.
 *
 * **Next is never disabled.** A carer standing up, in a hurry, must always be
 * able to move. Nothing is quietly lost either — a skipped item stays
 * visibly unfinished, and whoever owns the sequence decides what that means
 * for finishing.
 *
 * **No auto-scroll.** With one item in focus there is nothing to scroll to,
 * and a page that moves under the reader is worse than one that does not.
 */

export interface SequenceItem {
  /** Stable across renders — a file preview URL or a row id. */
  key: string;
  /** True when this item has what the sequence asked for. */
  done: boolean;
}

export function GuidedSequence({
  items,
  index,
  onIndex,
  noun = "photo",
  children,
}: {
  items: SequenceItem[];
  index: number;
  onIndex: (next: number) => void;
  /** What one item is called, for the count. */
  noun?: string;
  /** Renders the item in focus. */
  children: (item: SequenceItem, index: number) => React.ReactNode;
}) {
  if (items.length === 0) return null;

  const current = Math.min(index, items.length - 1);
  const item = items[current];
  const remaining = items.filter((i) => !i.done).length;

  /*
   * Every step is reachable, forwards and back.
   *
   * `StepIndicator` takes a `furthest` so a form cannot jump ahead of what
   * has been filled in — right for a signup, wrong here. These items are
   * independent: the words on photo four do not depend on the words on photo
   * one, and someone who wants to describe the memorable one first should
   * not be told to work in order. Skipping is allowed, so being able to go
   * back to what was skipped is the other half of allowing it.
   */
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-none items-center justify-between gap-4">
        <span className="font-mono text-[10px] tracking-[0.16em] text-fg-faint">
          {noun.toUpperCase()} {current + 1} OF {items.length}
        </span>
        <span className="text-[13px] text-fg-muted">
          {remaining === 0
            ? "Every one has words."
            : `${remaining} still without words`}
        </span>
      </div>

      {/* Dots rather than names: nine photographs have no useful labels, and
          numbering them is what the count above already does. */}
      <div className="flex-none">
        <StepIndicator
          steps={items.map((_, i) => String(i + 1))}
          current={current}
          furthest={items.length - 1}
          onSelect={onIndex}
        />
      </div>

      <div className="min-h-0 flex-1">{children(item, current)}</div>

      <div className="flex flex-none items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => onIndex(Math.max(0, current - 1))}
          disabled={current === 0}
          className="text-[13px] text-fg-muted disabled:opacity-30"
        >
          ← Back
        </button>

        <span className="text-[13px] text-fg-faint">
          {item.done ? "Described" : "Not described yet"}
        </span>

        {/*
          Never disabled — on the last item it stops moving rather than
          becoming unpressable, so the button never turns into a dead end
          somebody is left staring at.
        */}
        <button
          type="button"
          onClick={() => onIndex(Math.min(items.length - 1, current + 1))}
          className="pressable rounded-full px-[22px] py-[9px] text-[13px] font-medium text-white"
          style={{
            background: current === items.length - 1 ? "transparent" : "var(--accent)",
            border: current === items.length - 1 ? "1px solid var(--line)" : undefined,
            color: current === items.length - 1 ? "var(--fg-muted)" : "#fff",
          }}
        >
          {current === items.length - 1 ? "Last one" : item.done ? "Next →" : "Skip for now →"}
        </button>
      </div>
    </div>
  );
}
