-- Second security review, F3 (migration 20261128032200): a row cannot vouch for somebody else's file.
--
--   A. A group manager (and leader, and a demoted executive) cannot register a `resources` row in the bucket club-archive
--      (insert, or change of an existing unfinished row); an executive can; a legacy copy written without a signed-in person
--      is untouched and keeps reading for the group it was copied to; the executives-only file stays unreadable for the
--      people the review named, and readable for executives.
--   B. The query in docs/RELEASE_ORDER.md that lists club-archive library rows made by somebody who is not an executive finds
--      a row that was planted before the migration (the trigger cannot clean existing rows), and not a legacy copy.
--   C. The same class in the bucket club-resources: a row must name a path in its creator's own folder, so a manager cannot
--      register somebody else's abandoned object and then read, overwrite or delete it.
--   D. The same class for finance_documents, in the window before 20261128029000 revokes direct inserts (the test restores that
--      window by granting the insert and the old policy inside the transaction).
--   E. The table of policies where a row vouches for an object: asserted from the catalog so a new one has to be looked at.
-- Failures are collected and raised together.
begin;

create table test.m78c_fail (what text not null);
create function test.m78c_expect(p_what text, p_got text, p_like text) returns void language plpgsql as $$
begin
  if p_like is null then
    if p_got is not null then insert into test.m78c_fail values (format('%s: expected success, got [%s]', p_what, p_got)); end if;
  elsif p_like = '*' then
    if p_got is null then insert into test.m78c_fail values (format('%s: expected a refusal, got no error', p_what)); end if;
  elsif p_got is null or p_got not like p_like then
    insert into test.m78c_fail values (format('%s: expected [%s], got [%s]', p_what, p_like, coalesce(p_got, 'no error')));
  end if;
