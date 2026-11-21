import { env } from "../config/env.js";

// Explicit column lists. Never use select("*") in routes: it silently leaks any
// column added later.
/*
  The display's set. "The display" is her trusted screen with nobody acting,
  or with her own `user` profile acting — pairing gives the screen that
  profile, and it opens nowhere else — so role `user` reads this set and
  SETTINGS_DISPLAY_COLUMNS, never the member or self sets (access-8).
*/
export const PERSON_COLUMNS =
  "id, name, relationship, description, birthday, profile_picture_path, created_at";

/**
 * What one member of the family may know about another.
 *
 * A helper sees the whole workspace, so the Contributors page has to say who
 * is an admin and who is still to accept — otherwise it renders a column of
 * names above nothing, which is what a co-author saw. Role and status are
 * facts about the *archive*, not about the person.
 *
 * `joined_at` joins them: whether somebody has accepted an invitation is the
 * difference between a face an admin put on the shelf and a person who can
 * sign in, and the invite flow (M41) has to be able to tell them apart. It is
 * a timestamp about the archive, like the other two — not a contact detail.
 *
 * `email` and `contact_number` stay out, deliberately and permanently:
 * contact details reach an authenticated admin only, and never the display.
 */
/*
  `show_on_display` rides with the member columns, not the admin ones (043):
  whether a face appears on her screen is not a contact detail, and the
  display itself must be able to read it.
*/
/*
  `workspace_theme` (058) rides here too: it is a preference about the
  workspace, not a contact detail, and the person signing in has to be able
  to read their own. No display route selects these columns.
*/
export const PERSON_MEMBER_COLUMNS = `${PERSON_COLUMNS}, role, status, joined_at, show_on_display, workspace_theme`;

/*
  `locked_until` rides with the admin columns (frame 12m). A lockout is NOT a
  status — the pill stays green and active — it is a live fact with a clock on
  it, and an admin who cannot see it cannot help the person who is stuck
  outside. Exposed to an admin only, like the contact details beside it.
*/
/*
  `admin_note` rides here and nowhere else (frame 12, 044).

  It is the private note administrators keep about a person — "doesn't read
  email, call her instead". Operational, sometimes delicate, and exactly as
  private as the phone number beside it. Adding it to PERSON_COLUMNS or the
  member set would put it on the display and in front of every helper, which
  is the one thing it must never do.

  `created_by` joins it for frame 12a's DETAILS block, which names who added
  this person to the archive. It is a `people` id, resolved to a name against
  the list an admin already has — so the column carries no name and leaks
  nothing a reader of it could not already look up.
*/
export const PERSON_ADMIN_COLUMNS = `${PERSON_MEMBER_COLUMNS}, email, contact_number, address, last_seen_at, locked_until, admin_note, created_by`;

/**
 * What a person may know about themselves.
 *
 * Identical to the admin set minus the surveillance: you see your own phone,
 * email and address — you typed them — but `last_seen_at` is a record kept
 * *about* you and belongs with the admin's view of the family, not with
 * "my info".
 */
export const PERSON_SELF_COLUMNS = `${PERSON_MEMBER_COLUMNS}, email, contact_number, address`;

/** Authentication state reloaded for every privileged device/profile read. */
export const PROFILE_AUTH_COLUMNS =
  "id, name, role, status, archived_at, archive_id, profile_sessions_valid_from";
/**
 * Everything the platform owner's dashboard may ever learn about a family
 * (M55), written here so the whole disclosure can be read in one place.
 *
 * The rule is the owner's own and it is absolute: **information, never
 * content.** Counts, dates, sizes and statuses — no channel titles, no media
 * paths or filenames, no member names, no memory text, no contact numbers,
 * and no email other than the family's own account address, which the owner
 * already holds because he sent the founding invitation.
 *
 * These are structural, not decorative. A dashboard query that selects
 * anything outside this constant is a bug even if nothing renders it, because
 * the disclosure happens at the database, not at the component.
 */
