-- Round 3, item 1 (20261127090000): attendance_eligibility is written only by
-- set_attendance_eligibility, which is SECURITY DEFINER and checks the caller.
-- Before the fix an executive could insert or update the table directly and set
-- updated_by and updated_at to anything.
begin;
do $$
declare
  v_exec uuid := test.make_user('Exec Seventyfour', 'executive');
  v_exec2 uuid := test.make_user('Exec Two Seventyfour', 'executive');
  v_admin uuid := test.make_user('Admin Seventyfour', 'admin');
  v_member uuid := test.make_user('Member Seventyfour');
  v_other uuid := test.make_user('Other Seventyfour');
  v_old uuid := test.make_user('Retired Exec Seventyfour', 'executive');
  message text;
  row_ public.attendance_eligibility;
begin
  -- The function and the table, as the catalog states them.
  assert (select p.prosecdef from pg_proc p where p.oid = 'public.set_attendance_eligibility(text, uuid, public.attendance_eligibility_status, text)'::regprocedure),
    'set_attendance_eligibility is SECURITY DEFINER';
  assert (select p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'public.set_attendance_eligibility(text, uuid, public.attendance_eligibility_status, text)'::regprocedure),
    'with an empty search_path';
  assert not has_table_privilege('authenticated', 'public.attendance_eligibility', 'insert'), 'authenticated cannot insert';
  assert not has_any_column_privilege('authenticated', 'public.attendance_eligibility', 'update'), 'authenticated cannot update';
  assert not has_table_privilege('authenticated', 'public.attendance_eligibility', 'delete'), 'authenticated cannot delete';
  assert has_table_privilege('authenticated', 'public.attendance_eligibility', 'select'), 'authenticated can still read it (policies decide which rows)';
  assert not has_table_privilege('anon', 'public.attendance_eligibility', 'select, insert, update, delete'), 'anon has nothing';

  -- The function still works for an executive and records who and when.
  perform test.login(v_exec);
  row_ := public.set_attendance_eligibility('2026-fall', v_member, 'under_review', '  checking  ');
  perform test.logout();
  assert row_.status = 'under_review' and row_.reason = 'checking' and row_.updated_by = v_exec and row_.updated_at = now(), 'the executive, the time and the trimmed reason are recorded';
  assert (select count(*) from public.attendance_eligibility where member_id = v_member and term_key = '2026-fall') = 1;

  -- A second executive changes it: the row now carries the second one, and the time of this call.
  update public.attendance_eligibility set updated_at = timestamptz '2020-01-01 00:00+00' where member_id = v_member and term_key = '2026-fall';
  perform test.login(v_exec2);
  perform public.set_attendance_eligibility('2026-fall', v_member, 'restricted', null);
  perform test.logout();
  select * into row_ from public.attendance_eligibility where member_id = v_member and term_key = '2026-fall';
  assert row_.status = 'restricted' and row_.reason is null and row_.updated_by = v_exec2 and row_.updated_at = now(), 'the update records the new executive and the real time';
  -- An administrator may too.
  perform test.login(v_admin);
  perform public.set_attendance_eligibility('2026-fall', v_member, 'reinstated', 'cleared');
  perform test.logout();
  assert (select updated_by from public.attendance_eligibility where member_id = v_member and term_key = '2026-fall') = v_admin;

  -- The old bypass: an executive writes the table directly. All refused.
  message := test.error_as(v_exec, format('insert into public.attendance_eligibility (term_key, member_id, status, updated_by, updated_at) values (''2026-fall'', %L, ''reinstated'', %L, timestamptz ''2020-01-01'')', v_other, v_exec2));
  assert message like 'permission denied for table attendance_eligibility%', 'executive: forge an eligibility row with another executive as author: ' || coalesce(message, 'it worked');
  message := test.error_as(v_exec, format('update public.attendance_eligibility set status = ''eligible'', updated_by = %L, updated_at = timestamptz ''2020-01-01'' where member_id = %L', v_exec2, v_member));
  assert message like 'permission denied for table attendance_eligibility%', 'executive: rewrite who decided and when: ' || coalesce(message, 'it worked');
  message := test.error_as(v_exec, format('delete from public.attendance_eligibility where member_id = %L', v_member));
  assert message like 'permission denied for table attendance_eligibility%', 'executive: delete an eligibility row: ' || coalesce(message, 'it worked');
  message := test.error_as(v_admin, format('update public.attendance_eligibility set status = ''eligible'' where member_id = %L', v_member));
  assert message like 'permission denied for table attendance_eligibility%', 'administrator: no direct update either: ' || coalesce(message, 'it worked');
  message := test.error_as(v_member, format('insert into public.attendance_eligibility (term_key, member_id, status) values (''2026-fall'', %L, ''reinstated'')', v_other));
  assert message like 'permission denied for table attendance_eligibility%', 'member: no direct insert: ' || coalesce(message, 'it worked');
  message := test.error_as(null, 'select count(*) from public.attendance_eligibility');
  assert message like 'permission denied%', 'anon: no read';
  -- Nothing changed.
  select * into row_ from public.attendance_eligibility where member_id = v_member and term_key = '2026-fall';
  assert row_.status = 'reinstated' and row_.updated_by = v_admin and row_.updated_at = now(), 'the row is as the function left it';
  assert (select count(*) from public.attendance_eligibility where member_id = v_other) = 0, 'no forged row for the other member';

  -- The function refuses everyone who is not an active executive.
  message := test.error_as(v_member, format('select public.set_attendance_eligibility(''2026-fall'', %L, ''reinstated'', null)', v_other));
  assert message = 'executive permission required', 'member: ' || coalesce(message, 'it worked');
  message := test.error_as(null, format('select public.set_attendance_eligibility(''2026-fall'', %L, ''reinstated'', null)', v_other));
  assert message like 'permission denied%', 'anon: execute is revoked: ' || coalesce(message, 'it worked');
  update public.profiles set status = 'deactivated' where id = v_old;
  message := test.error_as(v_old, format('select public.set_attendance_eligibility(''2026-fall'', %L, ''reinstated'', null)', v_other));
  assert message = 'executive permission required', 'a deactivated executive: ' || coalesce(message, 'it worked');
  update public.profiles set status = 'active', role = 'member' where id = v_old;
  message := test.error_as(v_old, format('select public.set_attendance_eligibility(''2026-fall'', %L, ''reinstated'', null)', v_other));
  assert message = 'executive permission required', 'a former executive: ' || coalesce(message, 'it worked');
  assert (select count(*) from public.attendance_eligibility where member_id = v_other) = 0, 'and none of them wrote a row';

  -- Reading: a member sees their own row only; executives see every row.
  perform test.login(v_exec);
  perform public.set_attendance_eligibility('2026-fall', v_other, 'under_review', null);
  perform test.logout();
  assert test.count_as(v_member, 'select count(*) from public.attendance_eligibility') = 1, 'a member reads only their own row';
  assert test.count_as(v_other, 'select count(*) from public.attendance_eligibility') = 1;
  assert test.count_as(v_exec, 'select count(*) from public.attendance_eligibility') = 2, 'an executive reads every row';
  -- The read function (security invoker) still works for both.
  assert test.error_as(v_member, 'select public.get_attendance_workspace(''all'', null)') is null, 'the workspace still loads for a member';
  assert test.error_as(v_exec, 'select public.get_attendance_workspace(''all'', null)') is null, 'and for an executive';
end $$;
rollback;
