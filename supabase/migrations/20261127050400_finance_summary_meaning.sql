-- Finance fixes, part 5: what the summary figures mean (review finding
-- finance-6, part b). Documentation only; the function is not changed.
--
-- "Club spending" is the value of approved and settled purchases. "Available
-- cash" is the money that actually moved. The two differ when a reimbursement
-- is approved for less than it was requested: a 100 purchase approved at 60
-- and paid counts 100 in spending and takes 60 out of cash. That is deliberate
-- (the purchase happened; the club only covers part of it), the screen says
-- "Approved and settled purchases", and supabase/tests/80_finance_guards.test.sql
-- pins the behaviour so a change has to be made on purpose. Self-payment is a
-- separate Phase 4 item (plan 4.2) and is not handled here.
comment on function public.get_finance_summary() is
  'Finance totals for the signed-in user, computed under their own row level security. available_cash: posted and cleared payments, inflow minus outflow (money that moved). income: posted and cleared inflows. spending: the full amount of approved and settled purchases, which can be more than the cash paid out when a reimbursement was approved for less than requested. pending_reimbursement_total/count: requests waiting for review or payment, at the approved amount when there is one. expected_funding: approved funding claims minus what has been received.';