export const OWNER_FAMILY_COLUMNS =
  "id, archive_id, display_name, email, created_at, platform_owner, subscription, payment_state, tier, invoice_number, invoice_amount_cents, invoiced_at, paid_at, activated_at, paused_at, billing_period";

/**
 * What a family may read about its own money (055): the state, the tier,
 * the open invoice. Never the owner's note. Shown in the workspace so an
 * invoiced or paused family sees what is owed without emailing anyone.
 */
export const FAMILY_PAYMENT_COLUMNS =
  "payment_state, tier, invoice_number, invoice_amount_cents, invoiced_at, paid_at, activated_at, paused_at, billing_period";

/*
 * What a password check reads off the family row (064). Named once, so
 * /login, /pair-screen and /pair-screen/admins cannot drift apart on what
 * they know about the family. Server-side only: the password hash and the
 * sealed authenticator secret leave routes/family.ts only as far as argon2
 * and services/totp.ts — no response ever carries this set.
 */
export const FAMILY_SIGN_IN_COLUMNS =
  "id, email, display_name, archive_id, password_hash, session_version, status, platform_owner, " +
  "failed_password_attempts, password_locked_until, password_lock_count, " +
  "owner_totp_secret, owner_totp_enabled_at, owner_totp_last_step";

/**
 * Every column the platform owner's step-up and two-step routes read from
 * the owner's own row (064). Server-side only, like the set above.
 */
export const OWNER_SECOND_FACTOR_COLUMNS =
  "id, email, password_hash, failed_password_attempts, password_locked_until, password_lock_count, " +
  "owner_totp_secret, owner_totp_enabled_at, owner_totp_last_step";

/**
 * The row `recordOwnerAudit` writes (065). Nothing reads the table yet; the
 * list exists so the boot check knows the table the export and print routes
 * refuse without.
 */
export const OWNER_AUDIT_COLUMNS = "id, family_id, action, target_family_id, archive_id, card_id, created_at";

/**
 * The PIN lockout's counters (037, escalated by 064). Written by
 * services/pins.ts and the admin's clear-lockout and reset-PIN routes, never
 * returned; listed so the boot check knows `pin_lock_count` exists.
 */
export const PIN_COUNTER_COLUMNS = "failed_pin_attempts, locked_until, pin_lock_count";

/** One declaration of her word (054), as the archive's admins read it. */
export const CONSENT_COLUMNS =
  "id, basis, signer_name, signer_relationship, subject_name, declared_by, text_version, lang, declared_at, withdrawn_at, withdrawn_reason";

/**
 * Rows counted per family. Ids and timestamps only — never a title, never a
 * storage path.
 *
 * `media_files` carries no size column, so **storage bytes are not knowable
 * from the database today**. The dashboard reports the file count, which is
 * real, and leaves bytes as a seam beside the subscription one rather than
 * inventing a number from an average. Recording a size at upload time is a
 * write-path change and this mission is strictly a read.
 */
export const OWNER_CHANNEL_COLUMNS = "id, archive_id, created_at";
export const OWNER_PERSON_COLUMNS = "id, archive_id";
export const OWNER_MEDIA_COLUMNS = "id, archive_id, created_at";
export const OWNER_INSTALLATION_COLUMNS = "id, archive_id, is_trusted, last_used_at, revoked_at";

/**
 * What a family may know about its own screens (047).
 *
 * No `secret_hash` and no `username`: the pairing credential is minted for
 * the machine and thrown away, and nothing on a Settings page needs either.
 * What is here is what somebody standing in the room needs to recognise
 * which device is which — a name, when it was last used, what it is running,
 * and whether it is hardware they may not retire.
 */
export const FAMILY_SCREEN_COLUMNS =
  "id, name, is_trusted, is_recall_device, trusted_at, last_used_at, software_version, " +
  "session_expires_at, renewal_notified_at";
