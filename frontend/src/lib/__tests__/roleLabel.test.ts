import { describe, expect, it } from "vitest";
import { roleLabel } from "../labels";

/**
 * The role helper is not allowed to invent a role (frame 12, found while
 * building it).
 *
 * `/people/:id` narrows its columns by the reader's role, so a co-author
 * receives a person object with **no `role` field at all**. This helper
 * returned "User" for anything it did not recognise, so the profile page
 * printed "Daughter · User" for somebody who might be an administrator —
 * and then branched on it, because the ACCESS block is hidden for a `user`.
 * An unknown role quietly changed what the page offered.
 *
 * The same shape as every other finding this cycle: a default that turns
 * "we were not told" into a specific claim.
 */
describe("a role we were not given is not a role", () => {
  it("names the three roles it knows", () => {
    expect(roleLabel("admin")).toBe("Admin");
    expect(roleLabel("co_author")).toBe("Co-author");
    expect(roleLabel("user")).toBe("User");
  });

  /*
   * The case the bug lived in. `undefined` is what a narrowed read sends,
   * and it must not become the lowest role — or any role.
   */
  it("returns null when there is no role, rather than guessing the lowest one", () => {
    expect(roleLabel(undefined)).toBeNull();
    expect(roleLabel("")).toBeNull();
  });

  it("returns null for a role it does not recognise", () => {
    // A value added server-side and not yet known here is also not "User".
    expect(roleLabel("carer")).toBeNull();
  });
});
