-- Phase 4.4 (migration 20261128030500): the content audit log.
--
--   A. Catalog: the table, its policies, privileges, indexes and triggers; the helper functions are closed.
--   B. What each audited table writes: subgroups, memberships, events, announcements, resources, imports,
--      recordings, notes, archive items. Insert, update and delete, as the roles that really make them.
--   C. Noise: updates that change nothing tracked, import children, bulk statements, empty statements.
--   D. Actors: the signed-in person, the system (no one), a deleted account.
--   E. Reading: executives and administrators only; everyone else, a deactivated executive and anonymous visitors, nothing.
--   F. Writing: nobody through the API; append-only for everybody else, the owner included; not switched off by a session.
--   G. list_content_audit: newest first, paging, limits, the entity filter, the actor's name.
--   H. Cascades.
begin;

create function test.m77c_rows(p_after bigint) returns jsonb language sql as $$
  select coalesce(jsonb_agg(to_jsonb(l) - 'occurred_at' order by l.id), '[]'::jsonb) from public.content_audit_log l where l.id > p_after;
$$;
create function test.m77c_mark() returns bigint language sql as $$ select coalesce(max(id), 0) from public.content_audit_log; $$;
create function test.m77c_count(p_after bigint, p_entity text, p_action text) returns bigint language sql as $$
  select count(*) from public.content_audit_log l where l.id > p_after and l.entity_type = p_entity and l.action = p_action;
$$;
-- the single row written for p_entity/p_action after the mark; fails when there is not exactly one
create function test.m77c_one(p_after bigint, p_entity text, p_action text) returns jsonb language plpgsql as $$
declare n bigint; r jsonb;
begin
  select count(*) into n from public.content_audit_log l where l.id > p_after and l.entity_type = p_entity and l.action = p_action;
  if n <> 1 then raise exception 'CONTENT AUDIT: expected exactly one % % row, found % (all rows: %)', p_entity, p_action, n, test.m77c_rows(p_after); end if;
  select to_jsonb(l) - 'occurred_at' into r from public.content_audit_log l where l.id > p_after and l.entity_type = p_entity and l.action = p_action;
  return r;
end $$;
create function test.m77c_state(p_user uuid, p_sql text) returns text language plpgsql as $$
declare st text;
begin
  perform test.login(p_user);
  begin execute p_sql; st := 'ok'; exception when others then get stacked diagnostics st = returned_sqlstate; end;
  perform test.logout();
  return st;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- A. Catalog
-- ---------------------------------------------------------------------------------------------------------
do $$
declare
  t record;
  problems text[] := '{}';
  expected text[] := array['announcements', 'archive_items', 'events', 'recording_notes', 'recordings', 'resource_imports', 'resources', 'subgroup_memberships', 'subgroups'];
