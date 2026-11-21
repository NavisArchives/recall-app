import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { supabase } from "../config/supabase.js";
import { readFamilySession, clearFamilyCookie, FAMILY_COOKIE } from "../services/familyAuth.js";
import { PROFILE_AUTH_COLUMNS } from "../services/dto.js";

export type Role = "user" | "admin" | "co_author";

export const DEVICE_COOKIE = "recall_device";
export const PROFILE_COOKIE = "recall_profile";

/**
 * Two tiers.
 *
 * The device session answers "is this a trusted machine?" and lasts long
 * enough that Margaret's display is never interrupted. The profile session
 * answers "who is at the keyboard right now?" and is short, so a laptop left
 * open in a cafe does not stay signed in as an admin.
 *
 * Switching profiles replaces only the profile session, which is what lets
 * someone walk up to her PC, add a memory, and leave without signing the
 * whole installation out.
 *
 * THIS WAS 30 DAYS, AND NOTHING RE-SIGNED IT (056, stability sweep 17 Sep
 * 2026). Every paired screen expired on day 31 with no recovery but a
 * manual re-pair — found independently by five sweep agents, confirmed live
 * against Andy's own screen. deviceGuard already re-reads the installations
 * row on every request (revoked_at, is_trusted) and refuses a revoked or
 * unknown device regardless of what the JWT claims — CLAUDE.md's "the row
 * decides" — so the JWT's own crypto lifetime was never the real security
 * boundary, only an accidental one. It is raised here, well past a year, so
 * it structurally cannot be the thing that blanks her screen; the owner's
 * 90-day renewal cadence (installations.session_expires_at) is a courtesy
 * reminder layered on top — see services/deviceSession.ts — never an
 * enforcement date. A revoked device is caught earlier in `deviceGuard`,
 * before this ceiling is ever consulted, so raising it does not extend a
 * device that has actually lost trust.
 */
const DEVICE_TTL_SECONDS = 60 * 60 * 24 * 400;

const PROFILE_TTL_SECONDS: Record<Role, number> = {
  user: 60 * 60 * 24 * 365,
  co_author: 60 * 60 * 8,
  admin: 60 * 60 * 8,
};

export interface DeviceSession {
  /**
   * Whether this is the family's one trusted screen — the only place the
   * subject's profile exists. Read from the row on every request, never
   * carried in the cookie, because the cookie is what an attacker holds.
   */
  isTrusted?: boolean;
  installationId: string;
  /**
   * Which family's archive this machine belongs to.
   *
   * Carried in the token rather than looked up, because the display has to
   * answer with no internet: a database read here would make her screen
   * depend on Supabase being reachable, which is the one thing the cache
   * exists to avoid.
   */
  archiveId?: string;
}

export interface ProfileSession {
  personId: string;
  name: string;
  role: Role;
  archiveId?: string;
  /** Millisecond-resolution revocation boundary for this local profile session. */
  sessionStartedAt?: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      device?: DeviceSession;
      profile?: ProfileSession;
      archiveId?: string;
      /**
       * Set only by `requirePlatformOwner`. Whoever runs Recall itself — not
       * the family owner, who is `archives.owner_account_id`.
       */
      platformOwner?: true;
    }
  }
}

/*
 * Which cookie a token was minted for (authn-5).
 *
 * Both tiers are signed with the same secret, and until now they were told
 * apart only by which claims happened to be present: a device token needs an
 * `installationId`, a profile token a `personId`, `name` and `role`. That
 * holds only while the two shapes never overlap — one added field away from a
 * device token being read as a profile or the other way round. So every token
 * now says what it is, and a reader refuses a token that says it is the other
 * kind.
 *
 * A token that says nothing is still accepted. Her screen's profile cookie is
 * signed for a year and the device cookie for longer; refusing every token
 * minted before this line would blank the display the day it deploys, which
 * is the one thing this codebase promises never to do. Untyped tokens age out
 * on their own, and each re-issue stamps a type.
 */
type TokenType = "device" | "profile";

/*
 * The only algorithm these tokens are ever signed with. jsonwebtoken already
 * limits a string secret to the HS family and refuses `none`; naming the one
 * in use means a library default changing later cannot widen what verifies.
 */
const ALGORITHMS: jwt.Algorithm[] = ["HS256"];

function sign(payload: object, ttl: number, typ: TokenType): string {
  // A payload read back out of a token still carries `iat` and `exp`, and
  // signing that again with an expiry is an error rather than a renewal. Drop
  // the claims the library owns so any session can be re-issued safely.
  const { iat, exp, nbf, ...claims } = payload as Record<string, unknown>;
  void iat, exp, nbf;
  return jwt.sign({ ...claims, typ }, env.sessionSecret, { expiresIn: ttl, algorithm: "HS256" });
}

