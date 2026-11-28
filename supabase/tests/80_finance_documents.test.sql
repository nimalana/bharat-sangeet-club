-- Finance fixes: removing documents and the storage policies
-- (review findings finance-4 and finance-5).
--
-- The storage rows below come from the stand-in storage.objects table in
-- shims.sql. It has the same row level security rules as the real one, so it
-- answers the question that matters here: which rows a statement can see and
-- delete. It does not run the Storage service. The statement used is the one
-- the service issues for remove():
--   delete from storage.objects where bucket_id = ... and name = any (...) returning ...
-- which needs the SELECT policies as well as the DELETE policy.
begin;
do $$
declare
  v_exec uuid := test.make_user('Exec Docs', 'executive');
  v_exec2 uuid := test.make_user('Exec Docs B', 'executive');
  v_member uuid := test.make_user('Member Docs');
  v_other uuid := test.make_user('Other Docs');
  message text;
  e1 bigint; r1 bigint; e2 bigint; r2 bigint;
  v_doc bigint; v_doc2 bigint; v_doc3 bigint;
  v_path text;
  v_expense bigint;
  v_club bigint;
  v_claim bigint;
  v_pm1 text := v_member::text || '/registered.pdf';
  v_pm2 text := v_member::text || '/unregistered.pdf';
  v_po1 text := v_other::text || '/unregistered.pdf';
  v_squat text := v_member::text || '/squatted.pdf';
