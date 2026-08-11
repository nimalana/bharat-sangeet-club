alter table public.profiles
  add column if not exists phone text not null default '',
  add column if not exists class_year text not null default '',
  add column if not exists specialty text not null default '';

grant update (phone, class_year, specialty) on public.profiles to authenticated;

drop policy if exists "Users view own profile and executives view all" on public.profiles;
create policy "Signed-in members view directory"
on public.profiles for select to authenticated
using (true);
