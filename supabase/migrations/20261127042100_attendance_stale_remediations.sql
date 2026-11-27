-- core-3: a remediation stayed pending after the record that caused it stopped
-- counting.
--
-- private.sync_attendance_remediation only ever inserts. So when a member's
-- fourth normal tardy had earned a pending remediation and an executive then
-- voided one of the first three meetings, the re-rate in
-- void_attendance_session lowered that record to 0 units but the remediation
-- stayed pending, in the executives' follow-up list and on the member's own
-- page. Clearing a mark did not re-rate the member's other tardies at all, so
-- their units and remediations stayed too. The same happened when a mark was
-- changed from tardy or absent to present.
--
-- Two triggers on attendance_records fix this without redefining
-- void_attendance_session or clear_attendance_status:
--   1. After a record stops warranting a remediation (it was an absence, an
--      excused absence, or a tardy worth units, and now it is not), a pending
--      remediation for it is waived. Completed and already waived ones are
--      left alone, and so is a remediation an executive added by hand for a
--      record that never warranted one.
--   2. After a mark is deleted, the member's other normal tardies in the same
--      term and workspace are re-rated, lowering stale units. Tardies are
--      ranked by meeting date: from the fourth normal tardy of a term on, each
--      is worth one unit, as the policy reads. It only lowers units. Raising
--      them is left to the normal calculation when a mark is written, because
--      a mark can be entered out of date order.
-- A record "warrants" a remediation exactly when
-- private.sync_attendance_remediation would create one: status absent or
-- excused, or tardy with unexcused units above zero.
create or replace function private.waive_stale_attendance_remediation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.status in ('absent', 'excused') or (old.status = 'tardy' and old.unexcused_units > 0))
     and not (new.status in ('absent', 'excused') or (new.status = 'tardy' and new.unexcused_units > 0)) then
    update public.attendance_remediations
    set status = 'waived',
        note = trim(coalesce(note || ' ', '') || 'Waived automatically: the attendance record no longer counts.'),
        updated_at = now()
    where session_id = new.session_id and member_id = new.member_id and status = 'pending';
  end if;
  return null;
end;
$$;
revoke all on function private.waive_stale_attendance_remediation() from public, anon, authenticated;

drop trigger if exists waive_stale_attendance_remediation on public.attendance_records;
create trigger waive_stale_attendance_remediation
  after update on public.attendance_records
  for each row execute function private.waive_stale_attendance_remediation();

create or replace function private.relower_tardies_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  gone public.attendance_sessions;
begin
  -- Only a normal tardy (0 to 10 minutes late) counts towards the limit.
  if old.status <> 'tardy' or old.minutes_late not between 0 and 10 then
    return null;
  end if;
  select * into gone from public.attendance_sessions where id = old.session_id;
  if not found then
    return null;  -- the whole meeting is being deleted
  end if;

  update public.attendance_records target_record
  set unexcused_units = ranked.units
  from (
    select r.session_id, r.member_id,
           case when row_number() over (order by s.starts_at, s.id) > 3 then 1 else 0 end as units
    from public.attendance_records r
    join public.attendance_sessions s on s.id = r.session_id
    where r.member_id = old.member_id
      and r.status = 'tardy'
      and r.minutes_late between 0 and 10
      and s.status <> 'canceled'
      and s.scope = gone.scope
      and private.attendance_term_key(s.starts_at) = private.attendance_term_key(gone.starts_at)
  ) ranked
  where target_record.session_id = ranked.session_id
    and target_record.member_id = ranked.member_id
    and target_record.unexcused_units > ranked.units;
  return null;
end;
$$;
revoke all on function private.relower_tardies_after_delete() from public, anon, authenticated;

drop trigger if exists relower_tardies_after_delete on public.attendance_records;
create trigger relower_tardies_after_delete
  after delete on public.attendance_records
  for each row execute function private.relower_tardies_after_delete();
