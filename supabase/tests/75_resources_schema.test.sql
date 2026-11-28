-- Unified resources library: the database rules of the resources, resource_imports,
-- resource_tags and resource_tag_assignments tables (migrations 20260907000000 and
-- 20260907001000, plus the list index of 20261127012000).
--
-- Until the refactor safety net these were pinned only by JavaScript tests that
-- read the migration text (tests/unified-resources-schema.test.mjs and
-- tests/resource-links.test.mjs). A text match protects nothing: it still passes
-- when the trigger is dropped later or a later migration undoes the rule. Here each
-- rule is a statement that is run, and the error or the result is what is asserted.
--
--   A  hierarchy: parent must exist and be a folder, same group scope, same
--      visibility, no self-parent, no cycle, at most three folder levels (inserting
--      under a deep parent and moving a subtree), a parent stays a folder
--   B  column shape of a folder, a link and a file; metadata is a JSON object
--   C  one row per stored object (bucket, path)
--   D  an import's destination folder
--   E  the supporting indexes
--   F  the private buckets, enum values and what happens to a row when its event,
--      its import or its import folder is deleted
--   G  tags and tag assignments: who may read and write them
--   H  can_view_resource() agrees with the SELECT policy on resources
--
-- The copy of legacy archive items and resource links into resources cannot be
-- checked here (this database starts empty); it is checked on a database that is
-- replayed only up to the migration before it, by
-- supabase/tests/concurrency/75_resources_legacy_copy.sh. Real Storage objects are
-- out of reach of this harness (see supabase/tests/README.md); only the bucket rows
-- are checked.
begin;

-- Runs a statement as the given user (the database owner when p_user is null) and
-- returns null when it worked, otherwise 'SQLSTATE|constraint name|message'.
create function test.try_as(p_user uuid, p_sql text) returns text language plpgsql as $$
declare st text; cn text; msg text;
begin
  if p_user is not null then perform test.login(p_user); end if;
  begin
    execute p_sql;
    st := null;
  exception when others then
    get stacked diagnostics st = returned_sqlstate, cn = constraint_name, msg = message_text;
    st := st || '|' || coalesce(cn, '') || '|' || msg;
  end;
  if p_user is not null then perform test.logout(); end if;
  return st;
end $$;
grant execute on function test.try_as(uuid, text) to anon, authenticated;

-- Asserts the outcome of test.try_as: p_expected is a LIKE pattern for the
-- 'SQLSTATE|constraint|message' text, or null when the statement must succeed.
create function test.expect_try(p_label text, p_user uuid, p_sql text, p_expected text) returns void language plpgsql as $$
declare got text;
begin
  got := test.try_as(p_user, p_sql);
  if p_expected is null then
    assert got is null, p_label || ': expected success, got ' || coalesce(got, 'nothing');
  else
    assert got like p_expected, p_label || ': expected ' || p_expected || ', got ' || coalesce(got, 'no error');
  end if;
end $$;
grant execute on function test.expect_try(text, uuid, text, text) to anon, authenticated;

do $$
declare
  v_exec uuid := test.make_user('Exec Seventyfive', 'executive');
  v_mgr uuid := test.make_user('Manager Seventyfive');
  v_member uuid := test.make_user('Member Seventyfive');
  v_other_mgr uuid := test.make_user('Other Manager Seventyfive');
  v_outsider uuid := test.make_user('Outsider Seventyfive');
  v_g1 bigint;
  v_g2 bigint;
  -- the tree: f1 > f2 > f3 (three folder levels), a file in f3, a link in f1
  v_f1 bigint; v_f2 bigint; v_f3 bigint; v_leaf bigint; v_link bigint;
  v_g1_folder bigint; v_g2_folder bigint; v_ex_folder bigint; v_g1_file bigint;
  v_t1 bigint; v_t2 bigint; v_t3 bigint; v_lone bigint; v_x bigint; v_c bigint;
  -- statement templates
  ins_folder text := 'insert into public.resources (node_kind, title, parent_id, subgroup_id, visibility, status, created_by) values (''folder'', %L, %L, %L, %L, ''ready'', %L)';
  ins_link text := 'insert into public.resources (node_kind, title, parent_id, subgroup_id, visibility, status, external_url, created_by) values (''link'', %L, %L, %L, %L, ''ready'', ''https://example.org/r75'', %L)';
  move text := 'update public.resources set parent_id = %L where id = %s';
  imp text := 'insert into public.resource_imports (name, root_parent_id, subgroup_id, visibility, created_by) values (''upload'', %L, %L, %L, %L)';
  c record;
  v_imp text;
  got text;
