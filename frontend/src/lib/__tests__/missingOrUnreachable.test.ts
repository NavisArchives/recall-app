import { describe, expect, it } from "vitest";
import { absenceKind, isGenuinelyMissing } from "../missingOrUnreachable";

/**
 * M201 — the three sentences this exists to stop, stated as the cases.
 *
 * The assertion that matters is not "404 means missing". It is that
 * **everything else must not**, because that is the direction the bug ran
 * in: three pages read any failure at all as proof of absence.
 */
describe("a failure is not a non-existence", () => {
  const withStatus = (status: number) => Object.assign(new Error("nope"), { status });

  it("calls a 404 what it is", () => {
    expect(absenceKind(withStatus(404))).toBe("missing");
    expect(isGenuinelyMissing(withStatus(404))).toBe(true);
  });

  /*
   * The shape of the bug. 503 is what the harness serves and what an
   * outage serves, and all three pages answered it with "not found".
   */
  it("refuses to call a server failure a deletion", () => {
    for (const status of [500, 502, 503, 504]) {
      expect(absenceKind(withStatus(status))).toBe("unreachable");
      expect(isGenuinelyMissing(withStatus(status))).toBe(false);
    }
  });

  it("refuses to call a refusal a deletion either", () => {
    // 401 and 403 mean "not for you", which is not "it does not exist" —
    // and 403 on somebody else's channel is exactly where a wrong word
    // would be most misleading.
    for (const status of [401, 403]) {
      expect(isGenuinelyMissing(withStatus(status))).toBe(false);
    }
  });

  /*
   * The conservative direction, pinned so nobody "simplifies" it later.
   *
   * `api.get` rejects with a plain Error and no status when the request
   * never reached a server at all — the backend being down. That is the
   * case where claiming absence would be most confidently wrong.
   */
  it("says unreachable when it cannot tell", () => {
    expect(absenceKind(new Error("The server is not responding."))).toBe("unreachable");
    expect(absenceKind(null)).toBe("unreachable");
    expect(absenceKind(undefined)).toBe("unreachable");
    expect(absenceKind({})).toBe("unreachable");
    // A string status is not a status.
    expect(absenceKind({ status: "404" })).toBe("unreachable");
  });
});
