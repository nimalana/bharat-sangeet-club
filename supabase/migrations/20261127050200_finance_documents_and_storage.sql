-- Finance fixes, part 3: removing a finance document, and the storage policies
-- that let the file follow its record (review findings finance-4 and finance-5).
--
-- finance-4. remove_finance_document looked for a decided request only through
-- finance_reimbursement_documents. A receipt linked to the expense alone (a
-- member can insert that link under RLS) belonged to no request as far as the
-- function could tell, so a member could strip the receipt of an approved or
-- paid reimbursement. The function now follows both link tables, and a member
-- may not remove any document of a purchase that is no longer waiting for
-- review or that sits on a live funding claim.
--
-- finance-5. The record goes first, then the file (deliberate: the record
-- carries the checks and the audit row). Storage then runs, as the signed-in
-- user,
--
--     delete from storage.objects
--     where bucket_id = 'finance-private' and name in (<paths>) returning *
--
-- and because that statement filters on, and returns, columns of the row,
-- PostgreSQL applies the SELECT policies as well as the DELETE policy. The only
-- SELECT policy on the bucket needs a finance_documents row, which the function
-- has just deleted, so nobody could see the object and nothing was deleted
-- (Storage then reports success with an empty result). The policies below give
-- the uploader, and executives, SELECT and DELETE on an object that no record
-- points at, and nothing else.
--
-- Whether a path is registered is answered by a definer function, not by a
-- subquery in the policy: a subquery runs under the caller's own row level
-- security, and a member cannot see a record registered by somebody else, so it
-- would call another person's registered file "unregistered".

create or replace function private.finance_path_registered(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.finance_documents where storage_path = p_path);
$$;
revoke all on function private.finance_path_registered(text) from public, anon;
grant execute on function private.finance_path_registered(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage policies for the finance-private bucket
-- ---------------------------------------------------------------------------
-- The uploader's own folder only, and only while no record points at the file.
drop policy if exists "Members read own unregistered finance files" on storage.objects;
create policy "Members read own unregistered finance files" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'finance-private'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not private.finance_path_registered(name)
  );

drop policy if exists "Members delete own unregistered finance files" on storage.objects;
create policy "Members delete own unregistered finance files" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'finance-private'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not private.finance_path_registered(name)
  );

-- Executives can see everything in the bucket (registered files are theirs to
-- read already) and delete a file once its record is gone. A file that still
-- has a record is removed through remove_finance_document, which keeps the
-- checks and the audit row.
drop policy if exists "Executives read finance files" on storage.objects;
create policy "Executives read finance files" on storage.objects
  for select to authenticated
  using (bucket_id = 'finance-private' and (select private.is_executive()));

drop policy if exists "Executives delete finance files" on storage.objects;
create policy "Executives delete finance files" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'finance-private'
    and (select private.is_executive())
    and not private.finance_path_registered(name)
  );

-- ---------------------------------------------------------------------------
-- remove_finance_document
-- Lock order (see 20261127050000): expense, reimbursement, claim, document.
-- ---------------------------------------------------------------------------
create or replace function public.remove_finance_document(p_document_id bigint)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  document public.finance_documents;
  v_actor uuid := (select auth.uid());
  v_is_executive boolean := private.is_executive();
  v_expense_ids bigint[];
  v_reimbursement_ids bigint[];
  v_claim_ids bigint[];
