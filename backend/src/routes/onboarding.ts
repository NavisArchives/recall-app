import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { randomBytes } from "node:crypto";
import { supabase } from "../config/supabase.js";
import {
  issueDeviceCookie,
  issueProfileCookie,
  requireRole,
  requireArchive,
} from "../middleware/auth.js";
import { CAN_MANAGE_PEOPLE, LANDING_PATH } from "../services/accessCodes.js";
import { hashPin, isValidPinFormat } from "../services/pins.js";
import {
  generateInviteCode,
  generateInviteToken,
  generateReceipt,
  hashFounderToken,
  hashInviteCode,
  hashInviteToken,
  hashReceipt,
  hashVerificationCode,
  inviteCodeExpiry,
  inviteTokenExpiry,
  normaliseFounderToken,
  normaliseInviteCode,
  normaliseInviteToken,
  normaliseReceipt,
  receiptExpiry,
  verificationExpiry,
} from "../services/inviteCodes.js";
import {
  sendAccountExistsEmail,
  sendInviteEmail,
  sendVerificationEmail,
  sendInvitationRequestReceipt,
  sendInvitationRequestNotice,
  type EmailResult,
} from "../services/email.js";
import { logActivity, actorName } from "../services/activityLog.js";
import { fail } from "../lib/errors.js";
import { exactIlike } from "../lib/exactIlike.js";
import { parseConsent, recordConsent } from "../services/consent.js";
import argon2 from "argon2";
import {
  openFamilySession,
  readFamilySession,
  elevateSession,
} from "../services/familyAuth.js";

export const onboardingRouter = Router();

/**
 * The front door of the product: creating an archive and joining one.
 *
 * Both halves end the same way — an account, a person on the family's
 * shelf, a membership tying them together, and a signed-in session — so
 * whoever finishes either flow lands on the Overview of their own archive
 * and nobody else's.
 */

const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again later." },
  // The suite drives dozens of requests from one address on purpose, and a
  // per-IP counter would refuse them. The limits that actually protect
  // invitations are counted in the database (M23) and are exercised by the
  // tests below; this one is a blunt instrument for the open internet.
  skip: () => process.env.NODE_ENV === "test",
});

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/*
 * How long a typed field may be (input-5, 29 Sep 2026). An address past 254
 * characters cannot be delivered (RFC 5321); a name past 120 is not a name.
 * The forms carry the same limits, so a person typing never meets these —
 * only a script does.
 */
const MAX_EMAIL = 254;
const MAX_NAME = 120;
const MAX_RELATIONSHIP = 80;
const MAX_PLACE = 200;

/** The typed address, trimmed and lower-cased, or null when it is not one. */
function validEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length > MAX_EMAIL || !EMAIL_SHAPE.test(email)) return null;
  return email;
}

/**
 * Every form here posts a JSON object. Anything else — no body, a bare
 * string, an array — is refused in words, before a handler reads a field and
 * a missing body surfaces as a 500. Mounted per route, after the route's own
 * gate: an anonymous call to an admin route is still told 401, not 400.
 */
function requireObjectBody(req: Request, res: Response, next: NextFunction) {
  const body: unknown = req.body;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({ error: "The request is missing its details." });
  }
  next();
}

/**
 * One answer for every address, taken or free (M19). The body is identical
 * because any difference — wording, status, even a field order — is enough to
 * turn this endpoint into a roster of families using Recall.
 */
const VERIFICATION_SENT = { ok: true, message: "If this address can be used, we have sent the next step." };

/**
 * One refusal for every way signup can be turned away: a missing receipt, one
 * already spent, one minted for a different address, one that expired, and an
 * address already in use. The caller learns that it did not work, and nothing
 * else. The server logs know which it was.
 */
function refuseSignup(res: Response) {
  return res.status(403).json({ error: "That did not work. Start again from your email address." });
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0];
}

function validDate(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getTime() > Date.now()) return null;
  return value;
}

/**
 * A browser that just signed up is a trusted context for this archive. It is
 * recorded as an installation so it appears in the family's list and can be
 * revoked like any other machine — the secret is random and thrown away, the
 * session cookie being the actual credential.
 */
