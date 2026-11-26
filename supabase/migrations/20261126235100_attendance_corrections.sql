-- Attendance corrections: edit or delete a draft meeting, void a closed
-- meeting that should not count, undo a mistaken mark, withdraw an absence
-- form, and change the warning thresholds.

alter table public.attendance_sessions add column if not exists cancel_reason text;
-- A cleared mark is audited with no new status.
alter table public.attendance_record_audit alter column new_status drop not null;

create or replace function public.update_attendance_session(p_session_id bigint, p_title text, p_starts_at timestamptz)
returns public.attendance_sessions
language plpgsql security definer set search_path = '' as $$
declare result public.attendance_sessions;
begin
  if not private.is_executive() then raise exception 'executive permission required' using errcode = '42501'; end if;
  if nullif(trim(coalesce(p_title, '')), '') is null then raise exception 'Give the meeting a title' using errcode = '22023'; end if;
  if p_starts_at is null then raise exception 'Choose when the meeting starts' using errcode = '22023'; end if;
  update public.attendance_sessions
  set title = trim(p_title), starts_at = p_starts_at,
      session_date = (p_starts_at at time zone 'America/New_York')::date
  where id = p_session_id and status = 'draft'
  returning * into result;
  if not found then raise exception 'Only meetings that have not opened yet can be edited' using errcode = '22023'; end if;
  return result;
end;
$$;

create or replace function public.delete_attendance_session(p_session_id bigint)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_executive() then raise exception 'executive permission required' using errcode = '42501'; end if;
  delete from public.attendance_sessions where id = p_session_id and status = 'draft';
  if not found then raise exception 'Only meetings that have not opened yet can be deleted. Void a closed meeting instead.' using errcode = '22023'; end if;
end;
$$;

-- Tardy escalation must not count tardies from canceled or voided meetings.
create or replace function private.attendance_unexcused_units(p_session_id bigint, p_member_id uuid, p_status public.attendance_status, p_minutes_late integer)
returns numeric
language plpgsql security definer set search_path = '' as $$
declare
  target_scope public.attendance_scope;
  target_starts_at timestamptz;
  normal_tardy_count integer;
begin
  if p_status = 'absent' then return 1;
  elsif p_status in ('present', 'excused') then return 0;
  elsif p_status <> 'tardy' then return 0;
  end if;

  select scope, starts_at into target_scope, target_starts_at
  from public.attendance_sessions where id = p_session_id;

  if p_minutes_late > 10 then return 0.5; end if;

  select count(*) into normal_tardy_count
  from public.attendance_records r
  join public.attendance_sessions s on s.id = r.session_id
  where r.member_id = p_member_id
    and r.status = 'tardy'
    and r.minutes_late between 0 and 10
    and s.scope = target_scope
    and s.status <> 'canceled'
    and private.attendance_term_key(s.starts_at) = private.attendance_term_key(target_starts_at)
    and r.session_id <> p_session_id;

  return case when normal_tardy_count >= 3 then 1 else 0 end;
end;
$$;

create or replace function public.void_attendance_session(p_session_id bigint, p_reason text)
returns public.attendance_sessions
language plpgsql security definer set search_path = '' as $$
declare
  target public.attendance_sessions;
  result public.attendance_sessions;
  v_reason text := trim(coalesce(p_reason, ''));
begin
  if not private.is_executive() then raise exception 'executive permission required' using errcode = '42501'; end if;
  if char_length(v_reason) < 3 then raise exception 'Say why this meeting is being voided' using errcode = '22023'; end if;
  select * into target from public.attendance_sessions where id = p_session_id for update;
  if not found then raise exception 'Meeting not found' using errcode = 'P0002'; end if;
  if target.status <> 'closed' then
    raise exception 'Only closed meetings can be voided. Cancel a draft or open meeting instead.' using errcode = '22023';
  end if;

  update public.attendance_sessions
  set status = 'canceled', canceled_at = now(), cancel_reason = left(v_reason, 500), counts_toward_metrics = false
  where id = p_session_id
  returning * into result;

  update public.attendance_remediations
  set status = 'waived', note = left('Meeting voided: ' || v_reason, 500), updated_at = now()
  where session_id = p_session_id and status = 'pending';

  update public.attendance_excuses
  set status = 'withdrawn', reviewed_by = auth.uid(), reviewed_at = now(), review_note = 'Meeting voided'
  where session_id = p_session_id and status = 'pending';

  -- Re-rate the tardies these members have in the same term and workspace,
  -- because one of the tardies that pushed them over the limit may be gone.
  update public.attendance_records r
  set minutes_late = r.minutes_late
  from public.attendance_sessions s
  where s.id = r.session_id
    and r.status = 'tardy'
    and s.status <> 'canceled'
    and s.scope = target.scope
    and private.attendance_term_key(s.starts_at) = private.attendance_term_key(target.starts_at)
    and r.member_id in (
      select voided.member_id from public.attendance_records voided
      where voided.session_id = p_session_id and voided.status = 'tardy'
    );
  return result;