/** The verified claims of a token of this type, or null. Never throws. */
function verifyToken(token: string, typ: TokenType): Record<string, unknown> | null {
  try {
    const payload = jwt.verify(token, env.sessionSecret, { algorithms: ALGORITHMS });
    if (typeof payload !== "object" || !payload) return null;
    const claimed = (payload as { typ?: unknown }).typ;
    if (claimed !== undefined && claimed !== typ) return null;
    return payload as Record<string, unknown>;
  } catch {
    return null;
  }
}

function typeOf(cookie: string): TokenType {
  return cookie === PROFILE_COOKIE ? "profile" : "device";
}

function read<T>(req: Request, cookie: string, keys: (keyof T)[]): T | null {
  const token = req.cookies?.[cookie];
  if (!token) return null;

  const payload = verifyToken(token, typeOf(cookie));
  if (!payload) return null;
  if (keys.some((k) => (payload as T)[k] === undefined)) return null;
  return payload as T;
}

/**
 * When a cookie's token was minted, in ms — the JWT's own `iat` (M159).
 *
 * `sign()` drops the old `iat` before re-signing, so a re-issued token gets a
 * fresh one; this reads that stamp back. It is the half of the reset the
 * guards had been missing: `password_set_at` was written and never compared,
 * so a token from before a reset kept working. Returns null when the cookie
 * is absent or unverifiable — the caller then has no stamp to judge, which
 * fails the same way a missing cookie already does.
 */
function issuedAt(req: Request, cookie: string): number | null {
  const token = req.cookies?.[cookie];
  if (!token) return null;
  const iat = verifyToken(token, typeOf(cookie))?.iat;
  return typeof iat === "number" ? iat * 1000 : null;
}

function profileIssuedAt(req: Request): number | null {
  const token = req.cookies?.[PROFILE_COOKIE];
  if (!token) return null;
  const payload = verifyToken(token, "profile");
  if (!payload) return null;
  const startedAt = payload.sessionStartedAt;
  if (typeof startedAt === "number") return startedAt;
  const iat = payload.iat;
  return typeof iat === "number" ? iat * 1000 : null;
}

/**
 * The family's session cutoff — the later of its two revocation stamps.
 *
 * Two deliberate acts end the remote tiers, each with its own timestamp: a
 * password reset (`password_set_at`, M159) and "sign out everywhere"
 * (`sessions_valid_from`, M161). A token is stale if it was issued before
 * EITHER, so the cutoff is the **later** of the two — neither shadows the
 * other, and each keeps its own meaning. Read per guarded request, scoped to
 * the archive, so an act in one family never signs out another. Null when
 * there is no archive or neither stamp is set: nothing to enforce, rather
 * than "reject everything".
 */
/**
 * The read has three outcomes, not two (M162): a cutoff (or null = no stamp),
 * or a genuine failure. Collapsing failure to null is how a reset silently
 * stopped being enforced during an outage — a failed read looked exactly like
 * "this family never reset." `readFailed` lets the caller fail closed instead.
 */
interface Cutoff {
  at: number | null;
  readFailed: boolean;
}

/** Postgres "column does not exist" — the one error that means pre-042, not an outage. */
const UNDEFINED_COLUMN = "42703";

async function familyCutoff(archiveId: string | undefined): Promise<Cutoff> {
  if (!archiveId) return { at: null, readFailed: false };

  const first = await supabase
    .from("families")
    .select("password_set_at, sessions_valid_from")
    .eq("archive_id", archiveId)
    .maybeSingle();

  let row = first.data as { password_set_at?: string | null; sessions_valid_from?: string | null } | null;

  if (first.error) {
    /*
     * Only a missing column (pre-042, owner-executed migration not yet run)
     * is a benign, expected state worth retrying with the reset stamp alone —
     * M161's resilience. ANY OTHER error is an outage or a real fault, and
     * must NOT be mistaken for "no cutoff": that is the F57 skeleton key. So
     * a genuine error signals the caller to fail closed, and only `42703`
     * narrows to the reset-only retry.
     */
    if ((first.error as { code?: string }).code !== UNDEFINED_COLUMN) {
      return { at: null, readFailed: true };
    }
    const retry = await supabase
      .from("families")
      .select("password_set_at")
      .eq("archive_id", archiveId)
      .maybeSingle();
    if (retry.error) return { at: null, readFailed: true };
    row = retry.data as { password_set_at?: string | null } | null;
  }

  const stamps = [row?.password_set_at, row?.sessions_valid_from]
    .map((raw) => (raw ? Date.parse(raw) : NaN))
    .filter((t) => !Number.isNaN(t));
  return { at: stamps.length ? Math.max(...stamps) : null, readFailed: false };
}

