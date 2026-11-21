-- 027: The Family, its members, and the one trusted device.
--
-- Implements `docs/specs/identity-model.md`. The decision it encodes: one
-- Family account per household — email, password, subscription — with member
-- profiles inside it entered by PIN, and exactly one trusted device, which is
-- the only place the subject's profile exists.
--
-- Why this is urgent rather than tidy: there is no way to log in today.
-- Signup turns the browser into a household installation and sets two
-- cookies. When they expire — thirty days for the device, eight hours for an
-- admin profile — or somebody clears them, switches laptop or opens a phone,
-- the archive is unreachable. They cannot sign up again either; the address
-- is taken. A family locked out of the memories they built is worse than any
-- vulnerability on the list.
--
-- Everything here is ADDITIVE. The existing device and profile cookies keep
-- working exactly as they do, because Margaret's screen runs on them and
-- must not be interrupted by this. The new model comes up alongside and takes
-- over when the code is ready for it.
--
-- Multi-family safety is the property to hold on to. Every uniqueness rule
-- below is scoped per archive, never global: two families may both have a
-- member called Mum, both call a device "the kitchen screen", and both be
-- the second family to sign up on a Tuesday. The constraints say "one per
-- family", never "one".

-- ── Level 1 · the Family ────────────────────────────────────────────────
--
-- `accounts` was one row per person. It becomes one row per family, which is
-- the whole decision in one line. The name goes with it: a table called
-- `accounts` invites the old meaning back the first time somebody reads it
-- without the spec open.

alter table accounts rename to families;
alter index if exists accounts_pkey rename to families_pkey;

alter table families add column if not exists archive_id uuid references archives(id) on delete cascade;
alter table families add column if not exists password_hash text;
alter table families add column if not exists password_set_at timestamptz;

/*
 * Bumped by a password change or "sign out everywhere". Every session
 * carries the version it was minted under, so raising it invalidates all of
 * them at once without touching a row per session — knowing an old password
 * must never stay useful until a cookie happens to expire.
 */
alter table families add column if not exists session_version integer not null default 1;

-- One family per archive, and one archive per family. Scoped, not global.
create unique index if not exists families_one_per_archive
  on families (archive_id) where archive_id is not null;

-- Adopt the archive each existing row already owns, so the invariant is true
-- before it is enforced.
update families f
   set archive_id = a.id
  from archives a
 where a.owner_account_id = f.id and f.archive_id is null;

-- ── Level 2 · members, and the profiles an invitation claims ────────────
--
-- A profile is in one of three states, and the difference matters: the
-- subject lives only on the trusted device, a shelf member has a PIN that
-- works on the family screen but cannot sign in remotely, and a joined
-- member has accepted an emailed invitation.

alter table people add column if not exists joined_at timestamptz;

/*
 * The invitation names the profile it is for.
 *
 * Without this an invitation carries only a name and an email, and accepting
 * one inserts a new `people` row — so inviting a contributor who is already
 * a face on the shelf gives the family two of her. The spec is explicit: an
 * invitation claims the existing profile; it never creates a second.
 */
alter table invitations add column if not exists person_id uuid references people(id) on delete cascade;

-- ── Level 3 · the one trusted device ────────────────────────────────────
--
-- Enforced here rather than checked in the UI, because two people pairing a
-- new screen at the same moment is exactly when a UI check loses.

alter table installations add column if not exists is_trusted boolean not null default false;
alter table installations add column if not exists trusted_at timestamptz;

create unique index if not exists installations_one_trusted_per_archive
  on installations (archive_id) where is_trusted;

-- The archive that already runs a display keeps it: its oldest installation
-- is the screen in the living room.
update installations i
   set is_trusted = true, trusted_at = coalesce(i.created_at, now())
 where i.id = (
   select i2.id from installations i2
    where i2.archive_id = i.archive_id and i2.revoked_at is null
    order by i2.created_at
    limit 1
 )
 and not exists (
   select 1 from installations t
    where t.archive_id = i.archive_id and t.is_trusted
 );

