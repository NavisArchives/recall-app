-- Recall: Supabase schema — FRESH INSTALL ONLY
--
-- ⚠ For a NEW database, do not start here: apply supabase/migrations/ in order,
--   from 000_scaffold_schema.sql to the last file, each in its own
--   transaction (see the README). This file is the hardened base as of
--   migration 001, kept as a record; it lacks everything added since.
--
-- ⚠️  Do NOT run this against a database that already has tables. Every
--     statement is "create table if not exists", so on an existing database it
--     does nothing while still reporting "Success. No rows returned".
--     To update an existing database, run supabase/migrations/ instead.
--
-- ⚠️  This file is NOT a working fresh install today (README.md, "New
--     project"). It holds the three tables of 7 Aug 2026 and nothing since
--     010 — no families, no people, no archives — so a backend pointed at a
--     database built from it refuses to start: the boot preflight
--     (backend/src/services/schemaPreflight.ts) checks the column lists,
--     the functions 064 and 066 install (begin_family_password_attempt,
--     record_family_password_failure, record_pin_failure, claim_mail_send)
--     and 067's security_posture_report. When this file is regenerated
--     (pg_dump --schema-only of a database with every migration applied),
--     it must carry 064–067 too. Until then a fresh install is unsupported,
--     as the README says.
--
-- Security model: all reads and writes go through the Recall backend using the
-- service-role key. Anonymous clients get no direct table or storage access,
-- so RLS is enabled with no permissive policies and both buckets are private.

-- ============================================================
-- Extensions
-- ============================================================
create extension if not exists "pgcrypto";

-- ============================================================
-- Tables
-- ============================================================

create table if not exists authors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  relationship text,
  profile_picture_path text,
  email text,
  contact_number text,
  description text,
  birthday date,
  created_at timestamptz not null default now()
);

create table if not exists channels (
  id uuid primary key default gen_random_uuid(),
  -- 0, 10, 11, 98 and 99 are reserved by the display for its own pages.
  number integer not null unique
    check (number between 1 and 99 and number not in (10, 11, 98, 99)),
  title text not null,
  description text,
  content_type text not null check (content_type in ('album', 'video')),
  date date,
  author_id uuid references authors (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists media_files (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels (id) on delete cascade,
  storage_path text not null unique,
  file_type text not null check (file_type in ('image', 'video')),
  -- Optional per-photo detail; the channel's description/date is the fallback.
  caption text,
  taken_on date,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- Guides are ordinary channels (`content_type = 'instruction'`), not a table
-- of their own. `steps` and `step_items` were a parallel store no family could
-- write to; they were dropped in migration 035 (M92). One format, one storage.

-- ============================================================
-- Indexes
-- ============================================================
create index if not exists idx_channels_number on channels (number);
create index if not exists idx_channels_author_id on channels (author_id);
create index if not exists idx_media_files_channel_id on media_files (channel_id);

-- ============================================================
-- Row Level Security
-- ============================================================
-- Enabled with no policies: anon/authenticated roles are denied everything.
-- The backend's service-role key bypasses RLS by design.
alter table authors enable row level security;
alter table channels enable row level security;
alter table media_files enable row level security;

-- ============================================================
-- Storage buckets (private — the backend issues short-lived signed URLs)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('channel-media', 'channel-media', false)
on conflict (id) do update set public = false;

insert into storage.buckets (id, name, public)
values ('profile-pictures', 'profile-pictures', false)
on conflict (id) do update set public = false;
