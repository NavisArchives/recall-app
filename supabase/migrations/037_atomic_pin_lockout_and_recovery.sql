-- 037 — The lockout counter and the recovery become single database moves
--
-- Two read-modify-write seams, one theme: a decision that must be atomic was
-- being assembled in the application out of parts that could interleave.
--
-- **The PIN counter.** A failed PIN read `failed_pin_attempts`, added one in
-- JavaScript, and wrote the sum back — in both places that verify a PIN (the
-- household unlock and the remote chooser's enter). Two wrong guesses arriving
-- together each read the same value and each wrote the same sum, so five
-- attempts could cost an attacker more than five guesses. The counting moves
-- into one UPDATE, where two simultaneous statements queue on the row lock and
-- each one's increment lands. The same statement decides the lockout, so the
-- threshold cannot be raced past either.
--
-- **The recovery.** `/recover/complete` consumed the token in one statement
-- and set the password in a second. Between them sat a failure mode that costs
-- a family their way back in: token spent, password not set, link dead, inbox
-- empty. Consuming, setting, and revoking every session now happen inside one
-- function — one transaction — so a recovery either completes whole or leaves
-- the link alive to try again.
--
-- Both functions are service_role-only, like every function before them: the
-- backend is the only caller, and RLS keeps everyone else out of the tables.

-- ── One statement counts, and decides ────────────────────────────────────

create or replace function record_pin_failure(
  p_person  uuid,
  p_archive uuid,
  p_max     integer,
  p_lockout interval
)
returns table (locked boolean)
language sql
security definer
set search_path = public
as $$
  update people
     set failed_pin_attempts = case
           when people.failed_pin_attempts + 1 >= p_max then 0
           else people.failed_pin_attempts + 1
         end,
         locked_until = case
           when people.failed_pin_attempts + 1 >= p_max then now() + p_lockout
           else people.locked_until
         end
   where people.id = p_person
     and people.archive_id = p_archive
  returning (people.locked_until is not null and people.locked_until > now());
$$;

revoke all on function record_pin_failure(uuid, uuid, integer, interval)
  from public, anon, authenticated;
grant execute on function record_pin_failure(uuid, uuid, integer, interval) to service_role;

-- ── A recovery that completes whole, or not at all ───────────────────────

create or replace function recover_family_password(
  p_token_hash    text,
  p_password_hash text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family uuid;
begin
  -- Consumed conditionally, exactly as the route used to: two requests
  -- racing one link still resolve to one winner, because only one UPDATE
  -- finds the row unconsumed.
  update family_recovery_tokens
     set consumed_at = now()
   where family_recovery_tokens.token_hash = p_token_hash
     and family_recovery_tokens.purpose = 'password'
     and family_recovery_tokens.consumed_at is null
     and family_recovery_tokens.expires_at > now()
  returning family_recovery_tokens.family_id into v_family;

  if v_family is null then
    return null;
  end if;

  update families
     set password_hash = p_password_hash,
         password_set_at = now(),
         -- Raising the version invalidates every session minted under the
         -- old password, immediately, without touching a row each.
         session_version = families.session_version + 1
   where families.id = v_family;

  -- Sign out everywhere: a reset that leaves the old sessions alive has not
  -- recovered anything. In the same transaction, so a failure here hands the
  -- token back too.
  update family_sessions
     set revoked_at = now()
   where family_sessions.family_id = v_family
     and family_sessions.revoked_at is null;

  return v_family;
end;
$$;

revoke all on function recover_family_password(text, text)
  from public, anon, authenticated;
grant execute on function recover_family_password(text, text) to service_role;

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'record_pin_failure exists' as check,
       case when to_regprocedure('record_pin_failure(uuid, uuid, integer, interval)') is not null
            then 'OK' else 'MISSING' end as result
union all
select 'recover_family_password exists',
       case when to_regprocedure('recover_family_password(text, text)') is not null
            then 'OK' else 'MISSING' end
union all
select 'record_pin_failure is service_role only',
       case when not has_function_privilege('anon', 'record_pin_failure(uuid, uuid, integer, interval)', 'execute')
             and has_function_privilege('service_role', 'record_pin_failure(uuid, uuid, integer, interval)', 'execute')
            then 'OK' else 'WRONG GRANTS' end
union all
select 'recover_family_password is service_role only',
       case when not has_function_privilege('anon', 'recover_family_password(text, text)', 'execute')
             and has_function_privilege('service_role', 'recover_family_password(text, text)', 'execute')
            then 'OK' else 'WRONG GRANTS' end;
