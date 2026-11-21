import { describe, expect, it } from "vitest";
import { greetingFor } from "../greeting";

/**
 * The four bands, hour by hour.
 *
 * This is the sentence Margaret reads first, every time, and its worst
 * failure is quiet: a greeting that is confidently wrong about the time of
 * day is worse than none at all for someone already unsure of it.
 */

const say = (h: number, n: string | null = "Margaret") => {
  const g = greetingFor(h, n);
  return (g.lead + g.name).trim();
};

describe("the time of day, across a whole day", () => {
  it("greets her by the right half of the day at every hour", () => {
    const bands: Record<number, string> = {};
    for (let h = 0; h < 24; h++) bands[h] = say(h);

    // Morning starts at five, not at midnight.
    for (const h of [5, 8, 11]) expect(bands[h], `${h}:00`).toBe("Good morning, Margaret");
    for (const h of [12, 15, 17]) expect(bands[h], `${h}:00`).toBe("Good afternoon, Margaret");
    // The spec is explicit: evening from 18:00.
    for (const h of [18, 20, 21]) expect(bands[h], `${h}:00`).toBe("Good evening, Margaret");
  });

  it("says her name and stops at night, rather than telling her to sleep", () => {
    for (const h of [22, 23, 0, 3, 4]) {
      expect(say(h), `${h}:00`).toBe("Margaret");
    }
  });

  /*
    The regression this function exists for: `hour >= 18 ? evening : morning`
    made everything from midnight to 17:59 "Good morning", so three in the
    morning was greeted as the start of the day.
  */
  it("never says good morning in the middle of the night", () => {
    for (const h of [0, 1, 2, 3, 4, 22, 23]) {
      expect(say(h), `${h}:00`).not.toMatch(/morning/i);
    }
  });

  it("covers every hour — no hour falls through to nothing", () => {
    for (let h = 0; h < 24; h++) expect(say(h), `${h}:00`).not.toBe("");
  });
});

describe("when her name cannot be read", () => {
  it("keeps the greeting and drops the name, rather than guessing", () => {
    for (const missing of [null, undefined, "", "   "]) {
      expect(greetingFor(19, missing as string | null)).toEqual({ lead: "Good evening", name: "" });
    }
  });

  it("says nothing at all at night, rather than something stale", () => {
    expect(greetingFor(3, null)).toEqual({ lead: "", name: "" });
  });

  it("trims, so a stray space cannot become 'Good evening,  '", () => {
    expect(greetingFor(19, "  Margaret  ")).toEqual({ lead: "Good evening, ", name: "Margaret" });
  });
});

describe("the two halves", () => {
  /* The lead is cream and the name is amber (24ab), so they must arrive
     separately — a joined string cannot be coloured in two. */
  it("hands back the name on its own so it can carry the accent", () => {
    expect(greetingFor(19, "Margaret")).toEqual({ lead: "Good evening, ", name: "Margaret" });
  });
});
