-- Second security review, finding F1 (P2): "not a number" was accepted as a money amount.
--
-- RELEASE ORDER: apply BEFORE the new frontend (section 1 of docs/RELEASE_ORDER.md). It refuses something the
-- deployed screens never send: no form can type NaN (an amount box is a number input and the screens refuse
-- zero and negative amounts themselves), so only a hand-made request is refused. Read "Before applying" in
-- docs/RELEASE_ORDER.md first: a NaN row that already exists in production cannot be edited or voided once the
-- constraints below exist, so look for one first.
--
-- The defect. `numeric` has a value NaN that compares GREATER than every number, so `p_amount <= 0` is false and
-- `check (amount > 0)` is true for NaN, and numeric(12,2) stores it. Any active member could call
-- submit_member_reimbursement('x', 'v', 'NaN'::numeric, ...); the finance summary then answered "NaN" for the
-- pending total, and after the review and the payment (both honest actions of two executives) for spending and
-- available cash. record_finance_income('NaN') by an executive made income NaN, and a NaN payment has no way back
-- (void_finance_payment does not repair a sum that is already NaN in a report, and an update of the row must pass
-- the same check).
--
-- The fix, in two layers:
--   (a) every function that takes a money amount refuses NaN with the sentence it already uses for zero and
--       negative amounts ("amount must be greater than zero", same errcode as before in each function). The same
--       test now also refuses an amount that rounds to 0.00 (0.004), which used to reach the column and come back as
--       the raw "violates check constraint" text. The bodies below are the current ones (pg_get_functiondef of the
--       database after 20261128031000) with that one condition changed; signature, security definer, search_path,
--       owner, comments and grants are untouched (create or replace keeps them; permissions.snapshot is unchanged).
--       Infinity is left as it was: numeric(12,2) refuses it (22003 "numeric field overflow") before a row exists.
--       review_personal_reimbursement and set_funding_claim_status already refused a NaN approved amount by accident
--       (their other checks compare NaN with the requested amount); they now say so on purpose.
--   (b) CHECK constraints `<column> <> 'NaN'::numeric` on every money column (the nine columns that are checked
--       "> 0" or ">= 0" today plus the legacy ledger), so a direct write or a function written later cannot store it
--       either. They are NOT VALID: the rows that exist are not scanned (nothing here can fail on old data), every new
--       and every changed row must pass. Validating is a manual step (docs/RELEASE_ORDER.md, "Manual steps").
--
-- Columns left alone on purpose: attendance_records.unexcused_units (computed by a trigger from the attendance
-- status, never from client input) and recordings.duration_seconds (a length of time, not money). The test
-- supabase/tests/78_nan_amounts.test.sql lists every numeric column of public and fails when a new one has neither
-- a NaN check nor a line in its allow-list.
--
-- Safe to run twice (create or replace; each constraint is added only when it is missing).

