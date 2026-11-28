#!/usr/bin/env bash
# What the membership gate (20261128010000 and 20261128010100) does to profiles that exist before
# it: nothing. Every member, executive, administrator and deactivated account keeps its status
# and its role, the club's first administrator included; only the sign-up that comes AFTER the
# migration is pending; and applying the two files a second time changes nothing.
#
# This cannot be a normal SQL test: those run on a database that already holds every migration,
# from empty, so no profile exists "from before". This script builds its own database in the same
# cluster, replays the migrations that come BEFORE the gate, seeds profiles of every kind through
# the signup trigger of that time, applies the two files and checks the rows. It lives next to the
# two-session tests only because db-replay.sh runs every supabase/tests/concurrency/*.sh.
#
#   scripts/db-replay.sh runs it after the SQL tests. By hand, against a cluster started with KEEP=1:
#
#     PGHOST=<socket dir> PGPORT=<port> PGUSER=postgres bash supabase/tests/concurrency/76_membership_gate_existing_rows.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
PART1="$MIGRATIONS/20261128010000_membership_gate_schema.sql"
PART2="$MIGRATIONS/20261128010100_membership_gate_signup_default.sql"
DBNAME="gate76_$$"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
PSQL=(psql -X -q -v ON_ERROR_STOP=1)
FAILED=0

admin() { "${PSQL[@]}" -d postgres "$@"; }
db() { "${PSQL[@]}" -d "$DBNAME" "$@"; }
cleanup() {
  admin -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$DBNAME'" >/dev/null 2>&1
  admin -c "drop database if exists $DBNAME" >/dev/null 2>&1
}
trap cleanup EXIT

check() { # check <label>, SQL on stdin: raises when a fact does not hold
  local label="$1" out
  if out="$(db 2>&1)"; then echo "  ok   $label"; else echo "  FAIL $label"; sed 's/^/       /' <<<"$out"; FAILED=1; fi
}

[ -f "$PART1" ] && [ -f "$PART2" ] || { echo "the membership gate migrations are missing"; exit 1; }

