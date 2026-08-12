-- Administrative controls for the Bharat Sangeet portal.
--
-- PostgreSQL does not permit a newly added enum value to be used until the
-- transaction that added it has committed. Keep the COMMIT directly after the
-- ALTER TYPE so the admin value can safely be used by the functions and data
-- migration below.
alter type public.club_role add value if not exists 'admin';
commit;

-- An admin is an executive with the additional ability to manage identities
-- and roles. Existing executive permissions intentionally continue to work
-- for admins through this shared helper.
create or replace function private.is_executive()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role in ('executive', 'admin')
  );
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
  );
$$;

revoke all on function private.is_executive() from public;
revoke all on function private.is_admin() from public;
grant execute on function private.is_executive() to authenticated;
grant execute on function private.is_admin() to authenticated;

-- Give the current club owner the first administrative account. Failing loudly
-- here is intentional: an administrator must sign in at least once before this
-- migration is run, so the auth trigger has created their profile.
do $$
begin
  update public.profiles
  set role = 'admin'
  where lower(email) = 'nimalan.arulvelan@gmail.com';

  if not found then
    raise exception 'Cannot bootstrap administrator: profile for nimalan.arulvelan@gmail.com does not exist';
  end if;
end;
$$;

-- Keep club content if an administrator removes an author account. Membership
-- and attendance rows already cascade away with the deleted profile; authored
-- content is retained and its former author reference becomes NULL.
alter table public.archive_items alter column uploaded_by drop not null;
alter table public.archive_items drop constraint archive_items_uploaded_by_fkey;
alter table public.archive_items
  add constraint archive_items_uploaded_by_fkey
  foreign key (uploaded_by) references public.profiles(id) on delete set null;

alter table public.transactions alter column created_by drop not null;
alter table public.transactions drop constraint transactions_created_by_fkey;
alter table public.transactions
  add constraint transactions_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.events alter column created_by drop not null;
alter table public.events drop constraint events_created_by_fkey;
alter table public.events
  add constraint events_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.subgroups alter column created_by drop not null;
alter table public.subgroups drop constraint subgroups_created_by_fkey;
alter table public.subgroups
  add constraint subgroups_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.subgroup_memberships alter column added_by drop not null;
alter table public.subgroup_memberships drop constraint subgroup_memberships_added_by_fkey;
alter table public.subgroup_memberships
  add constraint subgroup_memberships_added_by_fkey
  foreign key (added_by) references public.profiles(id) on delete set null;

alter table public.attendance_sessions alter column created_by drop not null;
alter table public.attendance_sessions drop constraint attendance_sessions_created_by_fkey;
alter table public.attendance_sessions
  add constraint attendance_sessions_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.attendance_records alter column marked_by drop not null;
alter table public.attendance_records drop constraint attendance_records_marked_by_fkey;
alter table public.attendance_records
  add constraint attendance_records_marked_by_fkey
  foreign key (marked_by) references public.profiles(id) on delete set null;

