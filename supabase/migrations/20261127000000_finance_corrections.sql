-- Finance corrections (P1-12, P2-02, P2-03, P2-04, P2-07, P2-13).
--
-- Nothing in finance is ever hard-deleted. Mistakes are corrected by voiding,
-- and every change goes through an audited function. The rules:
--
--   Payment, income                 void marks it voided
--   Payment, direct club expense    void also voids its expense
--   Payment, member reimbursement   void returns the reimbursement and its
--                                   expense to "approved"
--   Payment, funding received       void lowers the claim's received amount
--                                   and recomputes its status
--   Member expense + reimbursement  voided together, only when no live payment
--                                   and no live claim uses the expense
--   Funding claim                   voided only when no live receipts; its
--                                   expenses are released

alter table public.finance_expenses
  add column if not exists voided_by uuid references public.profiles(id) on delete set null,
  add column if not exists voided_at timestamptz;

alter table public.personal_reimbursements
  add column if not exists void_reason text,
  add column if not exists voided_by uuid references public.profiles(id) on delete set null,
  add column if not exists voided_at timestamptz;

alter table public.funding_claims
  add column if not exists void_reason text,
  add column if not exists voided_by uuid references public.profiles(id) on delete set null,
  add column if not exists voided_at timestamptz;

-- Widening only: the current frontend never writes this value.
alter table public.personal_reimbursements drop constraint if exists personal_reimbursements_status_check;
alter table public.personal_reimbursements add constraint personal_reimbursements_status_check
  check (status in ('draft', 'submitted', 'changes_requested', 'approved', 'rejected', 'paid', 'voided'));

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable by clients)
-- ---------------------------------------------------------------------------
create or replace function private.require_void_reason(p_reason text)
returns text language plpgsql immutable set search_path = '' as $$
declare v_reason text := btrim(coalesce(p_reason, ''));
begin
  if char_length(v_reason) < 3 then
    raise exception 'Say why this is being voided' using errcode = '22023';
  end if;
  return left(v_reason, 500);
end;
$$;

create or replace function private.expense_on_live_claim(p_expense_id bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.funding_claim_expenses link
    join public.funding_claims claim on claim.id = link.claim_id
    where link.expense_id = p_expense_id and claim.status <> 'voided'
  );
$$;

