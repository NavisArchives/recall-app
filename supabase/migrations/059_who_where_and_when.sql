-- 059 — Who, where, and when (owner, 17 Sep 2026)
--
-- "Each and every added item also deserves to have people, locations, a more
-- specific date. This is all optional." And a channel deserves a word for what
-- it is about — childhood, holiday, travel, hometown — from a list the family
-- writes itself.
--
-- Everything here is nullable or empty by default. An archive that never fills
-- any of it in reads exactly as it does today, which is the point: a form with
-- five empty fields per photograph would simply not be filled in, and a
-- feature nobody fills in makes the archive look half-done.
--
-- A REPAIR TRAVELS WITH IT. `taken_precision` is not only the "more specific
-- date" the owner asked for; it closes a defect that is live on Margaret's
-- screen right now. Both upload paths write `${month}-01` (the field is a
-- month picker: frontend/src/mobile/AddFlow.tsx and pages/AdminUpload.tsx),
-- and frontend/src/pages/Channel.tsx formats with `day: "numeric"` whenever a
-- photograph has a date. So a photograph a family dated "August 1978" is being
-- read to her as "1 August 1978" — a day nobody chose, stated as fact, to
-- someone who cannot check it. The column records what the archive actually
-- knows, so the screen can stop asserting a day it was never told.
--
-- Tenancy follows 038: every child names its parent by (id, archive_id), so a
-- row that points across families is refused by the constraint rather than
-- merely never asked for.

-- ── 1. A date that knows its own precision ───────────────────────────────

alter table media_files
  add column if not exists taken_precision text
    check (taken_precision is null or taken_precision in ('year', 'month', 'day'));

comment on column media_files.taken_precision is
  'How much of taken_on the family actually told us (059): year, month or '
  'day. Null when taken_on is null. The display must not print a day unless '
  'this says ''day'' — every upload path writes the first of the month, so a '
  'day was almost never chosen.';

-- Backfill, deliberately conservative. A stored day of 01 is what the month
-- picker produces, so it is read as month precision; any other day was typed
-- by something that meant it. Understating precision is the safe direction:
-- showing "August 1978" when the day was known loses a detail, while showing
-- "1 August 1978" when it was not invents one.
update media_files
   set taken_precision = case
         when taken_on is null then null
         when extract(day from taken_on) = 1 then 'month'
         else 'day'
       end
 where taken_precision is null;

-- ── 2. Places, invented by the family ────────────────────────────────────

create table if not exists places (
  id          uuid primary key default gen_random_uuid(),
  archive_id  uuid not null references archives (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 80),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  unique (id, archive_id)
);

-- One spelling per archive, case-insensitively: "Ostend" typed twice is one
-- place, or the list becomes forty near-duplicates within a year.
create unique index if not exists places_one_per_name
  on places (archive_id, lower(btrim(name)));

alter table places enable row level security;

alter table media_files
  add column if not exists place_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'media_files_place_fk'
  ) then
    alter table media_files
      add constraint media_files_place_fk
      foreign key (place_id, archive_id) references places (id, archive_id)
      on delete set null;
  end if;
end $$;

comment on column media_files.place_id is
  'Where this photograph was taken (059), from the archive''s own list of '
  'places. Optional. Deleting a place leaves the photograph, without one.';

-- ── 3. Who is in it ──────────────────────────────────────────────────────

create table if not exists media_people (
  media_file_id uuid not null,
  person_id     uuid not null,
  archive_id    uuid not null references archives (id) on delete cascade,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  primary key (media_file_id, person_id),
  foreign key (media_file_id, archive_id) references media_files (id, archive_id) on delete cascade,
  foreign key (person_id, archive_id)     references people (id, archive_id)      on delete cascade
);

alter table media_people enable row level security;

create index if not exists media_people_person_idx on media_people (person_id);
create index if not exists media_people_archive_idx on media_people (archive_id);

comment on table media_people is
  'Who is in a photograph (059). The join exists so "every photograph with '
  'Marie in it" is a query rather than a rewrite later. Optional: most rows '
  'will never have one.';

-- ── 4. What a channel is about ───────────────────────────────────────────

create table if not exists tags (
  id          uuid primary key default gen_random_uuid(),
  archive_id  uuid not null references archives (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 40),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  unique (id, archive_id)
);

create unique index if not exists tags_one_per_name
  on tags (archive_id, lower(btrim(name)));

alter table tags enable row level security;

create table if not exists channel_tags (
  channel_id uuid not null,
  tag_id     uuid not null,
  archive_id uuid not null references archives (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (channel_id, tag_id),
  foreign key (channel_id, archive_id) references channels (id, archive_id) on delete cascade,
  foreign key (tag_id, archive_id)     references tags (id, archive_id)     on delete cascade
);

alter table channel_tags enable row level security;

create index if not exists channel_tags_tag_idx on channel_tags (tag_id);
create index if not exists channel_tags_archive_idx on channel_tags (archive_id);

comment on table tags is
  'A family''s own words for what a channel is about (059) — childhood, '
  'holiday, travel, hometown, and whatever else they invent. Per archive: one '
  'family''s vocabulary is not another''s.';

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'media_files knows how precise its date is' as check,
       case when exists (
         select 1 from information_schema.columns
         where table_name = 'media_files' and column_name = 'taken_precision'
       ) then 'OK' else 'MISSING' end as result
union all
select 'no dated photograph was left without a precision',
       case when not exists (
         select 1 from media_files where taken_on is not null and taken_precision is null
       ) then 'OK' else 'MISSING' end
union all
select 'places, media_people, tags and channel_tags all exist',
       case when (
         select count(*) from information_schema.tables
         where table_name in ('places', 'media_people', 'tags', 'channel_tags')
       ) = 4 then 'OK' else 'MISSING' end
union all
select 'RLS is on with no permissive policy on any of them',
       case when (
         select count(*) from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relname in ('places', 'media_people', 'tags', 'channel_tags')
           and c.relrowsecurity
       ) = 4
        and (
         select count(*) from pg_policies
         where schemaname = 'public'
           and tablename in ('places', 'media_people', 'tags', 'channel_tags')
       ) = 0
       then 'OK' else 'MISSING' end
union all
select 'every new child names its parent by (id, archive_id)',
       case when (
         select count(*) from pg_constraint
         where conname in ('media_files_place_fk')
            or (conrelid = 'media_people'::regclass and contype = 'f')
            or (conrelid = 'channel_tags'::regclass and contype = 'f')
       ) >= 5 then 'OK' else 'MISSING' end
union all
select 'a place and a tag cannot be spelled twice in one archive',
       case when (
         select count(*) from pg_indexes
         where schemaname = 'public'
           and indexname in ('places_one_per_name', 'tags_one_per_name')
       ) = 2 then 'OK' else 'MISSING' end;
