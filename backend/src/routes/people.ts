import { Router } from "express";
import { supabase } from "../config/supabase.js";
import { readUpload, upload, uploadGate } from "../middleware/upload.js";
import { requireRole, actingProfile, requireDevice, requireArchive } from "../middleware/auth.js";
import { CAN_MANAGE_PEOPLE, CAN_DELETE, ROLES,
  CAN_OPEN_ADMIN,
} from "../services/accessCodes.js";
import {
  PERSON_COLUMNS,
  PERSON_MEMBER_COLUMNS,
  PERSON_SELF_COLUMNS,
  PERSON_ADMIN_COLUMNS,
  toPublicPerson,
  toPublicPeople,
} from "../services/dto.js";
import {
  PROFILE_PICTURES_BUCKET,
  buildStoragePath,
  removeFromBucket,
  uploadToBucket,
  verifyFile,
} from "../services/media.js";
import { generatePin, hashPin } from "../services/pins.js";
import { sendWelcomeEmail, sendPinResetEmail, sendTestEmail } from "../services/email.js";
import { fail } from "../lib/errors.js";
import { logActivity, actorName } from "../services/activityLog.js";

export const peopleRouter = Router();

// Contact details are only selected for someone who can manage people; the
// display never receives an email or phone number.
// Public: the Social page lists family for Margaret. Contact details and
// account state are only added for someone who can manage people.
peopleRouter.get("/", requireDevice, async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;
  // Family-session members are people, not the display (M125/F39).
  const profile = await actingProfile(req);
  const canManage = !!profile && CAN_MANAGE_PEOPLE.includes(profile.role);
  /*
    …and the subject's own profile is the display, not a member (access-8).
    Her screen carries her `user` profile from pairing on, so reading
    "somebody is acting" as "a member is asking" served the television the
    member columns. It is served what the display is served.
  */
  const isDisplay = !profile || profile.role === "user";
  const columns = canManage
    ? PERSON_ADMIN_COLUMNS
    : isDisplay
      ? PERSON_COLUMNS
      : PERSON_MEMBER_COLUMNS;

  let query = supabase
    .from("people")
    .select(columns)
    .eq("archive_id", archive)
    .is("archived_at", null);

  /*
    The display is served a list that is already correct (M210).

    No acting profile means this is her screen asking, and her screen was
    being handed everybody: `PERSON_COLUMNS` carries neither `role` nor
    `show_on_display`, so the two guards in `Social.tsx` compared `undefined`
    against "user" and `false` and both passed everything. The subject
    appeared in her own "people in your life" list, and a face a family had
    deliberately switched off still appeared on the television.

    The fix stays on this side of the wire rather than widening the payload.
    Filtering data and displaying data are different permissions: the display
    needs these two facts to *exclude* people, not to *show* anything, and
    shipping every person's role to a kiosk in order to identify one of them
    is a poor trade. So the browser receives no new field, and cannot render
    what it never receives.

    Both operands are safe to assert positively because neither column can be
    null: `role` is `not null` (010) and `show_on_display` is `not null
    default true` (043). That matters here — a null in either would make these
    filters drop a row, and a face disappearing from her wall is the worse
    failure of the two this mission weighs.

    A family session (profile present) is a person on their own phone, not the
    television. They keep the full list and the member columns, and the client
    filter stays their belt.
  */
  if (isDisplay) {
    query = query.neq("role", "user").eq("show_on_display", true);
  }

  const { data, error } = await query.order("name");

  if (error) return fail(res, 500, "The contributors could not be loaded.", error);
  res.json(await toPublicPeople(data as unknown as Record<string, unknown>[]));
});

