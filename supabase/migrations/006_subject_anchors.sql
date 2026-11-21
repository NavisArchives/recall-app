-- 006: What Margaret loves, and two small corrections.
--
-- important_anchors is a short free-text line the admin maintains — the
-- things that reliably reach her ("Loves: …" on the dashboard). It is a
-- plain column, not JSON, because settings is a typed one-row table.
--
-- Also: her surname is "Fournier", not "Fournier", and demo channel 04
-- gets a real English title.

alter table settings add column if not exists important_anchors text;

update settings
set important_anchors = 'Coffee in the garden, old songs on the radio, walks by the river'
where important_anchors is null;

update settings
set full_name = 'Margaret Fournier'
where lower(replace(full_name, ' ', '')) = 'margaretfournier';

update channels
set title = 'Sunday with Family'
where number = 4 and title = 'TEST';

-- ── Self-verifying checklist ─────────────────────────────────────────────
-- Each row must say OK. A silent "no rows" means the migration did nothing.

select 'important_anchors column' as check,
       case when exists (
         select 1 from information_schema.columns
         where table_name = 'settings' and column_name = 'important_anchors'
       ) then 'OK' else 'MISSING' end as result
union all
select 'anchors seeded',
       case when exists (select 1 from settings where important_anchors is not null)
            then 'OK' else 'MISSING' end
union all
select 'name is Fournier',
       case when exists (select 1 from settings where full_name = 'Margaret Fournier')
            then 'OK' else 'CHECK MANUALLY' end
union all
select 'channel 04 renamed',
       case when exists (select 1 from channels where number = 4 and title = 'Sunday with Family')
            then 'OK' else 'CHECK MANUALLY' end;
