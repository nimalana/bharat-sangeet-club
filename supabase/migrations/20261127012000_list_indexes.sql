-- Phase 2: indexes that match the order each paged list is read in, so a page
-- is an index range scan instead of a sort of the whole table.
create index if not exists recordings_status_created_idx on public.recordings (status, created_at desc, id desc);
create index if not exists recordings_subgroup_created_idx on public.recordings (subgroup_id, created_at desc, id desc);
create index if not exists resources_parent_order_idx on public.resources (parent_id, is_pinned desc, updated_at desc, id desc);
create index if not exists finance_payments_date_idx on public.finance_payments (payment_date desc, id desc);
create index if not exists finance_expenses_date_idx on public.finance_expenses (purchase_date desc, id desc);
create index if not exists personal_reimbursements_created_idx on public.personal_reimbursements (created_at desc, id desc);
create index if not exists personal_reimbursements_member_idx on public.personal_reimbursements (member_id, created_at desc);
create index if not exists attendance_sessions_starts_idx on public.attendance_sessions (starts_at desc, id desc);
create index if not exists profiles_name_idx on public.profiles (full_name, id);
create index if not exists admin_audit_log_created_idx on public.admin_audit_log (created_at desc, id desc);
create index if not exists announcements_feed_idx on public.announcements (is_pinned desc, published_at desc);
create index if not exists events_starts_idx on public.events (starts_at);