begin
  assert (select relrowsecurity from pg_class where oid = 'public.content_audit_log'::regclass), 'row level security is on';
  assert not has_table_privilege('anon', 'public.content_audit_log', 'select, insert, update, delete, truncate, references, trigger'), 'anon holds nothing';
  assert has_table_privilege('authenticated', 'public.content_audit_log', 'select'), 'authenticated may select (the policy decides which rows)';
  assert not has_table_privilege('authenticated', 'public.content_audit_log', 'insert, update, delete, truncate, references, trigger'), 'authenticated holds select only';
  assert exists (select 1 from pg_policies where tablename = 'content_audit_log' and policyname = 'Active members only' and permissive = 'RESTRICTIVE'), 'the active-members rule';
  assert (select count(*) from pg_policies where tablename = 'content_audit_log' and cmd <> 'ALL') = 1
     and exists (select 1 from pg_policies where tablename = 'content_audit_log' and policyname = 'Executives read content audit log' and cmd = 'SELECT' and qual like '%is_executive%'), 'one read policy, for executives';
  assert exists (select 1 from pg_indexes where tablename = 'content_audit_log' and indexdef like '%(occurred_at DESC, id DESC)%'), 'newest-first index';
  assert exists (select 1 from pg_indexes where tablename = 'content_audit_log' and indexdef like '%(entity_type, entity_id, id DESC)%'), 'entity index';
  assert not exists (select 1 from pg_constraint where conrelid = 'public.content_audit_log'::regclass and contype = 'f'), 'no foreign key: the trail outlives the people in it';
  assert exists (select 1 from pg_trigger where tgrelid = 'public.content_audit_log'::regclass and tgname = 'block_deactivated_writer'), 'the deactivation rule';

  -- three statement triggers per audited table, AFTER, with transition tables, firing always
  for t in select unnest(expected) as tbl loop
    if (select count(*) from pg_trigger g where g.tgrelid = format('public.%I', t.tbl)::regclass and g.tgname in ('audit_content_insert', 'audit_content_update', 'audit_content_delete')
          and g.tgenabled = 'A' and (g.tgtype & 1) = 0 and (g.tgtype & 2) = 0 and g.tgfoid = 'private.audit_content_change'::regproc) <> 3 then
      problems := problems || (t.tbl || ': the three AFTER STATEMENT triggers, enabled always');
    end if;
    if not exists (select 1 from pg_trigger g where g.tgrelid = format('public.%I', t.tbl)::regclass and g.tgname = 'audit_content_insert' and g.tgnewtable = 'new_rows' and (g.tgtype & 4) = 4)
       or not exists (select 1 from pg_trigger g where g.tgrelid = format('public.%I', t.tbl)::regclass and g.tgname = 'audit_content_update' and g.tgnewtable = 'new_rows' and g.tgoldtable = 'old_rows' and (g.tgtype & 16) = 16)
       or not exists (select 1 from pg_trigger g where g.tgrelid = format('public.%I', t.tbl)::regclass and g.tgname = 'audit_content_delete' and g.tgoldtable = 'old_rows' and (g.tgtype & 8) = 8) then
      problems := problems || (t.tbl || ': transition tables / events');
    end if;
  end loop;
  -- and no other table has them (a new audited table is a decision, written here)
  if (select count(distinct g.tgrelid) from pg_trigger g where g.tgfoid = 'private.audit_content_change'::regproc) <> cardinality(expected) then
    raise exception 'CONTENT AUDIT catalog: the audited tables are not exactly %', expected;
  end if;

  assert (select tgenabled from pg_trigger where tgrelid = 'public.content_audit_log'::regclass and tgname = 'refuse_content_audit_change') = 'A', 'append-only trigger fires always';
  assert (select tgenabled from pg_trigger where tgrelid = 'public.content_audit_log'::regclass and tgname = 'refuse_content_audit_truncate') = 'A', 'truncate trigger fires always';
  -- the functions: only list_content_audit is callable, and only by signed-in people
  assert not has_function_privilege('authenticated', 'private.audit_content_change()', 'execute') and not has_function_privilege('anon', 'private.audit_content_change()', 'execute');
  assert not has_function_privilege('authenticated', 'private.refuse_content_audit_change()', 'execute');
  assert not has_function_privilege('authenticated', 'private.audit_pick(jsonb, text[])', 'execute');
  assert not has_function_privilege('authenticated', 'private.audit_diff(jsonb, jsonb, text[], text[])', 'execute');
  assert has_function_privilege('authenticated', 'public.list_content_audit(integer, bigint, text)', 'execute');
  assert not has_function_privilege('anon', 'public.list_content_audit(integer, bigint, text)', 'execute');
  assert (select not prosecdef from pg_proc where oid = 'public.list_content_audit(integer, bigint, text)'::regprocedure), 'the read function is SECURITY INVOKER';
  assert (select prosecdef from pg_proc where oid = 'private.audit_content_change'::regproc), 'the trigger function is SECURITY DEFINER';
  assert (select proconfig @> array['search_path=""'] from pg_proc where oid = 'private.audit_content_change'::regproc), 'with an empty search_path';
  if cardinality(problems) > 0 then raise exception 'CONTENT AUDIT catalog: %', array_to_string(problems, '; '); end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- B. What each audited table writes
-- ---------------------------------------------------------------------------------------------------------
do $$
declare
  v_exec uuid := test.make_user('Exec F77c', 'executive');
  v_mgr uuid := test.make_user('Manager F77c');
  v_mem uuid := test.make_user('Member F77c');
  v_g bigint; v_ev bigint; v_an bigint; v_folder bigint; v_file bigint; v_imp uuid; v_rec bigint; v_note bigint; v_item bigint;
  m bigint;
  r jsonb;
