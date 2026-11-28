-- Second security review, F1 (migration 20261128032000): "not a number" is not a money amount.
--
--   A. Every function that takes an amount refuses NaN (any spelling, named arguments, every role that can call it)
--      with the sentence it uses for zero and negative amounts, and so does an amount that rounds to 0.00. Nothing
--      is stored; a pending or deactivated account is turned away before the amount is looked at.
--   B. The legitimate amounts still go through, end to end, and the finance summary stays a number.
--   C. The CHECK constraints: every money column refuses NaN on a direct insert and on an update of an existing row,
--      and the roles that can reach the tables directly cannot write them at all.
--   D. Catalog: every numeric column of public either has a NaN constraint or is on a short allow-list with a reason,
--      so a column added later fails this file until somebody decides.
--
-- Failures are collected and raised together, so one run shows every broken line.
begin;

create table test.m78_fail (what text not null);
create function test.m78_expect(p_what text, p_got text, p_like text) returns void language plpgsql as $$
begin
  if p_like is null then
    if p_got is not null then insert into test.m78_fail values (format('%s: expected success, got [%s]', p_what, p_got)); end if;
  elsif p_like = '*' then
    if p_got is null then insert into test.m78_fail values (format('%s: expected a refusal, got no error', p_what)); end if;
  elsif p_got is null or p_got not like p_like then
    insert into test.m78_fail values (format('%s: expected [%s], got [%s]', p_what, p_like, coalesce(p_got, 'no error')));
  end if;
end $$;

do $$
declare
  v_member uuid := test.make_user('Nan Member');
  v_exec uuid := test.make_user('Nan Exec', 'executive');
  v_exec2 uuid := test.make_user('Nan Exec B', 'executive');
  v_admin uuid := test.make_user('Nan Admin', 'admin');
  v_pending uuid := test.make_user('Nan Pending', p_status => 'pending');
  v_dead uuid := test.make_user('Nan Dead', p_status => 'deactivated');
  v_amount text;
  v_sentence constant text := 'amount must be greater than zero%';
  v_e bigint; v_r bigint; v_club bigint; v_claim_ok bigint; v_claim_sub bigint;
  v_summary jsonb;
  v_before_exp bigint; v_before_pay bigint; v_before_reim bigint;
  v_t text; v_c text; v_w text;
  v_msg text;
