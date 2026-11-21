-- 038 — The database itself keeps families apart (M09 + M10)
--
-- Every archive-scoped query in the backend filters on archive_id, and the
-- test suite asserts that the *questions* are scoped. But the schema never
-- enforced any of it: archive_id has been a nullable, unconstrained sibling
-- column since 010, and a bug — one route, one join, one future builder —
-- could stitch channel A of one family to media of another and the database
-- would file it without comment. Commercial multi-tenancy cannot rest on
-- application discipline alone.
--
-- Two changes, M09 and M10 as one move:
--
-- **Composite foreign keys.** Every child that names a parent inside an
-- archive now references (parent_id, archive_id), so a row that points
-- across families is refused by the constraint, not merely never asked for.
-- Three rules made this workable:
--
--   * Constraint names are load-bearing: the backend embeds by them
--     (`channels!media_files_channel_id_fkey` and friends), so every
--     replacement keeps its exact old name.
--   * SET NULL actions name their column — `on delete set null (channel_id)`
--     — because a bare SET NULL on a composite key would null archive_id
--     too, detaching the row from its family. That is the opposite of what
--     this migration exists to do.
--   * New constraints are added NOT VALID and then validated in place. New
--     writes are checked from the moment this runs; a legacy row that
--     violates is *reported* in the checklist rather than silently blocking
--     the whole migration.
--
-- **archive_id NOT NULL.** Tightened per table, and only where no NULL rows
-- remain after backfill; a table that still holds unattributed rows is
-- reported with a count instead of failing the batch. Backfills only walk
-- edges whose answer is certain — a media row's family IS its channel's
-- family. Deliberately excluded: `families.archive_id` and
-- `family_sessions.archive_id`, nullable on purpose since 031 (the platform
-- owner has no archive), and the retired `archive_memberships_retired`.

create temp table _m38 (check_name text, result text) on commit drop;

-- ── A. Parents earn a composite identity ─────────────────────────────────
-- A composite FK needs a unique (id, archive_id) on its target. id alone is
-- already the primary key, so this is always satisfiable and adds no new
-- failure mode; it exists to give the composite keys something to hold.

do $$
declare
  parent text;
begin
  foreach parent in array array['people', 'channels', 'media_files', 'device_sessions'] loop
    execute format(
      'alter table %I drop constraint if exists %I',
      parent, parent || '_id_archive_unique'
    );
    execute format(
      'alter table %I add constraint %I unique (id, archive_id)',
      parent, parent || '_id_archive_unique'
    );
    insert into _m38 values (parent || ' unique (id, archive_id)', 'OK');
  end loop;
end $$;

-- ── B. Backfill the edges whose answer is certain ────────────────────────
-- Only child-from-parent, never a guess: a row that names a channel belongs
-- to that channel's family, and the same for a person. Roots (channels,
-- people, installations) have nothing to derive from and stay for section D
-- to report.

update media_files m set archive_id = c.archive_id
  from channels c where m.archive_id is null and m.channel_id = c.id and c.archive_id is not null;
update channel_access a set archive_id = c.archive_id
  from channels c where a.archive_id is null and a.channel_id = c.id and c.archive_id is not null;
update suggestions s set archive_id = c.archive_id
  from channels c where s.archive_id is null and s.channel_id = c.id and c.archive_id is not null;
update channel_visits v set archive_id = c.archive_id
  from channels c where v.archive_id is null and v.channel_id = c.id and c.archive_id is not null;
update nfc_cards n set archive_id = c.archive_id
  from channels c where n.archive_id is null and n.channel_id = c.id and c.archive_id is not null;
update missions mi set archive_id = c.archive_id
  from channels c where mi.archive_id is null and mi.channel_id = c.id and c.archive_id is not null;
update access_codes ac set archive_id = p.archive_id
  from people p where ac.archive_id is null and ac.person_id = p.id and p.archive_id is not null;
update activity_log l set archive_id = p.archive_id
  from people p where l.archive_id is null and l.author_id = p.id and p.archive_id is not null;
update channels ch set archive_id = p.archive_id
  from people p where ch.archive_id is null and ch.created_by = p.id and p.archive_id is not null;

-- ── C. The composite keys themselves ─────────────────────────────────────

do $$
declare
  spec record;