begin
  if v_actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not private.is_active_member() then
    raise exception 'Your access to the portal has been deactivated' using errcode = '42501';
  end if;
  select * into document from public.finance_documents where id = p_document_id;
  if not found or (document.uploaded_by <> v_actor and not v_is_executive) then
    raise exception 'Document not found' using errcode = 'P0002';
  end if;

  -- Everything the document is attached to, through either link table.
  select coalesce(array_agg(distinct linked.expense_id order by linked.expense_id), '{}') into v_expense_ids from (
    select link.expense_id from public.finance_expense_documents link where link.document_id = p_document_id
    union
    select reimbursement.expense_id
    from public.finance_reimbursement_documents link
    join public.personal_reimbursements reimbursement on reimbursement.id = link.reimbursement_id
    where link.document_id = p_document_id
  ) as linked;
  select coalesce(array_agg(distinct linked.id order by linked.id), '{}') into v_reimbursement_ids from (
    select link.reimbursement_id as id from public.finance_reimbursement_documents link where link.document_id = p_document_id
    union
    select reimbursement.id from public.personal_reimbursements reimbursement where reimbursement.expense_id = any (v_expense_ids)
  ) as linked;
  select coalesce(array_agg(distinct linked.id order by linked.id), '{}') into v_claim_ids from (
    select link.claim_id as id from public.finance_claim_documents link where link.document_id = p_document_id
    union
    select link.claim_id from public.funding_claim_expenses link where link.expense_id = any (v_expense_ids)
  ) as linked;

  perform private.lock_finance_expenses(v_expense_ids);
  perform 1 from public.personal_reimbursements where id = any (v_reimbursement_ids) order by id for update;
  perform 1 from public.funding_claims where id = any (v_claim_ids) order by id for update;
  select * into document from public.finance_documents where id = p_document_id for update;
  if not found then raise exception 'Document not found' using errcode = 'P0002'; end if;

  -- A decided request keeps its documents, whichever way they are linked.
  if exists (
    select 1 from public.personal_reimbursements reimbursement
    where reimbursement.status not in ('submitted', 'changes_requested', 'draft')
      and (reimbursement.id in (select link.reimbursement_id from public.finance_reimbursement_documents link where link.document_id = p_document_id)
           or reimbursement.expense_id in (select link.expense_id from public.finance_expense_documents link where link.document_id = p_document_id))
  ) then
    raise exception 'This document belongs to a request that has already been decided' using errcode = '22023';
  end if;
  -- Members: nothing of a purchase that is past review, or that is on a funding claim.
  if not v_is_executive and exists (
    select 1 from public.finance_expense_documents link
    join public.finance_expenses expense on expense.id = link.expense_id
    where link.document_id = p_document_id and expense.status not in ('draft', 'submitted')
  ) then
    raise exception 'This document belongs to a purchase that has already been decided, so it cannot be removed' using errcode = '22023';
  end if;
  if not v_is_executive and exists (
    select 1 from public.finance_expense_documents link
    where link.document_id = p_document_id and private.expense_on_live_claim(link.expense_id)
  ) then
    raise exception 'This document is evidence for an expense on a funding claim. Ask an executive to replace it' using errcode = '22023';
  end if;
  -- A waiting request keeps a receipt: add the replacement first.
  if document.document_type = 'receipt' and exists (
    select 1 from public.personal_reimbursements reimbursement
    where reimbursement.status = 'submitted'
      and (reimbursement.id in (select link.reimbursement_id from public.finance_reimbursement_documents link where link.document_id = p_document_id)
           or reimbursement.expense_id in (select link.expense_id from public.finance_expense_documents link where link.document_id = p_document_id))
      and not exists (
        select 1 from public.finance_documents other
        where other.id <> p_document_id and other.document_type = 'receipt'
          and (other.id in (select link.document_id from public.finance_reimbursement_documents link where link.reimbursement_id = reimbursement.id)
               or other.id in (select link.document_id from public.finance_expense_documents link where link.expense_id = reimbursement.expense_id)))
  ) then
    raise exception 'A submitted request needs a receipt. Add the replacement first, then remove this one.' using errcode = '22023';
  end if;
  -- Expenses on a claim keep a receipt.
  if document.document_type = 'receipt' and exists (
    select 1 from public.finance_expense_documents link
    where link.document_id = p_document_id and private.expense_on_live_claim(link.expense_id)
      and not exists (
        select 1 from public.finance_expense_documents other
        join public.finance_documents other_document on other_document.id = other.document_id
        where other.expense_id = link.expense_id and other.document_id <> p_document_id
          and other_document.document_type = 'receipt')
  ) then
    raise exception 'This is the only receipt for an expense on a funding claim. Add the replacement first.' using errcode = '22023';
  end if;
  -- Claim documents are frozen once the claim is submitted.
  if exists (
    select 1 from public.finance_claim_documents link
    join public.funding_claims claim on claim.id = link.claim_id
    where link.document_id = p_document_id and claim.status not in ('draft', 'incomplete', 'ready', 'changes_requested', 'voided')
  ) then
    raise exception 'This document is part of a submitted funding claim' using errcode = '22023';
  end if;

  insert into public.finance_audit_log (entity_type, entity_id, action, actor_id, before_data, after_data)
  values ('finance_documents', document.id, 'delete', v_actor, to_jsonb(document), null);
  delete from public.finance_documents where id = p_document_id;

  -- A claim that was ready may no longer be.
  perform private.reopen_claims_missing_evidence(v_claim_ids);
  return document.storage_path;
end;
$$;

revoke all on function public.remove_finance_document(bigint) from public, anon;
grant execute on function public.remove_finance_document(bigint) to authenticated;
