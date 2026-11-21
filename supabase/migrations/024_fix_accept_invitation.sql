-- 024: accept_invitation could never run. Not once.
--
-- M22. In plpgsql every column of a `returns table (...)` becomes a variable
-- in scope for the entire body. 022 returns `archive_id`, `role`,
-- `person_id`, `account_id`, `installation_id` — and the first statement in
-- the body did `returning archive_id, role, relationship into ...`, where
-- `archive_id` now meant both the OUT variable and `invitations.archive_id`.
-- Postgres refuses to guess: 42702, raised at resolution time, so it fired on
-- every call before any argument was examined. Every invitation acceptance
-- 500'd.
--
-- `create_household` in 020 escapes by luck alone: all of its `returning`s use
-- `id`, which is not one of its OUT names.
--
-- Two things change here. Every column reference is qualified, so the mistake
-- cannot hide. And the OUT columns are renamed with an `out_` prefix, so the
-- collision is impossible rather than merely avoided — the next person to add
-- a statement to this body should not have to know this story.
--
-- 022 is left untouched: it has been applied, and rewriting an applied
-- migration makes a fresh install diverge from an existing project silently.

drop function if exists accept_invitation(
  uuid, uuid, text, text, text, text, text, text, text, text
);

create function accept_invitation(
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
  -- Consume first, re-asserting every condition the lookup checked. The row
  -- count is the whole answer: zero means somebody else won the race, or the
  -- invitation was revoked between the lookup and here.
  update invitations
     set accepted_at = now()
   where invitations.id = p_invitation_id
     and invitations.accepted_at is null
     and invitations.revoked_at is null
     and invitations.expires_at > now()
  returning invitations.archive_id, invitations.role, invitations.relationship
       into v_archive, v_role, v_rel;

  get diagnostics v_taken = row_count;
  if v_taken <> 1 then
    raise exception 'invitation_unavailable' using errcode = 'P0001';
  end if;

  -- One account per email, across every archive they will ever help with.
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

-- Housekeeping the review asked for: the revokes in 020–022 never touched
-- service_role (Supabase grants it EXECUTE on new public functions by
-- default), but saying so explicitly beats depending on a project default.
revoke all on function accept_invitation(
  uuid, uuid, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function accept_invitation(
  uuid, uuid, text, text, text, text, text, text, text, text
) to service_role;
grant execute on function create_household(
  text, text, text, text, text, text, text, text, date, text, text, text, text
) to service_role;

-- ── Self-verifying checklist ─────────────────────────────────────────────
--
-- Existence is not the property that failed. These prove the body *runs*: a
-- call with an id that matches nothing must reach the function's own refusal
-- (P0001) rather than dying at resolution (42702).

do $$
declare
  v_state text := 'no exception';
begin
  begin
    perform accept_invitation(
      '00000000-0000-0000-0000-000000000000'::uuid, null,
      'probe@example.invalid', 'probe', 'probe', null, 'x',
      'probe', 'probe-checklist', 'x'
    );
  exception when others then
    v_state := sqlstate;
  end;

  if v_state <> 'P0001' then
    raise exception 'accept_invitation still broken: expected P0001, got %', v_state;
  end if;
  raise notice 'accept_invitation reached its own refusal (P0001)';
end $$;

select 'accept_invitation body executes' as check, 'OK' as result
union all
select 'no OUT column collides with a table column',
       case when not exists (
         select 1 from unnest(array['person_id','archive_id','role','account_id','installation_id']) c
         where c in (
           select column_name from information_schema.columns
            where table_name in ('invitations','people','accounts','installations','archive_memberships')
         ) and c in (
           select unnest(proargnames) from pg_proc where proname = 'accept_invitation'
         )
       ) then 'OK' else 'STILL COLLIDES' end
union all
select 'service_role may execute both functions',
       case when has_function_privilege('service_role', 'accept_invitation(uuid, uuid, text, text, text, text, text, text, text, text)', 'execute')
             and has_function_privilege('service_role', 'create_household(text, text, text, text, text, text, text, text, date, text, text, text, text)', 'execute')
       then 'OK' else 'MISSING' end
union all
select 'nothing was consumed by the probe',
       case when not exists (
         select 1 from installations where username = 'probe-checklist'
       ) then 'OK' else 'LEFTOVER' end;
