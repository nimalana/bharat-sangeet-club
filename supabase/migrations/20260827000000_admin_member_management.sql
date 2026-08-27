-- Give administrators one atomic operation for maintaining member profiles and
-- active subgroup assignments from the portal.

alter table public.admin_audit_log
  drop constraint if exists admin_audit_log_action_check;

alter table public.admin_audit_log
  add constraint admin_audit_log_action_check
  check (action in ('role_changed', 'member_deleted', 'member_updated'));

-- Members may see active subgroup tags in the signed-in directory. Pending
-- requests remain visible only to their requester, managers, and executives.
drop policy if exists "Members view own subgroup memberships" on public.subgroup_memberships;
create policy "Members view subgroup directory tags"
on public.subgroup_memberships for select to authenticated
using (
  member_id = (select auth.uid())
  or status = 'active'
  or private.is_executive()
);

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
begin
  if v_actor_id is null or not private.is_admin() then
    raise exception 'Only administrators can edit member profiles' using errcode = '42501';
  end if;

  select * into v_target
  from public.profiles
  where id = p_target_id;

  if not found then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  select email into v_actor_email
  from public.profiles
  where id = v_actor_id;

  update public.profiles
  set full_name = btrim(coalesce(p_full_name, '')),
      phone = btrim(coalesce(p_phone, '')),
      class_year = btrim(coalesce(p_class_year, '')),
      specialty = btrim(coalesce(p_specialty, ''))
  where id = p_target_id
  returning * into v_updated;

  delete from public.subgroup_memberships
  where member_id = p_target_id
    and not (subgroup_id = any(coalesce(p_subgroup_ids, '{}'::bigint[])));

  insert into public.subgroup_memberships (
    subgroup_id, member_id, added_by, status, membership_role, reviewed_by, status_updated_at
  )
  select subgroup_id, p_target_id, v_actor_id, 'active', 'member', v_actor_id, now()
  from unnest(coalesce(p_subgroup_ids, '{}'::bigint[])) as selected(subgroup_id)
  on conflict (subgroup_id, member_id) do update
    set status = 'active',
        added_by = v_actor_id,
        reviewed_by = v_actor_id,
        status_updated_at = now();

  insert into public.admin_audit_log (
    action, actor_id, actor_email, target_id, target_email, details
  ) values (
    'member_updated', v_actor_id, coalesce(v_actor_email, ''),
    v_target.id, v_target.email,
    jsonb_build_object(
      'full_name', v_updated.full_name,
      'subgroup_ids', coalesce(p_subgroup_ids, '{}'::bigint[])
    )
  );

  return v_updated;
end;
$$;

revoke all on function public.admin_update_member_profile(uuid, text, text, text, text, bigint[]) from public;
revoke all on function public.admin_update_member_profile(uuid, text, text, text, text, bigint[]) from anon;
grant execute on function public.admin_update_member_profile(uuid, text, text, text, text, bigint[]) to authenticated;
