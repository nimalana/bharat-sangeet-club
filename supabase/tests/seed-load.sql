-- Load-test dataset for the Phase 2 performance work (plan 2.5 and 2.7).
--
-- NOT a migration. Run it only on a throwaway database that has had every
-- migration applied (scripts/db-perf.sh does this). It refuses to run twice.
--
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/seed-load.sql
--   psql -v anchor="'2027-03-01 12:00:00+00'" ...   (optional: move "today")
--
-- What it builds (numbers are asserted at the end of the script):
--   500 members   3 admins, 12 executives, 485 members; 24 deactivated; every
--                 member in 1-3 of 12 subgroups (one archived) with a spread of
--                 member / leader / manager roles and active / pending /
--                 waitlisted / inactive / removed memberships
--   5,000 recordings (60% published, 25% draft, 15% archived; subgroup, club
--                 and public audiences) + 1,500 notes
--   2,000 resources: 312 folders in three levels (the maximum), 1,600 files,
--                 88 links; members and executives-only visibility; some archived,
--                 pending or failed
--   20,000 attendance records (and as many participant rows) over four terms,
--                 one of them older than the 18-month window of the workspace
--                 call, plus excuses, remediations and eligibility rows
--   finance: 1,500 payments (the ledger), 1,200 expenses, 300 reimbursements,
--                 30 funding claims, 800 documents, 150 legacy transactions
--   300 events, 400 announcements, 300 archive items, 2,000 admin audit rows,
--                 3,000 finance audit rows, ~9,000 storage.objects rows
--
-- Deterministic: no random(), no now(). Every value derives from the row
-- number through a hash, and every date from the anchor below, so two runs
-- produce identical rows (ids included) on the same PostgreSQL major version.
-- Members are md5('bsc-member-<i>')::uuid for i = 1..500.

\if :{?anchor}
\else
  \set anchor '''2026-11-27 12:00:00+00'''
\endif

do $$ begin
  if (select count(*) from public.profiles) > 1 then
    raise exception 'seed-load.sql: this database already holds data; run it on a freshly migrated database';
  end if;
end $$;

\set QUIET on
set client_min_messages = warning;
set time zone 'UTC';
set search_path = public, extensions;
set statement_timeout = 0;

create temp table seed_ctx as select :anchor::timestamptz as anchor;
create function pg_temp.anchor() returns timestamptz language sql stable as $$ select anchor from seed_ctx $$;
-- Deterministic pseudo-random integer in [0, n) derived from a text key.
create function pg_temp.h(key text, n integer) returns integer language sql immutable as
  $$ select (abs(hashtextextended(key, 7)) % n)::integer $$;
-- Member number -> id.
create function pg_temp.member(i bigint) returns uuid language sql immutable as
  $$ select md5('bsc-member-' || i)::uuid $$;
-- A member number in 16..499 that is not a deactivated one (i % 20 = 0).
create function pg_temp.ordinary(key text) returns integer language sql immutable as $$
  select case when (16 + pg_temp.h(key, 484)) % 20 = 0 then 17 + pg_temp.h(key, 484) else 16 + pg_temp.h(key, 484) end $$;

-- User triggers (audit, updated_at, validation, "deactivated writer") are
-- bypassed while loading; foreign keys and check constraints stay enforced.
do $$
declare t record;
begin
  for t in select format('%I.%I', schemaname, tablename) as name from pg_tables
           where schemaname = 'public' loop
    execute format('alter table %s disable trigger user', t.name);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Members
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data, created_at)
select pg_temp.member(i), 'member' || i || '@seed.invalid',
       jsonb_build_object('full_name', (array['Anjali','Arjun','Bhavana','Chetan','Deepa','Ganesh','Hari','Indira','Jaya','Karthik','Lakshmi','Mohan','Nandini','Om','Padma','Raghav','Sangeeta','Tara','Uma','Venkat','Yamini','Aditya','Divya','Kavya','Meera'])[1 + pg_temp.h('first' || i, 25)]
         || ' ' || (array['Iyer','Rao','Menon','Nair','Sharma','Reddy','Pillai','Krishnan','Bhat','Murthy','Subramanian','Venkatesh','Natarajan','Ramesh','Srinivasan','Gopal','Hegde','Kulkarni','Shetty','Varma'])[1 + pg_temp.h('last' || i, 20)]),
       pg_temp.anchor() - (1000 - i) * interval '1 day'
from generate_series(1, 500) i;
-- (the sign-up trigger created one profile per user)

update public.profiles p set
  role = case when n.i <= 3 then 'admin'::public.club_role when n.i <= 15 then 'executive' else 'member' end,
  joined_at = pg_temp.anchor() - (1000 - n.i) * interval '1 day',
  phone = '555-01' || lpad(n.i::text, 2, '0'),
  class_year = (array['2026','2027','2028','2029','Graduate'])[1 + pg_temp.h('year' || n.i, 5)],
  specialty = (array['Vocal','Veena','Violin','Mridangam','Flute','Kanjira','Sitar','Tabla','Dance',''])[1 + pg_temp.h('spec' || n.i, 10)],
  status = case when n.i > 15 and n.i % 20 = 0 then 'deactivated' else 'active' end,
  deactivated_at = case when n.i > 15 and n.i % 20 = 0 then pg_temp.anchor() - (n.i % 90) * interval '1 day' end,
  deactivated_by = case when n.i > 15 and n.i % 20 = 0 then pg_temp.member(1) end,
  deactivation_reason = case when n.i > 15 and n.i % 20 = 0 then 'Left the club' else '' end
