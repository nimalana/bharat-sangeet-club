-- Workspace-scoped, self-service attendance with private absence excuses.
create extension if not exists pgcrypto with schema extensions;

create type public.attendance_scope as enum ('club', 'subgroup');
create type public.attendance_session_status as enum ('draft', 'open', 'closed', 'canceled');
create type public.attendance_mark_source as enum ('self_check_in', 'executive', 'session_close', 'excuse_approval');
create type public.attendance_excuse_status as enum ('pending', 'approved', 'denied');

-- Legacy sessions become closed subgroup sessions and remain visible, but they
-- are excluded from metrics because a reliable historical roster snapshot does
-- not exist for them.
alter table public.attendance_sessions alter column subgroup_id drop not null;
alter table public.attendance_sessions drop constraint if exists attendance_sessions_subgroup_id_session_date_title_key;
alter table public.attendance_sessions add column scope public.attendance_scope not null default 'subgroup';
alter table public.attendance_sessions add column status public.attendance_session_status not null default 'closed';
alter table public.attendance_sessions add column starts_at timestamptz;
alter table public.attendance_sessions add column opened_at timestamptz;
alter table public.attendance_sessions add column closes_at timestamptz;
alter table public.attendance_sessions add column closed_at timestamptz;
alter table public.attendance_sessions add column canceled_at timestamptz;
alter table public.attendance_sessions add column code_hash text;
alter table public.attendance_sessions add column code_expires_at timestamptz;
alter table public.attendance_sessions add column roster_count integer not null default 0;
alter table public.attendance_sessions add column counts_toward_metrics boolean not null default false;
update public.attendance_sessions set starts_at = session_date::timestamp at time zone 'America/New_York', closed_at = created_at where starts_at is null;
alter table public.attendance_sessions alter column starts_at set not null;
alter table public.attendance_sessions add constraint attendance_session_scope_check check ((scope = 'club' and subgroup_id is null) or (scope = 'subgroup' and subgroup_id is not null));
alter table public.attendance_sessions add constraint attendance_session_code_check check ((status = 'open' and code_hash is not null and code_expires_at is not null) or status <> 'open');
create unique index attendance_one_open_session_per_scope_idx on public.attendance_sessions(scope, coalesce(subgroup_id, 0)) where status = 'open';
create index attendance_sessions_scope_starts_idx on public.attendance_sessions(scope, subgroup_id, starts_at desc);

