-- Phase 2: one round trip per screen for the two busiest loads.
--
-- Both functions are SECURITY INVOKER: they run with the caller's own
-- row-level security, so they can never return a row the caller could not
-- already read with separate queries. They only save round trips and avoid
-- PostgREST's 1,000-row cap (the result is a single JSON value).

-- Everything the portal shell needs after sign-in: was 6 requests.
create or replace function public.get_portal_bootstrap()
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'profile', (
      select jsonb_build_object('full_name', profile.full_name, 'role', profile.role, 'status', profile.status)
      from public.profiles profile where profile.id = (select auth.uid())),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'description', g.description,
        'enrollment_mode', g.enrollment_mode, 'archived_at', g.archived_at) order by g.name)
      from public.subgroups g where g.archived_at is null), '[]'::jsonb),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object('subgroup_id', m.subgroup_id, 'member_id', m.member_id,
        'status', m.status, 'membership_role', m.membership_role))
      from public.subgroup_memberships m where m.member_id = (select auth.uid())), '[]'::jsonb),
    'announcements', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.is_pinned desc, a.published_at desc)
      from (select * from public.announcements order by is_pinned desc, published_at desc limit 12) a), '[]'::jsonb),
    -- The calendar shows the past year and everything ahead.
    'events', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.starts_at)
      from public.events e where e.starts_at >= now() - interval '1 year'), '[]'::jsonb),
    'resource_count', (select count(*) from public.resources r where r.status <> 'archived'),
    -- Only the executive "club and concert recordings" manager uses these.
    'archive', case when (select private.is_executive()) then coalesce((
      select jsonb_agg(to_jsonb(item) order by item.created_at desc)
      from public.archive_items item where item.type = 'recording'), '[]'::jsonb) else '[]'::jsonb end
  );
$$;

-- The attendance screen: was 8 requests (and 8 more every 10 seconds while a
-- check-in is open), with session ids packed into the URL.
create or replace function public.get_attendance_workspace(
  p_scope text default 'all',
  p_subgroup_id bigint default null,
  p_since timestamptz default (now() - interval '18 months')
)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  with chosen as (
    select s.id
    from public.attendance_sessions s
    where s.starts_at >= p_since
      and (p_scope = 'all'
        or (p_scope = 'club' and s.scope = 'club')
        or (p_scope = 'subgroup' and s.subgroup_id = p_subgroup_id))
  )
  select jsonb_build_object(
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'scope', s.scope, 'subgroup_id', s.subgroup_id, 'title', s.title,
        'starts_at', s.starts_at, 'status', s.status, 'opened_at', s.opened_at, 'closes_at', s.closes_at,
        'closed_at', s.closed_at, 'canceled_at', s.canceled_at, 'cancel_reason', s.cancel_reason,
        'code_expires_at', s.code_expires_at, 'created_at', s.created_at,
        'counts_toward_metrics', s.counts_toward_metrics) order by s.starts_at desc)
      from public.attendance_sessions s where s.id in (select id from chosen)), '[]'::jsonb),
    'records', coalesce((
      select jsonb_agg(jsonb_build_object('session_id', r.session_id, 'member_id', r.member_id, 'status', r.status,
        'source', r.source, 'note', r.note, 'marked_at', r.marked_at, 'minutes_late', r.minutes_late,
        'unexcused_units', r.unexcused_units))
      from public.attendance_records r where r.session_id in (select id from chosen)), '[]'::jsonb),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object('session_id', p.session_id, 'member_id', p.member_id, 'snapshotted_at', p.snapshotted_at))
      from public.attendance_session_participants p where p.session_id in (select id from chosen)), '[]'::jsonb),
    'excuses', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'session_id', x.session_id, 'member_id', x.member_id,
        'reason', x.reason, 'proof_path', x.proof_path, 'reason_category', x.reason_category,
        'notified_at', x.notified_at, 'status', x.status, 'submitted_at', x.submitted_at,
        'reviewed_at', x.reviewed_at, 'review_note', x.review_note) order by x.submitted_at desc)
      from public.attendance_excuses x where x.session_id in (select id from chosen)), '[]'::jsonb),
    'remediations', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'session_id', m.session_id, 'member_id', m.member_id,
        'assignment', m.assignment, 'due_at', m.due_at, 'status', m.status, 'note', m.note) order by m.created_at desc)
      from public.attendance_remediations m where m.session_id in (select id from chosen)), '[]'::jsonb),
    'eligibility', coalesce((
      select jsonb_agg(jsonb_build_object('term_key', e.term_key, 'member_id', e.member_id, 'status', e.status, 'reason', e.reason))
      from public.attendance_eligibility e), '[]'::jsonb),
    -- Executives need names for the roster; members only need their own.
    'profiles', coalesce((
      select jsonb_agg(jsonb_build_object('id', pr.id, 'full_name', pr.full_name, 'email', pr.email) order by pr.full_name)
      from public.profiles pr where (select private.is_executive()) or pr.id = (select auth.uid())), '[]'::jsonb),
    'settings', (
      select jsonb_build_object('warning_absences', st.warning_absences, 'critical_absences', st.critical_absences)
      from public.attendance_settings st where st.id)
  );
$$;

revoke all on function public.get_portal_bootstrap() from public, anon;
revoke all on function public.get_attendance_workspace(text, bigint, timestamptz) from public, anon;
grant execute on function public.get_portal_bootstrap() to authenticated;
grant execute on function public.get_attendance_workspace(text, bigint, timestamptz) to authenticated;
