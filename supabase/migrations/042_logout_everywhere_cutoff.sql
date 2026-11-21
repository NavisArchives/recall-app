-- 042 — "Sign out everywhere" gets its own session cutoff
--
-- M159 made a password *reset* actually sign the remote tiers out: the guards
-- now refuse a device or profile JWT whose `iat` predates the family's
-- `password_set_at`. Its twin, the admin's "Sign out everywhere" button
-- (`/family/logout-everywhere`), had the same shape of gap and could not reuse
-- that column — because signing out everywhere changes no password, so there
-- is no `password_set_at` to move. It revoked the opaque `family_sessions`
-- rows and left the two JWT tiers alive, contradicting its own promise.
--
-- This is the cutoff that button needs: a second, independent timestamp the
-- guards compare `iat` against. A token is stale if it was issued before
-- EITHER cutoff — the later of a reset and a sign-out-everywhere — so neither
-- action shadows the other and each keeps its own meaning.
--
-- Nullable, and null is meaningful: it means "sign out everywhere" has never
-- been used, so there is nothing to enforce from this source and every token
-- stands on `password_set_at` alone. A family that has never pressed it is
-- exactly as it was.
--
-- No new table, so no new RLS surface: `families` has had RLS enabled with no
-- policies since 027 — anonymous clients are denied everything and only the
-- backend's service key touches it. Archive scoping is the table's own
-- (`archive_id`), and the guards read this column filtered to one archive, so
-- a sign-out in one family can never end another's sessions.

alter table families add column if not exists sessions_valid_from timestamptz;

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'sessions_valid_from column exists' as check,
       case when exists (select 1 from information_schema.columns
                         where table_name = 'families'
                           and column_name = 'sessions_valid_from')
            then 'OK' else 'MISSING' end as result
union all
select 'nullable (null = never signed out everywhere)',
       case when (select is_nullable from information_schema.columns
                  where table_name = 'families'
                    and column_name = 'sessions_valid_from') = 'YES'
            then 'OK' else 'NOT NULLABLE' end
union all
-- Meaningful only on the FIRST apply, when no family can have used the button
-- yet. This migration is idempotent (`if not exists`), so a re-run after
-- "sign out everywhere" has legitimately stamped a family will print
-- 'UNEXPECTED VALUES' here — that is the column doing its job, not a failure.
select 'existing families survive as never-used',
       case when not exists (select 1 from families where sessions_valid_from is not null)
            then 'OK' else 'UNEXPECTED VALUES (fine on a re-run after the button has been used)' end
union all
select 'rls still enabled on families',
       case when (select relrowsecurity from pg_class where relname = 'families')
            then 'OK' else 'RLS OFF' end;
