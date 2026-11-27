-- Finance fixes, part 2: one lock order, live-claim guards, closed edits and
-- explicit active-status checks (review findings finance-3, finance-7,
-- finance-8 and finance-9).
--
-- The lock order is written out in 20261127050000_finance_claim_locking.sql:
-- expense, reimbursement, payment, claim, document. Every function below that
-- writes more than one of those rows now follows it. Before this file the
-- member functions locked the reimbursement and then the expense, and the
-- executive functions the other way round, so a member withdrawing a request
-- while an executive voided it could deadlock (one side got error 40P01).
--
-- A claim also no longer loses its expenses behind its back. Withdrawing,
-- declining or editing the money of an expense that sits on a live claim is
-- refused, and the funding_claim_missing check from part 1 catches whatever
-- slips through a direct write before a claim can be marked ready or
-- submitted.

-- ---------------------------------------------------------------------------
-- Helpers (not callable by clients)
-- ---------------------------------------------------------------------------
-- True when the expense is on a claim the funder has the paper for: submitted,
-- decided or paid. Claims that are still being assembled (or sent back for
-- changes) leave the expense editable.
create or replace function private.expense_on_frozen_claim(p_expense_id bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.funding_claim_expenses link
    join public.funding_claims claim on claim.id = link.claim_id
    where link.expense_id = p_expense_id
      and claim.status not in ('draft', 'incomplete', 'ready', 'changes_requested', 'voided')
  );
$$;
revoke all on function private.expense_on_frozen_claim(bigint) from public, anon, authenticated;

