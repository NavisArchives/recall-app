-- 029 — An invitation claims one profile, and never the subject's (M41)
--
-- 028 taught `accept_invitation` to update a named profile instead of always
-- inserting a new one, which is the half of M41 that stops a family seeing
-- two Hélènes. Two things it left open, both reachable from the outside:
--
--   1. Nothing stopped two live invitations pointing at the same face. Two
--      people accept, and the second silently overwrites the first one's
--      name, email and PIN — on a profile that already has somebody's
--      history attached to it. A route-level check cannot close this; two
--      requests in flight both read "no invitation yet" and both insert.
--      The database has to be the one that says no.
--
--   2. Nothing stopped an invitation naming the *subject's* profile. She is
--      the one person whose profile is deliberately passwordless and
--      deliberately reachable from exactly one screen (M42). Claiming it
--      would give her a PIN, an email address and a way in from any browser
--      that has the link — undoing that mission through a side door.
--
-- Both are refused here rather than in the route, because both are answers
-- that must not depend on which caller asked.

-- ── One live invitation per face ─────────────────────────────────────────
--
-- The same shape as the existing one-live-invitation-per-address index, so
-- a second claim on the same profile comes back as 23505 and the route can
-- say "Already invited." The predicate matches the conditions
-- `accept_invitation` re-asserts when it consumes one: unaccepted and
-- unrevoked. Expiry is deliberately not in here — an expired invitation
-- still occupies the face until an admin revokes it, which is the same
-- choice the address index already made.

create unique index if not exists invitations_one_live_per_person
  on invitations (archive_id, person_id)
  where person_id is not null
    and accepted_at is null
    and revoked_at is null;

-- ── The subject's profile is not claimable ───────────────────────────────

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
   *
   * Three conditions guard the update, and each is a refusal that matters:
   *
   *   `archive_id`  — a person id from another family updates nothing. The
   *                   ids are unguessable, but "unguessable" is not an
   *                   authorization check, and this transaction has already
   *                   consumed the invitation by the time it gets here.
   *   `role <> 'user'` — the subject's profile is never claimable. Hers is
   *                   passwordless on purpose and lives on one screen on
   *                   purpose (M42); an invitation that could claim it
   *                   would hand out a PIN and a way in from anywhere.
   *   `archived_at is null` — a removed profile is not resurrected by
   *                   invitation. Restoring one is an admin's decision,
   *                   made where the consequences are visible.
   *
   * The role is deliberately left as it stands. The invitation carries one,
   * but the profile on the shelf already has the role its family gave it,
   * and applying the invitation's would quietly demote an admin to
   * co-author for the crime of being invited. Promotion has its own screen.
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
       and people.role <> 'user'
       and people.archived_at is null
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
-- 027's lesson, again: prove the behaviour, not the shape. This builds a
-- family, puts two faces on its shelf, and tries every refusal the function
-- is supposed to make — then removes everything it made.

do $$
declare
  v_receipt  text := 'claim-' || gen_random_uuid()::text;
  v_email    text := 'claim-' || gen_random_uuid()::text || '@example.invalid';
  v_archive  uuid;
  v_family   uuid;
  v_helper   uuid;
  v_subject  uuid;
  v_invite   uuid;
  v_before   integer;
  v_after    integer;
  v_state    text;
  r          record;
