#!/usr/bin/env bash
# Two-session tests for register_finance_document (Phase 4.2, P0-05) and for the claim lock in the link
# trigger (P2-05, 20261128020300).
#
# The single-session SQL tests cannot show a race, because every test file runs in one transaction. This
# script needs committed data and two connections, so it works on a private clone of the replayed database
# and drops it afterwards. scripts/db-replay.sh runs it after the SQL tests. By hand, against a cluster
# started with KEEP=1:
#
#     PGHOST=<socket dir> PGPORT=<port> PGUSER=postgres bash supabase/tests/concurrency/81_finance_register.sh
#
# Two kinds of check, as in 80_finance_locks.sh:
#   * Interleaving. Session A does its work and keeps its locks. Session B starts, and the script waits
#     until B is blocked on a lock before it lets A commit. The result must be the one a serial run gives.
#   * Deadlocks. Two functions that touch the same rows are released together while a sleep trigger (this
#     clone only) holds each open between its statements. Nothing may fail with 40P01.
set -uo pipefail

DBNAME="conc81_$$"
TMP="$(mktemp -d)"
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
FAILED=0
PIDS=()

admin() { "${PSQL[@]}" -d postgres "$@"; }
q() { "${PSQL[@]}" -d "$DBNAME" -c "$1"; }

cleanup() {
  local pid
  for pid in "${PIDS[@]:-}"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null; done
  admin -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$DBNAME'" >/dev/null 2>&1
  admin -c "drop database if exists $DBNAME" >/dev/null 2>&1
  rm -rf "$TMP"
}
trap cleanup EXIT

expect() { # expect <label> <wanted> <got>
  if [ "$2" = "$3" ]; then echo "  ok   $1"; else echo "  FAIL $1: wanted [$2], got [$3]"; FAILED=1; fi
}
expect_match() { # expect_match <label> <pattern> <text>
  if grep -qE "$2" <<<"$3"; then echo "  ok   $1"; else echo "  FAIL $1: /$2/ not found in:"; sed 's/^/       /' <<<"$3"; FAILED=1; fi
}
expect_not_match() { # expect_not_match <label> <pattern> <text>
  if grep -qE "$2" <<<"$3"; then echo "  FAIL $1: found /$2/ in:"; sed 's/^/       /' <<<"$3"; FAILED=1; else echo "  ok   $1"; fi
}

# ---------------------------------------------------------------------------
# A private copy of the replayed database, plus helpers and a sleep trigger.
# ---------------------------------------------------------------------------
admin -c "create database $DBNAME template postgres" || { echo "could not clone the database (is another session connected to the postgres database?)"; exit 1; }
q "alter database $DBNAME set deadlock_timeout = '300ms'" >/dev/null

"${PSQL[@]}" -d "$DBNAME" >/dev/null <<'SQL'
create schema conc;
grant usage on schema conc to authenticated;

-- The sleep only applies in sessions that set conc.sleep, so setup is not slowed.
create function conc.sleep() returns trigger language plpgsql as $$
begin
  perform pg_sleep(coalesce(nullif(current_setting('conc.sleep', true), ''), '0')::numeric);
  return null;
end $$;
create trigger conc_sleep before update on public.finance_expenses for each statement execute function conc.sleep();
create trigger conc_sleep before update on public.personal_reimbursements for each statement execute function conc.sleep();
create trigger conc_sleep before update on public.finance_payments for each statement execute function conc.sleep();
create trigger conc_sleep before update on public.funding_claims for each statement execute function conc.sleep();
-- The registration writes rows, it does not update any: hold it open after its locks, before its insert.
create trigger conc_sleep before insert on public.finance_documents for each statement execute function conc.sleep();

create function conc.club_expense(p_exec uuid, p_amount numeric default 300) returns bigint language plpgsql as $$
declare v bigint;
begin
  perform test.login(p_exec);
  v := public.record_club_expense('Race expense', 'Shop', p_amount, current_date, 'Supplies', 'Club bank account', '4242');
  perform test.logout();
  return v;
end $$;

-- A member request, optionally approved. Returns "expense,reimbursement".
create function conc.member_request(p_member uuid, p_exec uuid default null, p_amount numeric default 100) returns text language plpgsql as $$
declare e bigint; r bigint;
begin
  perform test.login(p_member);
  select expense_id, reimbursement_id into e, r from public.submit_member_reimbursement('Race purchase', 'Shop', p_amount, current_date, 'Supplies', '1111');
  perform test.logout();
  if p_exec is not null then
    perform test.login(p_exec);
    perform public.review_personal_reimbursement(r, 'approved', p_amount);
    perform test.logout();
  end if;
  return e || ',' || r;
