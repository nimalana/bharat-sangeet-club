-- What the e2e suite has left on the TEST project (all zero after cleanup.mjs + cleanup.sql, except the accounts).
with e2e as (select id from auth.users where email like 'e2e-%@example.com')
select 'auth.users' as item, count(*) from auth.users where email like 'e2e-%@example.com'
union all select 'subgroups', count(*) from public.subgroups where name like '%[e2e]%'
union all select 'subgroup_memberships', count(*) from public.subgroup_memberships where member_id in (select id from e2e)
union all select 'events', count(*) from public.events where title like '%[e2e]%'
union all select 'announcements', count(*) from public.announcements where title like '%[e2e]%'
union all select 'recordings', count(*) from public.recordings where title like '%[e2e]%'
union all select 'recording_notes', count(*) from public.recording_notes where uploaded_by in (select id from e2e)
union all select 'resources', count(*) from public.resources where title like '%[e2e]%' or created_by in (select id from e2e)
union all select 'resource_imports', count(*) from public.resource_imports where created_by in (select id from e2e)
union all select 'archive_items', count(*) from public.archive_items where title like '%[e2e]%' or uploaded_by in (select id from e2e)
union all select 'attendance_sessions', count(*) from public.attendance_sessions where title like '%[e2e]%' or created_by in (select id from e2e)
union all select 'attendance_excuses', count(*) from public.attendance_excuses where member_id in (select id from e2e)
union all select 'finance_expenses', count(*) from public.finance_expenses where description like '%[e2e]%' or created_by in (select id from e2e)
union all select 'personal_reimbursements', count(*) from public.personal_reimbursements where member_id in (select id from e2e)
union all select 'finance_payments', count(*) from public.finance_payments where description like '%[e2e]%' or created_by in (select id from e2e)
union all select 'funding_claims', count(*) from public.funding_claims where title like '%[e2e]%' or created_by in (select id from e2e)
union all select 'finance_documents', count(*) from public.finance_documents where uploaded_by in (select id from e2e)
union all select 'finance_audit_log', count(*) from public.finance_audit_log where actor_id in (select id from e2e)
union all select 'admin_audit_log', count(*) from public.admin_audit_log where actor_email like 'e2e-%@example.com' or target_email like 'e2e-%@example.com'
union all select 'storage.objects (' || bucket_id || ')', count(*) from storage.objects where owner_id in (select id::text from e2e) group by bucket_id
order by 1;
