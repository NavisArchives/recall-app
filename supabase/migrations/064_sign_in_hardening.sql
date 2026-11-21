-- 064 — Sign-in hardening: a per-family password lockout, the owner's second
-- factor, and a PIN lockout that escalates
--
-- Three doors, one weakness each (security review, 29 Sep 2026).
--
-- **The family password had no per-account limit** (authn-3, edge-2). The
-- only brake on /login and /pair-screen was express-rate-limit: in memory, per
-- IP, per Cloud Run instance. Twenty tries per address per quarter hour is no
-- limit at all to somebody with many addresses, and it resets whenever an
-- instance does. PINs have had a database counter since 037; the password,
-- which opens more, had none. `failed_password_attempts` counts wrong
-- passwords against the family row itself, so the count is shared by every
-- instance and every address. Ten in a row lock the password for fifteen
-- minutes, and each consecutive lock doubles, up to a day. A right password
-- resets both counters. While locked the backend does not check the password
-- at all, and answers exactly as it does for a wrong one — so the lock itself
-- says nothing about whether an address belongs to a family.
--
-- Each attempt is CLAIMED before the password is checked
-- (`begin_family_password_attempt`): one locked statement counts it and says
-- whether it may be checked at all. Counting afterwards let a burst of guesses
-- in flight together all read the row before the tenth failure landed, so all
-- of them met the real hash; and it put a write on a known family's wrong
-- password that an unknown address never made, which the response time could
-- tell apart. The backend claims with a nil id for an address that is not a
-- family's, so both cost the same one statement. A right password afterwards
-- resets the count its own claim added.
--
-- A known trade-off, accepted: failures are counted against the family,
-- whoever sends them, so anybody who knows a family's address — or the
-- platform owner's — can keep its password locked. The display is never
-- behind it (it runs on its own device cookie). The way out is recovery: a
-- completed /recover clears the lock and leaves that browser a day-long,
-- signed `recall_recovered` cookie whose next sign-in is checked past a lock
-- re-armed in the meantime (services/familyAuth.ts).
--
-- **The platform owner's cross-family surface rested on one password**
-- (access-5). `owner_totp_secret` holds an authenticator-app secret, sealed
-- with AES-GCM under a key derived from CODE_PEPPER (services/totp.ts), so a
-- copy of this table does not hand out codes. `owner_totp_enabled_at` is null
-- until enrollment is confirmed with a first good code; only then does
-- /login ask for one. `owner_totp_last_step` is the last 30-second step that
-- was accepted, so a code seen over a shoulder cannot be replayed inside its
-- own window.
--
-- **The PIN lockout reopened every fifteen minutes** (authn-8). 037 reset the
-- attempt count at the moment it locked, so five fresh guesses came back
-- every quarter hour: about 480 a day against one profile, forever.
-- `pin_lock_count` counts consecutive locks; each one doubles the next, up to
-- a day, and a right PIN (or an admin clearing the lock) starts it again.
--
-- `record_pin_failure` changes shape, so it is dropped and recreated rather
-- than replaced: it gains `p_ceiling` (with a default, so a backend still
-- sending the four arguments of 037 keeps working through the deploy) and
-- returns the lock count beside `locked`. Every new function is service_role
-- only, like every function before it.

-- ── The family password's counter ────────────────────────────────────────

alter table families
  add column if not exists failed_password_attempts integer not null default 0,
  add column if not exists password_locked_until timestamptz,
  add column if not exists password_lock_count integer not null default 0;

comment on column families.failed_password_attempts is
  'Wrong family passwords since the last right one or the last lock (064).';
comment on column families.password_locked_until is
  'The family password is not checked before this instant (064).';
comment on column families.password_lock_count is
  'Consecutive password locks; each doubles the next, up to a day. Reset by a right password (064).';

-- ── The platform owner's second factor ───────────────────────────────────

alter table families
  add column if not exists owner_totp_secret text,
  add column if not exists owner_totp_enabled_at timestamptz,
  add column if not exists owner_totp_last_step bigint;

comment on column families.owner_totp_secret is
  'Authenticator secret, sealed with services/totp.ts sealTotpSecret. Never readable on its own (064).';