peopleRouter.get("/:id", requireDevice, async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;
  // Family-session members are people, not the display (M125/F39).
  const profile = await actingProfile(req);
  const canManage = !!profile && CAN_MANAGE_PEOPLE.includes(profile.role);
  // Her screen, with or without her own profile on it, is the display
  // (access-8) — including when it asks about her: the self columns carry an
  // email and a phone number, and the display never receives either.
  const isDisplay = !profile || profile.role === "user";
  // Reading yourself is not reading somebody else: My Info has to be able to
  // show you the phone number and address you entered.
  const isSelf = !isDisplay && profile.personId === req.params.id;
  const columns = canManage
    ? PERSON_ADMIN_COLUMNS
    : isSelf
      ? PERSON_SELF_COLUMNS
      : isDisplay
        ? PERSON_COLUMNS
        : PERSON_MEMBER_COLUMNS;

  const { data, error } = await supabase
    .from("people")
    .select(columns)
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .is("archived_at", null)
    .maybeSingle();

  if (error) return fail(res, 500, "This person could not be loaded.", error);
  if (!data) return res.status(404).json({ error: "Person not found." });

  res.json(await toPublicPerson(data as unknown as Record<string, unknown>));
});

peopleRouter.post(
  "/",
  requireRole(CAN_MANAGE_PEOPLE),
  uploadGate,
  upload.single("profile_picture"),
  async (req, res) => {
    const archive = requireArchive(req, res);
    if (!archive) return;
    const { name, relationship, email, contact_number, description, birthday, role } = req.body;

    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "The name is required." });
    }
    // An admin cannot be created from the form; that is set deliberately.
    if (role !== undefined && role !== "co_author" && role !== "user") {
      return res.status(400).json({ error: "Invalid role." });
    }

    // The person the archive is about never needs a PIN: the app exists
    // because she cannot reliably recall things.
    const pin = (role || "co_author") === "user" ? null : generatePin();

    let profile_picture_path: string | null = null;

    if (req.file) {
      const verified = await verifyFile(await readUpload(req.file), "image");
      if (!verified) {
        return res.status(400).json({ error: "Invalid image or unsupported format." });
      }

      profile_picture_path = buildStoragePath("people", verified.extension);
      try {
        await uploadToBucket(PROFILE_PICTURES_BUCKET, profile_picture_path, verified);
      } catch (err) {
        return fail(res, 500, "The photo could not be uploaded.", err);
      }
    }

    const { data, error } = await supabase
      .from("people")
      .insert({
        name: name.trim(),
        relationship: relationship || null,
        email: email || null,
        contact_number: contact_number || null,
        description: description || null,
        birthday: birthday || null,
        role: role || "co_author",
        // A user profile opens without a PIN; everyone else gets one.
        pin_hash: pin ? await hashPin(pin) : null,
        pin_set_at: pin ? new Date().toISOString() : null,
        profile_picture_path,
        archive_id: archive,
      })
      .select(PERSON_ADMIN_COLUMNS)
      .single();

    if (error) {
      if (profile_picture_path) {
        await removeFromBucket(PROFILE_PICTURES_BUCKET, [profile_picture_path]).catch(() => {});
      }
      return fail(res, 500, "The person could not be created.", error);
    }

    // Email is a courtesy: the PIN is returned either way, so a mail outage
    // never leaves an admin unable to pass the code on.
    const emailed = pin
      ? await sendWelcomeEmail({ name: name.trim(), email: email || null }, pin)
      : { success: false, reason: "This profile opens without a PIN." };

    logActivity(
      req.profile,
      "contributor_added",
      `${actorName(req.profile)} added ${name.trim()} as a contributor`
    );

    // The only time the PIN is ever returned; it is hashed and unrecoverable.
    res.status(201).json({
      ...(await toPublicPerson(data as unknown as Record<string, unknown>)),
      pin,
      emailed,
    });
  }
);

/**
 * Edits a person's own details. An admin may edit anyone; everyone else only
 * themselves — attribution and roles stay under the stricter routes below.
 */
