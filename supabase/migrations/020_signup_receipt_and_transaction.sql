-- 020: Signup becomes one transaction, and verification proves who is asking.
--
-- Two defects, one handler.
--
-- M14: verification proved that *somebody* held the address, never that the
-- person now signing up was that somebody. Any signup for a recently verified
-- address succeeded, from any browser. Verification now mints a receipt — a
-- random secret returned once to the caller who answered the code — and only
-- its hash is kept. Signup must present it, and spending it is a conditional
-- update inside the transaction, so two callers cannot both spend one.
--
-- M15: the household was seven inserts with a hand-written rollback, which is
-- not a transaction: a killed process, a timeout or a failure inside the
-- rollback left an archive with no owner or an account with no archive. It is
-- now one function. It all exists or none of it does.
--
-- The function raises `signup_refused` for every refusal a stranger could
-- provoke — spent receipt, wrong address, expired receipt, taken email — so
-- the route can answer all of them identically (M19). Only the server knows
-- which of them happened.

-- ── The receipt ──────────────────────────────────────────────────────────

alter table email_verifications add column if not exists receipt_hash text;
alter table email_verifications add column if not exists receipt_expires_at timestamptz;
alter table email_verifications add column if not exists consumed_at timestamptz;
alter table email_verifications add column if not exists purpose text not null default 'signup';

-- Found by hash, and only ever one live receipt per hash.
create unique index if not exists email_verifications_receipt_idx
  on email_verifications (receipt_hash)
  where receipt_hash is not null;

-- ── The household, in one transaction ────────────────────────────────────

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
  p_install_secret  text
)
returns table (account_id uuid, archive_id uuid, person_id uuid, installation_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account   uuid;
  v_archive   uuid;
  v_person    uuid;
  v_install   uuid;
  v_spent     integer;
  v_first     text := split_part(btrim(p_subject_name), ' ', 1);
begin
  -- Spend the receipt first: a conditional update whose row count is the
  -- whole answer. Concurrent signups race here, and exactly one wins.
  update email_verifications
     set consumed_at = now()
   where receipt_hash = p_receipt_hash
     and email = p_email
     and purpose = 'signup'
     and consumed_at is null
     and receipt_expires_at > now();
  get diagnostics v_spent = row_count;
  if v_spent <> 1 then
    raise exception 'signup_refused' using errcode = 'P0001';
  end if;

  -- An address already in use is refused with the same exception, so the
  -- caller cannot tell the two apart (M19).
  if exists (select 1 from accounts where lower(email) = lower(p_email)) then
    raise exception 'signup_refused' using errcode = 'P0001';
  end if;

  insert into accounts (email, display_name, email_verified_at)
  values (p_email, p_display_name, now())
  returning id into v_account;

  insert into archives (name, owner_account_id)
  values (v_first || '''s archive', v_account)
  returning id into v_archive;

  -- The column default is a relic of the first, French-speaking archive; a
  -- new family states their language themselves, in Settings.
  insert into settings (archive_id, display_name, full_name, birth_date, residence, preferred_language)
  values (v_archive, v_first, p_subject_name, p_birth_date, nullif(btrim(coalesce(p_residence, '')), ''), null);

  -- The founder's admin profile always carries a PIN (M17). Passwordless is for
  -- the subject alone, whose whole reason for being here is that she cannot
  -- reliably recall things; an administrator can delete every memory.
  insert into people (archive_id, name, email, role, status, relationship, pin_hash, pin_set_at)
  values (
    v_archive, p_admin_name, p_email, 'admin', 'active',
    case when p_about = 'someone' then p_relationship else null end,
    p_admin_pin_hash, now()
  )
  returning id into v_person;

  -- The subject's own profile on the shelf, passwordless, so the chooser at
  -- her screen has her face on it from day one. When the signer *is* the
  -- subject they get two profiles — one person, two roles — because the
  -- exemption belongs to the role, not to the human being.
  insert into people (archive_id, name, role, status, birthday)
  values (v_archive, p_subject_name, 'user', 'active', p_birth_date);

  insert into archive_memberships (archive_id, account_id, person_id, role, status)
  values (v_archive, v_account, v_person, 'admin', 'active');

  -- The browser that signed up becomes a revocable installation. It is part
  -- of completion, not an afterthought: without it the caller would be handed
  -- a welcome and refused on their next request.
  insert into installations (name, username, secret_hash, archive_id)
  values (p_install_name, p_install_username, p_install_secret, v_archive)
  returning id into v_install;

  return query select v_account, v_archive, v_person, v_install;
end;
$$;

revoke all on function create_household(
  text, text, text, text, text, text, text, text, date, text, text, text, text
) from public, anon, authenticated;

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'receipt columns' as check,
       case when (
         select count(*) from information_schema.columns
         where table_name = 'email_verifications'
           and column_name in ('receipt_hash', 'receipt_expires_at', 'consumed_at', 'purpose')
       ) = 4 then 'OK' else 'MISSING' end as result
union all
select 'receipt hash unique',
       case when exists (
         select 1 from pg_indexes
         where tablename = 'email_verifications'
           and indexname = 'email_verifications_receipt_idx'
           and indexdef like 'CREATE UNIQUE%'
       ) then 'OK' else 'MISSING' end
union all
select 'create_household exists',
       case when exists (
         select 1 from pg_proc where proname = 'create_household'
       ) then 'OK' else 'MISSING' end
union all
select 'create_household is not callable by anon',
       case when not has_function_privilege('anon', 'create_household(text, text, text, text, text, text, text, text, date, text, text, text, text)', 'execute')
       then 'OK' else 'EXPOSED' end
union all
select 'no archive without an owner account',
       case when not exists (
         select 1 from archives a
         left join accounts ac on ac.id = a.owner_account_id
         where a.owner_account_id is null or ac.id is null
       ) then 'OK' else 'ORPHANS' end
union all
select 'no account without an archive',
       case when not exists (
         select 1 from accounts ac
         where not exists (select 1 from archives a where a.owner_account_id = ac.id)
           and not exists (select 1 from archive_memberships m where m.account_id = ac.id)
       ) then 'OK' else 'ORPHANS' end;