async function createWebInstallation(archiveId: string, label: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("installations")
    .insert({
      name: label,
      username: `web-${randomBytes(6).toString("hex")}`,
      secret_hash: await argon2.hash(randomBytes(32).toString("hex"), { type: argon2.argon2id }),
      archive_id: archiveId,
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    console.error(
      "[onboarding] could not record the web installation:",
      error?.message ?? "no row returned"
    );
    return null;
  }
  return data.id;
}

// ─────────────────────────────────────────────────────── the front door (M44)

/**
 * Is this founding invitation real?
 *
 * Answered before the form is shown, so somebody holding a dead link is told
 * so on the first screen rather than after filling everything in. It reveals
 * one bit and the address it was sent to — which whoever holds the link
 * already knows, because it was emailed to them.
 *
 * Invalid, expired, revoked, already-spent and fabricated all give the same
 * gentle dead end. No oracle: a stranger guessing tokens learns nothing from
 * the difference between "never existed" and "used last week".
 */
onboardingRouter.post("/founding/check", publicLimiter, requireObjectBody, async (req, res) => {
  const token = normaliseFounderToken(req.body?.token);
  const dead = () => res.status(404).json({ error: "This invitation is not valid any more." });
  if (!token) return dead();

  const { data, error } = await supabase
    .from("founding_invitations")
    .select("id, email, expires_at, accepted_at, revoked_at")
    .eq("token_hash", hashFounderToken(token))
    .maybeSingle();

  if (error) return fail(res, 500, "That could not be checked right now.", error);
  if (!data || data.accepted_at || data.revoked_at) return dead();
  if (new Date(data.expires_at).getTime() < Date.now()) return dead();

  res.json({ ok: true, email: data.email });
});

/**
 * Somebody asking to be let in.
 *
 * Public, so it is written to by strangers, and it answers identically
 * whether the address is new, has already asked, or already belongs to a
 * family (M19). Anything else turns the form into a membership oracle:
 * iterate a list of addresses and learn which of them belong to a family
 * caring for someone with dementia, which is precisely the targeting signal
 * a scam aimed at carers wants.
 *
 * Asking twice changes nothing (access-9, 29 Sep 2026). This used to upsert
 * on the address, which let anyone who knew somebody's email replace that
 * person's name and note with their own words and put a request the owner
 * had already invited or dismissed back to "pending". The first request is
 * the one kept; a second for the same address is answered exactly as the
 * first was, writes nothing, and mails nobody — so it can neither overwrite
 * a stranger's request nor be used to send them another receipt.
 */
onboardingRouter.post("/founding/request", publicLimiter, requireObjectBody, async (req, res) => {
  const { name, note, interested_tier, billing_period, relationship, preferred_language } = req.body;
  const ALWAYS = { ok: true } as const;

  const email = validEmail(req.body.email);
  if (!email) {
    return res.status(400).json({ error: "A valid email address is required." });
  }

  // 057: which of the two configurations they asked about, and how they'd
  // pay. Both optional — a form that omits them (or an older client) still
  // records the request; the owner just sees less about it.
  const tier = interested_tier === "digital" || interested_tier === "dock" ? interested_tier : null;
  const period = billing_period === "monthly" || billing_period === "yearly" ? billing_period : null;

  /*
    Who they are to her, and what to write back in (061). Both optional, both
    only there so the first reply — which a person writes by hand — can be
    addressed properly instead of guessing a language from an email address.
  */
  const LANGS = ["fr", "nl", "en"];
  const language = LANGS.includes(String(preferred_language)) ? String(preferred_language) : null;

  const row = {
    email,
    name: typeof name === "string" ? name.trim().slice(0, MAX_NAME) || null : null,
    note: typeof note === "string" ? note.trim().slice(0, 1000) || null : null,
    status: "pending",
    interested_tier: tier,
    billing_period: period,
    relationship:
      typeof relationship === "string"
        ? relationship.trim().slice(0, MAX_RELATIONSHIP) || null
        : null,
    preferred_language: language,
  };
  // Insert only. The unique address (033) is the referee: a second request
  // for it is refused by the database, not merged into the first.
  const { error } = await supabase.from("invitation_requests").insert(row);

  // An address that already asked: nothing written, nothing sent, and the
  // same answer a first request gets.
  if (error && (error as { code?: string }).code === "23505") {
    return res.json(ALWAYS);
  }

  // The same answer either way, including when the write failed: a stranger
  // learns nothing about this platform's internals from a form. The failure
  // is not swallowed, though — it is logged where the operator reads, and
  // no mail goes out for a request that was never recorded (M221).
  if (error) {
    console.error("[onboarding] invitation request could not be recorded:", error.message);
    return res.json(ALWAYS);
  }

  // Both ends hear about it (checklist 19 §B). Neither send may delay or
  // change the answer: the request is recorded, and mail is a courtesy that
  // is simply skipped when no transport is configured.
  void Promise.all([
    sendInvitationRequestReceipt(row.email),
    notifyPlatformOwner({ email: row.email, name: row.name, note: row.note }),
  ]).catch((err) => console.error("[onboarding] request mail failed:", err));

  res.json(ALWAYS);
});

/** The owner's own account address — the one place a request is announced. */
async function notifyPlatformOwner(request: { email: string; name: string | null; note: string | null }) {
  const { data } = await supabase
    .from("families")
    .select("email")
    .eq("platform_owner", true)
    .limit(1)
    .maybeSingle();
  if (!data?.email) return;
  await sendInvitationRequestNotice(data.email, request);
}

/*
 * Email verification — the founder proves their address the same way an
 * invitee always has: by holding the code that was sent to it.
 *
 * The code travels only in the email. Returning it in the response would
 * turn "prove you can read this inbox" into "prove you can read this
 * response", which is nothing at all.
 */
onboardingRouter.post("/verify-email/send", publicLimiter, requireObjectBody, async (req, res) => {
  // A `name` may still arrive from older forms and is ignored: the mail
  // greets nobody by name, because nothing typed here is proven yet (input-2).
  const normalisedEmail = validEmail(req.body.email);
  if (!normalisedEmail) {
    return res.status(400).json({ error: "A valid email address is required." });
  }

  /*
   * An exact, case-insensitive match. The typed address used to go to ilike
   * as a pattern, so `_` and `%` were wildcards and `j_n@example.com` found
   * jan@example.com's family. An address carrying `*` (PostgREST's other wildcard,
   * which cannot be escaped) matches no family at all, and is answered as a
   * free address — which is what it is to every family on file.
   */
  const pattern = exactIlike(normalisedEmail);
  const { data: existing } = pattern
    ? await supabase.from("families").select("id").ilike("email", pattern).maybeSingle()
    : { data: null };

  /*
   * An address already in use gets the same answer as a free one (M19).
   *
   * Saying "an account already exists" to an anonymous caller turns this form
   * into a membership oracle: iterate a list of addresses and you learn which
   * of them belong to a family caring for someone with dementia — precisely
   * the targeting signal a scam aimed at carers wants.
   *
   * The person who genuinely owns the address is not left stranded: they are
   * mailed instead, at the address in question, which tells the right human
   * being and nobody else.
   *
   * Both branches answer a mail's outcome the same way, too. A taken address
   * used to be told "sent" whatever happened while a free one heard 502 when
   * its code failed to go — so with mail down, or an address throttled, the
   * status code alone said which addresses had a family. Now either branch
   * is 502 only when its mail genuinely failed, 429 when the limit held it
   * back, and "sent" only when it went (answerSend).
   */
  if (existing) {
    const told = await sendAccountExistsEmail(normalisedEmail);
    return answerSend(res, told);
  }

  const code = generateInviteCode();

  const { data: fresh, error } = await supabase
    .from("email_verifications")
    .insert({
      email: normalisedEmail,
      code_hash: hashVerificationCode(code),
      expires_at: verificationExpiry(),
      purpose: "signup",
    })
    .select("id, created_at")
    .single();
  if (error || !fresh?.id) return fail(res, 500, "The code could not be prepared.", error);

  const emailed = await sendVerificationEmail(normalisedEmail, code);

  /*
   * A fresh code replaces any still in flight — but only once it has
   * actually gone out. Deleting first meant a send the mail limit held back
   * (066) still killed the code the person was holding, and a fourth "send
   * again" inside the hour would have left them with none that worked. A
   * code that was never mailed is removed instead.
   *
   * Only OLDER codes are removed, never "every code but mine": two sends
   * overlapping (a double tap, or "send again" while the first was still
   * going) each deleted the other's, and the person was left with two mails
   * and no code that worked. Older-than-mine can never remove a newer row,
   * so the last code sent always survives.
   */
  if (emailed.success) {
    let older = supabase.from("email_verifications").delete().eq("email", normalisedEmail);
    older = fresh.created_at ? older.lt("created_at", fresh.created_at) : older.neq("id", fresh.id);
    await older;
  } else {
    await supabase.from("email_verifications").delete().eq("id", fresh.id);
  }
  return answerSend(res, emailed);
});

/**
 * One answer per mail outcome, whichever mail it was (M19).
 *
 * A send the limit held back is said so, plainly. It used to be answered
 * "sent", and anyone could make that true of somebody else's address: three
 * requests an hour spent that address's budget, and the person's own code
 * then "went" and never arrived while the page waited for it. The honest
 * answer gives nothing away — the code and the account-exists notice share
 * one budget (services/email.ts RECIPIENT_POOLS) and the daily cap is the
 * same for both, so a free address and a taken one are held back alike.
 */
const TOO_MANY_SENT = {
  error: "Too many codes have been sent to this address. Wait an hour and try again.",
  code: "too_many_sent",
};

function answerSend(res: Response, result: EmailResult) {
  if (result.throttled) return res.status(429).json(TOO_MANY_SENT);
  if (!result.success) {
    return res.status(502).json({
      error: "The code could not be emailed. Check the address and try again.",
    });
  }
  return res.json(VERIFICATION_SENT);
}

/*
 * Answering the code mints a receipt: a 128-bit secret handed to the browser
 * that answered, and stored only as a hash.
 *
 * Before this, verification stamped the row and signup asked a much weaker
 * question — "has anyone verified this address lately?" — which any caller
 * could answer yes to for the next half hour, from any browser, using only
 * the address. The receipt is what makes the proof belong to its holder.
 */
onboardingRouter.post("/verify-email/check", publicLimiter, requireObjectBody, async (req, res) => {
  const code = normaliseInviteCode(req.body.code);
  const email = validEmail(req.body.email);
  if (!code || !email) {
    return res.status(400).json({ error: "That is not a valid code." });
  }

  const { data: row } = await supabase
    .from("email_verifications")
    .select("id, expires_at")
    .eq("email", email)
    .eq("code_hash", hashVerificationCode(code))
    .is("verified_at", null)
    .maybeSingle();

  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    return res.status(404).json({ error: "This code is not valid any more." });
  }

  const receipt = generateReceipt();
  const { error } = await supabase
    .from("email_verifications")
    .update({
      verified_at: new Date().toISOString(),
      receipt_hash: hashReceipt(receipt),
      receipt_expires_at: receiptExpiry(),
      purpose: "signup",
    })
    .eq("id", row.id);
  if (error) return fail(res, 500, "The code could not be confirmed.", error);

  res.json({ ok: true, receipt });
});

