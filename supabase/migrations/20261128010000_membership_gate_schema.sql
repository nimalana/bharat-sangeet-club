-- Membership gate, part 1 of 2 (P0-01, decision D1): the states, the review and the queue.
--
-- RELEASE ORDER: this file only ADDS things (two account states, one table, two functions, one
-- extra key in an answer). No profile can be pending or rejected until part 2
-- (20261128010100_membership_gate_signup_default.sql) changes what a new sign-up becomes, so the
-- deployed frontend sees no difference: apply this file BEFORE the new frontend is deployed, so
-- the functions the new frontend calls exist the moment it is live. Part 2 is the one that
-- changes behaviour and goes in "Apply after the frontend is live" (docs/RELEASE_ORDER.md).
--
-- The model. profiles.status has two new values next to 'active' and 'deactivated':
--
--   pending   a new sign-up, waiting for a club executive. Can read its own profile row and call
--             get_portal_bootstrap (which says "pending"), nothing else.
--   rejected  a sign-up an executive declined. Same powers as pending (none). An executive can
--             undo the decision by approving it. The person sees a clear message.
--
-- Everything that already refuses a deactivated account refuses these two without a rewrite: the
-- restrictive policy "Active members only" on every table and on storage.objects asks
-- private.is_active_member() (status = 'active'), and is_executive / is_admin /
-- is_subgroup_manager already require an active profile. What did name 'deactivated' is changed
-- below: block_deactivated_writer (the statement trigger that refuses writes by an inactive
-- account, including writes made through security definer functions) and
-- refuse_deactivated_membership (nobody can be put in a group unless active).
--
-- Moving between states is one door, and it is guarded in the database:
--
--   pending  -> active    review_pending_member(id, true)    executives and admins
--   pending  -> rejected  review_pending_member(id, false)   executives and admins
--   rejected -> active    review_pending_member(id, true)    (the undo)
--   active <-> deactivated  admin_deactivate_member / admin_reactivate_member, administrators
--
-- A pending or rejected profile is always a plain member (a check constraint), cannot be given a
-- role or deactivated or reactivated, and cannot become active in any other way
-- (guard_profile_status below), so an executive or administrator can never be pending.
--
-- Everything is written to be run again: create or replace, if exists, drop policy if exists.

-- ---------------------------------------------------------------------------
-- 1. The two new states, and "an unapproved profile is a plain member"
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check
  check (status in ('active', 'deactivated', 'pending', 'rejected'));

alter table public.profiles drop constraint if exists profiles_unapproved_are_members;
alter table public.profiles add constraint profiles_unapproved_are_members
  check (status not in ('pending', 'rejected') or role = 'member');

-- The queue and the count read the few unapproved rows.
create index if not exists profiles_unapproved_idx
  on public.profiles (joined_at, id) where status in ('pending', 'rejected');

-- ---------------------------------------------------------------------------
-- 2. Who decided, when and why. Executives read it; the two functions below write it.
-- ---------------------------------------------------------------------------
create table if not exists public.signup_reviews (
  member_id uuid primary key references public.profiles(id) on delete cascade,
  decision text not null check (decision in ('approved', 'declined')),
  decided_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id) on delete set null,
  reason text not null default '',
  constraint signup_reviews_reason_length check (char_length(reason) <= 500)
);
create index if not exists signup_reviews_decided_by_idx
  on public.signup_reviews(decided_by) where decided_by is not null;

alter table public.signup_reviews enable row level security;
revoke all on public.signup_reviews from public, anon, authenticated;
grant select on public.signup_reviews to authenticated;

drop policy if exists "Executives read sign-up reviews" on public.signup_reviews;
create policy "Executives read sign-up reviews"
  on public.signup_reviews for select to authenticated
  using ((select private.is_executive()));