begin
  -- subgroups and memberships
  m := test.m77c_mark();
  perform test.login(v_exec);
  select id into v_g from public.create_subgroup('F77c Group', 'a private description', 'open');
  perform test.logout();
  r := test.m77c_one(m, 'subgroup', 'insert');
  assert r ->> 'entity_id' = v_g::text and r ->> 'label' = 'F77c Group' and (r ->> 'subgroup_id')::bigint = v_g and r ->> 'actor_id' = v_exec::text, 'subgroup insert: ' || r::text;
  assert r -> 'details' -> 'values' ->> 'name' = 'F77c Group' and not (r -> 'details' -> 'values' ? 'description'), 'the description is not copied: ' || r::text;
  r := test.m77c_one(m, 'subgroup_membership', 'insert');
  assert r ->> 'entity_id' = v_g || ':' || v_exec and r -> 'details' -> 'values' ->> 'membership_role' = 'manager', 'the creator becomes manager: ' || r::text;

  m := test.m77c_mark();
  perform test.login(v_exec);
  perform public.add_subgroup_member(v_g, v_mgr);
  perform public.set_subgroup_member_role(v_g, v_mgr, 'manager');
  perform public.add_subgroup_member(v_g, v_mem);
  perform test.logout();
  assert test.m77c_count(m, 'subgroup_membership', 'insert') = 2, 'two members added';
  r := test.m77c_one(m, 'subgroup_membership', 'update');
  assert r ->> 'entity_id' = v_g || ':' || v_mgr and r -> 'details' -> 'changes' -> 'membership_role' = '["member", "manager"]'::jsonb, 'role change: ' || r::text;

  m := test.m77c_mark();
  perform test.login(v_exec);
  perform public.update_subgroup(v_g, 'F77c Group renamed', 'another private description');
  perform public.update_subgroup(v_g, 'F77c Group renamed', 'another private description');   -- the same again: nothing changed
  perform test.logout();
  r := test.m77c_one(m, 'subgroup', 'update');
  assert r -> 'details' -> 'changes' -> 'name' = '["F77c Group", "F77c Group renamed"]'::jsonb and r -> 'details' -> 'named' = '["description"]'::jsonb, 'rename: ' || r::text;
  assert position('private description' in r::text) = 0, 'the description text is not in the log';
  assert test.m77c_count(m, 'subgroup', 'update') = 1, 'the repeated, identical update wrote nothing';

  m := test.m77c_mark();
  perform test.login(v_exec);
  perform public.set_subgroup_enrollment_mode(v_g, 'approval');
  perform public.set_subgroup_archived(v_g, true);
  perform public.set_subgroup_archived(v_g, false);
  perform test.logout();
  assert test.m77c_count(m, 'subgroup', 'update') = 3, 'enrollment mode, archive, unarchive';
  assert exists (select 1 from public.content_audit_log where id > m and details -> 'changes' -> 'enrollment_mode' = '["open", "approval"]'::jsonb), 'enrollment mode change';
  assert exists (select 1 from public.content_audit_log where id > m and (details -> 'changes') ? 'archived_at'), 'archive change';

  m := test.m77c_mark();
  perform test.login(v_exec);
  perform public.remove_subgroup_member(v_g, v_mem);
  perform test.logout();
  r := test.m77c_one(m, 'subgroup_membership', 'update');
  assert r -> 'details' -> 'changes' -> 'status' = '["active", "removed"]'::jsonb, 'removal: ' || r::text;
  perform test.login(v_exec);
  perform public.add_subgroup_member(v_g, v_mem);
  perform test.logout();

  -- events (executives)
  m := test.m77c_mark();
  perform test.login(v_exec);
  insert into public.events(title, description, starts_at, subgroup_id) values ('F77c Rehearsal', 'event private text', now() + interval '1 day', v_g) returning id into v_ev;
  perform test.logout();
  r := test.m77c_one(m, 'event', 'insert');
  assert r ->> 'entity_id' = v_ev::text and r ->> 'label' = 'F77c Rehearsal' and (r ->> 'subgroup_id')::bigint = v_g and r -> 'details' -> 'values' ->> 'title' = 'F77c Rehearsal', 'event insert: ' || r::text;
  assert position('event private text' in r::text) = 0, 'the description is not copied';
  m := test.m77c_mark();
  perform test.login(v_exec);
  update public.events set description = 'a different private text' where id = v_ev;
  perform test.logout();
  r := test.m77c_one(m, 'event', 'update');
  assert r -> 'details' -> 'named' = '["description"]'::jsonb and not ((r -> 'details') ? 'changes') and position('different private' in r::text) = 0, 'a description-only edit names the column: ' || r::text;
  m := test.m77c_mark();
  perform test.login(v_exec);
  update public.events set title = 'F77c Rehearsal moved', location = 'Hall 2' where id = v_ev;
  perform test.logout();
  r := test.m77c_one(m, 'event', 'update');
  assert r -> 'details' -> 'changes' -> 'title' = '["F77c Rehearsal", "F77c Rehearsal moved"]'::jsonb and r -> 'details' -> 'changes' -> 'location' = '["", "Hall 2"]'::jsonb, 'title and location: ' || r::text;
  m := test.m77c_mark();
  perform test.login(v_exec);
  delete from public.events where id = v_ev;
  perform test.logout();
  r := test.m77c_one(m, 'event', 'delete');
  assert r ->> 'entity_id' = v_ev::text and r -> 'details' -> 'values' ->> 'title' = 'F77c Rehearsal moved', 'event delete keeps what it was: ' || r::text;

  -- announcements
  m := test.m77c_mark();
  perform test.login(v_exec);
  insert into public.announcements(title, body, subgroup_id) values ('F77c News', 'secret body text', v_g) returning id into v_an;
  perform test.logout();
  r := test.m77c_one(m, 'announcement', 'insert');
  assert r ->> 'label' = 'F77c News' and position('secret body text' in r::text) = 0, 'announcement insert, body not copied: ' || r::text;
  m := test.m77c_mark();
  perform test.login(v_exec);
  update public.announcements set body = 'a new secret body' where id = v_an;
  update public.announcements set is_pinned = true where id = v_an;
  perform test.logout();
  assert test.m77c_count(m, 'announcement', 'update') = 2, 'body edit and pin';
  assert exists (select 1 from public.content_audit_log where id > m and details -> 'named' = '["body"]'::jsonb and position('new secret' in details::text) = 0), 'a body edit names the column and keeps the text out';
  assert exists (select 1 from public.content_audit_log where id > m and details -> 'changes' -> 'is_pinned' = '[false, true]'::jsonb), 'a pin is a change';
  m := test.m77c_mark();
  perform test.login(v_exec);
  delete from public.announcements where id = v_an;
  perform test.logout();
  r := test.m77c_one(m, 'announcement', 'delete');
  assert r ->> 'label' = 'F77c News', 'announcement delete: ' || r::text;

  -- resources and imports (a group manager)
  m := test.m77c_mark();
  perform test.login(v_mgr);
  insert into public.resources(node_kind, title, description, subgroup_id, visibility, status) values ('folder', 'F77c Folder', 'folder private', v_g, 'members', 'ready') returning id into v_folder;
  perform test.logout();
  r := test.m77c_one(m, 'resource', 'insert');
  assert r ->> 'actor_id' = v_mgr::text and r ->> 'label' = 'F77c Folder' and r -> 'details' -> 'values' ->> 'visibility' = 'members' and r -> 'details' -> 'values' ->> 'node_kind' = 'folder', 'resource insert: ' || r::text;
  m := test.m77c_mark();
  perform test.login(v_mgr);
  insert into public.resource_imports(name, subgroup_id, root_parent_id, status, total_files, total_bytes) values ('F77c import', v_g, v_folder, 'uploading', 2, 20) returning id into v_imp;
  perform test.logout();
  r := test.m77c_one(m, 'resource_import', 'insert');
  assert r ->> 'entity_id' = v_imp::text and r ->> 'label' = 'F77c import' and r -> 'details' -> 'values' ->> 'status' = 'uploading', 'import insert: ' || r::text;
  -- the files of the import write nothing when they are created, nor when they are filled in
  m := test.m77c_mark();
  perform test.login(v_mgr);
  insert into public.resources(node_kind, media_kind, title, parent_id, subgroup_id, visibility, status, storage_bucket, storage_path, original_filename, mime_type, byte_size, import_id)
    values ('file', 'document', 'F77c file one', v_folder, v_g, 'members', 'pending_upload', 'club-resources', 'f77c/one.pdf', 'one.pdf', 'application/pdf', 10, v_imp) returning id into v_file;
  insert into public.resources(node_kind, media_kind, title, parent_id, subgroup_id, visibility, status, storage_bucket, storage_path, original_filename, mime_type, byte_size, import_id)
    values ('file', 'document', 'F77c file two', v_folder, v_g, 'members', 'pending_upload', 'club-resources', 'f77c/two.pdf', 'two.pdf', 'application/pdf', 10, v_imp);
  update public.resources set status = 'ready' where import_id = v_imp;
  update public.resource_imports set completed_files = 1, uploaded_bytes = 10 where id = v_imp;
  update public.resource_imports set completed_files = 2, uploaded_bytes = 20 where id = v_imp;
  perform test.logout();
  assert test.m77c_count(m, 'resource', 'insert') = 0 and test.m77c_count(m, 'resource', 'update') = 0, 'import children and their status changes write nothing: ' || test.m77c_rows(m)::text;
  assert test.m77c_count(m, 'resource_import', 'update') = 0, 'upload progress writes nothing';
  m := test.m77c_mark();
  perform test.login(v_mgr);
  update public.resource_imports set status = 'completed' where id = v_imp;
  perform test.logout();
  r := test.m77c_one(m, 'resource_import', 'update');
  assert r -> 'details' -> 'changes' -> 'status' = '["uploading", "completed"]'::jsonb, 'the import finishing is one line: ' || r::text;
  -- later edits of an imported file are logged like any other
  m := test.m77c_mark();
  perform test.login(v_mgr);
  update public.resources set title = 'F77c file one renamed' where id = v_file;
  perform test.logout();
  r := test.m77c_one(m, 'resource', 'update');
  assert r ->> 'entity_id' = v_file::text and r -> 'details' -> 'changes' -> 'title' = '["F77c file one", "F77c file one renamed"]'::jsonb, 'rename of an imported file: ' || r::text;
  -- a visibility change shows old and new (an executive makes a stand-alone folder executives-only)
  m := test.m77c_mark();
  perform test.login(v_exec);
  insert into public.resources(node_kind, title, visibility, status) values ('folder', 'F77c Solo', 'members', 'ready');
  update public.resources set visibility = 'executives' where title = 'F77c Solo';
  perform test.logout();
  assert exists (select 1 from public.content_audit_log where id > m and entity_type = 'resource' and details -> 'changes' -> 'visibility' = '["members", "executives"]'::jsonb), 'visibility change shows old and new';
  m := test.m77c_mark();
  perform test.login(v_exec);   -- only executives can repoint a file
  update public.resources set storage_path = 'f77c/elsewhere.pdf' where id = v_file;
  perform test.logout();
  perform test.login(v_mgr);
  update public.resources set description = 'folder private, edited' where id = v_folder;
  perform test.logout();
  assert exists (select 1 from public.content_audit_log where id > m and entity_id = v_file::text and details -> 'named' = '["storage_path"]'::jsonb and position('elsewhere' in details::text) = 0), 'a file path swap names the column, not the path';
  m := test.m77c_mark();
  perform test.login(v_exec);
  delete from public.resources where id = v_file;
  perform test.logout();
  r := test.m77c_one(m, 'resource', 'delete');
  assert r ->> 'entity_id' = v_file::text and r -> 'details' -> 'values' ->> 'title' = 'F77c file one renamed', 'resource delete: ' || r::text;

  -- recordings and notes (a member of the group writes them)
  m := test.m77c_mark();
  perform test.login(v_mem);
  insert into public.recordings(title, description, subgroup_id, storage_path, status, audience) values ('F77c take', 'take private', v_g, v_mem || '/f77c/take.webm', 'draft', 'subgroup') returning id into v_rec;
  perform test.logout();
  r := test.m77c_one(m, 'recording', 'insert');
  assert r ->> 'actor_id' = v_mem::text and r ->> 'label' = 'F77c take' and r -> 'details' -> 'values' ->> 'status' = 'draft' and r -> 'details' -> 'values' ->> 'audience' = 'subgroup', 'recording insert: ' || r::text;
  m := test.m77c_mark();
  perform test.login(v_mem);
  update public.recordings set status = 'published', audience = 'club' where id = v_rec;
  update public.recordings set description = 'take private, edited' where id = v_rec;
  update public.recordings set duration_seconds = 61.5 where id = v_rec;
  perform test.logout();
  assert test.m77c_count(m, 'recording', 'update') = 2, 'publish and description; the duration is not tracked: ' || test.m77c_rows(m)::text;
  assert exists (select 1 from public.content_audit_log where id > m and details -> 'changes' -> 'status' = '["draft", "published"]'::jsonb and details -> 'changes' -> 'audience' = '["subgroup", "club"]'::jsonb), 'publishing is a change of status and audience';
  m := test.m77c_mark();
  perform test.login(v_mem);
  insert into public.recording_notes(recording_id, title, note_type, body) values (v_rec, 'F77c notation', 'text', 'notation private') returning id into v_note;
  perform test.logout();
  r := test.m77c_one(m, 'recording_note', 'insert');
  assert r ->> 'label' = 'F77c notation' and position('notation private' in r::text) = 0, 'note insert, text not copied: ' || r::text;
  m := test.m77c_mark();
  perform test.login(v_mem);
  delete from public.recording_notes where id = v_note;
  delete from public.recordings where id = v_rec;
  perform test.logout();
  assert test.m77c_count(m, 'recording_note', 'delete') = 1 and test.m77c_count(m, 'recording', 'delete') = 1, 'both deletes logged';

  -- archive items (executives; the legacy list that feeds the public page)
  m := test.m77c_mark();
  perform test.login(v_exec);
  insert into public.archive_items(title, type, storage_path, visibility, is_public) values ('F77c archive', 'recording', 'f77c/archive.mp3', 'members', false) returning id into v_item;
  update public.archive_items set is_public = true where id = v_item;
  perform test.logout();
  r := test.m77c_one(m, 'archive_item', 'update');
  assert r -> 'details' -> 'changes' -> 'is_public' = '[false, true]'::jsonb and r ->> 'label' = 'F77c archive', 'making an item public is a logged change: ' || r::text;
  assert test.m77c_count(m, 'archive_item', 'insert') = 1;
  m := test.m77c_mark();
  perform test.login(v_exec);
  delete from public.archive_items where id = v_item;
  perform test.logout();
  assert test.m77c_count(m, 'archive_item', 'delete') = 1, 'archive delete';
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- C. Noise decisions
-- ---------------------------------------------------------------------------------------------------------
do $$
declare
  v_exec uuid := test.make_user('Exec F77c C', 'executive');
  m bigint;
  r jsonb;
