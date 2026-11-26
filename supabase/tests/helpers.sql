-- Helpers for the SQL tests. Loaded once by scripts/db-replay.sh.
create schema test;
grant usage on schema test to anon, authenticated;

-- Creates an auth user (the signup trigger creates the profile) and sets its
-- club role. Returns the new id.
create function test.make_user(p_name text, p_role public.club_role default 'member')
returns uuid language plpgsql as $$
declare new_id uuid;
begin
  insert into auth.users (email, raw_user_meta_data)
  values (lower(replace(p_name, ' ', '.')) || '@test.invalid', jsonb_build_object('full_name', p_name))
  returning id into new_id;
  update public.profiles set role = p_role where id = new_id;
  return new_id;
end $$;

-- Act as a signed-in user (or as an anonymous visitor when p_user is null)
-- until test.logout() is called.
create function test.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  if p_user is null then execute 'set local role anon'; else execute 'set local role authenticated'; end if;
end $$;
create function test.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- Runs a statement that is expected to fail and returns the error message, or
-- null if it unexpectedly succeeded.
create function test.error_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- Runs a query that returns one bigint (usually a count) as the given user.
create function test.count_as(p_user uuid, p_sql text) returns bigint language plpgsql as $$
declare result bigint;
begin
  perform test.login(p_user);
  begin
    execute p_sql into result;
  exception when insufficient_privilege then
    result := -1;  -- no table privilege at all
  end;
  perform test.logout();
  return result;
end $$;

-- Runs a statement as the given user and returns its error message, or null.
create function test.error_as(p_user uuid, p_sql text) returns text language plpgsql as $$
declare message text;
begin
  perform test.login(p_user);
  message := test.error_of(p_sql);
  perform test.logout();
  return message;
end $$;

grant execute on all functions in schema test to anon, authenticated;
