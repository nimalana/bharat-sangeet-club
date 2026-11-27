-- Finance fixes, part 1: funding claims lock the expenses they take
-- (review findings finance-1 and finance-2).
--
-- Two executives, or a double click, could claim the same expense twice, and a
-- claim could take an expense that another executive was voiding at that
-- moment. create_funding_claim and add_funding_claim_expense only read the
-- expense, so nothing made the second caller wait for the first.
--
-- ===========================================================================
-- LOCK ORDER (also finance-7). Every finance function that writes more than
-- one row locks them in this order, and never asks for an earlier kind while
-- holding a later one. Rows of one kind are locked in ascending id.
--
--   1. finance_expenses        FOR UPDATE
--   2. personal_reimbursements
--   3. finance_payments
--   4. funding_claims
--   5. finance_documents
--
-- A function that is handed a row from further down the list (a payment, a
-- reimbursement, a document) reads it without a lock first, takes the earlier
-- locks, then locks its own row and reads it again. Each statement of a
-- READ COMMITTED function takes a fresh snapshot, so what it reads after a
-- lock wait includes whatever the other transaction committed.
--
-- The functions that follow the order are void_finance_payment,
-- void_finance_expense, update_finance_expense, update_member_reimbursement,
-- withdraw_member_reimbursement, review_personal_reimbursement,
-- pay_personal_reimbursement, create_funding_claim,
-- add_funding_claim_expense and remove_finance_document. The ones that touch
-- only a claim (remove_funding_claim_expense, set_funding_claim_status,
-- void_funding_claim, record_funding_claim_payment) cannot be part of a cycle.
-- supabase/tests/concurrency/80_finance_locks.sh exercises the order with two
-- sessions.
-- ===========================================================================

create or replace function private.lock_finance_expenses(p_expense_ids bigint[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.finance_expenses where id = any (p_expense_ids) order by id for update;
end;
$$;
revoke all on function private.lock_finance_expenses(bigint[]) from public, anon, authenticated;

-- Returns the unmet requirements for marking a claim ready (empty = ready).
-- New here: every expense must be approved or settled and no link may claim
-- more than its expense is worth, so a claim cannot be marked ready or
-- submitted with a stale link (finance-2, finance-3).
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
    join public.finance_expenses expense on expense.id = link.expense_id
    where link.claim_id = p_claim_id and expense.status not in ('approved', 'settled')
  ) then
    missing := array_append(missing, 'every expense approved or settled (remove voided or rejected ones)');
  end if;
  if exists (
    select 1 from public.funding_claim_expenses link
    join public.finance_expenses expense on expense.id = link.expense_id
    where link.claim_id = p_claim_id and link.claimed_amount > expense.amount
  ) then
    missing := array_append(missing, 'claimed amounts that do not exceed the expense amounts');
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

-- The link table is still open to executives (the revoke from Phase 2.0 has not
-- run everywhere), so the rule is enforced here too: take the expense lock
-- before reading what is already allocated, and refuse a voided or rejected
-- expense. The functions below lock earlier; this makes a direct insert safe.
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
  select requested_amount into claim_total from public.funding_claims where id = new.claim_id;
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

-- Only expenses the club has approved or paid can be claimed from a funder. A
-- member's request that is still waiting for review is not one of them yet.
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
  select array_agg(id order by id) into v_ids
  from (select distinct id from unnest(coalesce(p_expense_ids, '{}')) as t(id) where id is not null) as ids;
  if v_ids is null then raise exception 'Select at least one expense for this claim' using errcode = '22023'; end if;

  -- Lock first, in ascending id, then check: what is read below includes
  -- whatever a concurrent claim or void committed while this call waited.
  perform private.lock_finance_expenses(v_ids);

  foreach v_expense_id in array v_ids loop
    if not exists (select 1 from public.finance_expenses where id = v_expense_id and status in ('approved', 'settled')) then
      raise exception 'One of the selected expenses cannot be claimed. Only approved or settled expenses can go on a claim.' using errcode = '22023';
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
  -- Lock order: the expense, then the claim.
  perform private.lock_finance_expenses(array[p_expense_id]);
  select * into claim from public.funding_claims where id = p_claim_id for update;
  if not found then raise exception 'funding claim not found' using errcode = 'P0002'; end if;
  if claim.status not in ('draft', 'incomplete', 'ready', 'changes_requested') then
    raise exception 'Expenses can only be changed before a claim is submitted' using errcode = '22023';
  end if;
  if exists (select 1 from public.funding_claim_expenses where claim_id = p_claim_id and expense_id = p_expense_id) then
    raise exception 'That expense is already on this claim' using errcode = '22023';
  end if;
  if not exists (select 1 from public.finance_expenses where id = p_expense_id and status in ('approved', 'settled')) then
    raise exception 'That expense cannot be claimed. Only approved or settled expenses can go on a claim.' using errcode = '22023';
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

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.create_funding_claim(text, text, text, text, date, text, bigint[])',
    'public.add_funding_claim_expense(bigint, bigint)'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;
