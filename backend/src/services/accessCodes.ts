import argon2 from "argon2";
import { randomInt } from "node:crypto";
import type { Role } from "../middleware/auth.js";

export type { Role };

export const ROLES: Role[] = ["user", "admin", "co_author"];

/**
 * Roles.
 *
 * `user` is the person the archive is for. She sees the display and nothing
 * else — no management screens at all.
 *
 * `co_author` adds memories and edits their own, but never deletes and never
 * sees other people's details. A falling-out or a mistake cannot erase
 * someone else's photographs.
 *
 * `admin` runs the archive: all content, all people, all access.
 */
export const CAN_OPEN_ADMIN: Role[] = ["admin", "co_author"];
export const CAN_WRITE_CONTENT: Role[] = ["admin", "co_author"];
export const CAN_DELETE: Role[] = ["admin"];
export const CAN_MANAGE_PEOPLE: Role[] = ["admin"];

/** Where each role goes once its profile is unlocked. */
export const LANDING_PATH: Record<Role, string> = {
  user: "/",
  co_author: "/admin",
  admin: "/admin",
};

// ---------------------------------------------------------------- level 1

/**
 * The installation secret is presented as "<lookup>-<secret>". Only the lookup
 * half is stored readable, so a sign-in is one indexed read; the secret half
 * is argon2-hashed. The alphabet omits characters that are easily confused
 * when read off a screen (0/O, 1/I/L).
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomString(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export interface GeneratedSecret {
  plaintext: string;
  hash: string;
}

export async function generateInstallationSecret(): Promise<GeneratedSecret> {
  const secret = `${randomString(4)}-${randomString(8)}`;
  return { plaintext: secret, hash: await argon2.hash(secret, { type: argon2.argon2id }) };
}

export function normaliseSecret(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const cleaned = input.trim().toUpperCase().replace(/\s+/g, "");
  return /^[A-Z0-9]{4}-?[A-Z0-9]{8}$/.test(cleaned) ? cleaned.replace(/-/g, "") : null;
}

export async function verifySecret(hash: string, secret: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, secret);
  } catch {
    return false;
  }
}
