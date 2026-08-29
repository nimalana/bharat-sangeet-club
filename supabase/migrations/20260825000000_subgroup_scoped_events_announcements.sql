-- Allow the shared calendar and announcement feed to carry subgroup-owned
-- items while retaining NULL as the club-wide scope.
alter table public.events
  add column if not exists subgroup_id bigint
  references public.subgroups(id) on delete cascade;

alter table public.announcements
  add column if not exists subgroup_id bigint
  references public.subgroups(id) on delete cascade;

create index if not exists events_subgroup_starts_idx
  on public.events (subgroup_id, starts_at desc);

create index if not exists announcements_subgroup_feed_idx
  on public.announcements (subgroup_id, is_pinned desc, published_at desc);

-- The original policies exposed every row to every signed-in member. Replace
-- them so subgroup-owned content is visible only to active members of that
-- subgroup, while NULL-scoped content remains club-wide.
drop policy if exists "Members view events" on public.events;
create policy "Members view accessible events"
on public.events for select to authenticated
using (
  private.is_executive()
  or subgroup_id is null
  or exists (
    select 1
    from public.subgroup_memberships membership
    where membership.subgroup_id = events.subgroup_id
      and membership.member_id = (select auth.uid())
      and membership.status = 'active'
  )
);

drop policy if exists "Signed-in members view announcements"
  on public.announcements;
create policy "Members view accessible announcements"
on public.announcements for select to authenticated
using (
  private.is_executive()
  or subgroup_id is null
  or exists (
    select 1
    from public.subgroup_memberships membership
    where membership.subgroup_id = announcements.subgroup_id
      and membership.member_id = (select auth.uid())
      and membership.status = 'active'
  )
);

-- Existing insert/update/delete policies intentionally remain executive-only.