peopleRouter.patch(
  "/:id",
  requireRole(["admin", "co_author"]),
  uploadGate,
  upload.single("profile_picture"),
  async (req, res) => {
    if (req.profile!.role !== "admin" && req.params.id !== req.profile!.personId) {
      return res.status(403).json({ error: "You can only edit your own profile." });
    }

    const archive = requireArchive(req, res);
    if (!archive) return;

    const { name, relationship, email, contact_number, description, birthday, address } =
      req.body;

    /*
      What the answer carries is chosen by who asked (access-4). This read
      back PERSON_ADMIN_COLUMNS for everyone the route lets in, so a co-author
      saving their own details was handed the note the admins keep about
      them, their last-seen time and their lockout — the admin's view of
      them, which the GET beside this never gives a non-admin. Only an admin
      reads the admin set; anyone else is editing themselves (the guard above)
      and reads what My Info reads.
    */
    const columns =
      req.profile!.role === "admin" ? PERSON_ADMIN_COLUMNS : PERSON_SELF_COLUMNS;

    if (name !== undefined && (typeof name !== "string" || !name.trim())) {
      return res.status(400).json({ error: "Name cannot be empty." });
    }

    let profile_picture_path: string | undefined;

    if (req.file) {
      const verified = await verifyFile(await readUpload(req.file), "image");
      if (!verified) {
        return res.status(400).json({ error: "That image format is not supported." });
      }
      profile_picture_path = buildStoragePath("people", verified.extension);
      try {
        await uploadToBucket(PROFILE_PICTURES_BUCKET, profile_picture_path, verified);
      } catch (err) {
        return fail(res, 500, "The photo could not be uploaded.", err);
      }
    }

    const { data, error } = await supabase
      .from("people")
      .update({
        ...(name !== undefined && { name: name.trim() }),
        ...(relationship !== undefined && { relationship: relationship || null }),
        ...(email !== undefined && { email: email || null }),
        ...(contact_number !== undefined && { contact_number: contact_number || null }),
        ...(description !== undefined && { description: description || null }),
        ...(birthday !== undefined && { birthday: birthday || null }),
        // Where they live — asked for on My Info, and the column has existed
        // since 012; the route simply never accepted it.
        ...(address !== undefined && { address: address || null }),
        ...(profile_picture_path && { profile_picture_path }),
        updated_at: new Date().toISOString(),
      })
      .eq("id", req.params.id)
      .eq("archive_id", archive)
      .is("archived_at", null)
      .select(columns)
      .maybeSingle();

    if (error) return fail(res, 500, "The changes could not be saved.", error);
    if (!data) return res.status(404).json({ error: "Person not found." });

    logActivity(
      req.profile,
      "contributor_edited",
      `${actorName(req.profile)} updated ${(data as unknown as { name?: string }).name ?? "a contributor"}'s profile`
    );
    res.json(await toPublicPerson(data as unknown as Record<string, unknown>));
  }
);

/**
 * Would this leave the family with nobody who can administer it?
 *
 * The self-guards below stop the obvious version — you cannot change your own
 * role, pause yourself, or mark yourself remembered. They do not cover the
 * delete route, which archives whatever row it is handed without asking whose
 * it is, so the only admin can archive themselves. That mistake cannot be
 * undone from inside the product: every route that could appoint a new admin
 * requires an admin to call it, so the family is left with an archive they can
 * still see and can no longer manage.
 *
 * Written as a backstop rather than a list of cases. It counts the admins who
 * could actually sign in — an admin who is paused or remembered is not one —
 * and refuses when the target is the last of them. If the count cannot be
 * read at all it refuses too: not knowing is not permission.
 */
async function wouldLeaveNoAdmin(archive: string, personId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("people")
    .select("id, role, status")
    .eq("archive_id", archive)
    .eq("role", "admin")
    .is("archived_at", null);

  if (error || !data) return true;

  const able = (data as { id: string; role: string; status: string }[]).filter(
    (p) => p.role === "admin" && p.status === "active"
  );
  return able.length <= 1 && able.some((p) => p.id === personId);
}

const NO_ADMIN_LEFT =
  "This is the only admin. Make someone else an admin first.";

/**
 * Changes someone's level. Their existing codes keep working at the new level.
 *
 * A person who has no code yet gets one here (access-3). A `user` profile
 * opens without a PIN — it exists so a face is on her screen — and promoting
 * one used to change only the role, which left a co-author or an admin that
 * any paired device could open without a PIN at all. So the promotion mints
 * one and returns it exactly once, the way reset-pin does; the page shows it
 * to the admin, and the email is a courtesy on top.
 */
