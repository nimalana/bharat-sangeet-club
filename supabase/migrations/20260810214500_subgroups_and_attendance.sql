create type public.attendance_status as enum ('present', 'absent', 'excused');

create table public.subgroups (
  id bigint generated always as identity primary key,
  name text not null unique,
  description text not null default '',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.subgroup_memberships (
  subgroup_id bigint not null references public.subgroups(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  added_by uuid not null references public.profiles(id),
  joined_at timestamptz not null default now(),
  primary key (subgroup_id, member_id)
);

create table public.attendance_sessions (
  id bigint generated always as identity primary key,
  subgroup_id bigint not null references public.subgroups(id) on delete cascade,
  title text not null default 'Meeting',
  session_date date not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (subgroup_id, session_date, title)
);

create table public.attendance_records (
  session_id bigint not null references public.attendance_sessions(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  status public.attendance_status not null,
  marked_by uuid not null references public.profiles(id),
  marked_at timestamptz not null default now(),
  primary key (session_id, member_id)
);

create index subgroup_memberships_member_idx on public.subgroup_memberships(member_id);
create index attendance_sessions_subgroup_date_idx on public.attendance_sessions(subgroup_id, session_date desc);
create index attendance_records_member_idx on public.attendance_records(member_id);

alter table public.subgroups enable row level security;
alter table public.subgroup_memberships enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.attendance_records enable row level security;

grant select, insert, update, delete on public.subgroups, public.subgroup_memberships, public.attendance_sessions, public.attendance_records to authenticated;
grant usage, select on all sequences in schema public to authenticated;

create policy "Members view assigned subgroups" on public.subgroups for select to authenticated using (
  private.is_executive() or exists (
    select 1 from public.subgroup_memberships membership
    where membership.subgroup_id = subgroups.id
      and membership.member_id = (select auth.uid())
  )
);
create policy "Executives manage subgroups" on public.subgroups for all to authenticated using (private.is_executive()) with check (private.is_executive());
create policy "Members view own subgroup memberships" on public.subgroup_memberships for select to authenticated using (member_id = (select auth.uid()) or private.is_executive());
create policy "Executives manage subgroup memberships" on public.subgroup_memberships for all to authenticated using (private.is_executive()) with check (private.is_executive());
create policy "Members view their subgroup sessions" on public.attendance_sessions for select to authenticated using (private.is_executive() or exists (select 1 from public.subgroup_memberships sm where sm.subgroup_id = attendance_sessions.subgroup_id and sm.member_id = (select auth.uid())));
create policy "Executives manage attendance sessions" on public.attendance_sessions for all to authenticated using (private.is_executive()) with check (private.is_executive());
create policy "Members view own attendance" on public.attendance_records for select to authenticated using (member_id = (select auth.uid()) or private.is_executive());
create policy "Executives manage attendance" on public.attendance_records for all to authenticated using (private.is_executive()) with check (private.is_executive());