export const OWNER_ACTIVITY_COLUMNS = "id, archive_id, action_type, created_at";
export const OWNER_VISIT_COLUMNS = "id, archive_id, started_at";

/**
 * The subject's profile row, by who is asking (053's contract, kept).
 *
 * Her screen fetches /settings on every load and uses the display name — so
 * that is what it is sent, with the photo path the header may show. The
 * postal address exists so postcards can be printed and mailed; migration
 * 053 promised it would be read "never by any display route", and until the
 * launch sweep the route behind requireDevice handed it, her birth date,
 * her residence and the free-text note to the 30-day device tier. A member
 * (a family session without people-management) reads what the Settings
 * page shows about her; only someone who can manage people reads where the
 * cards go.
 */
export const SETTINGS_DISPLAY_COLUMNS = "display_name, full_name, photo_path";
export const SETTINGS_MEMBER_COLUMNS =
  "display_name, full_name, birth_date, residence, note, photo_path";
export const SETTINGS_ADMIN_COLUMNS =
  "display_name, full_name, birth_date, residence, note, photo_path, delivery_address";

export const CHANNEL_COLUMNS =
  "id, number, title, description, content_type, date, author_id, created_by, privacy_level, created_at";
/*
  `taken_precision` travels with `taken_on` everywhere (059). A date without
  it is a date whose day may be invented: every upload path writes the first
  of the month because the field is a month picker, so a reader that prints
  the day is stating something the family never said. The two columns are one
  fact and must not be selected apart.
*/
export const MEDIA_FILE_COLUMNS =
  "id, channel_id, storage_path, file_type, display_order, caption, taken_on, taken_precision, place_id";

/*
  The words a family invents for itself (059). Two columns each, because that
  is the whole of them: a place and a tag are a name and an identity. Nothing
  here is contact data — a place is "Ostend", not an address — so these lists
  are as safe on the workspace as a channel title.
*/
export const PLACE_COLUMNS = "id, name";
export const TAG_COLUMNS = "id, name";

interface PersonRow {
  profile_picture_path?: string | null;
  [key: string]: unknown;
}

/**
 * Hides the private storage path behind a URL served by this backend.
 *
 * A signed Supabase URL would expire in an hour and stop working offline; this
 * one is stable, cacheable forever, and backed by the on-disk media cache.
 * Contact details (email, phone) are only present when the route selected the
 * admin columns.
 */
export async function toPublicPerson<T extends PersonRow | null>(person: T) {
  if (!person) return null;

  const { profile_picture_path, id, ...rest } = person;
  return {
    id,
    ...rest,
    profile_picture_url: profile_picture_path
      ? `${env.publicUrl}/api/media/person/${id}/photo`
      : null,
  };
}

export async function toPublicPeople(people: PersonRow[]) {
  return Promise.all(people.map((person) => toPublicPerson(person)));
}

/**
 * A physical card — a tag someone taps, or a postcard Recall prints and posts.
 *
 * It lives here rather than beside the route (047) so the boot preflight can
 * see it. The check derives its work from this file's exports, so a column
 * list kept anywhere else is a blind spot of exactly the kind the check
 * exists to close — and this one gained ten columns in a single migration.
 *
 * `tag_code` is the only field a stranger could use: it is what an NFC tag
 * emits, and the card registry is already behind `CAN_WRITE_CONTENT`.
 */
/*
  `failure_reason` is absent on purpose. It is what the print house told us —
  "printer error", "stock out" — and 18j's caption is explicit that the retry
  and the reason both stop at the queue so the family never sees a printer
  error. They are shown "preparing for delivery"; the operator sees why it is
  not moving. One row, two readerships (the same split as `queued`).
*/
export const CARD_COLUMNS =
  "id, label, tag_code, channel_id, linked_object, linked_by, created_at, updated_at, " +
  "kind, state, media_file_id, from_person_id, to_person_id, " +
  "recurrence, photo_mode, next_send_at, sent_at, delivered_at, returned_at, failed_at, " +
  "shipping_reference, shipping_carrier";
