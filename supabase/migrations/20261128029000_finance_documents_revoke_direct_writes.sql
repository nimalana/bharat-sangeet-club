-- Phase 4.2, P0-05 / P1-05: finance documents are registered by
-- register_finance_document only; the four tables are read-only for signed-in users.
--
-- ============================================================================
-- RELEASE ORDER: APPLY THIS MIGRATION ONLY AFTER THE NEW FRONTEND IS LIVE.
-- ============================================================================
-- The frontend deployed from main today (and every tab still open on it) registers an
-- upload with direct inserts into finance_documents and the three link tables. Applied
-- before the new frontend, every upload answers 42501 "permission denied" and the
-- request is saved without its receipt. The order is:
--   1. apply 20261128020000_finance_register_document.sql (it only adds a function),
--   2. deploy the new frontend, which calls register_finance_document, and check an upload,
--   3. apply this file.
-- Undo, for one table, if something unexpected needs the old path back for a day:
--   grant insert on public.finance_documents to authenticated;
-- plus the policy that went (the old text is in 20260812193000_finance_workflows.sql).
--
-- What it does:
--   * takes every privilege on the four tables from anon and authenticated and gives
--     authenticated SELECT back (this is the matrix of 20261127075000 minus INSERT, and
--     it also removes UPDATE, DELETE and TRUNCATE on a database that never had that file:
--     hosted Supabase hands every privilege to those roles by default);
--   * drops the policies that only existed for the inserts ("Members register own finance
--     documents", "Members attach own expense documents", "Members attach own
--     reimbursement documents") and the executives' "manage" policies, which were FOR ALL,
--     so that nothing is left that would let a restored grant write again. Reading is
--     unchanged: the existing view policies already include executives, and the claim
--     links get a select-only policy for them.
--
-- Nothing else can change a registered document row: no function updates one, remove_finance_document
-- is the only function that deletes one, and the storage bucket has no update policy, so the
-- bytes behind a registered path cannot be overwritten either.
-- Tests: supabase/tests/81_finance_register.test.sql and 72_grants_matrix.test.sql.

do $$
declare t text;
begin
  foreach t in array array['finance_documents', 'finance_expense_documents', 'finance_reimbursement_documents', 'finance_claim_documents'] loop
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end;
$$;

drop policy if exists "Members register own finance documents" on public.finance_documents;
drop policy if exists "Members attach own expense documents" on public.finance_expense_documents;
drop policy if exists "Members attach own reimbursement documents" on public.finance_reimbursement_documents;

drop policy if exists "Executives manage finance documents" on public.finance_documents;
drop policy if exists "Executives manage expense document links" on public.finance_expense_documents;
drop policy if exists "Executives manage reimbursement document links" on public.finance_reimbursement_documents;
drop policy if exists "Executives manage claim document links" on public.finance_claim_documents;

-- The other three tables' view policies already read "is_executive() or <own rows>"; the claim links had only
-- the executives' FOR ALL policy.
drop policy if exists "Executives view claim document links" on public.finance_claim_documents;
create policy "Executives view claim document links" on public.finance_claim_documents
for select to authenticated using ((select private.is_executive()));
