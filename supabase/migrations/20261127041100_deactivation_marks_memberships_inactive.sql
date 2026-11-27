-- core-8: deactivating a member marked every membership 'removed', which also
-- means "an executive must add you back". Reactivating a member who was
-- deactivated by mistake therefore left them unable to ask to join even an
-- open group they had been in. Plan 1.7 said "removed"; this changes the
-- decision.
--
-- Deactivation now marks the memberships 'inactive': the same status as
-- leaving a group yourself. While deactivated the person can do nothing (a
-- trigger refuses any write, and refuse_deactivated_membership refuses an
-- active, pending or waitlisted row). After reactivation they can ask to join
-- an open group again (active at once), an approval group (pending) and not an
-- invitation-only one, exactly as someone who left. Leadership roles are still
-- reset: a role is not something to hand back automatically. A membership an
-- executive or manager had deliberately marked 'removed' before the
-- deactivation stays 'removed'.
--
-- Also fixed here: the rows deactivation changes now carry reviewed_by (the
-- administrator) and status_updated_at (the time), and the audit entry lists
-- every group with the membership_role and status the person had, so an
-- administrator can put them back (the audit log is readable by administrators
-- only). groups_removed keeps its meaning, the number of rows changed.
--
-- Members deactivated before this migration keep the 'removed' rows the old
-- function wrote: those rows cannot be told apart from removals made on
-- purpose, so they are not rewritten. An executive adds those people back.
create or replace function public.admin_deactivate_member(p_target_id uuid, p_reason text default '')
returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_email text;
  v_target public.profiles%rowtype;
  v_updated public.profiles%rowtype;
  v_reason text := left(trim(coalesce(p_reason, '')), 500);
  v_previous jsonb;
  v_groups integer;
begin
  if v_actor_id is null or not private.is_admin() then
    raise exception 'Only administrators can deactivate members' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('bharat_sangeet_admin_role_change'));
  if p_target_id = v_actor_id then
    raise exception 'Administrators cannot deactivate themselves' using errcode = '22023';
  end if;
  select email into v_actor_email from public.profiles where id = v_actor_id;
  select * into v_target from public.profiles where id = p_target_id for update;
  if not found then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;
  if v_target.status = 'deactivated' then
    raise exception 'This member is already deactivated' using errcode = '22023';
  end if;
  if v_target.role = 'admin'
     and (select count(*) from public.profiles where role = 'admin' and status = 'active') <= 1 then
    raise exception 'The last administrator cannot be deactivated' using errcode = '22023';
  end if;

  update public.profiles
  set status = 'deactivated'
  where id = p_target_id
  returning * into v_updated;

  insert into public.member_deactivations (member_id, deactivated_at, deactivated_by, reason)
  values (p_target_id, now(), v_actor_id, v_reason)
  on conflict (member_id) do update
    set deactivated_at = excluded.deactivated_at,
        deactivated_by = excluded.deactivated_by,
        reason = excluded.reason;

  select coalesce(jsonb_agg(jsonb_build_object(
           'subgroup_id', membership.subgroup_id,
           'status', membership.status::text,
           'membership_role', membership.membership_role::text) order by membership.subgroup_id), '[]'::jsonb)
    into v_previous
  from public.subgroup_memberships membership
  where membership.member_id = p_target_id and membership.status in ('active', 'pending', 'waitlisted');

  update public.subgroup_memberships
  set status = 'inactive',
      membership_role = 'member',
      reviewed_by = v_actor_id,
      status_updated_at = now()
  where member_id = p_target_id and status in ('active', 'pending', 'waitlisted');
  get diagnostics v_groups = row_count;

  insert into public.admin_audit_log (action, actor_id, actor_email, target_id, target_email, details)
  values ('member_deactivated', v_actor_id, coalesce(v_actor_email, ''), v_target.id, v_target.email,
    jsonb_build_object('role', v_target.role::text, 'full_name', v_target.full_name,
      'reason', v_reason, 'groups_removed', v_groups, 'groups', v_previous));
  return v_updated;
end;
$$;

revoke all on function public.admin_deactivate_member(uuid, text) from public, anon;
grant execute on function public.admin_deactivate_member(uuid, text) to authenticated;
