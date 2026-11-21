-- Migration 001: security hardening
--
-- Brings a database created with the original schema.sql up to the hardened
-- model. Safe to run once on an existing project; idempotent where possible.
--
-- Changes:
--   * drops the plaintext verification_code column
--   * replaces permanent public URLs with private storage paths
--   * drops the unused channels.thumbnail_url column
--   * removes anonymous read policies (backend-only access)
--   * makes both storage buckets private
--   * reserves display-only channel numbers

begin;

-- ------------------------------------------------------------
-- 1. Drop the unused verification-code feature
-- ------------------------------------------------------------
alter table authors drop column if exists verification_code;

-- ------------------------------------------------------------
-- 2. Public URLs -> private storage paths
-- ------------------------------------------------------------
alter table authors add column if not exists profile_picture_path text;
alter table media_files add column if not exists storage_path_new text;
alter table step_items add column if not exists image_path text;

-- Recover the object path from any previously stored public URL.
update authors
set profile_picture_path = regexp_replace(
  profile_picture_url, '^.*/storage/v1/object/public/profile-pictures/', ''
)
where profile_picture_url is not null and profile_picture_path is null;

update step_items
set image_path = regexp_replace(
  image_url, '^.*/storage/v1/object/public/channel-media/', ''
)
where image_url is not null and image_path is null;

alter table authors drop column if exists profile_picture_url;
alter table step_items drop column if exists image_url;
alter table media_files drop column if exists public_url;
alter table media_files drop column if exists storage_path_new;
alter table channels drop column if exists thumbnail_url;

-- ------------------------------------------------------------
-- 3. Constraints
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'media_files_storage_path_key'
  ) then
    alter table media_files add constraint media_files_storage_path_key unique (storage_path);
  end if;
end $$;

alter table channels drop constraint if exists channels_number_check;
alter table channels add constraint channels_number_check
  check (number between 1 and 99 and number not in (10, 11, 98, 99));

-- ------------------------------------------------------------
-- 4. Remove anonymous table access
-- ------------------------------------------------------------
drop policy if exists "Public read authors" on authors;
drop policy if exists "Public read channels" on channels;
drop policy if exists "Public read media_files" on media_files;
drop policy if exists "Public read steps" on steps;
drop policy if exists "Public read step_items" on step_items;

alter table authors enable row level security;
alter table channels enable row level security;
alter table media_files enable row level security;
alter table steps enable row level security;
alter table step_items enable row level security;

-- ------------------------------------------------------------
-- 5. Make storage buckets private
-- ------------------------------------------------------------
drop policy if exists "Public read channel-media" on storage.objects;
drop policy if exists "Public read profile-pictures" on storage.objects;

update storage.buckets set public = false where id in ('channel-media', 'profile-pictures');

commit;

-- ------------------------------------------------------------
-- 6. Verification
-- ------------------------------------------------------------
-- Returns one row per check. Every `ok` must be true. If this query returns
-- nothing, the migration did not run — re-check which file you executed.
select 'authors.verification_code dropped' as check,
       not exists (select 1 from information_schema.columns
                   where table_name = 'authors' and column_name = 'verification_code') as ok
union all
select 'authors.profile_picture_path added',
       exists (select 1 from information_schema.columns
               where table_name = 'authors' and column_name = 'profile_picture_path')
union all
select 'step_items.image_path added',
       exists (select 1 from information_schema.columns
               where table_name = 'step_items' and column_name = 'image_path')
union all
select 'channels.thumbnail_url dropped',
       not exists (select 1 from information_schema.columns
                   where table_name = 'channels' and column_name = 'thumbnail_url')
union all
select 'anonymous read policies removed',
       not exists (select 1 from pg_policies
                   where schemaname = 'public'
                     and tablename in ('authors','channels','media_files','steps','step_items'))
union all
select 'storage buckets private',
       not exists (select 1 from storage.buckets
                   where id in ('channel-media','profile-pictures') and public);
