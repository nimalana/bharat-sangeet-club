create index attendance_remediations_assigned_by_idx
  on public.attendance_remediations(assigned_by);
create index attendance_remediations_completed_by_idx
  on public.attendance_remediations(completed_by);
create index attendance_eligibility_updated_by_idx
  on public.attendance_eligibility(updated_by);
