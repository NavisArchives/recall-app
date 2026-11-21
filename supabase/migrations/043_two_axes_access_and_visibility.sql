-- 043 — Whether a person can sign in, and whether Margaret sees them, stop
--       being the same switch
--
-- Today `people.status` decides both, by accident of history. Deactivating
-- somebody blocks their sign-in (`middleware/auth.ts` refuses a
-- `deactivated` row), and her display shows whoever is left — so an admin who
-- wants a face off her screen has to take away that person's sign-in to do
-- it, and an admin who wants to suspend someone's access has no way to keep
-- them visible to her. Two unrelated decisions, one control.
--
-- They are separate axes now:
--
--   ACCESS      — status: can this person sign in, and in what condition.
--   VISIBILITY  — show_on_display: does her screen show this face at all.
--
-- VISIBILITY defaults to true, which is what the display does today, so
-- nothing changes for any existing family until an admin chooses otherwise.
--
-- ACCESS gains one value: 'remembered', for a contributor who has died. It is
-- not 'deactivated' wearing kinder words. Deactivated is a decision that can
-- be undone next week; remembered is a fact about a person, and the product
-- should never ask a family to file their mother under "deactivated" to stop
-- the archive emailing her. What it must NOT do is quietly become an
-- archive-them-away: their photographs, their captions and their name on the
-- channels they made all stay exactly where they are. The only things that
-- stop are sign-in and being written to.
--
-- The database keeps its own vocabulary. The design's labels — active,
-- invited, paused, remembered, locked out — are the words the admin reads;
-- `pending` is invited, `deactivated` is paused, and "locked out" is not a
-- status at all but a live fact derived from the PIN lockout counter added in
-- 037. Renaming the stored values would touch the auth middleware and every
-- test that names them, for no gain a person can see.

alter table people add column if not exists show_on_display boolean not null default true;

comment on column people.show_on_display is
  'Visibility axis (043): whether the subject''s display shows this face. '
  'Independent of status, which is the access axis.';

-- The access axis gains 'remembered' and keeps everything it had.
alter table people drop constraint if exists people_status_check;
alter table people add constraint people_status_check
  check (status in ('pending', 'active', 'deactivated', 'remembered'));

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'visibility column exists' as check,
       case when exists (select 1 from information_schema.columns
                         where table_name = 'people' and column_name = 'show_on_display')
            then 'OK' else 'MISSING' end as result
union all
select 'visibility defaults to visible (today''s behaviour)',
       case when (select column_default from information_schema.columns
                  where table_name = 'people' and column_name = 'show_on_display') like 'true%'
            then 'OK' else 'WRONG DEFAULT' end
union all
select 'no existing person was hidden by this migration',
       case when not exists (select 1 from people where show_on_display = false)
            then 'OK' else 'SOMEONE WAS HIDDEN' end
union all
select 'status accepts remembered',
       case when exists (
              select 1 from pg_constraint
              where conname = 'people_status_check'
                and pg_get_constraintdef(oid) like '%remembered%')
            then 'OK' else 'MISSING' end
union all
select 'status still accepts the three it had',
       case when (select bool_and(pg_get_constraintdef(oid) like '%' || v || '%')
                  from pg_constraint, unnest(array['pending','active','deactivated']) v
                  where conname = 'people_status_check')
            then 'OK' else 'A VALUE WAS DROPPED' end
union all
select 'every existing person still satisfies the constraint',
       case when not exists (
              select 1 from people
              where status not in ('pending', 'active', 'deactivated', 'remembered'))
            then 'OK' else 'AN EXISTING ROW IS NOW INVALID' end
union all
select 'rls still enabled on people',
       case when (select relrowsecurity from pg_class where relname = 'people')
            then 'OK' else 'RLS OFF' end;
