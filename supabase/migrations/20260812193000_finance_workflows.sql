-- Structured finance workflows for club purchases, member reimbursements,
-- external funding claims, cash movements, and sensitive supporting files.

create table public.finance_expenses (
  id bigint generated always as identity primary key,
  description text not null check (char_length(description) between 2 and 500),
  vendor text not null default '',
  amount numeric(12,2) not null check (amount > 0),
  purchase_date date not null,
  category text not null check (char_length(category) between 1 and 80),
  paid_by text not null check (paid_by in ('club', 'member')),
  paid_by_member_id uuid references public.profiles(id) on delete set null,
  payment_card_last4 text check (payment_card_last4 is null or payment_card_last4 ~ '^[0-9]{4}$'),
  subgroup_id bigint references public.subgroups(id) on delete set null,
  club_event_id bigint references public.events(id) on delete set null,
  event_related boolean not null default false,
  event_name text not null default '',
  event_starts_at timestamptz,
  event_attendee_count integer check (event_attendee_count is null or event_attendee_count >= 0),
  event_schedule text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved', 'rejected', 'settled', 'voided')),
  notes text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (paid_by <> 'member' or paid_by_member_id is not null),
  check (status <> 'voided' or nullif(btrim(void_reason), '') is not null)
);

create table public.personal_reimbursements (
  id bigint generated always as identity primary key,
  expense_id bigint not null unique references public.finance_expenses(id) on delete restrict,
  member_id uuid not null references public.profiles(id) on delete restrict,
  requested_amount numeric(12,2) not null check (requested_amount > 0),
  approved_amount numeric(12,2) check (approved_amount is null or approved_amount > 0),
  status text not null default 'submitted'
    check (status in ('draft', 'submitted', 'approved', 'rejected', 'paid', 'voided')),
  member_note text not null default '',
  review_note text not null default '',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (approved_amount is null or approved_amount <= requested_amount)
);

create table public.funding_claims (
  id bigint generated always as identity primary key,
  title text not null check (char_length(title) between 2 and 180),
  funder_name text not null default 'GPSG Senate',
  award_reference text not null default '',
  heellife_reference text not null default '',
  requested_amount numeric(12,2) not null check (requested_amount > 0),
  approved_amount numeric(12,2) check (approved_amount is null or approved_amount >= 0),
  received_amount numeric(12,2) not null default 0 check (received_amount >= 0),
  submission_deadline date,
  status text not null default 'draft'
    check (status in ('draft', 'incomplete', 'ready', 'submitted', 'changes_requested', 'approved', 'partially_paid', 'paid', 'denied', 'voided')),
  notes text not null default '',
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (approved_amount is null or approved_amount <= requested_amount),
  check (approved_amount is null or received_amount <= approved_amount)
);

create table public.funding_claim_expenses (
  claim_id bigint not null references public.funding_claims(id) on delete cascade,
  expense_id bigint not null references public.finance_expenses(id) on delete restrict,
  claimed_amount numeric(12,2) not null check (claimed_amount > 0),
  created_at timestamptz not null default now(),
  primary key (claim_id, expense_id)
);

create table public.finance_payments (
  id bigint generated always as identity primary key,
  direction text not null check (direction in ('inflow', 'outflow')),
  purpose text not null check (purpose in ('income', 'direct_expense', 'member_reimbursement', 'external_reimbursement', 'refund', 'fee', 'transfer', 'adjustment')),
  amount numeric(12,2) not null check (amount > 0),
  description text not null check (char_length(description) between 2 and 500),
  category text not null default 'General',
  account_name text not null default 'Club bank account',
  counterparty text not null default '',
  payment_date date not null default current_date,
  cleared_date date,
  status text not null default 'posted' check (status in ('pending', 'posted', 'cleared', 'voided')),
  expense_id bigint references public.finance_expenses(id) on delete restrict,
  reimbursement_id bigint references public.personal_reimbursements(id) on delete restrict,
  funding_claim_id bigint references public.funding_claims(id) on delete restrict,
  transfer_group_id uuid,
  legacy_transaction_id bigint unique references public.transactions(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  voided_by uuid references public.profiles(id) on delete set null,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'voided' or nullif(btrim(void_reason), '') is not null),
  check (purpose <> 'transfer' or transfer_group_id is not null)
);

create table public.finance_documents (
  id bigint generated always as identity primary key,
  document_type text not null check (document_type in ('receipt', 'invoice', 'bank_statement', 'card_statement', 'event_support', 'funding_approval', 'heellife_submission', 'proof_of_payment', 'other')),
  title text not null check (char_length(title) between 1 and 180),
  storage_path text not null unique,
  mime_type text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 10485760),
  payment_card_last4 text check (payment_card_last4 is null or payment_card_last4 ~ '^[0-9]{4}$'),
  statement_period_start date,
  statement_period_end date,
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (document_type not in ('bank_statement', 'card_statement') or mime_type = 'application/pdf'),
  check (statement_period_end is null or statement_period_start is null or statement_period_end >= statement_period_start)
);

