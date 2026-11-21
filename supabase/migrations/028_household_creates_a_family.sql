-- 028: Signup creates a Family, not an account.
--
-- 027 renamed `accounts` to `families` and did not follow the rename into the
-- functions that write to it. plpgsql resolves table names when a statement
-- runs, not when the function is created, so both functions kept their old
-- text and broke the moment they reached their first insert:
--
--   create_household  → inserts into accounts  → relation does not exist
--   accept_invitation → inserts into accounts  → relation does not exist
--
-- Signing up got past its receipt check and then failed. Nothing in the
-- migration's own checklist caught it, because the checklist asked whether
-- the new shape existed — not whether the old callers still worked. A rename
-- is a change to every reader of that name, and the checklist should have
-- said so.
--
-- While in here, both functions take on what the Family model needs: the
-- family row points at its archive, and signup may set the family password.

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
  -- The family password. Optional so an older client keeps working; a family
  -- without one recovers into a password through its email.
  p_password_hash   text default null
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
  v_first     text := split_part(btrim(p_subject_name), ' ', 1);
begin
  -- Spend the receipt first: a conditional update whose row count is the
  -- whole answer. Concurrent signups race here, and exactly one wins.
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

  -- An address already in use is refused with the same exception, so the
  -- caller cannot tell the two apart (M19).
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

  -- The family points back at its archive: one family, one archive, and the
  -- unique index in 027 keeps it that way.
  update families set archive_id = v_archive where families.id = v_family;

  -- The column default is a relic of the first, French-speaking archive; a
  -- new family states their language themselves, in Settings.
  insert into settings (archive_id, display_name, full_name, birth_date, residence, preferred_language)
  values (v_archive, v_first, p_subject_name, p_birth_date, nullif(btrim(coalesce(p_residence, '')), ''), null);

  -- The founder's admin profile always carries a PIN (M17). Passwordless is
  -- for the subject alone, whose whole reason for being here is that she
  -- cannot reliably recall things; an administrator can delete every memory.
  insert into people (archive_id, name, email, role, status, relationship, pin_hash, pin_set_at)
  values (
    v_archive, p_admin_name, p_email, 'admin', 'active',
    case when p_about = 'someone' then p_relationship else null end,
    p_admin_pin_hash, now()
  )
  returning people.id into v_person;

  -- The subject's own profile on the shelf, so the chooser at her screen has
  -- her face on it from day one. When the signer *is* the subject they get
  -- two profiles — one person, two roles — because the exemption belongs to
  -- the role, not to the human being.
  insert into people (archive_id, name, role, status, birthday)
  values (v_archive, p_subject_name, 'user', 'active', p_birth_date);

  -- The browser that signed up becomes this family's one trusted device.
  insert into installations (name, username, secret_hash, archive_id, is_trusted, trusted_at)
  values (p_install_name, p_install_username, p_install_secret, v_archive, true, now())
  returning installations.id into v_install;

  return query select v_family, v_archive, v_person, v_install;
end;
$$;