begin
  perform test.login(v_exec);
  insert into public.events(title, starts_at) select 'F77c noise ' || i, now() + interval '1 day' from generate_series(1, 3) i;
  perform test.logout();

  m := test.m77c_mark();
  perform test.login(v_exec);
  update public.events set title = title where title like 'F77c noise%';                                -- same values
  update public.events set created_by = created_by where title like 'F77c noise%';                       -- an untracked column
  update public.events set title = 'x' where false;                                                       -- no rows
  delete from public.events where false;
  insert into public.events(title, starts_at) select 'never', now() where false;
  perform test.logout();
  assert test.m77c_rows(m) = '[]'::jsonb, 'nothing tracked changed, nothing written: ' || test.m77c_rows(m)::text;

  -- exactly ten rows in one statement: ten lines; eleven: one summary
  m := test.m77c_mark();
  perform test.login(v_exec);
  insert into public.events(title, starts_at) select 'F77c ten ' || i, now() from generate_series(1, 10) i;
  perform test.logout();
  assert test.m77c_count(m, 'event', 'insert') = 10 and (select max(row_count) from public.content_audit_log where id > m) = 1, 'ten rows are ten lines';
  m := test.m77c_mark();
  perform test.login(v_exec);
  insert into public.events(title, starts_at) select 'F77c eleven ' || i, now() from generate_series(1, 11) i;
  perform test.logout();
  r := test.m77c_one(m, 'event', 'insert');
  assert (r ->> 'row_count')::int = 11 and r ->> 'entity_id' is null and jsonb_array_length(r -> 'details' -> 'keys') = 11, 'eleven rows are one summary line: ' || r::text;
  m := test.m77c_mark();
  perform test.login(v_exec);
  insert into public.events(title, starts_at) select 'F77c many ' || i, now() from generate_series(1, 25) i;
  perform test.logout();
  r := test.m77c_one(m, 'event', 'insert');
  assert (r ->> 'row_count')::int = 25 and jsonb_array_length(r -> 'details' -> 'keys') = 20, 'a summary keeps 20 ids and the true count: ' || r::text;

  -- a bulk update and a bulk delete: one line each, with the changed columns
  m := test.m77c_mark();
  perform test.login(v_exec);
  update public.events set location = 'Bulk hall', description = 'bulk' where title like 'F77c many %';
  perform test.logout();
  r := test.m77c_one(m, 'event', 'update');
  assert (r ->> 'row_count')::int = 25 and r -> 'details' -> 'columns' = '["description", "location"]'::jsonb, 'bulk update: ' || r::text;
  m := test.m77c_mark();
  perform test.login(v_exec);
  delete from public.events where title like 'F77c many %';
  perform test.logout();
  r := test.m77c_one(m, 'event', 'delete');
  assert (r ->> 'row_count')::int = 25, 'bulk delete: ' || r::text;

  -- an upsert that inserts and updates is logged as the insert and the update it is
  m := test.m77c_mark();
  perform test.login(v_exec);
  insert into public.announcements(id, title, body) overriding system value values (987654, 'F77c upsert', 'b') on conflict (id) do update set title = excluded.title;
  insert into public.announcements(id, title, body) overriding system value values (987654, 'F77c upsert 2', 'b') on conflict (id) do update set title = excluded.title;
  perform test.logout();
  assert test.m77c_count(m, 'announcement', 'insert') = 1 and test.m77c_count(m, 'announcement', 'update') = 1, 'upsert: ' || test.m77c_rows(m)::text;

  -- long text is cut
  m := test.m77c_mark();
  perform test.login(v_exec);
  insert into public.events(title, starts_at) values (repeat('L', 200), now());
  perform test.logout();
  r := test.m77c_one(m, 'event', 'insert');
  assert char_length(r ->> 'label') <= 200 and char_length(r -> 'details' -> 'values' ->> 'title') <= 200, 'text is bounded';
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- D. Actors
-- ---------------------------------------------------------------------------------------------------------
do $$
declare
  v_admin uuid := test.make_user('Admin F77c D', 'admin');
  v_former uuid := test.make_user('Former F77c D', 'executive');
  m bigint;
  r jsonb;
