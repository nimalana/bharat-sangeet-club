-- attendance round 2 (independent check of finance-11).
--
-- 1. MAJOR: the roster 'version' was count(*) of the marks plus the newest
--    update time. Opening check-in on a draft adds every participant but no
--    mark, so the version stayed the same, the page decided its (empty) roster
--    was current and an executive had no members to mark until the first
--    check-in. The version is now a digest of what the roster shows (who is on
--    it and each mark, minutes late and units), so it changes when a
--    participant joins, when a mark is added, changed or cleared, and cannot be
--    missed because of the order in which transactions commit. The overview,
--    the poll and the roster all call one function, so they cannot drift apart.
--
-- 2. Members never saw an executive's decision on their absence form, or a new
--    follow-up item, until they did something themselves: the poll carried
--    nothing for them. The overview and the poll now both carry 'items_version',
--    which changes when the caller's own forms or follow-up items change. For an
--    executive it is the number of waiting forms and open follow-up items.
--
-- 3. The cap on the executive's review queues is documented in the function
--    and raised on request: p_list_limit now goes up to 1000 (it stopped at 500),
--    so the page can offer 'Show more'.
--
-- All three public functions keep their signatures and stay SECURITY INVOKER.
-- The two helpers are invoker too: they read through the caller's own row
-- level security, so they only ever see rows the caller could read anyway.

-- A digest of the roster as the page shows it. The roster page is built from
-- participants and their marks: member, status, minutes late, units. A note,
-- a rename or a changed update time is not on that page and does not change it.
create or replace function private.attendance_roster_version(p_session_id bigint)
returns text
language sql stable security invoker set search_path = '' as $$
  select md5(coalesce(string_agg(
      p.member_id::text || ':' || coalesce(r.status::text, '-') || ':' || coalesce(r.minutes_late::text, '') || ':' || coalesce(r.unexcused_units::text, ''),
      ',' order by p.member_id), ''))
  from public.attendance_session_participants p
  left join public.attendance_records r on r.session_id = p.session_id and r.member_id = p.member_id
  where p.session_id = p_session_id;
$$;

-- A short text that changes when the caller's absence forms or follow-up items
-- (among the given meetings) change. A member, or anyone who is not an
-- executive, gets a digest of the rows they can read: a decision on a form,
-- a new or completed follow-up item, an edited instruction. An executive gets
-- the number of forms waiting for review and of open follow-up items, which is
-- what the review queues list and count.
create or replace function private.attendance_items_version(p_session_ids bigint[])
returns text
language plpgsql stable security invoker set search_path = '' as $$
begin
  if coalesce((select private.is_executive()), false) then
    return 'x:' ||
      (select count(*) from public.attendance_excuses x where x.session_id = any(p_session_ids) and x.status = 'pending')::text || ':' ||
      (select count(*) from public.attendance_remediations m where m.session_id = any(p_session_ids) and m.status = 'pending')::text;
  end if;
  return 'm:' || md5(
    coalesce((select string_agg(x::text, ',' order by x.id) from public.attendance_excuses x where x.session_id = any(p_session_ids)), '') || '|' ||
    coalesce((select string_agg(m::text, ',' order by m.id) from public.attendance_remediations m where m.session_id = any(p_session_ids)), ''));
end;
$$;

revoke all on function private.attendance_roster_version(bigint) from public, anon;
revoke all on function private.attendance_items_version(bigint[]) from public, anon;
grant execute on function private.attendance_roster_version(bigint) to authenticated;
grant execute on function private.attendance_items_version(bigint[]) to authenticated;

-- The full load, once per audience and term (see 20261127060000 for what it holds).
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
  -- Cap on each review queue an executive sees: pending absence forms, the
  -- other absence forms and open follow-up items, newest first. The totals
  -- ('excuses_total', 'excuses_pending', 'remediations_pending') are always
  -- exact, and 'list_limit' says which cap was applied. Items beyond the cap
  -- are not returned; the screen says so and its 'Show more' asks again with a
  -- larger p_list_limit (100, 250, 500, then 1000, the most this function
  -- gives). Beyond that, the Term and View filters narrow the lists. Members
  -- get all of their own items, uncapped. The page keeps the same steps in
  -- components/attendance/attendance-model.ts (LIST_LIMIT_STEPS).
  v_limit integer := least(greatest(coalesce(p_list_limit, 100), 1), 1000);
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
          -- Changes with the roster's content (see private.attendance_roster_version).
          'version', private.attendance_roster_version(s.id))
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
    -- Changes when the caller's own forms and follow-up items change (an
    -- executive: when the number of waiting forms or open items does). The
    -- poll carries the same text, so the page reads this again only then.
    'items_version', private.attendance_items_version(v_ids),
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
  v_ids bigint[];
begin
  -- The meetings in this audience: the same rule the overview applies, so a
  -- count here always means what the same count there means.
  select coalesce(array_agg(s.id), '{}'::bigint[]) into v_ids
  from public.attendance_sessions s
  where s.starts_at >= p_since
    and (p_scope = 'all'
      or (p_scope = 'club' and s.scope = 'club')
      or (p_scope = 'subgroup' and s.subgroup_id = p_subgroup_id))
    and (p_term_key is null
      or p_term_key = extract(year from (s.starts_at at time zone 'America/New_York'))::integer::text || '-' ||
         case when extract(month from (s.starts_at at time zone 'America/New_York')) between 1 and 6 then 'spring' else 'fall' end);

  return jsonb_build_object(
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', s.id, 'status', s.status, 'closes_at', s.closes_at, 'code_expires_at', s.code_expires_at,
          'live', case when v_exec then (
            select jsonb_build_object(
              'roster_count', (select count(*) from public.attendance_session_participants p where p.session_id = s.id),
              'checked_in_count', count(*) filter (where r.status in ('present', 'tardy')),
              'version', private.attendance_roster_version(s.id))
            from public.attendance_records r where r.session_id = s.id) end,
          'my_record', (
            select jsonb_build_object('session_id', r.session_id, 'member_id', r.member_id, 'status', r.status, 'source', r.source,
              'note', r.note, 'marked_at', r.marked_at, 'minutes_late', r.minutes_late, 'unexcused_units', r.unexcused_units)
            from public.attendance_records r where r.session_id = s.id and r.member_id = v_me)
        ) order by s.starts_at desc, s.id desc)
      from public.attendance_sessions s
      where s.status = 'open' and s.id = any(v_ids)
    ), '[]'::jsonb),
    'pending_excuses', case when v_exec then (
      select count(*) from public.attendance_excuses x where x.session_id = any(v_ids) and x.status = 'pending'
    ) end,
    -- What a member sees of their own forms and follow-up: the page reads the
    -- overview again when this text differs from the one it holds.
    'items_version', private.attendance_items_version(v_ids)
  );
end;
$$;

-- One meeting's roster: who is on it and what each mark is. 'version' (the
-- same text as 'live.version' in the two functions above) changes whenever the
-- roster's content does: a participant joins (opening check-in adds all of
-- them), or a mark is added, changed or cleared. The page reloads a roster
-- only when its version no longer matches. A name or e-mail edit is not
-- tracked; it shows the next time the roster is read.
create or replace function public.get_attendance_roster(p_session_id bigint)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'session_id', p_session_id,
    'version', private.attendance_roster_version(p_session_id),
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