/** A token issued before the family's last password reset is stale (M159). */
function stalePassword(iat: number | null, cutoff: number | null): boolean {
  return iat !== null && cutoff !== null && iat < cutoff;
}

function profileSessionRevoked(iat: number | null, raw: unknown): boolean {
  if (iat === null || typeof raw !== "string") return false;
  const cutoff = Date.parse(raw);
  return !Number.isNaN(cutoff) && iat < cutoff;
}

// ---------------------------------------------------------------- device

export function issueDeviceCookie(res: Response, session: DeviceSession) {
  res.cookie(DEVICE_COOKIE, sign(session, DEVICE_TTL_SECONDS, "device"), {
    httpOnly: true,
    sameSite: "strict",
    secure: env.isProduction,
    maxAge: DEVICE_TTL_SECONDS * 1000,
    path: "/",
  });
}

export function readDevice(req: Request): DeviceSession | null {
  return read<DeviceSession>(req, DEVICE_COOKIE, ["installationId"]);
}

/**
 * What this process last learned about an installation, for the moments the
 * database cannot answer.
 *
 * An outage used to degrade to the token's own claim: any signed device
 * cookie was honoured for its full thirty days the moment Supabase stopped
 * answering — including one the family had revoked before the outage began.
 * An outage must never make authorisation *less* strict than the last thing
 * the database actually said, so what the row said is remembered here, and
 * during an outage the memory decides. A device this process has never
 * verified gets nothing from an outage; a device it last saw revoked stays
 * revoked. The display polls constantly, so its entry is always warm.
 *
 * **The offline replay policy, explicitly:** how long the memory may answer
 * for an unreachable database depends on what this process is. A kiosk is
 * the family's own machine in their own living room — its screen surviving a
 * week-long outage is the product working, so its memory lasts as long as
 * the device cookie itself. A shared api process serves every family and
 * fails stricter: one day, then 503 until the database answers. Revocations
 * have no expiry in either direction.
 *
 * On a kiosk the memory is also **persisted** (atomically, beside the media
 * cache), because a power cut mid-outage would otherwise turn a warm cache
 * cold and blank the one screen the offline story exists for. An api process
 * persists nothing — restarts there fail closed by design, and its replicas
 * each carry their own memory, so a fleet answers only as leniently as the
 * replica that last verified the row.
 */
const VERIFIED_GRACE_MS =
  env.role === "kiosk" ? DEVICE_TTL_SECONDS * 1000 : 24 * 60 * 60 * 1000;

const VERIFIED_STATE_FILE = path.resolve(process.cwd(), ".cache/device-verification.json");

interface VerifiedInstallation {
  archiveId?: string;
  revoked: boolean;
  at: number;
  /*
   * What the database last said about this device's family and trust, so the
   * offline branch can enforce it (M162). `cutoff` is the family's last-known
   * session cutoff; `trusted` is whether this was the family's one screen. A
   * departed member's untrusted device that predates the remembered cutoff is
   * refused even through an outage; the trusted screen rides through, exactly
   * as it does online (M29).
   */
  cutoff?: number | null;
  trusted?: boolean;
}

const lastVerified = new Map<string, VerifiedInstallation>();

function rememberVerified(installationId: string, entry: VerifiedInstallation) {
  lastVerified.set(installationId, entry);

  if (env.role !== "kiosk") return;
  const snapshot = JSON.stringify(Object.fromEntries(lastVerified));
  const temporary = `${VERIFIED_STATE_FILE}.${process.pid}.tmp`;
  // Fire-and-forget and atomic: a crash mid-write leaves the old file, never
  // half of the new one. Losing a write costs one re-verification, nothing.
  void mkdir(path.dirname(VERIFIED_STATE_FILE), { recursive: true })
    .then(() => writeFile(temporary, snapshot))
    .then(() => rename(temporary, VERIFIED_STATE_FILE))
    .catch(() => {});
}

async function loadPersistedVerification() {
  if (env.role !== "kiosk") return;
  try {
    const raw = JSON.parse(await readFile(VERIFIED_STATE_FILE, "utf8")) as Record<
      string,
      VerifiedInstallation
    >;
    for (const [id, entry] of Object.entries(raw)) {
      if (typeof entry?.at === "number" && typeof entry?.revoked === "boolean") {
        lastVerified.set(id, entry);
      }
    }
  } catch {
    // No file yet, or an unreadable one: the cache simply starts cold.
  }
}
void loadPersistedVerification();

