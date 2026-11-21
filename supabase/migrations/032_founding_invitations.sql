-- 032 — The front door: founding invitations and the people asking for one (M44)
--
-- Today `POST /sign-up` is open to whoever finds it: anyone can create a
-- family on this platform. That is fine for one archive and wrong the moment
-- there are strangers, so family creation becomes something the platform
-- owner grants, one single-use token at a time.
--
-- Two tables, and they are not the same thing:
--
--   `founding_invitations` — a token the platform owner minted, which creates
--     a family when it is spent. Consumed inside the same transaction that
--     creates the family, so a token cannot be spent twice by two browsers.
--
--   `invitation_requests` — somebody asking to be let in. Public, so it is
--     written to by strangers and holds nothing but an address and a note.
--     Never a credential; asking is not being granted.
--
-- The token here is a *founder* token, hashed under its own HMAC domain in
-- `inviteCodes.ts`. It cannot be spent as a member invitation and a member
-- invitation cannot be spent here — not because a route checks, but because
-- the hashes cannot match.

create table if not exists founding_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  note text,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  -- Who it became, once spent. Null until then.
  accepted_at timestamptz,
  accepted_family_id uuid references families(id) on delete set null,
  revoked_at timestamptz
);

alter table founding_invitations enable row level security;

comment on table founding_invitations is
  'Single-use tokens that permit creating a family. Minted by the platform '
  'owner only; consumed inside create_household. Never interchangeable with '
  'invitations (member invites) — different HMAC domain.';

-- One live founding invitation per address, so re-inviting somebody replaces
-- rather than stacks. Same shape as the member-invitation index.
create unique index if not exists founding_invitations_one_live_per_email
  on founding_invitations (lower(email))
  where accepted_at is null and revoked_at is null;

create index if not exists founding_invitations_by_state
  on founding_invitations (created_at desc);

create table if not exists invitation_requests (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text,
  note text,
  created_at timestamptz not null default now(),
  -- 'pending' until the platform owner acts on it.
  status text not null default 'pending' check (status in ('pending', 'invited', 'dismissed')),
  handled_at timestamptz
);

alter table invitation_requests enable row level security;

comment on table invitation_requests is
  'Public "request an invitation" submissions. Holds an address and a note '
  'and nothing else — asking is not being granted.';

-- Asking twice is not an error and must not be reported as one: the public
-- route answers identically either way (M19), so the second request simply
-- updates the first rather than colliding.
create unique index if not exists invitation_requests_one_per_email
  on invitation_requests (lower(email));

-- ── Signup requires a founding token ─────────────────────────────────────
--
-- The check happens *inside* the transaction, next to where the receipt is
-- spent, for the same reason the receipt is: a token verified by the route
-- and consumed later is a token two browsers can both verify.

