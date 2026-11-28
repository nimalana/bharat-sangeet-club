-- Second security review, F2 (migration 20261128032100): a recording row cannot skip the own-folder rule by naming
-- another bucket, and a row only vouches for an object in the bucket it names.
--
--   A. The trigger: every signed-in role (member of the same group, member of another group, manager, executive,
--      demoted executive, former member, deactivated, pending) is refused when it registers a path of somebody else, in
--      either bucket, on insert and on update; a forged uploader is refused by the actor guard; the own folder in the
--      bucket `recordings` still works; a legacy copy written without a signed-in person still goes in and can still be
--      edited (title, publishing) by an executive.
--   B. The storage policies, with rows that already exist (the attack's row inserted by the owner, the way an old row
--      would be): it vouches for nothing in the bucket `recordings`; bucket A row / bucket B object of the same name.
--   C. What did not change: the registered recording is read by its group and by nobody else; the uploader updates and
--      deletes their own file; a legacy copy's file is served by the club-archive policies exactly as before.
-- Failures are collected and raised together.
begin;

create table test.m78b_fail (what text not null);
create function test.m78b_expect(p_what text, p_got text, p_like text) returns void language plpgsql as $$
begin
  if p_like is null then
    if p_got is not null then insert into test.m78b_fail values (format('%s: expected success, got [%s]', p_what, p_got)); end if;
  elsif p_like = '*' then
    if p_got is null then insert into test.m78b_fail values (format('%s: expected a refusal, got no error', p_what)); end if;
  elsif p_got is null or p_got not like p_like then
    insert into test.m78b_fail values (format('%s: expected [%s], got [%s]', p_what, p_like, coalesce(p_got, 'no error')));
  end if;
end $$;
create function test.m78b_eq(p_what text, p_got bigint, p_want bigint) returns void language plpgsql as $$
begin
  if p_got is distinct from p_want then insert into test.m78b_fail values (format('%s: expected %s, got %s', p_what, p_want, coalesce(p_got::text, 'null'))); end if;
end $$;
-- how many rows a statement changed as a person (-1: refused)
create function test.m78b_rows_as(p_user uuid, p_sql text) returns bigint language plpgsql as $$
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
  v_exec uuid := test.make_user('Bind Exec', 'executive');
  v_old_exec uuid := test.make_user('Bind Old Exec', 'executive');
  v_gm_a uuid := test.make_user('Bind Member A');
  v_gm_a2 uuid := test.make_user('Bind Member A2');
  v_mgr_a uuid := test.make_user('Bind Manager A');
  v_gm_b uuid := test.make_user('Bind Member B');
  v_mgr_b uuid := test.make_user('Bind Manager B');
  v_former uuid := test.make_user('Bind Former A');
  v_dead uuid := test.make_user('Bind Dead', p_status => 'deactivated');
  v_pending uuid := test.make_user('Bind Pending', p_status => 'pending');
  v_a bigint; v_b bigint;
  v_victim text; v_victim_row bigint;
  v_orphan text;
  v_legacy_path text; v_legacy bigint;
  v_own text;
  v_who uuid; v_role text; v_bucket text;
  v_n bigint;
  v_msg text;
