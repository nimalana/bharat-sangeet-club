create or replace function public.check_in_attendance(p_code text)
returns public.attendance_records language plpgsql security definer set search_path = '' as $$
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
  if not exists (select 1 from public.attendance_session_participants where session_id = target.id and member_id = auth.uid()) then raise exception 'You are not eligible for this meeting' using errcode = '42501'; end if;

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
revoke all on function public.check_in_attendance(text) from public, anon;
grant execute on function public.check_in_attendance(text) to authenticated;
