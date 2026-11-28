-- Membership gate (P0-01, decision D1): a new sign-up waits for an executive.
-- What each state can do, how a sign-up is reviewed (approve, decline, undo), who may review, what
-- the queue and the bootstrap say, and that nobody gets round the guards. The same guarantees for
-- every table, function and bucket are in 76_membership_gate_every_object.test.sql; what happens
-- to profiles that exist before the migration is in concurrency/76_membership_gate_existing_rows.sh.
begin;
-- A session that is signed in as p_user but runs as the table owner, which is what a SECURITY DEFINER
-- function is: auth.uid() answers p_user and row-level security does not apply. Returns the error or null.
create function test.error_as_caller(p_user uuid, p_sql text) returns text language plpgsql as $$
declare message text;
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  message := test.error_of(p_sql);
  perform set_config('request.jwt.claim.sub', '', true);
  return message;
end $$;

-- The SQLSTATE a statement fails with as a signed-in user ('ok' when it runs): 42501 is "permission denied".
create function test.sqlstate_as(p_user uuid, p_sql text) returns text language plpgsql as $$
declare st text;
begin
  perform test.login(p_user);
  begin
    execute p_sql;
    st := 'ok';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
  end;
  perform test.logout();
  return st;
end $$;

do $$
declare
  v_admin uuid := test.make_user('Admin Gate Two', 'admin');
  v_exec uuid := test.make_user('Exec Gate Two', 'executive');
  v_exec2 uuid := test.make_user('Exec Gate Three', 'executive');
  v_member uuid := test.make_user('Member Gate Two');
  v_gone uuid := test.make_user('Gone Gate Two', 'executive');
  v_a uuid;       -- a fresh sign-up, exactly as the signup trigger leaves it
  v_b uuid;
  v_c uuid;
  v_group bigint;
  v_session bigint;
  message text;
  boot jsonb;
  prof public.profiles;
  n bigint;
  audit_before bigint;
