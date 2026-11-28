-- Phase 4.2, P0-05 and P1-05: one function registers a finance document.
--
-- ============================================================================
-- RELEASE ORDER: APPLY BEFORE THE NEW FRONTEND. This file only ADDS a function.
-- The deployed frontend keeps registering documents with direct inserts until
-- the new one is live; 20261128029000_finance_documents_revoke_direct_writes.sql
-- (apply AFTER the frontend is live) then closes those inserts.
-- ============================================================================
--
-- Until now the browser registered an upload in several separate calls: an insert
-- into finance_documents (uploaded_by chosen by the client) and one insert per link
-- table, with only row level security between a caller and the rows
-- (this was the first entry of docs/KNOWN_GAPS.md; it is removed there with this change). That allowed:
--   * a record with no file behind it, or pointing at somebody else's file
--     (and, because the storage read policy trusts a record, reading that file: P1-05);
--   * a document attached to a request, purchase or claim that was already decided,
--     paid, voided or with the funder, and one that names someone else as uploader;
--   * a record without its links, or the other way round, when a step failed;
--   * no audit row for any of it.
--
-- register_finance_document(...) does it in ONE transaction and answers with the
-- document's id. The caller is always the uploader. It checks, in this order:
--
--   1. the caller is signed in and active;
--   2. what the table's own CHECK constraints and the bucket allow, with readable
--      sentences instead of the raw constraint errors: a known document type, a
--      title of 1 to 180 characters, a size above 0 and up to 10 MB, a type the
--      finance-private bucket accepts (read from the bucket row), a statement that
--      is a PDF, four digits or nothing for the card, and at least one target;
--   3. the path starts with the caller's own user id (P1-05: nobody registers a
--      path in somebody else's folder, which Storage would not let them write to);
--   4. the target accepts evidence (below), after taking the row locks in the order
--      written in 20261127050000 (expense, reimbursement, claim);
--   5. a storage object exists at that path in finance-private and is not owned by
--      somebody else (P1-05; a missing owner is accepted, because Storage does not
--      reliably fill it in, see 20261127070100: the own-folder rule is what binds
--      the file to the caller);
--   6. the path is not registered yet (a second registration is refused, never
--      duplicated; the unique index decides a race between two sessions);
--
-- and then inserts the document row, every link row and one finance_audit_log row.
--
-- Who may attach what (every rule below is tighter than the old policies, which
-- let a member attach to their own rows in any state, and an executive attach
-- anything to anything):
--
--   A reimbursement request   its member, or an executive, while it is draft,
--                             submitted or changes_requested (not approved,
--                             rejected, paid or voided). Anyone else: "not found".
--   An expense                a member who created it or paid it, or an executive:
--                             while it is draft or submitted (a member purchase) or
--                             any live club purchase (an executive), never voided or
--                             rejected, never when it sits on a claim that has gone
--                             to the funder, and for a member never when it sits on
--                             any live claim (an executive replaces that evidence).
--   A funding claim           executives only. While it is still being assembled
--                             (draft, incomplete, ready, changes_requested) any type.
--                             After it went to the funder (submitted, approved,
--                             partially paid, paid) only the HeelLife submission and
--                             the proof of payment, which are made after that point;
--                             the packet itself is frozen, as remove_finance_document
--                             already freezes it. Denied and voided: nothing.
--   A request and its purchase together must belong to each other.
--
-- Not done here, and why: the size and type the caller states are not compared
-- with the stored object's metadata (the harness has no Storage service to prove
-- it, and a wrong comparison would refuse real uploads); the bucket's own type and
-- size limits already apply to the object.

