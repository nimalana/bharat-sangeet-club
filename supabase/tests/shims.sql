-- Minimal stand-ins for the parts of hosted Supabase that the migrations
-- reference, so the migration chain can be replayed on plain PostgreSQL.
-- Used only by scripts/db-replay.sh. Never applied to a real project.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

-- Hosted Supabase gives the roles below default privileges on everything the
-- postgres role creates in the public schema: every privilege on new tables
-- (including TRUNCATE and MAINTAIN), every privilege on new sequences, and
-- EXECUTE on new functions. A real test project showed all three. Without
-- these lines this harness is stricter than the hosted database, so a
-- migration that forgets "revoke ... from anon" would pass here and be open
-- there. Migration 20261127075000 (least privilege) removes the table and
-- sequence defaults for anon and authenticated again, as it does on the hosted
-- project, so migrations before it see the hosted defaults and migrations after
-- it see none; the function defaults stay. 70_default_privileges.test.sql
-- checks the state after all migrations.
-- Only the public schema has defaults on hosted Supabase; private does not.
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to anon, authenticated, service_role;

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists storage;
grant usage on schema public, extensions, auth, storage to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  banned_until timestamptz,
  created_at timestamptz not null default now()
);
create table auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Tests choose the caller with: select set_config('request.jwt.claim.sub', '<uuid>', true);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  owner_id text,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
$$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
