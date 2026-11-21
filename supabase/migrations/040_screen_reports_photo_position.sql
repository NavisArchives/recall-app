-- 040 — The screen reports which photograph it is on
--
-- Since 008, screen state has been two columns on the settings row: which
-- channel the display shows, and when it last said so. That was the whole
-- truth at the time — the display opened a channel and the workspace could
-- say "channel 06 is on her screen".
--
-- It stopped being the whole truth when the workspace started drawing
-- "NOW SHOWING · PHOTO 4 OF 9" and a dot-progress strip (frames 8a/8c, and
-- the Overview's live tile). Nothing records which photograph is up; the
-- number in that copy was a registered placeholder (`screen.photoIndex` in
-- the frontend's register), honest about being fake. This migration is what
-- lets it be real: two more columns beside the channel, written by the same
-- display on the same fire-and-forget path as it advances.
--
-- Both are nullable on purpose. Null means "not reported" — an older display
-- build, a channel with no photographs, or the moment between opening a
-- channel and the first report. The reader says "photo n of m" only when both
-- are present; a null is silence, never a guessed zero. `index` is 0-based
-- (the display's own array position); the workspace adds one for people.
--
-- No new table, so no new RLS surface: settings already has RLS enabled with
-- no policies (deny-all; only the backend's service key reads or writes).

alter table settings add column if not exists current_photo_index integer;
alter table settings add column if not exists current_photo_count integer;

-- A report can only describe a position inside its own count. The pair is
-- either absent together or coherent together; a lone index with no count
-- (or an index past the end) is a malformed report and refused at the door.
alter table settings drop constraint if exists settings_photo_position_coherent;
alter table settings add constraint settings_photo_position_coherent check (
  (current_photo_index is null and current_photo_count is null)
  or (
    current_photo_index is not null
    and current_photo_count is not null
    and current_photo_index >= 0
    and current_photo_count >= 1
    and current_photo_index < current_photo_count
  )
);

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'photo position columns exist' as check,
       case when (select count(*) from information_schema.columns
                  where table_name = 'settings'
                    and column_name in ('current_photo_index', 'current_photo_count')) = 2
            then 'OK' else 'MISSING' end as result
union all
select 'columns are nullable (null = not reported)',
       case when (select count(*) from information_schema.columns
                  where table_name = 'settings'
                    and column_name in ('current_photo_index', 'current_photo_count')
                    and is_nullable = 'YES') = 2
            then 'OK' else 'NOT NULLABLE' end
union all
select 'coherence constraint present',
       case when exists (select 1 from pg_constraint
                         where conname = 'settings_photo_position_coherent')
            then 'OK' else 'MISSING' end
union all
select 'existing rows survive as unreported',
       case when not exists (select 1 from settings
                             where current_photo_index is not null
                                or current_photo_count is not null)
            then 'OK' else 'UNEXPECTED VALUES' end
union all
select 'rls still enabled on settings',
       case when (select relrowsecurity from pg_class where relname = 'settings')
            then 'OK' else 'RLS OFF' end;
