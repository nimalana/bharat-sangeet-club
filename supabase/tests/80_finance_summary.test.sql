-- Finance fixes: what the summary figures mean (review finding finance-6, part b).
-- "Club spending" is the value of approved and settled purchases; "Available
-- cash" is the money that moved. They differ when a reimbursement is approved
-- for less than it was requested. That is deliberate and documented on the
-- function; this test makes a change to it a decision rather than an accident.
begin;
do $$
declare
  v_exec uuid := test.make_user('Exec Summary', 'executive');
  v_exec2 uuid := test.make_user('Exec Summary B', 'executive');
  v_member uuid := test.make_user('Member Summary');
  v_summary jsonb;
  e1 bigint; r1 bigint; e2 bigint; r2 bigint;
begin
  perform test.login(v_exec);
  perform public.record_finance_income('Gig', 1000, date '2026-11-01', 'Gig revenue', 'UNC');
  perform public.record_club_expense('Tabla repair', 'Music shop', 100, date '2026-11-02', 'Instruments', 'Club bank account', '4242');
  perform test.logout();
  perform test.login(v_member);
  select expense_id, reimbursement_id into e1, r1 from public.submit_member_reimbursement('Big purchase', 'Shop', 100, date '2026-11-05', 'Supplies', '1111');
  select expense_id, reimbursement_id into e2, r2 from public.submit_member_reimbursement('Second purchase', 'Shop', 50, date '2026-11-05', 'Supplies', '2222');
  perform test.logout();
  perform test.login(v_exec2);
  perform public.review_personal_reimbursement(r1, 'approved', 60, 'Covered up to 60');
  perform public.review_personal_reimbursement(r2, 'approved', 30, 'Covered up to 30');
  perform test.logout();
  perform test.login(v_exec);
  perform public.pay_personal_reimbursement(r1, date '2026-11-06');
  v_summary := public.get_finance_summary();
  perform test.logout();

  -- Cash: 1000 in, 100 for the club purchase, 60 paid out. The second reimbursement is approved, not paid.
  assert (v_summary ->> 'available_cash')::numeric = 840, 'cash is what moved: ' || (v_summary ->> 'available_cash');
  -- Spending: 100 club purchase + 100 paid purchase (approved at 60) + 50 approved purchase (approved at 30).
  assert (v_summary ->> 'spending')::numeric = 250, 'spending is the purchase value: ' || (v_summary ->> 'spending');
  -- What is still owed is at the approved amount.
  assert (v_summary ->> 'pending_reimbursement_total')::numeric = 30 and (v_summary ->> 'pending_reimbursement_count')::int = 1, 'the unpaid reimbursement is owed at the approved amount';
  assert obj_description('public.get_finance_summary()'::regprocedure, 'pg_proc') like '%approved for less than requested%', 'the difference is documented on the function';
end $$;
rollback;
