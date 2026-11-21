/**
 * Keeping her screen's idea of the hour current.
 *
 * `new Date().getHours()` is read once, at mount, and **her display is never
 * reloaded** — it is a television in a living room that has been on since
 * somebody set it up. So a screen opened at ten in the morning would say
 * "Good morning" at three the following night however carefully the bands
 * themselves were written. Correcting the bands without this fixes the
 * arithmetic and leaves the symptom exactly where it was (M172).
 *
 * This lives outside React so the loop can be tested. The hook that used it
 * was four lines inside `Home.tsx`, unexported and unreachable from the
 * suite, and the frontend tests run in node with no DOM — so the greeting
 * strings were pinned hour by hour while the thing that *delivers* them to
 * the screen had no coverage at all. Deleting the interval left every test
 * green and froze her screen on whatever band it happened to mount in.
 */

/**
 * How often the clock is re-read.
 *
 * A minute, so the greeting is never more than a minute late at a boundary —
 * near enough that nobody looking up notices, and 1,440 cheap comparisons a
 * day rather than a re-render every second.
 */
export const HOUR_POLL_MS = 60_000;

/**
 * Calls back only when the hour actually turns — roughly twenty-four times a
 * day, not fourteen hundred. Returns the teardown.
 *
 * `now` is injectable so the loop can be driven across a boundary in a test
 * without waiting an hour for one.
 */
export function watchHour(
  onHourChange: (hour: number) => void,
  now: () => Date = () => new Date()
): () => void {
  let shown = now().getHours();

  const id = setInterval(() => {
    const hour = now().getHours();
    /*
      Inequality, never `>`.

      `hour > shown` reads as "has time moved on" and is true all day, which
      is what makes it dangerous: every daytime test passes and the screen
      freezes at **midnight**, when 23 is followed by 0. That is the three-in-
      the-morning failure this whole function exists to prevent, reintroduced
      one comparison lower down.
    */
    if (hour === shown) return;
    shown = hour;
    onHourChange(hour);
  }, HOUR_POLL_MS);

  return () => clearInterval(id);
}
