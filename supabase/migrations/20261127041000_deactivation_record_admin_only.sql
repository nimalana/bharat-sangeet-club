-- core-2: every signed-in member could read each person's deactivation reason,
-- the administrator who deactivated them, and when.
--
-- 20261126232000 stored these on public.profiles. The directory policy on that
-- table is "using (true)" for any active member and authenticated holds
-- table-level SELECT, so a plain member could run
--   select id, deactivation_reason from profiles where status = 'deactivated'
-- through the API and read admin notes such as a complaint number. Column
-- privileges cannot separate administrators from members (both are
-- "authenticated"), and a column revoke would break every select('*') on
-- profiles, so the record moves to its own table that only administrators can
-- read. The reason also stays in admin_audit_log (administrators only), where
-- it was already copied.
--
-- The admin screens never read the old columns; they only send the reason to
-- admin_deactivate_member. An administrator who wants to see it reads
-- public.member_deactivations.

create table if not exists public.member_deactivations (
  member_id uuid primary key references public.profiles(id) on delete cascade,
  deactivated_at timestamptz not null default now(),
  deactivated_by uuid references public.profiles(id) on delete set null,
  reason text not null default '',
  constraint member_deactivations_reason_length check (char_length(reason) <= 500)
);
create index if not exists member_deactivations_deactivated_by_idx
  on public.member_deactivations(deactivated_by) where deactivated_by is not null;

alter table public.member_deactivations enable row level security;

-- Hosted Supabase hands every new table to anon and authenticated through
-- default privileges. Take it all back, then grant read access to
-- authenticated (the policy below narrows that to administrators). Writes go
-- through admin_deactivate_member and admin_reactivate_member only.
revoke all on public.member_deactivations from public, anon, authenticated;
grant select on public.member_deactivations to authenticated;

drop policy if exists "Admins read deactivation records" on public.member_deactivations;
create policy "Admins read deactivation records"
  on public.member_deactivations for select to authenticated
  using ((select private.is_admin()));

-- The two guards every public table carries (20_deactivation.test.sql checks).
drop policy if exists "Active members only" on public.member_deactivations;
create policy "Active members only" on public.member_deactivations as restrictive for all to authenticated
  using ((select private.is_active_member()))
  with check ((select private.is_active_member()));
drop trigger if exists block_deactivated_writer on public.member_deactivations;
create trigger block_deactivated_writer before insert or update or delete on public.member_deactivations
  for each statement execute function private.block_deactivated_writer();

-- Carry over what the profiles columns hold today. to_jsonb keeps this valid
-- if a column is already gone (a re-run, or a database that differs from the
-- migration files).
insert into public.member_deactivations (member_id, deactivated_at, deactivated_by, reason)
select p.id,
       coalesce((to_jsonb(p) ->> 'deactivated_at')::timestamptz, now()),
       (select a.id from public.profiles a where a.id = nullif(to_jsonb(p) ->> 'deactivated_by', '')::uuid),
       left(coalesce(to_jsonb(p) ->> 'deactivation_reason', ''), 500)
from public.profiles p
where p.status = 'deactivated'
on conflict (member_id) do nothing;

alter table public.profiles
  drop column if exists deactivation_reason,
  drop column if exists deactivated_by,
  drop column if exists deactivated_at;

create or replace function public.admin_deactivate_member(p_target_id uuid, p_reason text default '')
returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_email text;
  v_target public.profiles%rowtype;
  v_updated public.profiles%rowtype;
  v_reason text := left(trim(coalesce(p_reason, '')), 500);
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

  update public.subgroup_memberships
  set status = 'removed', membership_role = 'member'
  where member_id = p_target_id and status in ('active', 'pending', 'waitlisted');
  get diagnostics v_groups = row_count;

  insert into public.admin_audit_log (action, actor_id, actor_email, target_id, target_email, details)
  values ('member_deactivated', v_actor_id, coalesce(v_actor_email, ''), v_target.id, v_target.email,
    jsonb_build_object('role', v_target.role::text, 'full_name', v_target.full_name,
      'reason', v_reason, 'groups_removed', v_groups));
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
  set status = 'active'
  where id = p_target_id
  returning * into v_updated;
  delete from public.member_deactivations where member_id = p_target_id;

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