-- Locks the given claims (ascending id) and sends back to "incomplete" any that
-- were "ready" but no longer meet the checklist. Callers hold the expense,
-- reimbursement and payment locks already; claims come last in the lock order.
create or replace function private.reopen_claims_missing_evidence(p_claim_ids bigint[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(array_length(p_claim_ids, 1), 0) = 0 then return; end if;
  perform 1 from public.funding_claims where id = any (p_claim_ids) order by id for update;
  update public.funding_claims claim
  set status = 'incomplete', updated_by = (select auth.uid())
  where claim.id = any (p_claim_ids) and claim.status = 'ready'
    and coalesce(array_length(private.funding_claim_missing(claim.id), 1), 0) > 0;
end;
$$;
revoke all on function private.reopen_claims_missing_evidence(bigint[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Void a payment: expense, reimbursement, payment (and its transfer partner), claim
-- ---------------------------------------------------------------------------
create or replace function public.void_finance_payment(p_payment_id bigint, p_reason text)
returns public.finance_payments
language plpgsql security definer set search_path = '' as $$
declare
  payment public.finance_payments;
  result public.finance_payments;
  claim public.funding_claims;
  v_reason text;
  v_actor uuid := (select auth.uid());
  next_received numeric;
begin
  if not private.is_executive() then raise exception 'executive permission required' using errcode = '42501'; end if;
  v_reason := private.require_void_reason(p_reason);

  -- Read the payment without a lock to learn what it touches, lock in order,
  -- then read it again.
  select * into payment from public.finance_payments where id = p_payment_id;
  if not found then raise exception 'Payment not found' using errcode = 'P0002'; end if;
  if payment.expense_id is not null then perform private.lock_finance_expenses(array[payment.expense_id]); end if;
  if payment.reimbursement_id is not null then
    perform 1 from public.personal_reimbursements where id = payment.reimbursement_id for update;
  end if;
  if payment.purpose = 'transfer' and payment.transfer_group_id is not null then
    perform 1 from public.finance_payments where transfer_group_id = payment.transfer_group_id order by id for update;
  else
    perform 1 from public.finance_payments where id = payment.id for update;
  end if;
  select * into payment from public.finance_payments where id = p_payment_id;
  if payment.status = 'voided' then raise exception 'This payment is already voided' using errcode = '22023'; end if;

  if payment.purpose = 'direct_expense' and payment.expense_id is not null then
    if private.expense_on_live_claim(payment.expense_id) then
      raise exception 'This expense is part of a funding claim. Remove it from the claim first.' using errcode = '22023';
    end if;
    update public.finance_expenses
    set status = 'voided', void_reason = v_reason, voided_by = v_actor, voided_at = now()
    where id = payment.expense_id and status <> 'voided';
  elsif payment.purpose = 'member_reimbursement' and payment.reimbursement_id is not null then
    update public.personal_reimbursements set status = 'approved', paid_at = null
    where id = payment.reimbursement_id and status = 'paid';
    update public.finance_expenses set status = 'approved'
    where id = payment.expense_id and status = 'settled';
  elsif payment.purpose = 'external_reimbursement' and payment.funding_claim_id is not null then
    select * into claim from public.funding_claims where id = payment.funding_claim_id for update;
    next_received := greatest(0, claim.received_amount - payment.amount);
    update public.funding_claims
    set received_amount = next_received,
        status = case when status in ('paid', 'partially_paid')
                      then case when next_received > 0 then 'partially_paid' else 'approved' end
                      else status end,
        updated_by = v_actor
    where id = claim.id;
  end if;

  update public.finance_payments
  set status = 'voided', void_reason = v_reason, voided_by = v_actor, voided_at = now()
  where id = payment.id
  returning * into result;

  -- Both sides of a transfer stand or fall together.
  if payment.purpose = 'transfer' and payment.transfer_group_id is not null then
    update public.finance_payments
    set status = 'voided', void_reason = v_reason, voided_by = v_actor, voided_at = now()
    where transfer_group_id = payment.transfer_group_id and status <> 'voided';
  end if;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Void an expense: expense, reimbursement, payments
-- ---------------------------------------------------------------------------
create or replace function public.void_finance_expense(p_expense_id bigint, p_reason text)
returns public.finance_expenses
language plpgsql security definer set search_path = '' as $$
declare
  expense public.finance_expenses;
  result public.finance_expenses;
  v_reason text;
  v_actor uuid := (select auth.uid());
begin
  if not private.is_executive() then raise exception 'executive permission required' using errcode = '42501'; end if;
  v_reason := private.require_void_reason(p_reason);
  select * into expense from public.finance_expenses where id = p_expense_id for update;
  if not found then raise exception 'Expense not found' using errcode = 'P0002'; end if;
  if expense.status = 'voided' then raise exception 'This expense is already voided' using errcode = '22023'; end if;
  perform 1 from public.personal_reimbursements where expense_id = expense.id for update;
  perform 1 from public.finance_payments where expense_id = expense.id order by id for update;
  if private.expense_on_live_claim(expense.id) then
    raise exception 'This expense is part of a funding claim. Remove it from the claim first.' using errcode = '22023';
  end if;

  if expense.paid_by = 'club' then
    -- A club purchase and its payment were recorded together and go together.
    update public.finance_payments
    set status = 'voided', void_reason = v_reason, voided_by = v_actor, voided_at = now()
    where expense_id = expense.id and purpose = 'direct_expense' and status <> 'voided';
  else
    if exists (select 1 from public.finance_payments where expense_id = expense.id and status <> 'voided') then
      raise exception 'This purchase has been reimbursed. Void the reimbursement payment first.' using errcode = '22023';
    end if;
    update public.personal_reimbursements
    set status = 'voided', void_reason = v_reason, voided_by = v_actor, voided_at = now()
    where expense_id = expense.id and status <> 'voided';
  end if;

  update public.finance_expenses
  set status = 'voided', void_reason = v_reason, voided_by = v_actor, voided_at = now()
  where id = expense.id
  returning * into result;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Edit an expense: expense, reimbursement, payment, claim
-- ---------------------------------------------------------------------------
-- New: nothing can be edited once the expense is on a claim that has been
-- submitted (the funder holds the paper), and the amount and date cannot move
-- while it is on any live claim. After an edit, a claim marked "ready" is
-- checked again and goes back to "incomplete" if the edit broke it.
create or replace function public.update_finance_expense(
  p_expense_id bigint, p_description text, p_vendor text, p_category text, p_payment_card_last4 text default null,
  p_subgroup_id bigint default null, p_club_event_id bigint default null, p_event_related boolean default false,
  p_event_name text default '', p_event_starts_at timestamptz default null, p_event_attendee_count integer default null,
  p_event_schedule text default '', p_amount numeric default null, p_purchase_date date default null
) returns public.finance_expenses
language plpgsql security definer set search_path = '' as $$
declare
  expense public.finance_expenses;
  result public.finance_expenses;
  money_changed boolean;
  v_claim_ids bigint[];
begin
  if not private.is_executive() then raise exception 'executive permission required' using errcode = '42501'; end if;
  select * into expense from public.finance_expenses where id = p_expense_id for update;
  if not found then raise exception 'Expense not found' using errcode = 'P0002'; end if;
  if expense.status = 'voided' then raise exception 'A voided expense cannot be edited' using errcode = '22023'; end if;
  perform 1 from public.personal_reimbursements where expense_id = p_expense_id for update;
  perform 1 from public.finance_payments where expense_id = p_expense_id order by id for update;
  if private.expense_on_frozen_claim(p_expense_id) then
    raise exception 'This expense is on a funding claim that has been submitted, so its details are locked.' using errcode = '22023';
  end if;

  money_changed := (p_amount is not null and p_amount <> expense.amount)
    or (p_purchase_date is not null and p_purchase_date <> expense.purchase_date);
  if money_changed and expense.status not in ('draft', 'submitted') then
    raise exception 'The amount and date are locked once an expense is approved. Void it and enter it again.' using errcode = '22023';
  end if;
  if money_changed and private.expense_on_live_claim(p_expense_id) then
    raise exception 'This expense is part of a funding claim. Remove it from the claim first.' using errcode = '22023';
  end if;

  result := private.apply_expense_details(p_expense_id, p_description, p_vendor, p_category, p_payment_card_last4,
    p_subgroup_id, p_club_event_id, p_event_related, p_event_name, p_event_starts_at, p_event_attendee_count,
    p_event_schedule, case when money_changed then p_amount end, case when money_changed then p_purchase_date end);

  if money_changed and p_amount is not null then
    update public.personal_reimbursements set requested_amount = p_amount
    where expense_id = p_expense_id and status in ('draft', 'submitted', 'changes_requested');
  end if;
  -- Keep the ledger line for a club purchase readable.
  update public.finance_payments
  set description = result.description, category = result.category, counterparty = result.vendor
  where expense_id = p_expense_id and purpose = 'direct_expense' and status <> 'voided';

  select coalesce(array_agg(claim_id order by claim_id), '{}') into v_claim_ids
  from public.funding_claim_expenses where expense_id = p_expense_id;
  perform private.reopen_claims_missing_evidence(v_claim_ids);
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Member: edit or withdraw a request that has not been decided
-- Order: expense, then reimbursement. Active status is checked in the function.
-- ---------------------------------------------------------------------------
create or replace function public.update_member_reimbursement(
  p_reimbursement_id bigint, p_description text, p_vendor text, p_amount numeric, p_purchase_date date,
  p_category text, p_payment_card_last4 text, p_member_note text default '', p_subgroup_id bigint default null,
  p_club_event_id bigint default null, p_event_related boolean default false, p_event_name text default '',
  p_event_starts_at timestamptz default null, p_event_attendee_count integer default null, p_event_schedule text default ''
) returns public.personal_reimbursements
language plpgsql security definer set search_path = '' as $$
declare
  reimbursement public.personal_reimbursements;
  result public.personal_reimbursements;
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not private.is_active_member() then
    raise exception 'Your access to the portal has been deactivated' using errcode = '42501';
  end if;
  select * into reimbursement from public.personal_reimbursements where id = p_reimbursement_id;
  if not found or reimbursement.member_id <> v_actor then
    raise exception 'Reimbursement request not found' using errcode = 'P0002';
  end if;
  perform private.lock_finance_expenses(array[reimbursement.expense_id]);
  select * into reimbursement from public.personal_reimbursements where id = p_reimbursement_id for update;
  if reimbursement.status not in ('submitted', 'changes_requested') then
    raise exception 'This request has already been decided and can no longer be edited' using errcode = '22023';
  end if;
  if private.expense_on_live_claim(reimbursement.expense_id) then
    raise exception 'This request is part of a funding claim, so it cannot be changed. Ask an executive to remove it from the claim first.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be greater than zero' using errcode = '22023'; end if;
  if p_payment_card_last4 is null or p_payment_card_last4 !~ '^[0-9]{4}$' then
    raise exception 'the payment card last four digits are required' using errcode = '22023';
  end if;
  if p_subgroup_id is not null and not private.is_executive() and not exists (
    select 1 from public.subgroup_memberships membership
    where membership.subgroup_id = p_subgroup_id and membership.member_id = v_actor and membership.status = 'active'
  ) then
    raise exception 'active subgroup membership required' using errcode = '42501';
  end if;

  perform private.apply_expense_details(reimbursement.expense_id, p_description, p_vendor, p_category, p_payment_card_last4,
    p_subgroup_id, p_club_event_id, p_event_related, p_event_name, p_event_starts_at, p_event_attendee_count,
    p_event_schedule, p_amount, p_purchase_date);
  update public.finance_expenses set notes = btrim(coalesce(p_member_note, '')), status = 'submitted'
  where id = reimbursement.expense_id;

  -- Saving sends it back to the reviewers.
  update public.personal_reimbursements
  set requested_amount = p_amount, member_note = btrim(coalesce(p_member_note, '')), status = 'submitted'
  where id = reimbursement.id
  returning * into result;
  return result;
end;
$$;

create or replace function public.withdraw_member_reimbursement(p_reimbursement_id bigint)
returns public.personal_reimbursements
language plpgsql security definer set search_path = '' as $$
declare
  reimbursement public.personal_reimbursements;
  result public.personal_reimbursements;
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not private.is_active_member() then
    raise exception 'Your access to the portal has been deactivated' using errcode = '42501';
  end if;
  select * into reimbursement from public.personal_reimbursements where id = p_reimbursement_id;
  if not found or reimbursement.member_id <> v_actor then
    raise exception 'Reimbursement request not found' using errcode = 'P0002';
  end if;
  perform private.lock_finance_expenses(array[reimbursement.expense_id]);
  select * into reimbursement from public.personal_reimbursements where id = p_reimbursement_id for update;
  if reimbursement.status not in ('submitted', 'changes_requested') then
    raise exception 'This request has already been decided and can no longer be withdrawn' using errcode = '22023';
  end if;
  if private.expense_on_live_claim(reimbursement.expense_id) then
    raise exception 'This request is part of a funding claim, so it cannot be withdrawn. Ask an executive to remove it from the claim first.' using errcode = '22023';
  end if;
  update public.finance_expenses
  set status = 'voided', void_reason = 'Withdrawn by member', voided_by = v_actor, voided_at = now()
  where id = reimbursement.expense_id;
  update public.personal_reimbursements
  set status = 'voided', void_reason = 'Withdrawn by member', voided_by = v_actor, voided_at = now()
  where id = reimbursement.id
  returning * into result;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reviewer decision and payment: expense, then reimbursement
-- ---------------------------------------------------------------------------
create or replace function public.review_personal_reimbursement(p_reimbursement_id bigint, p_decision text, p_approved_amount numeric default null, p_review_note text default '')
returns public.personal_reimbursements
language plpgsql security definer set search_path = '' as $$
declare
  result public.personal_reimbursements;
  v_expense_id bigint;
begin
  if not private.is_executive() then raise exception 'executive permission required'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'invalid reimbursement decision'; end if;
  if exists (
    select 1 from public.personal_reimbursements
    where id = p_reimbursement_id and member_id = (select auth.uid())
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
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
  where reimbursement.id = p_reimbursement_id and reimbursement.status = 'submitted'
  returning * into result;
  if not found then raise exception 'submitted reimbursement not found'; end if;
  update public.finance_expenses
  set status = p_decision, approved_by = (select auth.uid()), approved_at = now()
  where id = result.expense_id;
  return result;
end;
$$;

-- Same behaviour as before (self-payment stays a Phase 4 item); only the lock
-- order changes: the expense is locked before the reimbursement.
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

-- ---------------------------------------------------------------------------
-- Member submits a request: the same function, with the explicit active check
-- ---------------------------------------------------------------------------
create or replace function public.submit_member_reimbursement(
  p_description text,
  p_vendor text,
  p_amount numeric,
  p_purchase_date date,
  p_category text,
  p_payment_card_last4 text,
  p_member_note text default '',
  p_subgroup_id bigint default null,
  p_club_event_id bigint default null,
  p_event_related boolean default false,
  p_event_name text default '',
  p_event_starts_at timestamptz default null,
  p_event_attendee_count integer default null,
  p_event_schedule text default ''
)
returns table (expense_id bigint, reimbursement_id bigint)
language plpgsql security definer set search_path = '' as $$
declare current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then raise exception 'authentication required'; end if;
  if not private.is_active_member() then
    raise exception 'Your access to the portal has been deactivated' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be greater than zero'; end if;
  if p_payment_card_last4 is null or p_payment_card_last4 !~ '^[0-9]{4}$' then
    raise exception 'the payment card last four digits are required';
  end if;
  if p_subgroup_id is not null and not exists (
    select 1 from public.subgroup_memberships membership
    where membership.subgroup_id = p_subgroup_id
      and membership.member_id = current_user_id
      and membership.status = 'active'
  ) and not private.is_executive() then
    raise exception 'active subgroup membership required';
  end if;

  insert into public.finance_expenses (
    description, vendor, amount, purchase_date, category, paid_by,
    paid_by_member_id, payment_card_last4, subgroup_id, club_event_id, event_related,
    event_name, event_starts_at, event_attendee_count, event_schedule,
    status, notes, created_by
  ) values (
    btrim(p_description), btrim(coalesce(p_vendor, '')), p_amount, p_purchase_date,
    btrim(p_category), 'member', current_user_id, p_payment_card_last4,
    p_subgroup_id, p_club_event_id, coalesce(p_event_related, false), btrim(coalesce(p_event_name, '')),
    p_event_starts_at, p_event_attendee_count, btrim(coalesce(p_event_schedule, '')),
    'submitted', btrim(coalesce(p_member_note, '')), current_user_id
  ) returning id into expense_id;

  insert into public.personal_reimbursements (
    expense_id, member_id, requested_amount, status, member_note
  ) values (
    expense_id, current_user_id, p_amount, 'submitted', btrim(coalesce(p_member_note, ''))
  ) returning id into reimbursement_id;
  return next;
end;
$$;

-- Grants are kept by create or replace; restate them so a re-run, or a database
-- where they drifted, ends in the same place.
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.void_finance_payment(bigint, text)',
    'public.void_finance_expense(bigint, text)',
    'public.update_finance_expense(bigint, text, text, text, text, bigint, bigint, boolean, text, timestamptz, integer, text, numeric, date)',
    'public.update_member_reimbursement(bigint, text, text, numeric, date, text, text, text, bigint, bigint, boolean, text, timestamptz, integer, text)',
    'public.withdraw_member_reimbursement(bigint)',
    'public.review_personal_reimbursement(bigint, text, numeric, text)',
    'public.pay_personal_reimbursement(bigint, date, text)',
    'public.submit_member_reimbursement(text, text, numeric, date, text, text, text, bigint, bigint, boolean, text, timestamptz, integer, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;
