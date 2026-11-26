-- Finance corrections: every void path leaves the ledger, the reimbursement
-- and the claim consistent, and nobody acts outside their role.
begin;
do $$
declare
  v_exec uuid := test.make_user('Exec Five', 'executive');
  v_exec2 uuid := test.make_user('Exec Five B', 'executive');
  v_member uuid := test.make_user('Member Five');
  v_other uuid := test.make_user('Other Five');
  message text;
  summary jsonb;
  v_income bigint;
  v_expense bigint;
  v_expense2 bigint;
  v_member_expense bigint;
  v_reimbursement bigint;
  v_payment bigint;
  v_claim bigint;
  v_claim_payment bigint;
  v_doc bigint;
  v_doc2 bigint;
  v_path text;
  v_own_expense bigint;
  v_own_reimbursement bigint;
begin
  -- Income 500, club expense 120.
  perform test.login(v_exec);
  v_income := public.record_finance_income('Gig at Memorial Hall', 500, date '2026-11-01', 'Gig revenue', 'UNC');
  v_expense := public.record_club_expense('Tabla repair', 'Music shop', 120, date '2026-11-02', 'Instruments', 'Club bank account', '4242');
  v_expense2 := public.record_club_expense('Concert snacks', 'Grocer', 80, date '2026-11-03', 'Food', 'Club bank account', '4242');
  summary := public.get_finance_summary();
  perform test.logout();
  assert (summary ->> 'available_cash')::numeric = 300, 'cash = 500 - 120 - 80, got ' || (summary ->> 'available_cash');
  assert (summary ->> 'spending')::numeric = 200;

  -- Member reimbursement of 40.
  perform test.login(v_member);
  select expense_id, reimbursement_id into v_member_expense, v_reimbursement
  from public.submit_member_reimbursement('Strings', 'Shop', 40, date '2026-11-04', 'Supplies', '1111', 'For the concert');
  perform test.logout();
  insert into public.finance_documents (document_type, title, storage_path, mime_type, file_size_bytes, uploaded_by)
  values ('receipt', 'Strings receipt', v_member::text || '/receipt-1.pdf', 'application/pdf', 1000, v_member) returning id into v_doc;
  insert into public.finance_reimbursement_documents (reimbursement_id, document_id) values (v_reimbursement, v_doc);
  insert into public.finance_expense_documents (expense_id, document_id) values (v_member_expense, v_doc);

  -- Member edits their own undecided request; others cannot.
  message := test.error_as(v_other, format('select public.update_member_reimbursement(%s, ''Hack'', ''Shop'', 999, date ''2026-11-04'', ''Supplies'', ''1111'')', v_reimbursement));
  assert message like 'Reimbursement request not found%', 'cannot edit someone else''s request: ' || coalesce(message, 'no error');
  message := test.error_as(v_member, format('select public.update_member_reimbursement(%s, ''Sitar strings'', ''Shop'', 45, date ''2026-11-04'', ''Supplies'', ''1111'', ''Corrected total'')', v_reimbursement));
  assert message is null, coalesce(message, '');
  assert (select amount = 45 and description = 'Sitar strings' from public.finance_expenses where id = v_member_expense);
  assert (select requested_amount = 45 from public.personal_reimbursements where id = v_reimbursement);

  -- The only receipt of a submitted request cannot be removed.
  message := test.error_as(v_member, format('select public.remove_finance_document(%s)', v_doc));
  assert message like 'A submitted request needs a receipt%', coalesce(message, 'no error');
  message := test.error_as(v_other, format('select public.remove_finance_document(%s)', v_doc));
  assert message like 'Document not found%', 'cannot remove someone else''s document';

  -- Changes requested, then resubmitted by editing.
  message := test.error_as(v_member, format('select public.request_reimbursement_changes(%s, ''Need itemised receipt'')', v_reimbursement));
  assert message like 'executive permission required%';
  message := test.error_as(v_exec, format('select public.request_reimbursement_changes(%s, ''Need itemised receipt'')', v_reimbursement));
  assert message is null, coalesce(message, '');
  assert (select status from public.personal_reimbursements where id = v_reimbursement) = 'changes_requested';
  message := test.error_as(v_exec, format('select public.review_personal_reimbursement(%s, ''approved'')', v_reimbursement));
  assert message like 'submitted reimbursement not found%', 'cannot approve while changes are requested';
  -- While changes are requested the member may swap the receipt.
  insert into public.finance_documents (document_type, title, storage_path, mime_type, file_size_bytes, uploaded_by)
  values ('receipt', 'Itemised receipt', v_member::text || '/receipt-2.pdf', 'application/pdf', 1000, v_member) returning id into v_doc2;
  insert into public.finance_reimbursement_documents (reimbursement_id, document_id) values (v_reimbursement, v_doc2);
  insert into public.finance_expense_documents (expense_id, document_id) values (v_member_expense, v_doc2);
  perform test.login(v_member);
  v_path := public.remove_finance_document(v_doc);
  perform public.update_member_reimbursement(v_reimbursement, 'Sitar strings', 'Shop', 45, date '2026-11-04', 'Supplies', '1111', 'Receipt replaced');
  perform test.logout();
  assert v_path = v_member::text || '/receipt-1.pdf', 'the storage path is returned for cleanup';
  assert not exists (select 1 from public.finance_documents where id = v_doc);
  assert exists (select 1 from public.finance_audit_log where entity_type = 'finance_documents' and entity_id = v_doc and action = 'delete' and actor_id = v_member), 'document removal is audited';
  assert (select status from public.personal_reimbursements where id = v_reimbursement) = 'submitted', 'saving resubmits';

  -- Partial approval, payment, then void the payment.
  message := test.error_as(v_exec, format('select public.review_personal_reimbursement(%s, ''approved'', 30, ''Covered up to the limit'')', v_reimbursement));
  assert message is null, coalesce(message, '');
  message := test.error_as(v_member, format('select public.update_member_reimbursement(%s, ''Late'', ''Shop'', 45, date ''2026-11-04'', ''Supplies'', ''1111'')', v_reimbursement));
  assert message like 'This request has already been decided%';
  message := test.error_as(v_member, format('select public.withdraw_member_reimbursement(%s)', v_reimbursement));
  assert message like 'This request has already been decided%';
  perform test.login(v_exec);
  v_payment := public.pay_personal_reimbursement(v_reimbursement, date '2026-11-05');
  summary := public.get_finance_summary();
  perform test.logout();
  assert (summary ->> 'available_cash')::numeric = 270, 'cash after paying 30: ' || (summary ->> 'available_cash');

  message := test.error_as(v_exec, format('select public.void_finance_expense(%s, ''Wrong'')', v_member_expense));
  assert message like 'This purchase has been reimbursed%', 'a reimbursed purchase cannot be voided directly';
  message := test.error_as(v_member, format('select public.void_finance_payment(%s, ''Mine'')', v_payment));
  assert message like 'executive permission required%';
  message := test.error_as(v_exec, format('select public.void_finance_payment(%s, '''')', v_payment));
  assert message like 'Say why%';
  message := test.error_as(v_exec, format('select public.void_finance_payment(%s, ''Paid the wrong person'')', v_payment));
  assert message is null, coalesce(message, '');
  assert (select status = 'voided' and voided_by = v_exec and void_reason = 'Paid the wrong person' from public.finance_payments where id = v_payment);
  assert (select status = 'approved' and paid_at is null from public.personal_reimbursements where id = v_reimbursement), 'reimbursement returns to approved';
  assert (select status from public.finance_expenses where id = v_member_expense) = 'approved', 'expense returns to approved';
  perform test.login(v_exec);
  summary := public.get_finance_summary();
  perform test.logout();
  assert (summary ->> 'available_cash')::numeric = 300, 'cash restored after void: ' || (summary ->> 'available_cash');
  assert (summary ->> 'pending_reimbursement_total')::numeric = 30;
  message := test.error_as(v_exec, format('select public.void_finance_payment(%s, ''Again'')', v_payment));
  assert message like 'This payment is already voided%';

  -- It can be paid again, and then nothing is double counted.
  perform test.login(v_exec);
  v_payment := public.pay_personal_reimbursement(v_reimbursement, date '2026-11-06');
  summary := public.get_finance_summary();
  perform test.logout();
  assert (summary ->> 'available_cash')::numeric = 270;

  -- Nobody reviews their own request.
  perform test.login(v_exec);
  select expense_id, reimbursement_id into v_own_expense, v_own_reimbursement
  from public.submit_member_reimbursement('Own purchase', 'Shop', 10, date '2026-11-04', 'Supplies', '2222');
  perform test.logout();
  message := test.error_as(v_exec, format('select public.review_personal_reimbursement(%s, ''approved'')', v_own_reimbursement));
  assert message like 'You cannot review your own reimbursement%', coalesce(message, 'no error');
  -- Withdraw: both records are voided together.
  message := test.error_as(v_exec, format('select public.withdraw_member_reimbursement(%s)', v_own_reimbursement));
  assert message is null, coalesce(message, '');
  assert (select status from public.personal_reimbursements where id = v_own_reimbursement) = 'voided';
  assert (select status from public.finance_expenses where id = v_own_expense) = 'voided';
  message := test.error_as(v_exec2, format('select public.review_personal_reimbursement(%s, ''approved'')', v_own_reimbursement));
  assert message like 'submitted reimbursement not found%', 'a withdrawn request cannot be approved';

  -- Funding claim built in one call from two club expenses (120 + 80).
  message := test.error_as(v_member, format('select public.create_funding_claim(''X'', ''GPSG'', '''', '''', null, '''', array[%s]::bigint[])', v_expense));
  assert message like 'executive permission required%';
  message := test.error_as(v_exec, 'select public.create_funding_claim(''Fall concert'', ''GPSG Senate'', '''', '''', null, '''', array[]::bigint[])');
  assert message like 'Select at least one expense%';
  perform test.login(v_exec);
  select id into v_claim from public.create_funding_claim('Fall concert', 'GPSG Senate', 'A-1', 'H-1', date '2026-12-01', '', array[v_expense]);
  perform public.add_funding_claim_expense(v_claim, v_expense2);
  perform test.logout();
  assert (select requested_amount = 200 and status = 'incomplete' from public.funding_claims where id = v_claim), 'claim totals its expenses';
  message := test.error_as(v_exec, format('select public.create_funding_claim(''Dup'', ''GPSG'', '''', '''', null, '''', array[%s]::bigint[])', v_expense));
  assert message like '%already fully claimed%', 'an expense cannot be claimed twice';
  message := test.error_as(v_exec, format('select public.void_finance_expense(%s, ''Mistake'')', v_expense));
  assert message like 'This expense is part of a funding claim%';

  -- Readiness is enforced by the database.
  message := test.error_as(v_exec, format('select public.set_funding_claim_status(%s, ''ready'')', v_claim));
  assert message like 'This claim still needs:%receipt%statement%approval%', coalesce(message, 'no error');
  message := test.error_as(v_exec, format('select public.set_funding_claim_status(%s, ''approved'', 200)', v_claim));
  assert message like 'A claim that is incomplete cannot be marked approved%', coalesce(message, 'no error');
  insert into public.finance_documents (document_type, title, storage_path, mime_type, file_size_bytes, uploaded_by) values
    ('receipt', 'R1', 'x/r1.pdf', 'application/pdf', 10, v_exec), ('receipt', 'R2', 'x/r2.pdf', 'application/pdf', 10, v_exec),
    ('bank_statement', 'Statement', 'x/s.pdf', 'application/pdf', 10, v_exec), ('funding_approval', 'Approval', 'x/a.pdf', 'application/pdf', 10, v_exec);
  insert into public.finance_expense_documents (expense_id, document_id)
    select v_expense, id from public.finance_documents where storage_path = 'x/r1.pdf'
    union all select v_expense2, id from public.finance_documents where storage_path = 'x/r2.pdf';
  insert into public.finance_claim_documents (claim_id, document_id)
    select v_claim, id from public.finance_documents where storage_path in ('x/s.pdf', 'x/a.pdf');
  perform test.login(v_exec);
  perform public.set_funding_claim_status(v_claim, 'ready');
  perform test.logout();

  -- The only receipt of a claimed expense cannot be removed.
  select id into v_doc from public.finance_documents where storage_path = 'x/r1.pdf';
  message := test.error_as(v_exec, format('select public.remove_finance_document(%s)', v_doc));
  assert message like 'This is the only receipt for an expense on a funding claim%', coalesce(message, 'no error');

  -- Remove an expense before submission; total follows.
  perform test.login(v_exec);
  perform public.remove_funding_claim_expense(v_claim, v_expense2);
  perform test.logout();
  assert (select requested_amount from public.funding_claims where id = v_claim) = 120;
  message := test.error_as(v_exec, format('select public.remove_funding_claim_expense(%s, %s)', v_claim, v_expense));
  assert message like 'A claim needs at least one expense%';

  perform test.login(v_exec);
  perform public.set_funding_claim_status(v_claim, 'submitted');
  perform test.logout();
  message := test.error_as(v_exec, format('select public.add_funding_claim_expense(%s, %s)', v_claim, v_expense2));
  assert message like 'Expenses can only be changed before a claim is submitted%';
  message := test.error_as(v_exec, format('select public.set_funding_claim_status(%s, ''approved'')', v_claim));
  assert message like 'Enter the amount the funder approved%';
  message := test.error_as(v_exec, format('select public.set_funding_claim_status(%s, ''approved'', 500)', v_claim));
  assert message like 'The approved amount cannot be more%';
  message := test.error_as(v_exec, format('select public.set_funding_claim_status(%s, ''paid'')', v_claim));
  assert message like 'A claim that is submitted cannot be marked paid%', 'paid is only reachable by recording a payment';
  perform test.login(v_exec);
  perform public.set_funding_claim_status(v_claim, 'approved', 100, 'Senate approved 100 of 120');
  v_claim_payment := public.record_funding_claim_payment(v_claim, 100, date '2026-11-20');
  summary := public.get_finance_summary();
  perform test.logout();
  assert (select status = 'paid' and received_amount = 100 from public.funding_claims where id = v_claim);
  assert (summary ->> 'available_cash')::numeric = 370, 'cash after funding: ' || (summary ->> 'available_cash');

  -- A claim with money received cannot be voided until the receipt is.
  message := test.error_as(v_exec, format('select public.void_funding_claim(%s, ''Duplicate'')', v_claim));
  assert message like 'Money has been received for this claim%';
  perform test.login(v_exec);
  perform public.void_finance_payment(v_claim_payment, 'Recorded on the wrong claim');
  summary := public.get_finance_summary();
  perform test.logout();
  assert (select status = 'approved' and received_amount = 0 from public.funding_claims where id = v_claim), 'claim returns to approved';
  assert (summary ->> 'available_cash')::numeric = 270;
  assert (summary ->> 'expected_funding')::numeric = 100;
  perform test.login(v_exec);
  perform public.void_funding_claim(v_claim, 'Duplicate of an earlier claim');
  perform test.logout();
  assert (select status = 'voided' and void_reason is not null from public.funding_claims where id = v_claim);
  assert not exists (select 1 from public.funding_claim_expenses where claim_id = v_claim), 'expenses are released';

  -- Released club expense: edit details (amount is locked), then void with its payment.
  message := test.error_as(v_exec, format('select public.update_finance_expense(%s, ''Tabla repair'', ''Music shop'', ''Instruments'', ''4242'', null, null, false, '''', null, null, '''', 999)', v_expense));
  assert message like 'The amount and date are locked%';
  message := test.error_as(v_exec, format('select public.update_finance_expense(%s, ''Tabla head replacement'', ''Music shop'', ''Repairs'', ''4242'')', v_expense));
  assert message is null, coalesce(message, '');
  assert (select description = 'Tabla head replacement' and category = 'Repairs' from public.finance_payments where expense_id = v_expense), 'ledger line follows the edit';
  perform test.login(v_exec);
  perform public.void_finance_expense(v_expense, 'Entered twice');
  summary := public.get_finance_summary();
  perform test.logout();
  assert (select status from public.finance_payments where expense_id = v_expense) = 'voided', 'club payment is voided with its expense';
  assert (summary ->> 'available_cash')::numeric = 390, 'cash after voiding the 120 expense: ' || (summary ->> 'available_cash');
  assert (summary ->> 'spending')::numeric = 125, 'spending = 80 club + 45 member: ' || (summary ->> 'spending');

  -- Voiding the payment of a club expense voids the expense too.
  perform test.login(v_exec);
  perform public.void_finance_payment((select id from public.finance_payments where expense_id = v_expense2), 'Refunded by vendor');
  perform public.void_finance_payment(v_income, 'Cheque bounced');
  summary := public.get_finance_summary();
  perform test.logout();
  assert (select status from public.finance_expenses where id = v_expense2) = 'voided';
  assert (summary ->> 'available_cash')::numeric = -30, 'only the 30 reimbursement remains: ' || (summary ->> 'available_cash');
  assert (summary ->> 'income')::numeric = 0;

  -- Every change is in the audit log, and members see only their own totals.
  assert (select count(*) from public.finance_audit_log where entity_type = 'finance_payments' and action = 'update') >= 5;
  perform test.login(v_other);
  summary := public.get_finance_summary();
  perform test.logout();
  assert (summary ->> 'available_cash')::numeric = 0 and (summary ->> 'spending')::numeric = 0, 'a member with no requests sees no club totals';
end $$;
rollback;
