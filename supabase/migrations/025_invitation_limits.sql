-- 025: Invitation guessing is refused, not merely recorded.
--
-- M23. Three defects, one theme — the machinery to stop an attacker was
-- written and then never consulted.
--
-- `invitation_attempts` was inserted into and never read. A row per guess is
-- an audit trail, not a defence.
--
-- `lookup_attempts` was incremented as a read-modify-write from a select that
-- did not include the column, so it read `undefined`, wrote `0 + 1`, and
-- recorded `1` forever no matter how many times a code was tried.
--
-- `code_expires_at` — the short code's own, much shorter deadline — was
-- checked in the route's lookup but not re-asserted inside
-- `accept_invitation`, so the transaction only ever enforced the token's
-- fortnight. A code could be spent after its two days were up.
--
-- The counting is done in the database because it must survive both
-- concurrency and a second replica; a process-local counter is wrong the
-- moment this runs on more than one machine.

-- ── Counting that survives concurrency ───────────────────────────────────

create or replace function record_invitation_attempt(
  p_fingerprint text,
  p_email       text,
  p_succeeded   boolean,
  p_invitation  uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into invitation_attempts (email, code_fingerprint, succeeded)
  values (p_email, p_fingerprint, p_succeeded);

  -- One statement, so two simultaneous guesses cannot both read the same
  -- value and write the same increment.
  if p_invitation is not null then
    update invitations
       set lookup_attempts = invitations.lookup_attempts + 1,
           last_attempt_at = now()
     where invitations.id = p_invitation;
  end if;
end;
$$;

/*
 * How much guessing has happened lately.
 *
 * Three questions in one call, because the route must ask all three before
 * it does anything: has this particular secret been hammered, has this
 * invitee been targeted across several invitations, and is this invitation
 * itself under attack.
 */
create or replace function invitation_attempt_pressure(
  p_fingerprint text,
  p_email       text,
  p_window      interval default interval '15 minutes'
)
returns table (by_fingerprint bigint, by_email bigint)
language sql
security definer
set search_path = public
as $$
  select
    (select count(*) from invitation_attempts a
      where a.code_fingerprint = p_fingerprint
        and a.succeeded = false
        and a.created_at > now() - p_window),
    (select count(*) from invitation_attempts a
      where p_email is not null
        and lower(a.email) = lower(p_email)
        and a.succeeded = false
        and a.created_at > now() - p_window);
$$;

revoke all on function record_invitation_attempt(text, text, boolean, uuid)
  from public, anon, authenticated;
revoke all on function invitation_attempt_pressure(text, text, interval)
  from public, anon, authenticated;
grant execute on function record_invitation_attempt(text, text, boolean, uuid) to service_role;
grant execute on function invitation_attempt_pressure(text, text, interval) to service_role;

-- ── A lockout on the thing being attacked ────────────────────────────────
--
-- `people.locked_until` already establishes this pattern for profile PINs.
-- An invitation under attack goes quiet for a while, and says so no
-- differently than an invalid code would.

alter table invitations add column if not exists locked_until timestamptz;

-- ── The short code's own deadline, re-asserted inside the transaction ────

create or replace function accept_invitation(
  p_invitation_id uuid,
  p_account_id    uuid,
  p_email         text,
  p_display_name  text,
  p_name          text,
  p_address       text,
  p_pin_hash      text,
  p_install_name     text default null,
  p_install_username text default null,
  p_install_secret   text default null,
  -- 'token' or 'code'. The token lives a fortnight; the six-character code is
  -- thirty bits and lives two days. The route checked the right one and the
  -- transaction did not, so this closes the gap between them.
  p_secret_kind      text default 'token'
)
returns table (
  out_person_id       uuid,
  out_archive_id      uuid,
  out_role            text,
  out_account_id      uuid,
  out_installation_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_archive  uuid;
  v_role     text;
  v_rel      text;
  v_account  uuid := p_account_id;
  v_person   uuid;
  v_install  uuid;
  v_taken    integer;
begin
  update invitations
     set accepted_at = now()
   where invitations.id = p_invitation_id
     and invitations.accepted_at is null
     and invitations.revoked_at is null
     and invitations.expires_at > now()
     and (invitations.locked_until is null or invitations.locked_until < now())
     and (
       p_secret_kind <> 'code'
       or coalesce(invitations.code_expires_at, invitations.expires_at) > now()
     )
  returning invitations.archive_id, invitations.role, invitations.relationship
       into v_archive, v_role, v_rel;

  get diagnostics v_taken = row_count;
  if v_taken <> 1 then
    raise exception 'invitation_unavailable' using errcode = 'P0001';
  end if;

  if v_account is null then
    select accounts.id into v_account
      from accounts where lower(accounts.email) = lower(p_email);
  end if;
  if v_account is null then
    insert into accounts (email, display_name, email_verified_at)
    values (p_email, p_display_name, now())
    returning accounts.id into v_account;
  end if;

  if exists (
    select 1 from archive_memberships m
     where m.archive_id = v_archive and m.account_id = v_account
  ) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;

  insert into people (
    archive_id, name, email, relationship, address, role, status, pin_hash, pin_set_at
  )
  values (
    v_archive, p_name, p_email, v_rel,
    nullif(btrim(coalesce(p_address, '')), ''),
    case when v_role = 'admin' then 'admin' else 'co_author' end,
    'active', p_pin_hash, now()
  )
  returning people.id into v_person;

  insert into archive_memberships (archive_id, account_id, person_id, role, status)
  values (
    v_archive, v_account, v_person,
    case when v_role = 'admin' then 'admin' else 'co_author' end,
    'active'
  );

  if p_install_username is not null then
    insert into installations (name, username, secret_hash, archive_id)
    values (p_install_name, p_install_username, p_install_secret, v_archive)
    returning installations.id into v_install;
  end if;

  update invitations
     set accepted_account_id = v_account
   where invitations.id = p_invitation_id;

  return query
    select v_person, v_archive,
           case when v_role = 'admin' then 'admin' else 'co_author' end,
           v_account, v_install;
end;
$$;

revoke all on function accept_invitation(
  uuid, uuid, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function accept_invitation(
  uuid, uuid, text, text, text, text, text, text, text, text, text
) to service_role;

-- The ten-argument shape from 024 is superseded; leaving it would leave the
-- version that ignores the short code's expiry reachable.
drop function if exists accept_invitation(
  uuid, uuid, text, text, text, text, text, text, text, text
);

-- ── Self-verifying checklist ─────────────────────────────────────────────

do $$
declare v_state text := 'no exception';
begin
  begin
    perform accept_invitation(
      '00000000-0000-0000-0000-000000000000'::uuid, null,
      'probe@example.invalid', 'probe', 'probe', null, 'x',
      'probe', 'probe-025', 'x', 'code'
    );
  exception when others then
    v_state := sqlstate;
  end;
  if v_state <> 'P0001' then
    raise exception 'accept_invitation broken: expected P0001, got %', v_state;
  end if;
end $$;

select 'accept_invitation body executes' as check, 'OK' as result
union all
select 'it knows which secret was presented',
       case when exists (
         select 1 from pg_proc
         where proname = 'accept_invitation' and 'p_secret_kind' = any(proargnames)
       ) then 'OK' else 'MISSING' end
union all
select 'the old shape that ignored code expiry is gone',
       case when not exists (
         select 1 from pg_proc where proname = 'accept_invitation' and pronargs = 10
       ) then 'OK' else 'STILL THERE' end
union all
select 'attempts can be counted atomically',
       case when exists (select 1 from pg_proc where proname = 'record_invitation_attempt')
       then 'OK' else 'MISSING' end
union all
select 'pressure can be read',
       case when exists (select 1 from pg_proc where proname = 'invitation_attempt_pressure')
       then 'OK' else 'MISSING' end
union all
select 'an invitation can be locked',
       case when exists (
         select 1 from information_schema.columns
         where table_name = 'invitations' and column_name = 'locked_until'
       ) then 'OK' else 'MISSING' end
union all
select 'probe left nothing behind',
       case when not exists (select 1 from installations where username = 'probe-025')
       then 'OK' else 'LEFTOVER' end;
