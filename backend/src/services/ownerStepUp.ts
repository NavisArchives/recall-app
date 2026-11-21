import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { supabase } from "../config/supabase.js";
import { FAMILY_COOKIE, readFamilySession, type FamilySession } from "./familyAuth.js";

/**
 * "Is it really you, just now?" — before a family's content leaves (access-5).
 *
 * The platform owner's session is eight hours long and was the whole
 * credential behind every family's full-archive export. A laptop left open,
 * or a session lifted from one, was therefore every family's photographs.
 * The two routes that let content leave — the export and the postcard print
 * sheet — now also need a step-up: the password typed again (and the
 * authenticator code, once two-step sign-in is on), within the last ten
 * minutes, on this very session.
 *
 * The proof is a signed httpOnly cookie, the same signing approach and the
 * same cookie options as the device and profile tokens in middleware/auth.ts,
 * with two differences that are the point of it:
 *
 *   · it is bound to the family AND to the family session it was earned on,
 *     so signing out (or a new sign-in) ends it, and a copy of it is useless
 *     without the session beside it;
 *   · it names its own kind and pins HS256, so no other token this backend
 *     signs can be presented as one.
 *
 * Its path is `/api/owner`: nothing outside that surface ever needs to see it.
 */

export const STEP_UP_COOKIE = "recall_owner_step_up";
export const STEP_UP_SECONDS = 10 * 60;
const STEP_UP_PATH = "/api/owner";
const KIND = "owner_step_up";

interface StepUpClaim {
  kind: typeof KIND;
  familyId: string;
  sessionId: string;
  exp: number;
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: env.isProduction,
    path: STEP_UP_PATH,
  };
}

/** Sets the step-up cookie for this owner session. Returns when it lapses. */
export function issueStepUp(res: Response, owner: FamilySession): Date {
  const token = jwt.sign(
    { kind: KIND, familyId: owner.familyId, sessionId: owner.id },
    env.sessionSecret,
    { expiresIn: STEP_UP_SECONDS, algorithm: "HS256" }
  );
  res.cookie(STEP_UP_COOKIE, token, { ...cookieOptions(), maxAge: STEP_UP_SECONDS * 1000 });
  return new Date(Date.now() + STEP_UP_SECONDS * 1000);
}

export function clearStepUp(res: Response): void {
  res.clearCookie(STEP_UP_COOKIE, cookieOptions());
}

/**
 * The live step-up for exactly this owner session, or null.
 *
 * A token for another family, another session, of another kind, or past its
 * ten minutes is the same as none.
 */
export function readStepUp(req: Request, owner: FamilySession): { expiresAt: Date } | null {
  const token = req.cookies?.[STEP_UP_COOKIE];
  if (typeof token !== "string" || !token) return null;
  try {
    const claim = jwt.verify(token, env.sessionSecret, { algorithms: ["HS256"] }) as Partial<StepUpClaim>;
    if (typeof claim !== "object" || !claim) return null;
    if (claim.kind !== KIND) return null;
    if (claim.familyId !== owner.familyId || claim.sessionId !== owner.id) return null;
    if (typeof claim.exp !== "number") return null;
    return { expiresAt: new Date(claim.exp * 1000) };
  } catch {
    return null;
  }
}

/** The family session behind an owner request. `requirePlatformOwner` has already vouched for it. */
export function ownerSession(req: Request): Promise<FamilySession | null> {
  return readFamilySession(req.cookies?.[FAMILY_COOKIE]);
}

export const STEP_UP_REQUIRED = {
  error: "Confirm it is you before this leaves the platform.",
  step_up_required: true,
  // `code` as well, because the frontend's api client carries `code` on the
  // error it throws and nothing else from the body.
  code: "step_up_required",
} as const;

/**
 * Guard for the routes that let content leave. Runs after
 * `requirePlatformOwner`, so a stranger has already met the 404.
 */
export async function requireOwnerStepUp(req: Request, res: Response, next: NextFunction) {
  const owner = await ownerSession(req);
  if (!owner) return res.status(404).json({ error: "Not found." });
  if (!readStepUp(req, owner)) return res.status(401).json(STEP_UP_REQUIRED);
  res.locals.owner = owner;
  next();
}

// ─────────────────────────────────────────────────────────────── the record

export type OwnerAuditAction =
  | "step_up"
  | "step_up_failed"
  | "export"
  | "print"
  | "print_photo"
  | "totp_setup"
  | "totp_enabled"
  | "totp_disabled";

/**
 * One row in `owner_audit_log` (065). Returns false when it could not be
 * written — and every caller that is about to let content leave refuses on
 * false. An export nobody can account for afterwards does not happen.
 */
export async function recordOwnerAudit(entry: {
  familyId: string;
  action: OwnerAuditAction;
  targetFamilyId?: string | null;
  archiveId?: string | null;
  cardId?: string | null;
}): Promise<boolean> {
  const { error } = await supabase.from("owner_audit_log").insert({
    family_id: entry.familyId,
    action: entry.action,
    target_family_id: entry.targetFamilyId ?? null,
    archive_id: entry.archiveId ?? null,
    card_id: entry.cardId ?? null,
  });
  if (error) {
    console.error(`[owner] the audit row for ${entry.action} could not be written:`, error.message);
    return false;
  }
  return true;
}
