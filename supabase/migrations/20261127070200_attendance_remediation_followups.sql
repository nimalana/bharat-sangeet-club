-- Round 2 of core-3 (20261127042100): two regressions in how stale remediations
-- were handled.
--
-- 1. A waived remediation was never reopened. private.sync_attendance_remediation
--    only inserts "on conflict do nothing", so once the first-round trigger had
--    waived a pending remediation (a tardy worth a unit mis-marked present), a
--    correction back to absent, excused, or a tardy that counts found the waived
--    row and left it. The follow-up for a real absence was silently lost. Now a
--    remediation that the portal waived by itself (its note ends with the
--    automatic wording and nobody completed or waived it by hand) goes back to
--    pending when the record warrants one again. One an executive waived or
--    completed, and one waived because the meeting was voided, stay as they are.
--
-- 2. After a mark was cleared, the re-rate only ever lowered units and ranked the
--    tardies by meeting date, while the units already stored follow the order the
--    marks were entered (each normal tardy is worth a unit if three others exist).
--    With marks entered out of date order that lowered the wrong records and
--    never raised the right ones: six normal tardies entered as meetings 5,4,3,2,1,6
--    carry units on 1, 2 and 6; clearing 6 left five tardies that should total 2
--    units, and the re-rate took them to 0. The re-rate now sets each remaining
--    normal tardy of the term and workspace to what its date rank says (from the
--    fourth on, one unit), in both directions. The total is always the number of
--    normal tardies beyond the third; only which records carry it can change.
--    Remediations follow the records: one is waived where a record drops to 0
--    (20261127042100) and created, or reopened, where a record rises to 1.
--    A remediation already completed for a record is not undone.
--    void_attendance_session has its own re-rate (every remaining tardy of the
--    member is recalculated by the entry-order rule); it is not changed here.

create or replace function private.reopen_waived_attendance_remediation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('absent', 'excused') or (new.status = 'tardy' and new.unexcused_units > 0) then
    update public.attendance_remediations
    set status = 'pending',
        note = nullif(trim(regexp_replace(note, '\s*Waived automatically: the attendance record no longer counts\.$', '')), ''),
        updated_at = now()
    where session_id = new.session_id
      and member_id = new.member_id
      and status = 'waived'
      and completed_at is null
      and note like '%Waived automatically: the attendance record no longer counts.';
  end if;
  return null;
end;
$$;
revoke all on function private.reopen_waived_attendance_remediation() from public, anon, authenticated;

drop trigger if exists reopen_waived_attendance_remediation on public.attendance_records;
create trigger reopen_waived_attendance_remediation
  after insert or update of status, unexcused_units on public.attendance_records
  for each row execute function private.reopen_waived_attendance_remediation();

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
    and target_record.unexcused_units is distinct from ranked.units;
  return null;
end;
$$;
revoke all on function private.relower_tardies_after_delete() from public, anon, authenticated;

comment on function private.relower_tardies_after_delete() is
  'After a normal tardy is cleared, re-rates the member''s other normal tardies of the term and workspace by meeting date: from the fourth on, one unit each, raising or lowering as needed.';