/** Test seam: an outage cache carried between tests would decide the wrong ones. */
export function forgetVerifiedInstallations() {
  lastVerified.clear();
}

function deviceGuard(allowChooserStage: boolean) {
  return async function (req: Request, res: Response, next: NextFunction) {
    const device = readDevice(req);

    /*
     * A signed-in family reaches these routes too (M40) — once it has a
     * person.
     *
     * This guard was written for one caller — the screen in the living room —
     * and it asks "is this a trusted machine?". But the family's own shelf is
     * read through the same routes, so a daughter signed in from her phone
     * would be turned away from the very list she came to work on.
     *
     * The password alone is not enough, though. The identity spec is exact:
     * the family password opens the profile chooser and nothing more; the PIN
     * is what says who you are. A chooser-stage session that could already
     * read the channels, the people and the photographs would make the PIN a
     * decoration. So the session must be *elevated* — person chosen, PIN
     * accepted — before these routes answer. The chooser's own needs (the
     * list of names, the faces beside them) come from routes that opt in via
     * `requireDeviceOrChooser`, which is front-door information and no more.
     *
     * Margaret's screen never comes through here with one, so her path is
     * exactly as it was.
     */
    if (!device) {
      const family = await readFamilySession(req.cookies?.[FAMILY_COOKIE]);
      if (family) {
        if (family.personId && family.role) {
          req.archiveId = family.archiveId;
          req.profile = {
            personId: family.personId,
            name: "",
            role: family.role as Role,
            archiveId: family.archiveId,
          };
          return next();
        }
        if (allowChooserStage) {
          req.archiveId = family.archiveId;
          return next();
        }
        return res
          .status(403)
          .json({ error: "Choose a profile first.", code: "profile_required" });
      }
      return res.status(401).json({ error: "This device is not authorised." });
    }

    /*
     * The row decides, on every request (M42, completing M06).
     *
     * This used to read the installation only for tokens minted before
     * archives existed. A modern cookie was honoured for its full thirty days
     * with no further question — so revoking a device did nothing until the
     * token happened to expire, and "revoke this screen" was a button that
     * described an intention rather than an effect. A signed token that
     * outlives its revocation is not a session; it is a souvenir.
     *
     * It also carries `is_trusted`, which is what makes the one-screen rule
     * enforceable at the point requests actually arrive.
     */
    const { data: installation, error } = await supabase
      .from("installations")
      .select("archive_id, revoked_at, is_trusted")
      .eq("id", device.installationId)
      .maybeSingle();

    /*
     * An unreachable database must not become a dead screen — and must not
     * become a skeleton key either.
     *
     * M42 asks this check to fail closed, and for management it does — that
     * path runs through requireRole, which already refuses on a database
     * error. But requireDevice is also the door Margaret's display comes
     * through, and the offline media fallback exists precisely so her screen
     * keeps showing her family through a Supabase outage. Refusing everything
     * here would make the outage the thing that blanks the living room.
     *
     * So an outage degrades to the *last thing the row said*, not to the
     * token's own claim. A device this process verified recently keeps
     * working; one it last saw revoked stays refused; one it has never seen
     * answers 503 — a temporary condition, not a sign-out. Either way
     * `isTrusted` stays false, so the subject's profile is not reachable on
     * an unverified device even during an outage: the safe direction to fail
     * in.
     */
    if (error) {
      const known = lastVerified.get(device.installationId);
      if (known?.revoked) {
        return res.status(401).json({ error: "This device is not authorised." });
      }
      if (!known || Date.now() - known.at > VERIFIED_GRACE_MS) {
        console.error("[auth] could not verify an unknown device, refusing:", error.message);
        return res.status(503).json({ error: "Verification is not possible right now." });
      }
      if (device.archiveId && known.archiveId && device.archiveId !== known.archiveId) {
        return res.status(401).json({ error: "This device is not authorised." });
      }
      /*
       * The cutoff holds through the outage, from remembered state (M162).
       *
       * A reset/logout writes the family stamp but never sets
       * `installations.revoked_at`, so `known.revoked` stays false and a
       * pre-cutoff device would otherwise ride its grace window straight
       * through the outage — the skeleton key F57 named. The last successful
       * verify recorded the family's cutoff, so it is enforced here too: an
       * untrusted device that predates it is refused. The trusted screen was
       * remembered as trusted and rides through, so her display never blanks
       * (M29) — the whole reason this branch exists.
       *
       * Accepted limit: `known.cutoff` is only as fresh as this device's last
       * successful read. If a reset lands and an outage begins before this
       * device makes any request in the gap, its remembered cutoff is the
       * pre-reset value and it rides until the DB recovers (the online path
       * then refuses it) or the grace window lapses. Closing that would need
       * the reset to push into every replica's in-memory map — a broadcast
       * layer, not a tweak here — and it is the same staleness the `revoked`
       * flag already carries. Enforcing the last thing the database said is
       * the honest ceiling of a per-process remembered state.
       */
      if (!known.trusted && stalePassword(issuedAt(req, DEVICE_COOKIE), known.cutoff ?? null)) {
        return res.status(401).json({ error: "This device is not authorised." });
      }
      console.error("[auth] database unreachable, using last verified state:", error.message);
      device.isTrusted = known.trusted === true;
      req.device = device;
      req.archiveId = device.archiveId ?? known.archiveId;
      return next();
    }
    if (!installation || installation.revoked_at) {
      rememberVerified(device.installationId, { revoked: true, at: Date.now() });
      return res.status(401).json({ error: "This device is not authorised." });
    }

    const archiveFromRow = (installation.archive_id as string | null) ?? undefined;

    // A cookie that names a different family than the row does is not a
    // mismatch to reconcile — it is a token that must stop working.
    if (device.archiveId && archiveFromRow && device.archiveId !== archiveFromRow) {
      return res.status(401).json({ error: "This device is not authorised." });
    }

    device.isTrusted = installation.is_trusted === true;

    /*
     * A reset / "sign out everywhere" signs out the remote tiers, not her
     * screen (M159/M161, owner's call).
     *
     * The trusted device is Margaret's living-room display; the reset must
     * not blank it (M29) — moving Recall to a new screen is M117's ceremony.
     * So her screen is exempt and never pays the cutoff read. Every other
     * device — a superseded machine, one that lost trust — is a remote key,
     * and a cookie minted before the last reset or sign-out stops working.
     *
     * A failed cutoff read fails CLOSED for an untrusted device (M162/F57):
     * the read error must not read as "no cutoff", which is how an outage
     * used to hand a departed member's key straight through.
     */
    let cutoffAt: number | null = null;
    if (!device.isTrusted) {
      const cutoff = await familyCutoff(archiveFromRow);
      // A failed read fails closed; there is no fresh cutoff to remember, and
      // the offline branch will hold the last one it did learn.
      if (cutoff.readFailed) {
        return res.status(401).json({ error: "This device is not authorised." });
      }
      cutoffAt = cutoff.at;
    }

    /*
     * Remember the last thing the row said — archive, trust, and cutoff —
     * BEFORE the stale verdict, so the offline branch can enforce it (M162).
     * Remembering first is deliberate: a device we are about to refuse online
     * still leaves the *current* family cutoff behind, so a Supabase outage a
     * moment later cannot roll enforcement back to a pre-reset value and let
     * that same device ride its grace window. The trusted screen is
     * remembered as trusted and is exempt online and offline alike (M29).
     */
    rememberVerified(device.installationId, {
      archiveId: archiveFromRow,
      revoked: false,
      at: Date.now(),
      cutoff: cutoffAt,
      trusted: device.isTrusted,
    });

    if (!device.isTrusted && stalePassword(issuedAt(req, DEVICE_COOKIE), cutoffAt)) {
      return res.status(401).json({ error: "This device is not authorised." });
    }

    if (!device.archiveId && archiveFromRow) {
      device.archiveId = archiveFromRow;
      // Refreshing the cookie is a convenience, never a reason to fail the
      // request it was riding on.
      try {
        issueDeviceCookie(res, {
          installationId: device.installationId,
          archiveId: device.archiveId,
        });
      } catch (err) {
        console.error("[auth] could not refresh the device cookie:", err);
      }
    }

    req.device = device;
    req.archiveId = device.archiveId;
    next();
  };
}

