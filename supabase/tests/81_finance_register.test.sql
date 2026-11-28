-- Phase 4.2: register_finance_document (P0-05, P1-05), the closed direct writes, the rejection audit (P2-01),
-- event evidence (P1-03), card evidence (P1-04), self-payment (D4) and what can still change a registered document.
--
-- Everything a refusal says is also checked against the words friendlyError (lib/errors.ts) would replace
-- ("violates", "constraint", "permission denied", ...): the sentence has to reach the person as it is.
-- The storage rows come from the stand-in storage.objects of shims.sql; it has no Storage service behind it, so what
-- this file cannot show is a real upload followed by a real registration (the end-to-end suite does).
begin;

-- Every refusal sentence register_as sees, so the end of the first block can check that none reads like a raw database error.
create temp table t81_msgs (msg text);

-- Registers as a user and answers 'ok' or '<sqlstate>:<message>'.
create function test.register_as(
  p_user uuid, p_path text, p_type text, p_expense bigint default null, p_reimbursement bigint default null, p_claim bigint default null,
  p_mime text default 'application/pdf', p_size bigint default 100, p_title text default 'Doc', p_last4 text default null
) returns text language plpgsql as $$
declare v bigint; st text;
begin
  perform test.login(p_user);
  begin
    v := public.register_finance_document(p_path, p_type, p_title, p_mime, p_size, p_last4, p_expense, p_reimbursement, p_claim);
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    perform test.logout();
    insert into t81_msgs values (sqlerrm);
    return st || ':' || sqlerrm;
  end;
  perform test.logout();
  return 'ok';
end $$;

