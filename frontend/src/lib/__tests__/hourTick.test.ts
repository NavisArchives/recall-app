import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { HOUR_POLL_MS, watchHour } from "../hourTick";

/**
 * The half of the greeting nothing tested.
 *
 * `greeting.test.ts` pins what her screen says at every hour of the day, and
 * pins it well. It says nothing about whether the screen ever *notices* that
 * the hour has changed — and her display is a television that has been on
 * since somebody set it up, so noticing is the entire feature. Delete the
 * interval and every greeting test still passes while the screen sits on
 * "Good morning" until the next power cut.
 *
 * The loop was four lines inside `Home.tsx`, unexported, and these tests run
 * in node with no DOM, so there was no way to reach it. Moving it out is what
 * makes the cases below possible; the cases are the point.
 */

/** A clock the test moves by hand, so a boundary costs a millisecond. */
function clockAt(hour: number) {
  let at = new Date(2026, 7, 22, hour, 30, 0);
  return {
    now: () => at,
    set: (h: number) => {
      at = new Date(2026, 7, 22, h, 30, 0);
    },
    /** Midnight is its own case — the day rolls over, not just the hour. */
    setNextDay: (h: number) => {
      at = new Date(2026, 7, 23, h, 30, 0);
    },
  };
}

/*
  Only the interval is faked.

  A bare `vi.useFakeTimers()` also replaces the timers vitest itself runs on,
  and every case below died with "Test timed out in 5000ms" — a synchronous
  test body timing out, which is the runner starving rather than the code
  failing. Naming what to fake keeps the harness on real time and the code
  under test on ours.
*/
beforeEach(() => vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] }));
afterEach(() => vi.useRealTimers());

describe("the screen notices when the hour turns", () => {
  it("says nothing while the hour has not changed", () => {
    const clock = clockAt(10);
    const changed = vi.fn();
    const stop = watchHour(changed, clock.now);

    // A full hour of polling, with the clock held still.
    vi.advanceTimersByTime(60 * HOUR_POLL_MS);

    expect(changed).not.toHaveBeenCalled();
    stop();
  });

  it("reports the new hour once when it turns, not once per poll", () => {
    const clock = clockAt(10);
    const changed = vi.fn();
    const stop = watchHour(changed, clock.now);

    clock.set(11);
    vi.advanceTimersByTime(30 * HOUR_POLL_MS);

    expect(changed).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledWith(11);
    stop();
  });

  it("keeps working — it is not a one-shot", () => {
    const clock = clockAt(10);
    const changed = vi.fn();
    const stop = watchHour(changed, clock.now);

    for (const h of [11, 12, 13]) {
      clock.set(h);
      vi.advanceTimersByTime(HOUR_POLL_MS);
    }

    expect(changed.mock.calls.map(([h]) => h)).toEqual([11, 12, 13]);
    stop();
  });

  /*
    The case that fails only in the small hours.

    `hour > shown` reads like "has time moved on", is true every daytime hour,
    and passes every test above. At **midnight** 23 is followed by 0, so the
    screen would stop updating for the rest of the night — which is precisely
    the three-in-the-morning failure M172 was about, reintroduced one
    comparison lower down. Written as its own case so it cannot be lost.
  */
  it("turns over at midnight, when the new hour is a SMALLER number", () => {
    const clock = clockAt(23);
    const changed = vi.fn();
    const stop = watchHour(changed, clock.now);

    clock.setNextDay(0);
    vi.advanceTimersByTime(HOUR_POLL_MS);

    expect(changed).toHaveBeenCalledWith(0);
    stop();
  });

  it("stops when the screen is torn down, rather than ticking forever", () => {
    const clock = clockAt(10);
    const changed = vi.fn();
    const stop = watchHour(changed, clock.now);

    stop();
    clock.set(11);
    vi.advanceTimersByTime(30 * HOUR_POLL_MS);

    expect(changed).not.toHaveBeenCalled();
  });

  /*
    The value, not just the mechanism. At ten minutes she could read "Good
    morning" well into the afternoon; the point of polling at all is that the
    greeting is never meaningfully behind the clock.
  */
  it("re-reads the clock at least once a minute", () => {
    expect(HOUR_POLL_MS).toBeGreaterThan(0);
    expect(HOUR_POLL_MS).toBeLessThanOrEqual(60_000);
  });

  /*
    The control. Every assertion above is about a callback NOT firing or
    firing once, and all of them would pass just as well against a `watchHour`
    that did nothing at all. This one proves the loop runs.
  */
  it("is actually polling — a changed clock alone is not enough", () => {
    const clock = clockAt(10);
    const changed = vi.fn();
    const stop = watchHour(changed, clock.now);

    clock.set(11);
    expect(changed).not.toHaveBeenCalled(); // no time has passed yet

    vi.advanceTimersByTime(HOUR_POLL_MS);
    expect(changed).toHaveBeenCalledWith(11);
    stop();
  });
});

/**
 * The last link, which no test above can reach.
 *
 * Everything else proves `watchHour` works. None of it proves the home
 * screen still *calls* it — and there is no DOM in this suite, so the hook
 * cannot be rendered. Delete the `useEffect` from `Home.tsx` and the loop
 * stays perfect while nothing subscribes to it.
 *
 * So this reads the source as text, the way `pageRegistry.test.ts` does, and
 * for the same reason: importing the page would drag React and a dozen lazy
 * chunks into a node test to answer a question about one line.
 *
 * Comments are stripped first (M221). The file's own doc comment explains
 * why the greeting must not be read once at mount, and a regex looking for
 * `watchHour` would happily match a sentence *about* `watchHour` — coverage
 * that is doubly false, because the prose is thickest exactly where the code
 * matters most.
 */
describe("her home screen actually subscribes to it", () => {
  const source = readFileSync(new URL("../../pages/Home.tsx", import.meta.url).pathname, "utf8");
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");

  /*
    The control, first. If the stripper ate the file, every assertion below
    would pass by finding nothing in an empty string.
  */
  it("still has a page to look at after the comments are stripped", () => {
    expect(code).toMatch(/export function Home\(\)/);
    expect(code.length).toBeGreaterThan(500);
  });

  it("calls watchHour in code, not merely in a comment about it", () => {
    expect(code).toMatch(/watchHour\s*\(/);
    expect(code).toMatch(/import \{ watchHour \} from "@\/lib\/hourTick"/);
  });

  /*
    And that the hour it renders is the ticking one. `greetingFor(new
    Date().getHours(), …)` would read the clock once at mount and never
    again — the original bug, in a form that keeps the import and the
    subscription and still freezes the screen.
  */
  it("greets from the ticking hour, never from a fresh Date at render", () => {
    expect(code).toMatch(/greetingFor\(hour,/);
    expect(code).not.toMatch(/greetingFor\(\s*new Date/);
  });
});