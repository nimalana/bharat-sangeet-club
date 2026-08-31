-- Keep one SELECT policy per policy-owned table so the Data API does not
-- evaluate duplicate permissive SELECT policies.

drop policy if exists "Executives manage attendance remediation" on public.attendance_remediations;
create policy "Executives insert attendance remediation"
  on public.attendance_remediations for insert to authenticated
  with check (private.is_executive());
create policy "Executives update attendance remediation"
  on public.attendance_remediations for update to authenticated
  using (private.is_executive()) with check (private.is_executive());
create policy "Executives delete attendance remediation"
  on public.attendance_remediations for delete to authenticated
  using (private.is_executive());

drop policy if exists "Executives manage attendance eligibility" on public.attendance_eligibility;
create policy "Executives insert attendance eligibility"
  on public.attendance_eligibility for insert to authenticated
  with check (private.is_executive());
create policy "Executives update attendance eligibility"
  on public.attendance_eligibility for update to authenticated
  using (private.is_executive()) with check (private.is_executive());
create policy "Executives delete attendance eligibility"
  on public.attendance_eligibility for delete to authenticated
  using (private.is_executive());