export const requireDevice = deviceGuard(false);

/**
 * The chooser's own door: what a family password alone may reach.
 *
 * The chooser page shows first names and faces — front-door information. The
 * faces are served by `/api/media/person/:id/photo`, which sits behind the
 * device guard, so the one route that draws them opts into chooser-stage
 * access here. Everything else keeps requiring an elevated session.
 */
export const requireDeviceOrChooser = deviceGuard(true);

/**
 * The archive this request is about, or nothing.
 *
 * Every query that touches a family's rows filters on this. A route that
 * cannot determine it must refuse rather than fall back to "all of them" —
 * that fallback is precisely how one household ends up reading another's
 * memories.
 */
export function archiveOf(req: Request): string | null {
  return req.archiveId ?? req.device?.archiveId ?? req.profile?.archiveId ?? null;
}

export function requireArchive(req: Request, res: Response): string | null {
  const id = archiveOf(req);
  if (!id) {
    res.status(401).json({ error: "Your session has no archive. Please sign in again." });
    return null;
  }
  return id;
}

// ---------------------------------------------------------------- profile

export function issueProfileCookie(res: Response, session: ProfileSession) {
  const ttl = PROFILE_TTL_SECONDS[session.role];
  res.cookie(PROFILE_COOKIE, sign({ ...session, sessionStartedAt: Date.now() }, ttl, "profile"), {
    httpOnly: true,
    sameSite: "strict",
    secure: env.isProduction,
    maxAge: ttl * 1000,
    path: "/",
  });
}

