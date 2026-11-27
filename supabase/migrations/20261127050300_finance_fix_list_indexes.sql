-- Finance fixes, part 4: the list indexes that 20261127012000 meant to create
-- (review finding finance-10).
--
-- `create index if not exists` compares names only. finance_payments_date_idx
-- and admin_audit_log_created_idx already existed on one column, so the
-- two-column versions (the ledger and the audit list sort by date, then id)
-- were silently skipped. events_starts_idx and announcements_feed_idx repeat
-- indexes that already existed and only slow down writes.
--
-- New names for the intended indexes; each superseded index is dropped only
-- after its replacement exists, and a duplicate only when an identical index is
-- still there, because production may differ from the migration files.
create index if not exists finance_payments_date_id_idx on public.finance_payments (payment_date desc, id desc);
create index if not exists admin_audit_log_created_id_idx on public.admin_audit_log (created_at desc, id desc);

do $$
declare
  pair record;
  drop_def text;
  keep_def text;
begin
  for pair in
    select * from (values
      -- (index to drop, index that replaces it, must the definitions be identical?)
      ('finance_payments_date_idx', 'finance_payments_date_id_idx', false),
      ('admin_audit_log_created_idx', 'admin_audit_log_created_id_idx', false),
      ('events_starts_idx', 'events_starts_at_idx', true),
      ('announcements_feed_idx', 'announcements_pinned_published_idx', true)
    ) as t(drop_name, keep_name, identical)
  loop
    select regexp_replace(indexdef, '^CREATE (UNIQUE )?INDEX \S+ ON ', 'CREATE \1INDEX x ON ') into drop_def
    from pg_indexes where schemaname = 'public' and indexname = pair.drop_name;
    select regexp_replace(indexdef, '^CREATE (UNIQUE )?INDEX \S+ ON ', 'CREATE \1INDEX x ON ') into keep_def
    from pg_indexes where schemaname = 'public' and indexname = pair.keep_name;
    if drop_def is null or keep_def is null then continue; end if;
    -- A prefix replacement is the old index plus a trailing column; a duplicate must match exactly.
    if (pair.identical and drop_def = keep_def)
       or (not pair.identical and left(keep_def, length(drop_def) - 1) = left(drop_def, length(drop_def) - 1)) then
      execute format('drop index if exists public.%I', pair.drop_name);
    end if;
  end loop;
end;
$$;
