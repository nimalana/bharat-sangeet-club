-- Eligibility writes are protected by RLS, so the RPC can run as the caller
-- instead of bypassing table policies.

grant insert, update, delete on public.attendance_eligibility to authenticated;

create or replace function public.set_attendance_eligibility(
  p_term_key text,
  p_member_id uuid,
  p_status public.attendance_eligibility_status,
  p_reason text default null
)
returns public.attendance_eligibility language plpgsql security invoker set search_path = '' as $$
declare result public.attendance_eligibility;
begin
  if not private.is_executive() then raise exception 'executive permission required' using errcode = '42501'; end if;
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

create index if not exists attendance_excuses_member_idx
  on public.attendance_excuses(member_id, submitted_at desc);
create index if not exists attendance_excuses_reviewed_by_idx
  on public.attendance_excuses(reviewed_by);
