-- core-7 (attendance side): an archived group should not get new attendance
-- meetings.
--
-- create_attendance_session (20260813000000) checks only that the group
-- exists, so an executive could still create a meeting for an archived group
-- and, through open_attendance_session, open it. Archiving is newer than that
-- function and it never learned about it.
--
-- This is a trigger on attendance_sessions rather than a new version of the
-- two functions: it also covers a direct insert by an executive (the table
-- grants allow one), and it leaves the attendance functions, which other work
-- changes, untouched. Meetings that already exist keep working: a meeting that
-- is open when its group is archived can still be closed or canceled, and the
-- group's history stays readable. Only creating a meeting, or opening a draft,
-- for an archived group is refused.
create or replace function private.refuse_archived_subgroup_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.subgroup_id is not null
     and (tg_op = 'INSERT' or (new.status = 'open' and old.status is distinct from 'open'))
     and exists (select 1 from public.subgroups where id = new.subgroup_id and archived_at is not null) then
    raise exception 'This group is archived. Restore it before running attendance for it.' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.refuse_archived_subgroup_session() from public, anon, authenticated;

drop trigger if exists refuse_archived_subgroup_session on public.attendance_sessions;
create trigger refuse_archived_subgroup_session
  before insert or update of status on public.attendance_sessions
  for each row execute function private.refuse_archived_subgroup_session();