create or replace function create_household(
  p_receipt_hash    text,
  p_email           text,
  p_display_name    text,
  p_admin_name      text,
  p_admin_pin_hash  text,
  p_relationship    text,
  p_about           text,
  p_subject_name    text,
  p_birth_date      date,
  p_residence       text,
  p_install_name    text,
  p_install_username text,
  p_install_secret  text,
  p_password_hash   text default null,
  -- The founding invitation being spent. Optional in the signature so an
  -- older client fails loudly at the check below rather than at the call.
  p_founder_hash    text default null
)
returns table (account_id uuid, archive_id uuid, person_id uuid, installation_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family    uuid;
  v_archive   uuid;
  v_person    uuid;
  v_install   uuid;
  v_spent     integer;
  v_founder   uuid;
  v_first     text := split_part(btrim(p_subject_name), ' ', 1);
begin
  /*
   * The founding invitation, spent first and spent conditionally.
   *
   * Same discipline as the receipt below: a conditional update whose row
   * count is the whole answer, so two browsers holding the same link race
   * here and exactly one wins. Expired, revoked, already-spent and
   * fabricated all fail the same way and raise the same exception as every
   * other signup refusal — the caller cannot tell which it was (M19).
   */
  if p_founder_hash is null then
    raise exception 'signup_refused' using errcode = 'P0001';
  end if;

  update founding_invitations
     set accepted_at = now()
   where founding_invitations.token_hash = p_founder_hash
     and founding_invitations.accepted_at is null
     and founding_invitations.revoked_at is null
     and founding_invitations.expires_at > now()
  returning founding_invitations.id into v_founder;

  if v_founder is null then
    raise exception 'signup_refused' using errcode = 'P0001';
  end if;

  update email_verifications
     set consumed_at = now()
   where email_verifications.receipt_hash = p_receipt_hash
     and email_verifications.email = p_email
     and email_verifications.purpose = 'signup'
     and email_verifications.consumed_at is null
     and email_verifications.receipt_expires_at > now();
  get diagnostics v_spent = row_count;
  if v_spent <> 1 then
    raise exception 'signup_refused' using errcode = 'P0001';
  end if;

  if exists (select 1 from families where lower(families.email) = lower(p_email)) then
    raise exception 'signup_refused' using errcode = 'P0001';
  end if;

  insert into families (email, display_name, email_verified_at, password_hash, password_set_at)
  values (
    p_email, p_display_name, now(), p_password_hash,
    case when p_password_hash is null then null else now() end
  )
  returning families.id into v_family;

  insert into archives (name, owner_account_id)
  values (v_first || '''s archive', v_family)
  returning archives.id into v_archive;

  update families set archive_id = v_archive where families.id = v_family;

  update founding_invitations
     set accepted_family_id = v_family
   where founding_invitations.id = v_founder;

  -- The person who asked is no longer waiting.
  update invitation_requests
     set status = 'invited', handled_at = now()
   where lower(invitation_requests.email) = lower(p_email)
     and invitation_requests.status <> 'invited';

  insert into settings (archive_id, display_name, full_name, birth_date, residence, preferred_language)
  values (v_archive, v_first, p_subject_name, p_birth_date, nullif(btrim(coalesce(p_residence, '')), ''), null);

  insert into people (archive_id, name, email, role, status, relationship, pin_hash, pin_set_at)
  values (
    v_archive, p_admin_name, p_email, 'admin', 'active',
    case when p_about = 'someone' then p_relationship else null end,
    p_admin_pin_hash, now()
  )
  returning people.id into v_person;

  insert into people (archive_id, name, role, status, birthday)
  values (v_archive, p_subject_name, 'user', 'active', p_birth_date);

  insert into installations (name, username, secret_hash, archive_id, is_trusted, trusted_at)
  values (p_install_name, p_install_username, p_install_secret, v_archive, true, now())
  returning installations.id into v_install;

  return query select v_family, v_archive, v_person, v_install;
end;
$$;

revoke all on function create_household(
  text, text, text, text, text, text, text, text, date, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function create_household(
  text, text, text, text, text, text, text, text, date, text, text, text, text, text, text
) to service_role;

-- The fourteen-argument shape created families with no invitation at all.
drop function if exists create_household(
  text, text, text, text, text, text, text, text, date, text, text, text, text, text
);

-- ── Self-verifying checklist ─────────────────────────────────────────────

do $$
declare
  v_receipt text := 'founder-' || gen_random_uuid()::text;
  v_email   text := 'founder-' || gen_random_uuid()::text || '@example.invalid';
  v_token   text := 'founder-hash-' || gen_random_uuid()::text;
  v_invite  uuid;
  v_archive uuid;
  v_state   text;
  r         record;

  procedure_receipt text;
begin
  insert into email_verifications (email, code_hash, expires_at, purpose,
                                   receipt_hash, receipt_expires_at, verified_at)
  values (v_email, 'checklist', now() + interval '1 hour', 'signup',
          v_receipt, now() + interval '1 hour', now());

  -- 1. No founding invitation: refused, and the receipt is not burned.
  begin
    select * into r from create_household(
      v_receipt, v_email, 'F', 'F', 'pin', null, 'someone', 'Founder Subject',
      '1950-01-01', 'Nowhere', 'browser', 'web-' || gen_random_uuid()::text,
      'secret', 'pw', null);
    raise exception 'a family was created with no founding invitation';
  exception when sqlstate 'P0001' then
    null;
  end;

  if exists (select 1 from email_verifications
              where email_verifications.email = v_email
                and email_verifications.consumed_at is not null) then
    raise exception 'a refused signup burned the receipt';
  end if;

  -- 2. A fabricated token is refused exactly the same way.
  begin
    perform create_household(
      v_receipt, v_email, 'F', 'F', 'pin', null, 'someone', 'Founder Subject',
      '1950-01-01', 'Nowhere', 'browser', 'web-' || gen_random_uuid()::text,
      'secret', 'pw', 'not-a-real-token');
    raise exception 'a fabricated founding token was accepted';
  exception when sqlstate 'P0001' then
    null;
  end;

  -- 3. A real one works, once.
  insert into founding_invitations (email, token_hash, expires_at)
  values (v_email, v_token, now() + interval '30 days')
  returning founding_invitations.id into v_invite;

  select archive_id into v_archive from create_household(
    v_receipt, v_email, 'F', 'Founder', 'pin', null, 'someone', 'Founder Subject',
    '1950-01-01', 'Nowhere', 'browser', 'web-' || gen_random_uuid()::text,
    'secret', 'pw', v_token);

  if v_archive is null then
    raise exception 'a valid founding invitation did not create a family';
  end if;

  if not exists (select 1 from founding_invitations
                  where founding_invitations.id = v_invite
                    and founding_invitations.accepted_at is not null
                    and founding_invitations.accepted_family_id is not null) then
    raise exception 'the founding invitation was not consumed';
  end if;

  -- 4. And it cannot be spent again.
  insert into email_verifications (email, code_hash, expires_at, purpose,
                                   receipt_hash, receipt_expires_at, verified_at)
  values (v_email || '.2', 'checklist', now() + interval '1 hour', 'signup',
          v_receipt || '.2', now() + interval '1 hour', now());
  begin
    perform create_household(
      v_receipt || '.2', v_email || '.2', 'F', 'F', 'pin', null, 'someone', 'Second',
      '1950-01-01', 'Nowhere', 'browser', 'web-' || gen_random_uuid()::text,
      'secret', 'pw', v_token);
    raise exception 'a spent founding invitation was accepted a second time';
  exception when sqlstate 'P0001' then
    null;
  end;

  delete from archives where archives.id = v_archive;
  delete from founding_invitations where founding_invitations.id = v_invite;
  delete from families where families.email in (v_email, v_email || '.2');
  delete from email_verifications where email_verifications.email in (v_email, v_email || '.2');
exception when others then
  v_state := sqlerrm;
  delete from archives where archives.id = v_archive;
  delete from founding_invitations where founding_invitations.email = v_email;
  delete from families where families.email in (v_email, v_email || '.2');
  delete from email_verifications where email_verifications.email in (v_email, v_email || '.2');
  raise exception 'founding checklist failed: %', v_state;
end $$;

select 'signup needs a founding invitation, spends it once, and refuses replays' as check,
       'OK' as result
union all
select 'both tables have RLS with no permissive policies',
       case when (
         select count(*) from pg_tables
         where tablename in ('founding_invitations', 'invitation_requests') and rowsecurity
       ) = 2 and not exists (
         select 1 from pg_policies
         where tablename in ('founding_invitations', 'invitation_requests')
       ) then 'OK' else 'EXPOSED' end
union all
select 'one live founding invitation per address',
       case when exists (
         select 1 from pg_indexes where indexname = 'founding_invitations_one_live_per_email'
       ) then 'OK' else 'MISSING' end
union all
select 'service_role may execute the new shape',
       case when has_function_privilege('service_role',
              'create_household(text, text, text, text, text, text, text, text, date, text, text, text, text, text, text)',
              'execute')
       then 'OK' else 'MISSING' end;
