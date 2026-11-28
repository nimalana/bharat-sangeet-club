-- Phase 4.3, P0-02 (migration 20261128030000): everything with a visibility or scope concept is
-- invisible to the people it is not for, in the TABLE policies and in the STORAGE policies.
--
-- One loop per subject. Each probe is run as every kind of caller and returns the list of the
-- fixture rows that caller can see; the expected list is written next to it, so a change in either
-- direction (a leak, or a lost access) fails with the subject, the caller and both lists.
--
-- Callers: anon, outsider (a member in no group), unrelated manager (manages group H, not G),
-- group member (G), group manager (G), executive, admin, deactivated (was a member of G).
-- Storage: Supabase signs a url, downloads and lists through a SELECT on storage.objects made with the
-- caller's role, so "can select the object row" is "can create a signed url / download". The local
-- shim has storage.objects with row level security, like the hosted project.
--
-- Subjects and what is deliberately NOT a rule here:
--   archive_items + club-archive      executives-only rows, club-wide and per group; the public concert rows
--   resources + club-resources        the same with the folder/file shape
--   recordings + recordings bucket    drafts and archived: uploader and executives only (there is no
--                                     "executives" audience on a recording)
--   recording_notes + notation bucket follow the recording
--   events, announcements             group scoped
--   attendance-excuses, finance-private  own folder / executives
begin;

create function test.seen_as(p_user uuid, p_sql text) returns text language plpgsql as $$
declare result text;
begin
  perform test.login(p_user);
  begin
    execute p_sql into result;
  exception when insufficient_privilege then
    result := 'DENIED';
  end;
  perform test.logout();
  return coalesce(result, '');
end $$;

-- One check: the caller sees exactly the expected labels.
create function test.expect_seen(p_subject text, p_who text, p_user uuid, p_sql text, p_expected text) returns void language plpgsql as $$
declare got text := test.seen_as(p_user, p_sql);
begin
  if got is distinct from p_expected then
    raise exception 'MATRIX % / %: expected [%] but saw [%]', p_subject, p_who, p_expected, got;
  end if;
end $$;

do $$
declare
  v_exec uuid := test.make_user('Exec M77', 'executive');
  v_admin uuid := test.make_user('Admin M77', 'admin');
  v_gm uuid := test.make_user('Group Member M77');
  v_gmgr uuid := test.make_user('Group Manager M77');
  v_hmgr uuid := test.make_user('Unrelated Manager M77');
  v_out uuid := test.make_user('Outsider M77');
  v_deact uuid := test.make_user('Deactivated M77');
  v_up uuid := test.make_user('Uploader M77');
  v_g bigint;
  v_h bigint;
  v_session bigint;
  v_rec1 bigint; v_rec2 bigint; v_rec3 bigint; v_rec4 bigint;
  v_doc bigint;
  -- the probes: label of the subject, then the SQL that lists the rows seen (label order)
  q_archive text := $q$select coalesce(string_agg(title, ',' order by title), '') from public.archive_items where title like 'M77 %'$q$;
  q_archive_obj text := $q$select coalesce(string_agg(split_part(name, '/', 2), ',' order by name), '') from storage.objects where bucket_id = 'club-archive' and name like 'm77/%'$q$;
  q_resources text := $q$select coalesce(string_agg(title, ',' order by title), '') from public.resources where title like 'M77 %'$q$;
  q_resource_obj text := $q$select coalesce(string_agg(split_part(name, '/', 2), ',' order by name), '') from storage.objects where bucket_id = 'club-resources' and name like 'm77/%'$q$;
  q_recordings text := $q$select coalesce(string_agg(title, ',' order by title), '') from public.recordings where title like 'M77 %'$q$;
  q_recording_obj text := $q$select coalesce(string_agg(split_part(name, '/', 3), ',' order by name), '') from storage.objects where bucket_id = 'recordings' and name like '%/m77/%'$q$;
  q_notes text := $q$select coalesce(string_agg(title, ',' order by title), '') from public.recording_notes where title like 'M77 %'$q$;
  q_notation_obj text := $q$select coalesce(string_agg(split_part(name, '/', 3), ',' order by name), '') from storage.objects where bucket_id = 'recording-notations' and name like '%/m77/%'$q$;
  q_events text := $q$select coalesce(string_agg(title, ',' order by title), '') from public.events where title like 'M77 %'$q$;
  q_announcements text := $q$select coalesce(string_agg(title, ',' order by title), '') from public.announcements where title like 'M77 %'$q$;
  q_proof_obj text := $q$select coalesce(string_agg(split_part(name, '/', 4), ',' order by name), '') from storage.objects where bucket_id = 'attendance-excuses' and name like '%/m77/%'$q$;
  q_finance_obj text := $q$select coalesce(string_agg(split_part(name, '/', 3), ',' order by name), '') from storage.objects where bucket_id = 'finance-private' and name like '%/m77/%'$q$;
  q_imports text := $q$select coalesce(string_agg(name, ',' order by name), '') from public.resource_imports where name like 'M77 %'$q$;
  n bigint;
  message text;