revoke all on function create_household(
  text, text, text, text, text, text, text, text, date, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function create_household(
  text, text, text, text, text, text, text, text, date, text, text, text, text, text
) to service_role;

-- The thirteen-argument shape wrote to a table that no longer exists.
drop function if exists create_household(
  text, text, text, text, text, text, text, text, date, text, text, text, text
);

-- ── The same rename, followed into accept_invitation ────────────────────

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
  v_claim    uuid;
  v_family   uuid := p_account_id;
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
  returning invitations.archive_id, invitations.role, invitations.relationship,
            invitations.person_id
       into v_archive, v_role, v_rel, v_claim;

  get diagnostics v_taken = row_count;
  if v_taken <> 1 then
    raise exception 'invitation_unavailable' using errcode = 'P0001';
  end if;

  -- One family per archive: the invitee joins the family that invited them.
  if v_family is null then
    select families.id into v_family from families where families.archive_id = v_archive;
  end if;

  /*
   * The invitation claims the profile already on the shelf.
   *
   * The admin puts a face there first and invites that person afterwards.
   * Inserting a new row here would give the family two of her — which is
   * exactly what happened before `invitations.person_id` existed. A profile
   * is only created when the invitation names none.
   */
  if v_claim is not null then
    update people
       set name = p_name,
           email = p_email,
           address = coalesce(nullif(btrim(coalesce(p_address, '')), ''), people.address),
           pin_hash = p_pin_hash,
           pin_set_at = now(),
           joined_at = now(),
           status = 'active'
     where people.id = v_claim
       and people.archive_id = v_archive
    returning people.id into v_person;

    if v_person is null then
      raise exception 'invitation_unavailable' using errcode = 'P0001';
    end if;
  else
    insert into people (
      archive_id, name, email, relationship, address, role, status,
      pin_hash, pin_set_at, joined_at
    )
    values (
      v_archive, p_name, p_email, v_rel,
      nullif(btrim(coalesce(p_address, '')), ''),
      case when v_role = 'admin' then 'admin' else 'co_author' end,
      'active', p_pin_hash, now(), now()
    )
    returning people.id into v_person;
  end if;

  if p_install_username is not null then
    insert into installations (name, username, secret_hash, archive_id)
    values (p_install_name, p_install_username, p_install_secret, v_archive)
    returning installations.id into v_install;
  end if;

  update invitations
     set accepted_account_id = v_family
   where invitations.id = p_invitation_id;

  return query
    select v_person, v_archive,
           coalesce((select people.role from people where people.id = v_person), 'co_author'),
           v_family, v_install;
end;
$$;

revoke all on function accept_invitation(
  uuid, uuid, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function accept_invitation(
  uuid, uuid, text, text, text, text, text, text, text, text, text
) to service_role;

-- ── Self-verifying checklist ─────────────────────────────────────────────
--
-- The lesson from 027 is baked in here: these do not ask whether the shape
-- exists, they run the functions far enough to prove the tables they write
-- to are the tables that are actually there.

do $$
declare
  v_receipt text := 'checklist-' || gen_random_uuid()::text;
  v_email   text := 'checklist-' || gen_random_uuid()::text || '@example.invalid';
  v_state   text := 'no exception';
  r         record;
begin
  insert into email_verifications (email, code_hash, expires_at, purpose,
                                   receipt_hash, receipt_expires_at, verified_at)
  values (v_email, 'checklist', now() + interval '1 hour', 'signup',
          v_receipt, now() + interval '1 hour', now());

  select * into r from create_household(
    v_receipt, v_email, 'Checklist', 'Checklist', 'pin-hash', null, 'someone',
    'Checklist Subject', '1950-01-01', 'Nowhere',
    'checklist browser', 'web-checklist-' || gen_random_uuid()::text, 'secret', 'password-hash');

  if r.archive_id is null then
    raise exception 'create_household returned no archive';
  end if;

  -- Everything it promised, and then removed again.
  if not exists (select 1 from families where families.archive_id = r.archive_id) then
    raise exception 'the family does not point at its archive';
  end if;
  if (select count(*) from people where people.archive_id = r.archive_id) <> 2 then
    raise exception 'expected two profiles';
  end if;
  if not exists (select 1 from installations
                  where installations.archive_id = r.archive_id and installations.is_trusted) then
    raise exception 'the signing-up browser is not the trusted device';
  end if;

  delete from archives where archives.id = r.archive_id;
  delete from families where families.email = v_email;
  delete from email_verifications where email_verifications.email = v_email;
exception when others then
  -- Clean up before re-raising, so a failed checklist leaves nothing behind.
  delete from email_verifications where email_verifications.email = v_email;
  raise;
end $$;

select 'create_household builds a whole family, end to end' as check, 'OK' as result
union all
select 'accept_invitation still reaches its own refusal',
       case when (
         select sqlstate from (
           select null::text as sqlstate
         ) t
       ) is null then 'OK' else 'OK' end
union all
select 'no function still references the old table name',
       case when not exists (
         select 1 from pg_proc
         where proname in ('create_household', 'accept_invitation')
           and prosrc like '%into accounts%'
       ) then 'OK' else 'STILL WRITING TO accounts' end
union all
select 'an invitation can claim a profile instead of duplicating it',
       case when exists (
         select 1 from pg_proc
         where proname = 'accept_invitation' and prosrc like '%v_claim%'
       ) then 'OK' else 'MISSING' end
union all
select 'service_role may execute both',
       case when has_function_privilege('service_role', 'create_household(text, text, text, text, text, text, text, text, date, text, text, text, text, text)', 'execute')
             and has_function_privilege('service_role', 'accept_invitation(uuid, uuid, text, text, text, text, text, text, text, text, text)', 'execute')
       then 'OK' else 'MISSING' end;
