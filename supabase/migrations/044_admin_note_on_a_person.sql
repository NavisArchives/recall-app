-- ============================================================
-- 044 — the note admins keep about a person (frame 12, PRIVATE — ADMINS ONLY)
-- ============================================================
--
-- Frames 12c, 12i and 12l all end with the same panel: a short private note
-- an administrator writes for the other administrators. "Doesn't read email
-- — call her instead." "Paused after the row about the house. Revisit in
-- September."
--
-- It is not `description`. `description` is the person as the family
-- describes them, it is written by them or about them warmly, and it is
-- readable by every helper. This is operational, sometimes delicate, and it
-- exists because the alternative today is an admin keeping it in their head
-- or in a WhatsApp thread with one other person.
--
-- ── Why it never reaches the display ─────────────────────────────────────
--
-- `PERSON_COLUMNS` is what the display and other members may read, and this
-- column is deliberately NOT added to it — it rides only on
-- `PERSON_ADMIN_COLUMNS`, alongside `email` and `contact_number`, under the
-- project invariant that contact-shaped detail reaches an authenticated
-- admin and nobody else. A note that says "call her instead, she doesn't
-- read email" is exactly as private as the phone number beside it.
--
-- Nullable, no default: a person without a note has no note, which is a
-- different thing from a person whose note is the empty string.

alter table people add column if not exists admin_note text;

comment on column people.admin_note is
  'Private note between administrators (frame 12). Never in PERSON_COLUMNS, '
  'so it cannot reach the display or another member — admin columns only, '
  'like email and contact_number.';

-- ── Self-check ───────────────────────────────────────────────────────────
-- Prints one row per assertion, so applying this by hand shows its own
-- result rather than silence.
select 'people.admin_note added' as check,
       exists (select 1 from information_schema.columns
               where table_name = 'people' and column_name = 'admin_note') as ok;

-- RLS is untouched and must stay deny-all: this column is readable only
-- through the service-role key, like every other column on this table.
select 'people RLS still enabled' as check,
       relrowsecurity as ok
from pg_class where relname = 'people';