peopleRouter.patch("/:id/role", requireRole(CAN_MANAGE_PEOPLE), async (req, res) => {
  const { role } = req.body;

  if (!ROLES.includes(role)) {
    return res.status(400).json({ error: "Invalid role." });
  }
  if (req.params.id === req.profile!.personId) {
    return res.status(400).json({ error: "You cannot change your own role." });
  }

  const archive = requireArchive(req, res);
  if (!archive) return;

  if (role !== "admin" && (await wouldLeaveNoAdmin(archive, req.params.id as string))) {
    return res.status(400).json({ error: NO_ADMIN_LEFT });
  }

  // Whether they already hold a code. Only the fact is kept; the hash never
  // leaves this handler.
  const { data: current, error: readError } = await supabase
    .from("people")
    .select("id, pin_hash")
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .is("archived_at", null)
    .maybeSingle();

  if (readError) return fail(res, 500, "The role could not be changed.", readError);
  if (!current) return res.status(404).json({ error: "Person not found." });

  const pin = role !== "user" && !current.pin_hash ? generatePin() : null;

  const { data, error } = await supabase
    .from("people")
    .update({
      role,
      ...(pin && {
        pin_hash: await hashPin(pin),
        pin_set_at: new Date().toISOString(),
        failed_pin_attempts: 0,
        locked_until: null,
        pin_lock_count: 0,
      }),
      updated_at: new Date().toISOString(),
    })
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .is("archived_at", null)
    .select(PERSON_ADMIN_COLUMNS)
    .maybeSingle();

  if (error) return fail(res, 500, "The role could not be changed.", error);
  if (!data) return res.status(404).json({ error: "Person not found." });

  const person = await toPublicPerson(data as unknown as Record<string, unknown>);
  if (!pin) return res.json(person);

  const emailed = await sendWelcomeEmail(
    {
      name: (data as unknown as { name: string }).name,
      email: (data as unknown as { email: string | null }).email ?? null,
    },
    pin
  );
  // The only time this PIN is ever returned; it is hashed and unrecoverable.
  res.json({ ...person, pin, emailed });
});

/** Blocks sign-in without touching their memories or their codes. */
peopleRouter.patch("/:id/status", requireRole(CAN_MANAGE_PEOPLE), async (req, res) => {
  const { status } = req.body;

  /*
    The access axis (043). `remembered` joins the two it had — a contributor
    who has died — and it withdraws sign-in exactly as `deactivated` does
    (`middleware/auth.ts`). `pending` is not settable here: it is what an
    invitation leaves behind, and an admin cannot un-join somebody.
  */
  if (status !== "active" && status !== "deactivated" && status !== "remembered") {
    return res.status(400).json({ error: "Invalid status." });
  }
  if (req.params.id === req.profile!.personId) {
    /*
      One guard, two truths. It already refused self-deactivation; it now
      also refuses marking yourself remembered, which is not a hypothetical
      to be tidy about — it is the misclick that locks an admin out of their
      own family's archive with no way back in.
    */
    return res.status(400).json({
      error:
        status === "remembered"
          ? "You cannot mark yourself as remembered."
          : "You cannot deactivate yourself.",
    });
  }

  const archive = requireArchive(req, res);
  if (!archive) return;

  if (status !== "active" && (await wouldLeaveNoAdmin(archive, req.params.id as string))) {
    return res.status(400).json({ error: NO_ADMIN_LEFT });
  }

  const { data, error } = await supabase
    .from("people")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .is("archived_at", null)
    .select(PERSON_ADMIN_COLUMNS)
    .maybeSingle();

  if (error) return fail(res, 500, "The status could not be changed.", error);
  if (!data) return res.status(404).json({ error: "Person not found." });

  res.json(await toPublicPerson(data as unknown as Record<string, unknown>));
});

/**
 * The visibility axis (043) — does her screen show this face.
 *
 * A separate route from `/status` on purpose. They were one control for most
 * of this product's life, which meant an admin who wanted a face off the
 * display had to take away that person's sign-in to manage it. Two verbs, two
 * endpoints; a UI that wants to change both makes two calls and says so.
 *
 * No self-guard here, unlike status: hiding your own face from her screen
 * costs you nothing you cannot undo in one press, and there are real reasons
 * to do it — a helper who is not family, a carer who would rather not appear.
 */
