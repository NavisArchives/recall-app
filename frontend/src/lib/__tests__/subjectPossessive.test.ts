import { describe, expect, it } from "vitest";
import { subjectPossessive } from "../labels";

/**
 * The subject is a real person with a real name, so this has to read for any
 * name — Margaret is the fixture, not the specification (M222).
 */
describe("the subject's screen, in words", () => {
  it("uses her name when we know it", () => {
    expect(`Show on ${subjectPossessive("Margaret")} screen`).toBe("Show on Margaret’s screen");
  });

  it("says 'her' when we do not — never \"her's\"", () => {
    for (const nothing of [null, undefined, "", "   "]) {
      expect(`Show on ${subjectPossessive(nothing)} screen`).toBe("Show on her screen");
    }
  });

  it("does not double the s on a name that already ends in one", () => {
    expect(subjectPossessive("Jess")).toBe("Jess’");
    expect(subjectPossessive("Agnes")).toBe("Agnes’");
  });

  it("trims, so a stray space cannot produce 'Margaret ’s'", () => {
    expect(subjectPossessive("  Margaret  ")).toBe("Margaret’s");
  });
});
