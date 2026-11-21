/**
 * Design elements that are drawn but not yet fed.
 *
 * The owner's instruction: build the 20a frames completely, including the
 * parts whose data does not exist yet — but remember they are holders, and
 * raise a mission for each so the real source gets built.
 *
 * The danger with a placeholder is that it stops looking like one. A number
 * typed straight into a component is indistinguishable from a real number six
 * weeks later, which is how a dashboard comes to greet a family with a
 * confident fact nobody measured. So every one of them goes through here:
 *
 *   - `PLACEHOLDERS` is the register. One entry per unfed element, naming
 *     what it shows, why there is no source, and the mission that owes it.
 *   - `placeholderProps()` tags the rendered element `data-placeholder`, so
 *     the browser can be asked "what on this screen is not real yet?" and
 *     answer honestly.
 *
 * To find them all: `grep -rn "placeholderProps\|PLACEHOLDERS" frontend/src`,
 * or in a browser, `document.querySelectorAll("[data-placeholder]")`.
 */

export interface PlaceholderNote {
  /** What the element shows. */
  shows: string;
  /** Why there is no live value. */
  because: string;
  /** The mission that owes the real source. */
  owedBy: string;
}

export const PLACEHOLDERS: Record<string, PlaceholderNote> = {
  /*
   * M103 paid five debts from this register: archive.synced (device stream),
   * content.described and content.weekPhotos (content stream),
   * engagement.watchedToday and engagement.longestSit (engagement stream).
   * Their keys are gone because the values are measured now — the check is
   * the key's absence, not the screen looking plausible.
   */
  "ask.voice": {
    shows: "the mic button on the ask screen",
    because: "this browser has no speech engine; typing still works",
    owedBy: "a browser with SpeechRecognition — no backend is owed",
  },
  "ask.playOnScreen": {
    shows: "“Play on …'s screen” beside each answer",
    because: "nothing can change the display remotely — it reports state, it does not take orders",
    owedBy: "a mission: a push path (or display polling) for remote channel change",
  },
  "insights.watchRhythm": {
    shows: "the Mon–Sun bars and “sits down after lunch, around 14:00”",
    because: "channel_visits holds start times; nothing buckets them by day or hour",
    owedBy: "M103 · engagement stream",
  },
  "insights.additions": {
    shows: "the by-month additions bars",
    because: "no endpoint returns photographs grouped by the month they arrived",
    owedBy: "M103 · content stream",
  },
  "insights.nudge": {
    shows: "this week's nudge, and “Make it a mission”",
    because: "nothing derives a pattern from the last four weeks",
    owedBy: "no mission yet — flagged in the M107 · 1g build report",
  },
};

/**
 * Spread onto the element that shows an unfed value.
 *
 * ```tsx
 * <span {...placeholderProps("ask.playOnScreen")}>Play on her screen</span>
 * ```
 */
export function placeholderProps(key: keyof typeof PLACEHOLDERS) {
  const note = PLACEHOLDERS[key];
  return {
    "data-placeholder": key,
    title: `Placeholder — ${note.because}. Owed by ${note.owedBy}.`,
  } as const;
}