end $$;

create function conc.claim(p_exec uuid, p_expenses bigint[]) returns bigint language plpgsql as $$
declare v bigint;
begin
  perform test.login(p_exec);
  select id into v from public.create_funding_claim('Race claim', 'GPSG Senate', '', '', null, '', p_expenses);
  perform test.logout();
  return v;
end $$;

-- A stored object in <folder>/<name> (what Storage would hold after the upload). Returns the path.
create function conc.mkobj(p_folder uuid, p_name text) returns text language plpgsql as $$
declare v_path text := p_folder::text || '/' || p_name;
begin
  insert into storage.objects (bucket_id, name, owner_id) values ('finance-private', v_path, p_folder::text);
  return v_path;
end $$;
SQL

EXEC1="$(q "select test.make_user('Conc81 Exec One', 'executive')")"
EXEC2="$(q "select test.make_user('Conc81 Exec Two', 'executive')")"
MEMBER="$(q "select test.make_user('Conc81 Member')")"
newpath() { q "select conc.mkobj('$1', 'race-' || gen_random_uuid() || '.pdf')"; }
reg() { # reg <path> <type> <expense|null> <reimbursement|null> <claim|null>
  echo "select public.register_finance_document('$1', '$2', 'Race doc', 'application/pdf', 100, null, $3, $4, $5)"
}

# ---------------------------------------------------------------------------
# Session helpers (the same as 80_finance_locks.sh, with the login given per session)
# ---------------------------------------------------------------------------
start_session() { # start_session <name> <sql>
  printf '%s\n' "$2" >"$TMP/$1.sql"
  PGAPPNAME="$1" "${PSQL[@]}" -v ON_ERROR_STOP=0 -d "$DBNAME" -f "$TMP/$1.sql" >"$TMP/$1.out" 2>&1 &
  PIDS+=("$!")
  LAST_PID=$!
}
wait_blocked() { # wait_blocked <name> [tenths of a second]
  local i
  for ((i = 0; i < ${2:-100}; i++)); do
    [ "$(admin -c "select count(*) from pg_stat_activity where application_name = '$1' and wait_event_type = 'Lock'")" != "0" ] && return 0
    sleep 0.1
  done
  return 1
}
wait_for_text() { # wait_for_text <name> <text> [tenths of a second]
  local i
  for ((i = 0; i < ${3:-100}; i++)); do
    grep -q "$2" "$TMP/$1.out" 2>/dev/null && return 0
    sleep 0.1
  done
  return 1
}

# interleave <label> <login_a> <sql_a> <login_b> <sql_b>
#   A runs, prints A_HOLDING and keeps its locks until B is blocked (or 8 s pass). Then A commits.
#   A login is a user id, or "" to stay the table owner (what a direct write would be).
#   B_BLOCKED is 1 when B was seen waiting on a lock. A_OUT and B_OUT hold what each session printed.
login_sql() { if [ -n "$1" ]; then echo "select test.login('$1');"; fi; }
interleave() {
  local label="$1" login_a="$2" sql_a="$3" login_b="$4" sql_b="$5"
  B_BLOCKED=0; A_OUT=''; B_OUT=''
  start_session conc_a "begin;
$(login_sql "$login_a")
$sql_a;
select 'A_HOLDING';
do \$\$
declare i int := 0;
begin
  while i < 80 and not exists (select 1 from pg_stat_activity where application_name = 'conc_b' and wait_event_type = 'Lock') loop
    perform pg_sleep(0.1);
    i := i + 1;
  end loop;
end
\$\$;
commit;"
  local pid_a=$LAST_PID
  wait_for_text conc_a A_HOLDING 100 || { echo "  FAIL $label: session A never reached its lock point"; cat "$TMP/conc_a.out"; FAILED=1; return; }
  start_session conc_b "begin;
$(login_sql "$login_b")
$sql_b;
select 'B_OK';
commit;"
  local pid_b=$LAST_PID
  wait_blocked conc_b 60 && B_BLOCKED=1
  wait "$pid_a" "$pid_b" 2>/dev/null
  A_OUT="$(cat "$TMP/conc_a.out")"
  B_OUT="$(cat "$TMP/conc_b.out")"
}