from (select i, pg_temp.member(i) as id from generate_series(1, 500) i) n
where p.id = n.id;

-- ---------------------------------------------------------------------------
-- Subgroups and memberships
-- ---------------------------------------------------------------------------
insert into public.subgroups (id, name, description, created_by, created_at, enrollment_mode, archived_at, archived_by)
overriding system value
select g, (array['Carnatic Vocal','Veena','Violin','Mridangam','Flute','Kanjira','Hindustani Vocal','Sitar','Tabla','Bharatanatyam','Ghatam','Keyboard'])[g],
       'Practice group ' || g, pg_temp.member(1), pg_temp.anchor() - interval '900 days',
       (array['open','approval','invite'])[1 + g % 3]::public.subgroup_enrollment_mode,
       case when g = 12 then pg_temp.anchor() - interval '60 days' end,
       case when g = 12 then pg_temp.member(1) end
from generate_series(1, 12) g;

insert into public.subgroup_memberships (subgroup_id, member_id, added_by, joined_at, status, membership_role, status_updated_at)
select distinct on (subgroup_id, member_id) subgroup_id, member_id, pg_temp.member(1),
       pg_temp.anchor() - (700 - i) * interval '1 day', status::public.subgroup_membership_status, role::public.subgroup_membership_role,
       pg_temp.anchor() - (300 - i % 250) * interval '1 day'
from (
  select 1 as pri, i, pg_temp.member(i) as member_id, i % 12 + 1 as subgroup_id,
         case when i % 29 = 0 then 'inactive' else 'active' end as status,
         case when i <= 24 then 'manager' when i <= 60 then 'leader' else 'member' end as role
  from generate_series(1, 500) i
  union all
  select 2, i, pg_temp.member(i), (i * 5 + 3) % 12 + 1,
         case when i % 13 = 0 then 'pending' when i % 17 = 0 then 'waitlisted' else 'active' end, 'member'
  from generate_series(1, 500) i where i % 2 = 0
  union all
  select 3, i, pg_temp.member(i), (i * 7 + 5) % 12 + 1, case when i % 11 = 0 then 'removed' else 'active' end, 'member'
  from generate_series(1, 500) i where i % 5 = 0
) m
order by subgroup_id, member_id, pri;

-- ---------------------------------------------------------------------------
-- Calendar and announcements
-- ---------------------------------------------------------------------------
insert into public.events (id, title, description, starts_at, location, created_by, created_at, subgroup_id, updated_at)
overriding system value
select i, (array['Weekly rehearsal','Concert','Workshop','Guest lecture','Open mic','Recording session','Committee meeting'])[1 + i % 7] || ' ' || i,
       'Event ' || i || ' details', pg_temp.anchor() - interval '700 days' + i * interval '72 hours', 'Room ' || (1 + i % 20),
       pg_temp.member(4 + i % 12), pg_temp.anchor() - interval '720 days' + i * interval '72 hours',
       case when i % 20 in (1, 2, 3, 4, 5, 6, 7) then 1 + pg_temp.h('event' || i, 12) end,
       pg_temp.anchor() - interval '720 days' + i * interval '72 hours'
from generate_series(1, 300) i;

insert into public.announcements (id, title, body, is_pinned, published_at, created_by, created_at, updated_at, subgroup_id)
overriding system value
select i, 'Announcement ' || i, 'Body of announcement ' || i || '. ' || repeat('Please read. ', 8), i % 20 = 0,
       pg_temp.anchor() - (400 - i) * interval '36 hours', pg_temp.member(4 + i % 12),
       pg_temp.anchor() - (400 - i) * interval '36 hours', pg_temp.anchor() - (400 - i) * interval '36 hours',
       case when i % 5 in (1, 3) then 1 + pg_temp.h('ann' || i, 12) end
from generate_series(1, 400) i;

-- ---------------------------------------------------------------------------
-- Recordings (5,000) and notes (1,500)
-- ---------------------------------------------------------------------------
insert into public.recordings (id, title, description, subgroup_id, uploaded_by, storage_path, mime_type, media_kind,
  status, audience, recording_kind, event_date, raga, tala, sruthi, tempo, duration_seconds, created_at, updated_at, published_at, storage_bucket)