CREATE OR REPLACE FUNCTION public.submit_member_reimbursement(p_description text, p_vendor text, p_amount numeric, p_purchase_date date, p_category text, p_payment_card_last4 text, p_member_note text DEFAULT ''::text, p_subgroup_id bigint DEFAULT NULL::bigint, p_club_event_id bigint DEFAULT NULL::bigint, p_event_related boolean DEFAULT false, p_event_name text DEFAULT ''::text, p_event_starts_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_event_attendee_count integer DEFAULT NULL::integer, p_event_schedule text DEFAULT ''::text)
 RETURNS TABLE(expense_id bigint, reimbursement_id bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then raise exception 'authentication required'; end if;
  if not private.is_active_member() then
    raise exception 'Your access to the portal has been deactivated' using errcode = '42501';
  end if;
  if p_amount is null or p_amount = 'NaN'::numeric or p_amount <= 0 or round(p_amount, 2) <= 0 then raise exception 'amount must be greater than zero'; end if;
  if p_payment_card_last4 is null or p_payment_card_last4 !~ '^[0-9]{4}$' then
    raise exception 'the payment card last four digits are required';
  end if;
  perform private.require_event_details(p_event_related, p_event_name, p_event_starts_at, p_event_attendee_count, p_event_schedule);
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
$function$;

CREATE OR REPLACE FUNCTION public.record_club_expense(p_description text, p_vendor text, p_amount numeric, p_purchase_date date, p_category text, p_account_name text DEFAULT 'Club bank account'::text, p_payment_card_last4 text DEFAULT NULL::text, p_subgroup_id bigint DEFAULT NULL::bigint, p_club_event_id bigint DEFAULT NULL::bigint, p_event_related boolean DEFAULT false, p_event_name text DEFAULT ''::text, p_event_starts_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_event_attendee_count integer DEFAULT NULL::integer, p_event_schedule text DEFAULT ''::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  expense_id bigint;
  current_user_id uuid := (select auth.uid());
begin
  if not private.is_executive() then raise exception 'executive permission required'; end if;
  if p_amount is null or p_amount = 'NaN'::numeric or p_amount <= 0 or round(p_amount, 2) <= 0 then raise exception 'amount must be greater than zero'; end if;
  if p_payment_card_last4 is not null and p_payment_card_last4 !~ '^[0-9]{4}$' then
    raise exception 'card last four must contain four digits';
  end if;
  perform private.require_event_details(p_event_related, p_event_name, p_event_starts_at, p_event_attendee_count, p_event_schedule);
  insert into public.finance_expenses (
    description, vendor, amount, purchase_date, category, paid_by,
    payment_card_last4, subgroup_id, club_event_id, event_related, event_name, event_starts_at,
    event_attendee_count, event_schedule, status, created_by, approved_by, approved_at
  ) values (
    btrim(p_description), btrim(coalesce(p_vendor, '')), p_amount, p_purchase_date,
    btrim(p_category), 'club', p_payment_card_last4, p_subgroup_id, p_club_event_id,
    coalesce(p_event_related, false), btrim(coalesce(p_event_name, '')),
    p_event_starts_at, p_event_attendee_count, btrim(coalesce(p_event_schedule, '')), 'settled',
    current_user_id, current_user_id, now()
  ) returning id into expense_id;

  insert into public.finance_payments (
    direction, purpose, amount, description, category, account_name,
    counterparty, payment_date, status, expense_id, created_by
  ) values (
    'outflow', 'direct_expense', p_amount, btrim(p_description), btrim(p_category),
    btrim(coalesce(nullif(p_account_name, ''), 'Club bank account')),
    btrim(coalesce(p_vendor, '')), p_purchase_date, 'posted', expense_id, current_user_id
  );
  return expense_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_finance_income(p_description text, p_amount numeric, p_payment_date date, p_category text, p_counterparty text DEFAULT ''::text, p_account_name text DEFAULT 'Club bank account'::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare payment_id bigint;
begin
  if not private.is_executive() then raise exception 'executive permission required'; end if;
  if p_amount is null or p_amount = 'NaN'::numeric or p_amount <= 0 or round(p_amount, 2) <= 0 then raise exception 'amount must be greater than zero'; end if;
  insert into public.finance_payments (
    direction, purpose, amount, description, category, account_name,
    counterparty, payment_date, status, created_by
  ) values (
    'inflow', 'income', p_amount, btrim(p_description), btrim(p_category),
    btrim(coalesce(nullif(p_account_name, ''), 'Club bank account')),
    btrim(coalesce(p_counterparty, '')), p_payment_date, 'posted', (select auth.uid())
  ) returning id into payment_id;
  return payment_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_funding_claim_payment(p_claim_id bigint, p_amount numeric, p_payment_date date, p_account_name text DEFAULT 'Club bank account'::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  claim public.funding_claims;
  payment_id bigint;
  next_received numeric;
begin
  if not private.is_executive() then raise exception 'executive permission required'; end if;
  if p_amount is null or p_amount = 'NaN'::numeric or p_amount <= 0 or round(p_amount, 2) <= 0 then raise exception 'amount must be greater than zero'; end if;
  select * into claim from public.funding_claims where id = p_claim_id for update;
  if not found then raise exception 'funding claim not found'; end if;
  if claim.status not in ('approved', 'partially_paid') then raise exception 'claim must be approved before recording payment'; end if;
  next_received := claim.received_amount + p_amount;
  if claim.approved_amount is not null and next_received > claim.approved_amount then
    raise exception 'payment exceeds approved claim amount';
  end if;

  insert into public.finance_payments (
    direction, purpose, amount, description, category, account_name,
    counterparty, payment_date, status, funding_claim_id, created_by
  ) values (
    'inflow', 'external_reimbursement', p_amount, 'Funding reimbursement: ' || claim.title,
    'External funding', btrim(coalesce(nullif(p_account_name, ''), 'Club bank account')),
    claim.funder_name, p_payment_date, 'posted', claim.id, (select auth.uid())
  ) returning id into payment_id;

  update public.funding_claims
  set received_amount = next_received,
      status = case when approved_amount is not null and next_received >= approved_amount then 'paid' else 'partially_paid' end,
      updated_by = (select auth.uid())
  where id = claim.id;
  return payment_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_member_reimbursement(p_reimbursement_id bigint, p_description text, p_vendor text, p_amount numeric, p_purchase_date date, p_category text, p_payment_card_last4 text, p_member_note text DEFAULT ''::text, p_subgroup_id bigint DEFAULT NULL::bigint, p_club_event_id bigint DEFAULT NULL::bigint, p_event_related boolean DEFAULT false, p_event_name text DEFAULT ''::text, p_event_starts_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_event_attendee_count integer DEFAULT NULL::integer, p_event_schedule text DEFAULT ''::text)
 RETURNS personal_reimbursements
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if p_amount is null or p_amount = 'NaN'::numeric or p_amount <= 0 or round(p_amount, 2) <= 0 then raise exception 'amount must be greater than zero' using errcode = '22023'; end if;
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
$function$;

CREATE OR REPLACE FUNCTION private.apply_expense_details(p_expense_id bigint, p_description text, p_vendor text, p_category text, p_payment_card_last4 text, p_subgroup_id bigint, p_club_event_id bigint, p_event_related boolean, p_event_name text, p_event_starts_at timestamp with time zone, p_event_attendee_count integer, p_event_schedule text, p_amount numeric, p_purchase_date date)
 RETURNS finance_expenses
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result public.finance_expenses;
begin
  if p_payment_card_last4 is not null and p_payment_card_last4 !~ '^[0-9]{4}$' then
    raise exception 'card last four must contain four digits' using errcode = '22023';
  end if;
  if p_amount is not null and (p_amount = 'NaN'::numeric or p_amount <= 0 or round(p_amount, 2) <= 0) then
    raise exception 'amount must be greater than zero' using errcode = '22023';
  end if;
  perform private.require_event_details(p_event_related, p_event_name, p_event_starts_at, p_event_attendee_count, p_event_schedule);
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
$function$;

CREATE OR REPLACE FUNCTION public.set_funding_claim_status(p_claim_id bigint, p_status text, p_approved_amount numeric DEFAULT NULL::numeric, p_note text DEFAULT NULL::text)
 RETURNS funding_claims
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    if p_approved_amount is null or p_approved_amount = 'NaN'::numeric or p_approved_amount <= 0 then
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
$function$;

CREATE OR REPLACE FUNCTION public.review_personal_reimbursement(p_reimbursement_id bigint, p_decision text, p_approved_amount numeric DEFAULT NULL::numeric, p_review_note text DEFAULT ''::text)
 RETURNS personal_reimbursements
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if p_decision = 'approved' and p_approved_amount is not null and p_approved_amount = 'NaN'::numeric then
    raise exception 'amount must be greater than zero' using errcode = '22023';
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
$function$;

-- (b) NOT VALID constraints.
do $$
declare
  col record;
  v_name text;
begin
  for col in
    select * from (values
      ('finance_expenses',        'amount'),
      ('finance_payments',        'amount'),
      ('funding_claim_expenses',  'claimed_amount'),
      ('funding_claims',          'requested_amount'),
      ('funding_claims',          'approved_amount'),
      ('funding_claims',          'received_amount'),
      ('personal_reimbursements', 'requested_amount'),
      ('personal_reimbursements', 'approved_amount'),
      ('transactions',            'amount')
    ) as c(tbl, col)
  loop
    if not exists (
      select 1 from pg_attribute a
      where a.attrelid = to_regclass(format('public.%I', col.tbl)) and a.attname = col.col and not a.attisdropped
    ) then
      raise notice 'money column %.% does not exist here, skipped', col.tbl, col.col;
      continue;
    end if;
    v_name := col.tbl || '_' || col.col || '_not_nan';
    if not exists (
      select 1 from pg_constraint
      where conrelid = to_regclass(format('public.%I', col.tbl)) and conname = v_name
    ) then
      execute format('alter table public.%I add constraint %I check (%I <> ''NaN''::numeric) not valid', col.tbl, v_name, col.col);
    end if;
  end loop;
end $$;