begin
  -- -------------------------------------------------------------------------------------------
  -- Fixtures (made as the table owner, so no policy gets in the way of the setup)
  -- -------------------------------------------------------------------------------------------
  perform test.login(v_exec);
  select id into v_g from public.create_subgroup('M77 Ensemble G', '', 'open');
  select id into v_h from public.create_subgroup('M77 Ensemble H', '', 'open');
  perform public.add_subgroup_member(v_g, v_gm);
  perform public.add_subgroup_member(v_g, v_gmgr);
  perform public.set_subgroup_member_role(v_g, v_gmgr, 'manager');
  perform public.add_subgroup_member(v_g, v_up);
  perform public.add_subgroup_member(v_g, v_deact);
  perform public.add_subgroup_member(v_h, v_hmgr);
  perform public.set_subgroup_member_role(v_h, v_hmgr, 'manager');
  perform test.logout();

  perform test.login(v_admin);
  perform public.admin_deactivate_member(v_deact, 'M77 test');
  perform test.logout();

  -- archive_items: club-wide and per group, members and executives; one public concert
  insert into public.archive_items (title, type, storage_path, visibility, uploaded_by, subgroup_id, is_public) values
    ('M77 a1 club members',     'recording', 'm77/a1.mp3', 'members',    v_exec, null, false),
    ('M77 a2 club executives',  'recording', 'm77/a2.mp3', 'executives', v_exec, null, false),
    ('M77 a3 G members',        'recording', 'm77/a3.mp3', 'members',    v_exec, v_g,  false),
    ('M77 a4 G executives',     'recording', 'm77/a4.mp3', 'executives', v_exec, v_g,  false),
    ('M77 a5 H members',        'recording', 'm77/a5.mp3', 'members',    v_exec, v_h,  false),
    ('M77 a6 public concert',   'recording', 'm77/a6.mp3', 'members',    v_exec, null, true);
  insert into storage.objects (bucket_id, name) select 'club-archive', storage_path from public.archive_items where title like 'M77 %';

  -- resources: same shape
  insert into public.resources (node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by) values
    ('file', 'document', 'M77 r1 club members',    null, 'members',    'ready', 'club-resources', 'm77/r1.pdf', v_exec),
    ('file', 'document', 'M77 r2 club executives', null, 'executives', 'ready', 'club-resources', 'm77/r2.pdf', v_exec),
    ('file', 'document', 'M77 r3 G members',       v_g,  'members',    'ready', 'club-resources', 'm77/r3.pdf', v_exec),
    ('file', 'document', 'M77 r4 G executives',    v_g,  'executives', 'ready', 'club-resources', 'm77/r4.pdf', v_exec),
    ('file', 'document', 'M77 r5 H members',       v_h,  'members',    'ready', 'club-resources', 'm77/r5.pdf', v_exec);
  insert into storage.objects (bucket_id, name) select 'club-resources', storage_path from public.resources where title like 'M77 %';

  -- recordings of the uploader in group G; one more audience club; the paths are in the uploader's folder
  insert into public.recordings (title, subgroup_id, uploaded_by, storage_path, status, audience) values
    ('M77 rec1 G published',  v_g, v_up, v_up || '/m77/rec1.webm', 'published', 'subgroup') returning id into v_rec1;
  insert into public.recordings (title, subgroup_id, uploaded_by, storage_path, status, audience) values
    ('M77 rec2 G draft',      v_g, v_up, v_up || '/m77/rec2.webm', 'draft',     'subgroup') returning id into v_rec2;
  insert into public.recordings (title, subgroup_id, uploaded_by, storage_path, status, audience) values
    ('M77 rec3 club audience', v_g, v_up, v_up || '/m77/rec3.webm', 'published', 'club') returning id into v_rec3;
  insert into public.recordings (title, subgroup_id, uploaded_by, storage_path, status, audience) values
    ('M77 rec4 G archived',   v_g, v_up, v_up || '/m77/rec4.webm', 'archived',  'subgroup') returning id into v_rec4;
  insert into storage.objects (bucket_id, name) select 'recordings', storage_path from public.recordings where title like 'M77 %';

  insert into public.recording_notes (recording_id, title, note_type, storage_path, uploaded_by) values
    (v_rec1, 'M77 n1 on the published take', 'file', v_up || '/m77/n1.pdf', v_up),
    (v_rec2, 'M77 n2 on the draft',          'file', v_up || '/m77/n2.pdf', v_up);
  insert into storage.objects (bucket_id, name) select 'recording-notations', storage_path from public.recording_notes where title like 'M77 %';

  insert into public.events (title, subgroup_id, starts_at, created_by) values
    ('M77 e1 club', null, now() + interval '1 day', v_exec),
    ('M77 e2 G',    v_g,  now() + interval '1 day', v_exec),
    ('M77 e3 H',    v_h,  now() + interval '1 day', v_exec);
  insert into public.announcements (title, body, subgroup_id, created_by) values
    ('M77 s1 club', 'b', null, v_exec),
    ('M77 s2 G',    'b', v_g,  v_exec),
    ('M77 s3 H',    'b', v_h,  v_exec);

  -- an attendance proof of the group member (own folder) and a finance receipt of the group member
  perform test.login(v_exec);
  select id into v_session from public.create_attendance_session('subgroup', v_g, 'M77 meeting', now() - interval '2 hours');
  perform public.open_attendance_session(v_session, 30);   -- the roster snapshot: the active members of G
  perform test.logout();
  insert into storage.objects (bucket_id, name) values ('attendance-excuses', v_gm || '/' || v_session || '/m77/proof.png');
  insert into public.finance_documents (document_type, title, storage_path, mime_type, file_size_bytes, uploaded_by)
    values ('receipt', 'M77 receipt', v_gm || '/m77/receipt.png', 'image/png', 10, v_gm) returning id into v_doc;
  insert into storage.objects (bucket_id, name) values ('finance-private', v_gm || '/m77/receipt.png');

  -- an import of the group manager, and one of the executive
  insert into public.resource_imports (name, subgroup_id, created_by) values ('M77 import by G manager', v_g, v_gmgr), ('M77 import by exec club-wide', null, v_exec);

  -- -------------------------------------------------------------------------------------------
  -- archive_items and the club-archive bucket
  -- -------------------------------------------------------------------------------------------
  -- a1 club members, a2 club executives, a3 G members, a4 G executives, a5 H members, a6 public concert
  perform test.expect_seen('archive_items', 'anon',                null,    q_archive, 'M77 a6 public concert');
  perform test.expect_seen('archive_items', 'outsider',            v_out,   q_archive, 'M77 a1 club members,M77 a6 public concert');
  perform test.expect_seen('archive_items', 'unrelated manager',   v_hmgr,  q_archive, 'M77 a1 club members,M77 a5 H members,M77 a6 public concert');
  perform test.expect_seen('archive_items', 'group member',        v_gm,    q_archive, 'M77 a1 club members,M77 a3 G members,M77 a6 public concert');
  perform test.expect_seen('archive_items', 'group manager',       v_gmgr,  q_archive, 'M77 a1 club members,M77 a3 G members,M77 a6 public concert');
  perform test.expect_seen('archive_items', 'executive',           v_exec,  q_archive, 'M77 a1 club members,M77 a2 club executives,M77 a3 G members,M77 a4 G executives,M77 a5 H members,M77 a6 public concert');
  perform test.expect_seen('archive_items', 'admin',               v_admin, q_archive, 'M77 a1 club members,M77 a2 club executives,M77 a3 G members,M77 a4 G executives,M77 a5 H members,M77 a6 public concert');
  perform test.expect_seen('archive_items', 'deactivated',         v_deact, q_archive, '');
  perform test.expect_seen('club-archive objects', 'anon',               null,    q_archive_obj, 'a6.mp3');
  perform test.expect_seen('club-archive objects', 'outsider',           v_out,   q_archive_obj, 'a1.mp3,a6.mp3');
  perform test.expect_seen('club-archive objects', 'unrelated manager',  v_hmgr,  q_archive_obj, 'a1.mp3,a5.mp3,a6.mp3');
  perform test.expect_seen('club-archive objects', 'group member',       v_gm,    q_archive_obj, 'a1.mp3,a3.mp3,a6.mp3');
  perform test.expect_seen('club-archive objects', 'group manager',      v_gmgr,  q_archive_obj, 'a1.mp3,a3.mp3,a6.mp3');
  perform test.expect_seen('club-archive objects', 'executive',          v_exec,  q_archive_obj, 'a1.mp3,a2.mp3,a3.mp3,a4.mp3,a5.mp3,a6.mp3');
  perform test.expect_seen('club-archive objects', 'admin',              v_admin, q_archive_obj, 'a1.mp3,a2.mp3,a3.mp3,a4.mp3,a5.mp3,a6.mp3');
  perform test.expect_seen('club-archive objects', 'deactivated',        v_deact, q_archive_obj, '');

  -- -------------------------------------------------------------------------------------------
  -- resources and the club-resources bucket (r1 club members, r2 club executives, r3 G members, r4 G executives, r5 H members)
  -- -------------------------------------------------------------------------------------------
  perform test.expect_seen('resources', 'anon',              null,    q_resources, 'DENIED');
  perform test.expect_seen('resources', 'outsider',          v_out,   q_resources, 'M77 r1 club members');
  perform test.expect_seen('resources', 'unrelated manager', v_hmgr,  q_resources, 'M77 r1 club members,M77 r5 H members');
  perform test.expect_seen('resources', 'group member',      v_gm,    q_resources, 'M77 r1 club members,M77 r3 G members');
  perform test.expect_seen('resources', 'group manager',     v_gmgr,  q_resources, 'M77 r1 club members,M77 r3 G members');
  perform test.expect_seen('resources', 'executive',         v_exec,  q_resources, 'M77 r1 club members,M77 r2 club executives,M77 r3 G members,M77 r4 G executives,M77 r5 H members');
  perform test.expect_seen('resources', 'admin',             v_admin, q_resources, 'M77 r1 club members,M77 r2 club executives,M77 r3 G members,M77 r4 G executives,M77 r5 H members');
  perform test.expect_seen('resources', 'deactivated',       v_deact, q_resources, '');
  perform test.expect_seen('club-resources objects', 'anon',              null,    q_resource_obj, '');
  perform test.expect_seen('club-resources objects', 'outsider',          v_out,   q_resource_obj, 'r1.pdf');
  perform test.expect_seen('club-resources objects', 'unrelated manager', v_hmgr,  q_resource_obj, 'r1.pdf,r5.pdf');
  perform test.expect_seen('club-resources objects', 'group member',      v_gm,    q_resource_obj, 'r1.pdf,r3.pdf');
  perform test.expect_seen('club-resources objects', 'group manager',     v_gmgr,  q_resource_obj, 'r1.pdf,r3.pdf');
  perform test.expect_seen('club-resources objects', 'executive',         v_exec,  q_resource_obj, 'r1.pdf,r2.pdf,r3.pdf,r4.pdf,r5.pdf');
  perform test.expect_seen('club-resources objects', 'admin',             v_admin, q_resource_obj, 'r1.pdf,r2.pdf,r3.pdf,r4.pdf,r5.pdf');
  perform test.expect_seen('club-resources objects', 'deactivated',       v_deact, q_resource_obj, '');

  -- resource_imports: the creator, executives and the group's managers
  perform test.expect_seen('resource_imports', 'outsider',          v_out,   q_imports, '');
  perform test.expect_seen('resource_imports', 'unrelated manager', v_hmgr,  q_imports, '');
  perform test.expect_seen('resource_imports', 'group member',      v_gm,    q_imports, '');
  perform test.expect_seen('resource_imports', 'group manager',     v_gmgr,  q_imports, 'M77 import by G manager');
  perform test.expect_seen('resource_imports', 'executive',         v_exec,  q_imports, 'M77 import by G manager,M77 import by exec club-wide');
  perform test.expect_seen('resource_imports', 'deactivated',       v_deact, q_imports, '');

  -- -------------------------------------------------------------------------------------------
  -- recordings and recording_notes, and their buckets
  -- rec1 G published, rec2 G draft, rec3 club audience, rec4 G archived; all by the uploader, a member of G
  -- -------------------------------------------------------------------------------------------
  perform test.expect_seen('recordings', 'anon',              null,    q_recordings, 'DENIED');
  perform test.expect_seen('recordings', 'outsider',          v_out,   q_recordings, 'M77 rec3 club audience');
  perform test.expect_seen('recordings', 'unrelated manager', v_hmgr,  q_recordings, 'M77 rec3 club audience');
  perform test.expect_seen('recordings', 'group member',      v_gm,    q_recordings, 'M77 rec1 G published,M77 rec3 club audience');
  perform test.expect_seen('recordings', 'group manager',     v_gmgr,  q_recordings, 'M77 rec1 G published,M77 rec3 club audience');
  perform test.expect_seen('recordings', 'uploader',          v_up,    q_recordings, 'M77 rec1 G published,M77 rec2 G draft,M77 rec3 club audience,M77 rec4 G archived');
  perform test.expect_seen('recordings', 'executive',         v_exec,  q_recordings, 'M77 rec1 G published,M77 rec2 G draft,M77 rec3 club audience,M77 rec4 G archived');
  perform test.expect_seen('recordings', 'admin',             v_admin, q_recordings, 'M77 rec1 G published,M77 rec2 G draft,M77 rec3 club audience,M77 rec4 G archived');
  perform test.expect_seen('recordings', 'deactivated',       v_deact, q_recordings, '');
  perform test.expect_seen('recordings objects', 'anon',              null,    q_recording_obj, '');
  perform test.expect_seen('recordings objects', 'outsider',          v_out,   q_recording_obj, 'rec3.webm');
  perform test.expect_seen('recordings objects', 'unrelated manager', v_hmgr,  q_recording_obj, 'rec3.webm');
  perform test.expect_seen('recordings objects', 'group member',      v_gm,    q_recording_obj, 'rec1.webm,rec3.webm');
  perform test.expect_seen('recordings objects', 'group manager',     v_gmgr,  q_recording_obj, 'rec1.webm,rec3.webm');
  perform test.expect_seen('recordings objects', 'uploader',          v_up,    q_recording_obj, 'rec1.webm,rec2.webm,rec3.webm,rec4.webm');
  perform test.expect_seen('recordings objects', 'executive',         v_exec,  q_recording_obj, 'rec1.webm,rec2.webm,rec3.webm,rec4.webm');
  perform test.expect_seen('recordings objects', 'admin',             v_admin, q_recording_obj, 'rec1.webm,rec2.webm,rec3.webm,rec4.webm');
  perform test.expect_seen('recordings objects', 'deactivated',       v_deact, q_recording_obj, '');

  perform test.expect_seen('recording_notes', 'anon',          null,    q_notes, 'DENIED');
  perform test.expect_seen('recording_notes', 'outsider',      v_out,   q_notes, '');
  perform test.expect_seen('recording_notes', 'group member',  v_gm,    q_notes, 'M77 n1 on the published take');
  perform test.expect_seen('recording_notes', 'group manager', v_gmgr,  q_notes, 'M77 n1 on the published take');
  perform test.expect_seen('recording_notes', 'uploader',      v_up,    q_notes, 'M77 n1 on the published take,M77 n2 on the draft');
  perform test.expect_seen('recording_notes', 'executive',     v_exec,  q_notes, 'M77 n1 on the published take,M77 n2 on the draft');
  perform test.expect_seen('recording_notes', 'deactivated',   v_deact, q_notes, '');
  perform test.expect_seen('notation objects', 'anon',          null,    q_notation_obj, '');
  perform test.expect_seen('notation objects', 'outsider',      v_out,   q_notation_obj, '');
  perform test.expect_seen('notation objects', 'group member',  v_gm,    q_notation_obj, 'n1.pdf');
  perform test.expect_seen('notation objects', 'group manager', v_gmgr,  q_notation_obj, 'n1.pdf');
  perform test.expect_seen('notation objects', 'uploader',      v_up,    q_notation_obj, 'n1.pdf,n2.pdf');
  perform test.expect_seen('notation objects', 'executive',     v_exec,  q_notation_obj, 'n1.pdf,n2.pdf');
  perform test.expect_seen('notation objects', 'deactivated',   v_deact, q_notation_obj, '');

  -- -------------------------------------------------------------------------------------------
  -- events and announcements (club-wide, group G, group H)
  -- -------------------------------------------------------------------------------------------
  perform test.expect_seen('events', 'anon',              null,    q_events, 'DENIED');
  perform test.expect_seen('events', 'outsider',          v_out,   q_events, 'M77 e1 club');
  perform test.expect_seen('events', 'unrelated manager', v_hmgr,  q_events, 'M77 e1 club,M77 e3 H');
  perform test.expect_seen('events', 'group member',      v_gm,    q_events, 'M77 e1 club,M77 e2 G');
  perform test.expect_seen('events', 'executive',         v_exec,  q_events, 'M77 e1 club,M77 e2 G,M77 e3 H');
  perform test.expect_seen('events', 'deactivated',       v_deact, q_events, '');
  perform test.expect_seen('announcements', 'anon',              null,    q_announcements, 'DENIED');
  perform test.expect_seen('announcements', 'outsider',          v_out,   q_announcements, 'M77 s1 club');
  perform test.expect_seen('announcements', 'unrelated manager', v_hmgr,  q_announcements, 'M77 s1 club,M77 s3 H');
  perform test.expect_seen('announcements', 'group member',      v_gm,    q_announcements, 'M77 s1 club,M77 s2 G');
  perform test.expect_seen('announcements', 'executive',         v_exec,  q_announcements, 'M77 s1 club,M77 s2 G,M77 s3 H');
  perform test.expect_seen('announcements', 'deactivated',       v_deact, q_announcements, '');

  -- -------------------------------------------------------------------------------------------
  -- attendance-excuses and finance-private: the owner and executives
  -- -------------------------------------------------------------------------------------------
  perform test.expect_seen('attendance-excuses objects', 'anon',              null,    q_proof_obj, '');
  perform test.expect_seen('attendance-excuses objects', 'outsider',          v_out,   q_proof_obj, '');
  perform test.expect_seen('attendance-excuses objects', 'group manager',     v_gmgr,  q_proof_obj, '');
  perform test.expect_seen('attendance-excuses objects', 'unrelated manager', v_hmgr,  q_proof_obj, '');
  perform test.expect_seen('attendance-excuses objects', 'the member itself', v_gm,    q_proof_obj, 'proof.png');
  perform test.expect_seen('attendance-excuses objects', 'executive',         v_exec,  q_proof_obj, 'proof.png');
  perform test.expect_seen('attendance-excuses objects', 'admin',             v_admin, q_proof_obj, 'proof.png');
  perform test.expect_seen('finance-private objects', 'anon',              null,    q_finance_obj, '');
  perform test.expect_seen('finance-private objects', 'outsider',          v_out,   q_finance_obj, '');
  perform test.expect_seen('finance-private objects', 'group manager',     v_gmgr,  q_finance_obj, '');
  perform test.expect_seen('finance-private objects', 'unrelated manager', v_hmgr,  q_finance_obj, '');
  perform test.expect_seen('finance-private objects', 'the member itself', v_gm,    q_finance_obj, 'receipt.png');
  perform test.expect_seen('finance-private objects', 'executive',         v_exec,  q_finance_obj, 'receipt.png');
  perform test.expect_seen('finance-private objects', 'admin',             v_admin, q_finance_obj, 'receipt.png');

  -- -------------------------------------------------------------------------------------------
  -- The metadata of an executives-only row cannot be found by a member who knows the id, a filter or the path
  -- -------------------------------------------------------------------------------------------
  assert test.count_as(v_gm, $q$select count(*) from public.archive_items where storage_path = 'm77/a4.mp3'$q$) = 0, 'a group member cannot find the executives row of their own group by path';
  assert test.count_as(v_gm, $q$select count(*) from public.archive_items where visibility = 'executives'$q$) = 0, 'nor by asking for the executives rows';
  assert test.count_as(v_gm, $q$select count(*) from storage.objects where bucket_id = 'club-archive' and name = 'm77/a4.mp3'$q$) = 0, 'no signed url for it: the object row is not visible to the member';
  assert test.count_as(v_gmgr, $q$select count(*) from storage.objects where bucket_id = 'club-archive' and name = 'm77/a4.mp3'$q$) = 0, 'nor for the group manager';
  assert test.count_as(v_gm, $q$select count(*) from storage.objects where bucket_id = 'club-resources' and name = 'm77/r4.pdf'$q$) = 0, 'nor for the executives-only resource of their group';

  -- A member cannot make a row visible to themselves: archive_items is written by executives only
  -- (the update is allowed to run and finds no row it may touch).
  perform test.error_as(v_gm, $q$update public.archive_items set visibility = 'members' where storage_path = 'm77/a4.mp3'$q$);
  assert (select visibility::text from public.archive_items where storage_path = 'm77/a4.mp3') = 'executives', 'a member cannot update an archive row';
  perform test.error_as(v_gmgr, $q$update public.resources set visibility = 'members' where title = 'M77 r4 G executives'$q$);
  assert (select visibility::text from public.resources where title = 'M77 r4 G executives') = 'executives', 'a group manager cannot make the executives-only resource of their group visible (the row is not even theirs to update)';
  message := test.error_as(v_gmgr, $q$insert into public.resources (node_kind, title, subgroup_id, visibility, status, created_by) values ('folder', 'M77 manager makes executive row', null, 'executives', 'ready', auth.uid())$q$);
  assert message is not null, 'a group manager cannot create an executives-only or club-wide row';

  -- -------------------------------------------------------------------------------------------
  -- The public concert rows: only when really public
  -- -------------------------------------------------------------------------------------------
  message := test.error_as(v_exec, $q$insert into public.archive_items (title, type, storage_path, visibility, uploaded_by, is_public) values ('M77 contradictory', 'recording', 'm77/bad.mp3', 'executives', auth.uid(), true)$q$);
  assert message like '%archive_items_public_not_executives%', 'executives-only and public together is refused: ' || coalesce(message, 'no error');
  -- A contradictory row that was already there (written as the table owner, as old data would be) is not public.
  alter table public.archive_items drop constraint archive_items_public_not_executives;
  insert into public.archive_items (title, type, storage_path, visibility, uploaded_by, is_public) values ('M77 old contradictory', 'recording', 'm77/old.mp3', 'executives', v_exec, true);
  alter table public.archive_items add constraint archive_items_public_not_executives check (not (is_public and visibility = 'executives')) not valid;
  insert into storage.objects (bucket_id, name) values ('club-archive', 'm77/old.mp3');
  assert test.count_as(null, $q$select count(*) from public.archive_items where title = 'M77 old contradictory'$q$) = 0, 'anon does not see an executives-only row even if it is flagged public';
  assert test.count_as(null, $q$select count(*) from storage.objects where bucket_id = 'club-archive' and name = 'm77/old.mp3'$q$) = 0, 'nor sign its file';
  assert test.count_as(v_gm, $q$select count(*) from public.archive_items where title = 'M77 old contradictory'$q$) = 0, 'nor does a member';

  -- -------------------------------------------------------------------------------------------
  -- A demoted executive keeps no read access to what they uploaded to club-archive
  -- -------------------------------------------------------------------------------------------
  declare
    v_old uuid := test.make_user('Former Exec M77', 'executive');
    v_path text;
  begin
    v_path := v_old || '/m77/own-upload.mp3';
    insert into storage.objects (bucket_id, name, owner_id) values ('club-archive', v_path, v_old::text);
    assert test.count_as(v_old, format('select count(*) from storage.objects where bucket_id = ''club-archive'' and name = %L', v_path)) = 1, 'an executive reads their own unregistered upload (the clean-up path)';
    update public.profiles set role = 'member' where id = v_old;
    assert test.count_as(v_old, format('select count(*) from storage.objects where bucket_id = ''club-archive'' and name = %L', v_path)) = 0, 'after the demotion the same upload is no longer readable (folder rule)';
    assert test.count_as(v_old, format('select count(*) from storage.objects where bucket_id = ''club-archive'' and name = %L and owner_id = %L', v_path, v_old::text)) = 0, 'nor through the owner rule';
    -- members keep reading their own recordings and notation files (a decision: it is their own work)
    insert into storage.objects (bucket_id, name, owner_id) values ('recordings', v_old || '/m77/abandoned.webm', v_old::text);
    assert test.count_as(v_old, format('select count(*) from storage.objects where bucket_id = ''recordings'' and name = %L', v_old || '/m77/abandoned.webm')) = 1, 'a member still reads their own abandoned take';
  end;

  -- -------------------------------------------------------------------------------------------
  -- A file can only be registered from its uploader's own folder (recordings, recording notes)
  -- -------------------------------------------------------------------------------------------
  -- v_out learned the path of the uploader's DRAFT take and tries to register it as their own recording.
  message := test.error_as(v_gm, format($q$insert into public.recordings (title, subgroup_id, uploaded_by, storage_path, status) values ('M77 stolen', %s, auth.uid(), %L, 'draft')$q$, v_g, v_up || '/m77/rec2.webm'));
  assert message like '%unique%' or message like 'A file can only be registered%', 'registering a file of another member is refused: ' || coalesce(message, 'no error');
  -- the same with a path that nobody registered (an abandoned draft)
  insert into storage.objects (bucket_id, name) values ('recordings', v_up || '/m77/abandoned-draft.webm');
  message := test.error_as(v_gm, format($q$insert into public.recordings (title, subgroup_id, uploaded_by, storage_path, status) values ('M77 stolen 2', %s, auth.uid(), %L, 'draft')$q$, v_g, v_up || '/m77/abandoned-draft.webm'));
  assert message like 'A file can only be registered%', 'an unregistered file of another member cannot be registered by someone else: ' || coalesce(message, 'no error');
  assert test.count_as(v_gm, format($q$select count(*) from storage.objects where bucket_id = 'recordings' and name = %L$q$, v_up || '/m77/abandoned-draft.webm')) = 0, 'and it stays unreadable';
  message := test.error_as(v_gm, format($q$insert into public.recordings (title, subgroup_id, uploaded_by, storage_path, status) values ('M77 own', %s, auth.uid(), %L, 'draft')$q$, v_g, v_gm || '/m77/own.webm'));
  assert message is null, 'registering a file from your own folder works: ' || coalesce(message, '');
  message := test.error_as(v_gm, format($q$update public.recordings set storage_path = %L where title = 'M77 own'$q$, v_up || '/m77/abandoned-draft.webm'));
  assert message like 'A file can only be registered%', 'changing the path of an own recording to another folder is refused';
  message := test.error_as(v_gm, format($q$update public.recordings set title = 'M77 own renamed' where title = 'M77 own'$q$));
  assert message is null, 'editing other columns is not affected';
  -- notes
  message := test.error_as(v_gm, format($q$insert into public.recording_notes (recording_id, title, note_type, storage_path, uploaded_by) values (%s, 'M77 stolen note', 'file', %L, auth.uid())$q$, v_rec1, v_up || '/m77/n2.pdf'));
  assert message like '%unique%' or message like 'A file can only be registered%', 'a note cannot register a file of another member: ' || coalesce(message, 'no error');
  insert into storage.objects (bucket_id, name) values ('recording-notations', v_up || '/m77/abandoned-note.pdf');
  message := test.error_as(v_gm, format($q$insert into public.recording_notes (recording_id, title, note_type, storage_path, uploaded_by) values (%s, 'M77 stolen note 2', 'file', %L, auth.uid())$q$, v_rec1, v_up || '/m77/abandoned-note.pdf'));
  assert message like 'A file can only be registered%', 'an unregistered notation file of another member cannot be registered: ' || coalesce(message, 'no error');
  message := test.error_as(v_gm, format($q$insert into public.recording_notes (recording_id, title, note_type, body, uploaded_by) values (%s, 'M77 text note', 'text', 'swaras', auth.uid())$q$, v_rec1));
  assert message is null, 'a text note has no file and is not affected: ' || coalesce(message, '');
  message := test.error_as(v_gm, format($q$insert into public.recording_notes (recording_id, title, note_type, storage_path, uploaded_by) values (%s, 'M77 own note', 'file', %L, auth.uid())$q$, v_rec1, v_gm || '/m77/own-note.pdf'));
  assert message is null, 'a note from your own folder works: ' || coalesce(message, '');
  -- an executive is bound too (storage only lets them upload into their own folder as well)
  message := test.error_as(v_exec, format($q$insert into public.recordings (title, subgroup_id, uploaded_by, storage_path, status) values ('M77 exec stolen', %s, auth.uid(), %L, 'draft')$q$, v_g, v_up || '/m77/abandoned-draft.webm'));
  assert message like 'A file can only be registered%', 'an executive cannot register another member''s file either: ' || coalesce(message, 'no error');
  -- the table owner (migrations, legacy copy) is not bound
  insert into public.recordings (title, subgroup_id, uploaded_by, storage_path, status, storage_bucket) values ('M77 legacy copy', v_g, v_up, 'someone-else/legacy.mp3', 'published', 'club-archive');
  insert into public.recordings (title, subgroup_id, uploaded_by, storage_path, status) values ('M77 owner insert', v_g, v_up, 'anything/m77/x.webm', 'draft');
end $$;
rollback;
