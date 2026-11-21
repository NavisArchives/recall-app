-- 000: The scaffold — Recall's first schema, as it stood on day one.
--
-- Kept so a new database can be built from nothing: apply this file, then
-- 001 onwards, in order, each file in its own transaction. 001 is the
-- security hardening that turns the public read policies and public buckets
-- below into private ones; by 062 every table has RLS with no policy at all.
-- (The original wording follows unchanged.)

-- Recall: Supabase schema
-- Run this whole file in the Supabase SQL editor (Project > SQL Editor > New query).

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
  profile_picture_url text,
  email text,
  contact_number text,
  description text,
  birthday date,
  verification_code text,
  created_at timestamptz not null default now()
);

create table if not exists channels (
  id uuid primary key default gen_random_uuid(),
  number integer not null unique check (number between 1 and 99),
  title text not null,
  description text,
  content_type text not null check (content_type in ('album', 'video')),
  date date,
  author_id uuid references authors (id) on delete set null,
  thumbnail_url text,
  created_at timestamptz not null default now()
);

create table if not exists media_files (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels (id) on delete cascade,
  storage_path text not null,
  public_url text not null,
  file_type text not null check (file_type in ('image', 'video')),
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists steps (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description_whole text,
  created_at timestamptz not null default now()
);

create table if not exists step_items (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null references steps (id) on delete cascade,
  image_url text,
  description text,
  display_order integer not null default 0
);

-- ============================================================
-- Indexes
-- ============================================================
create index if not exists idx_channels_number on channels (number);
create index if not exists idx_channels_author_id on channels (author_id);
create index if not exists idx_media_files_channel_id on media_files (channel_id);
create index if not exists idx_step_items_step_id on step_items (step_id);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table authors enable row level security;
alter table channels enable row level security;
alter table media_files enable row level security;
alter table steps enable row level security;
alter table step_items enable row level security;

create policy "Public read authors" on authors for select using (true);
create policy "Public read channels" on channels for select using (true);
create policy "Public read media_files" on media_files for select using (true);
create policy "Public read steps" on steps for select using (true);
create policy "Public read step_items" on step_items for select using (true);

-- Writes go through the backend using the Supabase service-role key,
-- which bypasses RLS, so no insert/update/delete policies are defined here.

-- ============================================================
-- Storage buckets
-- ============================================================
insert into storage.buckets (id, name, public)
values ('channel-media', 'channel-media', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('profile-pictures', 'profile-pictures', true)
on conflict (id) do nothing;

create policy "Public read channel-media"
  on storage.objects for select
  using (bucket_id = 'channel-media');

create policy "Public read profile-pictures"
  on storage.objects for select
  using (bucket_id = 'profile-pictures');