end $$;
create function test.m78c_eq(p_what text, p_got bigint, p_want bigint) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then insert into test.m78c_fail values (format('%s: expected %s, got %s', p_what, p_want, coalesce(p_got::text, 'null'))); end if;
end $$;
create function test.m78c_rows_as(p_user uuid, p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform test.login(p_user);
  begin
    execute p_sql;
    get diagnostics n = row_count;
  exception when others then n := -1;
  end;
  perform test.logout();
  return n;
end $$;

do $$
declare
  v_exec uuid := test.make_user('Row Exec', 'executive');
  v_old_exec uuid := test.make_user('Row Old Exec', 'executive');
  v_gm_a uuid := test.make_user('Row Member A');
  v_gm_a2 uuid := test.make_user('Row Member A2');
  v_mgr_a uuid := test.make_user('Row Manager A');
  v_ldr_a uuid := test.make_user('Row Leader A');
  v_gm_b uuid := test.make_user('Row Member B');
  v_mgr_b uuid := test.make_user('Row Manager B');
  v_dead uuid := test.make_user('Row Dead', p_status => 'deactivated');
  v_pending uuid := test.make_user('Row Pending', p_status => 'pending');
  v_a bigint; v_b bigint;
  v_exec_file text; v_exec_file2 text; v_legacy_file text; v_planted_file text;
  v_orphan text; v_orphan_row bigint; v_pend_row bigint;
  v_who uuid; v_role text; v_status text;
  v_msg text; v_n bigint;
  v_found text;
begin
  perform test.login(v_exec);
  select id into v_a from public.create_subgroup('Row Group A', 'a', 'open');
  select id into v_b from public.create_subgroup('Row Group B', 'b', 'open');
  perform public.add_subgroup_member(v_a, v_gm_a);
  perform public.add_subgroup_member(v_a, v_gm_a2);
  perform public.add_subgroup_member(v_a, v_mgr_a);
  perform public.set_subgroup_member_role(v_a, v_mgr_a, 'manager');
  perform public.add_subgroup_member(v_a, v_ldr_a);
  perform public.set_subgroup_member_role(v_a, v_ldr_a, 'leader');
  perform public.add_subgroup_member(v_a, v_old_exec);
  perform public.set_subgroup_member_role(v_a, v_old_exec, 'manager');
  perform public.add_subgroup_member(v_b, v_gm_b);
  perform public.add_subgroup_member(v_b, v_mgr_b);
  perform public.set_subgroup_member_role(v_b, v_mgr_b, 'manager');
  perform test.logout();
  update public.profiles set role = 'member' where id = v_old_exec;   -- demoted: still a manager of group A

  -- An executives-only archive file (registered by an executive), and its object.
  v_exec_file := v_exec || '/exec-only.mp3';
  v_exec_file2 := v_exec || '/exec-only-two.mp3';
  insert into public.archive_items (title, type, storage_path, visibility, uploaded_by, subgroup_id)
  values ('Row exec-only file', 'recording', v_exec_file, 'executives', v_exec, null),
         ('Row exec-only file two', 'recording', v_exec_file2, 'executives', v_exec, null);
  insert into storage.objects (bucket_id, name) values ('club-archive', v_exec_file), ('club-archive', v_exec_file2);

  -- -----------------------------------------------------------------------------------------------------
  -- A. club-archive rows of the library.
  -- -----------------------------------------------------------------------------------------------------
  for v_role, v_who in
    select * from (values ('manager of A', v_mgr_a), ('leader of A', v_ldr_a), ('demoted executive, still manager of A', v_old_exec)) as r(role, id)
  loop
    foreach v_status in array array['ready', 'pending_upload'] loop
      perform test.m78c_expect(format('%s registers the executives-only file, status %s', v_role, v_status),
        test.error_as(v_who, format($q$insert into public.resources(node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by) values ('file', 'other', 'peek', %s, 'members', %L, 'club-archive', %L, auth.uid())$q$, v_a, v_status, v_exec_file)),
        case when v_role like 'leader%' then '*' else 'Only an executive can register a file from the club archive' end);
    end loop;
  end loop;
  -- (a leader is not a manager of the group for the library: refused by the table policy before any trigger)
  perform test.m78c_expect('manager of B registers it for group B',
    test.error_as(v_mgr_b, format($q$insert into public.resources(node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by) values ('file', 'other', 'peek', %s, 'members', 'ready', 'club-archive', %L, auth.uid())$q$, v_b, v_exec_file)),
    'Only an executive can register a file from the club archive');
  perform test.m78c_expect('manager of A registers it with the second path, group-wide visibility',
    test.error_as(v_mgr_a, format($q$insert into public.resources(node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by) values ('file', 'other', 'peek', %s, 'members', 'ready', 'club-archive', %L, auth.uid())$q$, v_a, v_exec_file2)),
    'Only an executive can register a file from the club archive');
  perform test.m78c_expect('a plain member, a deactivated and a pending account are refused too',
    concat_ws(' / ',
      test.error_as(v_gm_a, format($q$insert into public.resources(node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by) values ('file', 'other', 'peek', %s, 'members', 'ready', 'club-archive', %L, auth.uid())$q$, v_a, v_exec_file)),
      test.error_as(v_dead, format($q$insert into public.resources(node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by) values ('file', 'other', 'peek', %s, 'members', 'ready', 'club-archive', %L, auth.uid())$q$, v_a, v_exec_file)),
      test.error_as(v_pending, format($q$insert into public.resources(node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by) values ('file', 'other', 'peek', %s, 'members', 'ready', 'club-archive', %L, auth.uid())$q$, v_a, v_exec_file))),
    '%/%/%');
  -- an existing unfinished row of the manager cannot be re-pointed at the archive file
  insert into public.resources(node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by)
  values ('file', 'other', 'Row pending upload', v_a, 'members', 'pending_upload', 'club-resources', v_mgr_a || '/imp/p.pdf', v_mgr_a) returning id into v_pend_row;
  perform test.m78c_expect('manager re-points an unfinished row at the archive file',
    test.error_as(v_mgr_a, format($q$update public.resources set storage_bucket = 'club-archive', storage_path = %L where id = %s$q$, v_exec_file, v_pend_row)), '*');
  perform test.m78c_expect('manager forges the creator of a row to pass the folder rule',
    test.error_as(v_mgr_a, format($q$insert into public.resources(node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by) values ('file', 'other', 'peek', %s, 'members', 'ready', 'club-archive', %L, %L)$q$, v_a, v_exec_file, v_exec)), '*');

  -- Nobody who should not read the executives-only file can.
  perform test.m78c_eq('manager of A reads the executives-only file', test.count_as(v_mgr_a, format('select count(*) from storage.objects where bucket_id = ''club-archive'' and name = %L', v_exec_file)), 0);
  perform test.m78c_eq('a member of A reads it', test.count_as(v_gm_a2, format('select count(*) from storage.objects where bucket_id = ''club-archive'' and name = %L', v_exec_file)), 0);
  perform test.m78c_eq('a member of B reads it', test.count_as(v_gm_b, format('select count(*) from storage.objects where bucket_id = ''club-archive'' and name = %L', v_exec_file)), 0);
  perform test.m78c_eq('an executive reads it', test.count_as(v_exec, format('select count(*) from storage.objects where bucket_id = ''club-archive'' and name = %L', v_exec_file)), 1);

  -- An executive may register a club-archive row (an executive reads that bucket anyway).
  perform test.m78c_expect('executive registers a club-archive row for a group',
    test.error_as(v_exec, format($q$insert into public.resources(node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by) values ('file', 'other', 'Row exec registered', %s, 'members', 'ready', 'club-archive', %L, auth.uid())$q$, v_a, v_exec || '/shared-with-a.mp3')), null);

  -- The legacy copy: written with no signed-in person, a file in club-archive shown to group A through the library.
  v_legacy_file := v_exec || '/legacy-shared.mp3';
  insert into public.archive_items (title, type, storage_path, visibility, uploaded_by, subgroup_id) values ('Row legacy item', 'recording', v_legacy_file, 'executives', v_exec, null);
  insert into storage.objects (bucket_id, name) values ('club-archive', v_legacy_file);
  insert into public.resources(node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by)
  values ('file', 'other', 'Row legacy copy', v_a, 'members', 'ready', 'club-archive', v_legacy_file, v_exec);
  perform test.m78c_eq('legacy copy: a member of A reads the file (as before)', test.count_as(v_gm_a2, format('select count(*) from storage.objects where bucket_id = ''club-archive'' and name = %L', v_legacy_file)), 1);
  perform test.m78c_eq('legacy copy: the manager of A reads it', test.count_as(v_mgr_a, format('select count(*) from storage.objects where bucket_id = ''club-archive'' and name = %L', v_legacy_file)), 1);
  perform test.m78c_eq('legacy copy: a member of B does not', test.count_as(v_gm_b, format('select count(*) from storage.objects where bucket_id = ''club-archive'' and name = %L', v_legacy_file)), 0);
  perform test.m78c_expect('legacy copy: the manager of A still renames it and sets its visibility',
    test.error_as(v_mgr_a, $q$update public.resources set title = 'Row legacy copy renamed' where title = 'Row legacy copy'$q$), null);
  perform test.m78c_eq('legacy copy: that update changed the row', (select count(*) from public.resources where title = 'Row legacy copy renamed'), 1);
  perform test.m78c_expect('legacy copy: an update that lists the file columns without changing them',
    test.error_as(v_mgr_a, $q$update public.resources set storage_bucket = storage_bucket, storage_path = storage_path where title = 'Row legacy copy renamed'$q$), null);

  -- -----------------------------------------------------------------------------------------------------
  -- B. A row planted before the migration: the owner inserts it (the trigger does not look at it), the review query finds it.
  -- -----------------------------------------------------------------------------------------------------
  v_planted_file := v_exec || '/planted-by-a-manager.mp3';
  insert into public.archive_items (title, type, storage_path, visibility, uploaded_by, subgroup_id) values ('Row planted target', 'recording', v_planted_file, 'executives', v_exec, null);
  insert into storage.objects (bucket_id, name) values ('club-archive', v_planted_file);
  insert into public.resources(node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by)
  values ('file', 'other', 'Row planted row', v_a, 'members', 'ready', 'club-archive', v_planted_file, v_mgr_a);
  -- (the query of docs/RELEASE_ORDER.md "club-archive rows in the library")
  select string_agg(r.title, ', ' order by r.title) into v_found
  from public.resources r
  left join public.profiles p on p.id = r.created_by
  where r.storage_bucket = 'club-archive' and (p.id is null or p.role not in ('executive', 'admin') or p.status <> 'active');
  perform test.m78c_expect('the review query finds the planted row and the legacy copy of a demoted creator only',
    case when v_found = 'Row planted row' then null else coalesce(v_found, 'nothing') end, null);

  -- -----------------------------------------------------------------------------------------------------
  -- C. club-resources: a row names a path in its creator's own folder.
  -- -----------------------------------------------------------------------------------------------------
  v_orphan := v_gm_a || '/imp-lost/abandoned.pdf';   -- somebody else's abandoned object: nothing registers it
  insert into storage.objects (bucket_id, name) values ('club-resources', v_orphan);
  perform test.m78c_expect('manager of B registers a row at A''s abandoned object (pending upload)',
    test.error_as(v_mgr_b, format($q$insert into public.resources(node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by) values ('file', 'document', 'Row grab', %s, 'members', 'pending_upload', 'club-resources', %L, auth.uid())$q$, v_b, v_orphan)),
    'A file can only be registered from your own folder');
  perform test.m78c_expect('manager of B registers it as a finished row',
    test.error_as(v_mgr_b, format($q$insert into public.resources(node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by) values ('file', 'document', 'Row grab', %s, 'members', 'ready', 'club-resources', %L, auth.uid())$q$, v_b, v_orphan)),
    'A file can only be registered from your own folder');
  -- (an executive is not bound: they read, overwrite and delete every library file through the executive branches anyway)
  perform test.m78c_expect('an executive registers a row at a path of another folder (not checked, by design)',
    test.error_as(v_exec, format($q$insert into public.resources(node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by) values ('file', 'document', 'Row exec foreign path', %s, 'members', 'ready', 'club-resources', %L, auth.uid())$q$, v_b, 'someone-else/imp/exec.pdf')), null);
  perform test.m78c_eq('the manager of B cannot read the object', test.count_as(v_mgr_b, format('select count(*) from storage.objects where bucket_id = ''club-resources'' and name = %L', v_orphan)), 0);
  perform test.m78c_eq('the manager of B cannot overwrite it', test.m78c_rows_as(v_mgr_b, format('update storage.objects set name = name where bucket_id = ''club-resources'' and name = %L', v_orphan)), 0);
  perform test.m78c_eq('the manager of B cannot delete it', test.m78c_rows_as(v_mgr_b, format('delete from storage.objects where bucket_id = ''club-resources'' and name = %L', v_orphan)), 0);
  -- an update: the finished-rows guard (20261127070000) already stops a manager from moving the file of an existing row
  insert into public.resources(node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by)
  values ('file', 'document', 'Row manager B own', v_b, 'members', 'pending_upload', 'club-resources', v_mgr_b || '/imp-9/own.pdf', v_mgr_b);
  perform test.m78c_expect('a manager re-points their own unfinished row at A''s abandoned object',
    test.error_as(v_mgr_b, format($q$update public.resources set storage_path = %L where title = 'Row manager B own'$q$, v_orphan)), '*');
  perform test.m78c_expect('the honest flow: a manager registers a file in their own folder',
    test.error_as(v_mgr_b, format($q$insert into public.resources(node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by) values ('file', 'document', 'Row honest', %s, 'members', 'pending_upload', 'club-resources', %L, auth.uid())$q$, v_b, v_mgr_b || '/imp-1/Concert/a.pdf')), null);
  perform test.m78c_expect('the honest flow: an executive registers a file in their own folder',
    test.error_as(v_exec, format($q$insert into public.resources(node_kind, media_kind, title, subgroup_id, visibility, status, storage_bucket, storage_path, created_by) values ('file', 'document', 'Row honest exec 2', null, 'members', 'pending_upload', 'club-resources', %L, auth.uid())$q$, v_exec || '/imp-3/c.pdf')), null);
  perform test.m78c_expect('the honest flow: the same row goes ready (an update of status only)',
    test.error_as(v_mgr_b, $q$update public.resources set status = 'ready' where title = 'Row honest'$q$), null);
  perform test.m78c_expect('a link and a folder have no file and are not affected',
    nullif(concat_ws('',
      test.error_as(v_mgr_b, format($q$insert into public.resources(node_kind, title, subgroup_id, visibility, status, external_url, created_by) values ('link', 'Row link', %s, 'members', 'ready', 'https://example.org/x', auth.uid())$q$, v_b)),
      test.error_as(v_mgr_b, format($q$insert into public.resources(node_kind, title, subgroup_id, visibility, status, created_by) values ('folder', 'Row folder', %s, 'members', 'ready', auth.uid())$q$, v_b))), ''),
    null);
  -- a row that was planted before the file existed (the owner writes it) still reads for its creator only through the policies as before
  insert into storage.objects (bucket_id, name) values ('club-resources', v_mgr_b || '/imp-1/Concert/a.pdf');
  perform test.m78c_eq('the registered file reads for group B', test.count_as(v_gm_b, format('select count(*) from storage.objects where bucket_id = ''club-resources'' and name = %L', v_mgr_b || '/imp-1/Concert/a.pdf')), 1);

  -- -----------------------------------------------------------------------------------------------------
  -- D. finance_documents in the window before 20261128029000: restore the old insert policy and grant, inside this transaction.
  -- -----------------------------------------------------------------------------------------------------
  grant insert on public.finance_documents to authenticated;
  create policy "m78c old members register own finance documents" on public.finance_documents
    for insert to authenticated with check (uploaded_by = (select auth.uid()));
  insert into storage.objects (bucket_id, name, owner_id) values ('finance-private', v_gm_a || '/receipt-of-a.pdf', v_gm_a::text);
  perform test.m78c_expect('a member registers a finance document at another member''s receipt',
    test.error_as(v_gm_b, format($q$insert into public.finance_documents (document_type, title, storage_path, mime_type, file_size_bytes, uploaded_by) values ('receipt', 'grab', %L, 'application/pdf', 10, auth.uid())$q$, v_gm_a || '/receipt-of-a.pdf')),
    'The file must be stored in your own folder');
  perform test.m78c_eq('the member cannot read the receipt', test.count_as(v_gm_b, format('select count(*) from storage.objects where bucket_id = ''finance-private'' and name = %L', v_gm_a || '/receipt-of-a.pdf')), 0);
  perform test.m78c_expect('an executive registers a finance document at any path (not checked, by design: they read every finance file)',
    test.error_as(v_exec, format($q$insert into public.finance_documents (document_type, title, storage_path, mime_type, file_size_bytes, uploaded_by) values ('receipt', 'exec doc', %L, 'application/pdf', 10, auth.uid())$q$, 'someone-else/exec.pdf')), null);
  perform test.m78c_expect('a member registers a finance document in their own folder (what the old screens do)',
    test.error_as(v_gm_b, format($q$insert into public.finance_documents (document_type, title, storage_path, mime_type, file_size_bytes, uploaded_by) values ('receipt', 'mine', %L, 'application/pdf', 10, auth.uid())$q$, v_gm_b || '/mine.pdf')), null);


  -- -----------------------------------------------------------------------------------------------------
  -- E. Catalog: the storage policies where a row vouches for an object, and the guard each one has. A new policy that
  --    reads another table by `storage_path = objects.name` fails here until it is added with its reason.
  -- -----------------------------------------------------------------------------------------------------
  select string_agg(polname, ', ' order by polname) into v_msg
  from pg_policy
  where polrelid = 'storage.objects'::regclass
    and pg_get_expr(polqual, polrelid) ~ 'storage_path = objects\.name'
    and polname not in (
      'Members read accessible recordings', 'Members update their recording files', 'Members delete their recording files',   -- recordings: own folder + bucket bound (32100)
      'Members read accessible recording notation', 'Members delete their recording notation',                                 -- recording_notes: own folder bound (30000), one bucket
      'Members read permitted archive files', 'Visitors stream public concert files',                                          -- archive_items: executives write; resources: guard_resource_file_rows (32200)
      'Members read resource files', 'Update resource files: executives, or unfinished uploads', 'Delete resource files: executives, or unfinished uploads',  -- resources: guard_resource_file_rows (32200)
      'Members read permitted finance files');                                                                                 -- finance_documents: register_finance_document, guard_finance_document_path (32200)
  perform test.m78c_expect('every policy where a row vouches for an object is known', case when v_msg is null then null else 'new or unknown: ' || v_msg end, null);

  select string_agg(what, E'\n  ') into v_msg from test.m78c_fail;
  if v_msg is not null then raise exception E'ROW-VOUCHES-FOR-OBJECT: % failure(s):\n  %', (select count(*) from test.m78c_fail), v_msg; end if;
end $$;

rollback;