begin
  perform test.login(v_exec);
  select id into v_a from public.create_subgroup('Bind Group A', 'a', 'open');
  select id into v_b from public.create_subgroup('Bind Group B', 'b', 'open');
  perform public.add_subgroup_member(v_a, v_gm_a);
  perform public.add_subgroup_member(v_a, v_gm_a2);
  perform public.add_subgroup_member(v_a, v_mgr_a);
  perform public.set_subgroup_member_role(v_a, v_mgr_a, 'manager');
  perform public.add_subgroup_member(v_a, v_former);
  perform public.add_subgroup_member(v_b, v_gm_b);
  perform public.add_subgroup_member(v_b, v_mgr_b);
  perform public.set_subgroup_member_role(v_b, v_mgr_b, 'manager');
  perform public.add_subgroup_member(v_a, v_old_exec);
  perform public.add_subgroup_member(v_b, v_old_exec);
  perform public.remove_subgroup_member(v_a, v_former);
  perform test.logout();
  update public.profiles set role = 'member' where id = v_old_exec;   -- demoted: a plain member of A and B now

  -- The victim: a member of A who uploaded a take and has registered it, plus an abandoned upload of theirs.
  v_victim := v_gm_a || '/subgroups/' || v_a || '/take.webm';
  v_orphan := v_gm_a || '/subgroups/' || v_a || '/orphan.webm';
  insert into public.recordings (title, subgroup_id, uploaded_by, storage_path, status, audience)
  values ('Bind victim take', v_a, v_gm_a, v_victim, 'published', 'subgroup') returning id into v_victim_row;
  insert into storage.objects (bucket_id, name) values ('recordings', v_victim), ('recordings', v_orphan);

  -- -----------------------------------------------------------------------------------------------------
  -- A. The trigger. Every role registers the victim's abandoned path, in both buckets, as itself.
  -- -----------------------------------------------------------------------------------------------------
  for v_role, v_who in
    select * from (values
      ('member of group B', v_gm_b), ('manager of group B', v_mgr_b), ('member of group A (same group)', v_gm_a2),
      ('manager of group A', v_mgr_a), ('executive', v_exec), ('demoted executive', v_old_exec),
      ('former member of A', v_former), ('deactivated', v_dead), ('pending', v_pending)
    ) as r(role, id)
  loop
    foreach v_bucket in array array['recordings', 'club-archive'] loop
      perform test.m78b_expect(format('%s inserts the victim''s path, bucket %s, own group', v_role, v_bucket),
        test.error_as(v_who, format($q$insert into public.recordings (title, subgroup_id, uploaded_by, storage_path, storage_bucket) values ('Bind steal', %s, auth.uid(), %L, %L)$q$,
          case when v_who in (v_gm_b, v_mgr_b) then v_b else v_a end, v_orphan, v_bucket)), '*');
    end loop;
  end loop;
  -- (the '*' above means any refusal; the sentences are checked for the two cases the review reproduced)
  perform test.m78b_expect('member of B, bucket recordings: the own-folder sentence',
    test.error_as(v_gm_b, format($q$insert into public.recordings (title, subgroup_id, uploaded_by, storage_path, storage_bucket) values ('Bind steal', %s, auth.uid(), %L, 'recordings')$q$, v_b, v_orphan)),
    'A file can only be registered from your own folder');
  perform test.m78b_expect('member of B, bucket club-archive: refused (was accepted)',
    test.error_as(v_gm_b, format($q$insert into public.recordings (title, subgroup_id, uploaded_by, storage_path, storage_bucket) values ('Bind steal', %s, auth.uid(), %L, 'club-archive')$q$, v_b, v_orphan)),
    'A recording file can only be registered in the recordings bucket');
  -- own folder in the other bucket is refused as well: nothing signed-in registers a take in club-archive
  perform test.m78b_expect('member of B, own folder, bucket club-archive',
    test.error_as(v_gm_b, format($q$insert into public.recordings (title, subgroup_id, uploaded_by, storage_path, storage_bucket) values ('Bind own', %s, auth.uid(), %L, 'club-archive')$q$, v_b, v_gm_b || '/subgroups/' || v_b || '/x.webm')),
    'A recording file can only be registered in the recordings bucket');
  perform test.m78b_expect('executive, own folder, bucket club-archive',
    test.error_as(v_exec, format($q$insert into public.recordings (title, subgroup_id, uploaded_by, storage_path, storage_bucket) values ('Bind exec own', %s, auth.uid(), %L, 'club-archive')$q$, v_b, v_exec || '/x.mp3')),
    'A recording file can only be registered in the recordings bucket');
  -- a forged uploader is the actor guard's refusal (20261128030200), still in front of this rule
  perform test.m78b_expect('member of B names someone else as uploader',
    test.error_as(v_gm_b, format($q$insert into public.recordings (title, subgroup_id, uploaded_by, storage_path, storage_bucket) values ('Bind forged', %s, %L, %L, 'club-archive')$q$, v_b, v_gm_a, v_orphan)),
    '%uploaded_by%');
  -- the honest save is untouched, as a member and as an executive
  perform test.m78b_expect('member of B registers a take from their own folder',
    test.error_as(v_gm_b, format($q$insert into public.recordings (title, subgroup_id, uploaded_by, storage_path) values ('Bind honest', %s, auth.uid(), %L)$q$, v_b, v_gm_b || '/subgroups/' || v_b || '/honest.webm')), null);
  perform test.m78b_expect('executive registers a take from their own folder',
    test.error_as(v_exec, format($q$insert into public.recordings (title, subgroup_id, uploaded_by, storage_path, storage_bucket) values ('Bind exec honest', %s, auth.uid(), %L, 'recordings')$q$, v_a, v_exec || '/subgroups/' || v_a || '/honest.webm')), null);

  -- Updates of an existing row of one's own: to another bucket, to the victim's path, to both, to another uploader.
  select id into v_n from public.recordings where title = 'Bind honest';
  perform test.m78b_expect('own row moved to bucket club-archive',
    test.error_as(v_gm_b, format($q$update public.recordings set storage_bucket = 'club-archive' where id = %s$q$, v_n)), 'A recording file can only be registered in the recordings bucket');
  perform test.m78b_expect('own row pointed at the victim''s path',
    test.error_as(v_gm_b, format($q$update public.recordings set storage_path = %L where id = %s$q$, v_orphan, v_n)), 'A file can only be registered from your own folder');
  perform test.m78b_expect('own row pointed at the victim''s path and moved to club-archive',
    test.error_as(v_gm_b, format($q$update public.recordings set storage_path = %L, storage_bucket = 'club-archive' where id = %s$q$, v_orphan, v_n)), 'A recording file can only be registered in the recordings bucket');
  perform test.m78b_expect('own row handed to another uploader',
    test.error_as(v_gm_b, format($q$update public.recordings set uploaded_by = %L where id = %s$q$, v_gm_a, v_n)), '*');
  perform test.m78b_expect('executive repoints the member''s row at the victim''s path',
    test.error_as(v_exec, format($q$update public.recordings set storage_path = %L where id = %s$q$, v_orphan, v_n)), 'A file can only be registered from your own folder');
  perform test.m78b_expect('an edit of the same row that keeps path and bucket (the screens send the path again)',
    test.error_as(v_gm_b, format($q$update public.recordings set title = 'Bind honest edited', storage_path = storage_path, storage_bucket = storage_bucket where id = %s$q$, v_n)), null);

  -- The legacy copy: written with no signed-in person (a migration), in club-archive, in somebody else's folder.
  v_legacy_path := v_exec || '/legacy/old-concert.mp3';
  insert into public.recordings (title, subgroup_id, uploaded_by, storage_path, storage_bucket, status, audience)
  values ('Bind legacy copy', v_a, v_exec, v_legacy_path, 'club-archive', 'published', 'subgroup') returning id into v_legacy;
  perform test.m78b_expect('the executive edits the title of a legacy copy',
    test.error_as(v_exec, format($q$update public.recordings set title = 'Bind legacy copy, renamed' where id = %s$q$, v_legacy)), null);
  perform test.m78b_expect('the executive re-saves a legacy copy with its path and bucket unchanged',
    test.error_as(v_exec, format($q$update public.recordings set status = 'published', storage_path = storage_path where id = %s$q$, v_legacy)), null);
  perform test.m78b_eq('a member of A cannot repoint the legacy copy (the row is not theirs: no row is changed)',
    test.m78b_rows_as(v_gm_a, format($q$update public.recordings set storage_path = %L where id = %s$q$, v_orphan, v_legacy)), 0);
  perform test.m78b_expect('the same by the executive who uploaded it is refused by the rule',
    test.error_as(v_exec, format($q$update public.recordings set storage_path = %L where id = %s$q$, v_orphan, v_legacy)), 'A recording file can only be registered in the recordings bucket');

  -- -----------------------------------------------------------------------------------------------------
  -- B. The storage policies, with a row that already exists. The attack's row is inserted as the owner (no signed-in
  --    person), the way a row that predates the migration is in the table.
  -- -----------------------------------------------------------------------------------------------------
  insert into public.recordings (title, subgroup_id, uploaded_by, storage_path, storage_bucket, status)
  values ('Bind planted row', v_b, v_gm_b, v_orphan, 'club-archive', 'draft')
  on conflict (storage_path) do nothing;  -- without the migration the attack row is already there
  perform test.m78b_eq('planted row: the thief reads the victim''s abandoned object',
    test.count_as(v_gm_b, format('select count(*) from storage.objects where bucket_id = ''recordings'' and name = %L', v_orphan)), 0);
  perform test.m78b_eq('planted row: the thief updates it',
    test.m78b_rows_as(v_gm_b, format('update storage.objects set name = name where bucket_id = ''recordings'' and name = %L', v_orphan)), 0);
  perform test.m78b_eq('planted row: the thief deletes it',
    test.m78b_rows_as(v_gm_b, format('delete from storage.objects where bucket_id = ''recordings'' and name = %L', v_orphan)), 0);
  perform test.m78b_eq('planted row: the owner still reads it (own folder)',
    test.count_as(v_gm_a, format('select count(*) from storage.objects where bucket_id = ''recordings'' and name = %L', v_orphan)), 1);
  perform test.m78b_eq('planted row: the owner can still delete it although a row names the path in another bucket',
    test.m78b_rows_as(v_gm_a, format('delete from storage.objects where bucket_id = ''recordings'' and name = %L', v_orphan)), 1);
  -- (a second row for the victim's REGISTERED path cannot exist: recordings.storage_path is unique)

  -- A person's own abandoned file stays deletable although a row of ANOTHER bucket (a legacy copy of an executive's, which
  -- they can see as a member of the group) names the same path: that row does not "register" an object of the recordings bucket.
  v_own := v_gm_a2 || '/subgroups/' || v_a || '/abandoned-next-to-a-legacy-row.webm';
  insert into storage.objects (bucket_id, name) values ('recordings', v_own);
  insert into public.recordings (title, subgroup_id, uploaded_by, storage_path, storage_bucket, status, audience)
  values ('Bind legacy-like row', v_a, v_exec, v_own, 'club-archive', 'published', 'subgroup');
  perform test.m78b_eq('a legacy row of another bucket does not hide the owner''s abandoned file from their own delete',
    test.m78b_rows_as(v_gm_a2, format('delete from storage.objects where bucket_id = ''recordings'' and name = %L', v_own)), 1);

  -- A row in bucket A and an object of the same name in bucket B: the row vouches for its own bucket only.
  insert into storage.objects (bucket_id, name) values ('club-archive', v_victim);
  perform test.m78b_eq('object in club-archive with the take''s name: the group does not read it through the take''s row',
    test.count_as(v_gm_a2, format('select count(*) from storage.objects where bucket_id = ''club-archive'' and name = %L', v_victim)), 0);

  -- -----------------------------------------------------------------------------------------------------
  -- C. What did not change.
  -- -----------------------------------------------------------------------------------------------------
  perform test.m78b_eq('the victim''s group reads the registered take',
    test.count_as(v_gm_a2, format('select count(*) from storage.objects where bucket_id = ''recordings'' and name = %L', v_victim)), 1);
  perform test.m78b_eq('the manager of the group reads it',
    test.count_as(v_mgr_a, format('select count(*) from storage.objects where bucket_id = ''recordings'' and name = %L', v_victim)), 1);
  perform test.m78b_eq('an executive reads it',
    test.count_as(v_exec, format('select count(*) from storage.objects where bucket_id = ''recordings'' and name = %L', v_victim)), 1);
  perform test.m78b_eq('a member of another group does not',
    test.count_as(v_gm_b, format('select count(*) from storage.objects where bucket_id = ''recordings'' and name = %L', v_victim)), 0);
  perform test.m78b_eq('the former member does not',
    test.count_as(v_former, format('select count(*) from storage.objects where bucket_id = ''recordings'' and name = %L', v_victim)), 0);
  perform test.m78b_eq('the uploader updates their registered take',
    test.m78b_rows_as(v_gm_a, format('update storage.objects set name = name where bucket_id = ''recordings'' and name = %L', v_victim)), 1);
  perform test.m78b_eq('a member of the group who did not upload it cannot update it',
    test.m78b_rows_as(v_gm_a2, format('update storage.objects set name = name where bucket_id = ''recordings'' and name = %L', v_victim)), 0);
  perform test.m78b_eq('a member of the group who did not upload it cannot delete it',
    test.m78b_rows_as(v_gm_a2, format('delete from storage.objects where bucket_id = ''recordings'' and name = %L', v_victim)), 0);
  perform test.m78b_eq('an executive deletes it',
    test.m78b_rows_as(v_exec, format('delete from storage.objects where bucket_id = ''recordings'' and name = %L', v_victim)), 1);
  insert into storage.objects (bucket_id, name) values ('recordings', v_victim);
  perform test.m78b_eq('the uploader deletes their registered take',
    test.m78b_rows_as(v_gm_a, format('delete from storage.objects where bucket_id = ''recordings'' and name = %L', v_victim)), 1);
  v_own := v_gm_a || '/subgroups/' || v_a || '/never-registered.webm';
  insert into storage.objects (bucket_id, name) values ('recordings', v_own);
  perform test.m78b_eq('the uploader deletes their unregistered file',
    test.m78b_rows_as(v_gm_a, format('delete from storage.objects where bucket_id = ''recordings'' and name = %L', v_own)), 1);

  -- The legacy copy: its file is in club-archive and is served by the archive policies through its archive_items row,
  -- exactly as before (the recording policies never matched it: they only ever name the bucket `recordings`).
  insert into public.archive_items (title, type, storage_path, visibility, uploaded_by, subgroup_id)
  values ('Bind legacy archive item', 'recording', v_legacy_path, 'members', v_exec, v_a);
  insert into storage.objects (bucket_id, name) values ('club-archive', v_legacy_path);
  perform test.m78b_eq('legacy copy: a member of the group reads the file',
    test.count_as(v_gm_a2, format('select count(*) from storage.objects where bucket_id = ''club-archive'' and name = %L', v_legacy_path)), 1);
  perform test.m78b_eq('legacy copy: a member of another group does not',
    test.count_as(v_gm_b, format('select count(*) from storage.objects where bucket_id = ''club-archive'' and name = %L', v_legacy_path)), 0);
  perform test.m78b_eq('legacy copy: the member still sees the row in the recording room',
    test.count_as(v_gm_a2, format('select count(*) from public.recordings where id = %s', v_legacy)), 1);
  perform test.m78b_eq('legacy copy: and no recordings-bucket object is served by it',
    test.count_as(v_gm_a2, format('select count(*) from storage.objects where bucket_id = ''recordings'' and name = %L', v_legacy_path)), 0);

  -- Catalog: the three policies name the bucket of the row (the delete policy twice: once for the uploader, once for
  -- the "nobody registered it" test); a future rewrite that drops it fails here.
  select string_agg(polname, ', ') into v_msg
  from pg_policy
  where polrelid = 'storage.objects'::regclass
    and polname in ('Members read accessible recordings', 'Members update their recording files', 'Members delete their recording files')
    and (length(pg_get_expr(polqual, polrelid)) - length(replace(pg_get_expr(polqual, polrelid), 'storage_bucket = objects.bucket_id', '')))
        / length('storage_bucket = objects.bucket_id') < case when polname = 'Members delete their recording files' then 2 else 1 end;
  perform test.m78b_expect('the three recording policies compare the row''s bucket with the object''s', case when v_msg is null then null else 'without the comparison: ' || v_msg end, null);

  select string_agg(what, E'\n  ') into v_msg from test.m78b_fail;
  if v_msg is not null then raise exception E'RECORDING BUCKET BINDING: % failure(s):\n  %', (select count(*) from test.m78b_fail), v_msg; end if;
end $$;

rollback;
