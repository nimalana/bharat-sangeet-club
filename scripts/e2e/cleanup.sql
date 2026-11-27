-- Removes every row the e2e suite created on the TEST project, in foreign-key order, in one transaction.
-- It keeps the e2e accounts (so the suite can run again); cleanup-accounts.sql removes those.
--
-- Run cleanup.mjs FIRST (it deletes the storage objects through the Storage API, and some bucket policies
-- need the row to still exist), then run this file in the SQL editor of the TEST project (never production).
-- Rows are recognised by "[e2e]" in their title/name/description or by being created by an e2e account
-- (e2e-*@example.com). Nothing else is touched: the bootstrap admin and any real data stay.
do $cleanup$
declare
  ids uuid[] := array(select id from auth.users where email like 'e2e-%@example.com');
  n bigint;
begin
  -- Finance: nothing is hard-deleted by the app, so the harness's rows are removed here. The audit trigger writes a
  -- new audit row for every delete; those and the originals are removed at the end by entity id.
  create temp table c_exp on commit drop as
    select id from public.finance_expenses where description like '%[e2e]%' or created_by = any(ids) or paid_by_member_id = any(ids);
  create temp table c_reim on commit drop as
    select id from public.personal_reimbursements where member_id = any(ids) or expense_id in (select id from c_exp);
  create temp table c_claim on commit drop as
    select id from public.funding_claims where title like '%[e2e]%' or created_by = any(ids);
  create temp table c_pay on commit drop as
    select id from public.finance_payments
    where description like '%[e2e]%' or created_by = any(ids) or expense_id in (select id from c_exp)
       or reimbursement_id in (select id from c_reim) or funding_claim_id in (select id from c_claim);
  create temp table c_doc on commit drop as
    select id from public.finance_documents where title like '%[e2e]%' or uploaded_by = any(ids);

  delete from public.finance_payments where id in (select id from c_pay);
  delete from public.funding_claims where id in (select id from c_claim);        -- cascades claim expenses and claim documents
  delete from public.personal_reimbursements where id in (select id from c_reim); -- cascades reimbursement documents
  delete from public.finance_expenses where id in (select id from c_exp);        -- cascades expense documents
  delete from public.finance_documents where id in (select id from c_doc);
  delete from public.finance_audit_log
  where actor_id = any(ids)
     or (entity_type = 'finance_payments' and entity_id in (select id from c_pay))
     or (entity_type = 'funding_claims' and entity_id in (select id from c_claim))
     or (entity_type = 'personal_reimbursements' and entity_id in (select id from c_reim))
     or (entity_type = 'finance_expenses' and entity_id in (select id from c_exp))
     or (entity_type = 'finance_documents' and entity_id in (select id from c_doc));

  -- Attendance
  delete from public.attendance_sessions where title like '%[e2e]%' or created_by = any(ids); -- cascades records, excuses, participants, remediations
  delete from public.attendance_remediations where member_id = any(ids);
  delete from public.attendance_eligibility where member_id = any(ids);
  delete from public.attendance_records where member_id = any(ids);
  delete from public.attendance_excuses where member_id = any(ids);
  update public.attendance_settings set updated_by = null where updated_by = any(ids);

  -- Recordings, archive, resources
  delete from public.recording_notes where uploaded_by = any(ids);
  delete from public.recordings where title like '%[e2e]%' or uploaded_by = any(ids);
  delete from public.archive_items where title like '%[e2e]%' or uploaded_by = any(ids);
  delete from public.resource_links where created_by = any(ids) or title like '%[e2e]%';
  delete from public.resource_tag_assignments where created_by = any(ids);
  delete from public.resource_tags where created_by = any(ids);
  for depth in 1..8 loop  -- children before parents (parent_id is restrict)
    delete from public.resources r
    where (r.title like '%[e2e]%' or r.created_by = any(ids))
      and not exists (select 1 from public.resources child where child.parent_id = r.id);
    get diagnostics n = row_count;
    exit when n = 0;
  end loop;
  delete from public.resource_imports where created_by = any(ids) or name like '%[e2e]%';

  -- Groups and what hangs off them
  delete from public.events where title like '%[e2e]%' or created_by = any(ids);
  delete from public.announcements where title like '%[e2e]%' or created_by = any(ids);
  delete from public.subgroup_memberships where member_id = any(ids) or subgroup_id in (select id from public.subgroups where name like '%[e2e]%');
  delete from public.subgroups where name like '%[e2e]%' or created_by = any(ids);

  -- Admin audit entries about the e2e accounts (role changes, deactivation, deletion)
  delete from public.admin_audit_log where actor_email like 'e2e-%@example.com' or target_email like 'e2e-%@example.com';
end
$cleanup$;
