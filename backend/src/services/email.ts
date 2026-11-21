import nodemailer from "nodemailer";
import { createHmac } from "node:crypto";
import { env } from "../config/env.js";
import { supabase } from "../config/supabase.js";

/**
 * Email is a courtesy, never a gate.
 *
 * Nothing here throws: a PIN is always shown on screen whether or not the
 * message goes out, so a mail outage can never leave an admin unable to give
 * someone their code. Every function reports what happened instead, and the
 * caller decides what to tell the user.
 */

export interface EmailResult {
  success: boolean;
  reason?: string;
  /**
   * Set when the throttle below held the message back. A public route that
   * must answer every address alike (M19) reads this so a held-back send is
   * answered like a delivered one, never like a failure.
   */
  throttled?: true;
}

const SEND_TIMEOUT_MS = 10_000;

/**
 * Every message has a stable name, and the name is what the logs carry.
 *
 * Logs used to carry the subject, and subjects carry people: "Invitation
 * request: Jan Peeters <jan@…>" put a stranger's name and full address in the
 * log, beside a recipient `redact()` had just carefully masked. A template id
 * says which mail it was and nothing about whom it was for.
 */
export type MailTemplate =
  | "welcome"
  | "pin-reset"
  | "invitation"
  | "invitation-request-receipt"
  | "invitation-request-notice"
  | "founding-invitation"
  | "account-exists"
  | "verification-code"
  | "family-recovery"
  | "screen-renewal"
  | "screen-replacement"
  | "screen-paired"
  | "test";

/**
 * The mail a stranger can make Recall send, with no session and no proof of
 * owning any address: the sign-up code, the "this address already has an
 * archive" notice, and both ends of the request-invite form.
 *
 * These spend the public share of the daily budget. Everything else is sent
 * by a signed-in family or to the family's own stored address, and a limit
 * there would get in a family's way without stopping anyone.
 */
const PUBLIC_TEMPLATES: readonly MailTemplate[] = [
  "verification-code",
  "account-exists",
  "invitation-request-receipt",
  "invitation-request-notice",
];

/**
 * Which public mail shares one recipient's hourly budget.
 *
 * The sign-up code and the "already has an archive" notice share one — they
 * answer the same form, and they must throttle alike or the throttle would
 * say which addresses have a family (M19). The request-invite receipt has
 * its own, so three strangers' requests for somebody's address cannot use
 * up the codes that person needs to sign up.
 *
 * The notice to the platform owner is in no pool: it always goes to the
 * same address, so a per-recipient limit there dropped every genuine
 * request after the third in an hour (and three junk ones first dropped
 * the lot). The daily public share still bounds it.
 */
const RECIPIENT_POOLS: Partial<Record<MailTemplate, readonly MailTemplate[]>> = {
  "verification-code": ["verification-code", "account-exists"],
  "account-exists": ["verification-code", "account-exists"],
  "invitation-request-receipt": ["invitation-request-receipt"],
};

/**
 * How much mail may go out (066), counted in the database so every instance
 * shares one count.
 *
 * - Three public messages per inbox per hour, per pool (RECIPIENT_POOLS). A
 *   person signing up needs one code, perhaps two; nobody needs a fourth
 *   inside the hour, and a script aiming Recall's account at somebody's inbox
 *   gets three codes and three receipts, however it spells the address.
 * - 400 messages a day in all, under Gmail's 500. Past Gmail's limit the
 *   account is suspended, and with it every PIN, invitation and recovery
 *   link; stopping ourselves first keeps that decision here.
 * - Public mail stops at 300 of those 400, so a flood of strangers' requests
 *   can spend the public share and never the family's: the last hundred are
 *   kept for invitations, PINs and recovery links.
 */
const PER_RECIPIENT_LIMIT = 3;
const PER_RECIPIENT_WINDOW = "1 hour";
const DAILY_LIMIT = 400;
const DAILY_PUBLIC_LIMIT = 300;
const DAILY_WINDOW = "24 hours";

/** What a caller is told when a message did not go out, whatever the cause. */
const NOT_SENT = "The email could not be sent.";
const HELD_BACK = "Too much email has gone out for now. Try again later.";

/**
 * Logs must not become a mailing list.
 *
 * Server logs travel further than the database does — into hosting dashboards,
 * log shippers, support screenshots. An address in a security log is personal
 * data with none of the access control the tables have, so what gets logged is
 * enough to correlate ("did the mail to a***@example.com go out?") and no more.
 */