create or replace function public.register_finance_document(
  p_storage_path text,
  p_document_type text,
  p_title text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_payment_card_last4 text default null,
  p_expense_id bigint default null,
  p_reimbursement_id bigint default null,
  p_claim_id bigint default null
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_is_executive boolean;
  v_path text := coalesce(p_storage_path, '');
  v_title text := btrim(coalesce(p_title, ''));
  v_mime text := lower(btrim(coalesce(p_mime_type, '')));
  v_allowed text[];
  v_owner_id text;
  v_expense public.finance_expenses;
  v_reimbursement public.personal_reimbursements;
  v_claim public.funding_claims;
  v_lock_expense_id bigint;
  v_claim_ids bigint[];
  v_document public.finance_documents;
begin
  -- 1. The caller.
  if v_actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not private.is_active_member() then
    raise exception 'Your access to the portal has been deactivated' using errcode = '42501';
  end if;
  v_is_executive := private.is_executive();

  -- 2. What the table and the bucket allow (same sentences the upload form uses where it has them).
  if p_document_type is null or p_document_type not in ('receipt', 'invoice', 'bank_statement', 'card_statement', 'event_support',
      'funding_approval', 'heellife_submission', 'proof_of_payment', 'other') then
    raise exception 'Choose what kind of document this is' using errcode = '22023';
  end if;
  if char_length(v_title) < 1 or char_length(v_title) > 180 then
    raise exception 'Give the document a title of 180 characters or fewer' using errcode = '22023';
  end if;
  if p_file_size_bytes is null or p_file_size_bytes <= 0 then
    raise exception 'Choose a document to upload' using errcode = '22023';
  end if;
  if p_file_size_bytes > 10485760 then
    raise exception 'Finance documents must be 10 MB or smaller' using errcode = '22023';
  end if;
  select allowed_mime_types into v_allowed from storage.buckets where id = 'finance-private';
  if v_mime = '' or (v_allowed is not null and v_mime <> all (v_allowed)) then
    raise exception 'Upload a PDF, JPEG or PNG file' using errcode = '22023';
  end if;
  if p_document_type in ('bank_statement', 'card_statement') and v_mime <> 'application/pdf' then
    raise exception 'Statements must be uploaded as PDF documents, not screenshots' using errcode = '22023';
  end if;
  if p_payment_card_last4 is not null and p_payment_card_last4 !~ '^[0-9]{4}$' then
    raise exception 'card last four must contain four digits' using errcode = '22023';
  end if;
  if p_expense_id is null and p_reimbursement_id is null and p_claim_id is null then
    raise exception 'Attach the document to a purchase, a reimbursement request or a funding claim' using errcode = '22023';
  end if;

  -- 3. The path is in the caller's own folder: <user id>/<something>.
  if char_length(v_path) <= 37 or char_length(v_path) > 1024 or left(v_path, 37) <> v_actor::text || '/' then
    raise exception 'The file must be stored in your own folder' using errcode = '42501';
  end if;

  -- 4. The targets, locked in the order of 20261127050000: expense, reimbursement, claim.
  -- The request is read first without a lock, only to learn which purchase it belongs to.
  if p_reimbursement_id is not null then
    select * into v_reimbursement from public.personal_reimbursements where id = p_reimbursement_id;
    if not found or (v_reimbursement.member_id <> v_actor and not v_is_executive) then
      raise exception 'Reimbursement request not found' using errcode = 'P0002';
    end if;
    if p_expense_id is not null and p_expense_id <> v_reimbursement.expense_id then
      raise exception 'That request belongs to a different purchase' using errcode = '22023';
    end if;
  end if;
  v_lock_expense_id := coalesce(p_expense_id, v_reimbursement.expense_id);
  if v_lock_expense_id is not null then
    perform private.lock_finance_expenses(array[v_lock_expense_id]);
  end if;
  if p_reimbursement_id is not null then
    select * into v_reimbursement from public.personal_reimbursements where id = p_reimbursement_id for update;
    if not found then raise exception 'Reimbursement request not found' using errcode = 'P0002'; end if;
  end if;
  -- A claim moves only under its own lock, so lock every claim this evidence could touch.
  select coalesce(array_agg(distinct linked.id order by linked.id), '{}') into v_claim_ids from (
    select p_claim_id as id where p_claim_id is not null
    union
    select link.claim_id from public.funding_claim_expenses link where link.expense_id = v_lock_expense_id
  ) as linked;
  perform 1 from public.funding_claims where id = any (v_claim_ids) order by id for update;

  -- ...and everything below reads the rows again, after the locks (each statement sees what the others committed).
  if p_reimbursement_id is not null then
    select * into v_reimbursement from public.personal_reimbursements where id = p_reimbursement_id;
    if v_reimbursement.status not in ('draft', 'submitted', 'changes_requested') then
      raise exception 'This request has already been decided, so documents can no longer be added' using errcode = '22023';
    end if;
  end if;

  if v_lock_expense_id is not null then
    select * into v_expense from public.finance_expenses where id = v_lock_expense_id;
    if not found
       or (not v_is_executive and v_expense.created_by is distinct from v_actor and v_expense.paid_by_member_id is distinct from v_actor) then
      raise exception 'Expense not found' using errcode = 'P0002';
    end if;
    if v_expense.status = 'voided' then
      raise exception 'This purchase has been voided, so documents can no longer be added' using errcode = '22023';
    end if;
    -- A member's purchase is open to evidence until it is decided; an executive adds to a live club purchase.
    if v_expense.status = 'rejected'
       or ((v_expense.paid_by = 'member' or not v_is_executive) and v_expense.status not in ('draft', 'submitted')) then
      raise exception 'This purchase has already been decided, so documents can no longer be added' using errcode = '22023';
    end if;
    if private.expense_on_frozen_claim(v_expense.id) then
      raise exception 'This expense is on a funding claim that has been submitted, so its documents are locked' using errcode = '22023';
    end if;
    if not v_is_executive and private.expense_on_live_claim(v_expense.id) then
      raise exception 'This request is part of a funding claim, so documents cannot be added. Ask an executive.' using errcode = '22023';
    end if;
  end if;

  if p_claim_id is not null then
    if not v_is_executive then raise exception 'executive permission required' using errcode = '42501'; end if;
    select * into v_claim from public.funding_claims where id = p_claim_id;
    if not found then raise exception 'funding claim not found' using errcode = 'P0002'; end if;
    if v_claim.status = 'voided' then
      raise exception 'This funding claim has been voided, so documents can no longer be added' using errcode = '22023';
    end if;
    if v_claim.status not in ('draft', 'incomplete', 'ready', 'changes_requested')
       and not (v_claim.status in ('submitted', 'approved', 'partially_paid', 'paid')
                and p_document_type in ('heellife_submission', 'proof_of_payment')) then
      raise exception 'This funding claim is with the funder, so its documents are locked. Only the HeelLife submission and proof of payment can be added now.' using errcode = '22023';
    end if;
  end if;

  -- 5. A file really is stored at that path, and nobody else owns it.
  select o.owner_id into v_owner_id from storage.objects o where o.bucket_id = 'finance-private' and o.name = v_path;
  if not found then
    raise exception 'The file was not found in storage. Upload it again.' using errcode = '22023';
  end if;
  if v_owner_id is not null and v_owner_id <> v_actor::text then
    raise exception 'That file was uploaded by someone else' using errcode = '42501';
  end if;

  -- 6. Once. The insert waits for a session that is registering the same path and then reports the conflict.
  if exists (select 1 from public.finance_documents where storage_path = v_path) then
    raise exception 'This file has already been registered as a finance document' using errcode = '23505';
  end if;
  insert into public.finance_documents (document_type, title, storage_path, mime_type, file_size_bytes, payment_card_last4, uploaded_by)
  values (p_document_type, v_title, v_path, v_mime, p_file_size_bytes, p_payment_card_last4, v_actor)
  on conflict (storage_path) do nothing
  returning * into v_document;
  if not found then
    raise exception 'This file has already been registered as a finance document' using errcode = '23505';
  end if;

  if p_expense_id is not null then
    insert into public.finance_expense_documents (expense_id, document_id) values (p_expense_id, v_document.id);
  end if;
  if p_reimbursement_id is not null then
    insert into public.finance_reimbursement_documents (reimbursement_id, document_id) values (p_reimbursement_id, v_document.id);
  end if;
  if p_claim_id is not null then
    insert into public.finance_claim_documents (claim_id, document_id) values (p_claim_id, v_document.id);
  end if;

  insert into public.finance_audit_log (entity_type, entity_id, action, actor_id, before_data, after_data)
  values ('finance_documents', v_document.id, 'insert', v_actor, null,
    to_jsonb(v_document) || jsonb_build_object('linked_to', jsonb_strip_nulls(jsonb_build_object(
      'expense_id', p_expense_id, 'reimbursement_id', p_reimbursement_id, 'claim_id', p_claim_id))));
  return v_document.id;
end;
$$;

revoke all on function public.register_finance_document(text, text, text, text, bigint, text, bigint, bigint, bigint) from public, anon;
grant execute on function public.register_finance_document(text, text, text, text, bigint, text, bigint, bigint, bigint) to authenticated;