overriding system value
select r.i,
       r.raga || ' ' || r.kind || ' take ' || r.i,
       'Notes for ' || r.raga || ' in ' || r.tala || ' (recording ' || r.i || ')',
       r.subgroup_id, pg_temp.member(r.uploader),
       'recordings/' || pg_temp.member(r.uploader) || '/' || r.i || '.webm',
       'audio/webm', case when r.i % 9 = 0 then 'video' else 'audio' end,
       r.status::public.recording_status,
       case when r.subgroup_id is null then 'club' when r.i % 10 < 7 then 'subgroup' when r.i % 10 < 9 then 'club' else 'public' end,
       r.kind, (pg_temp.anchor() - r.age * interval '1 day')::date, r.raga, r.tala,
       (array['C','C#','D','E','F','G','A'])[1 + r.i % 7], (60 + r.i % 90)::text,
       30 + pg_temp.h('dur' || r.i, 900), pg_temp.anchor() - r.age * interval '1 day' - r.i % 86400 * interval '1 second',
       pg_temp.anchor() - r.age * interval '1 day', case when r.status = 'published' then pg_temp.anchor() - r.age * interval '1 day' end,
       'recordings'
from (
  select i, 1 + pg_temp.h('uploader' || i, 500) as uploader,
         (array['Kalyani','Bhairavi','Todi','Shankarabharanam','Mohanam','Hamsadhwani','Kharaharapriya','Kambhoji','Begada','Sahana','Bilahari','Anandabhairavi'])[1 + pg_temp.h('raga' || i, 12)] as raga,
         (array['Adi','Rupaka','Misra Chapu','Khanda Chapu','Jhampa','Triputa'])[1 + pg_temp.h('tala' || i, 6)] as tala,
         (array['practice','rehearsal','performance','lesson','concert'])[1 + pg_temp.h('kind' || i, 5)] as kind,
         case when i % 100 < 60 then 'published' when i % 100 < 85 then 'draft' else 'archived' end as status,
         1 + pg_temp.h('age' || i, 1000) as age
  from generate_series(1, 5000) i
) r0
cross join lateral (select r0.*, case when r0.uploader <= 15 and r0.i % 2 = 0 then null else r0.uploader % 12 + 1 end as subgroup_id) r;

insert into public.recording_notes (id, recording_id, title, note_type, body, storage_path, mime_type, uploaded_by, created_at)
overriding system value
select i, 1 + (i * 3) % 5000, case when i % 2 = 0 then 'Notation' else 'Lyrics' end, case when i % 2 = 0 then 'file' else 'text' end,
       case when i % 2 = 0 then '' else 'Lyrics line ' || i end,
       case when i % 2 = 0 then 'recording-notations/' || i || '.pdf' end,
       case when i % 2 = 0 then 'application/pdf' end,
       rec.uploaded_by, rec.created_at + interval '1 hour'
from generate_series(1, 1500) i
join public.recordings rec on rec.id = 1 + (i * 3) % 5000;

-- ---------------------------------------------------------------------------
-- Club archive (executive-managed): 200 recordings (40 public), 60 documents, 40 photos
-- ---------------------------------------------------------------------------
insert into public.archive_items (id, title, description, type, storage_path, visibility, event_date, raga, tala, uploaded_by, created_at, is_public, subgroup_id)
overriding system value
select i, 'Archive item ' || i, 'Archive description ' || i,
       (case when i <= 200 then 'recording' when i <= 260 then 'document' else 'photo' end)::public.archive_type,
       'archive/' || i || '/file', case when i % 10 = 0 then 'executives' else 'members' end::public.archive_visibility,
       (pg_temp.anchor() - (i * 3) * interval '1 day')::date,
       (array['Kalyani','Bhairavi','Todi','Mohanam'])[1 + i % 4], (array['Adi','Rupaka'])[1 + i % 2],
       pg_temp.member(4 + i % 12), pg_temp.anchor() - (i * 3) * interval '1 day', i <= 40,
       case when i % 5 = 0 then 1 + i % 12 end
from generate_series(1, 300) i;

-- ---------------------------------------------------------------------------
-- Resources (2,000): ids 1-24 root folders, 101-196 second level, 201-392 third
-- level, 1001-2688 files and links
-- ---------------------------------------------------------------------------
create temp table seed_folders (id bigint primary key, parent_id bigint, subgroup_id bigint, visibility public.archive_visibility, depth int);
insert into seed_folders
select r, null, case when r <= 12 then r end, (case when r >= 19 then 'executives' else 'members' end)::public.archive_visibility, 1
from generate_series(1, 24) r;
insert into seed_folders
select 100 + (f.id - 1) * 4 + k, f.id, f.subgroup_id, f.visibility, 2 from seed_folders f, generate_series(1, 4) k where f.depth = 1;
insert into seed_folders
select 200 + (g.id - 101) * 2 + k, g.id, g.subgroup_id, g.visibility, 3 from seed_folders g, generate_series(1, 2) k where g.depth = 2;

insert into public.resources (id, node_kind, title, description, parent_id, subgroup_id, visibility, status, is_pinned, created_by, created_at, updated_at)
overriding system value
select f.id, 'folder', (array['Repertoire','Notation','Practice tracks','Workshop material','Concert programmes','Theory','History','Forms'])[1 + f.id % 8] || ' ' || f.id,
       '', f.parent_id, f.subgroup_id, f.visibility, 'ready', f.id % 25 = 0, pg_temp.member(4 + f.id % 12),
       pg_temp.anchor() - (800 - f.id) * interval '1 day', pg_temp.anchor() - pg_temp.h('fupd' || f.id, 400) * interval '1 day'