# Releases two sessions at the same instant, each held open by the sleep trigger between its statements.
SLEEP_SECONDS="0.25"
race() { # race <login_a> <sql_a> <login_b> <sql_b>   -> RACE_A, RACE_B
  local holder_pid
  start_session conc_hold "select pg_advisory_lock(77);
select pg_sleep(60);"
  holder_pid=$LAST_PID
  local i
  for ((i = 0; i < 50; i++)); do
    [ "$(admin -c "select count(*) from pg_locks where locktype = 'advisory' and objid = 77 and granted")" != "0" ] && break
    sleep 0.1
  done
  start_session conc_a "select pg_advisory_lock_shared(77);
begin;
select test.login('$1');
set local conc.sleep = '$SLEEP_SECONDS';
$2;
select 'RESULT_OK';
commit;"
  local pid_a=$LAST_PID
  start_session conc_b "select pg_advisory_lock_shared(77);
begin;
select test.login('$3');
set local conc.sleep = '$SLEEP_SECONDS';
$4;
select 'RESULT_OK';
commit;"
  local pid_b=$LAST_PID
  for ((i = 0; i < 100; i++)); do
    [ "$(admin -c "select count(*) from pg_stat_activity where application_name in ('conc_a','conc_b') and wait_event = 'advisory'")" = "2" ] && break
    sleep 0.1
  done
  admin -c "select pg_terminate_backend(pid) from pg_locks where locktype = 'advisory' and objid = 77 and granted and mode = 'ExclusiveLock'" >/dev/null
  wait "$pid_a" "$pid_b" "$holder_pid" 2>/dev/null
  RACE_A="$(cat "$TMP/conc_a.out")"
  RACE_B="$(cat "$TMP/conc_b.out")"
}

docs_at() { q "select count(*) from public.finance_documents where storage_path = '$1'"; }

# ---------------------------------------------------------------------------
# The same file registered twice at once (a double click, a retry that overlaps the first try)
# ---------------------------------------------------------------------------
echo "register: the same path, the same request, in two sessions"
IFS=, read -r E R <<<"$(q "select conc.member_request('$MEMBER')")"
P="$(newpath "$MEMBER")"
interleave "same/same" "$MEMBER" "$(reg "$P" receipt "$E" "$R" null)" "$MEMBER" "$(reg "$P" receipt "$E" "$R" null)"
expect "B waited for A" "1" "$B_BLOCKED"
expect "one document" "1" "$(docs_at "$P")"
expect "one link to the purchase and one to the request" "1,1" "$(q "select (select count(*) from public.finance_expense_documents where expense_id = $E) || ',' || (select count(*) from public.finance_reimbursement_documents where reimbursement_id = $R)")"
expect "one audit row" "1" "$(q "select count(*) from public.finance_audit_log a join public.finance_documents d on d.id = a.entity_id where a.entity_type = 'finance_documents' and d.storage_path = '$P'")"
expect_match "A succeeded" "A_HOLDING" "$A_OUT"
expect_match "B was refused in words" "This file has already been registered as a finance document" "$B_OUT"
expect_not_match "B did not finish" "B_OK" "$B_OUT"
expect_not_match "and no raw database error reached the caller" "duplicate key|violates" "$B_OUT"

echo "register: the same path against two different requests (only the unique index can stop the second)"
IFS=, read -r E1 R1 <<<"$(q "select conc.member_request('$MEMBER')")"
IFS=, read -r E2 R2 <<<"$(q "select conc.member_request('$MEMBER')")"
P="$(newpath "$MEMBER")"
interleave "same path, two targets" "$MEMBER" "$(reg "$P" receipt "$E1" "$R1" null)" "$MEMBER" "$(reg "$P" receipt "$E2" "$R2" null)"
expect "B waited for A's row" "1" "$B_BLOCKED"
expect "one document" "1" "$(docs_at "$P")"
expect "linked to the first request only" "$R1" "$(q "select string_agg(reimbursement_id::text, ',') from public.finance_reimbursement_documents l join public.finance_documents d on d.id = l.document_id where d.storage_path = '$P'")"
expect "the second request has no document" "0" "$(q "select count(*) from public.finance_reimbursement_documents where reimbursement_id = $R2")"
expect_match "B was refused in words" "This file has already been registered as a finance document" "$B_OUT"
expect_not_match "and no raw database error reached the caller" "duplicate key|violates" "$B_OUT"

