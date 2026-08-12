-- Flexible subgroup enrollment and subgroup-scoped permissions.
-- Existing subgroups remain invite-only and existing memberships remain active.
create type public.subgroup_enrollment_mode as enum ('open', 'approval', 'invite');
create type public.subgroup_membership_status as enum ('active', 'pending', 'waitlisted', 'inactive');
create type public.subgroup_membership_role as enum ('member', 'leader', 'manager');

alter table public.subgroups
  add column enrollment_mode public.subgroup_enrollment_mode not null default 'invite';

alter table public.subgroup_memberships
  add column status public.subgroup_membership_status not null default 'active',
  add column membership_role public.subgroup_membership_role not null default 'member',
  add column requested_by uuid references public.profiles(id) on delete set null,
  add column reviewed_by uuid references public.profiles(id) on delete set null,
  add column status_updated_at timestamptz not null default now();

create index subgroup_memberships_active_member_idx
  on public.subgroup_memberships(member_id, subgroup_id)
  where status = 'active';
create index subgroup_memberships_pending_group_idx
  on public.subgroup_memberships(subgroup_id, joined_at)
  where status in ('pending', 'waitlisted');

create or replace function private.is_subgroup_manager(target_subgroup_id bigint)
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
      and membership.membership_role in ('leader', 'manager')
  );
$$;
revoke all on function private.is_subgroup_manager(bigint) from public;
grant execute on function private.is_subgroup_manager(bigint) to authenticated;

-- Members can discover subgroup names and enrollment modes. Access to subgroup
-- resources, rosters, and attendance remains scoped separately below.
drop policy if exists "Members view assigned subgroups" on public.subgroups;
create policy "Signed-in members discover subgroups"
on public.subgroups for select to authenticated using (true);

create policy "Managers view their subgroup roster"
on public.subgroup_memberships for select to authenticated
using (private.is_subgroup_manager(subgroup_id));

drop policy if exists "Members view their subgroup sessions" on public.attendance_sessions;
create policy "Members view active subgroup sessions"
on public.attendance_sessions for select to authenticated using (
  private.is_executive() or exists (
    select 1 from public.subgroup_memberships membership
    where membership.subgroup_id = attendance_sessions.subgroup_id
      and membership.member_id = (select auth.uid())
      and membership.status = 'active'
  )
);
create policy "Managers manage their subgroup sessions"
on public.attendance_sessions for all to authenticated
using (private.is_subgroup_manager(subgroup_id))
with check (private.is_subgroup_manager(subgroup_id));

create policy "Managers manage their subgroup attendance"
on public.attendance_records for all to authenticated
using (
  exists (
    select 1 from public.attendance_sessions session
    where session.id = attendance_records.session_id
      and private.is_subgroup_manager(session.subgroup_id)
  )
)
with check (
  exists (
    select 1 from public.attendance_sessions session
    where session.id = attendance_records.session_id
      and private.is_subgroup_manager(session.subgroup_id)
  )
);

create or replace function private.validate_attendance_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.attendance_sessions session
    join public.subgroup_memberships membership
      on membership.subgroup_id = session.subgroup_id
    where session.id = new.session_id
      and membership.member_id = new.member_id
      and membership.status = 'active'
  ) then
    raise exception 'attendance member must have an active subgroup membership';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_attendance_member() from public;
drop trigger if exists validate_attendance_member on public.attendance_records;
create trigger validate_attendance_member
before insert or update of session_id, member_id on public.attendance_records
for each row execute procedure private.validate_attendance_member();

create or replace function public.request_subgroup_enrollment(target_subgroup_id bigint)
returns public.subgroup_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_mode public.subgroup_enrollment_mode;
  next_status public.subgroup_membership_status;
  result public.subgroup_memberships;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;

  select enrollment_mode into target_mode
  from public.subgroups
  where id = target_subgroup_id;
  if not found then raise exception 'subgroup not found'; end if;
  if target_mode = 'invite' then raise exception 'this subgroup is invitation only'; end if;

  next_status := case when target_mode = 'open' then 'active' else 'pending' end;
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
revoke all on function public.request_subgroup_enrollment(bigint) from public;
grant execute on function public.request_subgroup_enrollment(bigint) to authenticated;