begin
  for spec in
    select * from (values
      -- child,            constraint (unchanged name),            columns,                          parent,          action
      ('media_files',    'media_files_channel_id_fkey',          '(channel_id, archive_id)',       'channels',      'cascade'),
      ('media_files',    'media_files_created_by_fkey',          '(created_by, archive_id)',       'people',        'set null (created_by)'),
      ('channel_access', 'channel_access_channel_id_fkey',       '(channel_id, archive_id)',       'channels',      'cascade'),
      ('channel_access', 'channel_access_person_id_fkey',        '(person_id, archive_id)',        'people',        'cascade'),
      ('channel_access', 'channel_access_granted_by_fkey',       '(granted_by, archive_id)',       'people',        'set null (granted_by)'),
      ('suggestions',    'suggestions_channel_id_fkey',          '(channel_id, archive_id)',       'channels',      'cascade'),
      ('channel_visits', 'channel_visits_channel_id_fkey',       '(channel_id, archive_id)',       'channels',      'cascade'),
      ('channel_visits', 'channel_visits_device_session_id_fkey','(device_session_id, archive_id)','device_sessions','cascade'),
      ('nfc_cards',      'nfc_cards_channel_id_fkey',            '(channel_id, archive_id)',       'channels',      'set null (channel_id)'),
      ('nfc_cards',      'nfc_cards_linked_by_fkey',             '(linked_by, archive_id)',        'people',        'set null (linked_by)'),
      ('missions',       'missions_channel_id_fkey',             '(channel_id, archive_id)',       'channels',      'set null (channel_id)'),
      ('missions',       'missions_media_id_fkey',               '(media_id, archive_id)',         'media_files',   'set null (media_id)'),
      ('missions',       'missions_assigned_to_fkey',            '(assigned_to, archive_id)',      'people',        'set null (assigned_to)'),
      ('missions',       'missions_assigned_by_fkey',            '(assigned_by, archive_id)',      'people',        'set null (assigned_by)'),
      ('missions',       'missions_created_by_fkey',             '(created_by, archive_id)',       'people',        'set null (created_by)'),
      ('activity_log',   'activity_log_author_id_fkey',          '(author_id, archive_id)',        'people',        'set null (author_id)'),
      ('activity_log',   'activity_log_target_channel_id_fkey',  '(target_channel_id, archive_id)','channels',      'set null (target_channel_id)'),
      ('channels',       'channels_created_by_fkey',             '(created_by, archive_id)',       'people',        'set null (created_by)'),
      ('channels',       'channels_author_id_fkey',              '(author_id, archive_id)',        'people',        'set null (author_id)'),
      ('access_codes',   'access_codes_person_id_fkey',          '(person_id, archive_id)',        'people',        'cascade'),
      ('access_codes',   'access_codes_created_by_fkey',         '(created_by, archive_id)',       'people',        'set null (created_by)'),
      ('invitations',    'invitations_person_id_fkey',           '(person_id, archive_id)',        'people',        'cascade'),
      ('family_sessions','family_sessions_person_id_fkey',       '(person_id, archive_id)',        'people',        'cascade')
    ) as t(child, con, cols, parent, action)
  loop
    begin
      execute format('alter table %I drop constraint if exists %I', spec.child, spec.con);
      execute format(
        'alter table %I add constraint %I foreign key %s references %I (id, archive_id) on delete %s not valid',
        spec.child, spec.con, spec.cols, spec.parent, spec.action
      );
      begin
        execute format('alter table %I validate constraint %I', spec.child, spec.con);
        insert into _m38 values (spec.con || ' composite', 'OK');
      exception when others then
        -- New rows are checked regardless; the legacy rows need a human.
        insert into _m38 values (spec.con || ' composite', 'ADDED, NOT VALIDATED: ' || sqlerrm);
      end;
    exception when others then
      insert into _m38 values (spec.con || ' composite', 'FAILED: ' || sqlerrm);
    end;
  end loop;
end $$;

-- ── D. archive_id stops being optional, where the data allows ────────────

do $$
declare
  tbl text;
  orphans bigint;
begin
  foreach tbl in array array[
    'channels', 'people', 'media_files', 'channel_access', 'nfc_cards',
    'missions', 'suggestions', 'activity_log', 'device_sessions',
    'channel_visits', 'installations', 'access_codes'
  ] loop
    execute format('select count(*) from %I where archive_id is null', tbl) into orphans;
    if orphans = 0 then
      execute format('alter table %I alter column archive_id set not null', tbl);
      insert into _m38 values (tbl || '.archive_id not null', 'OK');
    else
      insert into _m38 values (
        tbl || '.archive_id not null',
        'BLOCKED: ' || orphans || ' rows have no archive — backfill by hand, then re-run'
      );
    end if;
  end loop;
end $$;

-- ── Self-verifying checklist ─────────────────────────────────────────────

select check_name as check, result from _m38
union all
select 'every composite key really references (id, archive_id)',
       case when (
         select count(*) from pg_constraint c
         where c.contype = 'f'
           and c.conname in (
             'media_files_channel_id_fkey', 'channel_access_channel_id_fkey',
             'channel_access_person_id_fkey', 'suggestions_channel_id_fkey',
             'channel_visits_channel_id_fkey', 'nfc_cards_channel_id_fkey',
             'missions_channel_id_fkey', 'activity_log_author_id_fkey',
             'channels_created_by_fkey', 'access_codes_person_id_fkey',
             'invitations_person_id_fkey', 'family_sessions_person_id_fkey'
           )
           and array_length(c.conkey, 1) = 2
       ) = 12 then 'OK' else 'SOME STILL SINGLE-COLUMN' end
union all
select 'families.archive_id untouched (platform owner, 031)',
       case when (select is_nullable from information_schema.columns
                  where table_name = 'families' and column_name = 'archive_id') = 'YES'
            then 'OK' else 'WRONGLY TIGHTENED' end
union all
select 'family_sessions.archive_id untouched (platform owner, 031)',
       case when (select is_nullable from information_schema.columns
                  where table_name = 'family_sessions' and column_name = 'archive_id') = 'YES'
            then 'OK' else 'WRONGLY TIGHTENED' end
order by 1;
