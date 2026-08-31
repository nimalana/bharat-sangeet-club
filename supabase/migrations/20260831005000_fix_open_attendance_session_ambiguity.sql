-- Qualify session_id references so they cannot collide with the RPC output column.
create or replace function public.open_attendance_session(p_session_id bigint, p_duration_minutes integer default 60)
returns table(session_id bigint, check_in_code text, code_expires_at timestamptz, eligible_count integer)
language plpgsql security definer set search_path = '' as $$
declare target public.attendance_sessions; generated_code text;
begin
  if not private.is_executive() then raise exception 'executive permission required' using errcode = '42501'; end if;
  if p_duration_minutes not between 5 and 240 then raise exception 'duration must be between 5 and 240 minutes'; end if;
  select * into target from public.attendance_sessions as sessions where sessions.id = p_session_id for update;
  if not found or target.status not in ('draft','open') then raise exception 'session cannot be opened'; end if;
  if exists (
    select 1 from public.attendance_sessions as sessions
    where sessions.status = 'open'
      and sessions.scope = target.scope
      and coalesce(sessions.subgroup_id, 0) = coalesce(target.subgroup_id, 0)
      and sessions.id <> target.id
  ) then raise exception 'this workspace already has an open attendance session'; end if;
  delete from public.attendance_session_participants as participants
  where participants.session_id = target.id and target.status = 'draft';
  if target.scope = 'club' then
    insert into public.attendance_session_participants(session_id, member_id)
    select target.id, profiles.id from public.profiles as profiles on conflict do nothing;
  else
    insert into public.attendance_session_participants(session_id, member_id)
    select target.id, memberships.member_id
    from public.subgroup_memberships as memberships
    where memberships.subgroup_id = target.subgroup_id and memberships.status = 'active'
    on conflict do nothing;
  end if;
  generated_code := private.attendance_code();
  update public.attendance_sessions
  set status = 'open',
      opened_at = coalesce(opened_at, now()),
      closes_at = now() + make_interval(mins => p_duration_minutes),
      code_expires_at = now() + make_interval(mins => p_duration_minutes),
      code_hash = extensions.crypt(generated_code, extensions.gen_salt('bf')),
      roster_count = (
        select count(*)
        from public.attendance_session_participants as participants
        where participants.session_id = target.id
      ),
      counts_toward_metrics = true
  where id = target.id;
  return query
  select sessions.id, generated_code, sessions.code_expires_at, sessions.roster_count
  from public.attendance_sessions as sessions
  where sessions.id = target.id;
end;
$$;
