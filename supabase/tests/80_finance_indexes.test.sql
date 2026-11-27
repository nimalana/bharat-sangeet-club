-- Finance fixes: the list indexes 20261127012000 meant to create (review finding
-- finance-10). `create index if not exists` compares names only, so the ledger
-- index kept its old one-column definition. The ledger sorts by date then id.
begin;
do $$
begin
  assert exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'finance_payments_date_id_idx'
                 and indexdef like '%(payment_date DESC, id DESC)'), 'ledger index covers date and id';
  assert not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'finance_payments_date_idx'), 'the one-column index it replaces is gone';
  assert exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'admin_audit_log_created_id_idx'
                 and indexdef like '%(created_at DESC, id DESC)'), 'audit list index covers date and id';
  assert (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'events' and indexdef like '%USING btree (starts_at)') = 1, 'events.starts_at is indexed once';
  assert (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'announcements' and indexdef like '%(is_pinned DESC, published_at DESC)'
          and indexdef not like '%subgroup_id%') = 1, 'the announcement feed is indexed once';
end $$;
rollback;