export function readProfile(req: Request): ProfileSession | null {
  return read<ProfileSession>(req, PROFILE_COOKIE, ["personId", "name", "role"]);
}

/**
 * Who is asking (M125) — the read-side twin of `requireRole`'s resolution.
 *
 * A bare `readProfile()` reads one cookie, so a family-session member —
 * whose person lives on the session row, not in this jar — resolved as
 * nobody, and every read seam that chose columns by it served a signed-in
 * admin the anonymous display's view (F39: Contributors all "User", the
 * subject listed, contact columns collapsed). The leak M116 closed had
 * been masking it: the stale profile cookie answered instead.
 *
 * Same precedence as `requireRole`: the person the family session has been
 * elevated to first, else the local profile cookie's claim, else nobody.
 * The answer is still a *claim*, exactly like `readProfile`'s — whoever
 * turns it into authority must let the row decide (`requireRole` does).
 *
 * `family` may be passed when the caller has already read the session, so
 * one request never resolves it twice.
 *
 * An identity for another family says nothing about this archive. When the
 * request already knows whose archive it is answering (`requireDevice` set
 * `req.archiveId` from the installation's own row), a candidate whose
 * archive disagrees is discarded rather than allowed to widen columns for
 * rows it has no standing over — the read-side of the exact check
 * `requireRole` makes before a write. One jar can hold archive A's device
 * and archive B's family session; B's admin is nobody on A's shelf.
 */
export async function actingProfile(
  req: Request,
  family?: Awaited<ReturnType<typeof readFamilySession>>
): Promise<ProfileSession | null> {
  const scope = req.archiveId ?? null;

  const session =
    family !== undefined ? family : await readFamilySession(req.cookies?.[FAMILY_COOKIE]);
  if (session?.personId && session.role && (!scope || session.archiveId === scope)) {
    return {
      personId: session.personId,
      name: "",
      role: session.role as Role,
      archiveId: session.archiveId,
    };
  }

  const profile = readProfile(req);
  if (!profile) return null;
  // Both sides must name an archive for the comparison to mean anything —
  // a token minted before profiles carried theirs is a claim, not a mismatch
  // (same rule as requireRole's device-versus-profile check).
  if (scope && profile.archiveId && profile.archiveId !== scope) return null;

  /*
   * The read-side twin of the reset/logout cutoff (F64).
   *
   * `requireRole` compares a profile token's `iat` to the family cutoff, but
   * this — the read seams' identity — never did. On every machine but one
   * that is moot, because `deviceGuard` already 401s a pre-cutoff device
   * cookie. The exception is the trusted screen, which the exemption keeps
   * alive online AND offline (M29): there the stale profile survived, and
   * `people.ts` would pick `PERSON_ADMIN_COLUMNS` off it — a signed-out
   * admin's email/phone/address, on the display's own machine, against the
   * one invariant written about that machine. So the cutoff applies here
   * too; a failed read fails closed (nobody), which costs an admin their
   * columns during an outage, never a leak.
   */
  const cutoff = await familyCutoff(profile.archiveId ?? scope ?? undefined);
  if (cutoff.readFailed || stalePassword(issuedAt(req, PROFILE_COOKIE), cutoff.at)) return null;

  let personQuery = supabase
    .from("people")
    .select(PROFILE_AUTH_COLUMNS)
    .eq("id", profile.personId);
  const expectedArchive = profile.archiveId ?? scope ?? undefined;
  if (expectedArchive) personQuery = personQuery.eq("archive_id", expectedArchive);
  const { data: person, error } = await personQuery.maybeSingle();
  if (error || !person || person.archived_at || person.status !== "active") return null;
  if (profileSessionRevoked(profileIssuedAt(req), person.profile_sessions_valid_from)) {
    return null;
  }

  return {
    personId: person.id as string,
    name: person.name as string,
    role: person.role as Role,
    archiveId: (person.archive_id as string | null) ?? expectedArchive,
  };
}