-- A stored object in a folder (as the table owner). p_owner: 'same' (the folder's user), 'null' (not filled in), or a user id.
create function test.mkobj(p_folder uuid, p_name text, p_owner text default 'same') returns text language plpgsql as $$
declare v_path text := p_folder::text || '/' || p_name;
begin
  insert into storage.objects (bucket_id, name, owner_id)
  values ('finance-private', v_path, case p_owner when 'same' then p_folder::text when 'null' then null else p_owner end);
  return v_path;
end $$;

-- 'ok' or the SQLSTATE of a statement run as a user.
create function test.state_of(p_user uuid, p_sql text) returns text language plpgsql as $$
declare st text;
begin
  perform test.login(p_user);
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    perform test.logout();
    return st;
  end;
  perform test.logout();
  return 'ok';
end $$;

-- True when a message would be replaced by friendlyError's fallback instead of reaching the person.
create function test.raw_looking(p_message text) returns boolean language sql immutable as $$
  select p_message ~* 'violates|constraint|relation "|column "|syntax error|permission denied|row-level security|JWT|schema cache';
$$;

do $$
declare
  v_exec uuid := test.make_user('Exec Register', 'executive');
  v_exec2 uuid := test.make_user('Exec Register B', 'executive');
  v_admin uuid := test.make_user('Admin Register', 'admin');
  v_a uuid := test.make_user('Member Register A');
  v_b uuid := test.make_user('Member Register B');
  v_dead uuid := test.make_user('Member Register Dead');
  v_other_exec uuid;
  ea bigint; ra bigint; eb bigint; rb bigint; ec bigint; rc bigint; e_old bigint; r_old bigint; e_dec bigint; r_dec bigint;
  v_club bigint; v_club2 bigint; v_claim bigint; v_claim2 bigint; v_claim3 bigint;
  v_doc bigint; v_doc2 bigint;
  p text; p2 text; r text;
  n_docs bigint; n_links bigint; n_audit bigint;
  v_audit public.finance_audit_log;
begin
  perform test.login(v_a);
  select expense_id, reimbursement_id into ea, ra from public.submit_member_reimbursement('A strings', 'Shop', 30, date '2026-11-04', 'Supplies', '1111');
  select expense_id, reimbursement_id into ec, rc from public.submit_member_reimbursement('A second', 'Shop', 20, date '2026-11-04', 'Supplies', '1111');
  select expense_id, reimbursement_id into e_dec, r_dec from public.submit_member_reimbursement('A decided', 'Shop', 25, date '2026-11-04', 'Supplies', '1111');
  perform test.logout();
  perform test.login(v_b);
  select expense_id, reimbursement_id into eb, rb from public.submit_member_reimbursement('B picks', 'Shop', 12, date '2026-11-04', 'Supplies', '2222');
  perform test.logout();
  perform test.login(v_exec);
  v_club := public.record_club_expense('Tabla repair', 'Music shop', 100, date '2026-11-02', 'Instruments', 'Club bank account', '4242');
  v_club2 := public.record_club_expense('Snacks', 'Grocer', 40, date '2026-11-03', 'Food', 'Club bank account', '4242');
  select id into v_claim from public.create_funding_claim('Fall concert', 'GPSG Senate', 'A-1', 'H-1', date '2026-12-01', '', array[v_club]);
  select id into v_claim2 from public.create_funding_claim('Snack claim', 'GPSG Senate', '', '', null, '', array[v_club2]);
  perform test.logout();

  -- ---------------------------------------------------------------------
  -- What works: a member's receipt on their own request, an executive's on a club purchase and a claim.
  -- ---------------------------------------------------------------------
  p := test.mkobj(v_a, 'receipt-1.pdf');
  r := test.register_as(v_a, p, 'receipt', ea, ra, null, 'application/pdf', 1000, '  Receipt A  ', '1111');
  assert r = 'ok', 'member registers a receipt on their own request: ' || r;
  select id into v_doc from public.finance_documents where storage_path = p;
  assert (select uploaded_by = v_a and title = 'Receipt A' and mime_type = 'application/pdf' and file_size_bytes = 1000 and payment_card_last4 = '1111' and document_type = 'receipt'
          from public.finance_documents where id = v_doc), 'the row says who uploaded it (the caller), with the title trimmed';
  assert exists (select 1 from public.finance_expense_documents where document_id = v_doc and expense_id = ea), 'linked to the expense';
  assert exists (select 1 from public.finance_reimbursement_documents where document_id = v_doc and reimbursement_id = ra), 'and to the request';
  assert not exists (select 1 from public.finance_claim_documents where document_id = v_doc), 'and to nothing else';
  select * into v_audit from public.finance_audit_log where entity_type = 'finance_documents' and entity_id = v_doc;
  assert v_audit.action = 'insert' and v_audit.actor_id = v_a and v_audit.before_data is null, 'one audit row: who, what, insert';
  assert (v_audit.after_data -> 'linked_to' ->> 'expense_id')::bigint = ea and (v_audit.after_data -> 'linked_to' ->> 'reimbursement_id')::bigint = ra
         and not (v_audit.after_data -> 'linked_to' ? 'claim_id') and v_audit.after_data ->> 'storage_path' = p, 'the audit row names the targets and the path';
  assert (select count(*) from public.finance_audit_log where entity_type = 'finance_documents' and entity_id = v_doc) = 1, 'exactly one';

  -- A statement as a PDF with the card digits, and an object whose owner Storage did not fill in.
  p := test.mkobj(v_a, 'statement.pdf', 'null');
  r := test.register_as(v_a, p, 'card_statement', ea, ra, null, 'application/pdf', 500, 'Payment card statement', '1111');
  assert r = 'ok', 'a statement for the request (owner not recorded by Storage): ' || r;
  -- A picture as a receipt, the type in capitals.
  p := test.mkobj(v_a, 'photo.png');
  assert test.register_as(v_a, p, 'receipt', ec, rc, null, 'IMAGE/PNG') = 'ok', 'a PNG receipt (the type is compared in lower case)';
  assert (select mime_type from public.finance_documents where storage_path = p) = 'image/png';

  p := test.mkobj(v_exec, 'club-receipt.pdf');
  assert test.register_as(v_exec, p, 'receipt', v_club) = 'ok', 'an executive attaches a receipt to a club purchase';
  p := test.mkobj(v_exec, 'approval.pdf');
  assert test.register_as(v_exec, p, 'funding_approval', null, null, v_claim) = 'ok', 'an executive attaches the funding approval to a claim';
  p := test.mkobj(v_exec, 'bank.pdf');
  assert test.register_as(v_exec, p, 'bank_statement', null, null, v_claim) = 'ok', 'and a bank statement';
  p := test.mkobj(v_exec2, 'for-a.pdf');
  assert test.register_as(v_exec2, p, 'receipt', ea, ra) = 'ok', 'an executive may add evidence to a member request that is still under review (it is theirs as uploader)';
  assert (select uploaded_by from public.finance_documents where storage_path = p) = v_exec2, 'and the record says it was the executive who uploaded it';

  -- ---------------------------------------------------------------------
  -- Refusals. Count everything first: a refused call must leave nothing behind.
  -- ---------------------------------------------------------------------
  select count(*) into n_docs from public.finance_documents;
  select (select count(*) from public.finance_expense_documents) + (select count(*) from public.finance_reimbursement_documents) + (select count(*) from public.finance_claim_documents) into n_links;
  select count(*) into n_audit from public.finance_audit_log where entity_type = 'finance_documents';

  -- Member A against member B's rows, and B's folder.
  p := test.mkobj(v_a, 'for-b.pdf');
  r := test.register_as(v_a, p, 'receipt', null, rb);
  assert r like 'P0002:Reimbursement request not found', 'A, B''s request: ' || r;
  r := test.register_as(v_a, p, 'receipt', eb);
  assert r like 'P0002:Expense not found', 'A, B''s purchase: ' || r;
  r := test.register_as(v_a, p, 'receipt', eb, rb);
  assert r like 'P0002:Reimbursement request not found', 'A, B''s purchase and request: ' || r;
  p2 := test.mkobj(v_b, 'b-file.pdf');
  r := test.register_as(v_a, p2, 'receipt', ea, ra);
  assert r like '42501:The file must be stored in your own folder', 'A, a path in B''s folder, on A''s own request: ' || r;
  assert test.count_as(v_a, format('select count(*) from storage.objects where name = %L', p2)) = 0, 'and A still cannot read B''s file (P1-05: the record that would have unlocked it was refused)';
  r := test.register_as(v_a, p2, 'receipt', eb, rb);
  assert r = '42501:The file must be stored in your own folder', 'A, a path in B''s folder, on B''s request: ' || r;
  r := test.register_as(v_a, v_b::text || '/../' || v_a::text || '/x.pdf', 'receipt', ea, ra);
  assert r like '42501:The file must be stored in your own folder', 'a path that starts in B''s folder and walks back out: ' || r;
  r := test.register_as(v_a, 'no-folder.pdf', 'receipt', ea, ra);
  assert r like '42501:The file must be stored in your own folder', 'a path with no folder: ' || r;
  r := test.register_as(v_a, v_a::text || '/', 'receipt', ea, ra);
  assert r like '42501:The file must be stored in your own folder', 'a folder and no file name: ' || r;
  r := test.register_as(v_a, upper(v_a::text) || '/x.pdf', 'receipt', ea, ra);
  assert r = '42501:The file must be stored in your own folder', 'the folder in capitals is not accepted as the caller''s: ' || r;

  -- A path with nothing stored behind it, and a stored file that is not the caller's or not in the bucket.
  r := test.register_as(v_a, v_a::text || '/never-uploaded.pdf', 'receipt', ea, ra);
  assert r like '22023:The file was not found in storage. Upload it again.', 'no object: ' || r;
  insert into storage.buckets (id, name) values ('other-bucket', 'other-bucket') on conflict do nothing;
  insert into storage.objects (bucket_id, name, owner_id) values ('other-bucket', v_a::text || '/elsewhere.pdf', v_a::text);
  r := test.register_as(v_a, v_a::text || '/elsewhere.pdf', 'receipt', ea, ra);
  assert r like '22023:The file was not found in storage%', 'an object of the same name in another bucket does not count: ' || r;
  p := test.mkobj(v_a, 'not-mine.pdf', v_b::text);
  r := test.register_as(v_a, p, 'receipt', ea, ra);
  assert r like '42501:That file was uploaded by someone else', 'an object in A''s folder that Storage says B owns: ' || r;
  -- A deleted object (the upload was cleaned up) cannot be registered afterwards.
  p := test.mkobj(v_a, 'gone.pdf');
  delete from storage.objects where name = p;
  r := test.register_as(v_a, p, 'receipt', ea, ra);
  assert r like '22023:The file was not found in storage%', 'a deleted object: ' || r;

  -- The input rules, each with its own sentence.
  p := test.mkobj(v_a, 'rules.pdf');
  r := test.register_as(v_a, p, 'selfie', ea, ra);                                    assert r = '22023:Choose what kind of document this is', 'unknown type: ' || r;
  r := test.register_as(v_a, p, 'receipt', ea, ra, null, 'application/pdf', 100, '   ');  assert r = '22023:Give the document a title of 180 characters or fewer', 'blank title: ' || r;
  r := test.register_as(v_a, p, 'receipt', ea, ra, null, 'application/pdf', 100, repeat('x', 181)); assert r = '22023:Give the document a title of 180 characters or fewer', 'title of 181: ' || r;
  r := test.register_as(v_a, p, 'receipt', ea, ra, null, 'application/pdf', 0);        assert r = '22023:Choose a document to upload', 'empty file: ' || r;
  r := test.register_as(v_a, p, 'receipt', ea, ra, null, 'application/pdf', -5);       assert r = '22023:Choose a document to upload', 'negative size: ' || r;
  r := test.register_as(v_a, p, 'receipt', ea, ra, null, 'application/pdf', 10485761); assert r = '22023:Finance documents must be 10 MB or smaller', 'over 10 MB: ' || r;
  r := test.register_as(v_a, p, 'receipt', ea, ra, null, 'text/html');                 assert r = '22023:Upload a PDF, JPEG or PNG file', 'a type the bucket does not take: ' || r;
  r := test.register_as(v_a, p, 'receipt', ea, ra, null, '');                         assert r = '22023:Upload a PDF, JPEG or PNG file', 'no type: ' || r;
  r := test.register_as(v_a, p, 'bank_statement', ea, ra, null, 'image/png');         assert r = '22023:Statements must be uploaded as PDF documents, not screenshots', 'statement as an image: ' || r;
  r := test.register_as(v_a, p, 'card_statement', ea, ra, null, 'image/jpeg');        assert r = '22023:Statements must be uploaded as PDF documents, not screenshots', 'card statement as an image: ' || r;
  r := test.register_as(v_a, p, 'receipt', ea, ra, null, 'application/pdf', 100, 'Doc', '12a4'); assert r = '22023:card last four must contain four digits', 'card digits: ' || r;
  r := test.register_as(v_a, p, 'receipt', ea, ra, null, 'application/pdf', 100, 'Doc', '123');  assert r = '22023:card last four must contain four digits', 'three digits: ' || r;
  r := test.register_as(v_a, p, 'receipt');                                          assert r = '22023:Attach the document to a purchase, a reimbursement request or a funding claim', 'no target: ' || r;
  r := test.register_as(v_a, p, 'receipt', ec, ra);                                   assert r = '22023:That request belongs to a different purchase', 'a request and another request''s purchase: ' || r;

  -- Decided, voided and locked targets.
  -- A request that has been approved (A's 'decided' one), declined and paid; for the member and for an executive.
  perform test.login(v_exec2);
  perform public.review_personal_reimbursement(r_dec, 'approved', 25, 'ok');
  perform test.logout();
  p := test.mkobj(v_a, 'late.pdf');
  p2 := test.mkobj(v_exec, 'late-exec.pdf');
  r := test.register_as(v_a, p, 'receipt', e_dec, r_dec);
  assert r = '22023:This request has already been decided, so documents can no longer be added', 'the member, an approved request: ' || r;
  r := test.register_as(v_exec, p2, 'receipt', e_dec, r_dec);
  assert r = '22023:This request has already been decided, so documents can no longer be added', 'an executive, an approved request: ' || r;
  r := test.register_as(v_a, p, 'receipt', e_dec);
  assert r = '22023:This purchase has already been decided, so documents can no longer be added', 'the member, the approved purchase alone: ' || r;
  r := test.register_as(v_exec, p2, 'receipt', e_dec);
  assert r = '22023:This purchase has already been decided, so documents can no longer be added', 'an executive, the approved member purchase alone: ' || r;
  perform test.login(v_exec);
  perform public.pay_personal_reimbursement(r_dec, date '2026-11-10');
  perform test.logout();
  r := test.register_as(v_a, p, 'receipt', e_dec, r_dec);
  assert r = '22023:This request has already been decided, so documents can no longer be added', 'the member, a paid request: ' || r;
  r := test.register_as(v_a, p, 'receipt', e_dec);
  assert r = '22023:This purchase has already been decided, so documents can no longer be added', 'the member, the settled purchase: ' || r;
  -- Declined.
  perform test.login(v_b);
  select expense_id, reimbursement_id into e_old, r_old from public.submit_member_reimbursement('B declined', 'Shop', 9, date '2026-11-04', 'Supplies', '2222');
  perform test.logout();
  perform test.login(v_exec);
  perform public.review_personal_reimbursement(r_old, 'rejected', null, 'No');
  perform test.logout();
  p2 := test.mkobj(v_b, 'late-b.pdf');
  assert test.register_as(v_b, p2, 'receipt', e_old, r_old) = '22023:This request has already been decided, so documents can no longer be added', 'the member, a declined request';
  assert test.register_as(v_b, p2, 'receipt', e_old) = '22023:This purchase has already been decided, so documents can no longer be added', 'the member, a declined purchase';
  -- Withdrawn (voided) by the member, then voided by an executive.
  perform test.login(v_b);
  select expense_id, reimbursement_id into e_old, r_old from public.submit_member_reimbursement('B withdrawn', 'Shop', 8, date '2026-11-04', 'Supplies', '2222');
  perform public.withdraw_member_reimbursement(r_old);
  perform test.logout();
  assert test.register_as(v_b, p2, 'receipt', e_old, r_old) = '22023:This request has already been decided, so documents can no longer be added', 'the member, a withdrawn request';
  assert test.register_as(v_b, p2, 'receipt', e_old) = '22023:This purchase has been voided, so documents can no longer be added', 'the member, a withdrawn (voided) purchase';
  assert test.register_as(v_exec, test.mkobj(v_exec, 'voided.pdf'), 'receipt', e_old) = '22023:This purchase has been voided, so documents can no longer be added', 'an executive, a voided member purchase';
  perform test.login(v_exec);
  v_club2 := public.record_club_expense('Entered twice', 'Grocer', 33, date '2026-11-03', 'Food', 'Club bank account', '4242');
  perform public.void_finance_expense(v_club2, 'Entered twice');
  perform test.logout();
  assert test.register_as(v_exec, test.mkobj(v_exec, 'voided-club.pdf'), 'receipt', v_club2) = '22023:This purchase has been voided, so documents can no longer be added', 'an executive, a voided club purchase';

  -- Claims: members never; locked and voided claims; the two documents made after submission.
  r := test.register_as(v_a, test.mkobj(v_a, 'claim.pdf'), 'receipt', null, null, v_claim);
  assert r = '42501:executive permission required', 'a member, a claim: ' || r;
  r := test.register_as(v_a, test.mkobj(v_a, 'claim2.pdf'), 'funding_approval', null, null, v_claim);
  assert r = '42501:executive permission required', 'a member, the funding approval of a claim: ' || r;
  r := test.register_as(v_exec, test.mkobj(v_exec, 'nothing.pdf'), 'receipt', null, null, 987654);
  assert r = 'P0002:funding claim not found', 'a claim that does not exist: ' || r;
  r := test.register_as(v_exec, test.mkobj(v_exec, 'nothing2.pdf'), 'receipt', 987654);
  assert r = 'P0002:Expense not found', 'an expense that does not exist: ' || r;
  r := test.register_as(v_exec, test.mkobj(v_exec, 'nothing3.pdf'), 'receipt', null, 987654);
  assert r = 'P0002:Reimbursement request not found', 'a request that does not exist: ' || r;
  -- v_claim2 holds the voided v_club2? No: it holds the snack expense; make it ready and submit it.
  -- Give claim 2 its paper, as the old direct writes would have.
  insert into public.finance_documents (document_type, title, storage_path, mime_type, file_size_bytes, uploaded_by) values
    ('receipt', 'Snack receipt', 'x81/r.pdf', 'application/pdf', 10, v_exec), ('bank_statement', 'S', 'x81/s.pdf', 'application/pdf', 10, v_exec), ('funding_approval', 'A', 'x81/a.pdf', 'application/pdf', 10, v_exec);
  insert into public.finance_expense_documents (expense_id, document_id) select e.id, d.id from public.finance_documents d, public.finance_expenses e
    where d.storage_path = 'x81/r.pdf' and e.id = (select expense_id from public.funding_claim_expenses where claim_id = v_claim2);
  insert into public.finance_claim_documents (claim_id, document_id) select v_claim2, id from public.finance_documents where storage_path in ('x81/s.pdf', 'x81/a.pdf');
  perform test.login(v_exec);
  perform public.set_funding_claim_status(v_claim2, 'ready');
  perform test.logout();
  assert test.register_as(v_exec, test.mkobj(v_exec, 'ready-claim.pdf'), 'event_support', null, null, v_claim2) = 'ok', 'a ready claim still takes documents (it is still being assembled)';
  perform test.login(v_exec);
  perform public.set_funding_claim_status(v_claim2, 'submitted');
  perform test.logout();
  p := test.mkobj(v_exec, 'after-submit.pdf');
  r := test.register_as(v_exec, p, 'bank_statement', null, null, v_claim2);
  assert r like '22023:This funding claim is with the funder, so its documents are locked.%', 'a submitted claim, a statement: ' || r;
  r := test.register_as(v_exec, p, 'funding_approval', null, null, v_claim2);
  assert r like '22023:This funding claim is with the funder%', 'a submitted claim, the approval: ' || r;
  r := test.register_as(v_exec, p, 'other', null, null, v_claim2);
  assert r like '22023:This funding claim is with the funder%', 'a submitted claim, "other": ' || r;
  r := test.register_as(v_exec, p, 'receipt', null, null, v_claim2);
  assert r like '22023:This funding claim is with the funder%', 'a submitted claim, a receipt: ' || r;
  -- The expense of that claim is frozen too.
  r := test.register_as(v_exec, p, 'receipt', (select expense_id from public.funding_claim_expenses where claim_id = v_claim2));
  assert r = '22023:This expense is on a funding claim that has been submitted, so its documents are locked', 'an executive, the club purchase of a submitted claim: ' || r;
  -- What is made after submission is accepted, then the claim is decided.
  assert test.register_as(v_exec, p, 'heellife_submission', null, null, v_claim2) = 'ok', 'the HeelLife submission is added after submitting';
  perform test.login(v_exec);
  perform public.set_funding_claim_status(v_claim2, 'approved', 40);
  perform test.logout();
  assert test.register_as(v_exec, test.mkobj(v_exec, 'proof.pdf'), 'proof_of_payment', null, null, v_claim2) = 'ok', 'proof of payment on an approved claim';
  r := test.register_as(v_exec, test.mkobj(v_exec, 'late-statement.pdf'), 'bank_statement', null, null, v_claim2);
  assert r like '22023:This funding claim is with the funder%', 'an approved claim, a statement: ' || r;
  perform test.login(v_exec);
  perform public.void_funding_claim(v_claim2, 'Started again');
  perform test.logout();
  r := test.register_as(v_exec, test.mkobj(v_exec, 'voided-claim.pdf'), 'heellife_submission', null, null, v_claim2);
  assert r = '22023:This funding claim has been voided, so documents can no longer be added', 'a voided claim, even the HeelLife submission: ' || r;
  -- Denied.
  perform test.login(v_exec);
  select id into v_claim3 from public.create_funding_claim('Denied claim', 'GPSG Senate', '', '', null, '', array[(select id from public.finance_expenses where description = 'Snacks')]);
  perform test.logout();
  update public.funding_claims set status = 'denied' where id = v_claim3;
  r := test.register_as(v_exec, test.mkobj(v_exec, 'denied.pdf'), 'proof_of_payment', null, null, v_claim3);
  assert r like '22023:This funding claim is with the funder%', 'a denied claim: ' || r;

  -- A member's purchase that sits on a live claim (a state the functions do not produce: a purchase goes on a claim only when
  -- approved. Set up by the table owner to show the rule holds anyway): the member is refused, an executive is not.
  perform test.login(v_exec);
  select id into v_claim3 from public.create_funding_claim('Third claim', 'GPSG Senate', '', '', null, '', array[e_dec]);
  perform test.logout();
  update public.finance_expenses set status = 'submitted' where id = e_dec;
  r := test.register_as(v_a, test.mkobj(v_a, 'on-claim.pdf'), 'receipt', e_dec);
  assert r = '22023:This request is part of a funding claim, so documents cannot be added. Ask an executive.', 'a member, a purchase that sits on a live claim: ' || r;
  assert test.register_as(v_exec, test.mkobj(v_exec, 'on-claim-exec.pdf'), 'receipt', e_dec) = 'ok', 'an executive replaces evidence of a purchase on a live claim that has not been submitted';
  update public.finance_expenses set status = 'settled' where id = e_dec;

  -- Two attempts at the same path, the second after the first went through.
  p := test.mkobj(v_a, 'twice.pdf');
  assert test.register_as(v_a, p, 'receipt', ea, ra) = 'ok';
  r := test.register_as(v_a, p, 'receipt', ea, ra);
  assert r = '23505:This file has already been registered as a finance document', 'the same path twice: ' || r;
  r := test.register_as(v_a, p, 'receipt', ec, rc);
  assert r = '23505:This file has already been registered as a finance document', 'the same path for another request: ' || r;
  assert (select count(*) from public.finance_documents where storage_path = p) = 1, 'one record';
  -- An executive and another member cannot take a registered path over.
  r := test.register_as(v_exec, p, 'receipt', v_club);
  assert r like '42501:The file must be stored in your own folder', 'an executive registering a member''s path: ' || r;
  r := test.register_as(v_b, p, 'receipt', eb, rb);
  assert r like '42501:The file must be stored in your own folder', 'another member registering that path: ' || r;
  -- A path in an executive's folder, by a member and by another executive.
  p2 := test.mkobj(v_exec, 'exec-only.pdf');
  r := test.register_as(v_a, p2, 'receipt', ea, ra);
  assert r like '42501:The file must be stored in your own folder', 'a member, an executive''s path: ' || r;
  r := test.register_as(v_exec2, p2, 'receipt', v_club);
  assert r like '42501:The file must be stored in your own folder', 'an executive, another executive''s path: ' || r;
  assert test.register_as(v_exec, p2, 'receipt', v_club) = 'ok', 'the executive''s own path is fine';

  -- A refused call leaves nothing behind: since the counts were taken there are six registrations (ready-claim, the HeelLife
  -- submission, the proof of payment, the executive's replacement on a live claim, twice.pdf, exec-only.pdf), with seven links
  -- between them, and the three rows the table owner inserted to give claim 2 its paper (one expense link, two claim links).
  assert (select count(*) from public.finance_documents) = n_docs + 6 + 3, 'refusals wrote no document rows: ' || ((select count(*) from public.finance_documents) - n_docs);
  assert (select (select count(*) from public.finance_expense_documents) + (select count(*) from public.finance_reimbursement_documents)
                 + (select count(*) from public.finance_claim_documents)) = n_links + 7 + 3, 'refusals wrote no link rows';
  assert (select count(*) from public.finance_audit_log where entity_type = 'finance_documents') = n_audit + 6, 'one audit row per registration, none per refusal';
  assert not exists (select 1 from public.finance_documents d where not exists (select 1 from public.finance_expense_documents x where x.document_id = d.id)
                       and not exists (select 1 from public.finance_reimbursement_documents x where x.document_id = d.id)
                       and not exists (select 1 from public.finance_claim_documents x where x.document_id = d.id)
                       and d.storage_path like '%/%' and d.storage_path !~ '^x'), 'no registered document is without a link';

  -- Every sentence above can be read by a person (none would be replaced by friendlyError's fallback).
  assert (select count(*) from t81_msgs) > 40, 'the refusals were collected: ' || (select count(*) from t81_msgs);
  assert not exists (select 1 from t81_msgs where test.raw_looking(msg)),
    'raw database wording reached the caller: ' || coalesce((select string_agg(msg, ' | ') from t81_msgs where test.raw_looking(msg)), '');

  -- ---------------------------------------------------------------------
  -- Deactivated, signed out, anonymous.
  -- ---------------------------------------------------------------------
  p := test.mkobj(v_dead, 'dead.pdf');
  perform test.login(v_dead);
  select expense_id, reimbursement_id into e_old, r_old from public.submit_member_reimbursement('Dead one', 'Shop', 5, date '2026-11-04', 'Supplies', '3333');
  perform test.logout();
  update public.profiles set status = 'deactivated' where id = v_dead;
  set local session_replication_role = replica;   -- the statement triggers off: only the function itself can stop the caller
  r := test.register_as(v_dead, p, 'receipt', e_old, r_old);
  assert r = '42501:Your access to the portal has been deactivated', 'a deactivated member: ' || r;
  set local session_replication_role = origin;
  r := test.register_as(v_dead, p, 'receipt', e_old, r_old);
  assert r like '42501:%deactivated%', 'a deactivated member, triggers on: ' || r;
  update public.profiles set status = 'active' where id = v_dead;
  -- A deactivated executive.
  update public.profiles set status = 'deactivated' where id = v_exec2;
  set local session_replication_role = replica;
  r := test.register_as(v_exec2, test.mkobj(v_exec2, 'dead-exec.pdf'), 'receipt', v_club);
  assert r = '42501:Your access to the portal has been deactivated', 'a deactivated executive: ' || r;
  set local session_replication_role = origin;
  update public.profiles set status = 'active' where id = v_exec2;
  -- Signed in as a role but with no user, and anonymous.
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role authenticated';
  begin
    perform public.register_finance_document('x/y.pdf', 'receipt', 'Doc', 'application/pdf', 10, null, ea);
    assert false, 'a token with no user must be refused';
  exception when others then
    assert sqlerrm = 'authentication required' and sqlstate = '42501', 'no user: ' || sqlerrm;
  end;
  perform test.logout();
  assert test.state_of(null, format('select public.register_finance_document(%L, ''receipt'', ''Doc'', ''application/pdf'', 10, null, %s)', p, ea)) = '42501', 'anonymous cannot call it';
  assert not has_function_privilege('anon', 'public.register_finance_document(text, text, text, text, bigint, text, bigint, bigint, bigint)', 'execute'), 'anon has no execute';
  assert has_function_privilege('authenticated', 'public.register_finance_document(text, text, text, text, bigint, text, bigint, bigint, bigint)', 'execute');

  -- ---------------------------------------------------------------------
  -- The direct writes are closed: every way the old frontend wrote, for a member and for an executive.
  -- ---------------------------------------------------------------------
  p := test.mkobj(v_a, 'direct.pdf');
  assert test.state_of(v_a, format('insert into public.finance_documents (document_type, title, storage_path, mime_type, file_size_bytes, uploaded_by) values (''receipt'', ''x'', %L, ''application/pdf'', 10, %L)', p, v_a)) = '42501', 'member: direct document insert, own folder';
  assert test.state_of(v_a, format('insert into public.finance_documents (document_type, title, storage_path, mime_type, file_size_bytes, uploaded_by) values (''receipt'', ''x'', %L, ''application/pdf'', 10, %L)', v_b::text || '/squat.pdf', v_a)) = '42501', 'member: direct insert squatting a path in another folder';
  assert test.state_of(v_exec, format('insert into public.finance_documents (document_type, title, storage_path, mime_type, file_size_bytes, uploaded_by) values (''receipt'', ''x'', ''made/up.pdf'', ''application/pdf'', 10, %L)', v_a)) = '42501', 'executive: direct insert in somebody else''s name with a made-up path';
  select id into v_doc from public.finance_documents where uploaded_by = v_a limit 1;
  assert test.state_of(v_a, format('insert into public.finance_expense_documents (expense_id, document_id) values (%s, %s)', ea, v_doc)) = '42501', 'member: direct expense link';
  assert test.state_of(v_a, format('insert into public.finance_reimbursement_documents (reimbursement_id, document_id) values (%s, %s)', ec, v_doc)) = '42501', 'member: direct request link';
  assert test.state_of(v_exec, format('insert into public.finance_claim_documents (claim_id, document_id) values (%s, %s)', v_claim, v_doc)) = '42501', 'executive: direct claim link';
  assert test.state_of(v_exec, format('insert into public.finance_expense_documents (expense_id, document_id) values (%s, %s)', eb, v_doc)) = '42501', 'executive: direct expense link to another member''s purchase';
  assert test.state_of(v_exec, format('insert into public.finance_reimbursement_documents (reimbursement_id, document_id) values (%s, %s)', r_dec, v_doc)) = '42501', 'executive: direct request link to a paid request';
  assert test.state_of(v_admin, format('insert into public.finance_claim_documents (claim_id, document_id) values (%s, %s)', v_claim, v_doc)) = '42501', 'an admin: direct claim link';
  assert test.state_of(null, 'insert into public.finance_documents default values') = '42501', 'anonymous: direct insert';

  -- ---------------------------------------------------------------------
  -- (6) Nothing else changes a registered document.
  -- ---------------------------------------------------------------------
  assert test.state_of(v_a, format('update public.finance_documents set title = ''renamed'' where id = %s', v_doc)) = '42501', 'member: update a document';
  assert test.state_of(v_exec, format('update public.finance_documents set uploaded_by = %L, storage_path = ''x/y'' where id = %s', v_b, v_doc)) = '42501', 'executive: change the uploader or the path';
  assert test.state_of(v_a, format('delete from public.finance_documents where id = %s', v_doc)) = '42501', 'member: delete a document';
  assert test.state_of(v_exec, format('delete from public.finance_documents where id = %s', v_doc)) = '42501', 'executive: delete a document';
  assert test.state_of(v_exec, 'truncate public.finance_documents') = '42501', 'executive: truncate';
  assert test.state_of(v_exec, 'delete from public.finance_expense_documents') = '42501', 'executive: unlink expense documents';
  assert test.state_of(v_exec, 'delete from public.finance_reimbursement_documents') = '42501', 'executive: unlink request documents';
  assert test.state_of(v_exec, 'delete from public.finance_claim_documents') = '42501', 'executive: unlink claim documents';
  assert test.state_of(v_exec, 'update public.finance_claim_documents set claim_id = claim_id') = '42501', 'executive: move a claim link';
  assert (select count(*) from pg_policies where schemaname = 'public' and tablename in ('finance_documents', 'finance_expense_documents', 'finance_reimbursement_documents', 'finance_claim_documents')
          and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL') and permissive = 'PERMISSIVE') = 0, 'no permissive write policy is left on the four tables';
  assert (select count(distinct tablename) from pg_policies where schemaname = 'public' and cmd = 'SELECT'
          and tablename in ('finance_documents', 'finance_expense_documents', 'finance_reimbursement_documents', 'finance_claim_documents')) = 4, 'every one of the four tables can still be read by a policy';
  -- Only two functions write these tables: the registration and the removal.
  assert (select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('public', 'private') and p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+public\.finance_documents\M')
         = array['register_finance_document', 'remove_finance_document'], 'only register_finance_document and remove_finance_document write finance_documents';
  assert (select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('public', 'private') and p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+public\.finance_(expense|reimbursement|claim)_documents\M')
         = array['register_finance_document'], 'only the registration writes the link tables (the removal lets the cascade unlink)';
  -- The bytes behind a registered path cannot be overwritten or removed through Storage either.
  p := (select storage_path from public.finance_documents where id = v_doc);
  assert test.count_as(v_a, format('with u as (update storage.objects set name = name where bucket_id = ''finance-private'' and name = %L returning 1) select count(*) from u', p)) = 0, 'member: overwrite a registered object (no update policy)';
  assert test.count_as(v_exec, format('with u as (update storage.objects set name = name where bucket_id = ''finance-private'' and name = %L returning 1) select count(*) from u', p)) = 0, 'executive: overwrite a registered object';
  assert test.count_as(v_a, format('with d as (delete from storage.objects where bucket_id = ''finance-private'' and name = %L returning 1) select count(*) from d', p)) = 0, 'member: delete a registered object';
  assert test.count_as(v_exec, format('with d as (delete from storage.objects where bucket_id = ''finance-private'' and name = %L returning 1) select count(*) from d', p)) = 0, 'executive: delete a registered object';
  -- remove_finance_document is the way, and it is still audited.
  perform test.login(v_exec2);
  v_doc2 := (select id from public.finance_documents where storage_path like v_exec2::text || '/for-a.pdf');
  assert public.remove_finance_document(v_doc2) is not null, 'the removal still works';
  perform test.logout();
  assert not exists (select 1 from public.finance_documents where id = v_doc2), 'the record is gone';
  assert exists (select 1 from public.finance_audit_log where entity_type = 'finance_documents' and entity_id = v_doc2 and action = 'delete' and actor_id = v_exec2), 'and the removal is audited';
end $$;

-- ===========================================================================
-- P2-01: a decline is not an approval.
-- ===========================================================================
do $$
declare
  v_exec uuid := test.make_user('Exec Reject', 'executive');
  v_exec2 uuid := test.make_user('Exec Reject B', 'executive');
  v_m uuid := test.make_user('Member Reject');
  e1 bigint; r1 bigint; e2 bigint; r2 bigint; e3 bigint;
  x public.finance_expenses;
  a public.finance_audit_log;
begin
  perform test.login(v_m);
  select expense_id, reimbursement_id into e1, r1 from public.submit_member_reimbursement('Approve me', 'Shop', 30, date '2026-11-04', 'Supplies', '1111');
  select expense_id, reimbursement_id into e2, r2 from public.submit_member_reimbursement('Decline me', 'Shop', 20, date '2026-11-04', 'Supplies', '1111');
  perform test.logout();
  perform test.login(v_exec);
  perform public.review_personal_reimbursement(r1, 'approved', 25, 'fine');
  perform public.review_personal_reimbursement(r2, 'rejected', null, 'Not a club purchase');
  perform test.logout();
  select * into x from public.finance_expenses where id = e1;
  assert x.status = 'approved' and x.approved_by = v_exec and x.approved_at is not null and x.rejected_by is null and x.rejected_at is null, 'an approval fills the approved pair only';
  select * into x from public.finance_expenses where id = e2;
  assert x.status = 'rejected' and x.rejected_by = v_exec and x.rejected_at is not null and x.approved_by is null and x.approved_at is null, 'a decline fills the rejected pair and leaves the approved pair empty';
  assert (select reviewed_by from public.personal_reimbursements where id = r2) = v_exec and (select reviewed_at from public.personal_reimbursements where id = r2) is not null, 'the reviewer is still on the request';
  select * into a from public.finance_audit_log where entity_type = 'personal_reimbursements' and entity_id = r2 and action = 'rejected';
  assert a.actor_id = v_exec and a.after_data ->> 'status' = 'rejected' and a.after_data ->> 'review_note' = 'Not a club purchase' and a.before_data ->> 'status' = 'submitted', 'the history says "rejected", by whom, with the note';
  select * into a from public.finance_audit_log where entity_type = 'personal_reimbursements' and entity_id = r1 and action = 'approved';
  assert a.actor_id = v_exec and (a.after_data ->> 'approved_amount')::numeric = 25, 'and "approved" with the amount';
  assert not exists (select 1 from public.finance_audit_log where entity_type = 'personal_reimbursements' and entity_id = r2 and action = 'approved'), 'a decline is never logged as an approval';
  assert (select count(*) from public.finance_audit_log where entity_type = 'finance_expenses' and entity_id = e2 and action = 'update') >= 1, 'the generic row of the trigger is still written';

  -- A decline that happened before this migration carried approved_*; running the migration again moves it (below).
  insert into public.finance_expenses (description, amount, purchase_date, category, paid_by, paid_by_member_id, status, created_by, approved_by, approved_at)
  values ('Old decline', 5, date '2026-10-01', 'Supplies', 'member', v_m, 'rejected', v_m, v_exec2, timestamptz '2026-10-02 12:00+00') returning id into e3;
  insert into public.finance_expenses (description, amount, purchase_date, category, paid_by, paid_by_member_id, status, created_by, approved_by, approved_at)
  values ('Old approval', 5, date '2026-10-01', 'Supplies', 'member', v_m, 'approved', v_m, v_exec2, timestamptz '2026-10-02 12:00+00');
  create temp table t81_ids as select v_exec2 as exec2, v_exec as exec, e2 as declined_id, e3 as old_decline_id;
end $$;

\ir ../migrations/20261128020100_finance_rejection_audit.sql

do $$
declare
  t record;
  x public.finance_expenses;
begin
  select * into t from t81_ids;
  select * into x from public.finance_expenses where id = t.old_decline_id;
  assert x.approved_by is null and x.approved_at is null and x.rejected_by = t.exec2 and x.rejected_at = timestamptz '2026-10-02 12:00+00', 'an old decline is corrected';
  assert (select approved_by from public.finance_expenses where description = 'Old approval') = t.exec2, 'an old approval is left alone';
  assert (select approved_at from public.finance_expenses where description = 'Old approval') = timestamptz '2026-10-02 12:00+00' and (select rejected_by from public.finance_expenses where description = 'Old approval') is null, 'with its date, and no rejected_by';
  select * into x from public.finance_expenses where id = t.declined_id;
  assert x.rejected_by = t.exec and x.approved_by is null, 'a decline that was already right is unchanged by running it again';
  assert (select count(*) from public.finance_audit_log where entity_type = 'finance_expenses' and entity_id = t.old_decline_id and action = 'update') >= 1, 'the correction is recorded by the audit trigger';
end $$;

-- ===========================================================================
-- P1-03 and P1-04: event and card evidence.
-- ===========================================================================
do $$
declare
  v_exec uuid := test.make_user('Exec Evidence', 'executive');
  v_m uuid := test.make_user('Member Evidence');
  message text;
  e1 bigint; r1 bigint; e2 bigint; v_club bigint; v_legacy bigint; v_nocard bigint; v_claim bigint;
begin
  -- Entry: an event purchase needs its four fields (each one missing in turn), everywhere an expense is written.
  message := test.error_as(v_m, 'select * from public.submit_member_reimbursement(''Pizza'', ''Shop'', 20, date ''2026-11-04'', ''Food'', ''1111'', '''', null, null, true)');
  assert message = 'An event purchase needs the event name, date and time, number of attendees and schedule', 'member request, no event details: ' || coalesce(message, 'no error');
  assert not test.raw_looking(message), 'readable';
  message := test.error_as(v_m, 'select * from public.submit_member_reimbursement(''Pizza'', ''Shop'', 20, date ''2026-11-04'', ''Food'', ''1111'', '''', null, null, true, ''Fall rehearsal'', now(), 12, '''')');
  assert message like 'An event purchase needs%', 'member request, no schedule: ' || coalesce(message, 'no error');
  message := test.error_as(v_m, 'select * from public.submit_member_reimbursement(''Pizza'', ''Shop'', 20, date ''2026-11-04'', ''Food'', ''1111'', '''', null, null, true, ''Fall rehearsal'', now(), null, ''Dinner'')');
  assert message like 'An event purchase needs%', 'member request, no attendee count: ' || coalesce(message, 'no error');
  message := test.error_as(v_m, 'select * from public.submit_member_reimbursement(''Pizza'', ''Shop'', 20, date ''2026-11-04'', ''Food'', ''1111'', '''', null, null, true, ''Fall rehearsal'', null, 12, ''Dinner'')');
  assert message like 'An event purchase needs%', 'member request, no date: ' || coalesce(message, 'no error');
  message := test.error_as(v_m, 'select * from public.submit_member_reimbursement(''Pizza'', ''Shop'', 20, date ''2026-11-04'', ''Food'', ''1111'', '''', null, null, true, ''   '', now(), 12, ''Dinner'')');
  assert message like 'An event purchase needs%', 'member request, a blank name: ' || coalesce(message, 'no error');
  message := test.error_as(v_m, 'select * from public.submit_member_reimbursement(''Pizza'', ''Shop'', 20, date ''2026-11-04'', ''Food'', ''1111'', '''', null, null, true, ''Fall rehearsal'', now(), 12, ''Dinner at 6'')');
  assert message is null, 'member request with every field: ' || coalesce(message, '');
  assert (select count(*) from public.finance_expenses where description = 'Pizza') = 1, 'only the complete one was written';
  -- Not an event purchase: no event fields are needed, and they are kept as given.
  message := test.error_as(v_m, 'select * from public.submit_member_reimbursement(''Strings'', ''Shop'', 20, date ''2026-11-04'', ''Supplies'', ''1111'')');
  assert message is null, 'a plain request: ' || coalesce(message, '');
  perform test.login(v_m);
  select expense_id, reimbursement_id into e1, r1 from public.submit_member_reimbursement('Strings two', 'Shop', 20, date '2026-11-04', 'Supplies', '1111');
  perform test.logout();
  message := test.error_as(v_m, format('select public.update_member_reimbursement(%s, ''Strings two'', ''Shop'', 20, date ''2026-11-04'', ''Supplies'', ''1111'', '''', null, null, true)', r1));
  assert message like 'An event purchase needs%', 'editing a request into an event purchase with no details: ' || coalesce(message, 'no error');
  assert (select event_related from public.finance_expenses where id = e1) = false, 'nothing changed';
  message := test.error_as(v_m, format('select public.update_member_reimbursement(%s, ''Strings two'', ''Shop'', 20, date ''2026-11-04'', ''Supplies'', ''1111'', '''', null, null, true, ''Fall rehearsal'', now(), 12, ''Dinner'')', r1));
  assert message is null, 'and with the details: ' || coalesce(message, '');
  message := test.error_as(v_exec, 'select public.record_club_expense(''Pizza club'', ''Shop'', 30, date ''2026-11-04'', ''Food'', ''Club bank account'', ''4242'', null, null, true)');
  assert message like 'An event purchase needs%', 'club purchase, no details: ' || coalesce(message, 'no error');
  assert not exists (select 1 from public.finance_expenses where description = 'Pizza club') and not exists (select 1 from public.finance_payments where description = 'Pizza club'), 'no expense and no payment were written';
  message := test.error_as(v_exec, 'select public.record_club_expense(''Pizza club'', ''Shop'', 30, date ''2026-11-04'', ''Food'', ''Club bank account'', ''4242'', null, null, true, ''Fall rehearsal'', now(), 12, ''Dinner'')');
  assert message is null, 'club purchase with details: ' || coalesce(message, '');
  perform test.login(v_exec);
  v_club := public.record_club_expense('Tabla', 'Shop', 100, date '2026-11-04', 'Instruments', 'Club bank account', '4242');
  perform test.logout();
  message := test.error_as(v_exec, format('select public.update_finance_expense(%s, ''Tabla'', ''Shop'', ''Instruments'', ''4242'', null, null, true)', v_club));
  assert message like 'An event purchase needs%', 'an executive edit into an event purchase with no details: ' || coalesce(message, 'no error');
  message := test.error_as(v_exec, format('select public.update_finance_expense(%s, ''Tabla'', ''Shop'', ''Instruments'', ''4242'', null, null, false)', v_club));
  assert message is null, 'and back to a plain purchase: ' || coalesce(message, '');

  -- Readiness: the same evidence is checked again before a claim can be ready or submitted.
  -- Rows as an old direct write could have left them: an event purchase with nothing behind it, and one without card digits.
  insert into public.finance_expenses (description, amount, purchase_date, category, paid_by, status, created_by, event_related, payment_card_last4)
  values ('Legacy event', 50, date '2026-10-01', 'Food', 'club', 'settled', v_exec, true, '4242') returning id into v_legacy;
  insert into public.finance_expenses (description, amount, purchase_date, category, paid_by, status, created_by)
  values ('Cash purchase', 60, date '2026-10-01', 'Food', 'club', 'settled', v_exec) returning id into v_nocard;
  perform test.login(v_exec);
  select id into v_claim from public.create_funding_claim('Evidence claim', 'GPSG Senate', '', '', null, '', array[v_legacy, v_nocard]);
  perform test.logout();
  insert into public.finance_documents (document_type, title, storage_path, mime_type, file_size_bytes, uploaded_by) values
    ('receipt', 'R1', 'x81e/r1.pdf', 'application/pdf', 10, v_exec), ('receipt', 'R2', 'x81e/r2.pdf', 'application/pdf', 10, v_exec),
    ('bank_statement', 'S', 'x81e/s.pdf', 'application/pdf', 10, v_exec), ('funding_approval', 'A', 'x81e/a.pdf', 'application/pdf', 10, v_exec);
  insert into public.finance_expense_documents (expense_id, document_id)
    select v_legacy, id from public.finance_documents where storage_path = 'x81e/r1.pdf'
    union all select v_nocard, id from public.finance_documents where storage_path = 'x81e/r2.pdf';
  insert into public.finance_claim_documents (claim_id, document_id) select v_claim, id from public.finance_documents where storage_path in ('x81e/s.pdf', 'x81e/a.pdf');
  message := test.error_as(v_exec, format('select public.set_funding_claim_status(%s, ''ready'')', v_claim));
  assert message like 'This claim still needs:%card last four on every expense%', 'no card digits holds the claim back (P1-04): ' || coalesce(message, 'no error');
  assert message like '%event flyer or agenda and event details%', 'an event purchase with nothing behind it holds the claim back (P1-03): ' || coalesce(message, 'no error');
  assert (select status from public.funding_claims where id = v_claim) = 'incomplete', 'the claim stays incomplete';
  -- Give the cash purchase its digits and the event its details and flyer: now it can go.
  update public.finance_expenses set payment_card_last4 = '4242' where id = v_nocard;
  update public.finance_expenses set event_name = 'Fall rehearsal', event_starts_at = now(), event_attendee_count = 12, event_schedule = 'Dinner' where id = v_legacy;
  message := test.error_as(v_exec, format('select public.set_funding_claim_status(%s, ''ready'')', v_claim));
  assert message like 'This claim still needs:%event flyer or agenda and event details%' and message not like '%card last four%', 'only the flyer is left: ' || coalesce(message, 'no error');
  insert into public.finance_documents (document_type, title, storage_path, mime_type, file_size_bytes, uploaded_by) values ('event_support', 'Flyer', 'x81e/f.pdf', 'application/pdf', 10, v_exec);
  insert into public.finance_claim_documents (claim_id, document_id) select v_claim, id from public.finance_documents where storage_path = 'x81e/f.pdf';
  message := test.error_as(v_exec, format('select public.set_funding_claim_status(%s, ''ready'')', v_claim));
  assert message is null, 'complete: ' || coalesce(message, '');
  -- Submitting checks again.
  update public.finance_expenses set payment_card_last4 = null where id = v_nocard;
  message := test.error_as(v_exec, format('select public.set_funding_claim_status(%s, ''submitted'')', v_claim));
  assert message like 'This claim still needs:%card last four on every expense%', 'submitting checks again: ' || coalesce(message, 'no error');
end $$;

-- ===========================================================================
-- Decision D4: nobody pays their own reimbursement.
-- ===========================================================================
do $$
declare
  v_exec uuid := test.make_user('Exec Payer', 'executive');
  v_exec2 uuid := test.make_user('Exec Payer B', 'executive');
  v_admin uuid := test.make_user('Admin Payer', 'admin');
  v_admin2 uuid := test.make_user('Admin Payer B', 'admin');
  v_m uuid := test.make_user('Member Payer');
  message text;
  e1 bigint; r1 bigint; e2 bigint; r2 bigint; e3 bigint; r3 bigint;
begin
  perform test.login(v_exec);
  select expense_id, reimbursement_id into e1, r1 from public.submit_member_reimbursement('Own purchase', 'Shop', 40, date '2026-11-04', 'Supplies', '1111');
  perform test.logout();
  perform test.login(v_admin);
  select expense_id, reimbursement_id into e3, r3 from public.submit_member_reimbursement('Admin purchase', 'Shop', 15, date '2026-11-04', 'Supplies', '1111');
  perform test.logout();
  perform test.login(v_m);
  select expense_id, reimbursement_id into e2, r2 from public.submit_member_reimbursement('Member purchase', 'Shop', 20, date '2026-11-04', 'Supplies', '1111');
  perform test.logout();
  -- Another executive approves them (self-review stays blocked).
  message := test.error_as(v_exec, format('select public.review_personal_reimbursement(%s, ''approved'')', r1));
  assert message like 'You cannot review your own reimbursement%', 'self-review is still refused: ' || coalesce(message, 'no error');
  perform test.login(v_exec2);
  perform public.review_personal_reimbursement(r1, 'approved', 40, 'ok');
  perform public.review_personal_reimbursement(r2, 'approved', 20, 'ok');
  perform public.review_personal_reimbursement(r3, 'approved', 15, 'ok');
  perform test.logout();
  -- Self-payment.
  message := test.error_as(v_exec, format('select public.pay_personal_reimbursement(%s, date ''2026-11-10'')', r1));
  assert message = 'You cannot pay your own reimbursement. Ask another executive.', 'an executive paying their own request: ' || coalesce(message, 'no error');
  assert not test.raw_looking(message), 'readable';
  message := test.error_as(v_admin, format('select public.pay_personal_reimbursement(%s, date ''2026-11-10'')', r3));
  assert message = 'You cannot pay your own reimbursement. Ask another executive.', 'an admin paying their own request: ' || coalesce(message, 'no error');
  assert (select status from public.personal_reimbursements where id = r1) = 'approved' and not exists (select 1 from public.finance_payments where reimbursement_id in (r1, r3)), 'nothing was paid';
  assert (select status from public.finance_expenses where id = e1) = 'approved', 'the purchase stays approved';
  -- Others can pay it, and the executive can pay other people's.
  message := test.error_as(v_exec2, format('select public.pay_personal_reimbursement(%s, date ''2026-11-10'')', r1));
  assert message is null, 'another executive pays: ' || coalesce(message, '');
  message := test.error_as(v_admin2, format('select public.pay_personal_reimbursement(%s, date ''2026-11-10'')', r3));
  assert message is null, 'another admin pays the admin''s request: ' || coalesce(message, '');
  message := test.error_as(v_exec, format('select public.pay_personal_reimbursement(%s, date ''2026-11-10'')', r2));
  assert message is null, 'an executive pays a member''s request: ' || coalesce(message, '');
  -- A member cannot, and nothing about a missing or already paid request changed.
  message := test.error_as(v_m, format('select public.pay_personal_reimbursement(%s, date ''2026-11-10'')', r1));
  assert message like 'executive permission required%', 'a member: ' || coalesce(message, 'no error');
  message := test.error_as(v_exec2, format('select public.pay_personal_reimbursement(%s, date ''2026-11-10'')', r1));
  assert message like 'approved reimbursement not found%', 'paid twice: ' || coalesce(message, 'no error');
  message := test.error_as(v_exec, 'select public.pay_personal_reimbursement(987654, date ''2026-11-10'')');
  assert message like 'approved reimbursement not found%', 'a request that does not exist: ' || coalesce(message, 'no error');
  -- Voiding a payment reopens the request, and the requester still cannot pay it again.
  perform test.login(v_exec2);
  perform public.void_finance_payment((select id from public.finance_payments where reimbursement_id = r1 and status = 'posted'), 'Wrong account');
  perform test.logout();
  message := test.error_as(v_exec, format('select public.pay_personal_reimbursement(%s, date ''2026-11-11'')', r1));
  assert message like 'You cannot pay your own reimbursement%', 'after a void, still refused: ' || coalesce(message, 'no error');
end $$;

rollback;