revoke all on function private.require_void_reason(text) from public, anon, authenticated;
revoke all on function private.expense_on_live_claim(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Void a payment
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
  select * into payment from public.finance_payments where id = p_payment_id for update;
  if not found then raise exception 'Payment not found' using errcode = 'P0002'; end if;
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
-- Void an expense
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
-- Edit an expense
-- ---------------------------------------------------------------------------
create or replace function private.apply_expense_details(
  p_expense_id bigint, p_description text, p_vendor text, p_category text, p_payment_card_last4 text,
  p_subgroup_id bigint, p_club_event_id bigint, p_event_related boolean, p_event_name text,
  p_event_starts_at timestamptz, p_event_attendee_count integer, p_event_schedule text,
  p_amount numeric, p_purchase_date date
) returns public.finance_expenses
language plpgsql security definer set search_path = '' as $$
declare result public.finance_expenses;
begin
  if p_payment_card_last4 is not null and p_payment_card_last4 !~ '^[0-9]{4}$' then
    raise exception 'card last four must contain four digits' using errcode = '22023';
  end if;
  if p_amount is not null and p_amount <= 0 then
    raise exception 'amount must be greater than zero' using errcode = '22023';
  end if;
  update public.finance_expenses
  set description = btrim(p_description), vendor = btrim(coalesce(p_vendor, '')), category = btrim(p_category),
      payment_card_last4 = p_payment_card_last4, subgroup_id = p_subgroup_id, club_event_id = p_club_event_id,
      event_related = coalesce(p_event_related, false), event_name = btrim(coalesce(p_event_name, '')),
      event_starts_at = p_event_starts_at, event_attendee_count = p_event_attendee_count,
      event_schedule = btrim(coalesce(p_event_schedule, '')),
      amount = coalesce(p_amount, amount), purchase_date = coalesce(p_purchase_date, purchase_date)
  where id = p_expense_id
  returning * into result;
  return result;
end;
$$;
revoke all on function private.apply_expense_details(bigint, text, text, text, text, bigint, bigint, boolean, text, timestamptz, integer, text, numeric, date) from public, anon, authenticated;

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
begin
  if not private.is_executive() then raise exception 'executive permission required' using errcode = '42501'; end if;
  select * into expense from public.finance_expenses where id = p_expense_id for update;
  if not found then raise exception 'Expense not found' using errcode = 'P0002'; end if;
  if expense.status = 'voided' then raise exception 'A voided expense cannot be edited' using errcode = '22023'; end if;

  money_changed := (p_amount is not null and p_amount <> expense.amount)
    or (p_purchase_date is not null and p_purchase_date <> expense.purchase_date);
  if money_changed and expense.status not in ('draft', 'submitted') then
    raise exception 'The amount and date are locked once an expense is approved. Void it and enter it again.' using errcode = '22023';
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
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Member: edit or withdraw a request that has not been decided
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
  select * into reimbursement from public.personal_reimbursements where id = p_reimbursement_id for update;
  if not found or reimbursement.member_id <> v_actor then
    raise exception 'Reimbursement request not found' using errcode = 'P0002';
  end if;
  if reimbursement.status not in ('submitted', 'changes_requested') then
    raise exception 'This request has already been decided and can no longer be edited' using errcode = '22023';
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
  select * into reimbursement from public.personal_reimbursements where id = p_reimbursement_id for update;
  if not found or reimbursement.member_id <> v_actor then
    raise exception 'Reimbursement request not found' using errcode = 'P0002';
  end if;
  if reimbursement.status not in ('submitted', 'changes_requested') then
    raise exception 'This request has already been decided and can no longer be withdrawn' using errcode = '22023';
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
-- Reviewer: ask for changes; nobody reviews their own request
-- ---------------------------------------------------------------------------
create or replace function public.request_reimbursement_changes(p_reimbursement_id bigint, p_note text)
returns public.personal_reimbursements
language plpgsql security definer set search_path = '' as $$
declare result public.personal_reimbursements;
begin
  if not private.is_executive() then raise exception 'executive permission required' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Tell the member what needs to change' using errcode = '22023';
  end if;
  update public.personal_reimbursements
  set status = 'changes_requested', review_note = left(btrim(p_note), 1000),
      reviewed_by = (select auth.uid()), reviewed_at = now()
  where id = p_reimbursement_id and status = 'submitted' and member_id <> (select auth.uid())
  returning * into result;
  if not found then raise exception 'submitted reimbursement not found' using errcode = 'P0002'; end if;
  return result;
end;
$$;

create or replace function public.review_personal_reimbursement(p_reimbursement_id bigint, p_decision text, p_approved_amount numeric default null, p_review_note text default '')
returns public.personal_reimbursements
language plpgsql security definer set search_path = '' as $$
declare result public.personal_reimbursements;
begin
  if not private.is_executive() then raise exception 'executive permission required'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'invalid reimbursement decision'; end if;
  if exists (
    select 1 from public.personal_reimbursements
    where id = p_reimbursement_id and member_id = (select auth.uid())
  ) then
    raise exception 'You cannot review your own reimbursement. Ask another executive.' using errcode = '42501';
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

-- ---------------------------------------------------------------------------
-- Funding claims
-- ---------------------------------------------------------------------------
create or replace function private.expense_unclaimed_amount(p_expense_id bigint)
returns numeric language sql stable security definer set search_path = '' as $$
  select expense.amount - coalesce((
    select sum(link.claimed_amount) from public.funding_claim_expenses link
    join public.funding_claims claim on claim.id = link.claim_id
    where link.expense_id = expense.id and claim.status <> 'voided'
  ), 0)
  from public.finance_expenses expense where expense.id = p_expense_id;
$$;
revoke all on function private.expense_unclaimed_amount(bigint) from public, anon, authenticated;

-- Returns the unmet requirements for marking a claim ready (empty = ready).
create or replace function private.funding_claim_missing(p_claim_id bigint)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  missing text[] := '{}';
  doc_types text[];
begin
  select coalesce(array_agg(distinct document.document_type), '{}') into doc_types
  from public.finance_claim_documents link
  join public.finance_documents document on document.id = link.document_id
  where link.claim_id = p_claim_id;

  if not exists (select 1 from public.funding_claim_expenses where claim_id = p_claim_id) then
    missing := array_append(missing, 'at least one expense');
  end if;
  if exists (
    select 1 from public.funding_claim_expenses link
    where link.claim_id = p_claim_id and not exists (
      select 1 from public.finance_expense_documents expense_doc
      join public.finance_documents document on document.id = expense_doc.document_id
      where expense_doc.expense_id = link.expense_id and document.document_type = 'receipt')
  ) then
    missing := array_append(missing, 'a receipt for every expense');
  end if;
  if exists (
    select 1 from public.funding_claim_expenses link
    join public.finance_expenses expense on expense.id = link.expense_id
    where link.claim_id = p_claim_id and coalesce(expense.payment_card_last4, '') !~ '^[0-9]{4}$'
  ) then
    missing := array_append(missing, 'card last four on every expense');
  end if;
  if not (doc_types && array['bank_statement', 'card_statement']) then
    missing := array_append(missing, 'a bank or card statement');
  end if;
  if not ('funding_approval' = any (doc_types)) then
    missing := array_append(missing, 'the funding approval');
  end if;
  if exists (
    select 1 from public.funding_claim_expenses link
    join public.finance_expenses expense on expense.id = link.expense_id
    where link.claim_id = p_claim_id and expense.event_related
      and (not ('event_support' = any (doc_types)) or expense.event_name = '' or expense.event_starts_at is null
           or expense.event_attendee_count is null or expense.event_schedule = '')
  ) then
    missing := array_append(missing, 'event flyer or agenda and event details');
  end if;
  return missing;
end;
$$;
revoke all on function private.funding_claim_missing(bigint) from public, anon, authenticated;

create or replace function public.create_funding_claim(
  p_title text, p_funder_name text, p_award_reference text, p_heellife_reference text,
  p_submission_deadline date, p_notes text, p_expense_ids bigint[]
) returns public.funding_claims
language plpgsql security definer set search_path = '' as $$
declare
  result public.funding_claims;
  v_actor uuid := (select auth.uid());
  v_expense_id bigint;
  v_available numeric;
  v_total numeric := 0;
  v_ids bigint[];
begin
  if not private.is_executive() then raise exception 'executive permission required' using errcode = '42501'; end if;
  select array_agg(distinct id) into v_ids from unnest(coalesce(p_expense_ids, '{}')) as id;
  if v_ids is null then raise exception 'Select at least one expense for this claim' using errcode = '22023'; end if;

  foreach v_expense_id in array v_ids loop
    if not exists (select 1 from public.finance_expenses where id = v_expense_id and status not in ('rejected', 'voided')) then
      raise exception 'One of the selected expenses cannot be claimed' using errcode = '22023';
    end if;
    v_available := private.expense_unclaimed_amount(v_expense_id);
    if v_available <= 0 then raise exception 'One of the selected expenses is already fully claimed' using errcode = '22023'; end if;
    v_total := v_total + v_available;
  end loop;

  insert into public.funding_claims (title, funder_name, award_reference, heellife_reference, requested_amount,
    submission_deadline, status, notes, created_by, updated_by)
  values (btrim(p_title), coalesce(nullif(btrim(p_funder_name), ''), 'GPSG Senate'), btrim(coalesce(p_award_reference, '')),
    btrim(coalesce(p_heellife_reference, '')), v_total, p_submission_deadline, 'incomplete', btrim(coalesce(p_notes, '')),
    v_actor, v_actor)
  returning * into result;

  insert into public.funding_claim_expenses (claim_id, expense_id, claimed_amount)
  select result.id, id, private.expense_unclaimed_amount(id) from unnest(v_ids) as id;
  return result;
end;
$$;

create or replace function public.add_funding_claim_expense(p_claim_id bigint, p_expense_id bigint)
returns public.funding_claims
language plpgsql security definer set search_path = '' as $$
declare
  claim public.funding_claims;
  result public.funding_claims;
  v_available numeric;
begin
  if not private.is_executive() then raise exception 'executive permission required' using errcode = '42501'; end if;
  select * into claim from public.funding_claims where id = p_claim_id for update;
  if not found then raise exception 'funding claim not found' using errcode = 'P0002'; end if;
  if claim.status not in ('draft', 'incomplete', 'ready', 'changes_requested') then
    raise exception 'Expenses can only be changed before a claim is submitted' using errcode = '22023';
  end if;
  if exists (select 1 from public.funding_claim_expenses where claim_id = p_claim_id and expense_id = p_expense_id) then
    raise exception 'That expense is already on this claim' using errcode = '22023';
  end if;
  if not exists (select 1 from public.finance_expenses where id = p_expense_id and status not in ('rejected', 'voided')) then
    raise exception 'That expense cannot be claimed' using errcode = '22023';
  end if;
  v_available := private.expense_unclaimed_amount(p_expense_id);
  if v_available <= 0 then raise exception 'That expense is already fully claimed' using errcode = '22023'; end if;

  -- Raise the total first: the link trigger rejects links above the total.
  update public.funding_claims
  set requested_amount = requested_amount + v_available, updated_by = (select auth.uid()),
      status = case when status = 'ready' then 'incomplete' else status end
  where id = p_claim_id;
  insert into public.funding_claim_expenses (claim_id, expense_id, claimed_amount) values (p_claim_id, p_expense_id, v_available);
  select * into result from public.funding_claims where id = p_claim_id;
  return result;
end;
$$;

create or replace function public.remove_funding_claim_expense(p_claim_id bigint, p_expense_id bigint)
returns public.funding_claims
language plpgsql security definer set search_path = '' as $$
declare
  claim public.funding_claims;
  result public.funding_claims;
  v_amount numeric;
begin
  if not private.is_executive() then raise exception 'executive permission required' using errcode = '42501'; end if;
  select * into claim from public.funding_claims where id = p_claim_id for update;
  if not found then raise exception 'funding claim not found' using errcode = 'P0002'; end if;
  if claim.status not in ('draft', 'incomplete', 'ready', 'changes_requested') then
    raise exception 'Expenses can only be changed before a claim is submitted' using errcode = '22023';
  end if;
  select claimed_amount into v_amount from public.funding_claim_expenses where claim_id = p_claim_id and expense_id = p_expense_id;
  if not found then raise exception 'That expense is not on this claim' using errcode = 'P0002'; end if;
  if claim.requested_amount - v_amount <= 0 then
    raise exception 'A claim needs at least one expense. Void the claim instead.' using errcode = '22023';
  end if;
  delete from public.funding_claim_expenses where claim_id = p_claim_id and expense_id = p_expense_id;
  update public.funding_claims
  set requested_amount = requested_amount - v_amount, updated_by = (select auth.uid())
  where id = p_claim_id
  returning * into result;
  return result;
end;
$$;

create or replace function public.set_funding_claim_status(p_claim_id bigint, p_status text, p_approved_amount numeric default null, p_note text default null)
returns public.funding_claims
language plpgsql security definer set search_path = '' as $$
declare
  claim public.funding_claims;
  result public.funding_claims;
  missing text[];
  allowed boolean;
begin
  if not private.is_executive() then raise exception 'executive permission required' using errcode = '42501'; end if;
  select * into claim from public.funding_claims where id = p_claim_id for update;
  if not found then raise exception 'funding claim not found' using errcode = 'P0002'; end if;

  allowed := case claim.status
    when 'draft' then p_status in ('incomplete', 'ready')
    when 'incomplete' then p_status in ('ready')
    when 'ready' then p_status in ('incomplete', 'submitted')
    when 'submitted' then p_status in ('approved', 'changes_requested', 'denied')
    when 'changes_requested' then p_status in ('incomplete', 'ready')
    else false end;
  if not allowed then
    raise exception 'A claim that is % cannot be marked %', replace(claim.status, '_', ' '), replace(coalesce(p_status, 'nothing'), '_', ' ')
      using errcode = '22023';
  end if;

  if p_status in ('ready', 'submitted') then
    missing := private.funding_claim_missing(p_claim_id);
    if array_length(missing, 1) > 0 then
      raise exception 'This claim still needs: %', array_to_string(missing, ', ') using errcode = '22023';
    end if;
  end if;
  if p_status = 'approved' then
    if p_approved_amount is null or p_approved_amount <= 0 then
      raise exception 'Enter the amount the funder approved' using errcode = '22023';
    end if;
    if p_approved_amount > claim.requested_amount then
      raise exception 'The approved amount cannot be more than the amount requested' using errcode = '22023';
    end if;
  end if;

  update public.funding_claims
  set status = p_status,
      approved_amount = case when p_status = 'approved' then p_approved_amount else approved_amount end,
      submitted_at = case when p_status = 'submitted' then now() else submitted_at end,
      reviewed_at = case when p_status in ('approved', 'changes_requested', 'denied') then now() else reviewed_at end,
      notes = case when nullif(btrim(coalesce(p_note, '')), '') is null then notes
                   else btrim(notes || E'\n' || to_char(now() at time zone 'America/New_York', 'YYYY-MM-DD') || ': ' || btrim(p_note)) end,
      updated_by = (select auth.uid())
  where id = p_claim_id
  returning * into result;
  return result;
end;
$$;

create or replace function public.void_funding_claim(p_claim_id bigint, p_reason text)
returns public.funding_claims
language plpgsql security definer set search_path = '' as $$
declare
  claim public.funding_claims;
  result public.funding_claims;
  v_reason text;
begin
  if not private.is_executive() then raise exception 'executive permission required' using errcode = '42501'; end if;
  v_reason := private.require_void_reason(p_reason);
  select * into claim from public.funding_claims where id = p_claim_id for update;
  if not found then raise exception 'funding claim not found' using errcode = 'P0002'; end if;
  if claim.status = 'voided' then raise exception 'This claim is already voided' using errcode = '22023'; end if;
  if claim.received_amount > 0 or exists (
    select 1 from public.finance_payments where funding_claim_id = p_claim_id and status <> 'voided'
  ) then
    raise exception 'Money has been received for this claim. Void those payments first.' using errcode = '22023';
  end if;

  -- Release the expenses so they can go on another claim.
  delete from public.funding_claim_expenses where claim_id = p_claim_id;
  update public.funding_claims
  set status = 'voided', void_reason = v_reason, voided_by = (select auth.uid()), voided_at = now(),
      updated_by = (select auth.uid())
  where id = p_claim_id
  returning * into result;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------
-- Removes the database record and returns the storage path; the caller then
-- deletes the file. A member may only delete files in their own folder that
-- are no longer registered, so the record always goes first here.
create or replace function public.remove_finance_document(p_document_id bigint)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  document public.finance_documents;
  v_actor uuid := (select auth.uid());
  v_is_executive boolean := private.is_executive();
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select * into document from public.finance_documents where id = p_document_id for update;
  if not found or (document.uploaded_by <> v_actor and not v_is_executive) then
    raise exception 'Document not found' using errcode = 'P0002';
  end if;

  -- Reimbursements: editable while undecided; a waiting request keeps a receipt.
  if exists (
    select 1 from public.finance_reimbursement_documents link
    join public.personal_reimbursements reimbursement on reimbursement.id = link.reimbursement_id
    where link.document_id = p_document_id and reimbursement.status not in ('submitted', 'changes_requested', 'draft')
  ) then
    raise exception 'This document belongs to a request that has already been decided' using errcode = '22023';
  end if;
  if document.document_type = 'receipt' and exists (
    select 1 from public.finance_reimbursement_documents link
    join public.personal_reimbursements reimbursement on reimbursement.id = link.reimbursement_id
    where link.document_id = p_document_id and reimbursement.status = 'submitted'
      and not exists (
        select 1 from public.finance_reimbursement_documents other
        join public.finance_documents other_document on other_document.id = other.document_id
        where other.reimbursement_id = link.reimbursement_id and other.document_id <> p_document_id
          and other_document.document_type = 'receipt')
  ) then
    raise exception 'A submitted request needs a receipt. Add the replacement first, then remove this one.' using errcode = '22023';
  end if;
  -- Expenses on a claim keep a receipt.
  if document.document_type = 'receipt' and exists (
    select 1 from public.finance_expense_documents link
    where link.document_id = p_document_id and private.expense_on_live_claim(link.expense_id)
      and not exists (
        select 1 from public.finance_expense_documents other
        join public.finance_documents other_document on other_document.id = other.document_id
        where other.expense_id = link.expense_id and other.document_id <> p_document_id
          and other_document.document_type = 'receipt')
  ) then
    raise exception 'This is the only receipt for an expense on a funding claim. Add the replacement first.' using errcode = '22023';
  end if;
  -- Claim documents are frozen once the claim is submitted.
  if exists (
    select 1 from public.finance_claim_documents link
    join public.funding_claims claim on claim.id = link.claim_id
    where link.document_id = p_document_id and claim.status not in ('draft', 'incomplete', 'ready', 'changes_requested', 'voided')
  ) then
    raise exception 'This document is part of a submitted funding claim' using errcode = '22023';
  end if;

  insert into public.finance_audit_log (entity_type, entity_id, action, actor_id, before_data, after_data)
  values ('finance_documents', document.id, 'delete', v_actor, to_jsonb(document), null);
  delete from public.finance_documents where id = p_document_id;

  -- A claim that was ready may no longer be.
  update public.funding_claims claim set status = 'incomplete'
  where claim.status = 'ready' and array_length(private.funding_claim_missing(claim.id), 1) > 0;
  return document.storage_path;
end;
$$;

drop policy if exists "Members delete own unregistered finance files" on storage.objects;
create policy "Members delete own unregistered finance files" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'finance-private'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not exists (select 1 from public.finance_documents document where document.storage_path = name)
  );

