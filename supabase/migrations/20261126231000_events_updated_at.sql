-- Events can now be edited, so record when.
alter table public.events
  add column if not exists updated_at timestamptz not null default now();

create or replace function private.touch_event_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function private.touch_event_updated_at() from public;

drop trigger if exists set_event_updated_at on public.events;
create trigger set_event_updated_at
before update on public.events
for each row execute procedure private.touch_event_updated_at();
