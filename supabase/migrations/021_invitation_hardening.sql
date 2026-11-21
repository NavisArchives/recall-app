-- 021: Invitations get a real secret, and acceptance stops racing.
--
-- M16. Two defects.
--
-- The six-character code is about 30 bits, and it lived for a fortnight. The
-- primary path is now a 128-bit token in a link; the short code remains only
-- so somebody can read it aloud to an aunt, and its life drops to two days.
-- Both are stored as keyed HMACs (the pepper lives in the environment), so a
-- stolen `invitations` table can no longer be matched against a precomputed
-- dictionary of every possible code.
--
-- Acceptance checked "unused, unrevoked, unexpired" in a read and then wrote
-- by id alone, so two callers could both pass the check, and an invitation
-- revoked in flight was accepted anyway. `accept_invitation` re-asserts every
-- condition inside the write and creates the person and membership in the
-- same transaction — the loser leaves nothing behind.

alter table invitations add column if not exists token_hash text;
alter table invitations add column if not exists code_expires_at timestamptz;
alter table invitations add column if not exists lookup_attempts integer not null default 0;
alter table invitations add column if not exists last_attempt_at timestamptz;

create unique index if not exists invitations_token_hash_idx
  on invitations (token_hash)
  where token_hash is not null;

-- Existing invitations keep working by their code until they expire; they
-- simply have no link, which is what they were sent with.
update invitations
   set code_expires_at = expires_at
 where code_expires_at is null;

/*
 * Guessing is tracked per code and per email, not only per IP: a distributed
 * attempt is invisible in per-IP counts and obvious here.
 */
create table if not exists invitation_attempts (
  id uuid primary key default gen_random_uuid(),
  email text,
  code_fingerprint text not null,
  succeeded boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists invitation_attempts_recent_idx
  on invitation_attempts (code_fingerprint, created_at desc);
create index if not exists invitation_attempts_email_idx
  on invitation_attempts (lower(email), created_at desc);

alter table invitation_attempts enable row level security;

-- ── Acceptance, in one transaction ───────────────────────────────────────

create or replace function accept_invitation(
  p_invitation_id uuid,
  p_account_id    uuid,
  p_email         text,
  p_display_name  text,
  p_name          text,
  p_address       text,
  p_pin_hash      text
)
returns table (person_id uuid, archive_id uuid, role text, account_id uuid)
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

  update invitations set accepted_account_id = v_account where id = p_invitation_id;

  return query
    select v_person, v_archive,
           case when v_role = 'admin' then 'admin' else 'co_author' end,
           v_account;
end;
$$;

revoke all on function accept_invitation(uuid, uuid, text, text, text, text, text)
  from public, anon, authenticated;

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'token column' as check,
       case when exists (
         select 1 from information_schema.columns
         where table_name = 'invitations' and column_name = 'token_hash'
       ) then 'OK' else 'MISSING' end as result
union all
select 'separate code expiry',
       case when exists (
         select 1 from information_schema.columns
         where table_name = 'invitations' and column_name = 'code_expires_at'
       ) then 'OK' else 'MISSING' end
union all
select 'attempt tracking table',
       case when exists (
         select 1 from information_schema.tables where table_name = 'invitation_attempts'
       ) then 'OK' else 'MISSING' end
union all
select 'attempts table has RLS',
       case when (select relrowsecurity from pg_class where relname = 'invitation_attempts')
       then 'OK' else 'OPEN' end
union all
select 'accept_invitation exists',
       case when exists (select 1 from pg_proc where proname = 'accept_invitation')
       then 'OK' else 'MISSING' end
union all
select 'accept_invitation not callable by anon',
       case when not has_function_privilege('anon', 'accept_invitation(uuid, uuid, text, text, text, text, text)', 'execute')
       then 'OK' else 'EXPOSED' end
union all
select 'every live invitation has a code expiry',
       case when not exists (
         select 1 from invitations where accepted_at is null and code_expires_at is null
       ) then 'OK' else 'MISSING' end;
