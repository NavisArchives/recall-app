import { describe, expect, it } from "vitest";
import { UNREACHABLE_MESSAGE } from "../api";
import { absenceKind } from "../missingOrUnreachable";

/**
 * The sentence a family reads when the server cannot be reached.
 *
 * It used to be the developer's sentence in every build — "Check that it is
 * running (npm run dev in backend)" — which reached production on 20 Aug 2026
 * and would have told Margaret's daughter to open a terminal she does not
 * have, about a machine she does not own, for an outage she did not cause.
 *
 * Vitest runs with DEV true, so this file pins the developer half directly and
 * the production half by construction: both are one exported constant, and the
 * test that matters most is the last one — that whichever string is chosen,
 * the code that decides "missing or merely unreachable?" still says
 * unreachable. That classification protects a family from being told their
 * memories are gone when the truth is a dropped connection.
 */

describe("the unreachable message", () => {
  it("keeps the developer's hint on a laptop", () => {
    // If this ever fails, the test env stopped being DEV — not the message.
    expect(import.meta.env.DEV).toBe(true);
    expect(UNREACHABLE_MESSAGE).toContain("npm run dev");
  });

  it("starts with the phrase the rest of the app reads", () => {
    // Anything matching on the prefix keeps working across both variants.
    expect(UNREACHABLE_MESSAGE.startsWith("The server is not responding")).toBe(true);
  });

  it("is still classified as unreachable, never as absence", () => {
    // The whole point: a down server must not be reported as "nothing here".
    expect(absenceKind(new Error(UNREACHABLE_MESSAGE))).toBe("unreachable");
  });
});
