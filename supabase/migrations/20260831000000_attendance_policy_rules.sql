-- Attendance policy rules for club-wide meetings and subgroup rehearsals.
-- Participation tracking outside club-wide and subgroup meetings intentionally
-- lives outside the attendance workflow.

alter type public.attendance_status add value if not exists 'tardy';

alter table public.attendance_records
  add column if not exists minutes_late integer not null default 0,
  add column if not exists unexcused_units numeric(4,2) not null default 0;

alter table public.attendance_records
  drop constraint if exists attendance_records_minutes_late_check;
alter table public.attendance_records
  add constraint attendance_records_minutes_late_check check (minutes_late >= 0 and minutes_late <= 1440);

alter table public.attendance_excuses
  alter column proof_path drop not null,
  add column if not exists reason_category text not null default 'other',
  add column if not exists notified_at timestamptz;

alter table public.attendance_excuses
  drop constraint if exists attendance_excuses_reason_category_check;
alter table public.attendance_excuses
  add constraint attendance_excuses_reason_category_check check (reason_category in ('class_exam', 'family_emergency', 'illness', 'other_club_event', 'other'));

create type public.attendance_remediation_status as enum ('pending', 'complete', 'waived');
create type public.attendance_eligibility_status as enum ('eligible', 'under_review', 'restricted', 'reinstated');

create table public.attendance_remediations (
  id bigint generated always as identity primary key,
  session_id bigint not null references public.attendance_sessions(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  assignment text not null default 'Remediation required for this attendance record.',
  due_at timestamptz,
  status public.attendance_remediation_status not null default 'pending',
  note text,
  assigned_by uuid references public.profiles(id) on delete set null,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, member_id)
);

create index attendance_remediations_member_idx
  on public.attendance_remediations(member_id, status, due_at);

create table public.attendance_eligibility (
  term_key text not null,
  member_id uuid not null references public.profiles(id) on delete cascade,
  status public.attendance_eligibility_status not null default 'eligible',
  reason text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (term_key, member_id)
);

create index attendance_eligibility_member_idx
  on public.attendance_eligibility(member_id, term_key);

alter table public.attendance_remediations enable row level security;
alter table public.attendance_eligibility enable row level security;

grant select on public.attendance_remediations, public.attendance_eligibility to authenticated;
grant usage, select on all sequences in schema public to authenticated;

create policy "Members view own attendance remediation"
  on public.attendance_remediations for select to authenticated
  using (private.is_executive() or member_id = (select auth.uid()));
create policy "Executives manage attendance remediation"
  on public.attendance_remediations for all to authenticated
  using (private.is_executive()) with check (private.is_executive());

create policy "Members view own attendance eligibility"
  on public.attendance_eligibility for select to authenticated
  using (private.is_executive() or member_id = (select auth.uid()));
create policy "Executives manage attendance eligibility"
  on public.attendance_eligibility for all to authenticated
  using (private.is_executive()) with check (private.is_executive());

create or replace function private.attendance_term_key(p_starts_at timestamptz)
returns text language sql stable set search_path = '' as $$
  select extract(year from (p_starts_at at time zone 'America/New_York'))::integer::text || '-' ||
    case when extract(month from (p_starts_at at time zone 'America/New_York')) between 1 and 6 then 'spring' else 'fall' end;
$$;
revoke all on function private.attendance_term_key(timestamptz) from public;

create or replace function private.attendance_unexcused_units(
  p_session_id bigint,
  p_member_id uuid,
  p_status public.attendance_status,
  p_minutes_late integer
)
returns numeric language plpgsql security definer set search_path = '' as $$
declare
  target_scope public.attendance_scope;
  target_starts_at timestamptz;
  normal_tardy_count integer;
begin
  if p_status = 'absent' then return 1;
  elsif p_status in ('present', 'excused') then return 0;
  elsif p_status <> 'tardy' then return 0;
  end if;

  select scope, starts_at into target_scope, target_starts_at
  from public.attendance_sessions where id = p_session_id;

  if p_minutes_late > 10 then return 0.5; end if;

  select count(*) into normal_tardy_count
  from public.attendance_records r
  join public.attendance_sessions s on s.id = r.session_id
  where r.member_id = p_member_id
    and r.status = 'tardy'
    and r.minutes_late between 0 and 10
    and s.scope = target_scope
    and private.attendance_term_key(s.starts_at) = private.attendance_term_key(target_starts_at)
    and r.session_id <> p_session_id;

  return case when normal_tardy_count >= 3 then 1 else 0 end;
end;
$$;
revoke all on function private.attendance_unexcused_units(bigint, uuid, public.attendance_status, integer) from public;

