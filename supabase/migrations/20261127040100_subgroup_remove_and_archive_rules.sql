-- core-5 and core-7 (group side): who may remove a person, and what an archived
-- group still accepts.
--
-- core-5. remove_subgroup_member accepted a pending or waitlisted request and
-- marked it removed. That is a stronger block than declining (a declined
-- person can ask again, a removed one needs an executive), reached without the
-- review that declining goes through. Removal now applies to people who are in
-- the group (active) or have left it (inactive: left on their own, or declined
-- earlier). Requests that are still waiting are declined with
-- review_subgroup_request.
--
-- core-7. An archived group is hidden and refuses new members. It also refuses
-- changes by its managers. Executives can still administer it, since they can
-- restore it anyway:
--   * update_subgroup and remove_subgroup_member refuse non-executives.
--   * review_subgroup_request still declines a request that is waiting when the
--     group was archived (it would otherwise sit there until a restore), but
--     approving or waitlisting is refused.
--   * admin_update_member_profile does not add anyone to an archived group, and
--     it no longer marks a member removed from an archived group just because the
--     admin editor, which lists only live groups, did not send that group's id.
--     (Before, saving any profile edit removed the member from every archived
--     group, and a restore did not bring them back.)
-- Attendance sessions in archived groups are refused by a trigger in
-- 20261127042000, so that function stays untouched.

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
  if not found or target.status = 'removed' then
    raise exception 'That person is not in this group' using errcode = 'P0002';
  end if;
  if target.status in ('pending', 'waitlisted') then
    raise exception 'That person is waiting for review. Decline the request instead of removing them.' using errcode = '22023';
  end if;

  if not private.is_executive() then
    if not private.is_subgroup_lead_manager(p_subgroup_id) then
      raise exception 'Only group managers and executives can remove members' using errcode = '42501';
    end if;
    if exists (select 1 from public.subgroups where id = p_subgroup_id and archived_at is not null) then
      raise exception 'This group is archived. An executive can restore it first.' using errcode = '22023';
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
  if not private.is_executive() and exists (
    select 1 from public.subgroups where id = p_subgroup_id and archived_at is not null
  ) then
    raise exception 'This group is archived. An executive can restore it first.' using errcode = '22023';
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
  -- A request that is still waiting when its group is archived can be declined,
  -- but not approved or waitlisted.
  if p_decision <> 'decline' and exists (
    select 1 from public.subgroups where id = p_subgroup_id and archived_at is not null
  ) then
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

  -- Archived groups (and ids that are not groups) cannot take new members.
  -- Asking for an archived group the member is already active in is harmless
  -- and changes nothing.
  if exists (
    select 1
    from unnest(v_ids) as selected(subgroup_id)
    left join public.subgroups g on g.id = selected.subgroup_id
    where (g.id is null or g.archived_at is not null)
      and not exists (
        select 1 from public.subgroup_memberships m
        where m.subgroup_id = selected.subgroup_id and m.member_id = p_target_id and m.status = 'active'
      )
  ) then
    raise exception 'Group not found or archived' using errcode = 'P0002';
  end if;

  select email into v_actor_email from public.profiles where id = v_actor_id;

  update public.profiles
  set full_name = btrim(coalesce(p_full_name, '')),
      phone = btrim(coalesce(p_phone, '')),
      class_year = btrim(coalesce(p_class_year, '')),
      specialty = btrim(coalesce(p_specialty, ''))
  where id = p_target_id
  returning * into v_updated;

  -- Memberships in archived groups are left as they are: the editor only lists
  -- live groups, so their absence from the list does not mean "remove".
  update public.subgroup_memberships membership
  set status = 'removed',
      membership_role = 'member',
      reviewed_by = v_actor_id,
      status_updated_at = now()
  where membership.member_id = p_target_id
    and membership.status = 'active'
    and not (membership.subgroup_id = any (v_ids))
    and not exists (
      select 1 from public.subgroups g
      where g.id = membership.subgroup_id and g.archived_at is not null
    );

  insert into public.subgroup_memberships (
    subgroup_id, member_id, added_by, status, membership_role, reviewed_by, status_updated_at
  )
  select selected.subgroup_id, p_target_id, v_actor_id, 'active', 'member', v_actor_id, now()
  from unnest(v_ids) as selected(subgroup_id)
  where exists (
    select 1 from public.subgroups g where g.id = selected.subgroup_id and g.archived_at is null
  )
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

-- create or replace keeps the existing grants; state them again so this file
-- is correct on its own, including on hosted default privileges.
revoke all on function public.remove_subgroup_member(bigint, uuid) from public, anon;
revoke all on function public.update_subgroup(bigint, text, text) from public, anon;
revoke all on function public.review_subgroup_request(bigint, uuid, text) from public, anon;
revoke all on function public.admin_update_member_profile(uuid, text, text, text, text, bigint[]) from public, anon;
grant execute on function public.remove_subgroup_member(bigint, uuid) to authenticated;
grant execute on function public.update_subgroup(bigint, text, text) to authenticated;
grant execute on function public.review_subgroup_request(bigint, uuid, text) to authenticated;
grant execute on function public.admin_update_member_profile(uuid, text, text, text, text, bigint[]) to authenticated;