# ---------------------------------------------------------------------------
# A document cannot be registered on a target that is being closed
# ---------------------------------------------------------------------------
echo "register: while the member withdraws the request"
IFS=, read -r E R <<<"$(q "select conc.member_request('$MEMBER')")"
P="$(newpath "$MEMBER")"
interleave "withdraw/register" "$MEMBER" "select public.withdraw_member_reimbursement($R)" "$MEMBER" "$(reg "$P" receipt "$E" "$R" null)"
expect "B waited for the withdrawal" "1" "$B_BLOCKED"
expect "nothing was registered" "0" "$(docs_at "$P")"
expect "the request is voided and has no document" "voided,0" "$(q "select (select status from public.finance_expenses where id = $E) || ',' || (select count(*) from public.finance_reimbursement_documents where reimbursement_id = $R)")"
expect_match "B was refused in words" "documents can no longer be added" "$B_OUT"

echo "register: while an executive reviews the request"
IFS=, read -r E R <<<"$(q "select conc.member_request('$MEMBER')")"
P="$(newpath "$MEMBER")"
interleave "approve/register" "$EXEC1" "select public.review_personal_reimbursement($R, 'approved', 100, 'ok')" "$MEMBER" "$(reg "$P" receipt "$E" "$R" null)"
expect "B waited for the decision" "1" "$B_BLOCKED"
expect "nothing was registered" "0" "$(docs_at "$P")"
expect_match "B was refused in words" "has already been decided" "$B_OUT"

echo "register: while an executive voids the purchase"
E="$(q "select conc.club_expense('$EXEC1', 80)")"
P="$(newpath "$EXEC2")"
interleave "void/register" "$EXEC1" "select public.void_finance_expense($E, 'race test void')" "$EXEC2" "$(reg "$P" receipt "$E" null null)"
expect "B waited for the void" "1" "$B_BLOCKED"
expect "nothing was registered" "0" "$(docs_at "$P")"
expect_match "B was refused in words" "has been voided" "$B_OUT"

echo "register: the other way round, the document first and then the void"
E="$(q "select conc.club_expense('$EXEC1', 80)")"
P="$(newpath "$EXEC2")"
interleave "register/void" "$EXEC2" "$(reg "$P" receipt "$E" null null)" "$EXEC1" "select public.void_finance_expense($E, 'race test void')"
expect "the void waited for the registration" "1" "$B_BLOCKED"
expect "the document is there and linked (serial order: register, then void)" "1,1" "$(docs_at "$P"),$(q "select count(*) from public.finance_expense_documents where expense_id = $E")"
expect "the purchase is voided" "voided" "$(q "select status from public.finance_expenses where id = $E")"

echo "register: a statement for a claim while the claim is being submitted"
CE="$(q "select conc.club_expense('$EXEC1', 120)")"
CL="$(q "select conc.claim('$EXEC1', array[$CE]::bigint[])")"
# The paper a claim needs to be submitted, as the table owner (the direct writes are closed to everyone else).
"${PSQL[@]}" -d "$DBNAME" >/dev/null <<SQL
insert into public.finance_documents (document_type, title, storage_path, mime_type, file_size_bytes, uploaded_by) values
  ('receipt', 'R', 'seed81/r-$CL.pdf', 'application/pdf', 10, '$EXEC1'),
  ('bank_statement', 'S', 'seed81/s-$CL.pdf', 'application/pdf', 10, '$EXEC1'),
  ('funding_approval', 'A', 'seed81/a-$CL.pdf', 'application/pdf', 10, '$EXEC1');
insert into public.finance_expense_documents (expense_id, document_id) select $CE, id from public.finance_documents where storage_path = 'seed81/r-$CL.pdf';
insert into public.finance_claim_documents (claim_id, document_id) select $CL, id from public.finance_documents where storage_path in ('seed81/s-$CL.pdf', 'seed81/a-$CL.pdf');
SQL
"${PSQL[@]}" -d "$DBNAME" -c "begin; select test.login('$EXEC1'); select public.set_funding_claim_status($CL, 'ready'); commit;" >/dev/null || { echo "  FAIL could not make the claim ready"; FAILED=1; }
P="$(newpath "$EXEC2")"
interleave "submit/register" "$EXEC1" "select public.set_funding_claim_status($CL, 'submitted')" "$EXEC2" "$(reg "$P" bank_statement null null "$CL")"
expect "B waited for the submission" "1" "$B_BLOCKED"
expect "the claim is submitted" "submitted" "$(q "select status from public.funding_claims where id = $CL")"
expect "no statement was added behind the funder's back" "0" "$(docs_at "$P")"
expect_match "B was refused in words" "with the funder, so its documents are locked" "$B_OUT"
P="$(newpath "$EXEC2")"
"${PSQL[@]}" -d "$DBNAME" -c "begin; select test.login('$EXEC2'); $(reg "$P" heellife_submission null null "$CL"); commit;" >/dev/null && echo "  ok   the HeelLife submission can still be added after submitting" || { echo "  FAIL the HeelLife submission was refused after submitting"; FAILED=1; }