/*
 * Sign up — one call creates the whole household.
 *
 * `about` decides whose archive this is: "me" makes the signer the subject
 * as well as the owner; "someone" records the subject separately and the
 * signer's relationship to them. Either way the signer owns the archive and
 * manages it — your rule: the first contributor is the admin.
 */
onboardingRouter.post("/sign-up", publicLimiter, requireObjectBody, async (req, res) => {
  const { about, your_name, subject, relationship, receipt, pin, founder_token } = req.body;

  if (about !== "me" && about !== "someone") {
    return res.status(400).json({ error: "Say whose archive this is." });
  }
  if (typeof your_name !== "string" || !your_name.trim()) {
    return res.status(400).json({ error: "Your name is required." });
  }
  if (your_name.trim().length > MAX_NAME) {
    return res.status(400).json({ error: "Your name is too long." });
  }
  const normalisedEmail = validEmail(req.body.email);
  if (!normalisedEmail) {
    return res.status(400).json({ error: "A valid email address is required." });
  }
  if (relationship != null && (typeof relationship !== "string" || relationship.length > MAX_RELATIONSHIP)) {
    return res.status(400).json({ error: "The relationship is too long." });
  }
  if (!isValidPinFormat(pin)) {
    return res.status(400).json({ error: "Choose a 6-digit PIN." });
  }

  const subjectName =
    about === "me"
      ? your_name.trim()
      : typeof subject?.full_name === "string"
        ? subject.full_name.trim()
        : "";
  if (!subjectName) {
    return res.status(400).json({ error: "The person's name is required." });
  }
  if (subjectName.length > MAX_NAME) {
    return res.status(400).json({ error: "The person's name is too long." });
  }
  const birthDate = validDate(subject?.birth_date);
  const location = typeof subject?.location === "string" ? subject.location.trim() : "";
  if (location.length > MAX_PLACE) {
    return res.status(400).json({ error: "The location is too long." });
  }

  const presentedReceipt = normaliseReceipt(receipt);
  if (!presentedReceipt) return refuseSignup(res);

  /*
   * The front door is not open (M44).
   *
   * Creating a family needs a founding invitation the platform owner minted.
   * The token is only *shaped* here; whether it is real, unspent, unexpired
   * and unrevoked is decided inside `create_household`, in the same
   * transaction that spends it — a token checked by this route and consumed
   * a moment later is a token two browsers can both pass.
   *
   * Checked after the field validation above, not before it. Which fields a
   * public form requires is not a secret and a legitimate signer deserves to
   * be told; *which addresses already have a family* is the secret, and that
   * answer is identical here whether the token was missing, malformed,
   * fabricated, spent or expired (M19).
   */
  const presentedFounder = normaliseFounderToken(founder_token);
  if (!presentedFounder) return refuseSignup(res);

  /*
   * Her word (054). No archive is created without a declaration of who
   * consents to her life being shown on her screen — herself, a guardian
   * over her person, or a care-mandate holder. Checked before the household
   * is written, so a form that forgot it is refused in words rather than
   * producing an archive with no lawful basis.
   */
  const consent = parseConsent(req.body?.consent);
  if (!consent) {
    return res.status(400).json({ error: "The consent declaration is required." });
  }

  /*
   * One call, one transaction (M15).
   *
   * This used to be seven inserts with a hand-written rollback, which is not
   * a transaction: a killed process or a failure inside the rollback left an
   * archive with no owner behind it. `create_household` spends the receipt
   * and writes the whole family in one statement, so the outcome is all of it
   * or none of it — including the installation, which used to be optional and
   * could leave someone "welcomed" and then refused on their next request.
   */
  const { data, error } = await supabase.rpc("create_household", {
    p_receipt_hash: hashReceipt(presentedReceipt),
    p_email: normalisedEmail,
    p_display_name: your_name.trim(),
    p_admin_name: your_name.trim(),
    p_admin_pin_hash: await hashPin(pin),
    p_relationship: typeof relationship === "string" ? relationship : null,
    p_about: about,
    p_subject_name: subjectName,
    p_birth_date: birthDate,
    p_residence: location || null,
    p_install_name: `${firstName(your_name)}'s browser`,
    p_install_username: `web-${randomBytes(6).toString("hex")}`,
    p_install_secret: await argon2.hash(randomBytes(32).toString("hex"), {
      type: argon2.argon2id,
    }),
    p_founder_hash: hashFounderToken(presentedFounder),
  });

  if (error) {
    // Everything a stranger could provoke — spent receipt, wrong address,
    // expired receipt, taken email — arrives here as the same refusal, and
    // leaves with the same answer (M19).
    if ((error as { message?: string }).message?.includes("signup_refused")) {
      return refuseSignup(res);
    }
    return fail(res, 500, "The archive could not be created.", error);
  }

  const household = Array.isArray(data) ? data[0] : data;
  if (!household?.archive_id || !household?.person_id || !household?.installation_id) {
    return fail(res, 500, "The archive could not be created.", { message: "empty rpc result" });
  }

  /*
   * The declaration is written right after the household, by the admin the
   * household just made. If this one write fails the household still
   * exists — refusing here would leave a created archive with no cookies
   * and a founder who cannot get back in — so the failure is logged loudly
   * and the Settings page asks the admin to record it again (its "Her
   * word" panel shows the gap).
   */
  const declared = await recordConsent({
    archive_id: household.archive_id,
    declared_by: household.person_id,
    subject_name: subjectName,
    signer_relationship: typeof relationship === "string" ? relationship : null,
    consent,
  });
  if (declared.error) {
    console.error("[onboarding] consent could not be recorded:", declared.error.message);
  }

  issueDeviceCookie(res, {
    installationId: household.installation_id,
    archiveId: household.archive_id,
  });
  issueProfileCookie(res, {
    personId: household.person_id,
    name: your_name.trim(),
    role: "admin",
    archiveId: household.archive_id,
  });

  logActivity(
    {
      personId: household.person_id,
      name: your_name.trim(),
      role: "admin",
      archiveId: household.archive_id,
    },
    "contributor_added",
    `${firstName(your_name)} created this archive`
  );

  // The verification did its one job.
  await supabase.from("email_verifications").delete().eq("email", normalisedEmail);

  res.status(201).json({ ok: true, redirect_to: LANDING_PATH.admin });
});