begin
  insert into email_verifications (email, code_hash, expires_at, purpose,
                                   receipt_hash, receipt_expires_at, verified_at)
  values (v_email, 'claim', now() + interval '1 hour', 'signup',
          v_receipt, now() + interval '1 hour', now());

  select account_id, archive_id into v_family, v_archive from create_household(
    v_receipt, v_email, 'Claim', 'Claim Admin', 'pin-hash', null, 'someone',
    'Claim Subject', '1950-01-01', 'Nowhere',
    'claim browser', 'web-claim-' || gen_random_uuid()::text, 'secret', 'password-hash');

  -- A face on the shelf, exactly as an admin adds one before inviting her.
  insert into people (archive_id, name, role, status)
  values (v_archive, 'Shelf Helper', 'co_author', 'pending')
  returning people.id into v_helper;

  select people.id into v_subject
    from people where people.archive_id = v_archive and people.role = 'user';

  select count(*) into v_before from people where people.archive_id = v_archive;

  -- 1. Claiming the shelf profile updates it instead of inserting a second.
  insert into invitations (archive_id, email, name, role, token_hash, code_hash,
                           expires_at, person_id)
  values (v_archive, 'helper@example.invalid', 'Shelf Helper', 'co_author',
          'claim-token-' || gen_random_uuid()::text, 'claim-code-' || gen_random_uuid()::text,
          now() + interval '1 day', v_helper)
  returning invitations.id into v_invite;

  select * into r from accept_invitation(
    v_invite, v_family, 'helper@example.invalid', 'Claim', 'Shelf Helper',
    null, 'helper-pin-hash');

  if r.out_person_id <> v_helper then
    raise exception 'the invitation created a second profile instead of claiming one';
  end if;

  select count(*) into v_after from people where people.archive_id = v_archive;
  if v_after <> v_before then
    raise exception 'the family gained a profile it should not have (% -> %)', v_before, v_after;
  end if;

  if not exists (select 1 from people
                  where people.id = v_helper and people.joined_at is not null
                    and people.pin_hash = 'helper-pin-hash') then
    raise exception 'the claimed profile did not record the join';
  end if;

  -- 2. The same invitation again is refused, not applied twice.
  begin
    perform accept_invitation(v_invite, v_family, 'helper@example.invalid', 'Claim',
                              'Replay', null, 'replay-pin-hash');
    raise exception 'a spent invitation was accepted a second time';
  exception when sqlstate 'P0001' then
    null;
  end;

  if exists (select 1 from people where people.id = v_helper and people.pin_hash = 'replay-pin-hash') then
    raise exception 'the replay changed the PIN';
  end if;

  -- 3. The subject's profile cannot be claimed.
  insert into invitations (archive_id, email, name, role, token_hash, code_hash,
                           expires_at, person_id)
  values (v_archive, 'subject@example.invalid', 'Claim Subject', 'co_author',
          'subject-token-' || gen_random_uuid()::text, 'subject-code-' || gen_random_uuid()::text,
          now() + interval '1 day', v_subject)
  returning invitations.id into v_invite;

  begin
    perform accept_invitation(v_invite, v_family, 'subject@example.invalid', 'Claim',
                              'Claim Subject', null, 'subject-pin-hash');
    raise exception 'the subject''s profile was claimed by an invitation';
  exception when sqlstate 'P0001' then
    null;
  end;

  if exists (select 1 from people where people.id = v_subject and people.pin_hash is not null) then
    raise exception 'the subject was given a PIN';
  end if;

  -- 4. Two live invitations cannot name the same face.
  insert into people (archive_id, name, role, status)
  values (v_archive, 'Second Helper', 'co_author', 'pending')
  returning people.id into v_helper;

  insert into invitations (archive_id, email, name, role, token_hash, code_hash,
                           expires_at, person_id)
  values (v_archive, 'second@example.invalid', 'Second Helper', 'co_author',
          'second-token-' || gen_random_uuid()::text, 'second-code-' || gen_random_uuid()::text,
          now() + interval '1 day', v_helper);

  begin
    insert into invitations (archive_id, email, name, role, token_hash, code_hash,
                             expires_at, person_id)
    values (v_archive, 'third@example.invalid', 'Second Helper', 'co_author',
            'third-token-' || gen_random_uuid()::text, 'third-code-' || gen_random_uuid()::text,
            now() + interval '1 day', v_helper);
    raise exception 'two live invitations were allowed to name the same profile';
  exception when unique_violation then
    null;
  end;

  delete from invitations where invitations.archive_id = v_archive;
  delete from archives where archives.id = v_archive;
  delete from families where families.email = v_email;
  delete from email_verifications where email_verifications.email = v_email;
exception when others then
  v_state := sqlerrm;
  delete from invitations where invitations.archive_id = v_archive;
  delete from archives where archives.id = v_archive;
  delete from families where families.email = v_email;
  delete from email_verifications where email_verifications.email = v_email;
  raise exception 'claim checklist failed: %', v_state;
end $$;

select 'an invitation claims its profile, replays are refused, the subject is not claimable' as check,
       'OK' as result
union all
select 'one live invitation per face',
       case when exists (
         select 1 from pg_indexes
         where indexname = 'invitations_one_live_per_person'
       ) then 'OK' else 'MISSING' end
union all
select 'the subject''s profile is guarded inside the function',
       case when exists (
         select 1 from pg_proc
         where proname = 'accept_invitation' and prosrc like '%people.role <> ''user''%'
       ) then 'OK' else 'MISSING' end
union all
select 'service_role may execute it',
       case when has_function_privilege('service_role',
              'accept_invitation(uuid, uuid, text, text, text, text, text, text, text, text, text)',
              'execute')
       then 'OK' else 'MISSING' end;