end;
$$;

create or replace function public.clear_attendance_status(p_session_id bigint, p_member_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare removed public.attendance_records;
begin
  if not private.is_executive() then raise exception 'executive permission required' using errcode = '42501'; end if;
  if exists (select 1 from public.attendance_sessions where id = p_session_id and status = 'canceled') then
    raise exception 'This meeting was canceled, so its marks cannot be changed' using errcode = '22023';
  end if;
  delete from public.attendance_records
  where session_id = p_session_id and member_id = p_member_id
  returning * into removed;
  if not found then raise exception 'There is no mark to clear for this member' using errcode = 'P0002'; end if;

  insert into public.attendance_record_audit(session_id, member_id, previous_status, new_status, source, note, changed_by)
  values (p_session_id, p_member_id, removed.status, null, 'executive', 'Mark cleared', auth.uid());

  delete from public.attendance_remediations
  where session_id = p_session_id and member_id = p_member_id and status = 'pending';
end;
$$;

create or replace function public.withdraw_attendance_excuse(p_excuse_id bigint)
returns public.attendance_excuses
language plpgsql security definer set search_path = '' as $$
declare result public.attendance_excuses;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '42501'; end if;
  update public.attendance_excuses
  set status = 'withdrawn', reviewed_at = now(), review_note = 'Withdrawn by member'
  where id = p_excuse_id and member_id = auth.uid() and status = 'pending'
  returning * into result;
  if not found then raise exception 'Only your own forms that are still waiting for review can be withdrawn' using errcode = '22023'; end if;
  return result;
end;
$$;

create or replace function public.set_attendance_thresholds(p_warning integer, p_critical integer)
returns public.attendance_settings
language plpgsql security definer set search_path = '' as $$
declare result public.attendance_settings;
begin
  if not private.is_executive() then raise exception 'executive permission required' using errcode = '42501'; end if;
  if p_warning is null or p_critical is null or p_warning < 1 or p_critical <= p_warning or p_critical > 50 then
    raise exception 'The warning level must be at least 1 and the critical level must be higher' using errcode = '22023';
  end if;
  insert into public.attendance_settings(id, warning_absences, critical_absences, updated_by, updated_at)
  values (true, p_warning, p_critical, auth.uid(), now())
  on conflict (id) do update set
    warning_absences = excluded.warning_absences,
    critical_absences = excluded.critical_absences,
    updated_by = excluded.updated_by,
    updated_at = now()
  returning * into result;
  return result;
end;
$$;

revoke all on function public.update_attendance_session(bigint, text, timestamptz) from public, anon;
revoke all on function public.delete_attendance_session(bigint) from public, anon;
revoke all on function public.void_attendance_session(bigint, text) from public, anon;
revoke all on function public.clear_attendance_status(bigint, uuid) from public, anon;
revoke all on function public.withdraw_attendance_excuse(bigint) from public, anon;
revoke all on function public.set_attendance_thresholds(integer, integer) from public, anon;
grant execute on function public.update_attendance_session(bigint, text, timestamptz) to authenticated;
grant execute on function public.delete_attendance_session(bigint) to authenticated;
grant execute on function public.void_attendance_session(bigint, text) to authenticated;
grant execute on function public.clear_attendance_status(bigint, uuid) to authenticated;
grant execute on function public.withdraw_attendance_excuse(bigint) to authenticated;
grant execute on function public.set_attendance_thresholds(integer, integer) to authenticated;
