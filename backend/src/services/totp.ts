import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "../config/env.js";

/**
 * A second factor for the platform owner: six-digit codes from an
 * authenticator app (RFC 6238, SHA-1, 30-second steps, the default every app
 * understands).
 *
 * The owner's password alone once opened every family's export. The shared
 * secret is stored encrypted (AES-256-GCM, key derived from CODE_PEPPER), so a
 * copy of the `families` table does not hand out codes on its own.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
const ISSUER = "Recall";
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function key(): Buffer {
  return Buffer.from(hkdfSync("sha256", env.codePepper, "recall", "owner-totp-secret", 32));
}

function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text: string): Buffer {
  const clean = text.replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error("Not base32.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh 160-bit secret, in the base32 form authenticator apps expect. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** What the authenticator app scans. */
export function totpUri(secret: string, account: string): string {
  const label = encodeURIComponent(`${ISSUER}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${ISSUER}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

export function codeAt(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * True when `code` matches the current step or one step either side (clocks
 * drift). Returns the matched step so a caller can refuse a replay.
 */
export function verifyTotp(
  secret: string,
  code: unknown,
  now = Date.now()
): { ok: true; step: number } | { ok: false } {
  if (typeof code !== "string") return { ok: false };
  const typed = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(typed)) return { ok: false };
  const current = Math.floor(now / 1000 / STEP_SECONDS);
  let matched: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    const expected = Buffer.from(codeAt(secret, step));
    // Compare every candidate, so timing does not show which one matched.
    if (timingSafeEqual(expected, Buffer.from(typed)) && matched === null) matched = step;
  }
  return matched === null ? { ok: false } : { ok: true, step: matched };
}

/** Encrypt a secret for `families.owner_totp_secret`. */
export function sealTotpSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

/** Decrypt a stored secret. Throws when it was not sealed with this key. */
export function openTotpSecret(sealed: string): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("Unknown TOTP secret format.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}
