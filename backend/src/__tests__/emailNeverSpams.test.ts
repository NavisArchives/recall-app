import { describe, expect, it, vi } from "vitest";

/**
 * Mail never reaches a fixture address (owner incident, 2026-08-10).
 *
 * The owner's inbox took roughly eight thousand bounces. The mechanism: `send`
 * built a real Gmail transport whenever EMAIL_USER/EMAIL_PASS were present,
 * and nothing stopped it in tests — so every `npm test` run posted to
 * /family/replace-screen and /people invitations several times over and mailed
 * `family@example.invalid` for real. `.invalid` is reserved by RFC 2606 and can
 * never resolve, so each message bounced straight back to the sending account.
 *
 * Two guards, and these tests pin both. The environment guard fixes the test
 * suite; the address guard is the one that matters, because seed scripts and a
 * dev server run with NODE_ENV unset and hold the same fixture families. A
 * guard listing known fixture addresses would share the blind spot of whoever
 * wrote it — this one is about a class of domain that cannot receive mail.
 */

const transporterSpy = vi.fn(async () => ({ accepted: ["x"] }));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: transporterSpy }) },
}));

const email = await import("../services/email.js");

/** Every exported sender, so a new one cannot quietly skip the guard. */
const SENDERS = Object.entries(email).filter(
  ([name, v]) => typeof v === "function" && name.startsWith("send")
) as [string, (...a: unknown[]) => Promise<{ success: boolean; reason?: string }>][];

describe("mail never reaches an address that cannot receive it", () => {
  it("exports senders to check", () => {
    expect(SENDERS.length).toBeGreaterThan(0);
  });

  it("refuses every reserved domain, on every sender", async () => {
    const reserved = [
      "family@example.invalid",
      "scratch-ux@example.invalid",
      "someone@example.com",
      "someone@example.org",
      "someone@foo.test",
      "root@localhost",
    ];

    for (const [name, fn] of SENDERS) {
      for (const address of reserved) {
        transporterSpy.mockClear();
        // Senders take (email, name, token/code) in some order; extra
        // arguments are harmless and keep this generic across all of them.
        /*
          The invariant is "nothing was put on the wire". Senders differ in
          signature — some take (email, name, token), one takes a person
          object — so a sender that refuses earlier for its own reasons is
          fine. What must never happen is a delivery attempt.
        */
        await fn(address, "Fixture", "token-123", "extra").catch(() => undefined);
        expect(
          transporterSpy,
          `${name} attempted delivery to ${address}`
        ).not.toHaveBeenCalled();
      }
    }
  });

  it("names the reason, so a refusal is never mistaken for an outage", async () => {
    // The sender from the incident itself, named exactly: it takes
    // (email, name, token), so the result comes from `send` rather than from
    // a sender's own argument check. (A loose /reset/ match picked
    // sendPinResetEmail, which takes a person object and refuses first.)
    const fn = email.sendScreenReplacementEmail;
    const res = await fn("family@example.invalid", "Fixture", "t");
    expect(res.success).toBe(false);
    expect(res.reason).toMatch(/reserved domain/i);
  });

  it("a real address is not refused by the address rule", async () => {
    // The guard must be about unroutable domains, not about mail in general —
    // otherwise it would "pass" by blocking everything.
    const res = await email.sendScreenReplacementEmail("rcl.someone.q7@gmail.com", "Real", "t");
    expect(res.reason).not.toMatch(/reserved domain/i);
  });
});