create table public.finance_expense_documents (
  expense_id bigint not null references public.finance_expenses(id) on delete cascade,
  document_id bigint not null references public.finance_documents(id) on delete cascade,
  primary key (expense_id, document_id)
);

create table public.finance_reimbursement_documents (
  reimbursement_id bigint not null references public.personal_reimbursements(id) on delete cascade,
  document_id bigint not null references public.finance_documents(id) on delete cascade,
  primary key (reimbursement_id, document_id)
);

create table public.finance_claim_documents (
  claim_id bigint not null references public.funding_claims(id) on delete cascade,
  document_id bigint not null references public.finance_documents(id) on delete cascade,
  primary key (claim_id, document_id)
);

create table public.finance_audit_log (
  id bigint generated always as identity primary key,
  entity_type text not null,
  entity_id bigint not null,
  action text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create index finance_expenses_purchase_date_idx on public.finance_expenses(purchase_date desc);
create index finance_expenses_status_idx on public.finance_expenses(status, purchase_date desc);
create index finance_expenses_member_idx on public.finance_expenses(paid_by_member_id, purchase_date desc) where paid_by_member_id is not null;
create index finance_expenses_subgroup_idx on public.finance_expenses(subgroup_id) where subgroup_id is not null;
create index finance_expenses_event_idx on public.finance_expenses(club_event_id) where club_event_id is not null;
create index finance_expenses_created_by_idx on public.finance_expenses(created_by) where created_by is not null;
create index finance_expenses_approved_by_idx on public.finance_expenses(approved_by) where approved_by is not null;
create index personal_reimbursements_member_idx on public.personal_reimbursements(member_id, created_at desc);
create index personal_reimbursements_queue_idx on public.personal_reimbursements(status, created_at) where status in ('submitted', 'approved');
create index personal_reimbursements_reviewer_idx on public.personal_reimbursements(reviewed_by) where reviewed_by is not null;
create index funding_claims_status_idx on public.funding_claims(status, created_at desc);
create index funding_claims_created_by_idx on public.funding_claims(created_by) where created_by is not null;
create index funding_claims_updated_by_idx on public.funding_claims(updated_by) where updated_by is not null;
create index funding_claim_expenses_expense_idx on public.funding_claim_expenses(expense_id);
create index finance_payments_date_idx on public.finance_payments(payment_date desc);
create index finance_payments_status_idx on public.finance_payments(status, payment_date desc);
create index finance_payments_expense_idx on public.finance_payments(expense_id) where expense_id is not null;
create index finance_payments_reimbursement_idx on public.finance_payments(reimbursement_id) where reimbursement_id is not null;
create index finance_payments_claim_idx on public.finance_payments(funding_claim_id) where funding_claim_id is not null;
create index finance_payments_created_by_idx on public.finance_payments(created_by) where created_by is not null;
create index finance_payments_voided_by_idx on public.finance_payments(voided_by) where voided_by is not null;
create index finance_documents_uploaded_by_idx on public.finance_documents(uploaded_by, created_at desc);
create index finance_expense_documents_document_idx on public.finance_expense_documents(document_id);
create index finance_reimbursement_documents_document_idx on public.finance_reimbursement_documents(document_id);
create index finance_claim_documents_document_idx on public.finance_claim_documents(document_id);
create index finance_audit_entity_idx on public.finance_audit_log(entity_type, entity_id, created_at desc);
create index finance_audit_actor_idx on public.finance_audit_log(actor_id) where actor_id is not null;

create or replace function private.touch_finance_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function private.touch_finance_updated_at() from public;

create trigger touch_finance_expenses before update on public.finance_expenses
for each row execute procedure private.touch_finance_updated_at();
create trigger touch_personal_reimbursements before update on public.personal_reimbursements
for each row execute procedure private.touch_finance_updated_at();
create trigger touch_funding_claims before update on public.funding_claims
for each row execute procedure private.touch_finance_updated_at();
create trigger touch_finance_payments before update on public.finance_payments
for each row execute procedure private.touch_finance_updated_at();

create or replace function private.audit_finance_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare record_id bigint;
begin
  record_id := case when tg_op = 'DELETE' then old.id else new.id end;
  insert into public.finance_audit_log (entity_type, entity_id, action, actor_id, before_data, after_data)
  values (
    tg_table_name,
    record_id,
    lower(tg_op),
    (select auth.uid()),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.audit_finance_change() from public;

create trigger audit_finance_expenses after insert or update or delete on public.finance_expenses
for each row execute procedure private.audit_finance_change();
create trigger audit_personal_reimbursements after insert or update or delete on public.personal_reimbursements
for each row execute procedure private.audit_finance_change();
create trigger audit_funding_claims after insert or update or delete on public.funding_claims
for each row execute procedure private.audit_finance_change();
create trigger audit_finance_payments after insert or update or delete on public.finance_payments
for each row execute procedure private.audit_finance_change();

alter table public.finance_expenses enable row level security;
alter table public.personal_reimbursements enable row level security;
alter table public.funding_claims enable row level security;
alter table public.funding_claim_expenses enable row level security;
alter table public.finance_payments enable row level security;
alter table public.finance_documents enable row level security;
alter table public.finance_expense_documents enable row level security;
alter table public.finance_reimbursement_documents enable row level security;
alter table public.finance_claim_documents enable row level security;
alter table public.finance_audit_log enable row level security;

grant select on public.finance_expenses, public.personal_reimbursements, public.finance_payments to authenticated;
grant select, insert, update on public.funding_claims to authenticated;
grant select, insert, update, delete on public.funding_claim_expenses to authenticated;
grant select, insert, delete on public.finance_documents, public.finance_expense_documents,
  public.finance_reimbursement_documents, public.finance_claim_documents to authenticated;
grant select on public.finance_audit_log to authenticated;
grant usage, select on all sequences in schema public to authenticated;

create policy "Members view permitted expenses" on public.finance_expenses
for select to authenticated using (
  private.is_executive() or created_by = (select auth.uid()) or paid_by_member_id = (select auth.uid())
);
create policy "Executives manage expenses" on public.finance_expenses
for all to authenticated using (private.is_executive()) with check (private.is_executive());

create policy "Members view own reimbursements" on public.personal_reimbursements
for select to authenticated using (private.is_executive() or member_id = (select auth.uid()));
create policy "Executives manage reimbursements" on public.personal_reimbursements
for all to authenticated using (private.is_executive()) with check (private.is_executive());

create policy "Executives manage funding claims" on public.funding_claims
for all to authenticated using (private.is_executive()) with check (private.is_executive());
create policy "Executives manage claim expenses" on public.funding_claim_expenses
for all to authenticated using (private.is_executive()) with check (private.is_executive());

create policy "Members view permitted payments" on public.finance_payments
for select to authenticated using (
  private.is_executive() or exists (
    select 1 from public.personal_reimbursements reimbursement
    where reimbursement.id = finance_payments.reimbursement_id
      and reimbursement.member_id = (select auth.uid())
  )
);
create policy "Executives manage payments" on public.finance_payments
for all to authenticated using (private.is_executive()) with check (private.is_executive());

create policy "Members view permitted finance documents" on public.finance_documents
for select to authenticated using (private.is_executive() or uploaded_by = (select auth.uid()));
create policy "Members register own finance documents" on public.finance_documents
for insert to authenticated with check (uploaded_by = (select auth.uid()));
create policy "Executives manage finance documents" on public.finance_documents
for all to authenticated using (private.is_executive()) with check (private.is_executive());

create policy "Members view permitted expense document links" on public.finance_expense_documents
for select to authenticated using (
  private.is_executive() or exists (
    select 1 from public.finance_expenses expense
    where expense.id = finance_expense_documents.expense_id
      and (expense.created_by = (select auth.uid()) or expense.paid_by_member_id = (select auth.uid()))
  )
);
create policy "Members attach own expense documents" on public.finance_expense_documents
for insert to authenticated with check (
  exists (
    select 1 from public.finance_expenses expense
    where expense.id = finance_expense_documents.expense_id
      and (expense.created_by = (select auth.uid()) or expense.paid_by_member_id = (select auth.uid()))
  ) and exists (
    select 1 from public.finance_documents document
    where document.id = finance_expense_documents.document_id
      and document.uploaded_by = (select auth.uid())
  )
);
create policy "Executives manage expense document links" on public.finance_expense_documents
for all to authenticated using (private.is_executive()) with check (private.is_executive());

create policy "Members view own reimbursement document links" on public.finance_reimbursement_documents
for select to authenticated using (
  private.is_executive() or exists (
    select 1 from public.personal_reimbursements reimbursement
    where reimbursement.id = finance_reimbursement_documents.reimbursement_id
      and reimbursement.member_id = (select auth.uid())
  )
);
create policy "Members attach own reimbursement documents" on public.finance_reimbursement_documents
for insert to authenticated with check (
  exists (
    select 1 from public.personal_reimbursements reimbursement
    where reimbursement.id = finance_reimbursement_documents.reimbursement_id
      and reimbursement.member_id = (select auth.uid())
  ) and exists (
    select 1 from public.finance_documents document
    where document.id = finance_reimbursement_documents.document_id
      and document.uploaded_by = (select auth.uid())
  )
);
create policy "Executives manage reimbursement document links" on public.finance_reimbursement_documents
for all to authenticated using (private.is_executive()) with check (private.is_executive());

create policy "Executives manage claim document links" on public.finance_claim_documents
for all to authenticated using (private.is_executive()) with check (private.is_executive());
create policy "Executives view finance audit" on public.finance_audit_log
for select to authenticated using (private.is_executive());

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
revoke all on function public.submit_member_reimbursement(text, text, numeric, date, text, text, text, bigint, bigint, boolean, text, timestamptz, integer, text) from public;
grant execute on function public.submit_member_reimbursement(text, text, numeric, date, text, text, text, bigint, bigint, boolean, text, timestamptz, integer, text) to authenticated;

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
revoke all on function public.record_club_expense(text, text, numeric, date, text, text, text, bigint, bigint, boolean, text, timestamptz, integer, text) from public;
grant execute on function public.record_club_expense(text, text, numeric, date, text, text, text, bigint, bigint, boolean, text, timestamptz, integer, text) to authenticated;

create or replace function public.record_finance_income(
  p_description text,
  p_amount numeric,
  p_payment_date date,
  p_category text,
  p_counterparty text default '',
  p_account_name text default 'Club bank account'
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare payment_id bigint;
begin
  if not private.is_executive() then raise exception 'executive permission required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be greater than zero'; end if;
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
$$;
revoke all on function public.record_finance_income(text, numeric, date, text, text, text) from public;
grant execute on function public.record_finance_income(text, numeric, date, text, text, text) to authenticated;

create or replace function public.review_personal_reimbursement(
  p_reimbursement_id bigint,
  p_decision text,
  p_approved_amount numeric default null,
  p_review_note text default ''
)
returns public.personal_reimbursements
language plpgsql security definer set search_path = '' as $$
declare result public.personal_reimbursements;
begin
  if not private.is_executive() then raise exception 'executive permission required'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'invalid reimbursement decision'; end if;

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
revoke all on function public.review_personal_reimbursement(bigint, text, numeric, text) from public;
grant execute on function public.review_personal_reimbursement(bigint, text, numeric, text) to authenticated;

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
revoke all on function public.pay_personal_reimbursement(bigint, date, text) from public;
grant execute on function public.pay_personal_reimbursement(bigint, date, text) to authenticated;

create or replace function public.record_funding_claim_payment(
  p_claim_id bigint,
  p_amount numeric,
  p_payment_date date,
  p_account_name text default 'Club bank account'
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  claim public.funding_claims;
  payment_id bigint;
  next_received numeric;
begin
  if not private.is_executive() then raise exception 'executive permission required'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be greater than zero'; end if;
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
$$;
revoke all on function public.record_funding_claim_payment(bigint, numeric, date, text) from public;
grant execute on function public.record_funding_claim_payment(bigint, numeric, date, text) to authenticated;

create or replace function private.validate_claim_expense_amounts()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  expense_total numeric;
  claim_total numeric;
  allocated_total numeric;
begin
  select amount into expense_total from public.finance_expenses where id = new.expense_id;
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
create trigger validate_claim_expense_amounts
before insert or update on public.funding_claim_expenses
for each row execute procedure private.validate_claim_expense_amounts();

-- Preserve original signed-amount ledger records without counting them twice.
insert into public.finance_payments (
  direction, purpose, amount, description, category, payment_date, status,
  legacy_transaction_id, created_by, created_at
)
select
  case when amount > 0 then 'inflow' else 'outflow' end,
  case when amount > 0 then 'income' else 'direct_expense' end,
  abs(amount), description, category, transaction_date, 'cleared', id, created_by, created_at
from public.transactions
on conflict (legacy_transaction_id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'finance-private', 'finance-private', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Members upload finance files to own folder" on storage.objects
for insert to authenticated with check (
  bucket_id = 'finance-private' and
  (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy "Members read permitted finance files" on storage.objects
for select to authenticated using (
  bucket_id = 'finance-private' and exists (
    select 1 from public.finance_documents document
    where document.storage_path = name
      and (document.uploaded_by = (select auth.uid()) or private.is_executive())
  )
);
create policy "Executives delete finance files" on storage.objects
for delete to authenticated using (
  bucket_id = 'finance-private' and private.is_executive()
);
