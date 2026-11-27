-- The measured queries: what the frontend sends (PostgREST turns each .from().select()
-- into the SQL below, with the table's row-level security added by Postgres), the
-- read functions, the helpers the policies call, and the storage lookups.
-- {uid} and {gid} are the acting member's id and first active subgroup; other
-- {names} come from perf.params (see harness.sql).
-- Actors: anon, member, leader, manager, executive, admin, deactivated.
truncate perf.queries restart identity;

insert into perf.queries (label, actors, sql) values
-- ---- Sign-in to Overview ----------------------------------------------------------------
('boot: get_portal_bootstrap()', 'member,manager,executive,admin,deactivated', $q$select public.get_portal_bootstrap()$q$),
('boot: events (1 year back + ahead)', 'member,executive', $q$select jsonb_agg(to_jsonb(e) order by e.starts_at) from public.events e where e.starts_at >= now() - interval '1 year'$q$),
('boot: announcements (12)', 'member,executive', $q$select jsonb_agg(to_jsonb(a) order by a.is_pinned desc, a.published_at desc) from (select * from public.announcements order by is_pinned desc, published_at desc limit 12) a$q$),
('boot: resource count', 'member,manager,executive', $q$select count(*) from public.resources r where r.status <> 'archived'$q$),
('boot: archive recordings (executive only)', 'executive,admin', $q$select jsonb_agg(to_jsonb(item) order by item.created_at desc) from public.archive_items item where item.type = 'recording'$q$),
('boot: my memberships + groups', 'member,manager', $q$select (select count(*) from public.subgroups g where g.archived_at is null), (select count(*) from public.subgroup_memberships m where m.member_id = {uid})$q$),

-- ---- Recordings (components/recordings/recording-workspace.tsx) ------------------------------
('rec: published page 1 (24)', 'member,manager,executive', $q$select * from public.recordings where status = 'published' order by created_at desc, id desc limit 24$q$),
('rec: published count', 'member,manager,executive', $q$select count(*) from public.recordings where status = 'published'$q$),
('rec: published, my group, page 1', 'member,manager,executive', $q$select * from public.recordings where status = 'published' and subgroup_id = {gid} order by created_at desc, id desc limit 24$q$),
('rec: published, my group, count', 'member,manager,executive', $q$select count(*) from public.recordings where status = 'published' and subgroup_id = {gid}$q$),
('rec: published, 10 pages (240)', 'member,executive', $q$select * from public.recordings where status = 'published' order by created_at desc, id desc limit 240$q$),
('rec: search "kalyani" page 1', 'member,executive', $q$select * from public.recordings where status = 'published' and (title ilike '%kalyani%' or description ilike '%kalyani%' or raga ilike '%kalyani%' or tala ilike '%kalyani%' or recording_kind ilike '%kalyani%') order by created_at desc, id desc limit 24$q$),
('rec: search "kalyani" count', 'member,executive', $q$select count(*) from public.recordings where status = 'published' and (title ilike '%kalyani%' or description ilike '%kalyani%' or raga ilike '%kalyani%' or tala ilike '%kalyani%' or recording_kind ilike '%kalyani%')$q$),
('rec: my drafts', 'member,manager,executive', $q$select * from public.recordings where status = 'draft' and uploaded_by = {uid} order by created_at desc, id desc limit 24$q$),
('rec: archived (executive: all, member: own)', 'member,executive', $q$select * from public.recordings where status = 'archived' order by created_at desc, id desc limit 24$q$),
('rec: notes of one recording', 'member,executive', $q$select * from public.recording_notes where recording_id = {rec_with_notes} order by created_at$q$),

-- ---- Resources (app/resources.tsx) --------------------------------------------------------
('res: whole tree, no limit', 'member,manager,executive', $q$select id,node_kind,media_kind,title,description,parent_id,subgroup_id,visibility,storage_bucket,storage_path,external_url,original_filename,mime_type,byte_size,checksum_sha256,event_id,occurred_on,season_label,status,is_pinned,import_id,created_by,created_at,updated_at from public.resources order by is_pinned desc, updated_at desc$q$),
('res: root folder children (100)', 'member,manager,executive', $q$select * from public.resources where parent_id is null order by is_pinned desc, updated_at desc, id desc limit 100$q$),
('res: one folder children (100)', 'member,manager,executive', $q$select * from public.resources where parent_id = 101 order by is_pinned desc, updated_at desc, id desc limit 100$q$),
('res: one subgroup folder, children', 'member,manager,executive', $q$select * from public.resources where parent_id = {gid} order by is_pinned desc, updated_at desc, id desc limit 100$q$),

-- ---- Attendance (app/attendance.tsx) --------------------------------------------------------
('att: get_attendance_workspace(all)', 'member,leader,manager,executive,admin', $q$select public.get_attendance_workspace('all', null)$q$),
('att: get_attendance_workspace(club)', 'member,executive', $q$select public.get_attendance_workspace('club', null)$q$),
('att: get_attendance_workspace(my group)', 'member,manager,executive', $q$select public.get_attendance_workspace('subgroup', {gid})$q$),
-- The three that replaced it (20261127060000): the full load, the 10 s poll and one roster.
('att: get_attendance_overview(all)', 'member,leader,manager,executive,admin', $q$select public.get_attendance_overview('all', null)$q$),
('att: get_attendance_overview(club)', 'member,executive', $q$select public.get_attendance_overview('club', null)$q$),
('att: get_attendance_overview(my group)', 'member,manager,executive', $q$select public.get_attendance_overview('subgroup', {gid})$q$),
('att: get_attendance_pulse (10 s poll)', 'member,manager,executive', $q$select public.get_attendance_pulse('all', null)$q$),
('att: get_attendance_roster (open meeting)', 'member,executive', $q$select public.get_attendance_roster((select id from public.attendance_sessions where status = 'open' limit 1))$q$),
('att: sessions visible (RLS)', 'member,manager,executive', $q$select count(*) from public.attendance_sessions$q$),
('att: records visible (RLS)', 'member,manager,executive', $q$select count(*) from public.attendance_records$q$),
('att: participants visible (RLS)', 'member,executive', $q$select count(*) from public.attendance_session_participants$q$),
('att: paged sessions (20, by starts_at)', 'member,executive', $q$select * from public.attendance_sessions order by starts_at desc, id desc limit 20$q$),

-- ---- Finance (app/finance.tsx) ------------------------------------------------------------
('fin: get_finance_summary()', 'member,executive,admin', $q$select public.get_finance_summary()$q$),
('fin: expenses (500)', 'member,executive', $q$select * from public.finance_expenses order by purchase_date desc, id desc limit 500$q$),
('fin: reimbursements (500)', 'member,executive', $q$select * from public.personal_reimbursements order by created_at desc limit 500$q$),
('fin: ledger payments (500)', 'member,executive', $q$select * from public.finance_payments order by payment_date desc, id desc limit 500$q$),
('fin: ledger count', 'member,executive', $q$select count(*) from public.finance_payments$q$),
('fin: documents (2000)', 'member,executive', $q$select id,document_type,title,storage_path,uploaded_by from public.finance_documents order by created_at desc limit 2000$q$),
('fin: expense-document links (2000)', 'member,executive', $q$select expense_id,document_id from public.finance_expense_documents limit 2000$q$),
('fin: reimbursement-document links (2000)', 'member,executive', $q$select reimbursement_id,document_id from public.finance_reimbursement_documents limit 2000$q$),
('fin: funding claims (500)', 'executive', $q$select * from public.funding_claims order by created_at desc limit 500$q$),
('fin: claim expenses (2000)', 'executive', $q$select claim_id,expense_id,claimed_amount from public.funding_claim_expenses limit 2000$q$),
('fin: claim documents (2000)', 'executive', $q$select claim_id,document_id from public.finance_claim_documents limit 2000$q$),
('fin: people picker (2000)', 'executive', $q$select id,full_name,email from public.profiles order by full_name limit 2000$q$),

-- ---- People, groups, admin (app/page.tsx, components/subgroups) -------------------------------
('people: directory, active, by name (2000)', 'member,executive', $q$select id,full_name,email,role,phone,class_year,specialty,joined_at from public.profiles where status = 'active' order by full_name limit 2000$q$),
('people: admin list incl. status (2000)', 'admin', $q$select id,full_name,email,role,status,phone,class_year,specialty,joined_at from public.profiles order by full_name limit 2000$q$),
('people: all memberships (limit 5000)', 'member,manager,executive', $q$select subgroup_id,member_id,status,membership_role from public.subgroup_memberships limit 5000$q$),
('people: admin announcements (50)', 'admin', $q$select * from public.announcements order by is_pinned desc, published_at desc limit 50$q$),
('people: admin audit log (20)', 'admin,member', $q$select id,action,actor_email,target_email,details,created_at from public.admin_audit_log order by created_at desc limit 20$q$),
('groups: subgroups by name', 'member', $q$select id,name,description,enrollment_mode,archived_at from public.subgroups order by name$q$),
('groups: archive recordings of groups (500)', 'member,manager,executive', $q$select * from public.archive_items where type = 'recording' and subgroup_id is not null order by created_at desc limit 500$q$),
('groups: group announcements (300)', 'member,manager,executive', $q$select * from public.announcements where subgroup_id is not null order by published_at desc limit 300$q$),
('groups: pending counts of others', 'member,manager', $q$select subgroup_id from public.subgroup_memberships where status in ('pending','waitlisted') and member_id <> {uid}$q$),
('groups: list_subgroup_roster(my group)', 'member,manager,executive', $q$select * from public.list_subgroup_roster({gid})$q$),
('calendar: events from a year ago', 'member,manager,executive', $q$select * from public.events where starts_at >= now() - interval '1 year' order by starts_at$q$),
('public: concert recordings (signed out)', 'anon', $q$select id,title,description,type,storage_path,event_date,raga,tala,created_at,is_public from public.archive_items where type = 'recording' and is_public order by event_date desc$q$),

-- ---- Helpers called by policies, isolated: 2,000 calls each ------------------------------------
('helper: private.is_executive() x2000', 'member,executive', $q$select count(*) from generate_series(1, 2000) g where private.is_executive() or g < 0$q$),
('helper: private.is_active_member() x2000', 'member', $q$select count(*) from generate_series(1, 2000) g where private.is_active_member() or g < 0$q$),
('helper: private.is_subgroup_manager(g) x2000', 'member,manager', $q$select count(*) from generate_series(1, 2000) g where private.is_subgroup_manager(1 + g % 12)$q$),
('helper: private.can_view_resource(...) x2000', 'member,manager,executive', $q$select count(*) from generate_series(1, 2000) g where private.can_view_resource(1 + g % 12, 'members'::public.archive_visibility, 'ready'::public.resource_status, null)$q$),
('helper: private.can_manage_resource(...) x2000', 'member,manager,executive', $q$select count(*) from generate_series(1, 2000) g where private.can_manage_resource(1 + g % 12, 'members'::public.archive_visibility)$q$),

-- ---- Storage policy predicates (one object, like a signed URL request; and bulk) -------------------
('storage: recording file, 1 object', 'member,executive', $q$select name from storage.objects where bucket_id = 'recordings' and name = '{rec_path}'$q$),
('storage: resource file, 1 object', 'member,manager,executive', $q$select name from storage.objects where bucket_id = 'club-resources' and name = '{res_path}'$q$),
('storage: archive file, 1 object', 'member,executive', $q$select name from storage.objects where bucket_id = 'club-archive' and name = '{arch_path}'$q$),
('storage: notation file, 1 object', 'member,executive', $q$select name from storage.objects where bucket_id = 'recording-notations' and name = '{note_path}'$q$),
('storage: finance file, 1 object', 'member,executive', $q$select name from storage.objects where bucket_id = 'finance-private' and name = '{fin_path}'$q$),
('storage: excuse proof, 1 object', 'member,executive', $q$select name from storage.objects where bucket_id = 'attendance-excuses' and name = '{exc_path}'$q$),
('storage: 50 resource thumbnails (createSignedUrls)', 'member,manager,executive', $q$select name from storage.objects where bucket_id = 'club-resources' and name = any({res_paths50})$q$),
('storage: scan club-resources bucket (upper bound)', 'member,executive', $q$select count(*) from storage.objects where bucket_id = 'club-resources'$q$),
('storage: scan recordings bucket (upper bound)', 'member,executive', $q$select count(*) from storage.objects where bucket_id = 'recordings'$q$),
('storage: scan club-archive bucket (upper bound)', 'member,executive', $q$select count(*) from storage.objects where bucket_id = 'club-archive'$q$);
