-- Finance RPCs are intentionally available only to signed-in club members.
-- Explicitly revoke the Supabase `anon` role in addition to PostgreSQL's
-- pseudo-role `public` so the API boundary matches the in-function checks.
revoke execute on function public.submit_member_reimbursement(text, text, numeric, date, text, text, text, bigint, bigint, boolean, text, timestamptz, integer, text) from anon;
revoke execute on function public.record_club_expense(text, text, numeric, date, text, text, text, bigint, bigint, boolean, text, timestamptz, integer, text) from anon;
revoke execute on function public.record_finance_income(text, numeric, date, text, text, text) from anon;
revoke execute on function public.review_personal_reimbursement(bigint, text, numeric, text) from anon;
revoke execute on function public.pay_personal_reimbursement(bigint, date, text) from anon;
revoke execute on function public.record_funding_claim_payment(bigint, numeric, date, text) from anon;
