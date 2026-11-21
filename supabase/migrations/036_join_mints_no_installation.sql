-- 036 — Accepting an invitation stops minting a trusted device (M94)
--
-- `accept_invitation` took three `p_install_*` parameters and, when given
-- them, inserted a row into `installations` — so every invitee's browser
-- became a trusted device of the family. Two things in identity-model.md
-- forbid that shape:
--
--   :71-80  exactly one trusted device per family, exclusive — while one
--           exists, no other device can become trusted. A device per invitee
--           is a device per invitee.
--   :45-47  a joined member signs in with the family password + their PIN,
--           *from anywhere* — the family-session tier. Tying their return to
--           a 30-day device cookie on the one browser they happened to accept
--           on strands them on their own phone the moment it lapses.
--
-- The route now mints a family session instead. This removes the ability
-- rather than merely declining to use it: a capability with no legitimate
-- caller is one a future caller will reasonably reach for, and the whole
-- point is that no join may create a second trusted device.
--
-- The founding sign-up path is untouched. `create_household` still pairs the
-- founder's browser as the one trusted screen — that device is the subject's
-- display, and it is the one the model allows.
--
-- `out_installation_id` goes with the parameters: an OUT column that is
-- always null is a promise the function no longer keeps.

-- The old signature must be dropped explicitly: `create or replace` cannot
-- change a function's argument list, and leaving it would keep the
-- installation-minting overload callable by name.
drop function if exists accept_invitation(
  uuid, uuid, text, text, text, text, text, text, text, text, text
);

create or replace function accept_invitation(
  p_invitation_id uuid,
  p_account_id    uuid,
  p_email         text,
  p_display_name  text,
  p_name          text,
  p_address       text,
  p_pin_hash      text,
  p_secret_kind   text default 'token'
)
returns table (
  out_person_id  uuid,
  out_archive_id uuid,
  out_role       text,
  out_account_id uuid
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
   * The invitation claims the profile already on the shelf (M41, unchanged).
   *
   * The admin puts a face there first and invites that person afterwards.
   * Inserting a new row here would give the family two of her. A profile is
   * only created when the invitation names none.
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

  update invitations
     set accepted_account_id = v_family
   where invitations.id = p_invitation_id;

  return query
    select v_person, v_archive,
           coalesce((select people.role from people where people.id = v_person), 'co_author'),
           v_family;
end;
$$;

revoke all on function accept_invitation(
  uuid, uuid, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function accept_invitation(
  uuid, uuid, text, text, text, text, text, text
) to service_role;

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'the installation-minting overload is gone' as check,
       case when not exists (
         select 1 from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'accept_invitation'
           and pg_get_function_identity_arguments(p.oid) like '%text, text, text, text, text, text, text, text%'
       ) then 'OK' else 'STILL CALLABLE' end as result

union all

select 'exactly one accept_invitation remains',
       case when (
         select count(*) from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'accept_invitation'
       ) = 1 then 'OK' else 'WRONG COUNT' end

union all

select 'it no longer names an installation',
       case when not exists (
         select 1 from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'accept_invitation'
           and pg_get_functiondef(p.oid) ilike '%insert into installations%'
       ) then 'OK' else 'STILL MINTS ONE' end

union all

select 'anon and authenticated cannot execute it',
       case when not exists (
         select 1 from information_schema.role_routine_grants
         where routine_name = 'accept_invitation'
           and grantee in ('anon', 'authenticated', 'PUBLIC')
       ) then 'OK' else 'GRANTED TOO WIDELY' end;
