create type public.club_role as enum ('member', 'executive');
create type public.archive_type as enum ('recording', 'document', 'photo');
create type public.archive_visibility as enum ('members', 'executives');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null default '',
  role public.club_role not null default 'member',
  joined_at timestamptz not null default now()
);

create table public.archive_items (
  id bigint generated always as identity primary key,
  title text not null,
  description text not null default '',
  type public.archive_type not null,
  storage_path text not null unique,
  visibility public.archive_visibility not null default 'members',
  event_date date,
  raga text,
  tala text,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.transactions (
  id bigint generated always as identity primary key,
  description text not null,
  amount numeric(12,2) not null check (amount <> 0),
  category text not null,
  transaction_date date not null default current_date,
  receipt_path text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.events (
  id bigint generated always as identity primary key,
  title text not null,
  description text not null default '',
  starts_at timestamptz not null,
  location text not null default '',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index archive_items_type_created_idx on public.archive_items(type, created_at desc);
create index transactions_date_idx on public.transactions(transaction_date desc);
create index events_starts_at_idx on public.events(starts_at);

alter table public.profiles enable row level security;
alter table public.archive_items enable row level security;
alter table public.transactions enable row level security;
alter table public.events enable row level security;

create function public.is_executive()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'executive'
  );
$$;

create policy "Members can view profiles" on public.profiles
for select to authenticated using (true);
create policy "Users can update their profile" on public.profiles
for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "Members can view shared archive" on public.archive_items
for select to authenticated using (visibility = 'members' or public.is_executive());
create policy "Executives manage archive" on public.archive_items
for all to authenticated using (public.is_executive()) with check (public.is_executive());

create policy "Executives view finances" on public.transactions
for select to authenticated using (public.is_executive());
create policy "Executives manage finances" on public.transactions
for all to authenticated using (public.is_executive()) with check (public.is_executive());

create policy "Members view events" on public.events
for select to authenticated using (true);
create policy "Executives manage events" on public.events
for all to authenticated using (public.is_executive()) with check (public.is_executive());

insert into storage.buckets (id, name, public)
values ('club-archive', 'club-archive', false)
on conflict (id) do nothing;

create policy "Members read shared files" on storage.objects
for select to authenticated using (
  bucket_id = 'club-archive' and
  exists (
    select 1 from public.archive_items
    where storage_path = name
      and (visibility = 'members' or public.is_executive())
  )
);

create policy "Executives upload archive files" on storage.objects
for insert to authenticated with check (
  bucket_id = 'club-archive' and public.is_executive()
);
create policy "Executives update archive files" on storage.objects
for update to authenticated using (
  bucket_id = 'club-archive' and public.is_executive()
);
create policy "Executives delete archive files" on storage.objects
for delete to authenticated using (
  bucket_id = 'club-archive' and public.is_executive()
);

create function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();