begin
  -- the system: no signed-in person
  m := test.m77c_mark();
  insert into public.events(title, starts_at) values ('F77c by the system', now());
  r := test.m77c_one(m, 'event', 'insert');
  assert r ->> 'actor_id' is null, 'a write with nobody signed in has no actor: ' || r::text;

  -- an account that is deleted keeps its trail
  m := test.m77c_mark();
  perform test.login(v_former);
  insert into public.events(title, starts_at) values ('F77c by a former executive', now());
  perform test.logout();
  assert (select actor_id from public.content_audit_log where id > m and entity_type = 'event') = v_former;
  perform test.login(v_admin);
  perform public.admin_delete_member(v_former);
  perform test.logout();
  assert not exists (select 1 from public.profiles where id = v_former), 'the account is gone';
  assert exists (select 1 from public.content_audit_log where actor_id = v_former and entity_type = 'event'), 'the audit row still names them';
  assert (select created_by from public.events where title = 'F77c by a former executive') is null, 'while the event itself lost its author';
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- E. Reading
-- ---------------------------------------------------------------------------------------------------------
do $$
declare
  v_exec uuid := test.make_user('Exec F77c E', 'executive');
  v_admin uuid := test.make_user('Admin F77c E', 'admin');
  v_mgr uuid := test.make_user('Manager F77c E');
  v_mem uuid := test.make_user('Member F77c E');
  v_out uuid := test.make_user('Outsider F77c E');
  v_dx uuid := test.make_user('Deactivated Exec F77c E', 'executive');
  v_g bigint;
  total bigint;
  who record;
  seen bigint;
  st text;
