-- Phase 4.3: the legacy `transactions` ledger is closed to every signed-in role, reads as well as writes.
--
-- RELEASE ORDER: apply AFTER the new frontend is live (section "Apply after the frontend is live" of
-- docs/RELEASE_ORDER.md), with the other two grant migrations of that section. It removes a privilege;
-- nothing in this repository reads the table (the contract check lists every table the screens use and
-- this is not one of them), but the deployed frontend is not this repository.
--
-- Where this stood (register line "revoke writes on legacy transactions", plan 4.3):
--   * WRITES were already closed by 20261127075000_least_privilege_grants.sql: `transactions` was
--     given SELECT only, and 72_grants_matrix.test.sql proves an executive's insert, update, delete
--     and truncate fail with 42501 (a row per table, and a probe "executive: delete from the legacy
--     ledger"). The same matrix shows every table the frontend writes is granted exactly the
--     operations the screens use and nothing more, so no other unused table has a write privilege.
--   * What was left open is the READ: executives could still `select` the old ledger (amounts,
--     categories, receipt paths) through a table no screen shows. No function, policy, view or
--     trigger of this database reads it either (checked against pg_proc, pg_policies and pg_views),
--     so nothing depends on that grant. It is revoked here. The rows stay in the table: the owner and
--     the service role keep them, so an administrator can still export the ledger from the SQL editor.
--
-- The old row level security policies stay in place (they are dead without a privilege); dropping them
-- would add nothing and would make this migration depend on their names.
--
-- Not touched: resource_links, resource_tags and resource_tag_assignments are also read by no screen, but
-- they belong to the resources feature (their rows follow resources and are readable only through
-- can_view_resource) and keep SELECT. Safe to run twice.
-- Tests: 72_grants_matrix.test.sql (matrix row and a probe), 77_legacy_ledger.test.sql.

do $$
begin
  if to_regclass('public.transactions') is not null then
    revoke all on table public.transactions from public, anon, authenticated;
  end if;
end $$;