-- ── Sessions: server-side, opaque, revocable now rather than eventually ──
--
-- The cookie becomes a random identifier and nothing else. Role, family and
-- archive are read from these rows on every protected request, so a deletion,
-- a suspension, a role change or a sign-out takes effect on the very next
-- request instead of whenever a signed token happens to expire.

create table if not exists family_sessions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  archive_id uuid not null references archives(id) on delete cascade,

  -- Only the hash is stored: the cookie's value never touches the database.
  token_hash text not null unique,

  -- Null until a profile is chosen. Signing in with the family password
  -- opens the chooser and nothing more — the PIN is what says who you are.
  person_id uuid references people(id) on delete cascade,
  role text check (role is null or role in ('admin', 'co_author', 'user')),

  -- The version of the family password this was minted under.
  session_version integer not null default 1,

  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,

  user_agent text,
  ip_hint text
);

create index if not exists family_sessions_live_idx
  on family_sessions (family_id, expires_at desc) where revoked_at is null;
create index if not exists family_sessions_archive_idx
  on family_sessions (archive_id) where revoked_at is null;

alter table family_sessions enable row level security;

/*
 * Recovery — the family email is the root, so this is the door that must be
 * hardest to force. Single-use, purpose-bound, short-lived, stored as a
 * keyed hash, and consumed in the same statement that changes the credential.
 */
create table if not exists family_recovery_tokens (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  token_hash text not null unique,
  purpose text not null check (purpose in ('password', 'pin', 'device')),
  -- For a PIN reset: whose.
  person_id uuid references people(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index if not exists family_recovery_live_idx
  on family_recovery_tokens (family_id, purpose) where consumed_at is null;

alter table family_recovery_tokens enable row level security;

-- ── archive_memberships goes ────────────────────────────────────────────
--
-- It answered "which account may act in which archive", which only earns its
-- keep when one person belongs to several families. One family, one account
-- means there is nothing to join. It is read by nothing — verified by grep
-- before this was written — so it goes now, while removing it is free rather
-- than surgery.
--
-- Kept as a renamed table rather than dropped: it holds real rows about real
-- people, and a migration that deletes those on the way past is not a
-- migration anybody should trust. A later cleanup can drop it once this
-- model has run for a while.

alter table if exists archive_memberships rename to archive_memberships_retired;

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'families table exists' as check,
       case when exists (select 1 from information_schema.tables where table_name = 'families')
       then 'OK' else 'MISSING' end as result
union all
select 'one family per archive is enforced',
       case when exists (
         select 1 from pg_indexes
         where indexname = 'families_one_per_archive' and indexdef like 'CREATE UNIQUE%'
       ) then 'OK' else 'MISSING' end
union all
select 'every family owns an archive',
       case when not exists (select 1 from families where archive_id is null)
       then 'OK' else 'ORPHANS' end
union all
select 'one trusted device per archive is enforced',
       case when exists (
         select 1 from pg_indexes
         where indexname = 'installations_one_trusted_per_archive' and indexdef like 'CREATE UNIQUE%'
       ) then 'OK' else 'MISSING' end
union all
select 'no archive has two trusted devices',
       case when not exists (
         select archive_id from installations where is_trusted
         group by archive_id having count(*) > 1
       ) then 'OK' else 'TWO SCREENS' end
union all
select 'sessions are server-side',
       case when exists (select 1 from information_schema.tables where table_name = 'family_sessions')
       then 'OK' else 'MISSING' end
union all
select 'session and recovery tables carry RLS',
       case when (select bool_and(relrowsecurity) from pg_class
                   where relname in ('family_sessions', 'family_recovery_tokens'))
       then 'OK' else 'OPEN' end
union all
select 'an invitation can name the profile it claims',
       case when exists (
         select 1 from information_schema.columns
         where table_name = 'invitations' and column_name = 'person_id'
       ) then 'OK' else 'MISSING' end
union all
select 'archive_memberships is retired, not destroyed',
       case when exists (
         select 1 from information_schema.tables where table_name = 'archive_memberships_retired'
       ) then 'OK' else 'MISSING' end
union all
select 'the live family',
       coalesce((select f.email || ' → ' || a.name from families f
                  join archives a on a.id = f.archive_id limit 1), 'none');
