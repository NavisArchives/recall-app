-- ============================================================
-- 047 — a card you can post (design §18, "Cards — a doorway you can post")
-- ============================================================
--
-- Today `nfc_cards` holds one kind of object: a tag someone taps. §18 turns
-- Cards into the section for every PHYSICAL card that opens a channel — the
-- postcard a granddaughter sends, with the NFC card as its sibling — and the
-- overview filters on All / Postcards / NFC cards / Draft / Ready to send.
-- None of those five filters can be answered by the columns that exist.
--
-- This migration adds only what the frames actually read. It is additive:
-- every existing row keeps its meaning, and nothing here changes what the
-- display or the current Cards page already does.
--
-- ── The table keeps its name, deliberately ──────────────────────────────
--
-- `nfc_cards` will hold postcards after this, so the name becomes historical
-- — and a name that lies is exactly what M212 was about. Renaming it to
-- `cards` is the right eventual move and it is NOT bundled here: the rename
-- touches every route that says `.from("nfc_cards")`, and mixing a rename
-- into a feature migration means one failure mode cannot be told from the
-- other. Flagged for its own migration, with its own checklist.
--
-- ── Where the delivery address lives ────────────────────────────────────
--
-- Nowhere in this table, on purpose. Frame 18f is explicit: "The address
-- belongs to Margaret, not to the card — change it once and every card
-- follows." `people.address` has existed since 012 and is what 18f reads. A
-- copy on the card would be a second truth that silently goes stale.

-- ── A. What kind of card this is ────────────────────────────────────────
-- Existing rows are all tags, so the default keeps all six correct without
-- touching them.
alter table nfc_cards add column if not exists kind text not null default 'nfc';
alter table nfc_cards drop constraint if exists nfc_cards_kind_check;
alter table nfc_cards add constraint nfc_cards_kind_check
  check (kind in ('nfc', 'postcard'));

-- ── B. Where a postcard is in its life ──────────────────────────────────
-- NULL for a tag, and that is the point rather than an omission: an NFC card
-- has no send lifecycle, so giving it a state would put every tag under the
-- overview's "Ready to send" filter and make the filter a lie. A postcard
-- must always have one.
--
-- The vocabulary is the fulfilment queue's (18j), not the family's. 18g shows
-- a family "preparing for delivery" while the queue says `queued` — the same
-- row, two readerships, and the UI translates, exactly as `pending` is shown
-- to a family as "invited".
alter table nfc_cards add column if not exists state text;
alter table nfc_cards drop constraint if exists nfc_cards_state_check;
alter table nfc_cards add constraint nfc_cards_state_check
  check (state is null or state in ('draft', 'ready', 'queued', 'sent'));

alter table nfc_cards drop constraint if exists nfc_cards_postcard_has_state;
alter table nfc_cards add constraint nfc_cards_postcard_has_state
  check (kind <> 'postcard' or state is not null);

-- ── C. The photograph on the front (18c, 18d) ───────────────────────────
-- Composite, like every other reference out of this table (038), so a card
-- can never point at a photograph in another family. `set null (column)` is
-- 038's form: a bare SET NULL on a composite key would null `archive_id` too
-- and tear the row out of its archive.
alter table nfc_cards add column if not exists media_file_id uuid;
alter table nfc_cards drop constraint if exists nfc_cards_media_file_id_fkey;
alter table nfc_cards add constraint nfc_cards_media_file_id_fkey
  foreign key (media_file_id, archive_id) references media_files (id, archive_id)
  on delete set null (media_file_id);

-- ── D. Who it is from and who it is for (18d, 18g) ──────────────────────
-- "From Lucie, your granddaughter / To Margaret" — both lines are pulled,
-- never typed, so both are people in this archive rather than free text.
alter table nfc_cards add column if not exists from_person_id uuid;
alter table nfc_cards drop constraint if exists nfc_cards_from_person_id_fkey;
alter table nfc_cards add constraint nfc_cards_from_person_id_fkey
  foreign key (from_person_id, archive_id) references people (id, archive_id)
  on delete set null (from_person_id);

