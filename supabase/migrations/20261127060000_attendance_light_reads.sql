-- finance-11: the attendance screen read about 5.7 MB per executive call
-- (get_attendance_workspace returned every attendance record and every
-- participant for 18 months) and re-read all of it every 10 seconds while a
-- check-in was open.
--
-- What the screen really shows:
--   * an executive sees per-member totals only for members who reached the
--     warning threshold, two club-wide figures, and the roster of ONE meeting
--     at a time;
--   * a member sees their own marks, forms and follow-up.
-- So the server now does the totals and the client asks for a roster only when
-- a meeting is selected. Three functions replace the one big read:
--
--   get_attendance_overview  the full load, once per audience and term.
--                            Size depends on the number of meetings, members
--                            at the threshold and open forms, not on the
--                            number of marks.
--   get_attendance_pulse     the 10 second poll while check-in is open: the
--                            open meetings' state and counts, the caller's own
--                            mark, and the pending form count. Nothing per
--                            member.
--   get_attendance_roster    one meeting's roster (who and what mark), loaded
--                            when an executive selects the meeting.
--
-- All three are SECURITY INVOKER: they read through the caller's own row
-- level security, so nobody gets a row they could not already read.
-- get_attendance_workspace is left in place (an older page may still call it
-- during a rollout) and can be dropped once nothing does.

create or replace function public.get_attendance_overview(
  p_scope text default 'all',
  p_subgroup_id bigint default null,
  p_term_key text default null,
  p_since timestamptz default (now() - interval '18 months'),
  p_list_limit integer default 100
)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  v_exec boolean := coalesce((select private.is_executive()), false);
  -- Cap on the review queues an executive sees (pending forms, other forms,
  -- pending follow-up). The totals are always exact.
  v_limit integer := least(greatest(coalesce(p_list_limit, 100), 1), 500);
  v_ids bigint[];
  v_terms jsonb;
  v_view_term text;
  v_summary_term text;
  v_warning integer;
  v_critical integer;
  v_sessions jsonb;
  v_records jsonb;
  v_excuses jsonb;
  v_excuses_pending bigint;
  v_excuses_total bigint;
  v_remediations jsonb;
  v_remediations_pending bigint;
  v_flagged jsonb;
  v_att_present bigint;
  v_att_absent bigint;
  v_eligibility jsonb;
  v_profiles jsonb;
  v_settings jsonb;
  v_current_term text;