-- ---------------------------------------------------------------------------
-- Summary (P2-02, P2-03): computed once, in SQL, over the whole ledger.
-- Runs with the caller's own access, so members only ever total their own rows.
-- ---------------------------------------------------------------------------
create or replace function public.get_finance_summary()
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'available_cash', coalesce((select sum(case when direction = 'inflow' then amount else -amount end)
      from public.finance_payments where status in ('posted', 'cleared')), 0),
    'income', coalesce((select sum(amount) from public.finance_payments
      where direction = 'inflow' and status in ('posted', 'cleared')), 0),
    'spending', coalesce((select sum(amount) from public.finance_expenses where status in ('approved', 'settled')), 0),
    'pending_reimbursement_total', coalesce((select sum(coalesce(approved_amount, requested_amount))
      from public.personal_reimbursements where status in ('submitted', 'changes_requested', 'approved')), 0),
    'pending_reimbursement_count', (select count(*) from public.personal_reimbursements
      where status in ('submitted', 'changes_requested', 'approved')),
    'expected_funding', coalesce((select sum(greatest(0, coalesce(approved_amount, 0) - received_amount))
      from public.funding_claims where status in ('approved', 'partially_paid')), 0)
  );
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.void_finance_payment(bigint, text)',
    'public.void_finance_expense(bigint, text)',
    'public.update_finance_expense(bigint, text, text, text, text, bigint, bigint, boolean, text, timestamptz, integer, text, numeric, date)',
    'public.update_member_reimbursement(bigint, text, text, numeric, date, text, text, text, bigint, bigint, boolean, text, timestamptz, integer, text)',
    'public.withdraw_member_reimbursement(bigint)',
    'public.request_reimbursement_changes(bigint, text)',
    'public.create_funding_claim(text, text, text, text, date, text, bigint[])',
    'public.add_funding_claim_expense(bigint, bigint)',
    'public.remove_funding_claim_expense(bigint, bigint)',
    'public.set_funding_claim_status(bigint, text, numeric, text)',
    'public.void_funding_claim(bigint, text)',
    'public.remove_finance_document(bigint)',
    'public.get_finance_summary()'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;