alter table nfc_cards add column if not exists to_person_id uuid;
alter table nfc_cards drop constraint if exists nfc_cards_to_person_id_fkey;
alter table nfc_cards add constraint nfc_cards_to_person_id_fkey
  foreign key (to_person_id, archive_id) references people (id, archive_id)
  on delete set null (to_person_id);

-- ── E. The monthly ritual (18i) ─────────────────────────────────────────
-- `photo_mode` is the half that is easy to lose: "Newest in the channel,
-- chosen automatically" is a standing instruction, not a photograph, so a
-- recurring card cannot store a media_file_id and mean it.
alter table nfc_cards add column if not exists recurrence text not null default 'once';
alter table nfc_cards drop constraint if exists nfc_cards_recurrence_check;
alter table nfc_cards add constraint nfc_cards_recurrence_check
  check (recurrence in ('once', 'weekly', 'monthly'));

alter table nfc_cards add column if not exists photo_mode text not null default 'chosen';
alter table nfc_cards drop constraint if exists nfc_cards_photo_mode_check;
alter table nfc_cards add constraint nfc_cards_photo_mode_check
  check (photo_mode in ('chosen', 'newest'));

alter table nfc_cards add column if not exists next_send_at timestamptz;

-- ── F. What fulfilment needs (18j) ──────────────────────────────────────
alter table nfc_cards add column if not exists sent_at timestamptz;
alter table nfc_cards add column if not exists shipping_reference text;

comment on column nfc_cards.kind is
  'nfc = a tag someone taps; postcard = a card Recall prints and posts (047).';
comment on column nfc_cards.state is
  'Postcards only, and NULL for tags on purpose: a tag has no send lifecycle, '
  'and a state on one would put it under the overview''s "Ready to send" filter.';

-- ── Self-verifying checklist ─────────────────────────────────────────────

select 'every new column exists' as check,
       case when (select count(*) from information_schema.columns
                  where table_name = 'nfc_cards'
                    and column_name in ('kind','state','media_file_id','from_person_id',
                                        'to_person_id','recurrence','photo_mode',
                                        'next_send_at','sent_at','shipping_reference')) = 10
            then 'OK' else 'A COLUMN IS MISSING' end as result
union all
select 'the six existing cards are still tags',
       case when not exists (select 1 from nfc_cards where kind <> 'nfc')
            then 'OK' else 'AN EXISTING ROW CHANGED KIND' end
union all
select 'no existing row was given a send state',
       case when not exists (select 1 from nfc_cards where state is not null)
            then 'OK' else 'A TAG WAS GIVEN A STATE' end
union all
-- The constraint that stops the overview filters lying.
select 'a postcard cannot exist without a state',
       case when exists (select 1 from pg_constraint
                         where conname = 'nfc_cards_postcard_has_state')
            then 'OK' else 'MISSING' end
union all
-- Tenancy: every new reference is composite, like the two 038 already added.
select 'all three new references are composite (id, archive_id)',
       case when (select count(*) from pg_constraint
                  where conname in ('nfc_cards_media_file_id_fkey',
                                    'nfc_cards_from_person_id_fkey',
                                    'nfc_cards_to_person_id_fkey')
                    and pg_get_constraintdef(oid) like '%archive_id%') = 3
            then 'OK' else 'A REFERENCE IS NOT ARCHIVE-SCOPED' end
union all
select 'the two references 038 added are untouched',
       case when (select count(*) from pg_constraint
                  where conname in ('nfc_cards_channel_id_fkey',
                                    'nfc_cards_linked_by_fkey')) = 2
            then 'OK' else 'AN EXISTING KEY WAS LOST' end
union all
select 'rls still enabled on nfc_cards',
       case when (select relrowsecurity from pg_class where relname = 'nfc_cards')
            then 'OK' else 'RLS OFF' end;
