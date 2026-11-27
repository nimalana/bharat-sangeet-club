-- Finance fixes: guards around funding claims, closed edits and explicit active
-- checks (review findings finance-3, finance-8 and finance-9). The lock order
-- (finance-7) needs two connections and is covered by concurrency/80_finance_locks.sh.
begin;
do $$
declare
  v_exec uuid := test.make_user('Exec Guards', 'executive');
  v_exec2 uuid := test.make_user('Exec Guards B', 'executive');
  v_member uuid := test.make_user('Member Guards');
  message text;
  v_club bigint;
  v_club2 bigint;
  v_club3 bigint;
  v_claim bigint;
  v_claim2 bigint;
  v_claim3 bigint;
  e1 bigint; r1 bigint; e2 bigint; r2 bigint; e3 bigint; r3 bigint; e4 bigint; r4 bigint;
  e5 bigint; r5 bigint; e6 bigint; r6 bigint;
begin
  perform test.login(v_exec);
  v_club := public.record_club_expense('Tabla repair', 'Music shop', 100, date '2026-11-02', 'Instruments', 'Club bank account', '4242');
  v_club2 := public.record_club_expense('Snacks', 'Grocer', 80, date '2026-11-03', 'Food', 'Club bank account', '4242');
  v_club3 := public.record_club_expense('Posters', 'Print shop', 40, date '2026-11-03', 'Publicity', 'Club bank account', '4242');
  perform test.logout();
  perform test.login(v_member);
  select expense_id, reimbursement_id into e1, r1 from public.submit_member_reimbursement('Request one', 'Shop', 10, date '2026-11-04', 'Supplies', '1111');
  select expense_id, reimbursement_id into e2, r2 from public.submit_member_reimbursement('Request two', 'Shop', 20, date '2026-11-04', 'Supplies', '1111');
  select expense_id, reimbursement_id into e3, r3 from public.submit_member_reimbursement('Request three', 'Shop', 30, date '2026-11-04', 'Supplies', '1111');
  select expense_id, reimbursement_id into e4, r4 from public.submit_member_reimbursement('Request four', 'Shop', 40, date '2026-11-04', 'Supplies', '1111');
  select expense_id, reimbursement_id into e5, r5 from public.submit_member_reimbursement('Request five', 'Shop', 50, date '2026-11-04', 'Supplies', '1111');
  select expense_id, reimbursement_id into e6, r6 from public.submit_member_reimbursement('Request six', 'Shop', 60, date '2026-11-04', 'Supplies', '1111');
  perform test.logout();

  -- ---------------------------------------------------------------------
  -- finance-3: withdraw, decline and money edits are refused while a claim holds the expense.
  -- Claims only take approved or settled expenses now, so the rows below are built the way an
  -- old direct write could have: triggers off for one insert.
  -- ---------------------------------------------------------------------
  perform test.login(v_exec);
  select id into v_claim from public.create_funding_claim('Fall concert', 'GPSG Senate', 'A-1', 'H-1', date '2026-12-01', '', array[v_club]);
  perform test.logout();
  set local session_replication_role = replica;
  insert into public.funding_claim_expenses (claim_id, expense_id, claimed_amount)
  select v_claim, id, amount from public.finance_expenses where id in (e1, e2, e3, e4);
  set local session_replication_role = origin;

  message := test.error_as(v_member, format('select public.withdraw_member_reimbursement(%s)', r1));
  assert message like 'This request is part of a funding claim%', 'withdraw on a claim: ' || coalesce(message, 'no error');
  assert (select status from public.finance_expenses where id = e1) = 'submitted', 'the expense is untouched';
  message := test.error_as(v_member, format('select public.update_member_reimbursement(%s, ''Cheaper'', ''Shop'', 5, date ''2026-11-04'', ''Supplies'', ''1111'')', r2));
  assert message like 'This request is part of a funding claim%', 'edit on a claim: ' || coalesce(message, 'no error');
  assert (select amount from public.finance_expenses where id = e2) = 20, 'the amount is untouched';
  message := test.error_as(v_exec2, format('select public.review_personal_reimbursement(%s, ''rejected'', null, ''No'')', r3));
  assert message like 'This request is part of a funding claim%', 'decline on a claim: ' || coalesce(message, 'no error');
  assert (select status from public.finance_expenses where id = e3) = 'submitted';
  message := test.error_as(v_exec, format('select public.update_finance_expense(%s, ''Request four'', ''Shop'', ''Supplies'', ''1111'', null, null, false, '''', null, null, '''', 4)', e4));
  assert message like 'This expense is part of a funding claim%', 'money edit on a claim: ' || coalesce(message, 'no error');
  message := test.error_as(v_exec, format('select public.update_finance_expense(%s, ''Request four, renamed'', ''Shop'', ''Supplies'', ''1111'')', e4));
  assert message is null, 'a descriptive edit on a claim still being built is fine: ' || coalesce(message, '');
  -- Approving is not blocked, and withdrawing works once the expense leaves the claim.
  message := test.error_as(v_exec2, format('select public.review_personal_reimbursement(%s, ''approved'', null, ''ok'')', r3));
  assert message is null, coalesce(message, '');
  delete from public.funding_claim_expenses where claim_id = v_claim and expense_id = e1;
  message := test.error_as(v_member, format('select public.withdraw_member_reimbursement(%s)', r1));
  assert message is null, 'withdraw after the expense left the claim: ' || coalesce(message, '');

  -- ---------------------------------------------------------------------
  -- finance-8: edits close once the claim is with the funder.
  -- ---------------------------------------------------------------------
  insert into public.finance_documents (document_type, title, storage_path, mime_type, file_size_bytes, uploaded_by) values
    ('receipt', 'R2', 'x80g/r2.pdf', 'application/pdf', 10, v_exec), ('receipt', 'R3', 'x80g/r3.pdf', 'application/pdf', 10, v_exec),
    ('bank_statement', 'Statement', 'x80g/s.pdf', 'application/pdf', 10, v_exec), ('funding_approval', 'Approval', 'x80g/a.pdf', 'application/pdf', 10, v_exec);
  insert into public.finance_expense_documents (expense_id, document_id)
    select v_club2, id from public.finance_documents where storage_path = 'x80g/r2.pdf'
    union all select v_club3, id from public.finance_documents where storage_path = 'x80g/r3.pdf';
  perform test.login(v_exec);
  select id into v_claim2 from public.create_funding_claim('Snack claim', 'GPSG Senate', '', '', null, '', array[v_club2]);
  select id into v_claim3 from public.create_funding_claim('Poster claim', 'GPSG Senate', '', '', null, '', array[v_club3]);
  perform test.logout();
  insert into public.finance_claim_documents (claim_id, document_id)
    select c, id from public.finance_documents, unnest(array[v_claim2, v_claim3]) as c where storage_path in ('x80g/s.pdf', 'x80g/a.pdf');

  -- A ready claim stays ready after an edit that keeps it complete, and drops back when the edit breaks it.
  perform test.login(v_exec);
  perform public.set_funding_claim_status(v_claim3, 'ready');
  perform test.logout();
  message := test.error_as(v_exec, format('select public.update_finance_expense(%s, ''Posters and flyers'', ''Print shop'', ''Publicity'', ''4242'')', v_club3));
  assert message is null, coalesce(message, '');
  assert (select status from public.funding_claims where id = v_claim3) = 'ready', 'a harmless edit leaves the claim ready';
  message := test.error_as(v_exec, format('select public.update_finance_expense(%s, ''Posters and flyers'', ''Print shop'', ''Publicity'', null)', v_club3));
  assert message is null, coalesce(message, '');
  assert (select status from public.funding_claims where id = v_claim3) = 'incomplete', 'removing the card digits sends a ready claim back to incomplete';

  -- Submitted, approved: locked. A claim the funder sent back is open again.
  perform test.login(v_exec);
  perform public.set_funding_claim_status(v_claim2, 'ready');
  perform public.set_funding_claim_status(v_claim2, 'submitted');
  perform test.logout();
  message := test.error_as(v_exec, format('select public.update_finance_expense(%s, ''Other snacks'', ''Grocer'', ''Food'', ''4242'')', v_club2));
  assert message like 'This expense is on a funding claim that has been submitted%', 'edit on a submitted claim: ' || coalesce(message, 'no error');
  message := test.error_as(v_exec, format('select public.update_finance_expense(%s, ''Snacks'', ''Grocer'', ''Food'', null)', v_club2));
  assert message like 'This expense is on a funding claim that has been submitted%', 'removing the card digits on a submitted claim: ' || coalesce(message, 'no error');
  assert (select payment_card_last4 from public.finance_expenses where id = v_club2) = '4242';
  perform test.login(v_exec);
  perform public.set_funding_claim_status(v_claim2, 'approved', 80);
  perform test.logout();
  message := test.error_as(v_exec, format('select public.update_finance_expense(%s, ''Other snacks'', ''Grocer'', ''Food'', ''4242'')', v_club2));
  assert message like 'This expense is on a funding claim that has been submitted%', 'edit on an approved claim: ' || coalesce(message, 'no error');
  perform test.login(v_exec);
  perform public.void_funding_claim(v_claim2, 'Started again');
  perform test.logout();
  message := test.error_as(v_exec, format('select public.update_finance_expense(%s, ''Other snacks'', ''Grocer'', ''Food'', ''4242'')', v_club2));
  assert message is null, 'edit after the claim was voided: ' || coalesce(message, '');
  -- Back from the funder with changes requested: editable.
  perform test.login(v_exec);
  select id into v_claim2 from public.create_funding_claim('Snack claim again', 'GPSG Senate', '', '', null, '', array[v_club2]);
  perform test.logout();
  insert into public.finance_claim_documents (claim_id, document_id)
    select v_claim2, id from public.finance_documents where storage_path in ('x80g/s.pdf', 'x80g/a.pdf');
  perform test.login(v_exec);
  perform public.set_funding_claim_status(v_claim2, 'ready');
  perform public.set_funding_claim_status(v_claim2, 'submitted');
  perform public.set_funding_claim_status(v_claim2, 'changes_requested', null, 'Receipt is blurry');
  perform test.logout();
  message := test.error_as(v_exec, format('select public.update_finance_expense(%s, ''Other snacks'', ''Grocer'', ''Food'', ''4242'')', v_club2));
  assert message is null, 'edit while changes are requested: ' || coalesce(message, '');

  -- ---------------------------------------------------------------------
  -- finance-9: the functions check the caller is active themselves. The statement triggers
  -- that block a deactivated writer are switched off here, so only the function can stop them.
  -- (remove_finance_document is covered in 80_finance_documents.test.sql.)
  -- ---------------------------------------------------------------------
  update public.profiles set status = 'deactivated' where id = v_member;
  set local session_replication_role = replica;
  message := test.error_as(v_member, format('select public.update_member_reimbursement(%s, ''Edited'', ''Shop'', 50, date ''2026-11-04'', ''Supplies'', ''1111'')', r5));
  assert message like '%deactivated%', 'update_member_reimbursement: ' || coalesce(message, 'no error');
  message := test.error_as(v_member, format('select public.withdraw_member_reimbursement(%s)', r5));
  assert message like '%deactivated%', 'withdraw_member_reimbursement: ' || coalesce(message, 'no error');
  message := test.error_as(v_member, 'select * from public.submit_member_reimbursement(''Late'', ''Shop'', 5, date ''2026-11-04'', ''Supplies'', ''1111'')');
  assert message like '%deactivated%', 'submit_member_reimbursement: ' || coalesce(message, 'no error');
  set local session_replication_role = origin;
  assert (select status from public.personal_reimbursements where id = r5) = 'submitted', 'nothing was written';
  update public.profiles set status = 'active' where id = v_member;
end $$;
rollback;
