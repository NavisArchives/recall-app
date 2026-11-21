import { describe, expect, it } from "vitest";
import { resolveChannelPath } from "../channelRouting";

/**
 * The keypad's whole contract, held in one place.
 *
 * These numbers are what the NFC cards type and what Margaret's remote
 * dials. The reserved set is a product invariant (CLAUDE.md, and a database
 * constraint on the backend): 99 must open the chooser and never land on
 * management without a PIN, and 98 must always be the way home.
 */
describe("reserved channel numbers", () => {
  it("routes each reserved number to its own page", () => {
    expect(resolveChannelPath("00")).toBe("/overview");
    expect(resolveChannelPath("10")).toBe("/social");
    // 11 stopped being special (045): an instruction is a channel of its own.
    expect(resolveChannelPath("11")).toBe("/channel/11");
    expect(resolveChannelPath("98")).toBe("/");
  });

  it("sends 99 to the chooser, never to admin", () => {
    // A scan or a stray keypress must not open management: the chooser asks
    // for a PIN, and admin is deliberately unreachable by number.
    expect(resolveChannelPath("99")).toBe("/profiles");
    expect(resolveChannelPath("99")).not.toContain("admin");
  });
});

describe("content channels", () => {
  it("routes a two-digit number to its channel", () => {
    expect(resolveChannelPath("42")).toBe("/channel/42");
  });

  it("pads a single digit, so keypad '7' and card '07' are one channel", () => {
    expect(resolveChannelPath("7")).toBe("/channel/07");
  });
});

describe("everything else is refused", () => {
  it.each(["", "abc", "123", "1a", "-1", "7.5", " 7"])("rejects %j", (raw) => {
    expect(resolveChannelPath(raw)).toBeNull();
  });
});
