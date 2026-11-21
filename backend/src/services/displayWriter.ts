import type { Request } from "express";
import { actingProfile } from "../middleware/auth.js";

/**
 * Is this request her screen talking about itself? (access-7)
 *
 * Some writes are the display's own report — what is on screen, when it
 * woke, which memory was open — and belong to the family's one trusted
 * machine. `requireDevice` alone is not that test: with no device cookie it
 * admits any elevated family session, and with one it admits any
 * installation that is not revoked. So a member on their phone could move
 * the dashboard's ON SCREEN marker, and a second laptop could write her
 * engagement data.
 *
 * The answer is yes only for a trusted installation with nobody managing
 * from it: no acting profile at all, or the subject's own (`user`), which is
 * the profile her screen carries. The same test media.ts uses for its
 * trusted display, widened by the one profile that only ever exists there.
 */
export async function isTrustedDisplay(req: Request): Promise<boolean> {
  if (req.device?.isTrusted !== true) return false;
  const profile = await actingProfile(req);
  return !profile || profile.role === "user";
}