begin
  -- ---------------------------------------------------------------------
  -- finance-4: a receipt linked only to the expense still belongs to the request.
  -- ---------------------------------------------------------------------
  perform test.login(v_member);
  select expense_id, reimbursement_id into e1, r1 from public.submit_member_reimbursement('Strings', 'Shop', 30, date '2026-11-04', 'Supplies', '1111');
  perform test.logout();
  -- The rows below are written as the table owner (signed-in users register through register_finance_document, tested in
  -- 81_finance_register.test.sql): a receipt linked to the expense only, without a reimbursement link, which the old policies allowed.
  insert into public.finance_documents (document_type, title, storage_path, mime_type, file_size_bytes, uploaded_by)
  values ('receipt', 'Receipt', v_member::text || '/receipt-a.pdf', 'application/pdf', 10, v_member) returning id into v_doc;
  insert into public.finance_expense_documents (expense_id, document_id) values (e1, v_doc);

  -- While it waits, the only receipt stays, and a replacement makes the first one removable.
  message := test.error_as(v_member, format('select public.remove_finance_document(%s)', v_doc));
  assert message like 'A submitted request needs a receipt%', 'only receipt, expense link only: ' || coalesce(message, 'no error');
  insert into public.finance_documents (document_type, title, storage_path, mime_type, file_size_bytes, uploaded_by)
  values ('receipt', 'Receipt B', v_member::text || '/receipt-b.pdf', 'application/pdf', 10, v_member) returning id into v_doc2;
  insert into public.finance_expense_documents (expense_id, document_id) values (e1, v_doc2);

  -- Approved at 30 and paid: neither the member nor an executive can strip the receipt.
  perform test.login(v_exec2);
  perform public.review_personal_reimbursement(r1, 'approved', 30, 'ok');
  perform test.logout();
  perform test.login(v_exec);
  perform public.pay_personal_reimbursement(r1, date '2026-11-06');
  perform test.logout();
  message := test.error_as(v_member, format('select public.remove_finance_document(%s)', v_doc2));
  assert message like 'This document belongs to a request that has already been decided%', 'member, paid request, expense link only: ' || coalesce(message, 'no error');
  message := test.error_as(v_exec, format('select public.remove_finance_document(%s)', v_doc2));
  assert message like 'This document belongs to a request that has already been decided%', 'executive, paid request, expense link only: ' || coalesce(message, 'no error');
  assert exists (select 1 from public.finance_documents where id = v_doc2), 'the receipt is still registered';
  assert exists (select 1 from public.finance_expense_documents where document_id = v_doc2), 'and still linked';
  assert (select count(*) from public.finance_payments where reimbursement_id = r1 and status = 'posted') = 1, 'the payment stands';

  -- A member's purchase that is approved but has no request row, and one on a live claim.
  insert into public.finance_expenses (description, amount, purchase_date, category, paid_by, paid_by_member_id, status, created_by)
  values ('Old purchase', 25, date '2026-10-01', 'Supplies', 'member', v_member, 'approved', v_member) returning id into v_expense;
  insert into public.finance_documents (document_type, title, storage_path, mime_type, file_size_bytes, uploaded_by)
  values ('receipt', 'Old receipt', v_member::text || '/old.pdf', 'application/pdf', 10, v_member) returning id into v_doc3;
  insert into public.finance_expense_documents (expense_id, document_id) values (v_expense, v_doc3);
  message := test.error_as(v_member, format('select public.remove_finance_document(%s)', v_doc3));
  assert message like 'This document belongs to a purchase that has already been decided%', 'member, approved purchase: ' || coalesce(message, 'no error');
  -- An executive may (the expense is not on a claim and is not a request).
  message := test.error_as(v_exec, format('select public.remove_finance_document(%s)', v_doc3));
  assert message is null, 'executive, approved purchase with no request: ' || coalesce(message, '');

  perform test.login(v_member);
  select expense_id, reimbursement_id into e2, r2 from public.submit_member_reimbursement('Picks', 'Shop', 12, date '2026-11-04', 'Supplies', '1111');
  perform test.logout();
  insert into public.finance_documents (document_type, title, storage_path, mime_type, file_size_bytes, uploaded_by)
  values ('receipt', 'Picks receipt 1', v_member::text || '/picks-1.pdf', 'application/pdf', 10, v_member) returning id into v_doc;
  insert into public.finance_documents (document_type, title, storage_path, mime_type, file_size_bytes, uploaded_by)
  values ('receipt', 'Picks receipt 2', v_member::text || '/picks-2.pdf', 'application/pdf', 10, v_member) returning id into v_doc2;
  insert into public.finance_expense_documents (expense_id, document_id) values (e2, v_doc), (e2, v_doc2);
  -- Two receipts: a waiting request may drop one. Put the expense on a claim (an old direct write) and the member may not.
  perform test.login(v_exec);
  v_club := public.record_club_expense('Tabla', 'Shop', 100, date '2026-11-02', 'Instruments', 'Club bank account', '4242');
  select id into v_claim from public.create_funding_claim('Claim', 'GPSG Senate', '', '', null, '', array[v_club]);
  perform test.logout();
  set local session_replication_role = replica;
  insert into public.funding_claim_expenses (claim_id, expense_id, claimed_amount) values (v_claim, e2, 12);
  set local session_replication_role = origin;
  message := test.error_as(v_member, format('select public.remove_finance_document(%s)', v_doc));
  assert message like 'This document is evidence for an expense on a funding claim%', 'member, expense on a claim: ' || coalesce(message, 'no error');
  perform test.login(v_exec);
  perform public.remove_finance_document(v_doc);
  perform test.logout();
  message := test.error_as(v_exec, format('select public.remove_finance_document(%s)', v_doc2));
  assert message like 'A submitted request needs a receipt%' or message like 'This is the only receipt for an expense on a funding claim%',
    'the last receipt stays even for an executive: ' || coalesce(message, 'no error');

  -- A claim that was ready goes back to incomplete when its approval document is removed, and a submitted claim keeps its documents.
  insert into public.finance_documents (document_type, title, storage_path, mime_type, file_size_bytes, uploaded_by) values
    ('receipt', 'Tabla receipt', 'x80d/tabla.pdf', 'application/pdf', 10, v_exec), ('bank_statement', 'Statement', 'x80d/s.pdf', 'application/pdf', 10, v_exec),
    ('funding_approval', 'Approval', 'x80d/a.pdf', 'application/pdf', 10, v_exec);
  insert into public.finance_expense_documents (expense_id, document_id) select v_club, id from public.finance_documents where storage_path = 'x80d/tabla.pdf';
  insert into public.finance_claim_documents (claim_id, document_id) select v_claim, id from public.finance_documents where storage_path in ('x80d/s.pdf', 'x80d/a.pdf');
  set local session_replication_role = replica;
  delete from public.funding_claim_expenses where claim_id = v_claim and expense_id = e2;
  set local session_replication_role = origin;
  update public.funding_claims set requested_amount = 100 where id = v_claim;
  perform test.login(v_exec);
  perform public.set_funding_claim_status(v_claim, 'ready');
  perform public.remove_finance_document((select id from public.finance_documents where storage_path = 'x80d/a.pdf'));
  perform test.logout();
  assert (select status from public.funding_claims where id = v_claim) = 'incomplete', 'removing the approval sends a ready claim back';
  update public.funding_claims set status = 'submitted' where id = v_claim;
  message := test.error_as(v_exec, format('select public.remove_finance_document(%s)', (select id from public.finance_documents where storage_path = 'x80d/s.pdf')));
  assert message like 'This document is part of a submitted funding claim%', 'a submitted claim keeps its documents: ' || coalesce(message, 'no error');

  -- finance-9: removing a document checks the caller is active itself (the statement triggers are switched off
  -- here, so only the function can stop a deactivated member).
  insert into public.finance_documents (document_type, title, storage_path, mime_type, file_size_bytes, uploaded_by)
  values ('other', 'Loose file', v_other::text || '/loose.pdf', 'application/pdf', 10, v_other) returning id into v_doc3;
  update public.profiles set status = 'deactivated' where id = v_other;
  set local session_replication_role = replica;
  message := test.error_as(v_other, format('select public.remove_finance_document(%s)', v_doc3));
  assert message like '%deactivated%', 'remove_finance_document, deactivated caller: ' || coalesce(message, 'no error');
  set local session_replication_role = origin;
  assert exists (select 1 from public.finance_documents where id = v_doc3), 'the document is still there';
  update public.profiles set status = 'active' where id = v_other;

  -- ---------------------------------------------------------------------
  -- finance-5: after the record is gone, the file can be removed by the uploader or an executive,
  -- and nobody can remove somebody else's file or a registered one.
  -- ---------------------------------------------------------------------
  insert into storage.objects (bucket_id, name, owner_id) values
    ('finance-private', v_pm1, v_member::text), ('finance-private', v_pm2, v_member::text),
    ('finance-private', v_po1, v_other::text), ('finance-private', v_squat, v_member::text);
  insert into public.finance_documents (document_type, title, storage_path, mime_type, file_size_bytes, uploaded_by) values
    ('receipt', 'Registered', v_pm1, 'application/pdf', 10, v_member),
    ('receipt', 'Registered by someone else under this path', v_squat, 'application/pdf', 10, v_other);
  -- Storage reads the object before it removes it. A member sees their own registered file and their own
  -- unregistered one, never somebody else's unregistered one; an executive sees the whole bucket.
  -- (The squatted path is left out of these counts: a record naming another person's path makes that person's file readable
  -- to the record's uploader. register_finance_document (P1-05) can no longer create such a record, so the row is written
  -- here as the table owner; 81_finance_register.test.sql shows it refused.)
  assert test.count_as(v_member, format('select count(*) from storage.objects where bucket_id = ''finance-private'' and name = any (array[%L, %L])', v_pm1, v_pm2)) = 2, 'a member sees their registered and their unregistered file';
  assert test.count_as(v_member, format('select count(*) from storage.objects where bucket_id = ''finance-private'' and name = %L', v_po1)) = 0, 'a member does not see another member''s unregistered file';
  assert test.count_as(v_other, format('select count(*) from storage.objects where bucket_id = ''finance-private'' and name = any (array[%L, %L])', v_po1, v_pm2)) = 1, 'another member sees only their own unregistered file';
  assert test.count_as(v_exec, 'select count(*) from storage.objects where bucket_id = ''finance-private''') = 4, 'an executive sees the whole bucket, orphans included';
  -- remove(): delete ... where name = any(...) returning ...
  assert test.count_as(v_member, format('with d as (delete from storage.objects where bucket_id = ''finance-private'' and name = any (array[%L]) returning 1) select count(*) from d', v_pm1)) = 0, 'a registered file cannot be deleted';
  assert test.count_as(v_member, format('with d as (delete from storage.objects where bucket_id = ''finance-private'' and name = any (array[%L]) returning 1) select count(*) from d', v_squat)) = 0, 'a file registered by somebody else cannot be deleted by the person whose folder it is in';
  assert test.count_as(v_member, format('with d as (delete from storage.objects where bucket_id = ''finance-private'' and name = any (array[%L]) returning 1) select count(*) from d', v_po1)) = 0, 'another person''s file cannot be deleted';
  assert test.count_as(v_exec, format('with d as (delete from storage.objects where bucket_id = ''finance-private'' and name = any (array[%L]) returning 1) select count(*) from d', v_pm1)) = 0, 'an executive cannot delete a file that still has a record';
  assert test.count_as(v_member, format('with d as (delete from storage.objects where bucket_id = ''finance-private'' and name = any (array[%L]) returning 1) select count(*) from d', v_pm2)) = 1, 'an unregistered file in one''s own folder can be deleted';
  -- The whole flow: record first, then file.
  v_path := test.error_as(v_member, format('select public.remove_finance_document(%s)', (select id from public.finance_documents where storage_path = v_pm1)));
  assert v_path is null, 'the record is removed: ' || coalesce(v_path, '');
  assert test.count_as(v_member, format('with d as (delete from storage.objects where bucket_id = ''finance-private'' and name = any (array[%L]) returning 1) select count(*) from d', v_pm1)) = 1, 'then the file can be deleted by the member';
  assert exists (select 1 from public.finance_audit_log where entity_type = 'finance_documents' and action = 'delete' and actor_id = v_member), 'the removal is audited';
  -- An executive can clear an orphan in anybody's folder.
  assert test.count_as(v_exec, format('with d as (delete from storage.objects where bucket_id = ''finance-private'' and name = any (array[%L]) returning 1) select count(*) from d', v_po1)) = 1, 'an executive can delete an orphan';
  -- A deactivated account cannot.
  insert into storage.objects (bucket_id, name, owner_id) values ('finance-private', v_other::text || '/second.pdf', v_other::text);
  update public.profiles set status = 'deactivated' where id = v_other;
  assert test.count_as(v_other, format('with d as (delete from storage.objects where bucket_id = ''finance-private'' and name = any (array[%L]) returning 1) select count(*) from d', v_other::text || '/second.pdf')) = 0, 'a deactivated account cannot delete';
  update public.profiles set status = 'active' where id = v_other;
end $$;
rollback;