/**
 * The colour a person works in (058, owner 17 Sep 2026).
 *
 * `requireRole(CAN_OPEN_ADMIN)` — anyone who can open the workspace, admin or
 * co-author — and then the row must be *their own*: the id in the path is
 * compared to the person the session resolved to, so nobody can repaint a
 * colleague's workspace. That is the whole authorisation story; there is no
 * admin override, because this is a preference, not an administration.
 *
 * Dark is the default and stays it (the column's own default). Her display
 * never reads this column.
 */
const WORKSPACE_THEMES = ["dark", "paper", "blue", "green"] as const;

peopleRouter.patch("/:id/theme", requireRole(CAN_OPEN_ADMIN), async (req, res) => {
  const { workspace_theme } = req.body ?? {};
  if (typeof workspace_theme !== "string" || !(WORKSPACE_THEMES as readonly string[]).includes(workspace_theme)) {
    return res.status(400).json({ error: "That is not one of the workspace colours." });
  }

  const archive = requireArchive(req, res);
  if (!archive) return;

  // Your own row only. `req.profile` is what the session resolved to after
  // the database re-read it, never a claim from the token alone.
  if (req.profile?.personId !== req.params.id) {
    return res.status(403).json({ error: "You can only change your own workspace colour." });
  }

  const { data, error } = await supabase
    .from("people")
    .update({ workspace_theme, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .is("archived_at", null)
    .select("id, workspace_theme")
    .maybeSingle();

  if (error) return fail(res, 500, "The workspace colour could not be saved.", error);
  if (!data) return res.status(404).json({ error: "Person not found." });

  res.json({ id: data.id, workspace_theme: data.workspace_theme });
});

peopleRouter.patch("/:id/visibility", requireRole(CAN_MANAGE_PEOPLE), async (req, res) => {
  const { show_on_display } = req.body;
  if (typeof show_on_display !== "boolean") {
    return res.status(400).json({ error: "Visibility must be true or false." });
  }

  const archive = requireArchive(req, res);
  if (!archive) return;

  const { data, error } = await supabase
    .from("people")
    .update({ show_on_display, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .is("archived_at", null)
    .select(PERSON_ADMIN_COLUMNS)
    .maybeSingle();

  if (error) return fail(res, 500, "The visibility could not be changed.", error);
  if (!data) return res.status(404).json({ error: "Person not found." });

  res.json(await toPublicPerson(data as unknown as Record<string, unknown>));
});

/**
 * The private note administrators keep about a person (frame 12, 044).
 *
 * Its own route rather than a field on the edit form, for the same reason
 * visibility got one: the edit form is "their details", written with them
 * and often by them, and this is written *about* them for the other admins.
 * Folding it in would put a delicate operational note one careless Save away
 * from a screen a co-author is looking at.
 *
 * Trimmed, and an empty note is stored as null rather than "" — a person
 * without a note has no note, which is a different thing from one whose note
 * is blank. The page reads the difference to decide between "Add a note" and
 * showing what is there.
 */
peopleRouter.patch("/:id/note", requireRole(CAN_MANAGE_PEOPLE), async (req, res) => {
  const { admin_note } = req.body;
  if (admin_note !== null && typeof admin_note !== "string") {
    return res.status(400).json({ error: "The note must be text." });
  }

  const trimmed = typeof admin_note === "string" ? admin_note.trim() : "";
  if (trimmed.length > 2000) {
    return res.status(400).json({ error: "That note is too long." });
  }

  const archive = requireArchive(req, res);
  if (!archive) return;

  const { data, error } = await supabase
    .from("people")
    .update({ admin_note: trimmed || null, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .is("archived_at", null)
    .select(PERSON_ADMIN_COLUMNS)
    .maybeSingle();

  if (error) return fail(res, 500, "The note could not be saved.", error);
  if (!data) return res.status(404).json({ error: "Person not found." });

  res.json(await toPublicPerson(data as unknown as Record<string, unknown>));
});

/**
 * Lets somebody back in early (frame 12m).
 *
 * A lockout already clears itself — 037 sets `locked_until` and time does the
 * rest. This is for the case the clock cannot help with: the person is on the
 * phone now, they have their code, and fifteen minutes of "wrong PIN" is a
 * punishment for a typo. Clearing it is not granting access; their PIN still
 * has to be right on the next try.
 *
 * The attempt counter goes with it. Leaving it at four would put them one
 * mistake from being locked out again, which is the same wall with a shorter
 * run-up.
 */
peopleRouter.post("/:id/clear-lockout", requireRole(CAN_MANAGE_PEOPLE), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;

  const { data, error } = await supabase
    .from("people")
    // The escalation starts again too (064): an admin who clears a lock has
    // decided this person is who they say, and the next typo must not cost
    // them a day.
    .update({ locked_until: null, failed_pin_attempts: 0, pin_lock_count: 0, updated_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .is("archived_at", null)
    .select(PERSON_ADMIN_COLUMNS)
    .maybeSingle();

  if (error) return fail(res, 500, "The lockout could not be cleared.", error);
  if (!data) return res.status(404).json({ error: "Person not found." });

  res.json(await toPublicPerson(data as unknown as Record<string, unknown>));
});

/** Issues a new PIN. Shown once, then only its hash is kept. */
peopleRouter.post("/:id/reset-pin", requireRole(CAN_MANAGE_PEOPLE), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;

  const { data: person, error: findError } = await supabase
    .from("people")
    .select("id, name, email, role")
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .is("archived_at", null)
    .maybeSingle();

  if (findError) return fail(res, 500, "The code could not be reset.", findError);
  if (!person) return res.status(404).json({ error: "Person not found." });
  if (person.role === "user") {
    return res.status(400).json({ error: "This profile opens without a code." });
  }

  const pin = generatePin();

  const { error } = await supabase
    .from("people")
    .update({
      pin_hash: await hashPin(pin),
      pin_set_at: new Date().toISOString(),
      failed_pin_attempts: 0,
      locked_until: null,
      pin_lock_count: 0,
    })
    .eq("id", person.id)
    .eq("archive_id", archive);

  if (error) return fail(res, 500, "The code could not be reset.", error);

  const emailed = await sendPinResetEmail(
    { name: person.name as string, email: (person.email as string | null) ?? null },
    pin
  );

  res.json({ pin, emailed });
});

/**
 * Checks the mail configuration by sending to the address on file.
 *
 * Only ever to the caller's own address, or failing that the family's
 * (review 29 Sep). It used to take any `to` from the body, which made it a
 * way to have Recall's account mail whoever an admin named; the page never
 * sent one, so nothing is lost by ignoring it. And a failure is answered in
 * one sentence: the transport's own text named the mail account's
 * configuration, and it stays in the server log for whoever runs Recall.
 */
peopleRouter.post("/test-email", requireRole(CAN_MANAGE_PEOPLE), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;

  const { data: person } = await supabase
    .from("people")
    .select("email")
    .eq("id", req.profile!.personId)
    .eq("archive_id", archive)
    .maybeSingle();

  let to = (person?.email as string | null) ?? null;
  if (!to) {
    const { data: family } = await supabase
      .from("families")
      .select("email")
      .eq("archive_id", archive)
      .maybeSingle();
    to = (family?.email as string | null) ?? null;
  }
  if (!to) {
    return res.status(400).json({ error: "No email address. Add one to your profile first." });
  }

  // `send()` has already logged the transport's words, addresses redacted.
  const result = await sendTestEmail(to);
  if (!result.success) {
    return res.json({ to, success: false, reason: "The test email could not be sent." });
  }
  res.json({ to, success: true });
});

// Archived rather than deleted, so their memories stay in the archive.
peopleRouter.delete("/:id", requireRole(CAN_DELETE), async (req, res) => {
  const archive = requireArchive(req, res);
  if (!archive) return;

  /*
    The only route here that took no view at all on who it was archiving. The
    other two refuse to let you demote or pause yourself; this one would
    archive the last admin — including the caller — and leave the family with
    an archive nobody can manage.
  */
  if (await wouldLeaveNoAdmin(archive, req.params.id as string)) {
    return res.status(400).json({ error: NO_ADMIN_LEFT });
  }

  const { error } = await supabase
    .from("people")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", req.params.id)
    .eq("archive_id", archive)
    .is("archived_at", null);

  if (error) return fail(res, 500, "This person could not be archived.", error);
  res.status(204).end();
});