from seed_folders f;

with files as (
  select 1000 + n as id, n,
         case when n % 20 = 0 then null else (select sf.id from (select id, row_number() over (order by id) rn from seed_folders) sf where sf.rn = 1 + pg_temp.h('parent' || n, 312)) end as folder_id
  from generate_series(1, 1688) n
)
insert into public.resources (id, node_kind, media_kind, title, description, parent_id, subgroup_id, visibility, storage_bucket, storage_path,
  external_url, original_filename, mime_type, byte_size, status, is_pinned, created_by, created_at, updated_at)
overriding system value
select f.id,
       case when f.n % 19 = 0 then 'link' else 'file' end::public.resource_node_kind,
       case when f.n % 19 = 0 then null else (array['document','image','other'])[1 + f.n % 3] end::public.resource_media_kind,
       'Resource ' || f.id || ' ' || (array['varnam','kriti','swarajati','tillana','lesson plan','score','poster'])[1 + f.n % 7],
       'Description of resource ' || f.id,
       f.folder_id, sf.subgroup_id,
       coalesce(sf.visibility, (case when f.n % 7 = 0 then 'executives' else 'members' end)::public.archive_visibility),
       case when f.n % 19 = 0 then null else case when f.n % 10 = 0 then 'club-archive' else 'club-resources' end end,
       case when f.n % 19 = 0 then null else 'resources/' || f.id || '/file-' || f.id end,
       case when f.n % 19 = 0 then 'https://example.com/resource/' || f.id end,
       case when f.n % 19 = 0 then null else 'file-' || f.id || '.pdf' end,
       case when f.n % 19 = 0 then null else 'application/pdf' end,
       case when f.n % 19 = 0 then null else 10000 + pg_temp.h('size' || f.id, 5000000) end,
       case when f.n % 19 = 0 then 'ready' when f.n % 100 < 84 then 'ready' when f.n % 100 < 88 then 'pending_upload'
            when f.n % 100 < 91 then 'failed' else 'archived' end::public.resource_status,
       f.n % 33 = 0, pg_temp.member(4 + f.n % 12),
       pg_temp.anchor() - pg_temp.h('fcre' || f.id, 700) * interval '1 day',
       pg_temp.anchor() - pg_temp.h('fupd' || f.id, 400) * interval '1 day'
from files f left join seed_folders sf on sf.id = f.folder_id;

-- ---------------------------------------------------------------------------
-- Attendance: four terms; 20,000 participant rows and as many records
-- ---------------------------------------------------------------------------
create temp table seed_terms (t int primary key, starts date);
insert into seed_terms values (0, date '2025-02-03'), (1, date '2025-09-08'), (2, date '2026-01-26'), (3, date '2026-09-07');

-- Club sessions in weeks 1, 3, 5, 7, 9, 11 and subgroup sessions in weeks 2, 5, 8, 11 of each term.
create temp table seed_sessions as
select row_number() over (order by starts_at, scope, subgroup_id) as id, s.*
from (
  select t.t, 'club'::public.attendance_scope as scope, null::bigint as subgroup_id,
         ((t.starts + ((w - 1) * 7 + 2) * interval '1 day') + time '19:00') at time zone 'America/New_York' as starts_at
  from seed_terms t, unnest(array[1, 3, 5, 7, 9, 11]) w
  union all
  select t.t, 'subgroup', g,
         ((t.starts + ((w - 1) * 7 + 3 + g % 4) * interval '1 day') + time '18:30') at time zone 'America/New_York'
  from seed_terms t, unnest(array[2, 5, 8, 11]) w, generate_series(1, 12) g
) s;

insert into public.attendance_sessions (id, subgroup_id, title, session_date, created_by, created_at, scope, status, starts_at, opened_at,
  closes_at, closed_at, canceled_at, code_hash, code_expires_at, roster_count, counts_toward_metrics, cancel_reason)
overriding system value
select s.id, s.subgroup_id, case when s.scope = 'club' then 'Club meeting ' else 'Group meeting ' end || s.id,
       (s.starts_at at time zone 'America/New_York')::date, pg_temp.member(4 + s.id % 12), s.starts_at - interval '3 days', s.scope,
       case when s.id % 37 = 0 then 'canceled' else 'closed' end::public.attendance_session_status,
       s.starts_at, s.starts_at, s.starts_at + interval '30 minutes', s.starts_at + interval '31 minutes',
       case when s.id % 37 = 0 then s.starts_at - interval '1 hour' end, null, null, 0, s.id % 37 <> 0,
       case when s.id % 37 = 0 then 'Rescheduled' end
from seed_sessions s;
-- One session open right now (club scope) with a check-in code.
insert into public.attendance_sessions (id, title, session_date, created_by, created_at, scope, status, starts_at, opened_at, closes_at,
  code_hash, code_expires_at, roster_count, counts_toward_metrics)