comment on column families.owner_totp_enabled_at is
  'Null until enrollment is confirmed; once set, /login asks for a code (064).';
comment on column families.owner_totp_last_step is
  'Last accepted TOTP step. A code at or before it is a replay and is refused (064).';

-- ── The PIN lockout's memory ─────────────────────────────────────────────

alter table people
  add column if not exists pin_lock_count integer not null default 0;

comment on column people.pin_lock_count is
  'Consecutive PIN locks; each doubles the next, up to a day. Reset by a right PIN (064).';

-- ── One statement counts a wrong password, and decides ───────────────────

create or replace function record_family_password_failure(
  p_family  uuid,
  p_max     integer,
  p_lockout interval,
  p_ceiling interval
)
returns table (locked boolean, lock_count integer)
language sql
security definer
set search_path = public
as $$
  -- Every right-hand side reads the row as it was before this statement, so
  -- the count, the lock and its length are decided from one consistent view.
  -- The exponent is capped well before it could overflow; the ceiling is
  -- what actually bounds the lock.
  update families
     set failed_password_attempts = case
           when families.failed_password_attempts + 1 >= p_max then 0
           else families.failed_password_attempts + 1
         end,
         password_lock_count = case
           when families.failed_password_attempts + 1 >= p_max then families.password_lock_count + 1
           else families.password_lock_count
         end,
         password_locked_until = case
           when families.failed_password_attempts + 1 >= p_max
             then now() + least(p_ceiling, p_lockout * power(2, least(families.password_lock_count, 16)))
           else families.password_locked_until
         end
   where families.id = p_family
  returning (families.password_locked_until is not null and families.password_locked_until > now()),
            families.password_lock_count;
$$;

revoke all on function record_family_password_failure(uuid, integer, interval, interval)
  from public, anon, authenticated;
grant execute on function record_family_password_failure(uuid, integer, interval, interval) to service_role;

-- ── One statement claims an attempt, before it is checked ────────────────