begin
  select st.warning_absences, st.critical_absences into v_warning, v_critical
  from public.attendance_settings st where st.id;
  v_warning := coalesce(v_warning, 2);
  v_critical := coalesce(v_critical, 3);
  -- Same rule as private.attendance_term_key (Eastern time, spring = Jan-Jun).
  v_current_term := extract(year from (now() at time zone 'America/New_York'))::integer::text || '-' ||
    case when extract(month from (now() at time zone 'America/New_York')) between 1 and 6 then 'spring' else 'fall' end;

  -- The meetings in this audience, which of them fall in the chosen term, and
  -- the term whose eligibility the page shows: the filter if there is one,
  -- otherwise the newest meeting's term (members) or the latest closed
  -- meeting's term (the executive list).
  select coalesce(array_agg(t.id) filter (where p_term_key is null or t.term = p_term_key), '{}'::bigint[]),
         coalesce(jsonb_agg(distinct t.term order by t.term desc), '[]'::jsonb),
         coalesce(p_term_key, (array_agg(t.term order by t.starts_at desc, t.id desc))[1], v_current_term),
         coalesce(p_term_key, (array_agg(t.term order by t.starts_at desc, t.id desc)
           filter (where t.status = 'closed' and t.counts_toward_metrics))[1], v_current_term)
  into v_ids, v_terms, v_view_term, v_summary_term
  from (
    select s.id, s.starts_at, s.status, s.counts_toward_metrics,
      extract(year from (s.starts_at at time zone 'America/New_York'))::integer::text || '-' ||
      case when extract(month from (s.starts_at at time zone 'America/New_York')) between 1 and 6 then 'spring' else 'fall' end as term
    from public.attendance_sessions s
    where s.starts_at >= p_since
      and (p_scope = 'all'
        or (p_scope = 'club' and s.scope = 'club')
        or (p_scope = 'subgroup' and s.subgroup_id = p_subgroup_id))
  ) t;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'scope', s.scope, 'subgroup_id', s.subgroup_id, 'subgroup_name', g.name, 'title', s.title,
      'starts_at', s.starts_at, 'status', s.status, 'opened_at', s.opened_at, 'closes_at', s.closes_at,
      'closed_at', s.closed_at, 'canceled_at', s.canceled_at, 'cancel_reason', s.cancel_reason,
      'code_expires_at', s.code_expires_at, 'created_at', s.created_at,
      'counts_toward_metrics', s.counts_toward_metrics,
      -- Counts for a meeting that is open right now; only executives run it.
      'live', case when v_exec and s.status = 'open' then (
        select jsonb_build_object(
          'roster_count', (select count(*) from public.attendance_session_participants p where p.session_id = s.id),
          'checked_in_count', count(*) filter (where r.status in ('present', 'tardy')),
          'version', count(*)::text || ':' || coalesce(extract(epoch from max(r.updated_at))::text, ''))
        from public.attendance_records r where r.session_id = s.id) end
    ) order by s.starts_at desc, s.id desc), '[]'::jsonb)
  into v_sessions
  from public.attendance_sessions s
  left join public.subgroups g on g.id = s.subgroup_id
  where s.id = any(v_ids);

  -- The caller's own marks (members read their history from these; an
  -- executive's page works from the totals and the roster instead).
  select coalesce(jsonb_agg(jsonb_build_object(
      'session_id', r.session_id, 'member_id', r.member_id, 'status', r.status, 'source', r.source, 'note', r.note,
      'marked_at', r.marked_at, 'minutes_late', r.minutes_late, 'unexcused_units', r.unexcused_units)), '[]'::jsonb)
  into v_records
  from public.attendance_records r
  where r.session_id = any(v_ids) and r.member_id = v_me and not v_exec;

  -- Absence forms: a member's own, or an executive's review queue (every
  -- pending one up to the cap, and the latest reviewed ones).
  select coalesce(jsonb_agg(f.j order by f.submitted_at desc, f.id desc), '[]'::jsonb)
  into v_excuses
  from (
    (select x.id, x.submitted_at, jsonb_build_object(
        'id', x.id, 'session_id', x.session_id, 'member_id', x.member_id, 'reason', x.reason, 'proof_path', x.proof_path,
        'reason_category', x.reason_category, 'notified_at', x.notified_at, 'status', x.status,
        'submitted_at', x.submitted_at, 'reviewed_at', x.reviewed_at, 'review_note', x.review_note) as j
     from public.attendance_excuses x
     where x.session_id = any(v_ids) and x.status = 'pending'
     order by x.submitted_at desc, x.id desc
     limit case when v_exec then v_limit end)
    union all
    (select x.id, x.submitted_at, jsonb_build_object(
        'id', x.id, 'session_id', x.session_id, 'member_id', x.member_id, 'reason', x.reason, 'proof_path', x.proof_path,
        'reason_category', x.reason_category, 'notified_at', x.notified_at, 'status', x.status,
        'submitted_at', x.submitted_at, 'reviewed_at', x.reviewed_at, 'review_note', x.review_note)
     from public.attendance_excuses x
     where x.session_id = any(v_ids) and x.status <> 'pending'
     order by x.submitted_at desc, x.id desc
     limit case when v_exec then v_limit end)
  ) f;
  select count(*) filter (where x.status = 'pending'), count(*) into v_excuses_pending, v_excuses_total
  from public.attendance_excuses x where x.session_id = any(v_ids);

  -- Follow-up: a member's own (every status); an executive's open items.
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'session_id', m.session_id, 'member_id', m.member_id, 'assignment', m.assignment,
      'due_at', m.due_at, 'status', m.status, 'note', m.note) order by m.created_at desc, m.id desc), '[]'::jsonb)
  into v_remediations
  from (
    select * from public.attendance_remediations m0
    where m0.session_id = any(v_ids) and (not v_exec or m0.status = 'pending')
    order by m0.created_at desc, m0.id desc
    limit case when v_exec then v_limit end
  ) m;
  select count(*) into v_remediations_pending
  from public.attendance_remediations m where m.session_id = any(v_ids) and m.status = 'pending';

  -- Per-member totals over closed meetings that count, kept only for members
  -- at or above the warning level (what the screen lists), plus the two
  -- club-wide sums behind the attendance rate.
  v_flagged := '[]'::jsonb; v_att_present := 0; v_att_absent := 0;
  if v_exec then
    select coalesce(jsonb_agg(jsonb_build_object(
             'member_id', q.member_id, 'present', q.present, 'absent', q.absent, 'excused', q.excused, 'tardy', q.tardy,
             'club_units', q.club_units, 'subgroup_units', q.subgroup_units, 'eligibility', el.status)
             order by q.club_units + q.subgroup_units desc, q.member_id) filter (where greatest(q.club_units, q.subgroup_units) >= v_warning), '[]'::jsonb),
           coalesce(sum(q.present + q.tardy), 0), coalesce(sum(q.absent), 0)
    into v_flagged, v_att_present, v_att_absent
    from (
      select r.member_id,
        count(*) filter (where r.status = 'present') as present,
        count(*) filter (where r.status = 'absent') as absent,
        count(*) filter (where r.status = 'excused') as excused,
        count(*) filter (where r.status = 'tardy') as tardy,
        -- A recorded unit count wins; a bare absence counts as one.
        coalesce(sum(u.units) filter (where s.scope = 'club'), 0) as club_units,
        coalesce(sum(u.units) filter (where s.scope = 'subgroup'), 0) as subgroup_units
      from public.attendance_records r
      join public.attendance_sessions s on s.id = r.session_id
      cross join lateral (select case when r.unexcused_units <> 0 then r.unexcused_units when r.status = 'absent' then 1 else 0 end as units) u
      where r.session_id = any(v_ids) and s.status = 'closed' and s.counts_toward_metrics
      group by r.member_id
    ) q
    left join public.attendance_eligibility el on el.member_id = q.member_id and el.term_key = v_summary_term;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('term_key', e.term_key, 'member_id', e.member_id, 'status', e.status, 'reason', e.reason)), '[]'::jsonb)
  into v_eligibility
  from public.attendance_eligibility e where e.member_id = v_me and e.term_key = v_view_term and not v_exec;

  -- Names for the people the lists above mention (executives), or just the
  -- caller (everyone else).
  select coalesce(jsonb_agg(jsonb_build_object('id', pr.id, 'full_name', pr.full_name, 'email', pr.email) order by pr.full_name), '[]'::jsonb)
  into v_profiles
  from public.profiles pr
  where pr.id = v_me
    or (v_exec and pr.id in (
      select (e ->> 'member_id')::uuid from jsonb_array_elements(v_flagged || v_excuses || v_remediations) e));

  select jsonb_build_object('warning_absences', st.warning_absences, 'critical_absences', st.critical_absences)
  into v_settings
  from public.attendance_settings st where st.id;

  return jsonb_build_object(
    'terms', v_terms,
    'term', p_term_key,
    'view_term', v_view_term,
    'summary_term', v_summary_term,
    'sessions', v_sessions,
    'records', v_records,
    'excuses', v_excuses,
    'excuses_pending', v_excuses_pending,
    'excuses_total', v_excuses_total,
    'remediations', v_remediations,
    'remediations_pending', v_remediations_pending,
    'eligibility', v_eligibility,
    'flagged', v_flagged,
    'attended_total', v_att_present,
    'absent_total', v_att_absent,
    'profiles', v_profiles,
    'settings', v_settings,
    'list_limit', v_limit
  );