function redact(address: string): string {
  /*
   * Total, on purpose.
   *
   * This is logging, and logging must never be the thing that fails a
   * request. It assumed a string, so a caller that reached it with `undefined`
   * threw inside an awaited send — and an exception thrown there does not
   * become a 500, it becomes an unhandled rejection and a request that never
   * answers at all. A screen-replacement route hung exactly that way. A
   * redactor that cannot describe its input should say so and let the send
   * fail honestly below.
   */
  if (typeof address !== "string" || !address) return "***";
  const at = address.indexOf("@");
  if (at <= 0) return "***";
  return `${address[0]}***@${address.slice(at + 1)}`;
}

const transporter =
  env.emailUser && env.emailPass
    ? nodemailer.createTransport({
        service: "gmail",
        auth: { user: env.emailUser, pass: env.emailPass },
        connectionTimeout: SEND_TIMEOUT_MS,
        greetingTimeout: SEND_TIMEOUT_MS,
        socketTimeout: SEND_TIMEOUT_MS,
      })
    : null;

/**
 * Addresses that can never receive mail, and must never be attempted.
 *
 * RFC 2606 and RFC 6761 reserve these names precisely so documentation and
 * test fixtures can use them without touching anyone real. They have no MX
 * record and never will, so every message sent to one is a guaranteed bounce
 * — and the bounce lands in the sending account's inbox.
 *
 * This is a class, not a list of known fixtures. A guard enumerating
 * "family@example.invalid, scratch-ux@example.invalid, …" would share the
 * blind spot of whoever wrote it and miss the next fixture invented; a rule
 * about unroutable domains cannot.
 */
const UNROUTABLE = /(?:^|\.)(?:invalid|test|example|localhost)$|(?:^|@)example\.(?:com|net|org)$/i;

function isUnroutable(address: string): boolean {
  const at = address.lastIndexOf("@");
  if (at < 0) return true;
  const domain = address.slice(at + 1).toLowerCase();
  return UNROUTABLE.test(domain) || /^example\.(com|net|org)$/.test(domain);
}

/** Gmail ignores dots in the name and answers to both of its domains. */
const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * The inbox an address lands in, as far as the throttle can tell.
 *
 * Keyed on the literal address, the per-recipient limit gave
 * rcl.fixture.q7+1@gmail.com, rcl.fixture.q7+2@gmail.com and rclfixtureq7@gmail.com
 * three messages an hour EACH — all in one inbox. So the count is kept per
 * inbox: a `+tag` is dropped for every domain (subaddressing is near
 * universal, and a false merge only makes the limit stricter), and for Gmail
 * the dots go too and googlemail.com is gmail.com. Mail is still sent to the
 * address as typed; this is only what the count is keyed on.
 */
export function canonicalMailbox(address: string): string {
  const lower = address.trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at <= 0) return lower;
  let local = lower.slice(0, at);
  let domain = lower.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }
  return `${local}@${domain}`;
}

/**
 * The recipient as the throttle stores it: a keyed hash of the inbox
 * (canonicalMailbox), so the table that counts sends is not itself a list of
 * who was mailed. The pepper is the same one the code hashes use, under its
 * own domain prefix.
 */
export function mailRecipientHash(address: string): string {
  return createHmac("sha256", env.codePepper)
    .update(`mail-recipient:${canonicalMailbox(address)}`)
    .digest("hex");
}

/**
 * Asks the database for a slot to send in, and records the send if one is
 * free. One call (`claim_mail_send`, 066): counting and recording in two
 * statements would let two instances both see two sends and both send the
 * third.
 *
 * Public mail fails closed — a counter that cannot answer is no reason to let
 * a stranger mail anyone. Family mail fails open, loudly: an invitation or a
 * recovery link is worth more than the quota it might cost while the counter
 * is down.
 */
async function claimSendSlot(to: string, template: MailTemplate): Promise<boolean> {
  const isPublic = PUBLIC_TEMPLATES.includes(template);
  const { data, error } = await supabase.rpc("claim_mail_send", {
    p_recipient_hash: mailRecipientHash(to),
    p_template: template,
    // The pool this template shares a recipient's budget with; none means
    // it is not counted per recipient at all.
    p_counted_templates: RECIPIENT_POOLS[template] ?? [],
    p_recipient_limit: PER_RECIPIENT_LIMIT,
    p_recipient_window: PER_RECIPIENT_WINDOW,
    p_global_limit: isPublic ? DAILY_PUBLIC_LIMIT : DAILY_LIMIT,
    p_global_window: DAILY_WINDOW,
  });

  if (error) {
    console.error(
      `[email] could not claim a send slot for ${template}, ${isPublic ? "refusing" : "sending anyway"}:`,
      error.message
    );
    return !isPublic;
  }
  const row = (Array.isArray(data) ? data[0] : data) as { allowed?: boolean } | null | undefined;
  return row?.allowed === true;
}