/*
 * Invitations — sent by an admin from inside their archive.
 *
 * The response always carries each code so the admin can hand it over in
 * person when the email does not arrive; the code is single-use either way.
 */
onboardingRouter.post("/invites", requireRole(CAN_MANAGE_PEOPLE), requireObjectBody, async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;

  const invites = req.body?.invites;
  if (!Array.isArray(invites) || invites.length === 0 || invites.length > 10) {
    return res.status(400).json({ error: "Send between one and ten invitations." });
  }

  const { data: subjectRow } = await supabase
    .from("settings")
    .select("display_name")
    .eq("archive_id", archive)
    .maybeSingle();
  const subjectName = subjectRow?.display_name ?? "their";

  const results = [];
  for (const invite of invites) {
    const name = typeof invite?.name === "string" ? invite.name.trim() : "";
    const typed = typeof invite?.email === "string" ? invite.email.trim().toLowerCase() : "";
    const email = validEmail(typed);
    const rel =
      typeof invite?.relationship === "string"
        ? invite.relationship.trim().slice(0, MAX_RELATIONSHIP) || null
        : null;
    const personId = typeof invite?.person_id === "string" ? invite.person_id.trim() : null;

    if (!name || !email) {
      results.push({ email: typed.slice(0, MAX_EMAIL), sent: false, error: "A name and a valid email are needed." });
      continue;
    }
    if (name.length > MAX_NAME) {
      results.push({ email, sent: false, error: "That name is too long." });
      continue;
    }

    /*
     * The invitation may name a face already on the shelf (M41).
     *
     * The admin adds Hélène as a contributor first and invites her
     * afterwards, and without this the acceptance inserted a second
     * Hélène beside the first. Read the profile here so the obvious
     * mistakes are answered in words rather than as a constraint violation
     * at the far end of an email — but the refusals that matter (another
     * family's id, the subject's own profile, two people racing for one
     * face) are enforced inside `accept_invitation` and by the index it
     * relies on. This lookup is a courtesy; the transaction is the rule.
     */
    if (personId !== null) {
      const { data: claimed, error: lookupError } = await supabase
        .from("people")
        .select("id, role, joined_at")
        .eq("id", personId)
        .eq("archive_id", archive)
        .is("archived_at", null)
        .maybeSingle();

      if (lookupError) {
        results.push({ email, sent: false, error: "The invitation could not be saved." });
        continue;
      }
      if (!claimed) {
        results.push({ email, sent: false, error: "That person is not on the shelf." });
        continue;
      }
      if (claimed.role === "user") {
        // Her profile opens on one screen without a code, and is meant to
        // stay that way (M42). Inviting her would undo it.
        results.push({ email, sent: false, error: `${subjectName} does not need an invitation.` });
        continue;
      }
      if (claimed.joined_at) {
        results.push({ email, sent: false, error: "They have already joined." });
        continue;
      }
    }

    // The link carries the real secret; the code is the fallback for someone
    // reading it aloud, and it expires much sooner because it is much smaller.
    const token = generateInviteToken();
    const code = generateInviteCode();
    const { error } = await supabase.from("invitations").insert({
      archive_id: archive,
      email,
      name,
      relationship: rel,
      role: "co_author",
      person_id: personId,
      token_hash: hashInviteToken(token),
      code_hash: hashInviteCode(code),
      expires_at: inviteTokenExpiry(),
      code_expires_at: inviteCodeExpiry(),
      invited_by: req.profile!.personId,
    });

    if (error) {
      // Two partial unique indexes answer here: one live invitation per
      // address, and one live invitation per face (029). Both mean the same
      // thing to the admin looking at the form.
      const duplicate = (error as { code?: string }).code === "23505";
      results.push({
        email,
        sent: false,
        error: duplicate ? "Already invited." : "The invitation could not be saved.",
      });
      continue;
    }

    const emailed = await sendInviteEmail({ name, email }, { token, code }, {
      subjectName,
      inviterName: actorName(req.profile),
    });

    logActivity(
      req.profile,
      "contributor_added",
      `${actorName(req.profile)} invited ${name}`
    );

    results.push({ email, sent: emailed.success, code, reason: emailed.reason });
  }

  res.status(201).json({ results });
});

