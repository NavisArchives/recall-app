import { Router } from "express";
import rateLimit from "express-rate-limit";
import { supabase } from "../config/supabase.js";
import {
  clearSessions,
  issueDeviceCookie,
  issueProfileCookie,
  readDevice,
  readProfile,
  actingProfile,
  requireArchive,
  requireDevice,
  type Role,
} from "../middleware/auth.js";
import { normaliseSecret, verifySecret, LANDING_PATH } from "../services/accessCodes.js";
import {
  checkPin,
  clearPinFailures,
  isLocked,
  isValidPinFormat,
  recordPinFailure,
} from "../services/pins.js";
import { env } from "../config/env.js";
import {
  DUMMY_PASSWORD_HASH,
  readFamilySession,
  revokeSession,
  revokeSessionByToken,
  demoteSession,
  clearFamilyCookie,
  FAMILY_COOKIE,
} from "../services/familyAuth.js";
import { fail } from "../lib/errors.js";
import { exactIlike } from "../lib/exactIlike.js";

export const authRouter = Router();

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again later." },
});

// ---------------------------------------------------------------- level 1

/** Signs the machine in. Long-lived, so the display is never interrupted. */
authRouter.post("/installation/sign-in", strictLimiter, async (req, res) => {
  const { username, secret } = req.body ?? {};
  const normalised = normaliseSecret(secret);

  // One message for every failure, so the endpoint never reveals which half
  // was wrong or which installations exist.
  const reject = () => res.status(401).json({ error: "Invalid credentials." });
  if (typeof username !== "string" || !username.trim() || !normalised) return reject();

  /*
   * Still mounted, on purpose: the operator scripts (setup.mjs,
   * scratch-family.mjs, the seed families) mint installation codes this door
   * accepts. So it gets the discipline of the family doors instead.
   *
   * The username is matched exactly, ignoring case — raw, `_` and `%` were
   * wildcards and one pattern could stand for any installation (authn-2). A
   * `*` cannot be matched exactly, so it matches nothing.
   */
  const pattern = exactIlike(username.trim());
  type InstallationRow = { id: string; secret_hash: string; revoked_at: string | null; archive_id: string | null };
  let data: InstallationRow | null = null;
  if (pattern) {
    const { data: row, error } = await supabase
      .from("installations")
      .select("id, secret_hash, revoked_at, archive_id")
      .ilike("username", pattern)
      .maybeSingle();
    if (error) return fail(res, 500, "Could not sign in.", error);
    data = row as InstallationRow | null;
  }

  /*
   * The work is comparable whether or not the username exists (SKEPTIC
   * authn). Returning at once for a missing or revoked row made "no such
   * installation" measurably faster than "wrong code", and the operator
   * scripts choose readable usernames — so the timing answered which ones
   * exist. The dummy hash runs the full computation and matches nothing.
   */
  const usable = data && !data.revoked_at ? data : null;
  const ok = await verifySecret(usable?.secret_hash ?? DUMMY_PASSWORD_HASH, normalised);
  if (!usable || !ok) return reject();

  await supabase
    .from("installations")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", usable.id);

  /*
   * A machine signing in as an installation is re-deciding what this browser
   * is, so keys from its previous life go (M116/F33, this door). A remote
   * family session left beside a fresh device cookie answers `requireRole`
   * while the device answers `requireDevice` — one jar, two archives, half
   * a page each. Revoked server-side, then cleared.
   */
  const staleToken = req.cookies?.[FAMILY_COOKIE];
  if (staleToken) {
    // By token, not by resolving first: a key is evicted for being
    // presented at this door, not for still being believable.
    await revokeSessionByToken(staleToken);
    clearFamilyCookie(res);
  }
  clearSessions(res, { device: false });

  // The archive travels with the machine, so every later request knows whose
  // home it is answering without asking the database again.
  issueDeviceCookie(res, {
    installationId: usable.id,
    archiveId: usable.archive_id ?? undefined,
  });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- level 2

/**
 * The profile chooser. Requires a trusted device but no profile yet, and
 * returns only what a chooser needs to draw a card — never a PIN hash, an
 * email or a phone number.
 */
authRouter.get("/profiles", requireDevice, async (req, res) => {
  // The chooser draws the faces of *this* household. Without the archive it
  // drew every household on the server — every name and relationship in the
  // database, handed to any machine that could reach the port.
  const archive = requireArchive(req, res);
  if (!archive) return;

  const { data, error } = await supabase
    .from("people")
    .select("id, name, relationship, role, status, profile_picture_path, pin_hash, locked_until")
    .eq("archive_id", archive)
    .is("archived_at", null)
    .neq("status", "deactivated")
    .order("name");

  if (error) return fail(res, 500, "The profiles could not be loaded.", error);

  /*
   * Her face lives in one place (M42).
   *
   * The subject's whole world is one screen in one room; everyone else's is
   * anywhere. So her profile appears only on the family's trusted device —
   * and not greyed or disabled elsewhere, simply absent, because a face you
   * cannot open is an invitation to try.
   */
  const trusted = req.device?.isTrusted === true;
  const visible = trusted ? (data ?? []) : (data ?? []).filter((p) => p.role !== "user");

  const profiles = visible.map((p) => ({
      id: p.id,
      name: p.name,
      relationship: p.relationship,
      role: p.role as Role,
      // Whether a PIN is needed, never the PIN itself. Only the subject ever
      // opens without one (access-3): a co-author or admin with no PIN yet
      // is not PIN-free, it is unclaimed, and unlock refuses it — so it must
      // not look like the face the display falls back to.
      requires_pin: p.role !== "user" || !!p.pin_hash,
      locked: isLocked(p.locked_until),
      /*
       * The backend media URL, not a signed Supabase one (M165/F60).
       *
       * `signUrl` handed the living-room browser a bearer URL into private
       * storage that reads Supabase for a full hour — it outlived every
       * revocation (screen sign-out, password reset, sign-out-everywhere)
       * on the one route that serves the subject's own face, pre-PIN. The
       * backend URL is the same one the remote chooser returns (family.ts):
       * it does not expire, the private path stays on the server, and
       * `/media/person/:id/photo` is reachable by this device session and
       * archive-scoped (M152), so it hands out nothing the session could
       * not already fetch — through our guards, revocable.
       */
      photo_url: p.profile_picture_path
        ? `${env.publicUrl}/api/media/person/${p.id}/photo`
        : null,
    }));

  res.json(profiles);
});

/** Unlocks a profile. A profile with no PIN opens straight away. */
authRouter.post("/profiles/:id/unlock", strictLimiter, requireDevice, async (req, res) => {
  const { pin } = req.body ?? {};

  // Scoped to the device's archive, so a person from another family is simply
  // not found. Answering "wrong code" instead would confirm they exist — and
  // the failed attempt below would advance *their* lockout, which is a way to
  // bar a stranger's household from its own screen.
  const archive = requireArchive(req, res);
  if (!archive) return;

  const { data: person, error } = await supabase
    .from("people")
    .select("id, name, role, status, archive_id, pin_hash, failed_pin_attempts, locked_until")
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .is("archived_at", null)
    .maybeSingle();

  if (error) return fail(res, 500, "Could not sign in.", error);
  if (!person || person.status !== "active") {
    return res.status(404).json({ error: "Profile not found." });
  }

  /*
   * The rule, not merely its appearance (M42).
   *
   * Hiding the subject's face on other devices is presentation; this is the
   * part that holds. Her profile opens on the family's trusted screen and
   * nowhere else — so somebody who knows her PIN and reaches this endpoint
   * from a phone gets the same answer as somebody asking after a person who
   * does not exist, which is also the honest one: on this device, she does
   * not.
   */
  if (person.role === "user" && req.device?.isTrusted !== true) {
    return res.status(404).json({ error: "Profile not found." });
  }

  /*
   * Only the subject opens without a PIN (access-3).
   *
   * "A profile with no PIN opens straight away" was written for her: her
   * screen greets her, and she never types a code. But a person created as
   * `user` and later promoted keeps a null `pin_hash`, and this door then
   * opened a co-author or an admin with no PIN at all, on any paired
   * device. Anyone else without a PIN gets the chooser's own answer for a
   * profile nobody has claimed yet.
   */
  if (person.role !== "user" && !person.pin_hash) {
    return res.status(403).json({ error: "This profile has not been claimed yet." });
  }

  if (isLocked(person.locked_until)) {
    return res.status(429).json({ error: "This profile is temporarily locked. Try again later." });
  }

  let legacyPin: { pin: string } | null = null;
  if (person.pin_hash) {
    const check = isValidPinFormat(pin)
      ? await checkPin(person.pin_hash, pin)
      : { ok: false, legacy: false };
    if (!check.ok) {
      // One database move (037): the increment and the lockout decision are
      // a single UPDATE, so simultaneous wrong guesses each cost an attempt
      // instead of overwriting each other's count — and since 064 each
      // consecutive lock doubles the next. A guess that could not be counted
      // fails closed — free guesses are what the counter prevents.
      const counted = await recordPinFailure(person, archive);
      if (!counted) {
        return fail(res, 503, "Verification is not possible right now.", { person: person.id });
      }

      return res.status(401).json({
        error: counted.locked
          ? "Too many attempts. This profile is locked for a while — try again later."
          : "Incorrect code.",
      });
    }
    if (check.legacy) legacyPin = { pin: pin as string };
  }

  const now = new Date().toISOString();
  await clearPinFailures(person.id, archive, legacyPin, { status: "active", last_seen_at: now });

  const role = person.role as Role;
  issueProfileCookie(res, {
    personId: person.id,
    name: person.name,
    role,
    archiveId: (person.archive_id as string | null) ?? undefined,
  });

  res.json({ id: person.id, name: person.name, role, redirect_to: LANDING_PATH[role] });
});

// ---------------------------------------------------------------- state

/**
 * Who the browser is, as far as the frontend needs to know.
 *
 * Three ways of being somebody here, and this used to report only two. A
 * **family session** — signed in from anywhere with the family password — was
 * invisible: the backend accepted it on every protected route (M40) and the
 * browser had no way to discover it existed. So `AuthGuard` saw no device,
 * sent the person to sign in, and they signed in again into the same
 * invisibility. That is why no sign-in page was ever built: there was nothing
 * a page could have done with the result.
 *
 * `family` is deliberately its own field rather than folded into `device`.
 * They are different powers: a device is a machine the family trusts and can
 * show the subject's own profile; a family session is a person somewhere else
 * and never can.
 */
authRouter.get("/session", async (req, res) => {
  const device = readDevice(req);
  const family = await readFamilySession(req.cookies?.[FAMILY_COOKIE]);

  /*
   * Which claim names a person — and then, whether that person still exists.
   *
   * A family session that has reached a profile carries the person on it; one
   * that has only cleared the password does not, and that difference is
   * exactly the chooser step. Either way it is a *claim*.
   *
   * This endpoint used to echo the claim. The profile cookie's name and role
   * went straight out with no read at all, and the family-stamp path read the
   * row but fell back to `name: ""` — so a deleted person came back as a
   * nameless somebody rather than as nobody (M95). Nothing was reachable —
   * `requireRole` re-reads the row and fails closed — but the screen greeted
   * a person the archive no longer had.
   *
   * So `/session` applies the same test the protected routes do: the cookie
   * is a claim, the database is the truth. One read, the same shape
   * `requireRole` makes, and the answer decides whether there is anybody to
   * report.
   */
  /*
   * Resolved through the shared helper (M125), so this endpoint names the
   * same person `requireRole` would obey — the elevated family session
   * first, else the local profile cookie. The two used to disagree on a
   * jar holding both, and the header greeted one person while the routes
   * acted as another.
   */
  const acting = await actingProfile(req, family);
  const claim = acting
    ? {
        personId: acting.personId,
        archiveId: acting.archiveId ?? family?.archiveId,
        role: acting.role,
      }
    : null;
  const claimIsProfileCookie = !!readProfile(req) && !(family?.personId && family.role);

  let person: { personId: string; name: string; role: Role; theme: string } | null = null;

  if (!claim && claimIsProfileCookie) {
    clearSessions(res, { device: false });
  }

  if (claim) {
    let query = supabase
      .from("people")
      // `workspace_theme` (058) rides along so the workspace paints the
      // colour this person chose on its first render, without a second
      // round trip. Her display never calls this endpoint for a profile.
      .select("name, role, status, archived_at, workspace_theme")
      .eq("id", claim.personId);
    // A cookie minted before profiles carried their archive names none; it is
    // still checked for existence, just not for belonging.
    if (claim.archiveId) query = query.eq("archive_id", claim.archiveId);

    const { data: who } = await query.maybeSingle();

    if (who && !who.archived_at && who.status !== "deactivated") {
      // The role comes off the row too — a token signed hours ago may name a
      // person since demoted, and the row is what the rest of the app obeys.
      person = {
        personId: claim.personId,
        name: who.name as string,
        role: ((who.role as Role) ?? claim.role) as Role,
        theme: (who.workspace_theme as string | null) ?? "dark",
      };
    } else if (claimIsProfileCookie) {
      /*
       * Retire the dead claim rather than carry it into the next request.
       * M77's error-redirect already clears it on the first failed protected
       * call; doing it here means the browser stops presenting it at once.
       * Only the profile cookie, and only when it was the claim that just
       * failed — a dead family-elevated person is the session row's problem,
       * and clearing this jar's profile cookie would answer the wrong door.
       */
      clearSessions(res, { device: false });
    }
  }

  res.json({
    device: !!device,
    family: !!family,
    profile: person
      ? { id: person.personId, name: person.name, role: person.role, workspace_theme: person.theme }
      : null,
  });
});

/**
 * Leaves the machine trusted so the next person only needs their PIN.
 *
 * On the family's screen that is the whole story — the profile cookie is who
 * you are, and dropping it is the switch. A remote family session carries its
 * person on the session row instead, so clearing the cookie there left the
 * server still naming whoever just stepped away (M90). It is stepped back to
 * its chooser state: family still signed in, nobody chosen.
 */
authRouter.post("/profiles/sign-out", async (req, res) => {
  const family = await readFamilySession(req.cookies?.[FAMILY_COOKIE]);
  if (family?.personId && !(await demoteSession(res, family))) {
    clearSessions(res);
    return res.status(503).json({ error: "Sign-out could not be completed. Please try again." });
  }
  const profile = !family?.personId ? readProfile(req) : null;
  if (profile) {
    let revoke = supabase
      .from("people")
      .update({ profile_sessions_valid_from: new Date().toISOString() })
      .eq("id", profile.personId);
    if (profile.archiveId) revoke = revoke.eq("archive_id", profile.archiveId);
    const { error } = await revoke;
    if (error) {
      console.error("[auth] could not revoke profile session during sign-out:", error.message);
      clearSessions(res, { device: false });
      return res.status(503).json({ error: "Sign-out could not be completed. Please try again." });
    }
  }
  clearSessions(res, { device: false });
  res.json({ ok: true });
});

/**
 * Signs the whole installation out; the next use needs level 1 again.
 *
 * The family session is opaque and lives server-side, so clearing its cookie
 * only makes *this* browser forget it — the row stays usable to anyone
 * holding the value. A screen that has just promised to need the access code
 * again should not leave a live session behind it, so this revokes the row as
 * well, exactly as `/family/logout` does. Cookie-clearing is `clearSessions`'
 * job; the revocation needs a database round trip and belongs here.
 */
authRouter.post("/sign-out", async (req, res) => {
  const family = await readFamilySession(req.cookies?.[FAMILY_COOKIE]);
  let revoked = family ? await revokeSession(family.id) : true;

  /*
   * The machine's own row closes too (M111, in M89's spirit).
   *
   * "Sign this screen out of the archive" used to leave the installation row
   * standing, because the access code could always open it again. That door
   * retired with M111: the way back is now the family password electing a
   * screen — and the one-trusted-per-family index would count this row and
   * refuse forever. So a deliberate sign-out relinquishes the slot: the row
   * is revoked (a stolen copy of the old cookie dies with it) and untrusted
   * (the family can pair a screen again with no ceremony). The email
   * ceremony remains the answer for a device that was *lost* — a machine
   * nobody can sign out of.
   */
  const device = readDevice(req);
  if (device) {
    let unTrust = supabase
      .from("installations")
      .update({ is_trusted: false, revoked_at: new Date().toISOString() })
      .eq("id", device.installationId);
    // Scoped when the cookie names its archive; the id alone is already a
    // signed claim, but a query that can say which family it means, says so.
    if (device.archiveId) unTrust = unTrust.eq("archive_id", device.archiveId);
    const { error } = await unTrust;
    if (error) {
      console.error("[auth] could not revoke installation during sign-out:", error.message);
      revoked = false;
    }
  }

  clearSessions(res);
  if (!revoked) {
    return res.status(503).json({ error: "Sign-out could not be completed. Please try again." });
  }
  res.json({ ok: true });
});