-- Club-wide notices are the first admin-managed dashboard feature. Executives
-- may publish notices, while member and identity administration stays admin-only.
create table public.announcements (
  id bigint generated always as identity primary key,
  title text not null check (char_length(title) between 1 and 140),
  body text not null check (char_length(body) between 1 and 5000),
  is_pinned boolean not null default false,
  published_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index announcements_pinned_published_idx
  on public.announcements (is_pinned desc, published_at desc);
create index announcements_created_by_idx on public.announcements(created_by);

create function private.touch_announcement_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function private.touch_announcement_updated_at() from public;

create trigger set_announcement_updated_at
before update on public.announcements
for each row execute procedure private.touch_announcement_updated_at();

create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  action text not null check (action in ('role_changed', 'member_deleted')),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_email text not null,
  target_id uuid not null,
  target_email text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index admin_audit_log_created_idx
  on public.admin_audit_log (created_at desc);
create index admin_audit_log_target_idx
  on public.admin_audit_log (target_id, created_at desc);
create index admin_audit_log_actor_idx on public.admin_audit_log(actor_id);

alter table public.announcements enable row level security;
alter table public.admin_audit_log enable row level security;

grant select, insert, update, delete on public.announcements to authenticated;
grant select on public.admin_audit_log to authenticated;
grant usage, select on all sequences in schema public to authenticated;

create policy "Signed-in members view announcements"
on public.announcements for select to authenticated
using (true);

create policy "Executives insert announcements"
on public.announcements for insert to authenticated
with check (private.is_executive() and created_by = (select auth.uid()));

create policy "Executives update announcements"
on public.announcements for update to authenticated
using (private.is_executive())
with check (private.is_executive());

create policy "Executives delete announcements"
on public.announcements for delete to authenticated
using (private.is_executive());

create policy "Admins view audit log"
on public.admin_audit_log for select to authenticated
using (private.is_admin());

-- These RPCs are intentionally SECURITY DEFINER because an admin must be able
-- to change the protected role column and remove an auth.users row. They live
-- in the API-exposed schema only so authenticated browser clients can call
-- them; each function validates the caller in the database before acting.
create or replace function public.admin_change_member_role(
  p_target_id uuid,
  p_new_role public.club_role
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
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

  select email into v_actor_email
  from public.profiles
  where id = v_actor_id;

  select * into v_target
  from public.profiles
  where id = p_target_id;

  if not found then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  if p_target_id = v_actor_id and p_new_role <> 'admin' then
    raise exception 'Administrators cannot demote themselves' using errcode = '22023';
  end if;

  if v_target.role = 'admin' and p_new_role <> 'admin'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'The last administrator cannot be demoted' using errcode = '22023';
  end if;

  update public.profiles
  set role = p_new_role
  where id = p_target_id
  returning * into v_updated;

  if v_target.role is distinct from v_updated.role then
    insert into public.admin_audit_log (
      action, actor_id, actor_email, target_id, target_email, details
    ) values (
      'role_changed', v_actor_id, coalesce(v_actor_email, ''),
      v_target.id, v_target.email,
      jsonb_build_object('previous_role', v_target.role::text, 'new_role', v_updated.role::text)
    );
  end if;

  return v_updated;
end;
$$;

create or replace function public.admin_delete_member(p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_email text;
  v_target public.profiles%rowtype;
begin
  if v_actor_id is null or not private.is_admin() then
    raise exception 'Only administrators can remove members' using errcode = '42501';
  end if;

  -- Share the role-change lock to preserve the at-least-one-admin invariant
  -- across both demotions and account removals.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('bharat_sangeet_admin_role_change'));

  if p_target_id = v_actor_id then
    raise exception 'Administrators cannot delete themselves' using errcode = '22023';
  end if;

  select email into v_actor_email
  from public.profiles
  where id = v_actor_id;

  select * into v_target
  from public.profiles
  where id = p_target_id;

  if not found then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  if v_target.role = 'admin'
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'The last administrator cannot be deleted' using errcode = '22023';
  end if;

  insert into public.admin_audit_log (
    action, actor_id, actor_email, target_id, target_email, details
  ) values (
    'member_deleted', v_actor_id, coalesce(v_actor_email, ''),
    v_target.id, v_target.email,
    jsonb_build_object('role', v_target.role::text, 'full_name', v_target.full_name)
  );

  -- Deleting auth.users cascades to public.profiles. Dependent membership and
  -- attendance data cascade, while authored club content is retained above.
  delete from auth.users where id = p_target_id;

  if not found then
    raise exception 'Could not remove the member authentication account' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.admin_change_member_role(uuid, public.club_role) from public;
revoke all on function public.admin_delete_member(uuid) from public;
revoke all on function public.admin_change_member_role(uuid, public.club_role) from anon;
revoke all on function public.admin_delete_member(uuid) from anon;
grant execute on function public.admin_change_member_role(uuid, public.club_role) to authenticated;
grant execute on function public.admin_delete_member(uuid) to authenticated;

-- The automatic RLS event trigger is internal maintenance, not an API RPC.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