/** A transport error can quote the address it choked on; the log must not. */
function redactAddresses(text: string): string {
  return text.replace(/[^\s<>"'@]+@[^\s<>"'@]+/g, (address) => redact(address));
}

async function send(
  to: string,
  template: MailTemplate,
  subject: string,
  text: string
): Promise<EmailResult> {
  /*
   * A fixture address never reaches SMTP, in any environment. This is checked
   * FIRST, deliberately: it is the durable rule, and the environment guard
   * below would otherwise mask it — a test could not prove the address rule
   * exists if "we are in tests" answered first. Seed scripts and a dev server
   * run with NODE_ENV unset and hold the same fixture families, so the
   * environment is the weaker signal.
   *
   * Refused before the transport is touched: no connection, no bounce.
   */
  if (isUnroutable(to)) {
    const reason = "Refused: reserved domain that can never receive mail (RFC 2606).";
    console.warn(`[email] refused -> ${redact(to)}: ${template}`);
    return { success: false, reason };
  }

  /*
   * Tests never send to anything. `npm test` exercises the invitation and
   * screen-replacement routes dozens of times per run, and with real
   * credentials in `.env` each was a real Gmail message — thousands of them,
   * every one bouncing into the owner's own inbox. The rate limiter already
   * skips in tests for the same reason; this is that idiom one layer out.
   */
  if (process.env.NODE_ENV === "test") {
    return { success: false, reason: "skipped in tests" };
  }

  /*
   * The configuration is the operator's business, not the caller's. The log
   * names the variables; the answer — which reaches a family admin's
   * Settings page — only says there is no mail here.
   */
  if (!transporter) {
    console.warn(`[email] skipped -> ${redact(to)}: ${template} (EMAIL_USER / EMAIL_PASS not set)`);
    return { success: false, reason: "Email is not set up on this server." };
  }

  /*
   * Counted only once there is a transport to send with: a server with no
   * mail account spends nothing, and a test run never reaches the database
   * from here.
   */
  if (!(await claimSendSlot(to, template))) {
    console.warn(`[email] held back -> ${redact(to)}: ${template}`);
    return { success: false, reason: HELD_BACK, throttled: true };
  }

  try {
    await transporter.sendMail({ from: env.emailFrom, to, subject, text });
    console.log(`[email] sent -> ${redact(to)}: ${template}`);
    return { success: true };
  } catch (err) {
    /*
     * The transport's own words stay in the log. They used to be the answer
     * too, and an SMTP error is a diagnostic — host names, account state,
     * which variable to fix — handed to whoever pressed the button. Gmail
     * refusing the account password is by far the likeliest cause, so the
     * log says what to do about it.
     */
    const raw = redactAddresses(err instanceof Error ? err.message : String(err));
    const hint = /invalid login|username and password not accepted|BadCredentials/i.test(raw)
      ? " (Gmail refused the credentials: EMAIL_PASS must be a 16-character App Password, not the account password.)"
      : "";
    console.error(`[email] failed -> ${redact(to)}: ${template}: ${raw}${hint}`);
    return { success: false, reason: NOT_SENT };
  }
}

export function sendWelcomeEmail(
  person: { name: string; email: string | null },
  pin: string
): Promise<EmailResult> {
  if (!person.email) {
    return Promise.resolve({ success: false, reason: "No email address on file." });
  }

  /*
   * The instructions describe doors that exist (M118, after M111).
   *
   * This used to walk the reader through an "installation username and
   * access code" — a credential system M111 retired; no page asks for
   * either any more. A shelf member's PIN opens their face on the family
   * screen; their own devices need an invitation, which is a different
   * email. Teaching a retired credential here stranded exactly the person
   * this message exists to welcome.
   */
  return send(
    person.email,
    "welcome",
    "Welcome to Recall",
    `Hi ${person.name},

You have been added to Recall, the memory archive application.

To use Recall on the family screen:
1. Tap your face on the profile chooser
2. Enter your personal PIN: ${pin}

Keep this PIN private. Do not share it with anyone.

To use Recall from your own phone or computer, ask your
administrator to send you an invitation email.

If you have any questions, contact your administrator.

The Recall Team`
  );
}

export function sendPinResetEmail(
  person: { name: string; email: string | null },
  newPin: string
): Promise<EmailResult> {
  if (!person.email) {
    return Promise.resolve({ success: false, reason: "No email address on file." });
  }

  return send(
    person.email,
    "pin-reset",
    "Your Recall PIN has been reset",
    `Hi ${person.name},

Your Recall access PIN has been reset by an administrator.

Your new PIN: ${newPin}

Keep this PIN private. Do not share it with anyone.

If you did not request this change, contact your administrator immediately.

The Recall Team`
  );
}

/**
 * The invitation. The code inside it is the whole credential for *joining* —
 * so the email says little else and never names the archive's contents.
 *
 * It does not promise "no password" (M69): the family has one, and returning
 * later uses it. What is true is that joining costs a code and a PIN rather
 * than a form, and that is what it says.
 */
export function sendInviteEmail(
  invite: { name: string; email: string },
  secrets: { token: string; code: string },
  context: { subjectName: string; inviterName: string }
): Promise<EmailResult> {
  return send(
    invite.email,
    "invitation",
    `${context.inviterName} invited you to build ${context.subjectName}'s archive`,
    `Hi ${invite.name},

${context.inviterName} is building a memory archive for ${context.subjectName} on Recall,
and would like your help filling it with photos and stories.

Open this link to join:
${env.frontendOrigin}/join?t=${secrets.token}

It works once, and expires in 14 days.

If the link will not open, you can type this code on ${env.frontendOrigin}/join
instead: ${secrets.code}
The typed code is shorter, so it expires sooner — within 2 days.

Either way you choose a PIN and you are in — no sign-up form to fill in.

The Recall Team`
  );
}

/**
 * The founding invitation (M44) — the platform owner opening the door.
 *
 * Sent before any archive exists, to somebody who has usually been spoken to
 * first, so it names nothing and nobody: no family, no subject, no other
 * member. Just what this is and the one link.
 */
/**
 * The two ends of the request-invite form (checklist 19 §B, launch sweep).
 *
 * Until now the form wrote a row and told nobody: the stranger got a "thank
 * you" page and the owner learned of the request only by opening /owner.
 * The receipt goes to the address the stranger typed — they asked, so they
 * are told it arrived and what happens next. The notice goes to the platform
 * owner's own account address. The stranger's note is untrusted text and
 * travels as plain text, quoted, never as a link.
 */
export function sendInvitationRequestReceipt(email: string): Promise<EmailResult> {
  return send(
    email,
    "invitation-request-receipt",
    "Your request to Recall has arrived",
    `Hello,

Thank you for writing to Recall.

Your request has arrived and a person will read it. Recall is small on
purpose and invitations go out slowly — if one is right for you, it will come
to this address, usually within a few days.

Until then, two pages say what Recall is and what it costs:
https://recall.family/postcards
https://recall.family/pricing

If you did not send this, nothing has been created and you can ignore it.

The Recall Team`
  );
}

export function sendInvitationRequestNotice(
  ownerEmail: string,
  request: { email: string; name: string | null; note: string | null }
): Promise<EmailResult> {
  const who = request.name ? `${request.name} <${request.email}>` : request.email;
  const note = request.note ? request.note.split("\n").map((l) => `> ${l}`).join("\n") : "> (no note)";
  return send(
    ownerEmail,
    "invitation-request-notice",
    `Invitation request: ${who}`,
    `Somebody asked for an invitation to Recall.

From: ${who}

${note}

Approve or decline it on the owner dashboard:
https://recall.family/owner

(This is the only place the request is recorded.)`
  );
}

export function sendFoundingInviteEmail(email: string, link: string): Promise<EmailResult> {
  return send(
    email,
    "founding-invitation",
    "Your invitation to Recall",
    `Recall is a memory archive for a family caring for someone with dementia.
Photographs, voices and films, on a screen in their home, opened by touching
an everyday object.

You have been invited to start one:
${link}

The link works once and expires in 30 days. It takes a few minutes, and you
choose who else can help once you are in.

If you were not expecting this, you can ignore it — nothing has been created.

The Recall Team`
  );
}

/**
 * Sent when somebody tries to sign up with an address that already belongs to
 * a family.
 *
 * The signup form itself must not say so — that would let anyone test
 * addresses and learn which families use Recall (M19). This mail tells the
 * one person entitled to know: whoever reads that inbox.
 *
 * It greets nobody by name. The name on the form was typed by whoever
 * submitted it, and a stranger's words must not arrive in somebody's inbox
 * under Recall's name — "Hi Jan, your bank asks you to call…" was one form
 * field away.
 */
export function sendAccountExistsEmail(email: string): Promise<EmailResult> {
  return send(
    email,
    "account-exists",
    "Someone tried to create a Recall archive with your address",
    `Hello,

Somebody just tried to start a new Recall archive using this email address,
which already belongs to a family on Recall.

If that was you: you do not need a new archive — open ${env.frontendOrigin}
and sign in to the one you already have.

If it was not you: nothing has happened and no archive was created. You can
ignore this message.

The Recall Team`
  );
}

/**
 * The founder's proof of address. Sent before an archive exists, so it
 * names nobody and nothing — just the code and how long it lives. Not even
 * the reader: the address is not proven yet, so neither is any name typed
 * beside it, and the greeting is fixed for the same reason as the one above.
 */
export function sendVerificationEmail(email: string, code: string): Promise<EmailResult> {
  return send(
    email,
    "verification-code",
    "Your Recall verification code",
    `Hello,

Your verification code: ${code}

Enter it on the sign-up page to confirm this address is yours.
The code expires in 15 minutes.

If you did not try to create a Recall archive, ignore this email.

The Recall Team`
  );
}

/**
 * The way back in when everything else is forgotten.
 *
 * The family email is the root of recovery: it owns the subscription, resets
 * the password and any member's PIN, and re-runs the trusted-device ceremony.
 * The link is single-use and short-lived, so a mailbox read later is worth
 * nothing.
 */
export function sendFamilyRecoveryEmail(
  email: string,
  name: string,
  token: string
): Promise<EmailResult> {
  return send(
    email,
    "family-recovery",
    "Set a new Recall password",
    `Hi ${name},

Somebody asked to set a new password for your family's Recall archive.

Open this link within 30 minutes:
${env.frontendOrigin}/recover?t=${token}

Setting a new password signs everyone out, everywhere, including any device
you no longer have. Your memories are untouched.

If this was not you, ignore this email — nothing has changed, and the link
stops working on its own.

The Recall Team`
  );
}

/**
 * The trusted-device replacement ceremony's one email (M117).
 *
 * The family email gates this because minting a second trusted screen is
 * the one action the family password must not perform (M116) — whoever
 * reads this inbox speaks for the household. Opened on the NEW screen; the
 * old one is retired the moment the new one takes over.
 */
/**
 * The 14-day-out courtesy nudge (056, owner's numbers). Never the
 * mechanism — the workspace banner is — so this reads as a heads-up, not a
 * warning: nothing stops working on the date it names.
 */
export function sendScreenRenewalEmail(
  email: string,
  name: string,
  dueAt: string
): Promise<EmailResult> {
  const due = new Date(dueAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  return send(
    email,
    "screen-renewal",
    "Renew your family's screen",
    `Hi ${name},

Her screen is due to renew by ${due}. It is a small housekeeping step, not a
warning — the screen keeps playing exactly as it does today whether or not
you act by that date.

Renew it in a moment from the workspace:
${env.frontendOrigin}/admin/devices

The Recall Team`
  );
}

export function sendScreenReplacementEmail(
  email: string,
  name: string,
  token: string
): Promise<EmailResult> {
  return send(
    email,
    "screen-replacement",
    "Move Recall to a new screen",
    `Hi ${name},

Somebody asked to move your family's Recall screen to a new device.

Open this link ON THE NEW SCREEN within 30 minutes:
${env.frontendOrigin}/login/replace-screen?t=${token}

The moment the new screen takes over, the old one is signed out and stops
working — your memories are untouched and nothing else changes.

If this was not you, ignore this email — your screen stays exactly as it
is, and the link stops working on its own.

The Recall Team`
  );
}

/**
 * Sent to the family's own address whenever a browser becomes the screen.
 * A trusted screen reads every channel, so a pairing nobody expected must not
 * go unnoticed.
 */
export function sendScreenPairedEmail(email: string, name: string): Promise<EmailResult> {
  return send(
    email,
    "screen-paired",
    "A new screen was paired with Recall",
    `Hi ${name},

A browser was just set up as your family's Recall screen.

If that was you or someone in your family, there is nothing to do.

If nobody expected this, open Recall, go to Settings, retire that screen,
and change the family password.

The Recall Team`
  );
}

export function sendTestEmail(to: string): Promise<EmailResult> {
  return send(
    to,
    "test",
    "Recall email test",
    `This is a test email from your Recall application.
Your email system is working correctly.

Sent from: ${env.emailUser}
Time: ${new Date().toISOString()}`
  );
}
