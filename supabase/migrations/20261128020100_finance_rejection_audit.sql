-- Phase 4.2, P2-01: a rejection is not an approval.
--
-- ============================================================================
-- RELEASE ORDER: APPLY BEFORE THE NEW FRONTEND. Adds two nullable columns and
-- changes what review_personal_reimbursement writes; nothing the deployed
-- frontend reads (it never reads approved_by or approved_at) changes.
-- ============================================================================
--
-- review_personal_reimbursement set approved_by and approved_at on the expense
-- for BOTH decisions, so a declined purchase looked like one somebody had
-- approved, and the audit rows (a generic "update") did not say which it was.
--
--   * finance_expenses gets rejected_by and rejected_at, the counterparts of the
--     approved_* pair (and of voided_by / voided_at). A decline fills those and
--     leaves approved_by and approved_at empty; an approval fills the approved_*
--     pair and leaves the rejected_* pair empty.
--   * Rows already declined are corrected: their approved_* values move to
--     rejected_*. (The audit trigger records each of those updates, with no actor.)
--   * The decision also writes one finance_audit_log row of its own, on the
--     request, labelled 'approved' or 'rejected', with the amount, the note and
--     the reviewer, so the history reads as what happened. The generic
--     'update' rows the triggers write stay as they are.
--
-- The reviewer of the request is still recorded on personal_reimbursements
-- (reviewed_by, reviewed_at), for both decisions, as before.

alter table public.finance_expenses
  add column if not exists rejected_by uuid references public.profiles(id) on delete set null,
  add column if not exists rejected_at timestamptz;

create index if not exists finance_expenses_rejected_by_idx
  on public.finance_expenses(rejected_by) where rejected_by is not null;

-- Existing rejections: what was written as an approval was the decline.
update public.finance_expenses
set rejected_by = approved_by, rejected_at = approved_at, approved_by = null, approved_at = null
where status = 'rejected' and approved_by is not null and rejected_by is null;

create or replace function public.review_personal_reimbursement(p_reimbursement_id bigint, p_decision text, p_approved_amount numeric default null, p_review_note text default '')
returns public.personal_reimbursements
language plpgsql security definer set search_path = '' as $$
declare
  result public.personal_reimbursements;
  v_expense_id bigint;
  v_actor uuid := (select auth.uid());
begin
  if not private.is_executive() then raise exception 'executive permission required'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'invalid reimbursement decision'; end if;
  if exists (
    select 1 from public.personal_reimbursements
    where id = p_reimbursement_id and member_id = v_actor
  ) then
    raise exception 'You cannot review your own reimbursement. Ask another executive.' using errcode = '42501';
  end if;
  select expense_id into v_expense_id from public.personal_reimbursements where id = p_reimbursement_id;
  if not found then raise exception 'submitted reimbursement not found'; end if;
  perform private.lock_finance_expenses(array[v_expense_id]);
  if p_decision = 'rejected' and private.expense_on_live_claim(v_expense_id) then
    raise exception 'This request is part of a funding claim. Remove it from the claim first.' using errcode = '22023';
  end if;
  update public.personal_reimbursements reimbursement
  set status = p_decision,
      approved_amount = case when p_decision = 'approved' then coalesce(p_approved_amount, reimbursement.requested_amount) else null end,
      review_note = btrim(coalesce(p_review_note, '')),
      reviewed_by = v_actor,
      reviewed_at = now()
  where reimbursement.id = p_reimbursement_id and reimbursement.status = 'submitted'
  returning * into result;
  if not found then raise exception 'submitted reimbursement not found'; end if;

  -- An approval fills the approved_* pair, a decline the rejected_* pair; neither touches the other.
  update public.finance_expenses
  set status = p_decision,
      approved_by = case when p_decision = 'approved' then v_actor else approved_by end,
      approved_at = case when p_decision = 'approved' then now() else approved_at end,
      rejected_by = case when p_decision = 'rejected' then v_actor else rejected_by end,
      rejected_at = case when p_decision = 'rejected' then now() else rejected_at end
  where id = result.expense_id;

  insert into public.finance_audit_log (entity_type, entity_id, action, actor_id, before_data, after_data)
  values ('personal_reimbursements', result.id, p_decision, v_actor,
    jsonb_build_object('status', 'submitted', 'requested_amount', result.requested_amount),
    jsonb_build_object('status', result.status, 'approved_amount', result.approved_amount, 'review_note', result.review_note,
      'reviewed_by', result.reviewed_by, 'reviewed_at', result.reviewed_at, 'expense_id', result.expense_id));
  return result;
end;
$$;

revoke all on function public.review_personal_reimbursement(bigint, text, numeric, text) from public, anon;
grant execute on function public.review_personal_reimbursement(bigint, text, numeric, text) to authenticated;
