-- Phase 4.3, P1-01: a former member of a group loses that group's attendance history.
--
-- RELEASE ORDER: safe to apply BEFORE the new frontend (section "Apply before the new frontend" of
-- docs/RELEASE_ORDER.md). Nothing the deployed screens do for an active member changes. What changes is
-- for a person whose membership of a group is no longer `active` (removed by a manager, left, or made
-- inactive by a deactivation): the group's meetings, marks, absence forms and follow-up items are no
-- longer returned to them.
--
-- What was open (register P1-01, confirmed live): the five "own" read policies on the attendance tables
-- only compared `member_id = auth.uid()` (and, for sessions, "I am on the roster snapshot"). A
-- snapshot row is never removed, so a person removed from a group could keep reading that group's
-- meetings and their own marks, absence forms (with the reason they wrote and the reviewer's note) and
-- follow-up assignments for ever. The read functions get_attendance_workspace, get_attendance_overview,
-- get_attendance_pulse and get_attendance_roster are SECURITY INVOKER, so they follow the policies and
-- needed no change (proved per function in 77_former_member_reads.test.sql).
--
-- The rule, in one place: a member can see a meeting (and the rows that hang off it: roster row, mark,
-- absence form, follow-up item, proof file) when they are on its roster snapshot AND the meeting is
-- club-wide, or its group is one they are an ACTIVE member of now. Executives see everything, as before.
-- It is state based: a person who is added back sees the old history again, a person who is removed
-- stops seeing it from that moment.
--
-- What a former member keeps, on purpose (the register leaves the retention question open, "unless an
-- explicit retention policy permits a limited personal summary"; none was decided, so none is built):
--   * club-wide meetings, marks, forms and follow-up items: they are not group scoped, the person is
--     still a member of the club;
--   * attendance_eligibility (a per-term, club-wide standing, not tied to a group);
--   * their own membership row (so the screen can say "removed"); the active roster stays visible to
--     every member as the directory it is by design ("Members view subgroup directory tags");
--   * the recordings and notation files they uploaded themselves (their own work, see 20261128030000).
-- Executives can still read all of it, so a dispute can be settled by one.
--
-- The one function this rests on is private.my_attendance_session_ids(): the meetings the caller may
-- see, as an array, computed once per statement (an InitPlan, like private.my_active_subgroup_ids()).
-- That keeps the policies cheap (measured, see the report) and avoids a policy cycle between
-- attendance_sessions and attendance_session_participants: the function is SECURITY DEFINER and reads
-- both tables without row level security.
--
-- Write side, the same rule: check_in_attendance and submit_attendance_excuse refused a person who was
-- not on the roster snapshot; they now also refuse a person who is on it but no longer in the group
-- (a member removed after a meeting opened could otherwise still check in, or file a form for a
-- meeting of a group they left). Both are CREATE OR REPLACE of the current bodies with that one line
-- changed; every other statement is as it was.
--
-- Storage: the proof image of an absence form lives at attendance-excuses/<member>/<meeting>/<file>.
-- The owner rule now also needs the meeting to be one the person may see; an object whose second
-- folder is not a meeting number (a hand-made path) keeps the old owner rule.
--
-- Safe to run twice. Tests: 77_former_member_reads.test.sql.

create or replace function private.my_attendance_session_ids()
returns bigint[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(meeting.id), '{}'::bigint[])
  from public.attendance_session_participants participant
  join public.attendance_sessions meeting on meeting.id = participant.session_id
  where participant.member_id = (select auth.uid())
    and (
      meeting.scope = 'club'
      or meeting.subgroup_id = any ((select private.my_active_subgroup_ids())::bigint[])
    );
$$;
revoke all on function private.my_attendance_session_ids() from public, anon;
grant execute on function private.my_attendance_session_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- Table policies (same names, same commands, same roles)
-- ---------------------------------------------------------------------------
drop policy if exists "Members view eligible attendance sessions" on public.attendance_sessions;
create policy "Members view eligible attendance sessions"
on public.attendance_sessions for select to authenticated
using (
  (select private.is_executive())
  or id = any ((select private.my_attendance_session_ids())::bigint[])
);

drop policy if exists "Members view attendance participation" on public.attendance_session_participants;
create policy "Members view attendance participation"
on public.attendance_session_participants for select to authenticated
using (
  (select private.is_executive())
  or (member_id = (select auth.uid()) and session_id = any ((select private.my_attendance_session_ids())::bigint[]))
);

drop policy if exists "Members view own attendance records" on public.attendance_records;
create policy "Members view own attendance records"
on public.attendance_records for select to authenticated
using (
  (select private.is_executive())
  or (member_id = (select auth.uid()) and session_id = any ((select private.my_attendance_session_ids())::bigint[]))
);

drop policy if exists "Members view own excuses" on public.attendance_excuses;
create policy "Members view own excuses"
on public.attendance_excuses for select to authenticated
using (
  (select private.is_executive())
  or (member_id = (select auth.uid()) and session_id = any ((select private.my_attendance_session_ids())::bigint[]))
);

drop policy if exists "Members view own attendance remediation" on public.attendance_remediations;
create policy "Members view own attendance remediation"
on public.attendance_remediations for select to authenticated
using (
  (select private.is_executive())
  or (member_id = (select auth.uid()) and session_id = any ((select private.my_attendance_session_ids())::bigint[]))
);

-- ---------------------------------------------------------------------------
-- Storage: the proof image of an absence form
-- ---------------------------------------------------------------------------
drop policy if exists "Members read permitted attendance excuse proof" on storage.objects;
create policy "Members read permitted attendance excuse proof"
on storage.objects for select to authenticated
using (
  bucket_id = 'attendance-excuses'
  and (
    (select private.is_executive())
    or (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and case
        when (storage.foldername(name))[2] ~ '^[0-9]{1,18}$'
          then ((storage.foldername(name))[2])::bigint = any ((select private.my_attendance_session_ids())::bigint[])
        else true
      end
    )
  )
);

-- ---------------------------------------------------------------------------
-- Write side: the current bodies, with the roster check made membership-aware
-- ---------------------------------------------------------------------------
create or replace function public.check_in_attendance(p_code text)
returns public.attendance_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.attendance_sessions;
  result public.attendance_records;
  checkin_status public.attendance_status;
  late_minutes integer;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '42501'; end if;
  select * into target
  from public.attendance_sessions
  where status = 'open'
    and code_expires_at > now()
    and code_hash = extensions.crypt(trim(p_code), code_hash)
  order by opened_at desc limit 1;
  if not found then raise exception 'The code is invalid or has expired'; end if;
  -- On the roster snapshot AND, for a group meeting, still an active member of the group.
  if not (target.id = any ((select private.my_attendance_session_ids())::bigint[])) then raise exception 'You are not eligible for this meeting' using errcode = '42501'; end if;

  late_minutes := greatest(0, ceil(extract(epoch from (now() - target.starts_at)) / 60.0)::integer);
  checkin_status := case when late_minutes > 0 then 'tardy'::public.attendance_status else 'present'::public.attendance_status end;
  insert into public.attendance_records(session_id, member_id, status, source, note, marked_by, marked_at, minutes_late)
  values (target.id, auth.uid(), checkin_status, 'self_check_in', case when checkin_status = 'tardy' then 'Checked in late with meeting code' else 'Checked in with meeting code' end, auth.uid(), now(), late_minutes)
  on conflict (session_id, member_id) do update set
    status = excluded.status,
    source = 'self_check_in',
    note = excluded.note,
    marked_by = auth.uid(),
    marked_at = now(),
    minutes_late = excluded.minutes_late,
    updated_at = now()
  returning * into result;
  return result;
end;
$$;

create or replace function public.submit_attendance_excuse(
  p_session_id bigint,
  p_reason text,
  p_proof_path text default null,
  p_reason_category text default 'other',
  p_notified_at timestamptz default null
)
returns public.attendance_excuses
language plpgsql
security definer
set search_path = ''
as $$
declare result public.attendance_excuses;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if p_reason_category not in ('class_exam', 'family_emergency', 'illness', 'other_club_event', 'other') then raise exception 'invalid absence category'; end if;
  -- On the roster snapshot AND, for a group meeting, still an active member of the group.
  if not (p_session_id = any ((select private.my_attendance_session_ids())::bigint[])) then raise exception 'You were not on this meeting roster'; end if;
  if exists (select 1 from public.attendance_sessions where id = p_session_id and status = 'canceled') then raise exception 'Canceled meetings do not accept absence forms'; end if;
  if p_proof_path is not null and split_part(p_proof_path, '/', 1) <> auth.uid()::text then raise exception 'invalid proof path' using errcode = '42501'; end if;
  insert into public.attendance_excuses(session_id, member_id, reason, proof_path, reason_category, notified_at, status)
  values (p_session_id, auth.uid(), trim(p_reason), p_proof_path, p_reason_category, p_notified_at, 'pending')
  on conflict (session_id, member_id) do update set
    reason = excluded.reason,
    proof_path = excluded.proof_path,
    reason_category = excluded.reason_category,
    notified_at = excluded.notified_at,
    status = 'pending',
    submitted_at = now(),
    reviewed_by = null,
    reviewed_at = null,
    review_note = null
  returning * into result;
  return result;
end;
$$;

-- CREATE OR REPLACE keeps the function's privileges; stated again so a re-run on a database where
-- they drifted ends in the same place (EXECUTE for signed-in users only).
revoke all on function public.check_in_attendance(text) from public, anon;
grant execute on function public.check_in_attendance(text) to authenticated;
revoke all on function public.submit_attendance_excuse(bigint, text, text, text, timestamptz) from public, anon;
grant execute on function public.submit_attendance_excuse(bigint, text, text, text, timestamptz) to authenticated;