begin
  perform test.login(v_exec);
  select id into v_g from public.create_subgroup('F77c Group E', '', 'open');
  perform public.add_subgroup_member(v_g, v_mgr);
  perform public.set_subgroup_member_role(v_g, v_mgr, 'manager');
  perform public.add_subgroup_member(v_g, v_mem);
  insert into public.events(title, starts_at, subgroup_id) values ('F77c E event', now(), v_g);
  perform test.logout();
  perform test.login(v_admin);
  perform public.admin_deactivate_member(v_dx, 'F77c: a deactivated executive');
  perform test.logout();
  select count(*) into total from public.content_audit_log;
  assert total > 5, 'there is something to read';

  for who in
    select * from (values
      ('executive', v_exec, true), ('administrator', v_admin, true),
      ('group manager', v_mgr, false), ('group member', v_mem, false), ('outsider', v_out, false), ('deactivated executive', v_dx, false), ('anonymous', null::uuid, false)
    ) w(label, id, may_read)
  loop
    perform test.login(who.id);
    begin
      select count(*) into seen from public.content_audit_log;
    exception when insufficient_privilege then
      seen := -1;
    end;
    perform test.logout();
    if who.may_read then
      assert seen = total, format('%s sees every row (%s of %s)', who.label, seen, total);
    elsif who.label = 'anonymous' then
      assert seen = -1, 'anonymous: permission denied';
    else
      assert seen = 0, format('%s sees %s rows', who.label, seen);
    end if;
    -- the function
    st := test.m77c_state(who.id, 'select count(*) from public.list_content_audit()');
    if who.may_read then assert st = 'ok', who.label || ' can list: ' || st;
    else assert st = '42501', who.label || ' is refused by the function: ' || st; end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- F. Writing: nobody through the API; append-only for the owner too
