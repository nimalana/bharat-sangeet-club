-- Subgroup management: enrollment review, roster changes, settings, archiving.
--
-- Who may do what (club executives and admins may do all of it):
--   review a pending or waitlisted request ..... leader, manager
--   remove a plain member ...................... manager
--   rename / edit description .................. manager
--   add a member directly, change enrollment
--   mode, archive or restore ................... executives only
--   leave ...................................... the member themself
--
-- Everything here is additive. Existing functions keep their signatures.

alter table public.subgroups
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null;

create index if not exists subgroups_archived_by_idx
  on public.subgroups(archived_by) where archived_by is not null;

-- `private.is_subgroup_manager` is true for leaders and managers. Some actions
-- are reserved for managers proper.
create or replace function private.is_subgroup_lead_manager(target_subgroup_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.subgroup_memberships membership
    where membership.subgroup_id = target_subgroup_id
      and membership.member_id = (select auth.uid())
      and membership.status = 'active'
      and membership.membership_role = 'manager'
  );
$$;
revoke all on function private.is_subgroup_lead_manager(bigint) from public;
grant execute on function private.is_subgroup_lead_manager(bigint) to authenticated;

-- Review a join request. Unlike review_subgroup_enrollment, this only acts on
-- rows that are actually waiting, so it cannot be used to deactivate a member
-- or another manager.
create or replace function public.review_subgroup_request(
  p_subgroup_id bigint,
  p_member_id uuid,
  p_decision text
)
returns public.subgroup_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.subgroup_memberships;
  next_status public.subgroup_membership_status;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if not (private.is_executive() or private.is_subgroup_manager(p_subgroup_id)) then
    raise exception 'Only group leaders and executives can review requests' using errcode = '42501';
  end if;
  next_status := case p_decision
    when 'approve' then 'active'
    when 'waitlist' then 'waitlisted'
    when 'decline' then 'inactive'
  end;
  if next_status is null then
    raise exception 'Decision must be approve, waitlist, or decline' using errcode = '22023';
  end if;
  if exists (select 1 from public.subgroups where id = p_subgroup_id and archived_at is not null) then
    raise exception 'This group is archived' using errcode = '22023';
  end if;

  update public.subgroup_memberships
  set status = next_status,
      reviewed_by = (select auth.uid()),
      added_by = case when next_status = 'active' then (select auth.uid()) else added_by end,
      status_updated_at = now()
  where subgroup_id = p_subgroup_id
    and member_id = p_member_id
    and status in ('pending', 'waitlisted')
  returning * into result;
  if not found then
    raise exception 'That request is no longer waiting for review' using errcode = 'P0002';
  end if;
  return result;
end;
$$;

create or replace function public.remove_subgroup_member(
  p_subgroup_id bigint,
  p_member_id uuid
)
returns public.subgroup_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.subgroup_memberships;
  result public.subgroup_memberships;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if p_member_id = (select auth.uid()) then
    raise exception 'Use Leave group to remove yourself' using errcode = '22023';
  end if;

  select * into target
  from public.subgroup_memberships
  where subgroup_id = p_subgroup_id and member_id = p_member_id
  for update;
  if not found or target.status in ('inactive', 'removed') then
    raise exception 'That person is not in this group' using errcode = 'P0002';
  end if;

  if not private.is_executive() then
    if not private.is_subgroup_lead_manager(p_subgroup_id) then
      raise exception 'Only group managers and executives can remove members' using errcode = '42501';
    end if;
    if target.membership_role <> 'member' then
      raise exception 'Only executives can remove a group leader or manager' using errcode = '42501';
    end if;
  end if;

  update public.subgroup_memberships
  set status = 'removed',
      membership_role = 'member',
      reviewed_by = (select auth.uid()),
      status_updated_at = now()
  where subgroup_id = p_subgroup_id and member_id = p_member_id
  returning * into result;
  return result;
end;
$$;

create or replace function public.leave_subgroup(p_subgroup_id bigint)
returns public.subgroup_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare result public.subgroup_memberships;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  -- Leaving also withdraws a pending or waitlisted request. Any leadership
  -- role is given up; executives can always manage the group.
  update public.subgroup_memberships
  set status = 'inactive',
      membership_role = 'member',
      status_updated_at = now()
  where subgroup_id = p_subgroup_id
    and member_id = (select auth.uid())
    and status in ('active', 'pending', 'waitlisted')
  returning * into result;
  if not found then
    raise exception 'You are not in this group' using errcode = 'P0002';
  end if;
  return result;
end;
$$;

