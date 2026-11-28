-- Phase 4.2, P1-03 (and the entry side of P1-04): an event purchase is recorded with
-- its event evidence, not only checked when a claim wants to be ready.
--
-- ============================================================================
-- RELEASE ORDER: APPLY BEFORE THE NEW FRONTEND. The purchase forms already make
-- the event fields required once "This purchase was for an event" is ticked, so
-- nothing the deployed frontend does is refused; the database now holds the
-- same line for any other caller.
-- ============================================================================
--
-- What the database already did, and still does (20261127000000, 20261127050000):
-- funding_claim_missing, run by set_funding_claim_status for "ready" and for
-- "submitted", names every claim that has an expense without its four card digits
-- (P1-04), an event purchase without the event name, date and time, attendees and
-- schedule, a claim without the event flyer or agenda, and so on. Verified
-- again in supabase/tests/81_finance_register.test.sql.
--
-- What was missing (the register's P1-03: "event_related = true is accepted with no
-- event name, date/time, attendee count, or schedule"): the four writers of an
-- expense accepted event_related = true with none of that. A purchase could then
-- sit in the books looking like an event purchase with nothing behind it until a
-- claim tried to use it. They now refuse it, with one readable sentence:
--
--   submit_member_reimbursement   a member's request
--   update_member_reimbursement   its edit (through apply_expense_details)
--   record_club_expense           an executive's club purchase
--   update_finance_expense        its edit (through apply_expense_details)
--
-- A linked calendar event does not replace the four fields: the claim checklist
-- and the form ask for them whatever the calendar says, and one rule is easier
-- to explain than two.
--
-- Not done, on purpose (P1-04): a purchase without card digits is still accepted by
-- record_club_expense and update_finance_expense. The register asks for "an
-- explicit payment-method exemption rather than missing data", which needs a
-- payment-method field and a form control; without them a refusal here would
-- block cash and cheque purchases that the portal records today. The claim
-- checklist is where such a purchase is held back, and it is.

create or replace function private.require_event_details(
  p_event_related boolean, p_event_name text, p_event_starts_at timestamptz,
  p_event_attendee_count integer, p_event_schedule text
) returns void language plpgsql immutable set search_path = '' as $$
begin
  if coalesce(p_event_related, false) and (
    btrim(coalesce(p_event_name, '')) = '' or p_event_starts_at is null
    or p_event_attendee_count is null or btrim(coalesce(p_event_schedule, '')) = ''
  ) then
    raise exception 'An event purchase needs the event name, date and time, number of attendees and schedule' using errcode = '22023';
  end if;
end;
$$;
revoke all on function private.require_event_details(boolean, text, timestamptz, integer, text) from public, anon, authenticated;

-- The shared writer of an expense's details (a member's edit, an executive's edit).
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
$$;
revoke all on function private.apply_expense_details(bigint, text, text, text, text, bigint, bigint, boolean, text, timestamptz, integer, text, numeric, date) from public, anon, authenticated;

-- A member's request (20261127050100's version, with the event check added).
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
$$;

-- A club purchase (20260812193000's version, with the event check added).
create or replace function public.record_club_expense(
  p_description text,
  p_vendor text,
  p_amount numeric,
  p_purchase_date date,
  p_category text,
  p_account_name text default 'Club bank account',
  p_payment_card_last4 text default null,
  p_subgroup_id bigint default null,
  p_club_event_id bigint default null,
  p_event_related boolean default false,
  p_event_name text default '',
  p_event_starts_at timestamptz default null,
  p_event_attendee_count integer default null,
  p_event_schedule text default ''
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  expense_id bigint;
  current_user_id uuid := (select auth.uid());
begin
  if not private.is_executive() then raise exception 'executive permission required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be greater than zero'; end if;
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
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.submit_member_reimbursement(text, text, numeric, date, text, text, text, bigint, bigint, boolean, text, timestamptz, integer, text)',
    'public.record_club_expense(text, text, numeric, date, text, text, text, bigint, bigint, boolean, text, timestamptz, integer, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;
