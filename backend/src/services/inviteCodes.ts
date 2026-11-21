import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

/**
 * The secrets that travel in onboarding emails.
 *
 * Three kinds, all found by hash and therefore all hashed the same way — a
 * keyed HMAC under a server-side pepper. A lookup hash cannot be salted per
 * row (the row is found *by* the code), so without a key a stolen table could
 * be matched against a precomputed dictionary of the whole code space. The
 * pepper makes that table worthless on its own, and the domain prefix keeps a
 * secret minted for one purpose from ever being spent on another.
 *
 *   invite token   128 bits, in a link — the primary path
 *   invite code     30 bits, six characters — a fallback to read aloud
 *   receipt        128 bits, returned once to whoever answered a code
 */

const ALPHABET = "ABCDEFGHJKLMNPQRTUVWXYZ2346789";

export const INVITE_CODE_LENGTH = 6;

/**
 * The emailed link is the primary path and can live a fortnight: guessing a
 * 128-bit token is not a thing that happens. The spoken code is 30 bits, so
 * its life is measured in days and its window is the thing protecting it.
 */
export const INVITE_TOKEN_TTL_DAYS = 14;
export const INVITE_CODE_TTL_DAYS = 2;

/**
 * Domain separation: one secret, one purpose, enforced by the key itself.
 *
 * `founder` is the front door's own kind (M44) and it is deliberately not
 * interchangeable with `invite-token`. A member invitation joins a family
 * that already exists; a founding invitation *creates* one. If the two shared
 * a domain, a member invitation could be spent to found a family — and every
 * family on the platform would be creatable by anyone who was ever invited to
 * help with one. The HMAC key makes that a hash mismatch rather than a
 * question of whether some route remembered to check.
 */
type Domain = "invite-token" | "invite-code" | "verify" | "receipt" | "founder";

function digest(domain: Domain, secret: string): string {
  return createHmac("sha256", env.codePepper).update(`${domain}:${secret}`).digest("hex");
}

/** A 128-bit secret, url-safe, for links and receipts. */
function highEntropySecret(): string {
  return randomBytes(32).toString("base64url");
}

// ------------------------------------------------------------- invitations

export function generateInviteToken(): string {
  return highEntropySecret();
}

export function generateInviteCode(): string {
  let code = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

/** Uppercases and strips the separators people naturally type. */
export function normaliseInviteCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.toUpperCase().replace(/[\s-]/g, "");
  if (code.length !== INVITE_CODE_LENGTH) return null;
  if ([...code].some((c) => !ALPHABET.includes(c))) return null;
  return code;
}

/** A token arrives from a link, so it is taken as sent or not at all. */
export function normaliseInviteToken(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const token = raw.trim();
  if (token.length < 32 || token.length > 128) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return null;
  return token;
}

export function hashInviteToken(token: string): string {
  return digest("invite-token", token);
}

export function hashInviteCode(code: string): string {
  return digest("invite-code", code);
}

export function inviteTokenExpiry(): string {
  return new Date(Date.now() + INVITE_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function inviteCodeExpiry(): string {
  return new Date(Date.now() + INVITE_CODE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------- founding invitations

/**
 * The front door's own secret (M44).
 *
 * A founding invitation creates a family; a member invitation joins one. They
 * are never the same token, and the `founder` domain is what makes that true
 * by construction rather than by remembering to check.
 *
 * Longer-lived than a member invitation because it travels differently: the
 * platform owner sends one to somebody they have spoken to, who may take a
 * week to sit down with it. It is single-use and revocable, which is what
 * actually bounds it.
 */
export const FOUNDER_TOKEN_TTL_DAYS = 30;

export function generateFounderToken(): string {
  return highEntropySecret();
}

export function hashFounderToken(token: string): string {
  return digest("founder", token);
}

export function founderTokenExpiry(): string {
  return new Date(Date.now() + FOUNDER_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** Same shape rules as an invite token: 128 bits, url-safe, nothing else. */
export function normaliseFounderToken(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const token = raw.trim();
  if (token.length < 32 || token.length > 128) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return null;
  return token;
}

// ------------------------------------------------- email verification codes

export const VERIFY_CODE_TTL_MINUTES = 15;

export function hashVerificationCode(code: string): string {
  return digest("verify", code);
}

export function verificationExpiry(): string {
  return new Date(Date.now() + VERIFY_CODE_TTL_MINUTES * 60 * 1000).toISOString();
}

// --------------------------------------------------------- signup receipts

/**
 * The proof that *this* caller answered the code.
 *
 * A verified address alone proved only that somebody, somewhere, held that
 * inbox — which anyone could then spend. The receipt is returned once, to the
 * browser that answered, and signup will not proceed without it. Five minutes
 * is enough to finish a form and short enough that a leaked one is stale.
 */
export const RECEIPT_TTL_MINUTES = 20;

export function generateReceipt(): string {
  return highEntropySecret();
}

export function hashReceipt(receipt: string): string {
  return digest("receipt", receipt);
}

export function receiptExpiry(): string {
  return new Date(Date.now() + RECEIPT_TTL_MINUTES * 60 * 1000).toISOString();
}

export function normaliseReceipt(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const receipt = raw.trim();
  if (receipt.length < 32 || receipt.length > 128) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(receipt)) return null;
  return receipt;
}

/** Constant-time compare, for the places a secret is checked in memory. */
export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