overriding system value
values ((select max(id) + 1 from seed_sessions), 'Club meeting today', (pg_temp.anchor() at time zone 'America/New_York')::date, pg_temp.member(4),
  pg_temp.anchor() - interval '1 day', 'club', 'open', pg_temp.anchor() - interval '10 minutes', pg_temp.anchor() - interval '10 minutes',
  pg_temp.anchor() + interval '20 minutes', md5('seed-code'), pg_temp.anchor() + interval '5 minutes', 0, true);

-- Everyone not deactivated is on the roster of club sessions; active members
-- of the group are on the roster of that group's sessions. The set is cut to
-- exactly 20,000 pairs by hash order so sessions have uneven rosters.
create temp table seed_pairs as
select session_id, member_id, row_number() over (order by pg_temp.h(session_id || ':' || member_id, 1000000000), session_id, member_id) as rn
from (
  select s.id as session_id, pg_temp.member(i) as member_id
  from seed_sessions s, generate_series(1, 500) i
  where s.scope = 'club' and s.id % 37 <> 0 and not (i > 15 and i % 20 = 0)
  union all
  select s.id, m.member_id
  from seed_sessions s
  join public.subgroup_memberships m on m.subgroup_id = s.subgroup_id and m.status = 'active'
  join public.profiles p on p.id = m.member_id and p.status = 'active'
  where s.scope = 'subgroup' and s.id % 37 <> 0
) x;
delete from seed_pairs where rn > 20000;

insert into public.attendance_session_participants (session_id, member_id, snapshotted_at)
select p.session_id, p.member_id, s.starts_at - interval '1 hour' from seed_pairs p join seed_sessions s on s.id = p.session_id;
insert into public.attendance_session_participants (session_id, member_id, snapshotted_at)
select (select max(id) from public.attendance_sessions), id, pg_temp.anchor() - interval '10 minutes' from public.profiles where status = 'active';

insert into public.attendance_records (session_id, member_id, status, marked_by, marked_at, source, note, updated_at, minutes_late, unexcused_units)
select r.session_id, r.member_id, r.status::public.attendance_status, pg_temp.member(4 + r.session_id % 12), s.starts_at + interval '20 minutes',
       case when r.rn % 10 < 3 then 'self_check_in' else 'executive' end::public.attendance_mark_source,
       case when r.rn % 50 = 0 then 'Noted by the secretary' end, s.starts_at + interval '20 minutes',
       case when r.status = 'tardy' then r.late else 0 end,
       case when r.status = 'absent' then 1 when r.status = 'tardy' and r.late > 10 then 0.5 else 0 end
from (
  select p.*, case when p.rn % 100 < 68 then 'present' when p.rn % 100 < 80 then 'absent' when p.rn % 100 < 90 then 'excused' else 'tardy' end as status,
         1 + p.rn % 25 as late
  from seed_pairs p
) r join seed_sessions s on s.id = r.session_id;

update public.attendance_sessions s set roster_count = c.n
from (select session_id, count(*) n from public.attendance_session_participants group by 1) c where c.session_id = s.id;

-- Excuses for 15% of the absences / excused marks, remediations for 30%.
insert into public.attendance_excuses (session_id, member_id, reason, proof_path, status, submitted_at, reviewed_by, reviewed_at, review_note, reason_category, notified_at)
select r.session_id, r.member_id, 'Unable to attend because of reason number ' || r.session_id,
       case when n % 3 = 0 then r.member_id || '/excuse-' || r.session_id || '.pdf' end,
       st::public.attendance_excuse_status, s.starts_at - interval '1 day',
       case when st <> 'pending' then pg_temp.member(4 + n % 12) end, case when st <> 'pending' then s.starts_at + interval '2 days' end,
       case when st <> 'pending' then 'Reviewed' end,
       (array['class_exam','family_emergency','illness','other_club_event','other'])[1 + n % 5], s.starts_at - interval '2 days'
from (
  select r.*, row_number() over (order by r.session_id, r.member_id) as n,
         (array['pending','approved','approved','approved','approved','denied','denied','withdrawn','approved','denied'])[1 + pg_temp.h(r.session_id || r.member_id::text, 10)] as st
  from public.attendance_records r
  where r.status in ('absent', 'excused') and pg_temp.h('x' || r.session_id || r.member_id::text, 100) < 15
) r join seed_sessions s on s.id = r.session_id;

insert into public.attendance_remediations (session_id, member_id, assignment, due_at, status, note, assigned_by, completed_by, completed_at, created_at, updated_at)
select r.session_id, r.member_id, 'Remediation required for this attendance record.', s.starts_at + interval '14 days',
       st::public.attendance_remediation_status, null, pg_temp.member(4 + r.session_id % 12),
       case when st <> 'pending' then pg_temp.member(4 + r.session_id % 12) end, case when st <> 'pending' then s.starts_at + interval '10 days' end,
       s.starts_at + interval '1 day', s.starts_at + interval '1 day'