-- ---------------------------------------------------------------------------------------------------------
do $$
declare
  v_exec uuid := test.make_user('Exec F77c F', 'executive');
  v_admin uuid := test.make_user('Admin F77c F', 'admin');
  v_mem uuid := test.make_user('Member F77c F');
  who record;
  stmt text;
  failures text[] := '{}';
  st text;
  m text;
  n bigint;
begin
  perform test.login(v_exec);
  insert into public.events(title, starts_at) values ('F77c F event', now());
  perform test.logout();
  select count(*) into n from public.content_audit_log;

  for who in select * from (values ('executive', v_exec), ('administrator', v_admin), ('member', v_mem), ('anonymous', null::uuid)) w(label, id) loop
    foreach stmt in array array[
      format('insert into public.content_audit_log (entity_type, entity_id, action) values (''event'', ''1'', ''insert'')'),
      format('insert into public.content_audit_log (actor_id, entity_type, entity_id, action) values (%L, ''event'', ''1'', ''delete'')', coalesce(who.id, v_exec)),
      'update public.content_audit_log set label = ''rewritten''',
      'update public.content_audit_log set actor_id = null',
      'delete from public.content_audit_log',
      'truncate public.content_audit_log'] loop
      st := test.m77c_state(who.id, stmt);
      if st <> '42501' then failures := failures || (who.label || ': ' || stmt || ' -> ' || st); end if;
    end loop;
    -- nor can they switch the audit off
    st := test.m77c_state(who.id, 'alter table public.events disable trigger audit_content_update');
    if st <> '42501' then failures := failures || (who.label || ': disable a trigger -> ' || st); end if;
    st := test.m77c_state(who.id, 'alter table public.content_audit_log disable trigger refuse_content_audit_change');
    if st <> '42501' then failures := failures || (who.label || ': disable the append-only trigger -> ' || st); end if;
    st := test.m77c_state(who.id, 'set session_replication_role = replica');
    if st <> '42501' then failures := failures || (who.label || ': set session_replication_role -> ' || st); end if;
    st := test.m77c_state(who.id, 'select private.audit_content_change()');
    if st not in ('42501', '0A000') then failures := failures || (who.label || ': call the trigger function -> ' || st); end if;
  end loop;
  if cardinality(failures) > 0 then raise exception 'CONTENT AUDIT writing: %', array_to_string(failures, '; '); end if;
  assert (select count(*) from public.content_audit_log) = n, 'none of those wrote or removed a row';

  -- the owner is held to it as well, and a session cannot switch the triggers off
  m := test.error_of('update public.content_audit_log set label = ''rewritten''');
  assert m like '%append-only%', 'the owner cannot update: ' || coalesce(m, 'no error');
  m := test.error_of('delete from public.content_audit_log');
  assert m like '%append-only%', 'the owner cannot delete: ' || coalesce(m, 'no error');
  m := test.error_of('truncate public.content_audit_log');
  assert m like '%append-only%', 'the owner cannot truncate: ' || coalesce(m, 'no error');
  set local session_replication_role = replica;
  m := test.error_of('delete from public.content_audit_log');
  assert m like '%append-only%', 'not even with session_replication_role = replica: ' || coalesce(m, 'no error');
  m := test.error_of('truncate public.content_audit_log');
  assert m like '%append-only%', 'nor truncate under replica: ' || coalesce(m, 'no error');
  -- ... and the audit triggers fire under replica too
  perform set_config('request.jwt.claim.sub', v_exec::text, true);
  insert into public.events(title, starts_at) values ('F77c replica event', now());
  perform set_config('request.jwt.claim.sub', '', true);
  set local session_replication_role = origin;
  assert exists (select 1 from public.content_audit_log where entity_type = 'event' and action = 'insert' and label = 'F77c replica event' and actor_id = v_exec), 'an audited write under session_replication_role = replica is still audited';
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- G. list_content_audit
-- ---------------------------------------------------------------------------------------------------------
do $$
declare
  v_exec uuid := test.make_user('Exec F77c G', 'executive');
  v_other uuid := test.make_user('Other Exec F77c G', 'executive');
  m bigint;
  ids bigint[];
  page1 bigint[]; page2 bigint[];
  n int;