/**
 * Ends the sessions held on this machine.
 *
 * The full form closes all three doors — profile, device, and family. The
 * family cookie was added later (M20) and this helper never learned it, so
 * "Sign this screen out of the archive" left a family session standing on a
 * machine whose screen had just promised it would need the access code again
 * (M89). It is cleared through `clearFamilyCookie` rather than a raw
 * `clearCookie`, because a cookie only clears when the attributes match the
 * ones it was set with — a mismatch fails silently, which is the worst way
 * for a sign-out to fail.
 *
 * `{ device: false }` is the profile *switch*: it ends the person and keeps
 * the machine and the family, so the next person needs only their PIN and a
 * remote family session returns to its own chooser. It closes the one door
 * it names.
 */
export function clearSessions(res: Response, { device = true } = {}) {
  res.clearCookie(PROFILE_COOKIE, { path: "/" });
  if (device) {
    res.clearCookie(DEVICE_COOKIE, { path: "/" });
    clearFamilyCookie(res);
  }
}

/**
 * Requires a signed-in profile whose role is allowed. The frontend also hides
 * what a role cannot do, but this is the check that actually decides.
 *
 * The cookie says who someone was when it was issued, which is not the same
 * as who they are now: it is signed for hours, and in that time an admin can
 * be demoted, a contributor deactivated, a person removed. So the role in the
 * token is treated as a claim and the database as the truth — one read per
 * protected request buys immediate revocation.
 *
 * The installation cookie is required too. Management is something people do
 * from a machine the family has trusted; a profile cookie on its own, lifted
 * from somewhere else, should not be enough.
 */
export function requireRole(allowed: Role[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    /*
     * Two ways in, deliberately (docs/specs/identity-model.md).
     *
     * A **family session** is a person signed in from anywhere: opaque
     * cookie, server-side row, revocable the moment somebody says so. It is
     * checked first because it is the one people will actually use.
     *
     * The **device + profile** pair is the household screen — the model this
     * product started with, and still the right one for a machine that sits
     * in a living room and must never be interrupted. Margaret's display
     * runs on it, which is why it stays exactly as it was.
     */
    const family = await readFamilySession(req.cookies?.[FAMILY_COOKIE]);
    if (family?.personId && family.role) {
      if (!allowed.includes(family.role as Role)) {
        return res.status(403).json({ error: "You do not have permission for this action." });
      }
      req.profile = {
        personId: family.personId,
        name: "",
        role: family.role as Role,
        archiveId: family.archiveId,
      };
      // The name is only for activity lines; one read, and only when needed.
      const { data: who } = await supabase
        .from("people")
        .select("name")
        .eq("id", family.personId)
        .eq("archive_id", family.archiveId)
        .maybeSingle();
      if (who) req.profile.name = who.name;
      return next();
    }

    const claim = readProfile(req);
    if (!claim) return res.status(401).json({ error: "Authentication required." });

    const device = readDevice(req);
    if (!device) return res.status(401).json({ error: "This device is not authorised." });
    if (!device.archiveId) {
      clearSessions(res);
      return res.status(401).json({ error: "Please sign in again on this device." });
    }

    // Management never uses the display's offline grace. A revoked, missing,
    // unreachable, or cross-archive installation must stop writes immediately.
    const { data: installation, error: installationError } = await supabase
      .from("installations")
      .select("archive_id, revoked_at")
      .eq("id", device.installationId)
      .eq("archive_id", device.archiveId)
      .maybeSingle();
    if (installationError) {
      console.error("[auth] could not verify management device:", installationError.message);
      return res.status(503).json({ error: "Verification is not possible right now." });
    }
    if (!installation || installation.revoked_at) {
      clearSessions(res);
      return res.status(401).json({ error: "This device is not authorised." });
    }
    const installationArchive = (installation.archive_id as string | null) ?? undefined;
    if (device.archiveId && installationArchive && device.archiveId !== installationArchive) {
      clearSessions(res);
      return res.status(401).json({ error: "This device is not authorised." });
    }

    let personQuery = supabase
      .from("people")
      .select(PROFILE_AUTH_COLUMNS)
      .eq("id", claim.personId);
    if (installationArchive) personQuery = personQuery.eq("archive_id", installationArchive);
    const { data, error } = await personQuery.maybeSingle();

    // Management fails closed when the database cannot be reached. Margaret's
    // display does not come through here, so her screen is unaffected.
    if (error) {
      console.error("[auth] could not verify session:", error.message);
      return res.status(503).json({ error: "Verification is not possible right now." });
    }

    if (!data || data.archived_at) {
      clearSessions(res, { device: false });
      return res.status(401).json({ error: "Your session has expired." });
    }
    /*
      Both ends of the access axis close the door (043).

      `deactivated` is a decision an admin can undo next week. `remembered`
      is a fact about a person who has died. They mean entirely different
      things to a family and are shown differently, but they agree on this:
      neither may hold a session. Adding the new state without adding it here
      would have created a status that *looks* like it withdraws access and
      silently does not — the worst kind of new feature.

      The refusal is worded per state, because a family member who sees "this
      profile is deactivated" over their mother's name would be hurt by the
      product for no reason.
    */
    if (data.status === "deactivated" || data.status === "remembered") {
      clearSessions(res, { device: false });
      return res.status(403).json({
        error:
          data.status === "remembered"
            ? "This profile is kept as a memory and cannot be signed in to."
            : "This profile is deactivated.",
      });
    }
    if (profileSessionRevoked(profileIssuedAt(req), data.profile_sessions_valid_from)) {
      clearSessions(res, { device: false });
      return res.status(401).json({ error: "Your session has expired." });
    }
    if (!allowed.includes(data.role as Role)) {
      return res.status(403).json({ error: "You do not have permission for this action." });
    }

    // The archive comes from the person's own row, so a token cannot claim a
    // family it does not belong to. A profile and an installation that
    // disagree are not a session at all.
    const archiveId = (data.archive_id as string | null) ?? undefined;
    if (installationArchive && archiveId && installationArchive !== archiveId) {
      return res.status(403).json({ error: "This device belongs to another archive." });
    }

    /*
     * A management session from before a password reset stops here (M159).
     *
     * This branch is the profile tier — an admin or co-author working from a
     * device+profile pair. The reset's promise is that these sessions end;
     * re-reading the row catches a *removed* person, but a person still on
     * the roster kept their JWT for its full life. Comparing the token's
     * `iat` to the family cutoff closes that: a departed admin's management
     * session is refused now, and they re-enter their PIN if they return.
     * Her display never comes through here, so her screen is untouched.
     *
     * A failed cutoff read fails closed with the same 503 this guard already
     * gives a failed person-read (M162/F57): management must not degrade to
     * "allow" during an outage, and there is no trusted-screen to spare here.
     */
    const cutoff = await familyCutoff(archiveId);
    if (cutoff.readFailed) {
      return res.status(503).json({ error: "Verification is not possible right now." });
    }
    if (stalePassword(issuedAt(req, PROFILE_COOKIE), cutoff.at)) {
      clearSessions(res, { device: false });
      return res.status(401).json({ error: "Your session has expired." });
    }

    req.device = device;
    req.profile = { personId: data.id, name: data.name as string, role: data.role as Role, archiveId };
    req.archiveId = archiveId ?? installationArchive;
    next();
  };
}

