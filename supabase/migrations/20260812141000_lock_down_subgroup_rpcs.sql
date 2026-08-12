-- Supabase projects may have direct default EXECUTE grants for anon in addition
-- to PostgreSQL's PUBLIC grant. These subgroup RPCs are authenticated-only.
revoke execute on function public.request_subgroup_enrollment(bigint) from anon;
revoke execute on function public.create_subgroup(text, text, public.subgroup_enrollment_mode) from anon;
revoke execute on function public.review_subgroup_enrollment(bigint, uuid, public.subgroup_membership_status) from anon;
revoke execute on function public.set_subgroup_member_role(bigint, uuid, public.subgroup_membership_role) from anon;

-- Cover the new and pre-existing foreign keys used in membership and
-- attendance maintenance.
create index if not exists subgroup_memberships_added_by_idx on public.subgroup_memberships(added_by);
create index if not exists subgroup_memberships_requested_by_idx on public.subgroup_memberships(requested_by);
create index if not exists subgroup_memberships_reviewed_by_idx on public.subgroup_memberships(reviewed_by);
create index if not exists subgroups_created_by_idx on public.subgroups(created_by);
create index if not exists attendance_sessions_created_by_idx on public.attendance_sessions(created_by);
create index if not exists attendance_records_marked_by_idx on public.attendance_records(marked_by);