create or replace function private.calculate_attendance_units()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'tardy' then new.minutes_late := 0; end if;
  new.unexcused_units := private.attendance_unexcused_units(new.session_id, new.member_id, new.status, new.minutes_late);
  return new;
end;
$$;
revoke all on function private.calculate_attendance_units() from public;
drop trigger if exists calculate_attendance_units on public.attendance_records;
create trigger calculate_attendance_units
before insert or update of session_id, member_id, status, minutes_late
on public.attendance_records for each row execute procedure private.calculate_attendance_units();

create or replace function private.sync_attendance_remediation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('absent', 'excused') or (new.status = 'tardy' and new.unexcused_units > 0) then
    insert into public.attendance_remediations(session_id, member_id, assigned_by)
    values (new.session_id, new.member_id, auth.uid())
    on conflict (session_id, member_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.sync_attendance_remediation() from public;
drop trigger if exists sync_attendance_remediation on public.attendance_records;
create trigger sync_attendance_remediation
after insert or update of status, unexcused_units
on public.attendance_records for each row execute procedure private.sync_attendance_remediation();

drop function if exists public.set_attendance_status(bigint, uuid, public.attendance_status, text);
create or replace function public.set_attendance_status(
  p_session_id bigint,
  p_member_id uuid,
  p_status public.attendance_status,
  p_note text default '',
  p_minutes_late integer default 0
)
returns public.attendance_records language plpgsql security definer set search_path = '' as $$
declare result public.attendance_records;
begin
  if not private.is_executive() then raise exception 'executive permission required' using errcode = '42501'; end if;
  if p_status = 'tardy' and (p_minutes_late < 0 or p_minutes_late > 1440) then raise exception 'minutes late must be between 0 and 1440'; end if;
  if not exists (select 1 from public.attendance_session_participants where session_id = p_session_id and member_id = p_member_id) then raise exception 'member is not in this session'; end if;
  insert into public.attendance_records(session_id, member_id, status, source, note, marked_by, marked_at, minutes_late)
  values (p_session_id, p_member_id, p_status, 'executive', nullif(trim(p_note), ''), auth.uid(), now(), case when p_status = 'tardy' then p_minutes_late else 0 end)
  on conflict (session_id, member_id) do update set
    status = excluded.status,
    source = 'executive',
    note = excluded.note,
    marked_by = auth.uid(),
    marked_at = now(),
    minutes_late = excluded.minutes_late,
    updated_at = now()
  returning * into result;
  return result;
end;
$$;
revoke all on function public.set_attendance_status(bigint, uuid, public.attendance_status, text, integer) from public, anon;
grant execute on function public.set_attendance_status(bigint, uuid, public.attendance_status, text, integer) to authenticated;

drop function if exists public.submit_attendance_excuse(bigint, text, text);
create or replace function public.submit_attendance_excuse(
  p_session_id bigint,
  p_reason text,
  p_proof_path text default null,
  p_reason_category text default 'other',
  p_notified_at timestamptz default null
)
returns public.attendance_excuses language plpgsql security definer set search_path = '' as $$
declare result public.attendance_excuses;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if p_reason_category not in ('class_exam', 'family_emergency', 'illness', 'other_club_event', 'other') then raise exception 'invalid absence category'; end if;
  if not exists (select 1 from public.attendance_session_participants where session_id = p_session_id and member_id = auth.uid()) then raise exception 'You were not on this meeting roster'; end if;
  if exists (select 1 from public.attendance_sessions where id = p_session_id and status = 'canceled') then raise exception 'Canceled meetings do not accept absence forms'; end if;
  if p_proof_path is not null and split_part(p_proof_path, '/', 1) <> auth.uid()::text then raise exception 'invalid proof path' using errcode = '42501'; end if;
  insert into public.attendance_excuses(session_id, member_id, reason, proof_path, reason_category, notified_at, status)
  values (p_session_id, auth.uid(), trim(p_reason), p_proof_path, p_reason_category, p_notified_at, 'pending')
  on conflict (session_id, member_id) do update set
    reason = excluded.reason,
    proof_path = excluded.proof_path,
    reason_category = excluded.reason_category,
    notified_at = excluded.notified_at,
    status = 'pending',
    submitted_at = now(),
    reviewed_by = null,
    reviewed_at = null,
    review_note = null
  returning * into result;
  return result;
end;
$$;
revoke all on function public.submit_attendance_excuse(bigint, text, text, text, timestamptz) from public, anon;
grant execute on function public.submit_attendance_excuse(bigint, text, text, text, timestamptz) to authenticated;

create or replace function public.review_attendance_excuse(p_excuse_id bigint, p_decision text, p_note text default '')
returns public.attendance_excuses language plpgsql security definer set search_path = '' as $$
declare
  result public.attendance_excuses;
begin
  if not private.is_executive() then raise exception 'executive permission required' using errcode = '42501'; end if;
  if p_decision not in ('approved', 'denied') then raise exception 'decision must be approved or denied'; end if;
  update public.attendance_excuses
  set status = p_decision::public.attendance_excuse_status,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = nullif(trim(p_note), '')
  where id = p_excuse_id and status = 'pending'
  returning * into result;
  if not found then raise exception 'excuse not found or already reviewed'; end if;

  if p_decision = 'approved' then
    insert into public.attendance_records(session_id, member_id, status, source, note, marked_by, marked_at)
    values (result.session_id, result.member_id, 'excused', 'excuse_approval', coalesce(nullif(trim(p_note), ''), 'Excuse approved'), auth.uid(), now())
    on conflict (session_id, member_id) do update set
      status = case when public.attendance_records.status = 'present' then public.attendance_records.status else 'excused' end,
      source = case when public.attendance_records.status = 'present' then public.attendance_records.source else 'excuse_approval' end,
      note = case when public.attendance_records.status = 'present' then public.attendance_records.note else excluded.note end,
      marked_by = case when public.attendance_records.status = 'present' then public.attendance_records.marked_by else auth.uid() end,
      marked_at = case when public.attendance_records.status = 'present' then public.attendance_records.marked_at else now() end,
      updated_at = now();
  else
    insert into public.attendance_records(session_id, member_id, status, source, note, marked_by, marked_at)
    values (result.session_id, result.member_id, 'absent', 'executive', coalesce(nullif(trim(p_note), ''), 'Absence form denied'), auth.uid(), now())
    on conflict (session_id, member_id) do update set
      status = case when public.attendance_records.status = 'present' then public.attendance_records.status else 'absent' end,
      source = case when public.attendance_records.status = 'present' then public.attendance_records.source else 'executive' end,
      note = case when public.attendance_records.status = 'present' then public.attendance_records.note else excluded.note end,
      marked_by = case when public.attendance_records.status = 'present' then public.attendance_records.marked_by else auth.uid() end,
      marked_at = case when public.attendance_records.status = 'present' then public.attendance_records.marked_at else now() end,
      updated_at = now();
  end if;
  return result;
end;
$$;
revoke all on function public.review_attendance_excuse(bigint, text, text) from public, anon;
grant execute on function public.review_attendance_excuse(bigint, text, text) to authenticated;

create or replace function public.set_attendance_remediation(
  p_remediation_id bigint,
  p_status public.attendance_remediation_status,
  p_assignment text default null,
  p_due_at timestamptz default null,
  p_note text default null
)
returns public.attendance_remediations language plpgsql security definer set search_path = '' as $$
declare result public.attendance_remediations;
begin
  if not private.is_executive() then raise exception 'executive permission required' using errcode = '42501'; end if;
  update public.attendance_remediations set
    status = p_status,
    assignment = coalesce(nullif(trim(p_assignment), ''), assignment),
    due_at = coalesce(p_due_at, due_at),
    note = coalesce(nullif(trim(p_note), ''), note),
    assigned_by = auth.uid(),
    completed_by = case when p_status in ('complete', 'waived') then auth.uid() else null end,
    completed_at = case when p_status in ('complete', 'waived') then now() else null end,
    updated_at = now()
  where id = p_remediation_id returning * into result;
  if not found then raise exception 'remediation not found'; end if;
  return result;
end;
$$;
revoke all on function public.set_attendance_remediation(bigint, public.attendance_remediation_status, text, timestamptz, text) from public, anon;
grant execute on function public.set_attendance_remediation(bigint, public.attendance_remediation_status, text, timestamptz, text) to authenticated;

create or replace function public.set_attendance_eligibility(
  p_term_key text,
  p_member_id uuid,
  p_status public.attendance_eligibility_status,
  p_reason text default null
)
returns public.attendance_eligibility language plpgsql security definer set search_path = '' as $$
declare result public.attendance_eligibility;
begin
  if not private.is_executive() then raise exception 'executive permission required' using errcode = '42501'; end if;
  insert into public.attendance_eligibility(term_key, member_id, status, reason, updated_by)
  values (trim(p_term_key), p_member_id, p_status, nullif(trim(p_reason), ''), auth.uid())
  on conflict (term_key, member_id) do update set
    status = excluded.status,
    reason = excluded.reason,
    updated_by = auth.uid(),
    updated_at = now()
  returning * into result;
  return result;
end;
$$;
revoke all on function public.set_attendance_eligibility(text, uuid, public.attendance_eligibility_status, text) from public, anon;
grant execute on function public.set_attendance_eligibility(text, uuid, public.attendance_eligibility_status, text) to authenticated;