create or replace function public.add_subgroup_member(
  p_subgroup_id bigint,
  p_member_id uuid
)
returns public.subgroup_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare result public.subgroup_memberships;
begin
  if not private.is_executive() then
    raise exception 'Only executives can add members directly' using errcode = '42501';
  end if;
  if not exists (select 1 from public.subgroups where id = p_subgroup_id and archived_at is null) then
    raise exception 'Group not found or archived' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.profiles where id = p_member_id) then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  insert into public.subgroup_memberships (
    subgroup_id, member_id, added_by, status, membership_role, reviewed_by, status_updated_at
  ) values (
    p_subgroup_id, p_member_id, (select auth.uid()), 'active', 'member', (select auth.uid()), now()
  )
  on conflict (subgroup_id, member_id) do update
    set status = 'active',
        added_by = (select auth.uid()),
        reviewed_by = (select auth.uid()),
        status_updated_at = now()
  returning * into result;
  return result;
end;
$$;

create or replace function public.update_subgroup(
  p_subgroup_id bigint,
  p_name text,
  p_description text default ''
)
returns public.subgroups
language plpgsql
security definer
set search_path = ''
as $$
declare result public.subgroups;
begin
  if not (private.is_executive() or private.is_subgroup_lead_manager(p_subgroup_id)) then
    raise exception 'Only group managers and executives can edit a group' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'A group name is required' using errcode = '22023';
  end if;
  if char_length(btrim(p_name)) > 120 or char_length(coalesce(p_description, '')) > 2000 then
    raise exception 'The name or description is too long' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.subgroups
    where lower(name) = lower(btrim(p_name)) and id <> p_subgroup_id
  ) then
    raise exception 'Another group already uses that name' using errcode = '23505';
  end if;

  update public.subgroups
  set name = btrim(p_name),
      description = btrim(coalesce(p_description, ''))
  where id = p_subgroup_id
  returning * into result;
  if not found then
    raise exception 'Group not found' using errcode = 'P0002';
  end if;
  return result;
end;
$$;

create or replace function public.set_subgroup_enrollment_mode(
  p_subgroup_id bigint,
  p_mode public.subgroup_enrollment_mode
)
returns public.subgroups
language plpgsql
security definer
set search_path = ''
as $$
declare result public.subgroups;
begin
  if not private.is_executive() then
    raise exception 'Only executives can change how members join' using errcode = '42501';
  end if;
  update public.subgroups set enrollment_mode = p_mode
  where id = p_subgroup_id
  returning * into result;
  if not found then
    raise exception 'Group not found' using errcode = 'P0002';
  end if;
  return result;
end;
$$;

create or replace function public.set_subgroup_archived(
  p_subgroup_id bigint,
  p_archived boolean
)
returns public.subgroups
language plpgsql
security definer
set search_path = ''
as $$
declare result public.subgroups;
begin
  if not private.is_executive() then
    raise exception 'Only executives can archive or restore a group' using errcode = '42501';
  end if;
  update public.subgroups
  set archived_at = case when p_archived then coalesce(archived_at, now()) else null end,
      archived_by = case when p_archived then coalesce(archived_by, (select auth.uid())) else null end
  where id = p_subgroup_id
  returning * into result;
  if not found then
    raise exception 'Group not found' using errcode = 'P0002';
  end if;
  return result;
end;
$$;

