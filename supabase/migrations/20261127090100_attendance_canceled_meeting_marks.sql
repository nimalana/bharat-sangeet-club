-- Round 3, item 3: a remediation could be reopened inside a voided meeting.
--
-- 20261127070200 made private.reopen_waived_attendance_remediation put an
-- automatically waived remediation back to pending when its record warrants
-- one again. It never looked at the meeting. The sequence the checker found:
--
--   1. a member is marked absent in a closed meeting (remediation: pending);
--   2. an executive corrects the mark to present (the remediation is waived
--      automatically, "no longer counts");
--   3. the meeting is voided (void_attendance_session: status canceled,
--      counts_toward_metrics false; it waives the pending remediations, and this
--      one is already waived);
--   4. an executive calls set_attendance_status for the same member, absent.
--
-- set_attendance_status had no check on the meeting, so the mark changed inside
-- a canceled meeting, the trigger found the automatic waiver and reopened it, and
-- the executives' follow-up list showed a pending remediation for a meeting that
-- no longer counts. (If the member had no remediation row at all, the insert
-- trigger private.sync_attendance_remediation created a new one the same way.)
--
-- Two changes, so that neither one alone has to be right:
--
--   1. set_attendance_status refuses a canceled meeting with a readable message,
--      the same wording and error code clear_attendance_status already uses
--      (20261126235100): "This meeting was canceled, so its marks cannot be
--      changed". Everything else in the function is unchanged.
--   2. The reopen trigger does nothing for a record whose meeting is canceled, so
--      a write that does not come through the function (a future function, or
--      the table owner) cannot reopen a remediation in a voided meeting either.
--
-- A meeting that is not canceled behaves exactly as before. Safe to run twice.
-- Tests: 73_attendance_canceled_meeting_marks.test.sql, and
-- 71_attendance_remediation_reopen.test.sql keeps covering the normal reopen.

create or replace function private.reopen_waived_attendance_remediation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('absent', 'excused') or (new.status = 'tardy' and new.unexcused_units > 0) then
    -- A voided meeting no longer counts: leave its remediations as they are.
    if exists (select 1 from public.attendance_sessions s where s.id = new.session_id and s.status = 'canceled') then
      return null;
    end if;
    update public.attendance_remediations
    set status = 'pending',
        note = nullif(trim(regexp_replace(note, '\s*Waived automatically: the attendance record no longer counts\.$', '')), ''),
        updated_at = now()
    where session_id = new.session_id
      and member_id = new.member_id
      and status = 'waived'
      and completed_at is null
      and note like '%Waived automatically: the attendance record no longer counts.';
  end if;
  return null;
end;
$$;
revoke all on function private.reopen_waived_attendance_remediation() from public, anon, authenticated;

create or replace function public.set_attendance_status(
  p_session_id bigint,
  p_member_id uuid,
  p_status public.attendance_status,
  p_note text default '',
  p_minutes_late integer default 0
)
returns public.attendance_records language plpgsql security definer set search_path = '' as $$
declare result public.attendance_records;
begin
  if not private.is_executive() then raise exception 'executive permission required' using errcode = '42501'; end if;
  if exists (select 1 from public.attendance_sessions where id = p_session_id and status = 'canceled') then
    raise exception 'This meeting was canceled, so its marks cannot be changed' using errcode = '22023';
  end if;
  if p_status = 'tardy' and (p_minutes_late < 0 or p_minutes_late > 1440) then raise exception 'minutes late must be between 0 and 1440'; end if;
  if not exists (select 1 from public.attendance_session_participants where session_id = p_session_id and member_id = p_member_id) then raise exception 'member is not in this session'; end if;
  insert into public.attendance_records(session_id, member_id, status, source, note, marked_by, marked_at, minutes_late)
  values (p_session_id, p_member_id, p_status, 'executive', nullif(trim(p_note), ''), auth.uid(), now(), case when p_status = 'tardy' then p_minutes_late else 0 end)
  on conflict (session_id, member_id) do update set
    status = excluded.status,
    source = 'executive',
    note = excluded.note,
    marked_by = auth.uid(),
    marked_at = now(),
    minutes_late = excluded.minutes_late,
    updated_at = now()
  returning * into result;
  return result;
end;
$$;
revoke all on function public.set_attendance_status(bigint, uuid, public.attendance_status, text, integer) from public, anon;
grant execute on function public.set_attendance_status(bigint, uuid, public.attendance_status, text, integer) to authenticated;