# ---------------------------------------------------------------------------
# A database with every migration before the gate.
# ---------------------------------------------------------------------------
admin -c "create database $DBNAME template template0" || { echo "could not create a database"; exit 1; }
ADMIN_MIGRATION="$MIGRATIONS/20260812000000_admin_console.sql"
BOOTSTRAP_EMAIL="$(grep -oE "lower\(email\) = '[^']+'" "$ADMIN_MIGRATION" | head -1 | sed -E "s/.*'([^']+)'/\1/")"
db -f "$ROOT/supabase/tests/shims.sql" || exit 1
bootstrapped=0
applied=0
for file in "$MIGRATIONS"/*.sql; do
  name="$(basename "$file")"
  [[ "$name" < "20261128010000" ]] || break
  if [ "$bootstrapped" = "0" ] && [[ "$name" > "20260811" ]]; then
    PGOPTIONS="$PGOPTIONS -c replay.bootstrap_email=$BOOTSTRAP_EMAIL" db -f "$ROOT/supabase/tests/bootstrap.sql" || exit 1
    bootstrapped=1
  fi
  db -f "$file" >/dev/null || { echo "FAILED applying $name"; exit 1; }
  applied=$((applied + 1))
done
echo "  replayed $applied migrations before the gate"

# ---------------------------------------------------------------------------
# Profiles as the portal has them today: members, executives, administrators, a deactivated one.
# Every one of them was created by the old signup trigger, so every one of them is active.
# ---------------------------------------------------------------------------
db >/dev/null <<'SQL'
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000b1', 'member.before@test.invalid',     '{"full_name":"Member Before"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'executive.before@test.invalid',  '{"full_name":"Executive Before"}'),
  ('00000000-0000-0000-0000-0000000000b3', 'admin.before@test.invalid',      '{"full_name":"Admin Before"}'),
  ('00000000-0000-0000-0000-0000000000b4', 'deactivated.before@test.invalid','{"full_name":"Deactivated Before"}'),
  ('00000000-0000-0000-0000-0000000000b5', 'noname.before@test.invalid',     '{}');
update public.profiles set role = 'executive' where email = 'executive.before@test.invalid';
update public.profiles set role = 'admin' where email = 'admin.before@test.invalid';
update public.profiles set status = 'deactivated' where email = 'deactivated.before@test.invalid';
create table public.zz_before as select id, email, role::text as role, status from public.profiles;
SQL
check "before the gate: every profile is active or deactivated, the bootstrap administrator is an administrator" <<SQL
do \$\$ begin
  assert (select count(*) from public.zz_before) = 6, 'six profiles';
  assert (select count(*) from public.zz_before where status = 'active') = 5 and (select count(*) from public.zz_before where status = 'deactivated') = 1;
  assert (select role from public.zz_before where lower(email) = '$BOOTSTRAP_EMAIL') = 'admin', 'the bootstrap administrator';
end \$\$;
SQL

# ---------------------------------------------------------------------------
# Part 1 (the schema): nothing observable changes, there is nobody pending yet.
# ---------------------------------------------------------------------------
db -f "$PART1" >/dev/null || { echo "FAILED applying part 1 on the seeded database"; exit 1; }
check "part 1: no profile changed; a profile can be pending only as a plain member" <<'SQL'
do $$ begin
  assert (select count(*) from public.profiles p join public.zz_before b on b.id = p.id
          where p.status is distinct from b.status or p.role::text is distinct from b.role) = 0, 'a profile changed';
  assert (select count(*) from public.profiles) = 6, 'no profile was added or removed';
  assert (select count(*) from public.profiles where status in ('pending', 'rejected')) = 0, 'nobody is pending yet';
end $$;
SQL
db >/dev/null <<'SQL'
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000b6', 'between.parts@test.invalid', '{"full_name":"Between Parts"}');
SQL
check "between the two files a new sign-up is still active: the deployed frontend sees no difference" <<'SQL'
do $$ begin
  assert (select status from public.profiles where email = 'between.parts@test.invalid') = 'active';
end $$;
SQL

# ---------------------------------------------------------------------------
# Part 2 (the sign-up default), then both files again.
# ---------------------------------------------------------------------------
db -f "$PART2" >/dev/null || { echo "FAILED applying part 2 on the seeded database"; exit 1; }
db >/dev/null <<SQL
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'new.signup@test.invalid', '{"full_name":"New Signup"}'),
  ('00000000-0000-0000-0000-0000000000c2', 'new.nameless@test.invalid', '{}');
SQL
check "part 2: everyone who existed keeps their status and role; a new sign-up is pending" <<'SQL'
do $$ begin
  assert (select count(*) from public.profiles p join public.zz_before b on b.id = p.id
          where p.status is distinct from b.status or p.role::text is distinct from b.role) = 0, 'a profile changed';
  assert (select status from public.profiles where email = 'new.signup@test.invalid') = 'pending', 'a new sign-up is pending';
  assert (select role::text from public.profiles where email = 'new.signup@test.invalid') = 'member';
  assert (select status from public.profiles where email = 'new.nameless@test.invalid') = 'pending', 'also without a name';
  assert (select status from public.profiles where email = 'between.parts@test.invalid') = 'active', 'the one made between the files stays active';
end $$;
SQL
check "a profile that existed can still be an executive or administrator and cannot be made pending" <<'SQL'
do $$
declare message text;
begin
  assert (select count(*) from public.profiles where role in ('executive', 'admin') and status = 'active') >= 3;
  begin
    update public.profiles set status = 'pending' where email = 'executive.before@test.invalid';
    assert false, 'an executive was made pending';
  exception when check_violation then null;
  end;
  begin
    update public.profiles set status = 'pending' where lower(email) = (select lower(email) from public.zz_before where role = 'admin' order by email limit 1);
    assert false, 'an administrator was made pending';
  exception when check_violation then null;
  end;
end $$;
SQL
check "the club's first administrator signs up active even if the account is created again" <<SQL
do \$\$ declare v uuid; begin
  delete from auth.users where lower(email) = '$BOOTSTRAP_EMAIL';
  insert into auth.users (email, raw_user_meta_data) values ('$BOOTSTRAP_EMAIL', '{}') returning id into v;
  assert (select status from public.profiles where id = v) = 'active', 'created again: active';
end \$\$;
SQL

db -f "$PART1" >/dev/null && db -f "$PART2" >/dev/null && db -f "$PART1" >/dev/null || { echo "FAILED applying the two files again"; exit 1; }
check "applying both files again changes no profile and leaves one of each guard" <<'SQL'
do $$ begin
  assert (select count(*) from public.profiles p join public.zz_before b on b.id = p.id
          where p.status is distinct from b.status or p.role::text is distinct from b.role) = 0, 'a profile changed';
  assert (select status from public.profiles where email = 'new.signup@test.invalid') = 'pending', 'still pending';
  assert (select count(*) from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname in ('guard_profile_status', 'block_deactivated_writer')) = 2;
  assert (select count(*) from pg_policies where tablename = 'signup_reviews') = 2;
end $$;
SQL

exit $FAILED
