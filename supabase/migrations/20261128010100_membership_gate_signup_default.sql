-- Membership gate, part 2 of 2 (P0-01, decision D1): a new sign-up waits for an executive.
--
-- RELEASE ORDER: APPLY AFTER THE NEW FRONTEND IS LIVE (docs/RELEASE_ORDER.md, section "Apply
-- after the frontend is live"). From the moment this file runs, everyone who signs in with
-- Google for the first time is created as 'pending'. Only the new frontend knows what to show a
-- pending account (the "waiting for approval" screen); the frontend deployed before it asks
-- get_portal_bootstrap, gets a profile whose status it does not know, and shows "We could not
-- load your club profile" with a Try again button that can never succeed. Part 1
-- (20261128010000_membership_gate_schema.sql) must already be applied: this file only switches
-- what the sign-up trigger creates.
--
-- No existing profile is touched: every member, executive and administrator keeps the status
-- they have (all of them 'active' or 'deactivated'), so existing members sign in as before. To
-- go back, apply `create or replace function private.handle_new_user()` with 'active' again.
--
-- The club's first administrator (the address that 20260812000000_admin_console.sql promotes)
-- is never made pending: if that account is ever created again it is active at once. That
-- address stays written in one more place until the bootstrap handover of Phase 4.4 (P3-04).
-- Anyone who is already an executive or administrator cannot become pending in any case: a
-- check constraint of part 1 allows pending and rejected for the role 'member' only.

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name, status)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when lower(coalesce(new.email, '')) = 'nimalan.arulvelan@gmail.com' then 'active' else 'pending' end
  );
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public;

-- A profile written by anything that forgets to say its status is a sign-up too.
alter table public.profiles alter column status set default 'pending';