begin
  -- Fixtures: one request, one club purchase, an approved claim and a submitted claim.
  perform test.login(v_member);
  select expense_id, reimbursement_id into v_e, v_r
  from public.submit_member_reimbursement('Nan fixture', 'Shop', 20, date '2026-11-04', 'Supplies', '1111');
  perform test.logout();
  perform test.login(v_exec);
  v_club := public.record_club_expense('Nan club fixture', 'Shop', 30, date '2026-11-04', 'Supplies', 'Club bank account', '4242');
  perform test.logout();
  insert into public.funding_claims (title, requested_amount, approved_amount, status)
  values ('Nan approved claim', 100, 100, 'approved') returning id into v_claim_ok;
  insert into public.funding_claims (title, requested_amount, status)
  values ('Nan submitted claim', 100, 'submitted') returning id into v_claim_sub;
  insert into public.funding_claims (title, requested_amount) values ('Nan draft claim', 10);  -- approved_amount is null
  select count(*) into v_before_exp from public.finance_expenses;
  select count(*) into v_before_pay from public.finance_payments;
  select count(*) into v_before_reim from public.personal_reimbursements;

  -- -----------------------------------------------------------------------------------------------------
  -- A. Refusals. 'Infinity' is refused by the column (numeric field overflow) and is only required to fail.
  -- -----------------------------------------------------------------------------------------------------
  foreach v_amount in array array['''NaN''', '''nan''', ''' NaN ''', '''-0''', '0', '0.004', '0.0049', '-5', '''-Infinity''', 'null', '''Infinity''']
  loop
    declare
      v_like text := case when v_amount in ('''Infinity''', '''-Infinity''') then '*' else v_sentence end;
      v_num text := case when v_amount = 'null' then 'null::numeric' else v_amount || '::numeric' end;
    begin
      perform test.m78_expect('member submit ' || v_amount,
        test.error_as(v_member, format('select * from public.submit_member_reimbursement(''Nan x'', ''v'', %s, current_date, ''c'', ''1234'')', v_num)), v_like);
      perform test.m78_expect('member submit (named arguments) ' || v_amount,
        test.error_as(v_member, format('select * from public.submit_member_reimbursement(p_description => ''Nan x'', p_vendor => ''v'', p_amount => %s, p_purchase_date => current_date, p_category => ''c'', p_payment_card_last4 => ''1234'')', v_num)), v_like);
      perform test.m78_expect('member edits own request ' || v_amount,
        test.error_as(v_member, format('select public.update_member_reimbursement(%s, ''Nan x'', ''v'', %s, current_date, ''c'', ''1234'')', v_r, v_num)), v_like);
      perform test.m78_expect('exec income ' || v_amount,
        test.error_as(v_exec, format('select public.record_finance_income(''inc'', %s, current_date, ''c'')', v_num)), v_like);
      perform test.m78_expect('exec club expense ' || v_amount,
        test.error_as(v_exec, format('select public.record_club_expense(''ce'', ''v'', %s, current_date, ''c'')', v_num)), v_like);
      -- (a null amount to update_finance_expense means "leave the amount alone", so it is not a refusal)
      perform test.m78_expect('exec edits a submitted request ' || v_amount,
        test.error_as(v_exec, format('select public.update_finance_expense(%s, ''Nan d'', ''v'', ''c'', ''1234'', null, null, false, '''', null, null, '''', %s)', v_e, v_num)),
        case when v_amount = 'null' then null else v_like end);
      perform test.m78_expect('exec claim payment ' || v_amount,
        test.error_as(v_exec, format('select public.record_funding_claim_payment(%s, %s, current_date)', v_claim_ok, v_num)), v_like);
      -- an administrator is refused too (with the amount sentence if the role may call it, else for the role)
      perform test.m78_expect('admin income ' || v_amount,
        test.error_as(v_admin, format('select public.record_finance_income(''inc'', %s, current_date, ''c'')', v_num)), '*');
      -- accounts that may not use finance at all are turned away, whatever the amount
      perform test.m78_expect('pending submit ' || v_amount,
        test.error_as(v_pending, format('select * from public.submit_member_reimbursement(''Nan x'', ''v'', %s, current_date, ''c'', ''1234'')', v_num)), '*');
      perform test.m78_expect('deactivated submit ' || v_amount,
        test.error_as(v_dead, format('select * from public.submit_member_reimbursement(''Nan x'', ''v'', %s, current_date, ''c'', ''1234'')', v_num)), '*');
    end;
  end loop;

  -- The approved amounts of a review and of a claim decision.
  perform test.m78_expect('review approves with NaN',
    test.error_as(v_exec2, format('select public.review_personal_reimbursement(%s, ''approved'', ''NaN''::numeric, '''')', v_r)), v_sentence);
  perform test.m78_expect('review approves with 0',
    test.error_as(v_exec2, format('select public.review_personal_reimbursement(%s, ''approved'', 0, '''')', v_r)), '*');
  perform test.m78_expect('claim approved with NaN',
    test.error_as(v_exec, format('select public.set_funding_claim_status(%s, ''approved'', ''NaN''::numeric, '''')', v_claim_sub)), 'Enter the amount the funder approved%');
  perform test.m78_expect('claim approved with 0',
    test.error_as(v_exec, format('select public.set_funding_claim_status(%s, ''approved'', 0, '''')', v_claim_sub)), 'Enter the amount the funder approved%');
  perform test.m78_expect('the request is still submitted',
    case when (select status from public.personal_reimbursements where id = v_r) = 'submitted' then null else 'status changed' end, null);

  -- A club purchase that is already settled cannot be given a NaN amount through an edit either.
  perform test.m78_expect('exec edits a settled purchase to NaN',
    test.error_as(v_exec, format('select public.update_finance_expense(%s, ''Nan d'', ''v'', ''c'', ''4242'', null, null, false, '''', null, null, '''', ''NaN''::numeric)', v_club)), '*');

  -- Nothing was written by any of the refusals above.
  perform test.m78_expect('no expense row was added',
    case when (select count(*) from public.finance_expenses) = v_before_exp then null else 'expense rows changed' end, null);
  perform test.m78_expect('no payment row was added',
    case when (select count(*) from public.finance_payments) = v_before_pay then null else 'payment rows changed' end, null);
  perform test.m78_expect('no request row was added',
    case when (select count(*) from public.personal_reimbursements) = v_before_reim then null else 'request rows changed' end, null);
  perform test.m78_expect('the fixture amounts are unchanged',
    case when (select amount from public.finance_expenses where id = v_e) = 20
          and (select requested_amount from public.personal_reimbursements where id = v_r) = 20
          and (select amount from public.finance_expenses where id = v_club) = 30 then null else 'amounts changed' end, null);

  -- -----------------------------------------------------------------------------------------------------
  -- B. Legitimate amounts, and the summary stays a number.
  -- -----------------------------------------------------------------------------------------------------
  perform test.m78_expect('member submits 12.50',
    test.error_as(v_member, 'select * from public.submit_member_reimbursement(''ok'', ''v'', 12.50, current_date, ''c'', ''1234'')'), null);
  perform test.m78_expect('member submits 0.01',
    test.error_as(v_member, 'select * from public.submit_member_reimbursement(''ok'', ''v'', 0.01, current_date, ''c'', ''1234'')'), null);
  perform test.m78_expect('member edits own request',
    test.error_as(v_member, format('select public.update_member_reimbursement(%s, ''Nan x'', ''v'', 21.25, current_date, ''c'', ''1234'')', v_r)), null);
  perform test.m78_expect('exec edits a submitted request',
    test.error_as(v_exec, format('select public.update_finance_expense(%s, ''Nan d'', ''v'', ''c'', ''1234'', null, null, false, '''', null, null, '''', 22)', v_e)), null);
  perform test.m78_expect('exec income 40',
    test.error_as(v_exec, 'select public.record_finance_income(''inc'', 40, current_date, ''c'')'), null);
  perform test.m78_expect('exec club expense 5.5',
    test.error_as(v_exec, 'select public.record_club_expense(''ce'', ''v'', 5.5, current_date, ''c'')'), null);
  perform test.m78_expect('another executive approves with an amount',
    test.error_as(v_exec2, format('select public.review_personal_reimbursement(%s, ''approved'', 10, '''')', v_r)), null);
  perform test.m78_expect('the claim payment 10',
    test.error_as(v_exec, format('select public.record_funding_claim_payment(%s, 10, current_date)', v_claim_ok)), null);
  perform test.m78_expect('the claim is approved for 80',
    test.error_as(v_exec, format('select public.set_funding_claim_status(%s, ''approved'', 80, '''')', v_claim_sub)), null);

  perform test.login(v_exec);
  v_summary := public.get_finance_summary();
  perform test.logout();
  perform test.m78_expect('the summary is all numbers',
    case when v_summary::text !~* 'nan' then null else v_summary::text end, null);

  -- -----------------------------------------------------------------------------------------------------
  -- C. The constraints, on a direct write by the owner, one per money column.
  -- -----------------------------------------------------------------------------------------------------
  insert into public.funding_claim_expenses (claim_id, expense_id, claimed_amount) values (v_claim_sub, v_club, 5);
  insert into public.transactions (description, amount, category) values ('legacy fixture', 5, 'x');
  -- (triggers off for these updates: they test the constraint alone; a trigger would answer first with its own sentence)
  set local session_replication_role = replica;
  for v_t, v_c, v_w in
    select * from (values
      ('finance_expenses', 'amount', 'true'), ('finance_payments', 'amount', 'true'), ('funding_claim_expenses', 'claimed_amount', 'true'),
      ('funding_claims', 'requested_amount', 'title = ''Nan draft claim'''), ('funding_claims', 'approved_amount', 'title = ''Nan draft claim'''),
      ('funding_claims', 'received_amount', 'title = ''Nan draft claim'''),
      ('personal_reimbursements', 'requested_amount', 'true'), ('personal_reimbursements', 'approved_amount', 'true'), ('transactions', 'amount', 'true')
    ) as c(t, c, w)
  loop
    -- approved_amount is set on the rows made above; a column that is still null gets a value first
    if v_c = 'approved_amount' and v_t = 'personal_reimbursements' then
      execute format('update public.%I set approved_amount = requested_amount where ctid = (select ctid from public.%I limit 1)', v_t, v_t);
    end if;
    perform test.m78_expect(format('update %s.%s to NaN', v_t, v_c),
      test.error_of(format('update public.%I set %I = ''NaN''::numeric where ctid = (select ctid from public.%I where %s limit 1)', v_t, v_c, v_t, v_w)),
      format('%%"%s_%s_not_nan"%%', v_t, v_c));
  end loop;
  set local session_replication_role = origin;
  -- an insert: the column that carries the money of a payment and of an expense
  perform test.m78_expect('insert a NaN payment as the owner',
    test.error_of($q$insert into public.finance_payments (direction, purpose, amount, description) values ('inflow', 'income', 'NaN'::numeric, 'nan payment')$q$),
    '%"finance_payments_amount_not_nan"%');
  perform test.m78_expect('insert a NaN claim as the owner',
    test.error_of($q$insert into public.funding_claims (title, requested_amount) values ('nan claim', 'NaN'::numeric)$q$),
    '%"funding_claims_requested_amount_not_nan"%');
  perform test.m78_expect('insert a claim with a NaN received amount as the owner',
    test.error_of($q$insert into public.funding_claims (title, requested_amount, received_amount) values ('nan claim', 10, 'NaN'::numeric)$q$),
    '%"funding_claims_received_amount_not_nan"%');
  -- the old checks are still there (the new ones do not replace them)
  perform test.m78_expect('a payment of zero is still refused',
    test.error_of($q$insert into public.finance_payments (direction, purpose, amount, description) values ('inflow', 'income', 0, 'zero payment')$q$),
    '%"finance_payments_amount_check"%');

  -- The roles that can reach the tables from the outside cannot write NaN either (they cannot write at all).
  perform test.m78_expect('member inserts a NaN expense directly',
    test.error_as(v_member, format($q$insert into public.finance_expenses (description, vendor, amount, purchase_date, category, paid_by, paid_by_member_id, status, created_by) values ('direct', 'v', 'NaN'::numeric, current_date, 'c', 'member', %L, 'submitted', %L)$q$, v_member, v_member)), '*');
  perform test.m78_expect('member updates own expense to NaN directly',
    test.error_as(v_member, format('update public.finance_expenses set amount = ''NaN''::numeric where id = %s', v_e)), '*');
  perform test.m78_expect('executive inserts a NaN payment directly',
    test.error_as(v_exec, $q$insert into public.finance_payments (direction, purpose, amount, description) values ('inflow', 'income', 'NaN'::numeric, 'direct')$q$), '*');
  perform test.m78_expect('executive updates a payment to NaN directly',
    test.error_as(v_exec, 'update public.finance_payments set amount = ''NaN''::numeric'), '*');
  perform test.m78_expect('executive updates a claim to NaN directly',
    test.error_as(v_exec, 'update public.funding_claims set requested_amount = ''NaN''::numeric'), '*');
  perform test.m78_expect('anonymous visitor inserts a NaN payment',
    test.error_as(null, $q$insert into public.finance_payments (direction, purpose, amount, description) values ('inflow', 'income', 'NaN'::numeric, 'anon')$q$), '*');

  -- No NaN anywhere after everything above.
  perform test.m78_expect('no NaN was stored',
    case when (select count(*) from public.finance_expenses where amount = 'NaN') = 0
          and (select count(*) from public.finance_payments where amount = 'NaN') = 0
          and (select count(*) from public.personal_reimbursements where requested_amount = 'NaN' or approved_amount = 'NaN') = 0
          and (select count(*) from public.funding_claims where requested_amount = 'NaN' or approved_amount = 'NaN' or received_amount = 'NaN') = 0
          and (select count(*) from public.funding_claim_expenses where claimed_amount = 'NaN') = 0
         then null else 'a NaN amount is stored' end, null);

  -- -----------------------------------------------------------------------------------------------------
  -- D. Catalog: every numeric column of public has a NaN constraint, or a reason.
  -- -----------------------------------------------------------------------------------------------------
  select string_agg(format('%s.%s', c.relname, a.attname), ', ' order by c.relname, a.attname) into v_msg
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid and c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
  where a.attnum > 0 and not a.attisdropped and a.atttypid in ('numeric'::regtype, 'float4'::regtype, 'float8'::regtype)
    and format('%s.%s', c.relname, a.attname) not in (
      'attendance_records.unexcused_units',  -- computed by a trigger from the attendance status, never from client input
      'recordings.duration_seconds')         -- a length of time, not money
    and not exists (
      select 1 from pg_constraint k
      where k.conrelid = c.oid and k.contype = 'c' and a.attnum = any (k.conkey) and pg_get_constraintdef(k.oid) like '%''NaN''::numeric%');
  perform test.m78_expect('every money column has a NaN constraint', case when v_msg is null then null else 'without one: ' || v_msg end, null);

  -- Every function of public or private that takes a numeric argument: a NaN-aware test, or a documented reason.
  select string_agg(p.oid::regprocedure::text, ', ') into v_msg
  from pg_proc p
  where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
    and exists (select 1 from unnest(p.proargtypes::oid[]) t where t = 'numeric'::regtype)
    and p.proname <> 'update_finance_expense'  -- passes p_amount to private.apply_expense_details, which tests it
    and pg_get_functiondef(p.oid) not like '%''NaN''::numeric%';
  perform test.m78_expect('every function with an amount argument tests for NaN', case when v_msg is null then null else 'without a test: ' || v_msg end, null);

  select string_agg(what, E'\n  ') into v_msg from test.m78_fail;
  if v_msg is not null then raise exception E'NaN AMOUNTS: % failure(s):\n  %', (select count(*) from test.m78_fail), v_msg; end if;
end $$;

rollback;