from (
  select r.*, (array['pending','pending','complete','waived'])[1 + pg_temp.h('st' || r.session_id || r.member_id::text, 4)] as st
  from public.attendance_records r
  where r.status in ('absent', 'excused') and pg_temp.h('rem' || r.session_id || r.member_id::text, 100) < 30
) r join seed_sessions s on s.id = r.session_id;

insert into public.attendance_eligibility (term_key, member_id, status, reason, updated_by, updated_at)
select tk, pg_temp.member(i), (array['under_review','restricted','reinstated'])[1 + pg_temp.h(tk || i, 3)]::public.attendance_eligibility_status,
       'Seeded status', pg_temp.member(4), pg_temp.anchor() - interval '30 days'
from unnest(array['2025-spring','2025-fall','2026-spring','2026-fall']) tk, generate_series(16, 499) i
where pg_temp.h(tk || ':e' || i, 100) < 8;

-- ---------------------------------------------------------------------------
-- Finance
-- ---------------------------------------------------------------------------
insert into public.finance_expenses (id, description, vendor, amount, purchase_date, category, paid_by, paid_by_member_id, payment_card_last4,
  subgroup_id, status, notes, created_by, approved_by, approved_at, void_reason, created_at, updated_at, voided_by, voided_at)
overriding system value
select e.i, 'Expense ' || e.i || ' for ' || e.category, (array['Amazon','Costco','Guitar Center','Staples','Local caterer','Print shop'])[1 + e.i % 6],
       (5 + pg_temp.h('amt' || e.i, 80000) / 100.0)::numeric(12,2), (pg_temp.anchor() - e.age * interval '1 day')::date, e.category,
       case when e.i % 4 = 0 then 'member' else 'club' end,
       case when e.i % 4 = 0 then pg_temp.member(pg_temp.ordinary('payer' || e.i)) end,
       case when e.i % 4 <> 0 then lpad((1000 + e.i % 9000)::text, 4, '0') end,
       case when e.i % 5 in (1, 2) then 1 + pg_temp.h('xsg' || e.i, 12) end,
       e.status, '', pg_temp.member(4 + e.i % 12),
       case when e.status in ('approved', 'settled') then pg_temp.member(4 + e.i % 12) end,
       case when e.status in ('approved', 'settled') then pg_temp.anchor() - (e.age - 1) * interval '1 day' end,
       case when e.status = 'voided' then 'Entered twice' end,
       pg_temp.anchor() - e.age * interval '1 day', pg_temp.anchor() - e.age * interval '1 day',
       case when e.status = 'voided' then pg_temp.member(4) end, case when e.status = 'voided' then pg_temp.anchor() - (e.age - 2) * interval '1 day' end
from (
  select i, 3 + pg_temp.h('age' || i, 700) as age,
         (array['Instruments','Food','Venue','Printing','Travel','Equipment','Supplies','Fees'])[1 + i % 8] as category,
         case when i % 100 < 5 then 'draft' when i % 100 < 15 then 'submitted' when i % 100 < 60 then 'approved'
              when i % 100 < 65 then 'rejected' when i % 100 < 95 then 'settled' else 'voided' end as status
  from generate_series(1, 1200) i
) e;

insert into public.personal_reimbursements (id, expense_id, member_id, requested_amount, approved_amount, status, member_note, review_note,
  reviewed_by, reviewed_at, paid_at, created_at, updated_at, void_reason, voided_by, voided_at)
overriding system value
select row_number() over (order by x.id), x.id, x.paid_by_member_id, x.amount,
       case when st in ('approved', 'paid') then x.amount end, st, 'Receipt attached', '',
       case when st in ('approved', 'paid', 'rejected') then pg_temp.member(4 + x.id % 12) end,
       case when st in ('approved', 'paid', 'rejected') then x.created_at + interval '2 days' end,
       case when st = 'paid' then x.created_at + interval '5 days' end,
       x.created_at, x.created_at + interval '1 day',
       case when st = 'voided' then 'Duplicate request' end, case when st = 'voided' then pg_temp.member(4) end,
       case when st = 'voided' then x.created_at + interval '3 days' end
from (
  select e.*, (array['submitted','submitted','changes_requested','approved','approved','rejected','paid','paid','paid','paid','paid','paid','paid','paid','voided','paid'])[1 + pg_temp.h('rst' || e.id, 16)] as st
  from public.finance_expenses e where e.paid_by = 'member'
) x;

create temp table seed_club_expenses as
select row_number() over (order by id) rn, id, amount from public.finance_expenses where paid_by = 'club' and status in ('approved', 'settled');
create temp table seed_reimbursements as
select row_number() over (order by id) rn, id, coalesce(approved_amount, requested_amount) as amount from public.personal_reimbursements where status in ('approved', 'paid');

insert into public.finance_payments (id, direction, purpose, amount, description, category, account_name, counterparty, payment_date, cleared_date, status,
  expense_id, reimbursement_id, funding_claim_id, transfer_group_id, created_by, voided_by, voided_at, void_reason, created_at, updated_at)
