-- Member deactivation (P0-03).
--
-- admin_delete_member fails for anyone with finance or recording history, so
-- admins had no way to remove access for most real members. Deactivation keeps
-- the history and removes the access. It is enforced here, in the database:
--
--   1. is_admin / is_executive / is_subgroup_manager require an active profile.
--   2. A restrictive policy on every public table and on storage.objects hides
--      everything from a deactivated account (it may still read its own
--      profile row so the app can explain what happened).
--   3. A statement trigger on every public table refuses writes made by a
--      deactivated account, including writes made through security definer
--      functions, which bypass policies.
--
-- Existing sessions are not revoked (decision D2): a deactivated member's
-- token stays valid until it expires but can no longer read or write anything.

alter table public.profiles
  add column if not exists status text not null default 'active',
  add column if not exists deactivated_at timestamptz,
  add column if not exists deactivated_by uuid references public.profiles(id) on delete set null,
  add column if not exists deactivation_reason text not null default '';

alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check check (status in ('active', 'deactivated'));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.is_active_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and status = 'active'
  );
$$;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin' and status = 'active'
  );
$$;

create or replace function private.is_executive()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('executive', 'admin') and status = 'active'
  );
$$;

create or replace function private.is_subgroup_manager(target_subgroup_id bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_active_member() and exists (
    select 1 from public.subgroup_memberships membership
    where membership.subgroup_id = target_subgroup_id
      and membership.member_id = (select auth.uid())
      and membership.status = 'active'
      and membership.membership_role in ('leader', 'manager')
  );
$$;

create or replace function private.is_subgroup_lead_manager(target_subgroup_id bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_active_member() and exists (
    select 1 from public.subgroup_memberships membership
    where membership.subgroup_id = target_subgroup_id
      and membership.member_id = (select auth.uid())
      and membership.status = 'active'
      and membership.membership_role = 'manager'
  );
$$;

revoke all on function private.is_active_member() from public, anon;
grant execute on function private.is_active_member() to authenticated;

create or replace function private.block_deactivated_writer()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is not null and exists (
    select 1 from public.profiles where id = (select auth.uid()) and status = 'deactivated'
  ) then
    raise exception 'Your access to the portal has been deactivated' using errcode = '42501';
  end if;
  return null;
end;
$$;
revoke all on function private.block_deactivated_writer() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Apply the policy and the trigger to every table that exists right now.
-- New tables must add both; supabase/tests/20_deactivation.test.sql fails if
-- one is missing.
-- ---------------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in
    select c.oid::regclass as rel, c.relname
    from pg_catalog.pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  loop
    execute format('drop policy if exists "Active members only" on %s', t.rel);
    if t.relname = 'profiles' then
      execute format(
        'create policy "Active members only" on %s as restrictive for all to authenticated
           using (id = (select auth.uid()) or (select private.is_active_member()))
           with check ((select private.is_active_member()))', t.rel);
    else
      execute format(
        'create policy "Active members only" on %s as restrictive for all to authenticated
           using ((select private.is_active_member()))
           with check ((select private.is_active_member()))', t.rel);
    end if;
    execute format('drop trigger if exists block_deactivated_writer on %s', t.rel);
    execute format(
      'create trigger block_deactivated_writer before insert or update or delete on %s
         for each statement execute function private.block_deactivated_writer()', t.rel);
  end loop;
end;
$$;

drop policy if exists "Active members only" on storage.objects;
create policy "Active members only" on storage.objects as restrictive for all to authenticated
  using ((select private.is_active_member()))
  with check ((select private.is_active_member()));

-- ---------------------------------------------------------------------------
-- Audit log: new actions
-- ---------------------------------------------------------------------------
alter table public.admin_audit_log drop constraint if exists admin_audit_log_action_check;
alter table public.admin_audit_log add constraint admin_audit_log_action_check
  check (action in ('role_changed', 'member_deleted', 'member_updated', 'member_deactivated', 'member_reactivated'));

-- ---------------------------------------------------------------------------
-- Deactivate / reactivate
-- ---------------------------------------------------------------------------
create or replace function public.admin_deactivate_member(p_target_id uuid, p_reason text default '')
returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_email text;
  v_target public.profiles%rowtype;
  v_updated public.profiles%rowtype;
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
  set status = 'deactivated', deactivated_at = now(), deactivated_by = v_actor_id,
      deactivation_reason = left(trim(coalesce(p_reason, '')), 500)
  where id = p_target_id
  returning * into v_updated;

  update public.subgroup_memberships
  set status = 'removed', membership_role = 'member'
  where member_id = p_target_id and status in ('active', 'pending', 'waitlisted');
  get diagnostics v_groups = row_count;

  insert into public.admin_audit_log (action, actor_id, actor_email, target_id, target_email, details)
  values ('member_deactivated', v_actor_id, coalesce(v_actor_email, ''), v_target.id, v_target.email,
    jsonb_build_object('role', v_target.role::text, 'full_name', v_target.full_name,
      'reason', v_updated.deactivation_reason, 'groups_removed', v_groups));
  return v_updated;
end;
$$;

create or replace function public.admin_reactivate_member(p_target_id uuid)
returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_email text;
  v_target public.profiles%rowtype;
  v_updated public.profiles%rowtype;
begin
  if v_actor_id is null or not private.is_admin() then
    raise exception 'Only administrators can reactivate members' using errcode = '42501';
  end if;
  select email into v_actor_email from public.profiles where id = v_actor_id;
  select * into v_target from public.profiles where id = p_target_id for update;
  if not found then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;
  if v_target.status = 'active' then
    raise exception 'This member is already active' using errcode = '22023';
  end if;

  -- Group memberships are not restored: an executive adds the member back to
  -- the groups they should be in.
  update public.profiles
  set status = 'active', deactivated_at = null, deactivated_by = null, deactivation_reason = ''
  where id = p_target_id
  returning * into v_updated;

  insert into public.admin_audit_log (action, actor_id, actor_email, target_id, target_email, details)
  values ('member_reactivated', v_actor_id, coalesce(v_actor_email, ''), v_target.id, v_target.email,
    jsonb_build_object('role', v_target.role::text, 'full_name', v_target.full_name));
  return v_updated;
end;
$$;

revoke all on function public.admin_deactivate_member(uuid, text) from public, anon;
revoke all on function public.admin_reactivate_member(uuid) from public, anon;
grant execute on function public.admin_deactivate_member(uuid, text) to authenticated;
grant execute on function public.admin_reactivate_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Last-administrator protection counts active administrators only, and
-- deleting gives a readable message when history blocks it.
-- ---------------------------------------------------------------------------
create or replace function public.admin_change_member_role(p_target_id uuid, p_new_role public.club_role)
returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_email text;
  v_target public.profiles%rowtype;
  v_updated public.profiles%rowtype;
begin
  if v_actor_id is null or not private.is_admin() then
    raise exception 'Only administrators can change member roles' using errcode = '42501';
  end if;

  -- Serialize role changes so two admins cannot simultaneously remove the
  -- final two administrator roles.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('bharat_sangeet_admin_role_change'));

  select email into v_actor_email from public.profiles where id = v_actor_id;
  select * into v_target from public.profiles where id = p_target_id;
  if not found then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  if p_target_id = v_actor_id and p_new_role <> 'admin' then
    raise exception 'Administrators cannot demote themselves' using errcode = '22023';
  end if;

  if v_target.role = 'admin' and p_new_role <> 'admin' and v_target.status = 'active'
     and (select count(*) from public.profiles where role = 'admin' and status = 'active') <= 1 then
    raise exception 'The last administrator cannot be demoted' using errcode = '22023';
  end if;

  update public.profiles set role = p_new_role where id = p_target_id returning * into v_updated;

  if v_target.role is distinct from v_updated.role then
    insert into public.admin_audit_log (action, actor_id, actor_email, target_id, target_email, details)
    values ('role_changed', v_actor_id, coalesce(v_actor_email, ''), v_target.id, v_target.email,
      jsonb_build_object('previous_role', v_target.role::text, 'new_role', v_updated.role::text));
  end if;
  return v_updated;
end;
$$;

create or replace function public.admin_delete_member(p_target_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_email text;
  v_target public.profiles%rowtype;
begin
  if v_actor_id is null or not private.is_admin() then
    raise exception 'Only administrators can remove members' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('bharat_sangeet_admin_role_change'));

  if p_target_id = v_actor_id then
    raise exception 'Administrators cannot delete themselves' using errcode = '22023';
  end if;

  select email into v_actor_email from public.profiles where id = v_actor_id;
  select * into v_target from public.profiles where id = p_target_id;
  if not found then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  if v_target.role = 'admin' and v_target.status = 'active'
     and (select count(*) from public.profiles where role = 'admin' and status = 'active') <= 1 then
    raise exception 'The last administrator cannot be deleted' using errcode = '22023';
  end if;

  insert into public.admin_audit_log (action, actor_id, actor_email, target_id, target_email, details)
  values ('member_deleted', v_actor_id, coalesce(v_actor_email, ''), v_target.id, v_target.email,
    jsonb_build_object('role', v_target.role::text, 'full_name', v_target.full_name));

  -- Deleting auth.users cascades to public.profiles. Records that must be
  -- kept (reimbursements, receipts, recordings) block the delete.
  begin
    delete from auth.users where id = p_target_id;
    if not found then
      raise exception 'Could not remove the member authentication account' using errcode = 'P0002';
    end if;
  exception when foreign_key_violation or restrict_violation or check_violation or not_null_violation then
    raise exception 'This member has finance or recording history, so the account cannot be deleted. Deactivate it instead.'
      using errcode = '23503';
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Club-wide attendance sessions take their roster from active members only,
-- so deactivated members stop collecting absences.
-- ---------------------------------------------------------------------------
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
    select target.id, profiles.id from public.profiles as profiles
    where profiles.status = 'active'
    on conflict do nothing;
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

-- ---------------------------------------------------------------------------
-- A deactivated member cannot be added to, or request, a group.
-- ---------------------------------------------------------------------------
create or replace function private.refuse_deactivated_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('active', 'pending', 'waitlisted') and exists (
    select 1 from public.profiles where id = new.member_id and status = 'deactivated'
  ) then
    raise exception 'This member is deactivated. Reactivate the account before adding it to a group.' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.refuse_deactivated_membership() from public, anon, authenticated;

drop trigger if exists refuse_deactivated_membership on public.subgroup_memberships;
create trigger refuse_deactivated_membership
  before insert or update of status on public.subgroup_memberships
  for each row execute function private.refuse_deactivated_membership();
