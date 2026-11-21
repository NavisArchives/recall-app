-- 058 — A colour of their own (owner, 17 Sep 2026)
--
-- The workspace gets three light palettes beside the dark one it has always
-- had: paper (25a), blue (25b), green (25e). The owner's constraint is the
-- important half of this migration: **dark is untouched and stays the
-- default.** A person who never opens Settings sees exactly what they saw
-- yesterday, byte for byte.
--
-- Per PROFILE, not per household and not per device: one admin choosing blue
-- must never change what another family member sees, and the choice follows
-- the person from their laptop to their phone. `people` is the profile row,
-- so it lives here. The display never reads this column — her screen is dark
-- unconditionally, which is why the theme is applied on the workspace shell
-- and never on <html>.

alter table people
  add column if not exists workspace_theme text not null default 'dark'
    check (workspace_theme in ('dark', 'paper', 'blue', 'green'));

comment on column people.workspace_theme is
  'This person''s workspace palette (058): dark (default, the original), '
  'paper, blue or green. A personal preference, written only by the person '
  'themselves through PATCH /api/people/:id/theme. Never read by any display '
  'route — Margaret''s screen is dark unconditionally.';

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'people carries workspace_theme' as check,
       case when exists (
         select 1 from information_schema.columns
         where table_name = 'people' and column_name = 'workspace_theme'
       ) then 'OK' else 'MISSING' end as result
union all
select 'it is one of the four words',
       case when exists (
         select 1 from information_schema.check_constraints c
         join information_schema.constraint_column_usage u on u.constraint_name = c.constraint_name
         where u.table_name = 'people' and u.column_name = 'workspace_theme'
       ) then 'OK' else 'MISSING' end
union all
select 'every existing person is still dark — nobody''s workspace changed',
       case when not exists (select 1 from people where workspace_theme <> 'dark')
            then 'OK' else 'SOMEBODY MOVED' end
union all
select 'people carrying a theme (expected = all, all dark, on first run)',
       (select count(*)::text from people where workspace_theme = 'dark');