begin
  m := test.m77c_mark();
  perform test.login(v_exec);
  for i in 1..205 loop insert into public.announcements(title, body) values ('F77c G ' || i, 'b'); end loop;
  perform test.logout();
  perform test.login(v_other);
  insert into public.announcements(title, body) values ('F77c G by the other one', 'b');
  perform test.logout();
  insert into public.announcements(title, body) values ('F77c G by the system', 'b');

  perform test.login(v_exec);
  select count(*) into n from public.list_content_audit(1000, null, 'announcement');
  assert n = 200, 'the limit is clamped to 200: ' || n;
  select count(*) into n from public.list_content_audit(0, null, 'announcement');
  assert n = 1, 'a limit of 0 gives 1: ' || n;
  select count(*) into n from public.list_content_audit(-5, null, 'announcement');
  assert n = 1, 'a negative limit gives 1';
  select count(*) into n from public.list_content_audit(null, null, 'announcement');
  assert n = 50, 'the default is 50: ' || n;
  select count(*) into n from public.list_content_audit();
  assert n = 50, 'no arguments: 50';

  -- newest first, and the actor's name
  select array_agg(id order by ord) into ids from (select id, row_number() over () as ord from public.list_content_audit(5, null, 'announcement')) s;
  assert ids[1] > ids[2] and ids[2] > ids[3] and ids[4] > ids[5], 'newest first';
  assert (select entity_id from public.list_content_audit(1, null, 'announcement')) = (select entity_id from public.content_audit_log where entity_type = 'announcement' order by id desc limit 1), 'the newest is first';
  assert (select actor_name from public.list_content_audit(1, null, 'announcement')) is null, 'the system write has no actor name';
  assert (select actor_name from public.list_content_audit(2, null, 'announcement') order by id asc limit 1) = 'Other Exec F77c G', 'the name of the actor is joined';
  assert (select actor_name from public.list_content_audit(3, null, 'announcement') order by id asc limit 1) = 'Exec F77c G';

  -- paging: no overlap, no gap
  select array_agg(id) into page1 from public.list_content_audit(100, null, 'announcement');
  select array_agg(id) into page2 from public.list_content_audit(100, page1[array_length(page1, 1)], 'announcement');
  assert array_length(page2, 1) = 100 and page2[1] < page1[array_length(page1, 1)], 'the next page starts after the last id';
  assert (select count(*) from unnest(page1) a join unnest(page2) b on a = b) = 0, 'no overlap';
  select count(*) into n from public.list_content_audit(200, page2[array_length(page2, 1)], 'announcement');
  assert n = (select count(*) from public.content_audit_log where entity_type = 'announcement' and id < page2[array_length(page2, 1)]) or n = 200, 'the rest';

  -- the entity filter
  assert not exists (select 1 from public.list_content_audit(200, null, 'announcement') where entity_type <> 'announcement'), 'filter';
  assert (select count(*) from public.list_content_audit(200, null, 'no such thing')) = 0, 'an unknown type gives nothing';
  assert (select count(distinct entity_type) from public.list_content_audit(200, m + 1)) > 3, 'unfiltered lists all kinds';
  perform test.logout();
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- H. Cascades: rows removed by a foreign key are audited as the statements they are
-- ---------------------------------------------------------------------------------------------------------
do $$
declare
  v_exec uuid := test.make_user('Exec F77c H', 'executive');
  v_g bigint; v_ev bigint;
  m bigint;
begin
  perform test.login(v_exec);
  select id into v_g from public.create_subgroup('F77c Group H', '', 'open');
  insert into public.events(title, starts_at, subgroup_id) values ('F77c H event', now(), v_g) returning id into v_ev;
  insert into public.announcements(title, body, subgroup_id) values ('F77c H news', 'b', v_g);
  perform test.logout();
  m := test.m77c_mark();
  perform set_config('request.jwt.claim.sub', v_exec::text, true);
  delete from public.subgroups where id = v_g;
  perform set_config('request.jwt.claim.sub', '', true);
  assert test.m77c_count(m, 'subgroup', 'delete') = 1, 'the group deletion: ' || test.m77c_rows(m)::text;
  assert exists (select 1 from public.content_audit_log where id > m and entity_type = 'event' and action = 'delete' and entity_id = v_ev::text and actor_id = v_exec), 'the cascaded event delete is audited, with the actor: ' || test.m77c_rows(m)::text;
  assert test.m77c_count(m, 'announcement', 'delete') = 1, 'and the announcement';
  assert test.m77c_count(m, 'subgroup_membership', 'delete') = 1, 'and the membership';
end $$;

rollback;