begin
  -- -------------------------------------------------------------------------
  -- A sign-up is pending, a plain member, and not the bootstrap administrator's exemption
  -- -------------------------------------------------------------------------
  insert into auth.users (email, raw_user_meta_data) values ('first.signup@test.invalid', '{"full_name": "First Signup"}') returning id into v_a;
  insert into auth.users (email, raw_user_meta_data) values ('second.signup@test.invalid', '{"full_name": "Second Signup"}') returning id into v_b;
  insert into auth.users (email, raw_user_meta_data) values ('third.signup@test.invalid', '{}') returning id into v_c;
  assert (select status from public.profiles where id = v_a) = 'pending', 'a new sign-up starts pending';
  assert (select role from public.profiles where id = v_a) = 'member', 'and as a plain member';
  assert (select full_name from public.profiles where id = v_a) = 'First Signup', 'with the name Google gave';
  assert (select joined_at from public.profiles where id = v_a) > now() - interval '1 minute', 'and the time of the request';
  assert (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'status') = '''pending''::text',
    'a profile written without a status is a sign-up too (fails closed)';

  -- The club's first administrator is never made pending (the address the admin migration promotes).
  declare
    v_boot_email text := (select email from public.profiles where role = 'admin' and email not like '%@test.invalid' order by joined_at, id limit 1);
    v_boot_id uuid := (select id from public.profiles where email = v_boot_email);
    v_new uuid;
  begin
    assert v_boot_email is not null, 'the replay has a bootstrap administrator';
    assert (select status from public.profiles where id = v_boot_id) = 'active', 'the bootstrap administrator is active';
    delete from auth.users where id = v_boot_id;
    insert into auth.users (email, raw_user_meta_data) values (upper(v_boot_email), '{}') returning id into v_new;
    assert (select status from public.profiles where id = v_new) = 'active', 'the bootstrap address signs up active, in any letter case: ' || v_boot_email;
  end;

  -- -------------------------------------------------------------------------
  -- What a pending account can do: read its own profile row, ask the bootstrap, nothing else
  -- -------------------------------------------------------------------------
  perform test.login(v_exec);
  select id into v_group from public.create_subgroup('Gate Ensemble', '', 'open');
  insert into public.announcements (title, body, created_by) values ('Gate notice', 'Club-wide', v_exec);
  insert into public.events (title, description, starts_at, location, created_by) values ('Gate concert', '', now() + interval '2 days', 'Hall', v_exec);
  select id into v_session from public.create_attendance_session('club', null, 'Gate meeting', now());
  perform test.logout();

  assert test.count_as(v_a, 'select count(*) from public.profiles') = 1, 'pending: only the own profile row';
  assert test.count_as(v_a, format('select count(*) from public.profiles where id = %L', v_a)) = 1, 'pending: the own row is that of the account';
  assert test.count_as(v_a, 'select count(*) from public.announcements') = 0, 'pending reads no announcements';
  assert test.count_as(v_a, 'select count(*) from public.events') = 0;
  assert test.count_as(v_a, 'select count(*) from public.subgroups') = 0;
  assert test.count_as(v_a, 'select count(*) from public.attendance_sessions') = 0;
  assert test.count_as(v_a, 'select count(*) from public.signup_reviews') = 0;
  assert test.count_as(v_a, 'select count(*) from storage.objects') = 0;
  perform test.login(v_a);
  boot := public.get_portal_bootstrap();
  perform test.logout();
  assert boot -> 'profile' ->> 'status' = 'pending' and boot -> 'profile' ->> 'role' = 'member' and boot -> 'profile' ->> 'full_name' = 'First Signup',
    'the bootstrap tells the client: pending';
  assert jsonb_array_length(boot -> 'groups') = 0 and jsonb_array_length(boot -> 'announcements') = 0 and jsonb_array_length(boot -> 'events') = 0
    and jsonb_array_length(boot -> 'memberships') = 0 and jsonb_array_length(boot -> 'archive') = 0 and (boot ->> 'resource_count')::int = 0,
    'and carries nothing else';
  assert not (boot ? 'pending_signups'), 'a pending account is told nothing about the queue';

  -- Writes, one of each kind: through a policy, through a security definer function, through the profile.
  message := test.error_as(v_a, 'update public.profiles set full_name = ''Edited'' where id = (select auth.uid())');
  assert message like 'Your sign-up is waiting for approval by a club executive%', 'pending cannot edit its own profile: ' || coalesce(message, 'no error');
  assert (select full_name from public.profiles where id = v_a) = 'First Signup';
  message := test.error_as(v_a, 'select public.submit_member_reimbursement(''Strings'', ''Shop'', 20, current_date, ''Supplies'', ''1234'')');
  -- (the finance functions check the state themselves and word it for a deactivated account; the refusal is what counts)
  assert message like 'Your %', 'pending cannot submit a reimbursement: ' || coalesce(message, 'no error');
  assert not exists (select 1 from public.personal_reimbursements where member_id = v_a), 'and nothing was written';
  message := test.error_as(v_a, format('select public.request_subgroup_enrollment(%s)', v_group));
  assert message is not null, 'pending cannot ask to join an open group';
  assert not exists (select 1 from public.subgroup_memberships where member_id = v_a), 'and nothing was written';
  message := test.error_as(v_a, format('select public.check_in_attendance(%L)', 'ABCDEFGH'));
  assert message is not null, 'pending cannot check in';
  message := test.error_as(v_a, 'select public.create_subgroup(''Sneaky'', '''', ''open'')');
  assert message is not null, 'pending cannot create a group';
  message := test.error_as(v_a, format('insert into public.announcements (title, body, created_by) values (''Hi'', ''there'', %L)', v_a));
  assert message like 'Your sign-up is waiting for approval%', 'pending cannot post: ' || coalesce(message, 'no error');
  message := test.error_as(v_a, format('select public.review_pending_member(%L, true, '''')', v_a));
  assert message like 'Only club executives can review sign-ups%', 'pending cannot approve itself: ' || coalesce(message, 'no error');
  message := test.error_as(v_a, format('select public.review_pending_member(%L, true, '''')', v_b));
  assert message like 'Only club executives can review sign-ups%', 'pending cannot approve someone else: ' || coalesce(message, 'no error');
  message := test.error_as(v_a, 'select * from public.list_pending_members()');
  assert message like 'Only club executives can see sign-up requests%', 'pending cannot read the queue: ' || coalesce(message, 'no error');
  message := test.sqlstate_as(v_a, format('update public.profiles set status = ''active'' where id = %L', v_a));
  assert message = '42501', 'no privilege on profiles.status: ' || message;
  message := test.sqlstate_as(v_a, format('update public.profiles set role = ''admin'' where id = %L', v_a));
  assert message = '42501', 'no privilege on profiles.role: ' || message;
  assert test.sqlstate_as(null, 'select public.review_pending_member(null, true)') = '42501', 'anonymous: permission denied';
  assert test.sqlstate_as(null, 'select * from public.list_pending_members()') = '42501', 'anonymous cannot read the queue';

  -- An active member cannot read the queue or see the applicants in the directory; an executive can.
  assert test.count_as(v_member, format('select count(*) from public.profiles where id in (%L, %L, %L)', v_a, v_b, v_c)) = 0, 'a member does not see sign-ups in the directory';
  assert test.count_as(v_member, 'select count(*) from public.profiles where status = ''pending''') = 0;
  assert test.count_as(v_member, 'select count(*) from public.profiles') >= 5, 'but still sees the members';
  assert test.count_as(v_a, format('select count(*) from public.profiles where id = %L', v_b)) = 0, 'a pending account does not see another';
  assert test.count_as(v_exec, format('select count(*) from public.profiles where id in (%L, %L, %L)', v_a, v_b, v_c)) = 3, 'an executive sees them';
  message := test.error_as(v_member, 'select * from public.list_pending_members()');
  assert message like 'Only club executives can see sign-up requests%', 'a member cannot read the queue: ' || coalesce(message, 'no error');
  message := test.error_as(v_member, format('select public.review_pending_member(%L, true, '''')', v_a));
  assert message like 'Only club executives can review sign-ups%', 'a member cannot approve: ' || coalesce(message, 'no error');
  assert (select status from public.profiles where id = v_a) = 'pending', 'and nothing changed';

  -- An account cannot be added to a group while pending.
  message := test.error_as(v_exec, format('select public.add_subgroup_member(%s, %L)', v_group, v_a));
  assert message like 'This person has not been approved yet%', 'nobody adds a pending person to a group: ' || coalesce(message, 'no error');

  -- -------------------------------------------------------------------------
  -- The queue and the count
  -- -------------------------------------------------------------------------
  perform test.login(v_exec);
  boot := public.get_portal_bootstrap();
  perform test.logout();
  assert (boot ->> 'pending_signups')::int = 3, 'executives are told how many are waiting: ' || coalesce(boot ->> 'pending_signups', 'null');
  perform test.login(v_member);
  boot := public.get_portal_bootstrap();
  perform test.logout();
  assert not (boot ? 'pending_signups'), 'members are not: the answer has the shape it always had';
  assert (select array_agg(k order by k) from jsonb_object_keys(boot) k) = array['announcements', 'archive', 'events', 'groups', 'memberships', 'profile', 'resource_count'], 'no other key changed';
  perform test.login(v_admin);
  boot := public.get_portal_bootstrap();
  perform test.logout();
  assert (boot ->> 'pending_signups')::int = 3, 'administrators too';

  perform test.login(v_exec);
  select count(*) into n from public.list_pending_members();
  assert n = 3, 'the queue lists the three waiting: ' || n;
  assert (select array_agg(q.email order by q.requested_at, q.member_id) from public.list_pending_members() q) is not null;
  assert (select count(*) from public.list_pending_members() q where q.email = 'first.signup@test.invalid' and q.full_name = 'First Signup'
            and q.status = 'pending' and q.requested_at is not null and q.decided_at is null and q.reason = '') = 1, 'name, address and time of the request';
  perform test.logout();

  -- -------------------------------------------------------------------------
  -- Approve
  -- -------------------------------------------------------------------------
  message := test.error_as(v_exec, format('select public.review_pending_member(%L, true, '''')', v_exec));
  assert message like 'You cannot review your own sign-up%', 'an executive cannot review themselves: ' || coalesce(message, 'no error');
  message := test.error_as(v_admin, format('select public.review_pending_member(%L, true, '''')', v_admin));
  assert message like 'You cannot review your own sign-up%', 'nor an administrator: ' || coalesce(message, 'no error');
  message := test.error_as(v_exec, 'select public.review_pending_member(gen_random_uuid(), true, '''')');
  assert message like 'Sign-up not found%', 'unknown person: ' || coalesce(message, 'no error');
  message := test.error_as(v_exec, format('select public.review_pending_member(%L, null, '''')', v_a));
  assert message like 'Choose a sign-up%', 'a missing decision is refused';

  select count(*) into audit_before from public.admin_audit_log where action = 'signup_approved';
  perform test.login(v_exec);
  prof := public.review_pending_member(v_a, true, '');
  perform test.logout();
  assert prof.status = 'active' and prof.role = 'member' and prof.id = v_a, 'approval returns the active member profile';
  assert (select status from public.profiles where id = v_a) = 'active';
  assert (select count(*) from public.admin_audit_log where action = 'signup_approved' and target_id = v_a and actor_id = v_exec
            and details ->> 'previous_status' = 'pending' and details ->> 'full_name' = 'First Signup') = 1, 'the approval is audited with who, whom and the previous state';
  assert (select count(*) from public.admin_audit_log where action = 'signup_approved') = audit_before + 1;
  assert (select decision from public.signup_reviews where member_id = v_a) = 'approved' and (select decided_by from public.signup_reviews where member_id = v_a) = v_exec, 'who approved is recorded';
  -- ... and now they are a member.
  assert test.count_as(v_a, 'select count(*) from public.announcements') = 1, 'approved: reads the club';
  assert test.count_as(v_a, 'select count(*) from public.profiles') >= 7, 'approved: sees the directory';
  perform test.login(v_a);
  perform public.request_subgroup_enrollment(v_group);
  boot := public.get_portal_bootstrap();
  perform test.logout();
  assert (select status::text from public.subgroup_memberships where member_id = v_a and subgroup_id = v_group) = 'active', 'approved: can join an open group';
  assert boot -> 'profile' ->> 'status' = 'active' and not (boot ? 'pending_signups');
  assert test.count_as(v_member, format('select count(*) from public.profiles where id = %L', v_a)) = 1, 'and the directory lists them';
  assert test.count_as(v_exec, 'select count(*) from public.list_pending_members()') = 2, 'they left the queue';
  assert test.count_as(v_a, 'select count(*) from public.signup_reviews') = 0, 'the review record is for executives, not the member';
  assert test.count_as(v_exec2, 'select count(*) from public.signup_reviews') = 1, 'executives read it';
  assert test.count_as(v_member, 'select count(*) from public.signup_reviews') = 0, 'members do not';

  -- Double approval: a clear message, nothing changes, no second audit row.
  message := test.error_as(v_exec2, format('select public.review_pending_member(%L, true, '''')', v_a));
  assert message like 'This person is already an active member. Nothing was changed.%', 'approving twice: ' || coalesce(message, 'no error');
  assert (select count(*) from public.admin_audit_log where action = 'signup_approved' and target_id = v_a) = 1, 'no second audit row';
  assert (select decided_by from public.signup_reviews where member_id = v_a) = v_exec, 'the record still names the first reviewer';
  -- Declining someone who is already a member is refused as well; so is a member who was never a sign-up.
  message := test.error_as(v_exec, format('select public.review_pending_member(%L, false, ''x'')', v_a));
  assert message like 'This person is already an active member, so the sign-up cannot be declined%', 'declining a member: ' || coalesce(message, 'no error');
  message := test.error_as(v_exec, format('select public.review_pending_member(%L, true, '''')', v_member));
  assert message like 'This person is already an active member%', 'approving a member who was never a sign-up: ' || coalesce(message, 'no error');
  assert (select status from public.profiles where id = v_member) = 'active';

  -- An executive of the deactivated kind cannot review.
  perform test.login(v_admin);
  perform public.admin_deactivate_member(v_gone, 'left');
  perform test.logout();
  message := test.error_as(v_gone, format('select public.review_pending_member(%L, true, '''')', v_b));
  assert message like 'Only club executives can review sign-ups%', 'a deactivated executive cannot approve: ' || coalesce(message, 'no error');
  assert (select status from public.profiles where id = v_b) = 'pending';

  -- -------------------------------------------------------------------------
  -- Decline, the message the person sees, and the undo
  -- -------------------------------------------------------------------------
  perform test.login(v_exec);
  prof := public.review_pending_member(v_b, false, '  Not a student at the university  ');
  perform test.logout();
  assert prof.status = 'rejected' and prof.role = 'member', 'declined: rejected';
  assert (select count(*) from public.admin_audit_log where action = 'signup_declined' and target_id = v_b and actor_id = v_exec and details ->> 'reason' = 'Not a student at the university') = 1, 'the decline is audited with its reason, trimmed';
  assert (select reason from public.signup_reviews where member_id = v_b) = 'Not a student at the university' and (select decision from public.signup_reviews where member_id = v_b) = 'declined';
  perform test.login(v_b);
  boot := public.get_portal_bootstrap();
  perform test.logout();
  assert boot -> 'profile' ->> 'status' = 'rejected', 'the bootstrap tells the client: rejected';
  assert jsonb_array_length(boot -> 'announcements') = 0 and jsonb_array_length(boot -> 'groups') = 0, 'and nothing else';
  assert test.count_as(v_b, 'select count(*) from public.profiles') = 1 and test.count_as(v_b, 'select count(*) from public.announcements') = 0, 'declined: sees only its own row';
  message := test.error_as(v_b, 'update public.profiles set full_name = ''Edited'' where id = (select auth.uid())');
  assert message like 'Your sign-up was not approved%', 'declined: cannot write: ' || coalesce(message, 'no error');
  assert test.count_as(v_member, format('select count(*) from public.profiles where id = %L', v_b)) = 0, 'a member does not see the declined sign-up either';
  message := test.error_as(v_exec2, format('select public.review_pending_member(%L, false, ''again'')', v_b));
  assert message like 'This sign-up was already declined. Nothing was changed.%', 'declining twice: ' || coalesce(message, 'no error');
  assert (select count(*) from public.admin_audit_log where action = 'signup_declined' and target_id = v_b) = 1, 'no second audit row';
  assert test.count_as(v_exec, 'select count(*) from public.list_pending_members()') = 2, 'the queue: one waiting, one declined';
  perform test.login(v_exec2);
  assert (select count(*) from public.list_pending_members() q where q.member_id = v_b and q.status = 'rejected' and q.reason = 'Not a student at the university'
            and q.decided_by_name = 'Exec Gate Two' and q.decided_at is not null) = 1, 'the queue shows the declined sign-up with its reason and who declined it';
  assert (select q.member_id from public.list_pending_members() q order by (q.status = 'pending') desc, q.requested_at limit 1) = v_c, 'waiting first';
  perform test.logout();
  perform test.login(v_exec2);
  boot := public.get_portal_bootstrap();
  perform test.logout();
  assert (boot ->> 'pending_signups')::int = 1, 'the count is of those waiting, not the declined: ' || (boot ->> 'pending_signups');

  -- The undo: another executive approves the declined sign-up.
  perform test.login(v_exec2);
  prof := public.review_pending_member(v_b, true, '');
  perform test.logout();
  assert prof.status = 'active', 'undone: active';
  assert (select count(*) from public.admin_audit_log where action = 'signup_approved' and target_id = v_b and details ->> 'previous_status' = 'rejected' and actor_id = v_exec2) = 1, 'the undo is audited as an approval of a declined sign-up';
  assert (select decision from public.signup_reviews where member_id = v_b) = 'approved' and (select decided_by from public.signup_reviews where member_id = v_b) = v_exec2;
  assert test.count_as(v_b, 'select count(*) from public.announcements') = 1, 'and the person reads the club';

  -- -------------------------------------------------------------------------
  -- One door: nothing else moves a sign-up or a pending account's role
  -- -------------------------------------------------------------------------
  message := test.error_as(v_admin, format('select public.admin_reactivate_member(%L)', v_c));
  assert message like 'A sign-up is approved from the sign-up queue only%', 'an administrator cannot reactivate a pending account: ' || coalesce(message, 'no error');
  message := test.error_as(v_admin, format('select public.admin_deactivate_member(%L, ''x'')', v_c));
  assert message like 'This is a sign-up request, not a member yet%', 'nor deactivate it: ' || coalesce(message, 'no error');
  message := test.error_as(v_admin, format('select public.admin_change_member_role(%L, ''executive'')', v_c));
  assert message like 'Approve this sign-up before changing its role%', 'nor give it a role: ' || coalesce(message, 'no error');
  message := test.error_as(v_admin, format('select public.admin_change_member_role(%L, ''admin'')', v_c));
  assert message like 'Approve this sign-up before changing its role%', 'nor make it an administrator';
  message := test.error_as(v_admin, format('select public.admin_update_member_profile(%L, ''Third'', '''', '''', '''', array[%s]::bigint[])', v_c, v_group));
  assert message like 'This person has not been approved yet%', 'nor put it in a group through the profile editor: ' || coalesce(message, 'no error');
  assert (select status from public.profiles where id = v_c) = 'pending' and (select role from public.profiles where id = v_c) = 'member', 'still pending, still a member';
  -- Direct SQL as the table owner (no signed-in caller: the SQL editor, a migration) is not held to the guard, but the table is: an
  -- executive or administrator can never be pending, and a pending account never has a role.
  message := test.error_of(format('update public.profiles set role = ''executive'' where id = %L', v_c));
  assert message like '%profiles_unapproved_are_members%', 'the table refuses a pending executive: ' || coalesce(message, 'no error');
  message := test.error_of(format('update public.profiles set status = ''pending'' where id = %L', v_exec));
  assert message like '%profiles_unapproved_are_members%', 'the table refuses an executive who is pending: ' || coalesce(message, 'no error');
  message := test.error_of(format('update public.profiles set status = ''rejected'' where id = %L', v_admin));
  assert message like '%profiles_unapproved_are_members%', 'or declined: ' || coalesce(message, 'no error');
  message := test.error_of(format('update public.profiles set status = ''waiting'' where id = %L', v_c));
  assert message like '%profiles_status_check%', 'an unknown state is refused';
  -- An approved account cannot be sent back to the queue, even by an executive's own session (no privilege) or an administrator.
  message := test.sqlstate_as(v_admin, format('update public.profiles set status = ''pending'' where id = %L', v_a));
  assert message = '42501', 'no one writes status through the API: ' || message;
  -- The guard itself. A signed-in caller who reaches the table through a function that runs as its owner (which is what
  -- every admin function does) is held to it; the check below runs as the owner with the caller's identity, like they do.
  message := test.error_as_caller(v_admin, format('update public.profiles set status = ''active'' where id = %L', v_c));
  assert message like 'A sign-up is approved from the sign-up queue only%', 'the guard stops an approval outside the queue: ' || coalesce(message, 'no error');
  message := test.error_as_caller(v_admin, format('update public.profiles set status = ''pending'' where id = %L', v_a));
  assert message like 'An approved account cannot go back to waiting for approval%', 'the guard stops going back: ' || coalesce(message, 'no error');
  message := test.error_as_caller(v_admin, format('update public.profiles set status = ''rejected'' where id = %L', v_member));
  assert message like 'An approved account cannot go back to waiting for approval%', 'or to declined: ' || coalesce(message, 'no error');
  message := test.error_as_caller(v_admin, format('update public.profiles set status = ''deactivated'' where id = %L', v_c));
  assert message like 'This is a sign-up request, not a member yet%', 'the guard stops deactivating a sign-up: ' || coalesce(message, 'no error');
  -- The switch review_pending_member turns on is not enough by itself: the caller must be an active executive.
  perform set_config('app.signup_review', 'on', true);
  message := test.error_as_caller(v_member, format('update public.profiles set status = ''active'' where id = %L', v_c));
  assert message like 'A sign-up is approved from the sign-up queue only%', 'a member who set the switch still cannot approve: ' || coalesce(message, 'no error');
  message := test.error_as_caller(v_gone, format('update public.profiles set status = ''active'' where id = %L', v_c));
  assert message like 'Your access to the portal has been deactivated%', 'nor a deactivated executive (the writer trigger answers first): ' || coalesce(message, 'no error');
  perform set_config('app.signup_review', 'off', true);
  assert (select status from public.profiles where id = v_c) = 'pending', 'still pending after every attempt';

  -- A deactivated member is not a sign-up.
  message := test.error_as(v_exec, format('select public.review_pending_member(%L, true, '''')', v_gone));
  assert message like 'This account was deactivated: it is not a new sign-up%', 'approval of a deactivated account: ' || coalesce(message, 'no error');
  assert (select status from public.profiles where id = v_gone) = 'deactivated';

  -- The last waiting sign-up: the reason is optional and capped.
  perform test.login(v_exec);
  perform public.review_pending_member(v_c, false, repeat('x', 900));
  perform test.logout();
  assert (select char_length(reason) from public.signup_reviews where member_id = v_c) = 500, 'the reason is capped at 500 characters';

  -- Deleting a sign-up that never became a member is the administrator's cleanup, and takes its review with it.
  perform test.login(v_admin);
  perform public.admin_delete_member(v_c);
  perform test.logout();
  assert not exists (select 1 from public.profiles where id = v_c) and not exists (select 1 from public.signup_reviews where member_id = v_c), 'deleted with its record';

  -- -------------------------------------------------------------------------
  -- The rest of the world is as it was: a member's profile edit, an executive's queue
  -- -------------------------------------------------------------------------
  perform test.login(v_member);
  update public.profiles set phone = '555' where id = v_member;
  perform test.logout();
  assert (select phone from public.profiles where id = v_member) = '555', 'active members still edit their own profile';
  assert test.error_as(v_exec, 'select * from public.list_pending_members()') is null, 'executives still read the queue (empty or not)';
end $$;
rollback;

-- ===========================================================================
-- Running the migrations again changes nothing, and what a profile is is not touched.
-- ===========================================================================
begin;
do $$
declare
  v_admin uuid := test.make_user('Admin Gate Four', 'admin');
  v_exec uuid := test.make_user('Exec Gate Four', 'executive');
  v_member uuid := test.make_user('Member Gate Four');
  v_gone uuid := test.make_user('Gone Gate Four', p_status => 'deactivated');
  v_wait uuid := test.make_user('Waiting Gate Four', p_status => 'pending');
  before_rows text;
begin
  select string_agg(p.id || ':' || p.role || ':' || p.status, ',' order by p.id) into before_rows from public.profiles p;
  assert before_rows like '%' || v_wait || ':member:pending%' and before_rows like '%' || v_gone || ':member:deactivated%';
end $$;
create temp table gate_before as select p.id, p.role, p.status from public.profiles p;
\ir ../migrations/20261128010000_membership_gate_schema.sql
\ir ../migrations/20261128010100_membership_gate_signup_default.sql
\ir ../migrations/20261128010000_membership_gate_schema.sql
do $$
declare n bigint;
begin
  select count(*) into n from gate_before b full join public.profiles p on p.id = b.id
  where b.id is null or p.id is null or b.role is distinct from p.role or b.status is distinct from p.status;
  assert n = 0, 'no profile changed state or role when the migrations ran again: ' || n;
  assert (select count(*) from pg_constraint where conrelid = 'public.profiles'::regclass and conname in ('profiles_status_check', 'profiles_unapproved_are_members')) = 2;
  assert (select count(*) from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname in ('guard_profile_status', 'block_deactivated_writer')) = 2, 'one guard trigger each, not two';
  assert (select count(*) from pg_policies where tablename = 'signup_reviews') = 2, 'one policy each on the review table';
  assert (select count(*) from pg_policies where tablename = 'profiles' and policyname = 'Signed-in members view directory') = 1;
  assert (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'status') = '''pending''::text';
end $$;
rollback;
