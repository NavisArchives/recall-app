/*
 * A Recall device is not the family's one browser screen.
 *
 * ── What the old shape was, and why it was honest ────────────────────────
 *
 * 027 wrote `installations_one_trusted_per_archive`: at most one trusted
 * installation per family, refereed by a partial unique index rather than by
 * a check in the UI, because two people pairing a screen at the same moment
 * is exactly when a UI check loses. That index carries real security weight.
 * M116's rule — *minting a second trusted device is the one action the family
 * password must not perform* — is enforced by it and by nothing else. A
 * stolen family password can open the archive; it cannot quietly hang a
 * second display in somebody else's house.
 *
 * ── What forced the change ───────────────────────────────────────────────
 *
 * The rule counts every trusted row the same, and there are now two kinds.
 * A **Recall device** is hardware this project provisions and ships — the
 * family never types a credential for it and cannot create one. A **browser
 * screen** is any machine a family pairs itself with the family password.
 *
 * Counting them together produces two wrong answers. A household that owns a
 * Recall device has spent its only slot on hardware it did not choose to
 * spend it on, so it can never pair the tablet in the kitchen. And the
 * family's own Settings can retire the device Recall shipped them, which is
 * not theirs to retire.
 *
 * ── The shape now ────────────────────────────────────────────────────────
 *
 * The exclusivity is narrowed to what it was actually protecting: **one
 * trusted BROWSER screen per archive**. Recall devices sit outside the count
 * entirely.
 *
 * M116's property is untouched, and that is the point of doing it this way
 * rather than dropping the index. The family password still cannot mint a
 * second browser screen — the index refuses it, in the same race, with the
 * same 23505. What it can now do is pair the first browser screen in a house
 * that already has a Recall device, which is a different act and the one the
 * owner asked for.
 *
 * Recall devices are deliberately NOT capped at one. Nothing a family can do
 * creates one: they are provisioned by the platform owner, so the number of
 * them is a fact about what was shipped, not a surface anyone can push on.
 * A cap here would constrain the shipper and protect nobody.
 */

alter table installations
  add column if not exists is_recall_device boolean not null default false;

comment on column installations.is_recall_device is
  'Hardware Recall provisions and ships, as opposed to a browser a family '
  'paired itself. Two consequences, both enforced in code and one here: it '
  'does not consume the family''s single browser-screen slot, and the family '
  'cannot retire it.';

/*
 * Every row that exists today was paired by a family through a browser —
 * `/family/pair-screen` and the replacement ceremony are the only doors that
 * have ever set `is_trusted`. So the default of false is already the truth
 * for all of them, and no backfill is needed or wanted: guessing that some
 * existing row is hardware would make it unretirable by the family that
 * paired it.
 */

drop index if exists installations_one_trusted_per_archive;

create unique index if not exists installations_one_trusted_browser_per_archive
  on installations (archive_id)
  where is_trusted and not is_recall_device;

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'the column exists' as check,
       case when exists (select 1 from information_schema.columns
                         where table_name = 'installations'
                           and column_name = 'is_recall_device')
            then 'OK' else 'MISSING' end as result
union all
select 'no existing row was guessed to be hardware',
       case when (select count(*) from installations where is_recall_device) = 0
            then 'OK' else 'SOMETHING WAS BACKFILLED' end
union all
select 'the old all-trusted index is gone',
       case when not exists (select 1 from pg_class
                             where relname = 'installations_one_trusted_per_archive')
            then 'OK' else 'STILL THERE' end
union all
select 'one trusted browser screen per archive is still enforced',
       case when exists (select 1 from pg_class
                         where relname = 'installations_one_trusted_browser_per_archive')
            then 'OK' else 'THE SLOT IS UNGUARDED' end
union all
/*
  The check that matters most, and it asks the INDEX what it refuses rather
  than reading its name. A rule that was renamed into place but predicates on
  the wrong thing would pass every check above while leaving the family
  password able to mint browser screens without limit.
*/
select 'and it is predicated on browser screens, not on all of them',
       case when (select pg_get_expr(indpred, indrelid) from pg_index
                  where indexrelid = 'installations_one_trusted_browser_per_archive'::regclass)
                 like '%is_recall_device%'
            then 'OK' else 'THE PREDICATE DOES NOT MENTION HARDWARE' end
union all
select 'no archive ended up with two trusted browser screens',
       case when not exists (
              select 1 from installations
               where is_trusted and not is_recall_device and archive_id is not null
               group by archive_id having count(*) > 1)
            then 'OK' else 'A DUPLICATE SURVIVED' end
union all
select 'rls still enabled on installations',
       case when (select relrowsecurity from pg_class where relname = 'installations')
            then 'OK' else 'RLS IS OFF' end;
