-- Finance fixes: funding claims (review findings finance-1, finance-2 and the
-- claim side of finance-3). The races themselves need two connections and are in
-- concurrency/80_finance_locks.sh; this file covers the rules those rely on.
begin;
do $$
declare
  v_exec uuid := test.make_user('Exec Eighty', 'executive');
  v_exec2 uuid := test.make_user('Exec Eighty B', 'executive');
  v_member uuid := test.make_user('Member Eighty');
  message text;
  v_club bigint;
  v_club2 bigint;
  v_member_expense bigint;
  v_reimbursement bigint;
  v_claim bigint;
  v_claim2 bigint;
  v_voided bigint;
  v_requested numeric;
  v_missing text[];
  v_expense_rejected bigint;
  v_reimbursement_rejected bigint;
begin
  perform test.login(v_exec);
  v_club := public.record_club_expense('Tabla repair', 'Music shop', 100, date '2026-11-02', 'Instruments', 'Club bank account', '4242');
  v_club2 := public.record_club_expense('Snacks', 'Grocer', 60, date '2026-11-03', 'Food', 'Club bank account', '4242');
  v_voided := public.record_club_expense('Entered twice', 'Grocer', 30, date '2026-11-03', 'Food', 'Club bank account', '4242');
  perform public.void_finance_expense(v_voided, 'Entered twice');
  perform test.logout();
  perform test.login(v_member);
  select expense_id, reimbursement_id into v_member_expense, v_reimbursement
  from public.submit_member_reimbursement('Strings', 'Shop', 50, date '2026-11-04', 'Supplies', '1111');
  perform test.logout();

  -- finance-2: a voided expense cannot be put on a claim, by either function.
  message := test.error_as(v_exec, format('select public.create_funding_claim(''Voided claim'', ''GPSG'', '''', '''', null, '''', array[%s]::bigint[])', v_voided));
  assert message like 'One of the selected expenses cannot be claimed%', 'voided expense, create: ' || coalesce(message, 'no error');
  perform test.login(v_exec);
  select id into v_claim from public.create_funding_claim('Fall concert', 'GPSG Senate', 'A-1', 'H-1', date '2026-12-01', '', array[v_club]);
  perform test.logout();
  message := test.error_as(v_exec, format('select public.add_funding_claim_expense(%s, %s)', v_claim, v_voided));
  assert message like 'That expense cannot be claimed%', 'voided expense, add: ' || coalesce(message, 'no error');

  -- finance-3: a request that is still waiting for review is not claimable, whichever function is used.
  message := test.error_as(v_exec, format('select public.create_funding_claim(''Early claim'', ''GPSG'', '''', '''', null, '''', array[%s]::bigint[])', v_member_expense));
  assert message like 'One of the selected expenses cannot be claimed%approved or settled%', 'submitted expense, create: ' || coalesce(message, 'no error');
  message := test.error_as(v_exec, format('select public.add_funding_claim_expense(%s, %s)', v_claim, v_member_expense));
  assert message like 'That expense cannot be claimed%approved or settled%', 'submitted expense, add: ' || coalesce(message, 'no error');
  -- Once a second executive approves it, it can go on the claim.
  perform test.login(v_exec2);
  perform public.review_personal_reimbursement(v_reimbursement, 'approved', 40, 'Approved at 40');
  perform test.logout();
  perform test.login(v_exec);
  perform public.add_funding_claim_expense(v_claim, v_member_expense);
  perform test.logout();
  assert (select requested_amount from public.funding_claims where id = v_claim) = 150, 'the claim now holds 100 + the 50 purchase';
  -- An expense on a live claim cannot be claimed again.
  message := test.error_as(v_exec, format('select public.create_funding_claim(''Again'', ''GPSG'', '''', '''', null, '''', array[%s]::bigint[])', v_club));
  assert message like '%already fully claimed%', coalesce(message, 'no error');
  message := test.error_as(v_exec, format('select public.add_funding_claim_expense(%s, %s)', v_claim, v_club));
  assert message like 'That expense is already on this claim%', coalesce(message, 'no error');

  -- finance-1 / finance-2: the link table itself holds the line for a direct insert by an executive.
  perform test.login(v_exec);
  select id into v_claim2 from public.create_funding_claim('Second claim', 'GPSG Senate', '', '', null, '', array[v_club2]);
  perform test.logout();
  update public.funding_claims set requested_amount = 1000 where id = v_claim2;
  message := test.error_of(format('insert into public.funding_claim_expenses (claim_id, expense_id, claimed_amount) values (%s, %s, 30)', v_claim2, v_voided));
  assert message like 'That expense cannot be claimed%', 'direct link to a voided expense: ' || coalesce(message, 'no error');
  message := test.error_of(format('insert into public.funding_claim_expenses (claim_id, expense_id, claimed_amount) values (%s, %s, 100)', v_claim2, v_club));
  assert message like 'claims cannot exceed the expense amount%', 'direct second claim of the same expense: ' || coalesce(message, 'no error');
  -- A rejected request is refused too.
  perform test.login(v_member);
  select expense_id, reimbursement_id into v_expense_rejected, v_reimbursement_rejected
  from public.submit_member_reimbursement('Rejected thing', 'Shop', 20, date '2026-11-04', 'Supplies', '1111');
  perform test.logout();
  perform test.login(v_exec);
  perform public.review_personal_reimbursement(v_reimbursement_rejected, 'rejected', null, 'No');
  perform test.logout();
  message := test.error_of(format('insert into public.funding_claim_expenses (claim_id, expense_id, claimed_amount) values (%s, %s, 20)', v_claim2, v_expense_rejected));
  assert message like 'That expense cannot be claimed%', 'direct link to a rejected expense: ' || coalesce(message, 'no error');

  -- finance-2 / finance-3: a claim cannot be marked ready or submitted with a stale link.
  -- (Triggers are switched off to build the kind of row an old direct write could have left.)
  insert into public.finance_documents (document_type, title, storage_path, mime_type, file_size_bytes, uploaded_by) values
    ('receipt', 'R1', 'x80/r1.pdf', 'application/pdf', 10, v_exec), ('receipt', 'R2', 'x80/r2.pdf', 'application/pdf', 10, v_exec),
    ('receipt', 'R3', 'x80/r3.pdf', 'application/pdf', 10, v_exec),
    ('bank_statement', 'Statement', 'x80/s.pdf', 'application/pdf', 10, v_exec), ('funding_approval', 'Approval', 'x80/a.pdf', 'application/pdf', 10, v_exec);
  insert into public.finance_expense_documents (expense_id, document_id)
    select v_club, id from public.finance_documents where storage_path = 'x80/r1.pdf'
    union all select v_member_expense, id from public.finance_documents where storage_path = 'x80/r2.pdf'
    union all select v_club2, id from public.finance_documents where storage_path = 'x80/r3.pdf';
  insert into public.finance_claim_documents (claim_id, document_id)
    select c, id from public.finance_documents, unnest(array[v_claim, v_claim2]) as c where storage_path in ('x80/s.pdf', 'x80/a.pdf');
  v_missing := private.funding_claim_missing(v_claim);
  assert v_missing = '{}', 'the claim is complete before anything goes stale: ' || array_to_string(v_missing, ', ');
  -- The member's request is voided behind the claim's back, and a link is made to claim more than its expense.
  set local session_replication_role = replica;
  update public.finance_expenses set status = 'voided', void_reason = 'Direct write' where id = v_member_expense;
  update public.funding_claim_expenses set claimed_amount = 500 where claim_id = v_claim and expense_id = v_club;
  set local session_replication_role = origin;
  v_missing := private.funding_claim_missing(v_claim);
  assert v_missing @> array['every expense approved or settled (remove voided or rejected ones)'], 'a voided expense is flagged: ' || array_to_string(v_missing, ', ');
  assert v_missing @> array['claimed amounts that do not exceed the expense amounts'], 'an over-claimed link is flagged: ' || array_to_string(v_missing, ', ');
  message := test.error_as(v_exec, format('select public.set_funding_claim_status(%s, ''ready'')', v_claim));
  assert message like 'This claim still needs:%approved or settled%', 'ready is refused: ' || coalesce(message, 'no error');
  -- A clean claim still goes ready and submitted.
  perform test.login(v_exec);
  perform public.set_funding_claim_status(v_claim2, 'ready');
  perform public.set_funding_claim_status(v_claim2, 'submitted');
  perform test.logout();
  assert (select status from public.funding_claims where id = v_claim2) = 'submitted';
end $$;
rollback;