create table public.attendance_session_participants (
  session_id bigint not null references public.attendance_sessions(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  snapshotted_at timestamptz not null default now(),
  primary key (session_id, member_id)
);
create index attendance_participants_member_idx on public.attendance_session_participants(member_id, session_id);

alter table public.attendance_records add column source public.attendance_mark_source not null default 'executive';
alter table public.attendance_records add column note text;
alter table public.attendance_records add column updated_at timestamptz not null default now();

create table public.attendance_record_audit (
  id bigint generated always as identity primary key,
  session_id bigint not null references public.attendance_sessions(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  previous_status public.attendance_status,
  new_status public.attendance_status not null,
  source public.attendance_mark_source not null,
  note text,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index attendance_audit_session_idx on public.attendance_record_audit(session_id, changed_at desc);

create table public.attendance_excuses (
  id bigint generated always as identity primary key,
  session_id bigint not null references public.attendance_sessions(id) on delete cascade,
  member_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (char_length(reason) between 10 and 3000),
  proof_path text not null,
  status public.attendance_excuse_status not null default 'pending',
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  unique (session_id, member_id)
);
create index attendance_excuses_status_idx on public.attendance_excuses(status, submitted_at);

create table public.attendance_settings (
  id boolean primary key default true check (id),
  warning_absences integer not null default 2 check (warning_absences > 0),
  critical_absences integer not null default 3 check (critical_absences > warning_absences),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.attendance_settings (id) values (true) on conflict do nothing;

-- Replace the legacy subgroup-membership validator with roster-snapshot
-- validation, which also supports full-club meetings.
drop trigger if exists validate_attendance_member on public.attendance_records;
drop function if exists private.validate_attendance_member();
create function private.validate_attendance_participant()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.attendance_session_participants where session_id = new.session_id and member_id = new.member_id) then
    raise exception 'member is not eligible for this attendance session' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.validate_attendance_participant() from public;
create trigger validate_attendance_participant before insert or update of session_id, member_id, status on public.attendance_records for each row execute procedure private.validate_attendance_participant();

alter table public.attendance_session_participants enable row level security;
alter table public.attendance_record_audit enable row level security;
alter table public.attendance_excuses enable row level security;
alter table public.attendance_settings enable row level security;

-- Replace attendance policies: executives administer every workspace, while
-- members see sessions where they were snapshotted and only their own records.
drop policy if exists "Members view active subgroup sessions" on public.attendance_sessions;
drop policy if exists "Members view their subgroup sessions" on public.attendance_sessions;
drop policy if exists "Executives manage attendance sessions" on public.attendance_sessions;
drop policy if exists "Managers manage their subgroup sessions" on public.attendance_sessions;
drop policy if exists "Members view own attendance" on public.attendance_records;
drop policy if exists "Executives manage attendance" on public.attendance_records;
drop policy if exists "Managers manage their subgroup attendance" on public.attendance_records;

create policy "Members view eligible attendance sessions" on public.attendance_sessions for select to authenticated using (
  private.is_executive() or exists (select 1 from public.attendance_session_participants where session_id = attendance_sessions.id and member_id = (select auth.uid()))
);
create policy "Executives manage attendance sessions" on public.attendance_sessions for all to authenticated using (private.is_executive()) with check (private.is_executive());
create policy "Members view attendance participation" on public.attendance_session_participants for select to authenticated using (private.is_executive() or member_id = (select auth.uid()));
create policy "Executives manage attendance participation" on public.attendance_session_participants for all to authenticated using (private.is_executive()) with check (private.is_executive());
create policy "Members view own attendance records" on public.attendance_records for select to authenticated using (private.is_executive() or member_id = (select auth.uid()));
create policy "Executives manage attendance records" on public.attendance_records for all to authenticated using (private.is_executive()) with check (private.is_executive());
create policy "Executives view attendance audit" on public.attendance_record_audit for select to authenticated using (private.is_executive());
create policy "Members view own excuses" on public.attendance_excuses for select to authenticated using (private.is_executive() or member_id = (select auth.uid()));
create policy "Executives manage excuses" on public.attendance_excuses for all to authenticated using (private.is_executive()) with check (private.is_executive());
create policy "Members view attendance thresholds" on public.attendance_settings for select to authenticated using (true);
create policy "Executives manage attendance thresholds" on public.attendance_settings for all to authenticated using (private.is_executive()) with check (private.is_executive());

grant select on public.attendance_session_participants, public.attendance_settings to authenticated;
grant select on public.attendance_excuses to authenticated;
grant select on public.attendance_record_audit to authenticated;
grant usage, select on all sequences in schema public to authenticated;

create or replace function private.attendance_code()
returns text language sql volatile set search_path = '' as $$
  select lpad((floor(random() * 1000000))::integer::text, 6, '0');
$$;
revoke all on function private.attendance_code() from public;

create or replace function private.audit_attendance_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.attendance_record_audit(session_id, member_id, previous_status, new_status, source, note, changed_by)
  values (new.session_id, new.member_id, case when tg_op = 'UPDATE' then old.status else null end, new.status, new.source, new.note, auth.uid());
  return new;
end;
$$;
revoke all on function private.audit_attendance_change() from public;
create trigger audit_attendance_change after insert or update of status on public.attendance_records for each row execute procedure private.audit_attendance_change();

create or replace function public.create_attendance_session(p_scope text, p_subgroup_id bigint, p_title text, p_starts_at timestamptz)
returns public.attendance_sessions language plpgsql security definer set search_path = '' as $$
declare result public.attendance_sessions;
begin
  if not private.is_executive() then raise exception 'executive permission required' using errcode = '42501'; end if;
  if p_scope not in ('club','subgroup') or (p_scope = 'club' and p_subgroup_id is not null) or (p_scope = 'subgroup' and p_subgroup_id is null) then raise exception 'invalid attendance workspace'; end if;
  if p_scope = 'subgroup' and not exists (select 1 from public.subgroups where id = p_subgroup_id) then raise exception 'subgroup not found'; end if;
  insert into public.attendance_sessions(scope, subgroup_id, title, session_date, starts_at, status, created_by, counts_toward_metrics)
  values (p_scope::public.attendance_scope, p_subgroup_id, trim(p_title), (p_starts_at at time zone 'America/New_York')::date, p_starts_at, 'draft', auth.uid(), true)
  returning * into result;
  return result;
end;
$$;

create or replace function public.open_attendance_session(p_session_id bigint, p_duration_minutes integer default 60)
returns table(session_id bigint, check_in_code text, code_expires_at timestamptz, eligible_count integer)
language plpgsql security definer set search_path = '' as $$
declare target public.attendance_sessions; generated_code text;
begin
  if not private.is_executive() then raise exception 'executive permission required' using errcode = '42501'; end if;
  if p_duration_minutes not between 5 and 240 then raise exception 'duration must be between 5 and 240 minutes'; end if;
  select * into target from public.attendance_sessions where id = p_session_id for update;
  if not found or target.status not in ('draft','open') then raise exception 'session cannot be opened'; end if;
  if exists (select 1 from public.attendance_sessions where status = 'open' and scope = target.scope and coalesce(subgroup_id,0) = coalesce(target.subgroup_id,0) and id <> target.id) then raise exception 'this workspace already has an open attendance session'; end if;
  delete from public.attendance_session_participants where session_id = target.id and target.status = 'draft';
  if target.scope = 'club' then
    insert into public.attendance_session_participants(session_id, member_id) select target.id, id from public.profiles on conflict do nothing;
  else
    insert into public.attendance_session_participants(session_id, member_id) select target.id, member_id from public.subgroup_memberships where subgroup_id = target.subgroup_id and status = 'active' on conflict do nothing;
  end if;
  generated_code := private.attendance_code();
  update public.attendance_sessions set status='open', opened_at=coalesce(opened_at,now()), closes_at=now()+make_interval(mins=>p_duration_minutes), code_expires_at=now()+make_interval(mins=>p_duration_minutes), code_hash=extensions.crypt(generated_code, extensions.gen_salt('bf')), roster_count=(select count(*) from public.attendance_session_participants where session_id=target.id), counts_toward_metrics=true where id=target.id;
  return query select target.id, generated_code, s.code_expires_at, s.roster_count from public.attendance_sessions s where s.id=target.id;
end;
$$;

create or replace function public.rotate_attendance_code(p_session_id bigint)
returns table(session_id bigint, check_in_code text, code_expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare generated_code text;
begin
  if not private.is_executive() then raise exception 'executive permission required' using errcode = '42501'; end if;
  if not exists (select 1 from public.attendance_sessions where id=p_session_id and status='open') then raise exception 'session is not open'; end if;
  generated_code := private.attendance_code();
  update public.attendance_sessions set code_hash=extensions.crypt(generated_code,extensions.gen_salt('bf')), code_expires_at=greatest(coalesce(closes_at,now()+interval '60 minutes'),now()+interval '5 minutes') where id=p_session_id;
  return query select p_session_id, generated_code, s.code_expires_at from public.attendance_sessions s where s.id=p_session_id;
end;
$$;

create or replace function public.check_in_attendance(p_code text)
returns public.attendance_records language plpgsql security definer set search_path = '' as $$
declare target public.attendance_sessions; result public.attendance_records;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '42501'; end if;
  select * into target from public.attendance_sessions where status='open' and code_expires_at > now() and code_hash = extensions.crypt(trim(p_code), code_hash) order by opened_at desc limit 1;
  if not found then raise exception 'The code is invalid or has expired'; end if;
  if not exists (select 1 from public.attendance_session_participants where session_id=target.id and member_id=auth.uid()) then raise exception 'You are not eligible for this meeting' using errcode = '42501'; end if;
  insert into public.attendance_records(session_id,member_id,status,source,note,marked_by,marked_at)
  values(target.id,auth.uid(),'present','self_check_in','Checked in with meeting code',auth.uid(),now())
  on conflict(session_id,member_id) do update set status='present',source='self_check_in',note='Checked in with meeting code',marked_by=auth.uid(),marked_at=now(),updated_at=now()
  returning * into result;
  return result;
end;
$$;

create or replace function public.close_attendance_session(p_session_id bigint)
returns public.attendance_sessions language plpgsql security definer set search_path = '' as $$
declare result public.attendance_sessions;
begin
  if not private.is_executive() then raise exception 'executive permission required' using errcode = '42501'; end if;
  if not exists (select 1 from public.attendance_sessions where id=p_session_id and status='open') then raise exception 'session is not open'; end if;
  insert into public.attendance_records(session_id,member_id,status,source,note,marked_by,marked_at)
  select p_session_id,p.member_id,'absent','session_close','Automatically marked absent when check-in closed',auth.uid(),now() from public.attendance_session_participants p
  where p.session_id=p_session_id and not exists(select 1 from public.attendance_records r where r.session_id=p.session_id and r.member_id=p.member_id);
  update public.attendance_sessions set status='closed',closed_at=now(),code_hash=null,code_expires_at=null where id=p_session_id returning * into result;
  return result;
end;
$$;

create or replace function public.cancel_attendance_session(p_session_id bigint)
returns public.attendance_sessions language plpgsql security definer set search_path = '' as $$
declare result public.attendance_sessions;
begin
  if not private.is_executive() then raise exception 'executive permission required' using errcode = '42501'; end if;
  update public.attendance_sessions set status='canceled',canceled_at=now(),code_hash=null,code_expires_at=null,counts_toward_metrics=false where id=p_session_id and status in ('draft','open') returning * into result;
  if not found then raise exception 'session cannot be canceled'; end if;
  return result;
end;
$$;

create or replace function public.set_attendance_status(p_session_id bigint,p_member_id uuid,p_status public.attendance_status,p_note text default '')
returns public.attendance_records language plpgsql security definer set search_path = '' as $$
declare result public.attendance_records;
begin
  if not private.is_executive() then raise exception 'executive permission required' using errcode = '42501'; end if;
  if not exists(select 1 from public.attendance_session_participants where session_id=p_session_id and member_id=p_member_id) then raise exception 'member is not in this session'; end if;
  insert into public.attendance_records(session_id,member_id,status,source,note,marked_by,marked_at) values(p_session_id,p_member_id,p_status,'executive',nullif(trim(p_note),''),auth.uid(),now())
  on conflict(session_id,member_id) do update set status=excluded.status,source='executive',note=excluded.note,marked_by=auth.uid(),marked_at=now(),updated_at=now() returning * into result;
  return result;
end;
$$;

create or replace function public.submit_attendance_excuse(p_session_id bigint,p_reason text,p_proof_path text)
returns public.attendance_excuses language plpgsql security definer set search_path = '' as $$
declare result public.attendance_excuses;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if not exists(select 1 from public.attendance_session_participants where session_id=p_session_id and member_id=auth.uid()) then raise exception 'You were not on this meeting roster'; end if;
  if p_proof_path is null or split_part(p_proof_path,'/',1) <> auth.uid()::text then raise exception 'invalid proof path' using errcode = '42501'; end if;
  insert into public.attendance_excuses(session_id,member_id,reason,proof_path,status) values(p_session_id,auth.uid(),trim(p_reason),p_proof_path,'pending')
  on conflict(session_id,member_id) do update set reason=excluded.reason,proof_path=excluded.proof_path,status='pending',submitted_at=now(),reviewed_by=null,reviewed_at=null,review_note=null returning * into result;
  return result;
end;
$$;

create or replace function public.review_attendance_excuse(p_excuse_id bigint,p_decision text,p_note text default '')
returns public.attendance_excuses language plpgsql security definer set search_path = '' as $$
declare result public.attendance_excuses;
begin
  if not private.is_executive() then raise exception 'executive permission required' using errcode = '42501'; end if;
  if p_decision not in ('approved','denied') then raise exception 'decision must be approved or denied'; end if;
  update public.attendance_excuses set status=p_decision::public.attendance_excuse_status,reviewed_by=auth.uid(),reviewed_at=now(),review_note=nullif(trim(p_note),'') where id=p_excuse_id returning * into result;
  if not found then raise exception 'excuse not found'; end if;
  if p_decision='approved' then
    insert into public.attendance_records(session_id,member_id,status,source,note,marked_by,marked_at) values(result.session_id,result.member_id,'excused','excuse_approval',coalesce(nullif(trim(p_note),''),'Excuse approved'),auth.uid(),now())
    on conflict(session_id,member_id) do update set status='excused',source='excuse_approval',note=excluded.note,marked_by=auth.uid(),marked_at=now(),updated_at=now();
  end if;
  return result;
end;
$$;

revoke all on function public.create_attendance_session(text,bigint,text,timestamptz) from public,anon;
revoke all on function public.open_attendance_session(bigint,integer) from public,anon;
revoke all on function public.rotate_attendance_code(bigint) from public,anon;
revoke all on function public.check_in_attendance(text) from public,anon;
revoke all on function public.close_attendance_session(bigint) from public,anon;
revoke all on function public.cancel_attendance_session(bigint) from public,anon;
revoke all on function public.set_attendance_status(bigint,uuid,public.attendance_status,text) from public,anon;
revoke all on function public.submit_attendance_excuse(bigint,text,text) from public,anon;
revoke all on function public.review_attendance_excuse(bigint,text,text) from public,anon;
grant execute on function public.create_attendance_session(text,bigint,text,timestamptz), public.open_attendance_session(bigint,integer), public.rotate_attendance_code(bigint), public.check_in_attendance(text), public.close_attendance_session(bigint), public.cancel_attendance_session(bigint), public.set_attendance_status(bigint,uuid,public.attendance_status,text), public.submit_attendance_excuse(bigint,text,text), public.review_attendance_excuse(bigint,text,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('attendance-excuses','attendance-excuses',false,8388608,array['image/jpeg','image/png','image/webp','image/heic','image/heif']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy "Members upload own attendance excuse proof" on storage.objects for insert to authenticated with check(bucket_id='attendance-excuses' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "Members read permitted attendance excuse proof" on storage.objects for select to authenticated using(bucket_id='attendance-excuses' and ((storage.foldername(name))[1]=(select auth.uid())::text or private.is_executive()));
create policy "Members replace own attendance excuse proof" on storage.objects for update to authenticated using(bucket_id='attendance-excuses' and (storage.foldername(name))[1]=(select auth.uid())::text) with check(bucket_id='attendance-excuses' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "Members delete own attendance excuse proof" on storage.objects for delete to authenticated using(bucket_id='attendance-excuses' and ((storage.foldername(name))[1]=(select auth.uid())::text or private.is_executive()));
