import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recorder } from "./support/supabaseRecorder.js";

/**
 * Mail a stranger can trigger is counted, and what goes out says nothing it
 * should not (security review 29 Sep 2026: edge-1, input-2, edge-5, and the
 * skeptic's "debug mode" finding).
 *
 * `send` refuses everything under NODE_ENV=test, which is right for the rest
 * of the suite and would hide everything tested here. So this file gives the
 * module a transport (a spy, never the network) and lifts the test guard for
 * the length of each test, putting it back afterwards.
 */

const sendMail = vi.fn(async (_message: Record<string, unknown>) => ({ accepted: ["x"] }));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail }) },
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => recorder.client,
}));

process.env.EMAIL_USER = "rcl.sender.q7@gmail.com";
process.env.EMAIL_PASS = "app-password-for-tests";

const email = await import("../services/email.js");

const STRANGER = "rcl.fixture.q7@gmail.com";

function allow() {
  recorder.reset({ "rpc:claim_mail_send": [{ allowed: true }] });
}
function holdBack() {
  recorder.reset({ "rpc:claim_mail_send": [{ allowed: false }] });
}

let logs: string[];

beforeEach(() => {
  process.env.NODE_ENV = "production";
  sendMail.mockClear();
  sendMail.mockImplementation(async () => ({ accepted: ["x"] }));
  logs = [];
  for (const level of ["log", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
  }
});

afterEach(() => {
  process.env.NODE_ENV = "test";
  vi.restoreAllMocks();
  recorder.reset({});
});

describe("public mail is counted in the database, per recipient and per day", () => {
  it("asks for a slot before sending, naming the template and a hash of the address", async () => {
    allow();
    const res = await email.sendVerificationEmail(STRANGER, "ABC234");

    expect(res.success).toBe(true);
    const [claim] = recorder.forTable("rpc:claim_mail_send");
    const args = claim.payload as Record<string, unknown>;
    expect(args.p_template).toBe("verification-code");
    expect(args.p_recipient_hash).toBe(email.mailRecipientHash(STRANGER));
    // The counter stores who was mailed only as a keyed hash.
    expect(JSON.stringify(args)).not.toContain(STRANGER);
    expect(args.p_recipient_limit).toBe(3);
    expect(args.p_recipient_window).toBe("1 hour");
    // Public mail stops short of the daily cap, keeping the rest for families.
    expect(args.p_global_limit).toBe(300);
    // The code and the account-exists notice share one budget, so both
    // branches of the sign-up form throttle alike (M19).
    expect(args.p_counted_templates).toEqual(["verification-code", "account-exists"]);
  });

  it("hashes an address the same however it was typed", () => {
    expect(email.mailRecipientHash("  Rcl.Fixture.Q7@Gmail.com ")).toBe(email.mailRecipientHash(STRANGER));
    expect(email.mailRecipientHash(STRANGER)).not.toBe(email.mailRecipientHash("rcl.someone.q7@gmail.com"));
  });

  it("counts one inbox once: +tags, and Gmail's dots and second domain, share its hash", () => {
    const one = email.mailRecipientHash(STRANGER);
    for (const variant of [
      "rcl.fixture.q7+1@gmail.com",
      "rcl.fixture.q7+recall@gmail.com",
      "rclfixtureq7@gmail.com",
      "r.c.l.fixtureq7@gmail.com",
      "Rcl.Fixture.Q7+x@GoogleMail.com",
    ]) {
      expect(email.mailRecipientHash(variant), variant).toBe(one);
    }
    // A +tag is dropped everywhere; dots only where Gmail ignores them.
    expect(email.mailRecipientHash("jan+a@example.org")).toBe(email.mailRecipientHash("jan@example.org"));
    expect(email.mailRecipientHash("rcl.fixture.q7@telenet.be")).not.toBe(
      email.mailRecipientHash("rclfixtureq7@telenet.be")
    );
    expect(email.canonicalMailbox("R.clq7+x@googlemail.com")).toBe("rclq7@gmail.com");
  });

  it("still sends to the address exactly as typed", async () => {
    allow();
    await email.sendVerificationEmail("rcl.fixture.q7+recall@gmail.com", "ABC234");
    expect((sendMail.mock.calls[0][0] as { to: string }).to).toBe("rcl.fixture.q7+recall@gmail.com");
  });

  it("gives the invite-request receipt its own budget, apart from the sign-up code's", async () => {
    allow();
    await email.sendInvitationRequestReceipt(STRANGER);
    const args = recorder.forTable("rpc:claim_mail_send")[0].payload as Record<string, unknown>;
    expect(args.p_counted_templates).toEqual(["invitation-request-receipt"]);
    expect(args.p_global_limit).toBe(300);
  });

  it("does not cap the owner's notice per recipient — only the daily public share bounds it", async () => {
    allow();
    await email.sendInvitationRequestNotice("owner@recall.family", { email: STRANGER, name: null, note: null });
    const args = recorder.forTable("rpc:claim_mail_send")[0].payload as Record<string, unknown>;
    expect(args.p_template).toBe("invitation-request-notice");
    expect(args.p_counted_templates).toEqual([]);
    expect(args.p_global_limit).toBe(300);
  });

  it("gives family mail the full daily cap", async () => {
    allow();
    await email.sendInviteEmail(
      { name: "Hélène", email: STRANGER },
      { token: "t", code: "c" },
      { subjectName: "Margaret", inviterName: "Andy" }
    );
    const args = recorder.forTable("rpc:claim_mail_send")[0].payload as Record<string, unknown>;
    expect(args.p_template).toBe("invitation");
    expect(args.p_global_limit).toBe(400);
  });

  it("sends nothing when the slot is refused, and says it was held back", async () => {
    holdBack();
    for (const send of [
      () => email.sendVerificationEmail(STRANGER, "ABC234"),
      () => email.sendAccountExistsEmail(STRANGER),
      () => email.sendInvitationRequestReceipt(STRANGER),
      () =>
        email.sendInvitationRequestNotice("owner@recall.family", {
          email: STRANGER,
          name: "Jan",
          note: null,
        }),
    ]) {
      const res = await send();
      expect(res.success).toBe(false);
      expect(res.throttled).toBe(true);
      expect(typeof res.reason).toBe("string");
    }
    expect(sendMail).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes("held back") && l.includes("verification-code"))).toBe(true);
  });

  it("refuses public mail when the counter cannot answer, and lets family mail through", async () => {
    recorder.reset({});
    recorder.failure = { message: "database unreachable" };

    const stranger = await email.sendVerificationEmail(STRANGER, "ABC234");
    expect(stranger.success).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();

    const family = await email.sendFamilyRecoveryEmail(STRANGER, "The Peeters family", "tok");
    expect(family.success).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});

describe("mail to an address nobody has proven echoes nothing typed", () => {
  it("greets with a fixed hello in the code, account-exists and receipt mails", async () => {
    for (const send of [
      () => email.sendVerificationEmail(STRANGER, "ABC234"),
      () => email.sendAccountExistsEmail(STRANGER),
      () => email.sendInvitationRequestReceipt(STRANGER),
    ]) {
      allow();
      sendMail.mockClear();
      await send();
      const message = sendMail.mock.calls[0][0] as { text: string };
      expect(message.text.startsWith("Hello,\n")).toBe(true);
    }
  });

  it("takes no name for the unproven address — there is nothing to echo", () => {
    // Arity is the contract: a name parameter is how a form field got into
    // the greeting, and one cannot come back without failing here.
    expect(email.sendVerificationEmail.length).toBe(2);
    expect(email.sendAccountExistsEmail.length).toBe(1);
    expect(email.sendInvitationRequestReceipt.length).toBe(1);
  });
});

describe("logs carry a template id, never a subject", () => {
  it("logs the template for a delivered mail, not the names in its subject", async () => {
    allow();
    await email.sendInvitationRequestNotice("owner@recall.family", {
      email: STRANGER,
      name: "Jan Peeters",
      note: "For my mother.",
    });

    const sent = logs.find((l) => l.startsWith("[email] sent"));
    expect(sent).toContain("invitation-request-notice");
    expect(sent).not.toContain("Jan Peeters");
    expect(sent).not.toContain(STRANGER);
    expect(sent).not.toContain("owner@recall.family");
  });

  it("logs the template for a refused mail too", async () => {
    await email.sendVerificationEmail("fixture@example.invalid", "ABC234");
    const refused = logs.find((l) => l.startsWith("[email] refused"));
    expect(refused).toContain("verification-code");
    expect(refused).not.toContain("Your Recall verification code");
  });
});

describe("a transport failure is described in the log, not to the caller", () => {
  it("answers one plain sentence and keeps the transport's words server-side", async () => {
    allow();
    sendMail.mockImplementation(async () => {
      throw new Error("Invalid login: 535-5.7.8 Username and Password not accepted for rcl.sender.q7@gmail.com");
    });

    const res = await email.sendTestEmail("rcl.admin.q7@gmail.com");

    expect(res).toEqual({ success: false, reason: "The email could not be sent." });
    const failed = logs.find((l) => l.startsWith("[email] failed"));
    expect(failed).toContain("test");
    expect(failed).toContain("535-5.7.8");
    // The operator still learns what to fix…
    expect(failed).toMatch(/App Password/);
    // …and the address quoted inside the transport's error is masked.
    expect(failed).not.toContain("rcl.sender.q7@gmail.com");
  });

  it("never names an environment variable in any answer", async () => {
    allow();
    sendMail.mockImplementation(async () => {
      throw new Error("connect ECONNREFUSED 142.250.0.1:465");
    });
    const failed = await email.sendTestEmail("rcl.admin.q7@gmail.com");
    expect(failed.reason).not.toMatch(/EMAIL_|ECONNREFUSED|142\.250/);

    // And with no mail account at all: a fresh module with no credentials.
    vi.resetModules();
    const savedUser = process.env.EMAIL_USER;
    const savedPass = process.env.EMAIL_PASS;
    process.env.EMAIL_USER = "";
    process.env.EMAIL_PASS = "";
    try {
      // Loaded as a test process (env.ts has production-only requirements of
      // its own), then asked to send as a production one.
      process.env.NODE_ENV = "test";
      const bare = await import("../services/email.js");
      process.env.NODE_ENV = "production";
      const res = await bare.sendTestEmail("rcl.admin.q7@gmail.com");
      expect(res.success).toBe(false);
      expect(res.reason).not.toMatch(/EMAIL_/);
    } finally {
      process.env.EMAIL_USER = savedUser;
      process.env.EMAIL_PASS = savedPass;
    }
  });
});
