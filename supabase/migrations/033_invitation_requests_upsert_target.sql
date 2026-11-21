-- 033 — Asking for an invitation actually records the asking (M44)
--
-- 032 put a unique index on `lower(email)`, which is the right rule and the
-- wrong shape for the write that uses it. `ON CONFLICT (email)` — which is
-- what the route's upsert issues — needs a unique constraint on exactly the
-- column `email`; an index on the *expression* `lower(email)` does not match
-- it, so every request failed the conflict resolution.
--
-- And it failed silently, because that route deliberately answers `{ok:true}`
-- whatever happens underneath: telling a stranger which addresses are already
-- known would turn the form into a membership oracle (M19). The privacy
-- property was working exactly as designed and it hid a bug from itself —
-- which is worth writing down, because that trade is real and will recur
-- anywhere a route refuses to report its own failures.
--
-- The route always writes `email.trim().toLowerCase()`, so uniqueness on the
-- stored column is the same rule, expressed in the shape the write can use.

drop index if exists invitation_requests_one_per_email;

-- Any rows written before this point were written in mixed case only if some
-- other caller did so; the route never did. Fold them anyway, so the
-- constraint below cannot fail on data that predates it.
update invitation_requests set email = lower(email) where email <> lower(email);

delete from invitation_requests a
 using invitation_requests b
 where a.email = b.email and a.ctid > b.ctid;

alter table invitation_requests
  drop constraint if exists invitation_requests_email_key;

alter table invitation_requests
  add constraint invitation_requests_email_key unique (email);

-- ── Self-verifying checklist ─────────────────────────────────────────────
--
-- Proves the write the route actually issues, rather than the shape of an
-- index — which is the distinction this migration exists because of.

do $$
declare
  v_email text := 'checklist-' || gen_random_uuid()::text || '@example.invalid';
  v_id    uuid;
  v_again uuid;
begin
  insert into invitation_requests (email, name, note, status)
  values (v_email, 'First', 'first note', 'pending')
  on conflict (email) do update set note = excluded.note
  returning invitation_requests.id into v_id;

  insert into invitation_requests (email, name, note, status)
  values (v_email, 'Second', 'second note', 'pending')
  on conflict (email) do update set note = excluded.note
  returning invitation_requests.id into v_again;

  if v_id is null or v_again is null then
    raise exception 'the upsert the route issues does not resolve';
  end if;
  if v_id <> v_again then
    raise exception 'asking twice created two rows';
  end if;
  if (select note from invitation_requests where invitation_requests.id = v_id) <> 'second note' then
    raise exception 'the second asking did not update the first';
  end if;

  delete from invitation_requests where invitation_requests.id = v_id;
end $$;

select 'asking twice updates one row, through the route''s own ON CONFLICT (email)' as check,
       'OK' as result
union all
select 'the constraint is on the column, not an expression',
       case when exists (
         select 1 from pg_constraint
         where conname = 'invitation_requests_email_key' and contype = 'u'
       ) then 'OK' else 'MISSING' end;