-- The two guards every public table carries (20_deactivation.test.sql checks).
drop policy if exists "Active members only" on public.signup_reviews;
create policy "Active members only" on public.signup_reviews as restrictive for all to authenticated
  using ((select private.is_active_member()))
  with check ((select private.is_active_member()));
drop trigger if exists block_deactivated_writer on public.signup_reviews;
create trigger block_deactivated_writer before insert or update or delete on public.signup_reviews
  for each statement execute function private.block_deactivated_writer();

-- ---------------------------------------------------------------------------
-- 3. The directory no longer lists people who are not members (yet).
--    Active and deactivated rows are listed as before; a pending or rejected row is visible to
--    its owner and to executives only, so a sign-up request (name and address) is not public
--    to every member.
-- ---------------------------------------------------------------------------
drop policy if exists "Signed-in members view directory" on public.profiles;
create policy "Signed-in members view directory" on public.profiles for select to authenticated
  using (
    status in ('active', 'deactivated')
    or id = (select auth.uid())
    or (select private.is_executive())
  );

-- ---------------------------------------------------------------------------
-- 4. The statement trigger that refuses writes by an account that is not active now names the
--    state. Same trigger on the same tables: only the function body changes. An account with no
--    profile at all (a deleted member's old token) is refused too.
-- ---------------------------------------------------------------------------
create or replace function private.block_deactivated_writer()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
begin
  if (select auth.uid()) is not null then
    select status into v_status from public.profiles where id = (select auth.uid());
    if v_status is distinct from 'active' then
      raise exception '%', case v_status
        when 'deactivated' then 'Your access to the portal has been deactivated'
        when 'pending' then 'Your sign-up is waiting for approval by a club executive'
        when 'rejected' then 'Your sign-up was not approved'
        else 'Your account is not an active club member'
      end using errcode = '42501';
    end if;
  end if;
  return null;
end;
$$;
revoke all on function private.block_deactivated_writer() from public, anon, authenticated;

-- Nobody can be added to a group (or ask to join one) unless the account is active.
create or replace function private.refuse_deactivated_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
begin
  if new.status in ('active', 'pending', 'waitlisted') then
    select status into v_status from public.profiles where id = new.member_id;
    if v_status = 'deactivated' then
      raise exception 'This member is deactivated. Reactivate the account before adding it to a group.' using errcode = '22023';
    elsif v_status in ('pending', 'rejected') then
      raise exception 'This person has not been approved yet. Approve the sign-up before adding them to a group.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.refuse_deactivated_membership() from public, anon, authenticated;

-- private.finance_path_registered told anyone, an inactive account included, whether a finance
-- file path is registered. The storage policies only ever ask "not registered", so the answer for
-- an account that is not active is "registered" for every path: nothing to learn from it, and a
-- policy that would have let such an account act on an unregistered file says no.
create or replace function private.finance_path_registered(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select not private.is_active_member()
    or exists (select 1 from public.finance_documents where storage_path = p_path);
$$;

-- ---------------------------------------------------------------------------
-- 5. The one door between the states.
--    Runs only for a signed-in caller (auth.uid() is set): the SQL editor, a migration and the
--    signup trigger have none and are not held to it.
--    * a pending or rejected account becomes active only inside review_pending_member, which
--      switches app.signup_review on for its own update, and only for an active executive;
--    * an active or deactivated account never becomes pending or rejected;
--    * pending <-> deactivated is refused, and a pending or rejected account keeps role member.
-- ---------------------------------------------------------------------------
create or replace function private.guard_profile_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if new.status is distinct from old.status then
    if new.status in ('pending', 'rejected') and old.status not in ('pending', 'rejected') then
      raise exception 'An approved account cannot go back to waiting for approval' using errcode = '22023';
    end if;
    if old.status in ('pending', 'rejected') and new.status = 'deactivated' then
      raise exception 'This is a sign-up request, not a member yet. Decline it in the sign-up queue instead.' using errcode = '22023';
    end if;
    if old.status in ('pending', 'rejected') and new.status = 'active'
       and not (coalesce(current_setting('app.signup_review', true), '') = 'on' and private.is_executive()) then
      raise exception 'A sign-up is approved from the sign-up queue only' using errcode = '42501';
    end if;
  end if;
  if new.role is distinct from old.role and old.status in ('pending', 'rejected') and new.status in ('pending', 'rejected') then
    raise exception 'Approve this sign-up before changing its role' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_profile_status() from public, anon, authenticated;

drop trigger if exists guard_profile_status on public.profiles;
create trigger guard_profile_status before update of status, role on public.profiles
  for each row execute function private.guard_profile_status();

-- ---------------------------------------------------------------------------
-- 6. Audit: two new actions
-- ---------------------------------------------------------------------------
alter table public.admin_audit_log drop constraint if exists admin_audit_log_action_check;
alter table public.admin_audit_log add constraint admin_audit_log_action_check
  check (action in ('role_changed', 'member_deleted', 'member_updated', 'member_deactivated', 'member_reactivated',
                    'signup_approved', 'signup_declined'));

-- ---------------------------------------------------------------------------
-- 7. Approve or decline a sign-up
--    Executives and administrators who are themselves active. The profile row is locked, so two
--    executives acting on the same person run one after the other and the second is told what
--    the first did (nothing changes twice, one audit row per real change).
-- ---------------------------------------------------------------------------
create or replace function public.review_pending_member(p_member_id uuid, p_approved boolean, p_reason text default '')
returns public.profiles
language plpgsql security definer set search_path = '' as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_email text;
  v_target public.profiles%rowtype;
  v_updated public.profiles%rowtype;
  v_reason text := left(trim(coalesce(p_reason, '')), 500);
begin
  if v_actor_id is null or not private.is_executive() then
    raise exception 'Only club executives can review sign-ups' using errcode = '42501';
  end if;
  if p_member_id is null or p_approved is null then
    raise exception 'Choose a sign-up and whether to approve or decline it' using errcode = '22023';
  end if;
  if p_member_id = v_actor_id then
    raise exception 'You cannot review your own sign-up' using errcode = '22023';
  end if;
  select email into v_actor_email from public.profiles where id = v_actor_id;
  select * into v_target from public.profiles where id = p_member_id for update;
  if not found then
    raise exception 'Sign-up not found' using errcode = 'P0002';
  end if;

  if v_target.status = 'active' then
    raise exception '%', case when p_approved
        then 'This person is already an active member. Nothing was changed.'
        else 'This person is already an active member, so the sign-up cannot be declined. An administrator can deactivate the account.' end
      using errcode = '22023';
  elsif v_target.status = 'deactivated' then
    raise exception 'This account was deactivated: it is not a new sign-up. An administrator can reactivate it.' using errcode = '22023';
  elsif v_target.status = 'rejected' and not p_approved then
    raise exception 'This sign-up was already declined. Nothing was changed.' using errcode = '22023';
  end if;

  -- From here the target is pending (approve or decline) or rejected (approve: the undo).
  perform set_config('app.signup_review', 'on', true);
  update public.profiles
  set status = case when p_approved then 'active' else 'rejected' end,
      role = 'member'
  where id = p_member_id
  returning * into v_updated;
  perform set_config('app.signup_review', 'off', true);

  insert into public.signup_reviews (member_id, decision, decided_at, decided_by, reason)
  values (p_member_id, case when p_approved then 'approved' else 'declined' end, now(), v_actor_id, v_reason)
  on conflict (member_id) do update
    set decision = excluded.decision, decided_at = excluded.decided_at,
        decided_by = excluded.decided_by, reason = excluded.reason;

  insert into public.admin_audit_log (action, actor_id, actor_email, target_id, target_email, details)
  values (case when p_approved then 'signup_approved' else 'signup_declined' end,
    v_actor_id, coalesce(v_actor_email, ''), v_target.id, v_target.email,
    jsonb_build_object('full_name', v_target.full_name, 'previous_status', v_target.status, 'reason', v_reason));
  return v_updated;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. The queue: the sign-ups waiting (oldest first, at most 500) and the 50 most recently declined
--    ones, so a decision can be undone. Executives and administrators only; everyone else is told
--    so rather than shown an empty list.
-- ---------------------------------------------------------------------------
create or replace function public.list_pending_members()
returns table (
  member_id uuid, full_name text, email text, status text,
  requested_at timestamptz, decided_at timestamptz, decided_by_name text, reason text
)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if not private.is_executive() then
    raise exception 'Only club executives can see sign-up requests' using errcode = '42501';
  end if;
  return query
  select * from (
    (select p.id, p.full_name, p.email, p.status, p.joined_at, null::timestamptz as decided_at, null::text as decided_by_name, ''::text as reason
     from public.profiles p
     where p.status = 'pending'
     order by p.joined_at, p.id
     limit 500)
    union all
    (select p.id, p.full_name, p.email, p.status, p.joined_at, r.decided_at,
            nullif(coalesce(d.full_name, ''), '')::text, coalesce(r.reason, '')::text
     from public.profiles p
     left join public.signup_reviews r on r.member_id = p.id
     left join public.profiles d on d.id = r.decided_by
     where p.status = 'rejected'
     order by r.decided_at desc nulls last, p.id
     limit 50)
  ) queue
  order by (queue.status = 'pending') desc,
           case when queue.status = 'pending' then queue.joined_at end,
           queue.decided_at desc nulls last;
end;
$$;

revoke all on function public.review_pending_member(uuid, boolean, text) from public, anon;
revoke all on function public.list_pending_members() from public, anon;
grant execute on function public.review_pending_member(uuid, boolean, text) to authenticated;
grant execute on function public.list_pending_members() to authenticated;

-- ---------------------------------------------------------------------------
-- 9. The bootstrap says how many sign-ups are waiting, to executives only (an extra key: for
--    everyone else the answer is exactly what it was). Still SECURITY INVOKER: a pending or
--    rejected caller gets its own profile, with the status, and nothing else.
-- ---------------------------------------------------------------------------
create or replace function public.get_portal_bootstrap()
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'profile', (
      select jsonb_build_object('full_name', profile.full_name, 'role', profile.role, 'status', profile.status)
      from public.profiles profile where profile.id = (select auth.uid())),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'description', g.description,
        'enrollment_mode', g.enrollment_mode, 'archived_at', g.archived_at) order by g.name)
      from public.subgroups g where g.archived_at is null), '[]'::jsonb),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object('subgroup_id', m.subgroup_id, 'member_id', m.member_id,
        'status', m.status, 'membership_role', m.membership_role))
      from public.subgroup_memberships m where m.member_id = (select auth.uid())), '[]'::jsonb),
    'announcements', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.is_pinned desc, a.published_at desc)
      from (select * from public.announcements order by is_pinned desc, published_at desc limit 12) a), '[]'::jsonb),
    -- The calendar shows the past year and everything ahead.
    'events', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.starts_at)
      from public.events e where e.starts_at >= now() - interval '1 year'), '[]'::jsonb),
    'resource_count', (select count(*) from public.resources r where r.status <> 'archived'),
    -- Only the executive "club and concert recordings" manager uses these.
    'archive', case when (select private.is_executive()) then coalesce((
      select jsonb_agg(to_jsonb(item) order by item.created_at desc)
      from public.archive_items item where item.type = 'recording'), '[]'::jsonb) else '[]'::jsonb end
  ) || case when (select private.is_executive())
    then jsonb_build_object('pending_signups', (select count(*) from public.profiles s where s.status = 'pending'))
    else '{}'::jsonb end;
$$;

revoke all on function public.get_portal_bootstrap() from public, anon;
grant execute on function public.get_portal_bootstrap() to authenticated;