overriding system value
select p.i, p.direction, p.purpose, p.amount, p.purpose || ' ' || p.i, (array['Dues','Donations','Event','Instruments','Supplies','General'])[1 + p.i % 6],
       'Club bank account', (array['Student Senate','Alumni fund','Local sponsor','Members'])[1 + p.i % 4], p.day, case when p.status = 'cleared' then p.day + 2 end,
       p.status, p.expense_id, p.reimbursement_id, null, null, pg_temp.member(4 + p.i % 12),
       case when p.status = 'voided' then pg_temp.member(4) end, case when p.status = 'voided' then p.day + interval '3 days' end,
       case when p.status = 'voided' then 'Posted in error' end, p.day + interval '1 day', p.day + interval '1 day'
from (
  select i,
    case when i <= 500 or i > 1450 then 'inflow' else 'outflow' end as direction,
    case when i <= 500 then 'income' when i <= 1100 then 'direct_expense' when i <= 1300 then 'member_reimbursement'
         when i <= 1400 then 'fee' when i <= 1450 then 'refund' else 'adjustment' end as purpose,
    case when i between 501 and 1100 then (select amount from seed_club_expenses where rn = 1 + (i - 501) % (select count(*) from seed_club_expenses))
         when i between 1101 and 1300 then (select amount from seed_reimbursements where rn = 1 + (i - 1101) % (select count(*) from seed_reimbursements))
         else (5 + pg_temp.h('pay' || i, 50000) / 100.0)::numeric(12,2) end as amount,
    case when i between 501 and 1100 then (select id from seed_club_expenses where rn = 1 + (i - 501) % (select count(*) from seed_club_expenses)) end as expense_id,
    case when i between 1101 and 1300 then (select id from seed_reimbursements where rn = 1 + (i - 1101) % (select count(*) from seed_reimbursements)) end as reimbursement_id,
    (pg_temp.anchor() - (1 + pg_temp.h('pday' || i, 700)) * interval '1 day')::date as day,
    case when i % 100 < 40 then 'posted' when i % 100 < 90 then 'cleared' when i % 100 < 95 then 'pending' else 'voided' end as status
  from generate_series(1, 1500) i
) p;

insert into public.funding_claims (id, title, funder_name, award_reference, requested_amount, approved_amount, received_amount, submission_deadline, status,
  notes, submitted_at, reviewed_at, created_by, updated_by, created_at, updated_at, void_reason, voided_by, voided_at)
overriding system value
select c.i, 'Funding claim ' || c.i, 'GPSG Senate', 'AW-' || c.i, c.req,
       case when c.status in ('approved', 'partially_paid', 'paid') then c.req end,
       case when c.status = 'paid' then c.req when c.status = 'partially_paid' then round(c.req / 2, 2) else 0 end,
       (pg_temp.anchor() - (c.i * 20) * interval '1 day')::date, c.status, '',
       case when c.status not in ('draft', 'incomplete', 'ready') then pg_temp.anchor() - (c.i * 20 - 5) * interval '1 day' end,
       case when c.status in ('approved', 'partially_paid', 'paid', 'denied') then pg_temp.anchor() - (c.i * 20 - 10) * interval '1 day' end,
       pg_temp.member(4), pg_temp.member(4), pg_temp.anchor() - (c.i * 20 + 5) * interval '1 day', pg_temp.anchor() - (c.i * 20) * interval '1 day',
       case when c.status = 'voided' then 'Cancelled' end, case when c.status = 'voided' then pg_temp.member(4) end,
       case when c.status = 'voided' then pg_temp.anchor() - (c.i * 20 - 1) * interval '1 day' end
from (
  select i, (500 + pg_temp.h('creq' || i, 450000) / 100.0)::numeric(12,2) as req,
         (array['draft','incomplete','ready','submitted','changes_requested','approved','partially_paid','paid','denied','voided'])[1 + i % 10] as status
  from generate_series(1, 30) i
) c;

insert into public.funding_claim_expenses (claim_id, expense_id, claimed_amount, created_at)
select 1 + (e.rn - 1) / 5, e.id, e.amount, pg_temp.anchor() - interval '10 days'
from seed_club_expenses e where e.rn <= 150;

insert into public.finance_documents (id, document_type, title, storage_path, mime_type, file_size_bytes, payment_card_last4, uploaded_by, created_at)
overriding system value
select i, (array['receipt','invoice','bank_statement','card_statement','event_support','funding_approval','heellife_submission','proof_of_payment','other'])[1 + i % 9],
       'Document ' || i, 'finance/' || pg_temp.member(4 + i % 12) || '/doc-' || i || '.pdf', 'application/pdf',
       10000 + pg_temp.h('dsz' || i, 2000000), null, pg_temp.member(4 + i % 12), pg_temp.anchor() - (1 + pg_temp.h('dd' || i, 700)) * interval '1 day'
