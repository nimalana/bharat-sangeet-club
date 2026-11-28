-- Phase 4.2, P2-05: the claim row is locked too when a link is written.
--
-- ============================================================================
-- RELEASE ORDER: APPLY BEFORE THE NEW FRONTEND. No behaviour changes for any
-- single caller; two writers of the same claim now take turns.
-- ============================================================================
--
-- What 20261127050000 and 20261127050100 already did: every function that writes
-- the allocation of a claim (create_funding_claim, add_funding_claim_expense,
-- remove_funding_claim_expense, void_funding_claim and the voids that release an
-- expense) takes the expense lock first and the claim lock second, in ascending
-- id, and the link trigger took the expense lock before it summed what the
-- expense was already allocated. supabase/tests/concurrency/80_finance_locks.sh
-- exercises create/create, add/add, void/create and void/add in two sessions.
--
-- What was still open: the trigger read the claim's requested_amount and the sum
-- of the claim's other links WITHOUT locking the claim. The functions above are
-- safe, because add_funding_claim_expense holds the claim lock before it inserts.
-- A link written straight into funding_claim_expenses is not covered by them:
-- two sessions linking two DIFFERENT expenses to the same claim each lock their
-- own expense, each sum the claim's existing links without seeing the other's
-- uncommitted one, and both pass, so the claim can end up allocated above its
-- requested total. Direct writes were possible for executives until
-- 20261127075000 (least privilege) takes INSERT away; that file is still to be
-- applied on a database that has not had it, so the trigger closes the gap itself.
--
-- The lock order stays expense, then claim. Callers that already hold the claim
-- (add_funding_claim_expense) or just inserted it (create_funding_claim) are not
-- affected: locking a row you hold is free.

create or replace function private.validate_claim_expense_amounts()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  expense_total numeric;
  expense_status text;
  claim_total numeric;
  allocated_total numeric;
begin
  select amount, status into expense_total, expense_status
  from public.finance_expenses where id = new.expense_id for update;
  if tg_op = 'INSERT' and expense_status in ('voided', 'rejected') then
    raise exception 'That expense cannot be claimed' using errcode = '22023';
  end if;
  -- New: the claim is locked before its allocation is summed (expense first, claim second).
  select requested_amount into claim_total from public.funding_claims where id = new.claim_id for update;
  select coalesce(sum(claimed_amount), 0) into allocated_total
  from public.funding_claim_expenses
  where expense_id = new.expense_id
    and (claim_id, expense_id) <> (new.claim_id, new.expense_id);
  if allocated_total + new.claimed_amount > expense_total then
    raise exception 'claims cannot exceed the expense amount';
  end if;
  select coalesce(sum(claimed_amount), 0) into allocated_total
  from public.funding_claim_expenses
  where claim_id = new.claim_id
    and (claim_id, expense_id) <> (new.claim_id, new.expense_id);
  if allocated_total + new.claimed_amount > claim_total then
    raise exception 'claim expenses cannot exceed the requested amount';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_claim_expense_amounts() from public;