# ---------------------------------------------------------------------------
# P2-05: the link trigger locks the claim (expense first, claim second)
# ---------------------------------------------------------------------------
echo "claim lock: two direct links to two different expenses of one claim (the table owner, as the functions' own inserts are)"
E0="$(q "select conc.club_expense('$EXEC1', 100)")"; EA="$(q "select conc.club_expense('$EXEC1', 60)")"; EB="$(q "select conc.club_expense('$EXEC1', 60)")"
CL="$(q "select conc.claim('$EXEC1', array[$E0]::bigint[])")"
q "update public.funding_claims set requested_amount = 150 where id = $CL" >/dev/null   # 100 allocated, room for 50
interleave "link/link" "" "insert into public.funding_claim_expenses (claim_id, expense_id, claimed_amount) values ($CL, $EA, 40)" "" \
  "insert into public.funding_claim_expenses (claim_id, expense_id, claimed_amount) values ($CL, $EB, 40)"
expect "B waited for A's claim lock" "1" "$B_BLOCKED"
expect "the claim is not allocated above its total (one 40.00 link fits, two do not)" "140.00" "$(q "select sum(claimed_amount) from public.funding_claim_expenses where claim_id = $CL")"
expect_match "B was refused in words" "claim expenses cannot exceed the requested amount" "$B_OUT"

# ---------------------------------------------------------------------------
# One lock order, so no deadlocks
# ---------------------------------------------------------------------------
check_race() { # check_race <label>
  echo "  $1"
  local combined="$RACE_A
$RACE_B"
  expect_not_match "no deadlock" "deadlock detected|40P01" "$combined"
  local ok; ok="$(grep -c RESULT_OK <<<"$combined")"
  [ "$ok" -ge 1 ] && echo "  ok   at least one side completed ($ok)" || { echo "  FAIL neither side completed:"; sed 's/^/       /' <<<"$combined"; FAILED=1; }
}

echo "deadlocks: the registration against the functions that lock the same rows"
for round in 1 2; do
  IFS=, read -r E R <<<"$(q "select conc.member_request('$MEMBER')")"
  P="$(newpath "$MEMBER")"
  race "$MEMBER" "$(reg "$P" receipt "$E" "$R" null)" "$MEMBER" "select public.withdraw_member_reimbursement($R)"
  check_race "register x withdraw (round $round)"

  IFS=, read -r E R <<<"$(q "select conc.member_request('$MEMBER')")"
  P="$(newpath "$MEMBER")"
  race "$MEMBER" "$(reg "$P" receipt "$E" "$R" null)" "$EXEC1" "select public.review_personal_reimbursement($R, 'rejected', null, 'no')"
  check_race "register x reject (round $round)"

  E="$(q "select conc.club_expense('$EXEC1', 25)")"
  P="$(newpath "$EXEC2")"
  race "$EXEC2" "$(reg "$P" receipt "$E" null null)" "$EXEC1" "select public.void_finance_expense($E, 'race void')"
  check_race "register x void expense (round $round)"

  E="$(q "select conc.club_expense('$EXEC1', 25)")"
  CL="$(q "select conc.claim('$EXEC1', array[$E]::bigint[])")"
  P="$(newpath "$EXEC2")"
  race "$EXEC2" "$(reg "$P" receipt "$E" null null)" "$EXEC1" "select public.void_funding_claim($CL, 'race void')"
  check_race "register x void claim (round $round)"

  E="$(q "select conc.club_expense('$EXEC1', 25)")"; E2="$(q "select conc.club_expense('$EXEC1', 25)")"
  CL="$(q "select conc.claim('$EXEC1', array[$E2]::bigint[])")"
  P="$(newpath "$EXEC2")"
  race "$EXEC2" "$(reg "$P" receipt "$E" null null)" "$EXEC1" "select public.add_funding_claim_expense($CL, $E)"
  check_race "register x add expense to a claim (round $round)"
done

echo
if [ "$FAILED" = "0" ]; then echo "concurrency: all checks passed"; else echo "concurrency: FAILED"; fi
exit "$FAILED"
