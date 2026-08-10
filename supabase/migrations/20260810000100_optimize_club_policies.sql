create index archive_items_uploaded_by_idx on public.archive_items(uploaded_by);
create index transactions_created_by_idx on public.transactions(created_by);
create index events_created_by_idx on public.events(created_by);

drop policy "Executives manage archive" on public.archive_items;
create policy "Executives insert archive" on public.archive_items
for insert to authenticated with check (private.is_executive());
create policy "Executives update archive" on public.archive_items
for update to authenticated
using (private.is_executive()) with check (private.is_executive());
create policy "Executives delete archive" on public.archive_items
for delete to authenticated using (private.is_executive());

drop policy "Executives manage finances" on public.transactions;
create policy "Executives insert finances" on public.transactions
for insert to authenticated with check (private.is_executive());
create policy "Executives update finances" on public.transactions
for update to authenticated
using (private.is_executive()) with check (private.is_executive());
create policy "Executives delete finances" on public.transactions
for delete to authenticated using (private.is_executive());

drop policy "Executives manage events" on public.events;
create policy "Executives insert events" on public.events
for insert to authenticated with check (private.is_executive());
create policy "Executives update events" on public.events
for update to authenticated
using (private.is_executive()) with check (private.is_executive());
create policy "Executives delete events" on public.events
for delete to authenticated using (private.is_executive());