end;
$$;

-- The 10 second poll while check-in is open. Only what changes while a
-- meeting is running; nothing about other members unless the caller is an
-- executive, and then only counts.
create or replace function public.get_attendance_pulse(
  p_scope text default 'all',
  p_subgroup_id bigint default null,
  p_term_key text default null,
  p_since timestamptz default (now() - interval '18 months')
)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  v_exec boolean := coalesce((select private.is_executive()), false);
begin
  return jsonb_build_object(
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', s.id, 'status', s.status, 'closes_at', s.closes_at, 'code_expires_at', s.code_expires_at,
          'live', case when v_exec then (
            select jsonb_build_object(
              'roster_count', (select count(*) from public.attendance_session_participants p where p.session_id = s.id),
              'checked_in_count', count(*) filter (where r.status in ('present', 'tardy')),
              'version', count(*)::text || ':' || coalesce(extract(epoch from max(r.updated_at))::text, ''))
            from public.attendance_records r where r.session_id = s.id) end,
          'my_record', (
            select jsonb_build_object('session_id', r.session_id, 'member_id', r.member_id, 'status', r.status, 'source', r.source,
              'note', r.note, 'marked_at', r.marked_at, 'minutes_late', r.minutes_late, 'unexcused_units', r.unexcused_units)
            from public.attendance_records r where r.session_id = s.id and r.member_id = v_me)
        ) order by s.starts_at desc, s.id desc)
      from public.attendance_sessions s
      where s.status = 'open'
        and s.starts_at >= p_since
        and (p_scope = 'all'
          or (p_scope = 'club' and s.scope = 'club')
          or (p_scope = 'subgroup' and s.subgroup_id = p_subgroup_id))
        and (p_term_key is null
          or p_term_key = extract(year from (s.starts_at at time zone 'America/New_York'))::integer::text || '-' ||
             case when extract(month from (s.starts_at at time zone 'America/New_York')) between 1 and 6 then 'spring' else 'fall' end)
    ), '[]'::jsonb),
    'pending_excuses', case when v_exec then (
      select count(*)
      from public.attendance_excuses x
      join public.attendance_sessions s on s.id = x.session_id
      where x.status = 'pending'
        and s.starts_at >= p_since
        and (p_scope = 'all'
          or (p_scope = 'club' and s.scope = 'club')
          or (p_scope = 'subgroup' and s.subgroup_id = p_subgroup_id))
        and (p_term_key is null
          or p_term_key = extract(year from (s.starts_at at time zone 'America/New_York'))::integer::text || '-' ||
             case when extract(month from (s.starts_at at time zone 'America/New_York')) between 1 and 6 then 'spring' else 'fall' end)
    ) end
  );