begin
  perform test.login(v_exec);
  select id into v_g1 from public.create_subgroup('R75 Ensemble', '', 'open');
  select id into v_g2 from public.create_subgroup('R75 Other', '', 'open');
  perform public.add_subgroup_member(v_g1, v_mgr);
  perform public.add_subgroup_member(v_g1, v_member);
  perform public.add_subgroup_member(v_g2, v_other_mgr);
  perform public.set_subgroup_member_role(v_g1, v_mgr, 'manager');
  perform public.set_subgroup_member_role(v_g2, v_other_mgr, 'manager');
  perform test.logout();

  -- =========================================================================
  -- A. Hierarchy (private.validate_resource_hierarchy). Everything below is done
  --    as an executive through the signed-in role, the way the portal does it.
  -- =========================================================================
  insert into public.resources (node_kind, title, visibility, status, created_by) values ('folder', 'R75 level 1', 'members', 'ready', v_exec) returning id into v_f1;
  insert into public.resources (node_kind, title, parent_id, visibility, status, created_by) values ('folder', 'R75 level 2', v_f1, 'members', 'ready', v_exec) returning id into v_f2;
  insert into public.resources (node_kind, title, parent_id, visibility, status, created_by) values ('folder', 'R75 level 3', v_f2, 'members', 'ready', v_exec) returning id into v_f3;
  -- Files and links may sit in the third folder, only folders are limited to three levels.
  insert into public.resources (node_kind, media_kind, title, parent_id, visibility, status, storage_bucket, storage_path, created_by)
    values ('file', 'document', 'R75 leaf', v_f3, 'members', 'ready', 'club-resources', 'r75/leaf.pdf', v_exec) returning id into v_leaf;
  insert into public.resources (node_kind, title, parent_id, visibility, status, external_url, created_by)
    values ('link', 'R75 link', v_f1, 'members', 'ready', 'https://example.org/r75', v_exec) returning id into v_link;
  insert into public.resources (node_kind, title, subgroup_id, visibility, status, created_by) values ('folder', 'R75 group folder', v_g1, 'members', 'ready', v_exec) returning id into v_g1_folder;
  insert into public.resources (node_kind, title, subgroup_id, visibility, status, created_by) values ('folder', 'R75 other group folder', v_g2, 'members', 'ready', v_exec) returning id into v_g2_folder;
  insert into public.resources (node_kind, title, visibility, status, created_by) values ('folder', 'R75 executives folder', 'executives', 'ready', v_exec) returning id into v_ex_folder;
  insert into public.resources (node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by)
    values ('file', 'document', 'R75 group file', v_g1, 'members', 'ready', 'club-resources', 'r75/group.pdf', v_exec) returning id into v_g1_file;

  -- The parent must exist and must be a folder.
  perform test.expect_try('parent must exist', v_exec, format(ins_folder, 'orphan', 2000000000, null, 'members', v_exec), 'P0001||resource parent does not exist');
  perform test.expect_try('a link is no parent', v_exec, format(ins_link, 'under a link', v_link, null, 'members', v_exec), 'P0001||resource parent must be a folder');
  perform test.expect_try('a file is no parent (folder child)', v_exec, format(ins_folder, 'under a file', v_leaf, null, 'members', v_exec), 'P0001||resource parent must be a folder');
  perform test.expect_try('a file is no parent (link child)', v_exec, format(ins_link, 'under a file', v_leaf, null, 'members', v_exec), 'P0001||resource parent must be a folder');
  perform test.expect_try('moving under a link is refused too', v_exec, format(move, v_link, v_g1_file), 'P0001||resource parent must be a folder');
  perform test.expect_try('moving under a file is refused too', v_exec, format(move, v_leaf, v_g1_file), 'P0001||resource parent must be a folder');

  -- Parent and child share the group scope.
  perform test.expect_try('club-wide child in a group folder', v_exec, format(ins_folder, 'x', v_g1_folder, null, 'members', v_exec), 'P0001||resource parent and child must have the same subgroup scope');
  perform test.expect_try('group child in a club-wide folder', v_exec, format(ins_link, 'x', v_f1, v_g1, 'members', v_exec), 'P0001||resource parent and child must have the same subgroup scope');
  perform test.expect_try('child of another group', v_exec, format(ins_link, 'x', v_g1_folder, v_g2, 'members', v_exec), 'P0001||resource parent and child must have the same subgroup scope');
  perform test.expect_try('moving a group file to a club-wide folder', v_exec, format(move, v_f1, v_g1_file), 'P0001||resource parent and child must have the same subgroup scope');
  perform test.expect_try('moving a group file to another group''s folder', v_exec, format(move, v_g2_folder, v_g1_file), 'P0001||resource parent and child must have the same subgroup scope');
  perform test.expect_try('changing a child''s group away from its folder', v_exec, format('update public.resources set subgroup_id = %s where id = %s', v_g2, v_leaf), 'P0001||resource parent and child must have the same subgroup scope');

  -- Parent and child share the visibility.
  perform test.expect_try('executives-only child in a members folder', v_exec, format(ins_link, 'x', v_f1, null, 'executives', v_exec), 'P0001||resource parent and child must have the same visibility');
  perform test.expect_try('members child in an executives-only folder', v_exec, format(ins_link, 'x', v_ex_folder, null, 'members', v_exec), 'P0001||resource parent and child must have the same visibility');
  perform test.expect_try('moving a members item into an executives-only folder', v_exec, format(move, v_ex_folder, v_link), 'P0001||resource parent and child must have the same visibility');
  perform test.expect_try('changing a child''s visibility away from its folder', v_exec, format('update public.resources set visibility = ''executives'' where id = %s', v_leaf), 'P0001||resource parent and child must have the same visibility');

  -- No self-parent, no cycle.
  perform test.expect_try('a folder in itself', v_exec, format(move, v_f1, v_f1), 'P0001||a resource cannot be its own parent');
  perform test.expect_try('a folder in its own child', v_exec, format(move, v_f2, v_f1), 'P0001||resource hierarchy cannot contain a cycle');
  perform test.expect_try('a folder in its own grandchild', v_exec, format(move, v_f3, v_f1), 'P0001||resource hierarchy cannot contain a cycle');
  perform test.expect_try('a middle folder under its child', v_exec, format(move, v_f3, v_f2), 'P0001||resource hierarchy cannot contain a cycle');

  -- At most three folder levels, from the child side.
  perform test.expect_try('a fourth folder level', v_exec, format(ins_folder, 'level 4', v_f3, null, 'members', v_exec), 'P0001||resource hierarchy cannot exceed three folder levels');
  insert into public.resources (node_kind, title, visibility, status, created_by) values ('folder', 'R75 lone folder', 'members', 'ready', v_exec) returning id into v_lone;
  perform test.expect_try('moving a folder under the third level', v_exec, format(move, v_f3, v_lone), 'P0001||resource hierarchy cannot exceed three folder levels');
  perform test.expect_try('a folder may sit at level three', v_exec, format(move, v_f2, v_lone), null);
  assert (select parent_id from public.resources where id = v_lone) = v_f2, 'the move to level three happened';
  perform test.expect_try('and go back to the top', v_exec, format(move, null, v_lone), null);
  perform test.expect_try('a link may sit in the third folder', v_exec, format(ins_link, 'deep link', v_f3, null, 'members', v_exec), null);

  -- At most three folder levels, moving a subtree that would become too deep.
  insert into public.resources (node_kind, title, visibility, status, created_by) values ('folder', 'R75 tree root', 'members', 'ready', v_exec) returning id into v_t1;
  insert into public.resources (node_kind, title, parent_id, visibility, status, created_by) values ('folder', 'R75 tree child', v_t1, 'members', 'ready', v_exec) returning id into v_t2;
  insert into public.resources (node_kind, title, parent_id, visibility, status, created_by) values ('folder', 'R75 tree grandchild', v_t2, 'members', 'ready', v_exec) returning id into v_t3;
  -- t1 > t2 > t3 is three levels. Under f1 it would be four, under f2 five.
  perform test.expect_try('a three-level subtree under a folder', v_exec, format(move, v_f1, v_t1), 'P0001||resource hierarchy cannot exceed three folder levels');
  perform test.expect_try('a three-level subtree under a deeper folder', v_exec, format(move, v_f2, v_t1), 'P0001||resource hierarchy cannot exceed three folder levels');
  assert (select parent_id from public.resources where id = v_t1) is null, 'the refused subtree stayed where it was';
  -- A subtree of two levels fits under a top folder (f1 > t1 > t2) but not under a second-level folder.
  insert into public.resources (node_kind, title, visibility, status, created_by) values ('folder', 'R75 pair root', 'members', 'ready', v_exec) returning id into v_x;
  insert into public.resources (node_kind, title, parent_id, visibility, status, created_by) values ('folder', 'R75 pair child', v_x, 'members', 'ready', v_exec);
  perform test.expect_try('a two-level subtree under a second-level folder', v_exec, format(move, v_f2, v_x), 'P0001||resource hierarchy cannot exceed three folder levels');
  perform test.expect_try('a two-level subtree under a top folder', v_exec, format(move, v_f1, v_x), null);
  -- Files inside a moved subtree do not count as a level.
  insert into public.resources (node_kind, title, visibility, status, created_by) values ('folder', 'R75 file holder', 'members', 'ready', v_exec) returning id into v_c;
  insert into public.resources (node_kind, title, parent_id, visibility, status, external_url, created_by) values ('link', 'in holder', v_c, 'members', 'ready', 'https://example.org/r75', v_exec);
  perform test.expect_try('a one-folder subtree with contents under a second-level folder', v_exec, format(move, v_f2, v_c), null);

  -- A resource with children stays a folder.
  perform test.expect_try('a folder with children cannot become a link', v_exec,
    format('update public.resources set node_kind = ''link'', external_url = ''https://example.org/r75'' where id = %s', v_f1), 'P0001||a resource with children must remain a folder');
  perform test.expect_try('nor a file', v_exec,
    format('update public.resources set node_kind = ''file'', media_kind = ''document'', storage_bucket = ''club-resources'', storage_path = ''r75/f2.pdf'' where id = %s', v_f2), 'P0001||a resource with children must remain a folder');
  assert (select node_kind::text from public.resources where id = v_f1) = 'folder', 'f1 is still a folder';
  insert into public.resources (node_kind, title, visibility, status, created_by) values ('folder', 'R75 empty folder', 'members', 'ready', v_exec) returning id into v_x;
  perform test.expect_try('an empty folder may become a link', v_exec,
    format('update public.resources set node_kind = ''link'', external_url = ''https://example.org/r75'' where id = %s', v_x), null);

  -- A folder and everything under it keep one scope and one visibility.
  perform test.expect_try('regrouping a folder that has contents', v_exec, format('update public.resources set subgroup_id = %s where id = %s', v_g1, v_f1), 'P0001||resource descendants must have the same subgroup scope and visibility');
  perform test.expect_try('hiding a folder that has contents', v_exec, format('update public.resources set visibility = ''executives'' where id = %s', v_f1), 'P0001||resource descendants must have the same subgroup scope and visibility');
  -- The same for a folder that has a parent: its new parent matches, its contents do not.
  insert into public.resources (node_kind, title, visibility, status, created_by) values ('folder', 'R75 mover', 'members', 'ready', v_exec) returning id into v_x;
  insert into public.resources (node_kind, title, parent_id, visibility, status, external_url, created_by) values ('link', 'R75 mover content', v_x, 'members', 'ready', 'https://example.org/r75', v_exec);
  perform test.expect_try('moving a folder into a group folder together with a regroup, contents left behind', v_exec,
    format('update public.resources set parent_id = %s, subgroup_id = %s where id = %s', v_g1_folder, v_g1, v_x), 'P0001||resource descendants must have the same subgroup scope and visibility');
  -- What is valid still works: same scope and visibility all the way down.
  perform test.expect_try('a child in a group folder', v_exec, format(ins_link, 'in group', v_g1_folder, v_g1, 'members', v_exec), null);
  perform test.expect_try('a child in an executives-only folder', v_exec, format(ins_link, 'in executives', v_ex_folder, null, 'executives', v_exec), null);

  -- =========================================================================
  -- B. Column shape of each kind of resource, and metadata as a JSON object.
  --    One violation per statement, so the named constraint is the one at fault.
  -- =========================================================================
  for c in select * from (values
    ('a folder with a media kind',          'media_kind, title', '''document'', ''x'''),
    ('a folder with a storage bucket',      'storage_bucket, title', '''club-resources'', ''x'''),
    ('a folder with a storage path',        'storage_path, title', '''r75/folder.pdf'', ''x'''),
    ('a folder with an external url',       'external_url, title', '''https://example.org/x'', ''x'''),
    ('a folder with an original filename',  'original_filename, title', '''a.pdf'', ''x'''),
    ('a folder with a mime type',           'mime_type, title', '''application/pdf'', ''x'''),
    ('a folder with a byte size',           'byte_size, title', '10, ''x'''),
    ('a folder with a checksum',            'checksum_sha256, title', '''' || repeat('a', 64) || ''', ''x''')
  ) as t(label, cols, vals) loop
    perform test.expect_try(c.label, v_exec,
      format('insert into public.resources (node_kind, status, created_by, %s) values (''folder'', ''ready'', %L, %s)', c.cols, v_exec, c.vals),
      '23514|resources_node_shape|%');
  end loop;
  for c in select * from (values
    ('a file without a media kind',      'insert into public.resources (node_kind, title, storage_bucket, storage_path, status, created_by) values (''file'', ''x'', ''club-resources'', ''r75/s1.pdf'', ''ready'', %L)'),
    ('a file without a storage bucket',  'insert into public.resources (node_kind, media_kind, title, storage_path, status, created_by) values (''file'', ''document'', ''x'', ''r75/s2.pdf'', ''ready'', %L)'),
    ('a file without a storage path',    'insert into public.resources (node_kind, media_kind, title, storage_bucket, status, created_by) values (''file'', ''document'', ''x'', ''club-resources'', ''ready'', %L)'),
    ('a file with an external url',      'insert into public.resources (node_kind, media_kind, title, storage_bucket, storage_path, external_url, status, created_by) values (''file'', ''document'', ''x'', ''club-resources'', ''r75/s3.pdf'', ''https://example.org/x'', ''ready'', %L)'),
    ('a link without an external url',   'insert into public.resources (node_kind, title, status, created_by) values (''link'', ''x'', ''ready'', %L)'),
    ('a link with a media kind',         'insert into public.resources (node_kind, media_kind, title, external_url, status, created_by) values (''link'', ''document'', ''x'', ''https://example.org/x'', ''ready'', %L)'),
    ('a link with a storage bucket',     'insert into public.resources (node_kind, storage_bucket, title, external_url, status, created_by) values (''link'', ''club-resources'', ''x'', ''https://example.org/x'', ''ready'', %L)'),
    ('a link with a storage path',       'insert into public.resources (node_kind, storage_path, title, external_url, status, created_by) values (''link'', ''r75/s4.pdf'', ''x'', ''https://example.org/x'', ''ready'', %L)'),
    ('a link to an ftp address',         'insert into public.resources (node_kind, title, external_url, status, created_by) values (''link'', ''x'', ''ftp://example.org/x'', ''ready'', %L)'),
    ('a link to a javascript address',   'insert into public.resources (node_kind, title, external_url, status, created_by) values (''link'', ''x'', ''javascript:alert(1)'', ''ready'', %L)'),
    ('a link with no scheme',            'insert into public.resources (node_kind, title, external_url, status, created_by) values (''link'', ''x'', ''example.org/x'', ''ready'', %L)'),
    ('a link with nothing after the scheme', 'insert into public.resources (node_kind, title, external_url, status, created_by) values (''link'', ''x'', ''https://'', ''ready'', %L)'),
    ('a link with a space in it',        'insert into public.resources (node_kind, title, external_url, status, created_by) values (''link'', ''x'', ''https://example.org/a b'', ''ready'', %L)')
  ) as t(label, stmt) loop
    perform test.expect_try(c.label, v_exec, format(c.stmt, v_exec), '23514|resources_node_shape|%');
  end loop;
  -- The shape is also kept on update.
  perform test.expect_try('a folder given a storage path', v_exec, format('update public.resources set storage_path = ''r75/late.pdf'' where id = %s', v_f1), '23514|resources_node_shape|%');
  perform test.expect_try('a link emptied of its address', v_exec, format('update public.resources set external_url = null where id = %s', v_link), '23514|resources_node_shape|%');
  perform test.expect_try('a file turned into a link keeping its storage', v_exec, format('update public.resources set node_kind = ''link'' where id = %s', v_g1_file), '23514|resources_node_shape|%');
  -- And the valid shapes are accepted.
  perform test.expect_try('a plain folder', v_exec, format('insert into public.resources (node_kind, title, status, created_by) values (''folder'', ''ok'', ''ready'', %L)', v_exec), null);
  perform test.expect_try('a file', v_exec, format('insert into public.resources (node_kind, media_kind, title, storage_bucket, storage_path, original_filename, mime_type, byte_size, checksum_sha256, status, created_by) values (''file'', ''image'', ''ok'', ''club-archive'', ''r75/ok.png'', ''ok.png'', ''image/png'', 10, %L, ''ready'', %L)', repeat('A', 64), v_exec), null);
  perform test.expect_try('a link over http', v_exec, format('insert into public.resources (node_kind, title, external_url, status, created_by) values (''link'', ''ok'', ''http://example.org/a?b=c#d'', ''ready'', %L)', v_exec), null);
  perform test.expect_try('a link over https in capitals', v_exec, format('insert into public.resources (node_kind, title, external_url, status, created_by) values (''link'', ''ok'', ''HTTPS://EXAMPLE.ORG/A'', ''ready'', %L)', v_exec), null);

  -- Metadata must be a JSON object (null is a JSON value too, not the SQL null).
  for c in select * from (values ('an array', '[]'), ('a string', '"text"'), ('a number', '42'), ('a boolean', 'true'), ('a JSON null', 'null')) as t(label, doc) loop
    perform test.expect_try('metadata as ' || c.label, v_exec,
      format('insert into public.resources (node_kind, title, status, created_by, metadata) values (''folder'', ''x'', ''ready'', %L, %L::jsonb)', v_exec, c.doc),
      '23514|resources_metadata_object|%');
  end loop;
  perform test.expect_try('metadata replaced by an array', v_exec, format('update public.resources set metadata = ''[1]'' where id = %s', v_link), '23514|resources_metadata_object|%');
  perform test.expect_try('metadata as an empty object', v_exec, format('insert into public.resources (node_kind, title, status, created_by, metadata) values (''folder'', ''ok'', ''ready'', %L, ''{}'')', v_exec), null);
  perform test.expect_try('metadata as a nested object', v_exec, format('update public.resources set metadata = ''{"a": [1, {"b": null}]}'' where id = %s', v_link), null);

  -- =========================================================================
  -- C. A stored object belongs to one row: unique (storage_bucket, storage_path).
  -- =========================================================================
  perform test.expect_try('a second row for a stored object', v_exec,
    format('insert into public.resources (node_kind, media_kind, title, storage_bucket, storage_path, status, created_by) values (''file'', ''document'', ''copy'', ''club-resources'', ''r75/leaf.pdf'', ''ready'', %L)', v_exec),
    '23505|resources_storage_object_key_idx|%');
  perform test.expect_try('pointing a row at another row''s object', v_exec,
    format('update public.resources set storage_path = ''r75/leaf.pdf'' where id = %s', v_g1_file), '23505|resources_storage_object_key_idx|%');
  perform test.expect_try('the same path in the other bucket is another object', v_exec,
    format('insert into public.resources (node_kind, media_kind, title, storage_bucket, storage_path, status, created_by) values (''file'', ''document'', ''archive copy'', ''club-archive'', ''r75/leaf.pdf'', ''ready'', %L)', v_exec), null);
  -- Folders and links store nothing, so any number of them share the empty pair.
  perform test.expect_try('a second folder with the same title', v_exec, format(ins_folder, 'R75 level 1', null, null, 'members', v_exec), null);
  perform test.expect_try('a second link to the same address', v_exec, format(ins_link, 'R75 link', null, null, 'members', v_exec), null);

  -- =========================================================================
  -- D. An import's destination folder (private.validate_resource_import_destination).
  -- =========================================================================
  perform test.expect_try('an import with no destination', v_exec, format(imp, null, null, 'members', v_exec), null);
  perform test.expect_try('an import into a club-wide folder', v_exec, format(imp, v_f1, null, 'members', v_exec), null);
  perform test.expect_try('an import into a group folder', v_exec, format(imp, v_g1_folder, v_g1, 'members', v_exec), null);
  perform test.expect_try('an import into an executives-only folder', v_exec, format(imp, v_ex_folder, null, 'executives', v_exec), null);
  perform test.expect_try('a group manager imports into their group''s folder', v_mgr, format(imp, v_g1_folder, v_g1, 'members', v_mgr), null);
  perform test.expect_try('an import into a link', v_exec, format(imp, v_link, null, 'members', v_exec), 'P0001||resource import parent must be a folder');
  perform test.expect_try('an import into a file', v_exec, format(imp, v_leaf, null, 'members', v_exec), 'P0001||resource import parent must be a folder');
  perform test.expect_try('an import into a folder that does not exist', v_exec, format(imp, 2000000000, null, 'members', v_exec), 'P0001||resource import parent does not exist');
  perform test.expect_try('a club-wide import into a group folder', v_exec, format(imp, v_g1_folder, null, 'members', v_exec), 'P0001||resource import parent and import must have the same subgroup scope');
  perform test.expect_try('a group import into a club-wide folder', v_exec, format(imp, v_f1, v_g1, 'members', v_exec), 'P0001||resource import parent and import must have the same subgroup scope');
  perform test.expect_try('an import for another group', v_exec, format(imp, v_g1_folder, v_g2, 'members', v_exec), 'P0001||resource import parent and import must have the same subgroup scope');
  perform test.expect_try('an executives-only import into a members folder', v_exec, format(imp, v_f1, null, 'executives', v_exec), 'P0001||resource import parent and import must have the same visibility');
  perform test.expect_try('a members import into an executives-only folder', v_exec, format(imp, v_ex_folder, null, 'members', v_exec), 'P0001||resource import parent and import must have the same visibility');
  -- The same rules when an existing import is changed.
  insert into public.resource_imports (name, root_parent_id, visibility, created_by) values ('R75 import', v_f1, 'members', v_exec) returning id into v_imp;
  perform test.expect_try('repointing an import at a link', v_exec, format('update public.resource_imports set root_parent_id = %s where id = %L', v_link, v_imp), 'P0001||resource import parent must be a folder');
  perform test.expect_try('repointing an import at a group folder', v_exec, format('update public.resource_imports set root_parent_id = %s where id = %L', v_g1_folder, v_imp), 'P0001||resource import parent and import must have the same subgroup scope');
  perform test.expect_try('regrouping an import away from its folder', v_exec, format('update public.resource_imports set subgroup_id = %s where id = %L', v_g1, v_imp), 'P0001||resource import parent and import must have the same subgroup scope');
  perform test.expect_try('hiding an import from its folder''s audience', v_exec, format('update public.resource_imports set visibility = ''executives'' where id = %L', v_imp), 'P0001||resource import parent and import must have the same visibility');
  perform test.expect_try('repointing an import at another club-wide folder', v_exec, format('update public.resource_imports set root_parent_id = %s where id = %L', v_f2, v_imp), null);
  perform test.expect_try('progress on an import', v_exec, format('update public.resource_imports set status = ''uploading'', total_files = 2, completed_files = 1 where id = %L', v_imp), null);

  -- =========================================================================
  -- E. Supporting indexes. Partial ones are partial on "created_by is not null"
  --    (or the other nullable foreign key), so rows without it cost nothing.
  -- =========================================================================
  for c in select * from (values
    ('resource_imports_root_parent_idx',         'resource_imports USING btree (root_parent_id) WHERE (root_parent_id IS NOT NULL)'),
    ('resource_tags_created_by_idx',             'resource_tags USING btree (created_by) WHERE (created_by IS NOT NULL)'),
    ('resource_tag_assignments_created_by_idx',  'resource_tag_assignments USING btree (created_by) WHERE (created_by IS NOT NULL)'),
    ('resource_tag_assignments_tag_idx',         'resource_tag_assignments USING btree (tag_id, resource_id)'),
    ('resource_imports_creator_status_idx',      'resource_imports USING btree (created_by, status)'),
    ('resource_imports_subgroup_created_idx',    'resource_imports USING btree (subgroup_id, created_at DESC)'),
    ('resources_storage_object_key_idx',         'UNIQUE resources USING btree (storage_bucket, storage_path)'),
    ('resources_scope_status_updated_idx',       'resources USING btree (subgroup_id, status, updated_at DESC)'),
    ('resources_subgroup_visibility_status_idx', 'resources USING btree (subgroup_id, visibility, status)'),
    ('resources_parent_kind_title_idx',          'resources USING btree (parent_id, node_kind, lower(title))'),
    ('resources_parent_order_idx',               'resources USING btree (parent_id, is_pinned DESC, updated_at DESC, id DESC)'),
    ('resources_media_updated_idx',              'resources USING btree (media_kind, updated_at DESC) WHERE (node_kind = ''file''::resource_node_kind)'),
    ('resources_event_idx',                      'resources USING btree (event_id) WHERE (event_id IS NOT NULL)'),
    ('resources_creator_idx',                    'resources USING btree (created_by) WHERE (created_by IS NOT NULL)'),
    ('resources_import_idx',                     'resources USING btree (import_id) WHERE (import_id IS NOT NULL)')
  ) as t(idx, def) loop
    got := (select regexp_replace(indexdef, '^CREATE (UNIQUE )?INDEX \S+ ON public\.', '\1') from pg_indexes where schemaname = 'public' and indexname = c.idx);
    assert got = c.def, format('index %s: expected [%s], found [%s]', c.idx, c.def, coalesce(got, 'none'));
  end loop;
  -- This is what the advisor cleanup was for: no foreign key column of these tables
  -- is left without an index that starts with it.
  got := (select string_agg(con.conrelid::regclass || '.' || att.attname, ', ')
          from pg_constraint con
          join pg_attribute att on att.attrelid = con.conrelid and att.attnum = con.conkey[1]
          where con.contype = 'f'
            and con.conrelid in ('public.resources'::regclass, 'public.resource_imports'::regclass, 'public.resource_tags'::regclass, 'public.resource_tag_assignments'::regclass)
            and not exists (select 1 from pg_index i where i.indrelid = con.conrelid and i.indkey[0] = con.conkey[1]));
  assert got is null, 'foreign keys without an index: ' || got;

  -- =========================================================================
  -- F. Buckets, enums and what deleting a referenced row does.
  -- =========================================================================
  assert exists (select 1 from storage.buckets where id = 'club-resources' and name = 'club-resources'), 'the resources bucket exists';
  assert (select public from storage.buckets where id = 'club-resources') = false, 'the resources bucket is private';
  assert (select public from storage.buckets where id = 'club-archive') = false, 'the archive bucket is private';
  assert enum_range(null::public.resource_node_kind)::text = '{folder,file,link}', 'node kinds';
  assert enum_range(null::public.resource_media_kind)::text = '{document,image,other}', 'media kinds';
  assert enum_range(null::public.resource_status)::text = '{pending_upload,ready,failed,archived}', 'statuses';

  -- An event, an import, and the folder an import was aimed at can go; the rows that
  -- point at them stay and forget them.
  declare
    v_event bigint;
    v_import uuid;
    v_root bigint;
    v_file bigint;
    v_other_import uuid;
  begin
    insert into public.events (title, starts_at, created_by) values ('R75 concert', now(), v_exec) returning id into v_event;
    insert into public.resource_imports (name, visibility, created_by) values ('R75 batch', 'members', v_exec) returning id into v_import;
    insert into public.resources (node_kind, title, visibility, status, created_by) values ('folder', 'R75 import root', 'members', 'ready', v_exec) returning id into v_root;
    insert into public.resource_imports (name, root_parent_id, visibility, created_by) values ('R75 batch two', v_root, 'members', v_exec) returning id into v_other_import;
    insert into public.resources (node_kind, media_kind, title, visibility, status, storage_bucket, storage_path, event_id, import_id, created_by)
      values ('file', 'document', 'R75 event file', 'members', 'ready', 'club-resources', 'r75/event.pdf', v_event, v_import, v_exec) returning id into v_file;
    delete from public.events where id = v_event;
    assert (select event_id from public.resources where id = v_file) is null, 'deleting an event keeps its resources';
    delete from public.resource_imports where id = v_import;
    assert (select import_id from public.resources where id = v_file) is null and exists (select 1 from public.resources where id = v_file), 'deleting an import keeps its resources';
    delete from public.resources where id = v_root;
    assert exists (select 1 from public.resource_imports where id = v_other_import and root_parent_id is null), 'deleting an import''s folder keeps the import and forgets the folder';
  end;

  -- =========================================================================
  -- G. Tags and tag assignments.
  --    Since 20261127075000 the portal's signed-in role holds SELECT only on both
  --    tables (nothing in the portal writes them), so today nobody, executives
  --    included, can write them through the API: the first block pins that. The
  --    policies behind it are the second line and are kept up to date, so the
  --    second block grants the privileges back for this transaction only and shows
  --    what the policies then allow: tags to executives alone, assignments to
  --    whoever manages the resource. The grant is rolled back with the rest.
  -- =========================================================================
  declare
    v_tag bigint;
    v_tag2 bigint;
    v_tag3 bigint;
    v_resource bigint;
    v_club_resource bigint;
    v_other_resource bigint;
    v_exec_resource bigint;
    v_archived_resource bigint;
    v_rows jsonb;
    v_by_policy bigint[];
    v_by_function bigint[];
    n bigint;
  begin
    insert into public.resource_tags (name, created_by) values ('R75 raga', v_exec) returning id into v_tag;
    insert into public.resource_tags (name, created_by) values ('R75 spare', v_exec) returning id into v_tag3;
    insert into public.resources (node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by)
      values ('file', 'document', 'R75 group notes', v_g1, 'members', 'ready', 'club-resources', 'r75/notes.pdf', v_mgr) returning id into v_resource;
    insert into public.resources (node_kind, title, visibility, status, external_url, created_by) values ('link', 'R75 club link', 'members', 'ready', 'https://example.org/club', v_exec) returning id into v_club_resource;
    insert into public.resources (node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by)
      values ('file', 'document', 'R75 other group notes', v_g2, 'members', 'ready', 'club-resources', 'r75/other.pdf', v_other_mgr) returning id into v_other_resource;
    insert into public.resources (node_kind, title, visibility, status, external_url, created_by) values ('link', 'R75 exec link', 'executives', 'ready', 'https://example.org/exec', v_exec) returning id into v_exec_resource;
    insert into public.resources (node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by)
      values ('file', 'document', 'R75 archived notes', v_g1, 'members', 'archived', 'club-resources', 'r75/archived.pdf', v_mgr) returning id into v_archived_resource;
    insert into public.resource_tag_assignments (resource_id, tag_id, created_by) values (v_resource, v_tag, v_exec), (v_club_resource, v_tag, v_exec), (v_other_resource, v_tag, v_exec), (v_exec_resource, v_tag, v_exec), (v_archived_resource, v_tag, v_exec);

    -- Reading: every tag is visible to every signed-in member; an assignment is visible
    -- when its resource is.
    assert test.count_as(v_member, 'select count(*) from public.resource_tags') = (select count(*) from public.resource_tags), 'a member reads every tag';
    assert test.count_as(v_outsider, 'select count(*) from public.resource_tags') = (select count(*) from public.resource_tags), 'so does a member of no group';
    assert test.count_as(v_member, format('select count(*) from public.resource_tag_assignments where tag_id = %s', v_tag)) = 2, 'a group member sees the assignments on club-wide and own-group resources only';
    assert test.count_as(v_outsider, format('select count(*) from public.resource_tag_assignments where tag_id = %s', v_tag)) = 1, 'a member of no group sees the club-wide one';
    assert test.count_as(v_mgr, format('select count(*) from public.resource_tag_assignments where tag_id = %s', v_tag)) = 3, 'a group manager also sees the archived resource of their group';
    assert test.count_as(v_exec, format('select count(*) from public.resource_tag_assignments where tag_id = %s', v_tag)) = 5, 'an executive sees all five';

    -- Writing, as things stand: no privilege for anyone.
    for c in select * from (values (v_exec, 'an executive'), (v_mgr, 'a group manager'), (v_member, 'a member')) as t(who, label) loop
      perform test.expect_try(c.label || ' adds a tag', c.who, format('insert into public.resource_tags (name, created_by) values (''R75 new'', %L)', c.who), '42501||permission denied for table resource_tags');
      perform test.expect_try(c.label || ' renames a tag', c.who, format('update public.resource_tags set name = ''R75 renamed'' where id = %s', v_tag), '42501||permission denied for table resource_tags');
      perform test.expect_try(c.label || ' deletes a tag', c.who, format('delete from public.resource_tags where id = %s', v_tag), '42501||permission denied for table resource_tags');
      perform test.expect_try(c.label || ' tags a resource', c.who, format('insert into public.resource_tag_assignments (resource_id, tag_id, created_by) values (%s, %s, %L)', v_resource, v_tag, c.who), '42501||permission denied for table resource_tag_assignments');
      perform test.expect_try(c.label || ' changes an assignment', c.who, format('update public.resource_tag_assignments set created_by = %L where resource_id = %s', c.who, v_resource), '42501||permission denied for table resource_tag_assignments');
      perform test.expect_try(c.label || ' removes an assignment', c.who, format('delete from public.resource_tag_assignments where resource_id = %s', v_resource), '42501||permission denied for table resource_tag_assignments');
    end loop;

    -- The policies, with the privileges given back (rolled back at the end).
    grant insert, update, delete on public.resource_tags, public.resource_tag_assignments to authenticated;

    -- Tags: executives only.
    perform test.expect_try('an executive adds a tag', v_exec, format('insert into public.resource_tags (name, created_by) values (''R75 second'', %L)', v_exec), null);
    v_tag2 := (select id from public.resource_tags where name = 'R75 second');
    perform test.expect_try('a group manager cannot add a tag', v_mgr, format('insert into public.resource_tags (name, created_by) values (''R75 by manager'', %L)', v_mgr), '42501||new row violates row-level security policy for table "resource_tags"');
    perform test.expect_try('a member cannot add a tag', v_member, format('insert into public.resource_tags (name, created_by) values (''R75 by member'', %L)', v_member), '42501||new row violates row-level security policy for table "resource_tags"');
    assert test.count_as(v_mgr, format('with u as (update public.resource_tags set name = ''R75 hijacked'' where id = %s returning 1) select count(*) from u', v_tag2)) = 0, 'a group manager renames no tag';
    assert test.count_as(v_member, format('with u as (update public.resource_tags set name = ''R75 hijacked'' where id = %s returning 1) select count(*) from u', v_tag2)) = 0, 'a member renames no tag';
    assert test.count_as(v_mgr, format('with d as (delete from public.resource_tags where id = %s returning 1) select count(*) from d', v_tag2)) = 0, 'a group manager deletes no tag';
    assert test.count_as(v_member, format('with d as (delete from public.resource_tags where id = %s returning 1) select count(*) from d', v_tag2)) = 0, 'a member deletes no tag';
    assert (select name from public.resource_tags where id = v_tag2) = 'R75 second', 'the tag is untouched';
    assert test.count_as(v_exec, format('with u as (update public.resource_tags set name = ''R75 second renamed'' where id = %s returning 1) select count(*) from u', v_tag2)) = 1, 'an executive renames a tag';

    -- Assignments: whoever manages the resource.
    perform test.expect_try('an executive tags a club-wide resource', v_exec, format('insert into public.resource_tag_assignments (resource_id, tag_id, created_by) values (%s, %s, %L)', v_club_resource, v_tag2, v_exec), null);
    perform test.expect_try('an executive tags an executives-only resource', v_exec, format('insert into public.resource_tag_assignments (resource_id, tag_id, created_by) values (%s, %s, %L)', v_exec_resource, v_tag2, v_exec), null);
    perform test.expect_try('a group manager tags a resource of their group', v_mgr, format('insert into public.resource_tag_assignments (resource_id, tag_id, created_by) values (%s, %s, %L)', v_resource, v_tag2, v_mgr), null);
    perform test.expect_try('a group manager cannot tag a club-wide resource', v_mgr, format('insert into public.resource_tag_assignments (resource_id, tag_id, created_by) values (%s, %s, %L)', v_club_resource, v_tag3, v_mgr), '42501||new row violates row-level security policy for table "resource_tag_assignments"');
    perform test.expect_try('a group manager cannot tag another group''s resource', v_mgr, format('insert into public.resource_tag_assignments (resource_id, tag_id, created_by) values (%s, %s, %L)', v_other_resource, v_tag3, v_mgr), '42501||new row violates row-level security policy for table "resource_tag_assignments"');
    perform test.expect_try('a group manager cannot tag an executives-only resource', v_mgr, format('insert into public.resource_tag_assignments (resource_id, tag_id, created_by) values (%s, %s, %L)', v_exec_resource, v_tag3, v_mgr), '42501||new row violates row-level security policy for table "resource_tag_assignments"');
    perform test.expect_try('a member cannot tag a resource of their group', v_member, format('insert into public.resource_tag_assignments (resource_id, tag_id, created_by) values (%s, %s, %L)', v_archived_resource, v_tag3, v_member), '42501||new row violates row-level security policy for table "resource_tag_assignments"');
    -- Changing and removing an assignment follows the same rule.
    assert test.count_as(v_mgr, format('with u as (update public.resource_tag_assignments set created_by = %L where resource_id = %s and tag_id = %s returning 1) select count(*) from u', v_mgr, v_resource, v_tag)) = 1, 'a group manager edits an assignment on their group''s resource';
    assert test.count_as(v_mgr, format('with u as (update public.resource_tag_assignments set created_by = %L where resource_id = %s and tag_id = %s returning 1) select count(*) from u', v_mgr, v_other_resource, v_tag)) = 0, 'but not on another group''s';
    assert test.count_as(v_other_mgr, format('with u as (update public.resource_tag_assignments set created_by = %L where resource_id = %s and tag_id = %s returning 1) select count(*) from u', v_other_mgr, v_resource, v_tag)) = 0, 'the other group''s manager cannot edit it';
    assert test.count_as(v_member, format('with u as (update public.resource_tag_assignments set created_by = %L where resource_id = %s and tag_id = %s returning 1) select count(*) from u', v_member, v_resource, v_tag)) = 0, 'a member cannot edit it';
    assert test.count_as(v_member, format('with d as (delete from public.resource_tag_assignments where resource_id = %s and tag_id = %s returning 1) select count(*) from d', v_resource, v_tag)) = 0, 'a member cannot remove it';
    assert test.count_as(v_other_mgr, format('with d as (delete from public.resource_tag_assignments where resource_id = %s and tag_id = %s returning 1) select count(*) from d', v_resource, v_tag)) = 0, 'nor the other group''s manager';
    assert test.count_as(v_mgr, format('with d as (delete from public.resource_tag_assignments where resource_id = %s and tag_id = %s returning 1) select count(*) from d', v_club_resource, v_tag)) = 0, 'a group manager cannot remove a club-wide assignment';
    assert test.count_as(v_mgr, format('with d as (delete from public.resource_tag_assignments where resource_id = %s and tag_id = %s returning 1) select count(*) from d', v_resource, v_tag)) = 1, 'a group manager removes their group''s assignment';
    assert test.count_as(v_exec, format('with d as (delete from public.resource_tag_assignments where resource_id = %s and tag_id = %s returning 1) select count(*) from d', v_club_resource, v_tag)) = 1, 'an executive removes a club-wide assignment';
    assert test.count_as(v_exec, format('with d as (delete from public.resource_tag_assignments where resource_id = %s and tag_id = %s returning 1) select count(*) from d', v_exec_resource, v_tag)) = 1, 'and an executives-only one';

    -- Deleting a tag, or a resource, takes its assignments with it.
    select count(*) into n from public.resource_tag_assignments where tag_id = v_tag2;
    assert n = 3, 'three assignments of the second tag so far: ' || n;
    delete from public.resource_tags where id = v_tag2;
    assert (select count(*) from public.resource_tag_assignments where tag_id = v_tag2) = 0, 'deleting a tag removes its assignments';
    delete from public.resource_tag_assignments where resource_id = v_other_resource;
    insert into public.resource_tag_assignments (resource_id, tag_id, created_by) values (v_other_resource, v_tag, v_exec);
    delete from public.resources where id = v_other_resource;
    assert not exists (select 1 from public.resource_tag_assignments where resource_id = v_other_resource), 'deleting a resource removes its assignments';
    revoke insert, update, delete on public.resource_tags, public.resource_tag_assignments from authenticated;

    -- The write policies are one per command, so a SELECT sees one permissive policy
    -- only (a FOR ALL policy next to the read policy was the advisor's complaint).
    assert (select count(*) from pg_policies where schemaname = 'public' and tablename = 'resource_tags' and permissive = 'PERMISSIVE' and cmd in ('SELECT', 'ALL')) = 1, 'one permissive policy applies to reading tags';
    assert (select string_agg(cmd, ',' order by cmd) from pg_policies where schemaname = 'public' and tablename = 'resource_tags' and permissive = 'PERMISSIVE') = 'DELETE,INSERT,SELECT,UPDATE', 'tags have a policy for each command and none for all';

    -- =======================================================================
    -- H. private.can_view_resource (used by the tag assignment and Storage
    --    policies) gives the answer the SELECT policy on resources gives, row by
    --    row, for every kind of reader.
    -- =======================================================================
    insert into public.resources (node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by)
      values ('file', 'document', 'R75 member pending', v_g1, 'members', 'pending_upload', 'club-resources', 'r75/pending-member.pdf', v_member),
             ('file', 'document', 'R75 manager failed', v_g1, 'members', 'failed', 'club-resources', 'r75/failed-mgr.pdf', v_mgr),
             ('file', 'document', 'R75 club pending', null, 'members', 'pending_upload', 'club-resources', 'r75/pending-club.pdf', v_other_mgr),
             ('file', 'document', 'R75 executives archived', null, 'executives', 'archived', 'club-resources', 'r75/archived-exec.pdf', v_exec);
    v_rows := (select jsonb_agg(to_jsonb(r)) from (select id, subgroup_id, visibility, status, created_by from public.resources where title like 'R75%' or title like 'in %') r);
    for c in select * from (values (v_exec, 'executive'), (v_mgr, 'group manager'), (v_member, 'member'), (v_other_mgr, 'other group''s manager'), (v_outsider, 'member of no group')) as t(who, label) loop
      perform test.login(c.who);
      -- ids the policy lets through
      v_by_policy := (select coalesce(array_agg(id order by id), '{}') from public.resources where title like 'R75%' or title like 'in %');
      -- ids the function lets through (the rows themselves come from the snapshot taken above)
      v_by_function := (select coalesce(array_agg((e ->> 'id')::bigint order by (e ->> 'id')::bigint), '{}')
                        from jsonb_array_elements(v_rows) e
                        where private.can_view_resource(nullif(e ->> 'subgroup_id', '')::bigint, (e ->> 'visibility')::public.archive_visibility,
                                                        (e ->> 'status')::public.resource_status, nullif(e ->> 'created_by', '')::uuid));
      perform test.logout();
      assert v_by_policy = v_by_function, format('can_view_resource and the SELECT policy disagree for the %s: only the policy shows %s, only the function shows %s', c.label,
        (select array_agg(i) from unnest(v_by_policy) i where i <> all (v_by_function)), (select array_agg(i) from unnest(v_by_function) i where i <> all (v_by_policy)));
      assert coalesce(array_length(v_by_policy, 1), 0) > 0, 'the comparison is not empty for the ' || c.label;
    end loop;
    -- and the answers are not all the same
    assert (select count(distinct seen) from (
              select test.count_as(u, 'select count(*) from public.resources where title like ''R75%'' or title like ''in %''') as seen
              from unnest(array[v_exec, v_mgr, v_member, v_other_mgr, v_outsider]) u) x) >= 4, 'the five readers see different sets';
  end;
end $$;
rollback;