-- One atomic create operation gives the creating executive a durable manager
-- membership and lets the UI immediately open the returned subgroup.
create or replace function public.create_subgroup(
  subgroup_name text,
  subgroup_description text default '',
  subgroup_mode public.subgroup_enrollment_mode default 'invite'
)
returns public.subgroups
language plpgsql
security definer
set search_path = ''
as $$
declare result public.subgroups;
begin
  if not private.is_executive() then raise exception 'executive permission required'; end if;
  if nullif(btrim(subgroup_name), '') is null then raise exception 'subgroup name is required'; end if;

  insert into public.subgroups (name, description, enrollment_mode, created_by)
  values (btrim(subgroup_name), btrim(coalesce(subgroup_description, '')), subgroup_mode, (select auth.uid()))
  returning * into result;

  insert into public.subgroup_memberships (
    subgroup_id, member_id, added_by, status, membership_role, reviewed_by, status_updated_at
  ) values (
    result.id, (select auth.uid()), (select auth.uid()), 'active', 'manager', (select auth.uid()), now()
  );
  return result;
end;
$$;
revoke all on function public.create_subgroup(text, text, public.subgroup_enrollment_mode) from public;
grant execute on function public.create_subgroup(text, text, public.subgroup_enrollment_mode) to authenticated;

create or replace function public.review_subgroup_enrollment(
  target_subgroup_id bigint,
  target_member_id uuid,
  next_status public.subgroup_membership_status
)
returns public.subgroup_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare result public.subgroup_memberships;
begin
  if (select auth.uid()) is null then raise exception 'authentication required'; end if;
  if next_status not in ('active', 'waitlisted', 'inactive') then
    raise exception 'requests may only be approved, waitlisted, or made inactive';
  end if;
  if not (private.is_executive() or private.is_subgroup_manager(target_subgroup_id)) then
    raise exception 'subgroup management permission required';
  end if;

  update public.subgroup_memberships
  set status = next_status,
      reviewed_by = (select auth.uid()),
      added_by = case when next_status = 'active' then (select auth.uid()) else added_by end,
      status_updated_at = now()
  where subgroup_id = target_subgroup_id and member_id = target_member_id
  returning * into result;
  if not found then raise exception 'membership request not found'; end if;
  return result;
end;
$$;
revoke all on function public.review_subgroup_enrollment(bigint, uuid, public.subgroup_membership_status) from public;
grant execute on function public.review_subgroup_enrollment(bigint, uuid, public.subgroup_membership_status) to authenticated;

create or replace function public.set_subgroup_member_role(
  target_subgroup_id bigint,
  target_member_id uuid,
  next_role public.subgroup_membership_role
)
returns public.subgroup_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare result public.subgroup_memberships;
begin
  if not private.is_executive() then raise exception 'executive permission required'; end if;
  update public.subgroup_memberships
  set membership_role = next_role,
      reviewed_by = (select auth.uid()),
      status_updated_at = now()
  where subgroup_id = target_subgroup_id and member_id = target_member_id
  returning * into result;
  if not found then raise exception 'subgroup membership not found'; end if;
  return result;
end;
$$;
revoke all on function public.set_subgroup_member_role(bigint, uuid, public.subgroup_membership_role) from public;
grant execute on function public.set_subgroup_member_role(bigint, uuid, public.subgroup_membership_role) to authenticated;

drop policy if exists "Members view accessible archive" on public.archive_items;
create policy "Members view permitted archive"
on public.archive_items for select to authenticated using (
  private.is_executive()
  or (subgroup_id is null and visibility = 'members')
  or (
    subgroup_id is not null and exists (
      select 1 from public.subgroup_memberships membership
      where membership.subgroup_id = archive_items.subgroup_id
        and membership.member_id = (select auth.uid())
        and membership.status = 'active'
    )
  )
);

drop policy if exists "Members read accessible files" on storage.objects;
create policy "Members read permitted archive files"
on storage.objects for select to authenticated using (
  bucket_id = 'club-archive' and exists (
    select 1 from public.archive_items item
    where item.storage_path = name and (
      private.is_executive()
      or (item.subgroup_id is null and item.visibility = 'members')
      or (
        item.subgroup_id is not null and exists (
          select 1 from public.subgroup_memberships membership
          where membership.subgroup_id = item.subgroup_id
            and membership.member_id = (select auth.uid())
            and membership.status = 'active'
        )
      )
    )
  )
);