/**
 * Finds the invitation a caller is holding, by link token or by spoken code.
 *
 * The token is the primary path and lives for a fortnight; the code is 30
 * bits, so it has its own, much shorter expiry and is checked against that.
 * Every attempt is recorded against a fingerprint of the secret and the
 * address, because a distributed guess is invisible in per-IP counts and
 * plain in these.
 */
/**
 * How much failed guessing earns a rest, and how long that rest lasts.
 *
 * A six-character code is about thirty bits. Rate limiting by IP slows one
 * attacker and does nothing about a distributed one, so the counting happens
 * against the thing being attacked — the secret, and the invitee — and it
 * happens in the database, because a process-local counter is wrong the
 * moment this runs on a second machine.
 */
const ATTEMPT_WINDOW_MINUTES = 15;
const MAX_FAILURES_PER_SECRET = 8;
const MAX_FAILURES_PER_EMAIL = 15;
const MAX_FAILURES_GLOBAL = 50;
const INVITATION_LOCKOUT_MINUTES = 15;

async function findLiveInvitation(secret: { token?: string; code?: string }) {
  const byToken = !!secret.token;
  const hash = byToken ? hashInviteToken(secret.token!) : hashInviteCode(secret.code!);
  const fingerprint = hash.slice(0, 16);

  /*
   * The per-secret counter cannot see a spray.
   *
   * Each distinct wrong guess hashes to its own fingerprint, so an attacker
   * walking the code space never trips the per-secret threshold — every
   * guess is that fingerprint's first. And a wrong guess names no invitation,
   * so the per-email counter never sees the attack either. The one thing all
   * those guesses share is this table, so the shared limit is global: too
   * many failures across every fingerprint in the window and lookups close
   * for everyone until the window passes. Blunt on purpose — a legitimate
   * invitee mistypes a handful of times, so the budget is invisible to
   * families, while a brute force against a 30-bit space is capped at a few
   * thousand guesses a day instead of whatever the network could carry.
   * Refused guesses are not recorded, so the attack throttles to the budget
   * rather than locking families out indefinitely.
   */
  /*
   * Every counter here fails closed. A limiter that treats "the database
   * could not answer" as "zero recent failures" hands an attacker who can
   * induce database errors — or merely time an outage — an unthrottled door.
   * A refused lookup during a transient error is indistinguishable from a
   * wrong guess, which is the correct thing for it to look like.
   */
  const windowStart = new Date(Date.now() - ATTEMPT_WINDOW_MINUTES * 60_000).toISOString();
  const { count: recentFailures, error: globalError } = await supabase
    .from("invitation_attempts")
    .select("id", { count: "exact", head: true })
    .eq("succeeded", false)
    .gte("created_at", windowStart);
  if (globalError) {
    console.error("[onboarding] could not count recent failures, refusing:", globalError.message);
    return null;
  }
  if ((recentFailures ?? 0) >= MAX_FAILURES_GLOBAL) return null;

  // Refuse before doing any work. A guess that arrives during a lockout is
  // answered exactly like a wrong one: the attacker learns nothing from
  // being throttled.
  const { data: pressure, error: pressureError } = await supabase.rpc(
    "invitation_attempt_pressure",
    {
      p_fingerprint: fingerprint,
      p_email: null,
      p_window: `${ATTEMPT_WINDOW_MINUTES} minutes`,
    }
  );
  if (pressureError) {
    console.error("[onboarding] could not read attempt pressure, refusing:", pressureError.message);
    return null;
  }
  const recent = (Array.isArray(pressure) ? pressure[0] : pressure) as
    | { by_fingerprint?: number }
    | undefined;
  if ((recent?.by_fingerprint ?? 0) >= MAX_FAILURES_PER_SECRET) return null;

  const { data } = await supabase
    .from("invitations")
    .select(
      "id, archive_id, email, name, relationship, role, expires_at, code_expires_at, locked_until, lookup_attempts, invited_by"
    )
    .eq(byToken ? "token_hash" : "code_hash", hash)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .maybeSingle();

  const deadline = byToken ? data?.expires_at : (data?.code_expires_at ?? data?.expires_at);
  const locked =
    !!data?.locked_until && new Date(data.locked_until as string).getTime() > Date.now();
  const live = !!data && !locked && !!deadline && new Date(deadline).getTime() >= Date.now();

  // Recording is one atomic call: the row for the audit trail, and the
  // counter on the invitation itself. It used to read a column it had not
  // selected, so it wrote 1 forever however often a code was tried. A guess
  // that could not be recorded is refused too — an attacker who can break
  // the recorder must not thereby make guessing free.
  const { error: recordError } = await supabase.rpc("record_invitation_attempt", {
    p_fingerprint: fingerprint,
    p_email: live ? data!.email : null,
    p_succeeded: live,
    p_invitation: data?.id ?? null,
  });
  if (recordError) {
    console.error("[onboarding] could not record an attempt, refusing:", recordError.message);
    return null;
  }

  if (!live) return null;

  // The invitee is a target too: one address hammered across several
  // invitations is the distributed shape of the same attack.
  const { data: emailPressure, error: emailPressureError } = await supabase.rpc(
    "invitation_attempt_pressure",
    {
      p_fingerprint: fingerprint,
      p_email: data!.email,
      p_window: `${ATTEMPT_WINDOW_MINUTES} minutes`,
    }
  );
  if (emailPressureError) {
    console.error(
      "[onboarding] could not read invitee pressure, refusing:",
      emailPressureError.message
    );
    return null;
  }
  const byEmail =
    (Array.isArray(emailPressure) ? emailPressure[0] : emailPressure)?.by_email ?? 0;

  if (
    byEmail >= MAX_FAILURES_PER_EMAIL ||
    ((data!.lookup_attempts as number) ?? 0) >= MAX_FAILURES_PER_SECRET
  ) {
    await supabase
      .from("invitations")
      .update({
        locked_until: new Date(Date.now() + INVITATION_LOCKOUT_MINUTES * 60_000).toISOString(),
      })
      .eq("id", data!.id);
    console.warn(
      `[onboarding] invitation ${data!.id} locked for ${INVITATION_LOCKOUT_MINUTES}m — ` +
        `${byEmail} recent failures against this address`
    );
    return null;
  }

  return data!;
}

