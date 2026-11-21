-- ============================================================
-- 046 — who added this person (frame 12a, DETAILS)
-- ============================================================
--
-- `87ed1a0` reworked the contributor profile to design 12 and added TWO
-- columns to `PERSON_ADMIN_COLUMNS`: `admin_note` and `created_by`. Only
-- `admin_note` got a migration (044). This is the other half.
--
-- Without it every admin request for people answers
-- `42703: column people.created_by does not exist`, so the Contributors
-- page 500s — which reads as "the feature is broken" and points at nothing.
--
-- What reads it: `ContributorProfilePage.tsx:522` renders an "Added by"
-- row, resolving the id against the people list an administrator already
-- holds. So the column carries an id and no name, and leaks nothing a
-- reader of that page could not already look up.
--
-- ── Why a bare column and no foreign key ────────────────────────────────
--
-- 038 gives channels, media_files and missions COMPOSITE foreign keys
-- `(created_by, archive_id) -> people` so a row can never point at a person
-- in another family. A person-to-person reference plausibly wants the same
-- treatment, and that is a decision worth making awake, against 038 open.
--
-- A bare `uuid` cannot violate tenancy: it carries no referential power at
-- all, and every read of it is already archive-scoped by the route. So this
-- unblocks the page without quietly inventing a constraint. Adding the FK
-- later is a second migration, not a rewrite of this one.
--
-- Existing rows get NULL, which is the truth: nobody recorded who added
-- them. The page renders that row blank rather than guessing.
-- ============================================================

alter table people add column if not exists created_by uuid;

comment on column people.created_by is
  'The person who added this one to the archive (frame 12a DETAILS). Admin '
  'columns only — never in PERSON_COLUMNS or PERSON_MEMBER_COLUMNS. Bare '
  'uuid, not a foreign key: see 038 for the composite-FK tenancy pattern a '
  'reference would need.';

-- ── self-verifying ──────────────────────────────────────────────────────

select 'people.created_by added' as check,
       exists (select 1 from information_schema.columns
               where table_name = 'people' and column_name = 'created_by') as ok;

select 'it is nullable, so existing people are untouched' as check,
       (select is_nullable = 'YES' from information_schema.columns
        where table_name = 'people' and column_name = 'created_by') as ok;

select 'no rows were given a value' as check,
       (select count(*) = 0 from people where created_by is not null) as ok;

select 'people RLS still enabled' as check,
       relrowsecurity as ok
from pg_class where relname = 'people';