// -------------------------------------------------------- the platform owner

/**
 * Whoever runs Recall itself — not a family owner (M55).
 *
 * The two are deliberately different words for deliberately different powers.
 * A **family owner** administers one archive and can read every memory in it.
 * The **platform owner** sees information about every family — counts, dates,
 * sizes, whether anyone is using it — and by rule reaches none of their
 * content. This guard is what makes that boundary real, and it is the only
 * place in the codebase where a caller is allowed to look across families.
 *
 * Two properties matter more than the check itself:
 *
 * **The database is the truth, on every request.** Same discipline as
 * `requireRole`: the session says who somebody is, and the `families` row
 * says what they are. A flag revoked in SQL takes effect on the next call
 * rather than whenever a cookie happens to expire.
 *
 * **Every refusal is the same 404.** Not 401, not 403 — the same body a
 * missing route gives. A 403 would confirm that `/api/owner` exists and is
 * worth attacking; 404 says only that there is nothing here, which is what a
 * family admin who wandered in should conclude, and what an attacker
 * enumerating paths should learn nothing from. A database outage answers 404
 * too: "I could not confirm you are the platform owner" and "you are not"
 * lead to the same place, and the failure mode of guessing is worse.
 */
export function requirePlatformOwner() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const nothingHere = () => res.status(404).json({ error: "Not found." });

    /*
     * Resolved by family id where there is one, because the platform owner's
     * row owns no archive — it is not a household. Looking them up by
     * archive, as an earlier draft did, would have made the one row this
     * guard exists for the one row it could never find.
     */
    const family = await readFamilySession(req.cookies?.[FAMILY_COOKIE]);
    if (!family?.familyId) return nothingHere();

    const query = supabase.from("families").select("id, platform_owner");
    const { data, error } = await query.eq("id", family.familyId).maybeSingle();

    if (error) {
      console.error("[auth] could not verify the platform owner:", error.message);
      return nothingHere();
    }
    if (!data || data.platform_owner !== true) return nothingHere();

    req.platformOwner = true;
    next();
  };
}