-- Roster for one group. SECURITY INVOKER on purpose: row-level security on
-- subgroup_memberships decides which rows the caller may see (everyone sees
-- active members; leaders, managers and executives also see requests).
create or replace function public.list_subgroup_roster(p_subgroup_id bigint)
returns table (
  member_id uuid,
  full_name text,
  email text,
  status public.subgroup_membership_status,
  membership_role public.subgroup_membership_role,
  joined_at timestamptz,
  status_updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select membership.member_id, profile.full_name, profile.email, membership.status,
         membership.membership_role, membership.joined_at, membership.status_updated_at
  from public.subgroup_memberships membership
  join public.profiles profile on profile.id = membership.member_id
  where membership.subgroup_id = p_subgroup_id
    and membership.status in ('active', 'pending', 'waitlisted')
  order by membership.status, profile.full_name, membership.member_id;
$$;

-- Same signature as before. New: archived groups and removed members are
-- refused. Everything else behaves as it did.
create or replace function public.request_subgroup_enrollment(target_subgroup_id bigint)
returns public.subgroup_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.subgroups;
  next_status public.subgroup_membership_status;
  result public.subgroup_memberships;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;

  select * into target from public.subgroups where id = target_subgroup_id;
  if not found then raise exception 'subgroup not found'; end if;
  if target.archived_at is not null then raise exception 'This group is archived'; end if;
  if target.enrollment_mode = 'invite' then raise exception 'this subgroup is invitation only'; end if;
  if exists (
    select 1 from public.subgroup_memberships
    where subgroup_id = target_subgroup_id
      and member_id = (select auth.uid())
      and status = 'removed'
  ) then
    raise exception 'You were removed from this group. Ask an executive to add you back.' using errcode = '42501';
  end if;

  next_status := case when target.enrollment_mode = 'open' then 'active' else 'pending' end;
  insert into public.subgroup_memberships (
    subgroup_id, member_id, added_by, requested_by, status, membership_role, status_updated_at
  ) values (
    target_subgroup_id, (select auth.uid()), null, (select auth.uid()), next_status, 'member', now()
  )
  on conflict (subgroup_id, member_id) do update
    set status = case
          when public.subgroup_memberships.status in ('inactive', 'waitlisted') then excluded.status
          else public.subgroup_memberships.status
        end,
        requested_by = (select auth.uid()),
        status_updated_at = case
          when public.subgroup_memberships.status in ('inactive', 'waitlisted') then now()
          else public.subgroup_memberships.status_updated_at
        end
  returning * into result;
  return result;
end;
$$;

-- Same signature as before. Previously this hard-deleted every membership row
-- not in the submitted list, including join requests that were still waiting.
-- Now it marks dropped active memberships as removed and leaves requests alone.
create or replace function public.admin_update_member_profile(
  p_target_id uuid,
  p_full_name text,
  p_phone text default '',
  p_class_year text default '',
  p_specialty text default '',
  p_subgroup_ids bigint[] default '{}'
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_actor_email text;
  v_target public.profiles%rowtype;
  v_updated public.profiles%rowtype;
  v_ids bigint[] := coalesce(p_subgroup_ids, '{}'::bigint[]);
begin
  if v_actor_id is null or not private.is_admin() then
    raise exception 'Only administrators can edit member profiles' using errcode = '42501';
  end if;

  select * into v_target from public.profiles where id = p_target_id;
  if not found then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  select email into v_actor_email from public.profiles where id = v_actor_id;

  update public.profiles
  set full_name = btrim(coalesce(p_full_name, '')),
      phone = btrim(coalesce(p_phone, '')),
      class_year = btrim(coalesce(p_class_year, '')),
      specialty = btrim(coalesce(p_specialty, ''))
  where id = p_target_id
  returning * into v_updated;

  update public.subgroup_memberships
  set status = 'removed',
      membership_role = 'member',
      reviewed_by = v_actor_id,
      status_updated_at = now()
  where member_id = p_target_id
    and status = 'active'
    and not (subgroup_id = any(v_ids));

  insert into public.subgroup_memberships (
    subgroup_id, member_id, added_by, status, membership_role, reviewed_by, status_updated_at
  )
  select selected.subgroup_id, p_target_id, v_actor_id, 'active', 'member', v_actor_id, now()
  from unnest(v_ids) as selected(subgroup_id)
  on conflict (subgroup_id, member_id) do update
    set status = 'active',
        added_by = v_actor_id,
        reviewed_by = v_actor_id,
        status_updated_at = now()
    where public.subgroup_memberships.status <> 'active';

  insert into public.admin_audit_log (
    action, actor_id, actor_email, target_id, target_email, details
  ) values (
    'member_updated', v_actor_id, coalesce(v_actor_email, ''),
    v_target.id, v_target.email,
    jsonb_build_object('full_name', v_updated.full_name, 'subgroup_ids', v_ids)
  );

  return v_updated;
end;
$$;

revoke all on function public.review_subgroup_request(bigint, uuid, text) from public, anon;
revoke all on function public.remove_subgroup_member(bigint, uuid) from public, anon;
revoke all on function public.leave_subgroup(bigint) from public, anon;
revoke all on function public.add_subgroup_member(bigint, uuid) from public, anon;
revoke all on function public.update_subgroup(bigint, text, text) from public, anon;
revoke all on function public.set_subgroup_enrollment_mode(bigint, public.subgroup_enrollment_mode) from public, anon;
revoke all on function public.set_subgroup_archived(bigint, boolean) from public, anon;
revoke all on function public.list_subgroup_roster(bigint) from public, anon;
grant execute on function public.review_subgroup_request(bigint, uuid, text) to authenticated;
grant execute on function public.remove_subgroup_member(bigint, uuid) to authenticated;
grant execute on function public.leave_subgroup(bigint) to authenticated;
grant execute on function public.add_subgroup_member(bigint, uuid) to authenticated;
grant execute on function public.update_subgroup(bigint, text, text) to authenticated;
grant execute on function public.set_subgroup_enrollment_mode(bigint, public.subgroup_enrollment_mode) to authenticated;
grant execute on function public.set_subgroup_archived(bigint, boolean) to authenticated;
grant execute on function public.list_subgroup_roster(bigint) to authenticated;