create or replace function begin_family_password_attempt(
  p_family  uuid,
  p_max     integer,
  p_lockout interval,
  p_ceiling interval
)
returns table (allowed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts     integer;
  v_locked_until timestamptz;
  v_lock_count   integer;
begin
  -- The row lock makes simultaneous claims take turns, so each one sees the
  -- count the one before it left.
  select f.failed_password_attempts, f.password_locked_until, f.password_lock_count
    into v_attempts, v_locked_until, v_lock_count
    from families f
   where f.id = p_family
     for update;

  -- No such family (the backend's nil id for an unknown address): no row,
  -- and the caller answers as it would for a wrong password.
  if not found then
    return;
  end if;

  -- Locked: not checked, and not counted — a lock is not extended by the
  -- guesses it is refusing.
  if v_locked_until is not null and v_locked_until > now() then
    return query select false;
    return;
  end if;

  -- The attempt that reaches the limit is still checked; it is what locks.
  if v_attempts + 1 >= p_max then
    update families
       set failed_password_attempts = 0,
           password_lock_count = v_lock_count + 1,
           password_locked_until = now() + least(p_ceiling, p_lockout * power(2, least(v_lock_count, 16)))
     where id = p_family;
  else
    update families
       set failed_password_attempts = v_attempts + 1
     where id = p_family;
  end if;

  return query select true;
end;
$$;

revoke all on function begin_family_password_attempt(uuid, integer, interval, interval)
  from public, anon, authenticated;
grant execute on function begin_family_password_attempt(uuid, integer, interval, interval) to service_role;

-- ── The PIN counter, escalating ──────────────────────────────────────────

drop function if exists record_pin_failure(uuid, uuid, integer, interval);

-- `or replace` so a second run of this file (the five-argument form already
-- there) replaces it rather than failing half-way.
create or replace function record_pin_failure(
  p_person  uuid,
  p_archive uuid,
  p_max     integer,
  p_lockout interval,
  p_ceiling interval default interval '24 hours'
)
returns table (locked boolean, lock_count integer)
language sql
security definer
set search_path = public
as $$
  update people
     set failed_pin_attempts = case
           when people.failed_pin_attempts + 1 >= p_max then 0
           else people.failed_pin_attempts + 1
         end,
         pin_lock_count = case
           when people.failed_pin_attempts + 1 >= p_max then people.pin_lock_count + 1
           else people.pin_lock_count
         end,
         locked_until = case
           when people.failed_pin_attempts + 1 >= p_max
             then now() + least(p_ceiling, p_lockout * power(2, least(people.pin_lock_count, 16)))
           else people.locked_until
         end
   where people.id = p_person
     and people.archive_id = p_archive
  returning (people.locked_until is not null and people.locked_until > now()),
            people.pin_lock_count;
$$;

revoke all on function record_pin_failure(uuid, uuid, integer, interval, interval)
  from public, anon, authenticated;
grant execute on function record_pin_failure(uuid, uuid, integer, interval, interval) to service_role;

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'password counter columns exist' as check,
       case when (select count(*) from information_schema.columns
                  where table_schema = 'public' and table_name = 'families'
                    and column_name in ('failed_password_attempts', 'password_locked_until', 'password_lock_count')) = 3
            then 'OK' else 'MISSING' end as result
union all
select 'owner second-factor columns exist',
       case when (select count(*) from information_schema.columns
                  where table_schema = 'public' and table_name = 'families'
                    and column_name in ('owner_totp_secret', 'owner_totp_enabled_at', 'owner_totp_last_step')) = 3
            then 'OK' else 'MISSING' end
union all
select 'people.pin_lock_count exists',
       case when exists (select 1 from information_schema.columns
                         where table_schema = 'public' and table_name = 'people'
                           and column_name = 'pin_lock_count')
            then 'OK' else 'MISSING' end
union all
select 'record_family_password_failure exists',
       case when to_regprocedure('record_family_password_failure(uuid, integer, interval, interval)') is not null
            then 'OK' else 'MISSING' end
union all
select 'begin_family_password_attempt exists',
       case when to_regprocedure('begin_family_password_attempt(uuid, integer, interval, interval)') is not null
            then 'OK' else 'MISSING' end
union all
select 'begin_family_password_attempt is service_role only',
       case when not has_function_privilege('anon', 'begin_family_password_attempt(uuid, integer, interval, interval)', 'execute')
             and not has_function_privilege('authenticated', 'begin_family_password_attempt(uuid, integer, interval, interval)', 'execute')
             and has_function_privilege('service_role', 'begin_family_password_attempt(uuid, integer, interval, interval)', 'execute')
            then 'OK' else 'WRONG GRANTS' end
union all
select 'record_pin_failure takes a ceiling',
       case when to_regprocedure('record_pin_failure(uuid, uuid, integer, interval, interval)') is not null
            then 'OK' else 'MISSING' end
union all
select 'the four-argument record_pin_failure is gone',
       case when to_regprocedure('record_pin_failure(uuid, uuid, integer, interval)') is null
            then 'OK' else 'STILL PRESENT (ambiguous overload)' end
union all
select 'record_family_password_failure is service_role only',
       case when not has_function_privilege('anon', 'record_family_password_failure(uuid, integer, interval, interval)', 'execute')
             and not has_function_privilege('authenticated', 'record_family_password_failure(uuid, integer, interval, interval)', 'execute')
             and has_function_privilege('service_role', 'record_family_password_failure(uuid, integer, interval, interval)', 'execute')
            then 'OK' else 'WRONG GRANTS' end
union all
select 'record_pin_failure is service_role only',
       case when not has_function_privilege('anon', 'record_pin_failure(uuid, uuid, integer, interval, interval)', 'execute')
             and not has_function_privilege('authenticated', 'record_pin_failure(uuid, uuid, integer, interval, interval)', 'execute')
             and has_function_privilege('service_role', 'record_pin_failure(uuid, uuid, integer, interval, interval)', 'execute')
            then 'OK' else 'WRONG GRANTS' end
union all
select 'families still has RLS on',
       case when (select relrowsecurity from pg_class where oid = 'public.families'::regclass)
            then 'OK' else 'RLS OFF' end
union all
select 'people still has RLS on',
       case when (select relrowsecurity from pg_class where oid = 'public.people'::regclass)
            then 'OK' else 'RLS OFF' end;