/** A link token if one was sent, otherwise the typed code. */
function presentedSecret(body: Record<string, unknown> | undefined) {
  const token = normaliseInviteToken(body?.token);
  if (token) return { token };
  const code = normaliseInviteCode(body?.code);
  if (code) return { code };
  return null;
}

/*
 * What the join screen is told (M18).
 *
 * This is a public endpoint answering an unauthenticated caller, so it says
 * only what lets a genuine invitee recognise the family: the name they are
 * called by at home, who invited them, and the name the invitation was
 * addressed to. The subject's legal name, date of birth and address are not
 * merely withheld from the response — they are never selected. Name, birth
 * date and address is the identity-theft triple, and this is a population
 * already targeted for it. A member can read those after joining, through
 * routes that require a session.
 */
onboardingRouter.post("/join/lookup", publicLimiter, requireObjectBody, async (req, res) => {
  const secret = presentedSecret(req.body);
  if (!secret) return res.status(400).json({ error: "That is not a valid code." });

  const invitation = await findLiveInvitation(secret);
  if (!invitation) {
    return res.status(404).json({ error: "This code is not valid any more." });
  }

  const [{ data: subjectRow }, { data: inviter }] = await Promise.all([
    supabase
      .from("settings")
      .select("display_name")
      .eq("archive_id", invitation.archive_id)
      .maybeSingle(),
    invitation.invited_by
      ? supabase.from("people").select("name").eq("id", invitation.invited_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  res.json({
    invitee_name: invitation.name,
    relationship: invitation.relationship,
    subject: { display_name: subjectRow?.display_name ?? "" },
    inviter_name: inviter?.name ? firstName(inviter.name) : null,
  });
});

/*
 * Joining: the code proves the email, the PIN protects the profile on shared
 * screens, and the name is theirs to correct — the inviter only guessed it.
 */
onboardingRouter.post("/join/complete", publicLimiter, requireObjectBody, async (req, res) => {
  const secret = presentedSecret(req.body);
  if (!secret) return res.status(400).json({ error: "That is not a valid code." });

  const { pin, name, address } = req.body;
  if (!isValidPinFormat(pin)) {
    return res.status(400).json({ error: "Choose a 6-digit PIN." });
  }
  if (typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ error: "Your name is required." });
  }
  if (name.trim().length > MAX_NAME) {
    return res.status(400).json({ error: "Your name is too long." });
  }
  if (address != null && (typeof address !== "string" || address.trim().length > MAX_PLACE)) {
    return res.status(400).json({ error: "The address is too long." });
  }

  const invitation = await findLiveInvitation(secret);
  if (!invitation) {
    return res.status(404).json({ error: "This code is not valid any more." });
  }

  /*
   * Acceptance is one transaction (M16).
   *
   * The lookup above is advisory: by the time we write, the invitation may
   * have been spent by a second tab or revoked by an admin. `accept_invitation`
   * consumes it with a conditional update that re-asserts unused, unrevoked
   * and unexpired, and only then creates the person and the membership — so
   * the request that loses the race leaves no half-built contributor behind.
   */
  const { data, error } = await supabase.rpc("accept_invitation", {
    p_invitation_id: invitation.id,
    p_account_id: null,
    p_email: invitation.email,
    p_display_name: name.trim(),
    p_name: name.trim(),
    p_address: typeof address === "string" ? address : null,
    p_pin_hash: await hashPin(pin),
    // Which deadline the transaction should enforce: the link's fortnight,
    // or the spoken code's two days.
    p_secret_kind: secret.token ? "token" : "code",
  });

  if (error) {
    const message = (error as { message?: string }).message ?? "";
    if (message.includes("already_member")) {
      return res.status(409).json({ error: "You have already joined this archive." });
    }
    if (message.includes("invitation_unavailable")) {
      return res.status(404).json({ error: "This code is not valid any more." });
    }
    return fail(res, 500, "Joining did not work. Try the code again.", error);
  }

  // The OUT columns carry an `out_` prefix so they cannot collide with the
  // table columns the function writes — see migration 024, where that
  // collision made every acceptance fail.
  const joined = Array.isArray(data) ? data[0] : data;
  if (!joined?.out_person_id) {
    return fail(res, 500, "Joining did not work. Try the code again.", {
      message: "empty rpc result",
    });
  }
  const role = (joined.out_role === "admin" ? "admin" : "co_author") as "admin" | "co_author";

  /*
   * The joiner leaves with a family session, not a trusted device (M94).
   *
   * This used to mint an installation and issue a device cookie — "the
   * browser joining becomes the contributor's trusted device in the same
   * breath". Two things in identity-model.md forbid it: a family may have
   * exactly one trusted device (:71-80), and a joined member signs in with
   * the family password and their PIN *from anywhere* (:45-47). A device
   * cookie on the phone they happened to accept on is the wrong tier, and
   * strands them the moment it lapses or they pick up another device.
   *
   * The invitation is a single-use, email-bound credential, so spending it
   * to open the remote tier they just earned is the shape the model wants —
   * and it saves asking for the family password in the same breath as the
   * PIN they have only just chosen.
   *
   * Elevated straight away, because they have proved who they are twice
   * over: the code proved the address, the PIN is one they just set. Landing
   * them on the chooser to pick themselves out of a list would be theatre.
   */
  const { data: family } = await supabase
    .from("families")
    .select("id, archive_id, session_version")
    .eq("archive_id", joined.out_archive_id)
    .maybeSingle();

  if (!family) {
    return fail(res, 500, "Joining did not work. Try the code again.", {
      message: "no family for the joined archive",
    });
  }

  const token = await openFamilySession(
    res,
    {
      id: family.id,
      archive_id: family.archive_id as string,
      session_version: family.session_version as number,
    },
    { userAgent: req.get("user-agent") ?? undefined }
  );
  const opened = token ? await readFamilySession(token) : null;
  if (!opened || !(await elevateSession(res, opened, { id: joined.out_person_id, role }))) {
    return fail(res, 500, "Joining did not work. Try the code again.", {
      message: "session not opened for the joiner",
    });
  }

  logActivity(
    { personId: joined.out_person_id, name: name.trim(), role, archiveId: joined.out_archive_id },
    "contributor_added",
    `${firstName(name)} joined the archive`
  );

  res.status(201).json({ ok: true, redirect_to: LANDING_PATH[role] });
});