from generate_series(1, 800) i;
insert into public.finance_expense_documents (expense_id, document_id) select i, i from generate_series(1, 700) i;
insert into public.finance_reimbursement_documents (reimbursement_id, document_id)
select i - 700, i from generate_series(701, 800) i where i - 700 <= (select count(*) from public.personal_reimbursements);
insert into public.finance_claim_documents (claim_id, document_id) select i, i from generate_series(1, 30) i;

insert into public.transactions (id, description, amount, category, transaction_date, created_by, created_at)
overriding system value
select i, 'Legacy transaction ' || i, case when i % 3 = 0 then -1 else 1 end * (10 + pg_temp.h('tx' || i, 50000) / 100.0)::numeric(12,2),
       (array['Dues','Supplies','Events'])[1 + i % 3], (pg_temp.anchor() - (700 + i) * interval '1 day')::date, pg_temp.member(4), pg_temp.anchor() - (700 + i) * interval '1 day'
from generate_series(1, 150) i;

insert into public.finance_audit_log (entity_type, entity_id, action, actor_id, before_data, after_data, created_at)
select (array['finance_expenses','finance_payments','personal_reimbursements','funding_claims'])[1 + i % 4], 1 + i % 1200,
       (array['insert','update','update'])[1 + i % 3], pg_temp.member(4 + i % 12),
       case when i % 3 > 0 then jsonb_build_object('status', 'draft') end, jsonb_build_object('status', 'approved', 'n', i),
       pg_temp.anchor() - (3000 - i) * interval '5 hours'
from generate_series(1, 3000) i;

insert into public.admin_audit_log (action, actor_id, actor_email, target_id, target_email, details, created_at)
select (array['role_changed','member_updated','member_deactivated','member_reactivated'])[1 + i % 4], pg_temp.member(1 + i % 3), 'member' || (1 + i % 3) || '@seed.invalid',
       pg_temp.member(16 + i % 484), 'member' || (16 + i % 484) || '@seed.invalid', jsonb_build_object('n', i), pg_temp.anchor() - (2000 - i) * interval '7 hours'
from generate_series(1, 2000) i;

-- ---------------------------------------------------------------------------
-- Storage objects behind the rows above (stand-in table from shims.sql)
-- ---------------------------------------------------------------------------
insert into storage.objects (bucket_id, name, owner, owner_id, created_at)
select storage_bucket, storage_path, uploaded_by, uploaded_by::text, created_at from public.recordings
union all
select storage_bucket, storage_path, created_by, created_by::text, created_at from public.resources where node_kind = 'file'
union all
select 'club-archive', storage_path, uploaded_by, uploaded_by::text, created_at from public.archive_items
union all
select 'recording-notations', storage_path, uploaded_by, uploaded_by::text, created_at from public.recording_notes where storage_path is not null
union all
select 'finance-private', storage_path, uploaded_by, uploaded_by::text, created_at from public.finance_documents
union all
select 'attendance-excuses', proof_path, member_id, member_id::text, submitted_at from public.attendance_excuses where proof_path is not null;

-- ---------------------------------------------------------------------------
-- Identity sequences, triggers, statistics
-- ---------------------------------------------------------------------------
do $$
declare c record;
begin
  for c in select table_schema, table_name, column_name from information_schema.columns
           where table_schema = 'public' and is_identity = 'YES' loop
    execute format('select setval(pg_get_serial_sequence(%L, %L), greatest(coalesce(max(%I), 0), 1), coalesce(max(%I), 0) > 0) from %I.%I',
      c.table_schema || '.' || c.table_name, c.column_name, c.column_name, c.column_name, c.table_schema, c.table_name);
  end loop;
  for c in select format('%I.%I', schemaname, tablename) as name from pg_tables where schemaname = 'public' loop
    execute format('alter table %s enable trigger user', c.name);
  end loop;
end $$;

-- Sanity: the figures promised in the header.
do $$
declare
  got record;
begin
  select (select count(*) from public.profiles) as members,
         (select count(*) from public.profiles where status = 'deactivated') as deactivated,
         (select count(*) from public.recordings) as recordings,
         (select count(*) from public.resources) as resources,
         (select count(*) from public.resources where node_kind = 'folder') as folders,
         (select count(*) from public.attendance_records) as records,
         (select count(*) from public.finance_payments) as payments into got;
  if got.members <> 501 or got.recordings <> 5000 or got.resources <> 2000 or got.records <> 20000 or got.payments <> 1500 or got.folders <> 312 then
    raise exception 'seed-load.sql: unexpected counts %', got;
  end if;
  -- Everything has a home: no orphan uploader, no resource outside its parent's scope.
  if exists (select 1 from public.resources c join public.resources p on p.id = c.parent_id
             where c.subgroup_id is distinct from p.subgroup_id or c.visibility <> p.visibility) then
    raise exception 'seed-load.sql: resource scope mismatch';
  end if;
end $$;

analyze;
\set QUIET off
select 'seeded' as result, (select count(*) from public.profiles) as members, (select count(*) from public.recordings) as recordings,
       (select count(*) from public.resources) as resources, (select count(*) from public.attendance_records) as attendance_records,
       (select count(*) from public.finance_payments) as ledger_rows;
