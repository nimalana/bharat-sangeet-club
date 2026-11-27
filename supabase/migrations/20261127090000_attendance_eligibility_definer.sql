-- Round 3, item 1: an executive could write attendance_eligibility directly.
--
-- public.set_attendance_eligibility has been SECURITY INVOKER since
-- 20260831004000 ("the RPC can run as the caller instead of bypassing table
-- policies"). That is why authenticated kept INSERT and UPDATE on the table
-- (20261127075000 left them in place and said so). The row policies let any
-- executive through, so an executive could skip the function and write the
-- table straight through the Data API:
--
--   insert into attendance_eligibility (term_key, member_id, status, updated_by, updated_at)
--   values ('2026-fall', <member>, 'reinstated', <another executive>, '2020-01-01');
--
-- That forges who made a decision and when, which is the whole point of the
-- columns. updated_by and updated_at were only ever right because the function
-- set them.
--
-- Fix: the function becomes SECURITY DEFINER (same body, same arguments, same
-- return type) and checks the caller itself, then the table loses INSERT and
-- UPDATE for signed-in users. SELECT stays: members read their own row and
-- executives read all of them, through the existing policies and through the
-- read functions that run as the caller. Nobody writes the table except this
-- function.
--
-- The caller checks are explicit in the function:
--   * a signed-in user (auth.uid() is not null),
--   * who is an active executive or admin (private.is_executive() reads the
--     profile as it is now: a deactivated executive, or one whose role was
--     changed, is refused on the next call).
-- As before, nothing else is accepted: the member must exist (foreign key),
-- the term key and the status are what the caller passes.
--
-- The three row policies for insert, update and delete stay as they are. They
-- do nothing today (no privilege to use them) and keep limiting a later grant
-- to executives.
--
-- Safe to run twice. Tests: 73_attendance_eligibility_definer.test.sql and the
-- grants matrix in 72_grants_matrix.test.sql.

create or replace function public.set_attendance_eligibility(
  p_term_key text,
  p_member_id uuid,
  p_status public.attendance_eligibility_status,
  p_reason text default null
)
returns public.attendance_eligibility
language plpgsql
security definer
set search_path = ''
as $$
declare result public.attendance_eligibility;
begin
  if auth.uid() is null or not private.is_executive() then
    raise exception 'executive permission required' using errcode = '42501';
  end if;
  insert into public.attendance_eligibility(term_key, member_id, status, reason, updated_by)
  values (trim(p_term_key), p_member_id, p_status, nullif(trim(p_reason), ''), auth.uid())
  on conflict (term_key, member_id) do update set
    status = excluded.status,
    reason = excluded.reason,
    updated_by = auth.uid(),
    updated_at = now()
  returning * into result;
  return result;
end;
$$;
revoke all on function public.set_attendance_eligibility(text, uuid, public.attendance_eligibility_status, text) from public, anon;
grant execute on function public.set_attendance_eligibility(text, uuid, public.attendance_eligibility_status, text) to authenticated;

comment on function public.set_attendance_eligibility(text, uuid, public.attendance_eligibility_status, text) is
  'Executives set a member''s eligibility for a term. SECURITY DEFINER: the only way to write attendance_eligibility, so updated_by and updated_at always come from the caller and the clock.';

-- Writes go through the function only. Keep SELECT (own row for a member, every
-- row for an executive; the policies decide which).
revoke insert, update, delete on table public.attendance_eligibility from public, anon, authenticated;
grant select on table public.attendance_eligibility to authenticated;
