-- Phase 4.2, decision D4: nobody pays their own reimbursement.
--
-- ============================================================================
-- RELEASE ORDER: APPLY AFTER THE NEW FRONTEND IS LIVE. The deployed frontend
-- still shows "Mark paid" on an executive's own approved request; this file makes
-- the database refuse that payment. The new frontend hides the button and says
-- why, so the order is: deploy the frontend, then apply this file. (Applied
-- earlier nothing breaks: the old screen answers with the sentence below.)
-- ============================================================================
--
-- Self-review was already blocked (review_personal_reimbursement and
-- request_reimbursement_changes, 20261127000000): an executive's own request
-- needs another executive. Paying was not: another executive could approve it, and
-- then the requester could pay it out to themselves. pay_personal_reimbursement
-- now refuses a request whose member is the caller, whatever its status, with the
-- same wording as the review rule. Everything else in it is the version of
-- 20261127050100 (lock order: expense, then reimbursement).
--
-- Looked at and NOT changed (the plan names only self-review and self-payment; see
-- the report of this phase): void_finance_payment lets an executive void the
-- payment of their own reimbursement, record_club_expense lets an executive record
-- a club purchase to any vendor name with no second person, and the claim functions
-- let the executive who built a claim also approve it and record its receipts.

create or replace function public.pay_personal_reimbursement(
  p_reimbursement_id bigint,
  p_payment_date date,
  p_account_name text default 'Club bank account'
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  reimbursement public.personal_reimbursements;
  expense public.finance_expenses;
  payment_id bigint;
begin
  if not private.is_executive() then raise exception 'executive permission required'; end if;
  select * into reimbursement from public.personal_reimbursements where id = p_reimbursement_id;
  if found and reimbursement.member_id = (select auth.uid()) then
    raise exception 'You cannot pay your own reimbursement. Ask another executive.' using errcode = '42501';
  end if;
  if found then perform private.lock_finance_expenses(array[reimbursement.expense_id]); end if;
  select * into reimbursement from public.personal_reimbursements
  where id = p_reimbursement_id and status = 'approved' for update;
  if not found then raise exception 'approved reimbursement not found'; end if;
  select * into expense from public.finance_expenses where id = reimbursement.expense_id;

  insert into public.finance_payments (
    direction, purpose, amount, description, category, account_name,
    counterparty, payment_date, status, expense_id, reimbursement_id, created_by
  ) values (
    'outflow', 'member_reimbursement', reimbursement.approved_amount,
    'Reimbursement: ' || expense.description, expense.category,
    btrim(coalesce(nullif(p_account_name, ''), 'Club bank account')),
    coalesce((select full_name from public.profiles where id = reimbursement.member_id), 'Club member'),
    p_payment_date, 'posted', expense.id, reimbursement.id, (select auth.uid())
  ) returning id into payment_id;

  update public.personal_reimbursements set status = 'paid', paid_at = now()
  where id = reimbursement.id;
  update public.finance_expenses set status = 'settled' where id = expense.id;
  return payment_id;
end;
$$;

revoke all on function public.pay_personal_reimbursement(bigint, date, text) from public, anon;
grant execute on function public.pay_personal_reimbursement(bigint, date, text) to authenticated;