end;
$$;

-- One meeting's roster: who is on it and what each mark is. 'version' (the
-- same text as 'live.version' in the two functions above) changes whenever a
-- mark is added, changed or cleared, so the page reloads a roster only when it
-- has moved.
create or replace function public.get_attendance_roster(p_session_id bigint)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'session_id', p_session_id,
    'version', (
      select count(*)::text || ':' || coalesce(extract(epoch from max(r.updated_at))::text, '')
      from public.attendance_records r where r.session_id = p_session_id),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
          'member_id', p.member_id, 'full_name', pr.full_name, 'email', pr.email,
          'status', r.status, 'minutes_late', r.minutes_late, 'unexcused_units', r.unexcused_units)
        order by lower(coalesce(nullif(pr.full_name, ''), pr.email, '')), p.member_id)
      from public.attendance_session_participants p
      left join public.attendance_records r on r.session_id = p.session_id and r.member_id = p.member_id
      left join public.profiles pr on pr.id = p.member_id
      where p.session_id = p_session_id), '[]'::jsonb));
$$;

revoke all on function public.get_attendance_overview(text, bigint, text, timestamptz, integer) from public, anon;
revoke all on function public.get_attendance_pulse(text, bigint, text, timestamptz) from public, anon;
revoke all on function public.get_attendance_roster(bigint) from public, anon;
grant execute on function public.get_attendance_overview(text, bigint, text, timestamptz, integer) to authenticated;
grant execute on function public.get_attendance_pulse(text, bigint, text, timestamptz) to authenticated;
grant execute on function public.get_attendance_roster(bigint) to authenticated;

-- Only if it exists here: a database that never had it just skips this.
do $$
begin
  if to_regprocedure('public.get_attendance_workspace(text, bigint, timestamptz)') is not null then
    comment on function public.get_attendance_workspace(text, bigint, timestamptz) is
      'Superseded by get_attendance_overview, get_attendance_pulse and get_attendance_roster (about 5.7 MB per executive call at 500 members). Drop once no deployed page calls it.';
  end if;
end $$;
