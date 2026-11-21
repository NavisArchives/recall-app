-- 022: Joining an archive includes the browser it was joined from.
--
-- 021 made acceptance atomic, but the installation was still created after
-- the transaction committed — the same half-success M15 removed from signup:
-- if it failed, the joiner got a profile cookie, no device cookie, a welcome
-- screen, and a refusal on their next request. It belongs inside.

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
  p_install_secret   text default null
)
returns table (person_id uuid, archive_id uuid, role text, account_id uuid, installation_id uuid)
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
  -- Consume first, re-asserting every condition the lookup checked. The row
  -- count is the whole answer: zero means somebody else won the race, or the
  -- invitation was revoked between the lookup and here.
  update invitations
     set accepted_at = now()
   where id = p_invitation_id
     and accepted_at is null
     and revoked_at is null
     and expires_at > now()
  returning archive_id, role, relationship into v_archive, v_role, v_rel;

  get diagnostics v_taken = row_count;
  if v_taken <> 1 then
    raise exception 'invitation_unavailable' using errcode = 'P0001';
  end if;

  -- One account per email, across every archive they will ever help with.
  if v_account is null then
    select id into v_account from accounts where lower(email) = lower(p_email);
  end if;
  if v_account is null then
    insert into accounts (email, display_name, email_verified_at)
    values (p_email, p_display_name, now())
    returning id into v_account;
  end if;

  if exists (
    select 1 from archive_memberships
     where archive_id = v_archive and account_id = v_account
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
  returning id into v_person;

  insert into archive_memberships (archive_id, account_id, person_id, role, status)
  values (
    v_archive, v_account, v_person,
    case when v_role = 'admin' then 'admin' else 'co_author' end,
    'active'
  );

  if p_install_username is not null then
    insert into installations (name, username, secret_hash, archive_id)
    values (p_install_name, p_install_username, p_install_secret, v_archive)
    returning id into v_install;
  end if;

  update invitations set accepted_account_id = v_account where id = p_invitation_id;

  return query
    select v_person, v_archive,
           case when v_role = 'admin' then 'admin' else 'co_author' end,
           v_account, v_install;
end;
$$;

revoke all on function accept_invitation(
  uuid, uuid, text, text, text, text, text, text, text, text
) from public, anon, authenticated;

-- The seven-argument shape from 021 is gone: nothing should call it now, and
-- leaving it would leave the half-success path reachable.
drop function if exists accept_invitation(uuid, uuid, text, text, text, text, text);

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'accept_invitation takes the installation' as check,
       case when exists (
         select 1 from pg_proc
         where proname = 'accept_invitation' and pronargs = 10
       ) then 'OK' else 'MISSING' end as result
union all
select 'old seven-argument version is gone',
       case when not exists (
         select 1 from pg_proc where proname = 'accept_invitation' and pronargs = 7
       ) then 'OK' else 'STILL THERE' end
union all
select 'not callable by anon',
       case when not has_function_privilege('anon', 'accept_invitation(uuid, uuid, text, text, text, text, text, text, text, text)', 'execute')
       then 'OK' else 'EXPOSED' end;
