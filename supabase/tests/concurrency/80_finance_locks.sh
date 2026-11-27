#!/usr/bin/env bash
# Two-session tests for the finance row locks (findings finance-1, finance-2,
# finance-3 and finance-7 of the Phase 1 and 2 review).
#
# The single-session SQL tests cannot show a race, because every test file runs
# in one transaction. This script needs committed data and two connections, so
# it works on a private clone of the replayed database and drops it afterwards.
#
#   scripts/db-replay.sh runs it after the SQL tests. To run it by hand against
#   a cluster you started with KEEP=1:
#
#     PGHOST=<socket dir> PGPORT=<port> PGUSER=postgres bash supabase/tests/concurrency/80_finance_locks.sh
#
# Two kinds of check:
#   * Interleaving. Session A does its work and keeps its locks. Session B
#     starts, and the script waits until B is blocked on a lock before it lets A
#     commit. The result must be the one a serial run would give.
#   * Deadlocks. Two functions that touch the same rows are released together
#     while a sleep trigger (this clone only) holds each open between its
#     statements. Nothing may fail with 40P01.
set -uo pipefail

DBNAME="conc80_$$"
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

create function conc.pay(p_exec uuid, p_reimbursement bigint) returns bigint language plpgsql as $$
declare v bigint;
begin
  perform test.login(p_exec);
  v := public.pay_personal_reimbursement(p_reimbursement, current_date);
  perform test.logout();
  return v;
end $$;

create function conc.claim(p_exec uuid, p_expenses bigint[]) returns bigint language plpgsql as $$
declare v bigint;
begin
  perform test.login(p_exec);
  select id into v from public.create_funding_claim('Race claim', 'GPSG Senate', '', '', null, '', p_expenses);
  perform test.logout();
  return v;
end $$;
SQL

EXEC1="$(q "select test.make_user('Conc Exec One', 'executive')")"
EXEC2="$(q "select test.make_user('Conc Exec Two', 'executive')")"
MEMBER="$(q "select test.make_user('Conc Member')")"

# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------
# start_session <name> <sql>: runs the SQL in its own psql connection in the
# background, output (and errors) in $TMP/<name>.out.
start_session() {
  printf '%s\n' "$2" >"$TMP/$1.sql"
  PGAPPNAME="$1" "${PSQL[@]}" -v ON_ERROR_STOP=0 -d "$DBNAME" -f "$TMP/$1.sql" >"$TMP/$1.out" 2>&1 &
  PIDS+=("$!")
  LAST_PID=$!
}
# Waits until the named session is blocked on a lock held by someone else.
wait_blocked() { # wait_blocked <name> [seconds]
  local i
  for ((i = 0; i < ${2:-100}; i++)); do
    [ "$(admin -c "select count(*) from pg_stat_activity where application_name = '$1' and wait_event_type = 'Lock'")" != "0" ] && return 0
    sleep 0.1
  done
  return 1
}
wait_for_text() { # wait_for_text <name> <text> [seconds]
  local i
  for ((i = 0; i < ${3:-100}; i++)); do
    grep -q "$2" "$TMP/$1.out" 2>/dev/null && return 0
    sleep 0.1
  done
  return 1
}

# interleave <label> <sqlA> <sqlB>
#   A runs, prints A_HOLDING and keeps its locks until B is blocked (or 8 s pass).
#   Then A commits. B_BLOCKED is set to 1 when B was seen waiting on a lock.
interleave() {
  local label="$1" sql_a="$2" sql_b="$3"
  B_BLOCKED=0; A_OUT=''; B_OUT=''
  start_session conc_a "begin;
select test.login('$EXEC1');
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
select test.login('$EXEC2');
$sql_b;
select 'B_OK';
commit;"
  local pid_b=$LAST_PID
  wait_blocked conc_b 60 && B_BLOCKED=1
  wait "$pid_a" "$pid_b" 2>/dev/null
  A_OUT="$(cat "$TMP/conc_a.out")"
  B_OUT="$(cat "$TMP/conc_b.out")"
}

# Releases two sessions at the same instant. Each runs <sql> after a barrier,
# with the sleep trigger holding it open between statements.
SLEEP_SECONDS="0.25"
race() { # race <label> <login_a> <sql_a> <login_b> <sql_b>   -> RACE_A, RACE_B
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
select test.login('$2');
set local conc.sleep = '$SLEEP_SECONDS';
$3;
select 'RESULT_OK';
commit;"
  local pid_a=$LAST_PID
  start_session conc_b "select pg_advisory_lock_shared(77);
begin;
select test.login('$4');
set local conc.sleep = '$SLEEP_SECONDS';
$5;
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

# ---------------------------------------------------------------------------
# finance-1: one expense cannot be claimed twice
# ---------------------------------------------------------------------------
echo "finance-1: create_funding_claim on the same expense in two sessions"
E="$(q "select conc.club_expense('$EXEC1', 300)")"
interleave "create/create" "select public.create_funding_claim('Claim A', 'GPSG Senate', '', '', null, '', array[$E]::bigint[])" \
  "select public.create_funding_claim('Claim B', 'GPSG Senate', '', '', null, '', array[$E]::bigint[])"
expect "B waited for A's lock" "1" "$B_BLOCKED"
expect "one link, 300.00 claimed in total" "1,300.00" "$(q "select count(*) || ',' || coalesce(sum(claimed_amount), 0) from public.funding_claim_expenses where expense_id = $E")"
grep -q "already fully claimed" <<<"$B_OUT" && echo "  ok   B was refused as fully claimed" || { echo "  FAIL B was not refused: $B_OUT"; FAILED=1; }

echo "finance-1: add_funding_claim_expense to two different claims"
E1="$(q "select conc.club_expense('$EXEC1', 50)")"; E2="$(q "select conc.club_expense('$EXEC1', 60)")"; T="$(q "select conc.club_expense('$EXEC1', 300)")"
C1="$(q "select conc.claim('$EXEC1', array[$E1]::bigint[])")"; C2="$(q "select conc.claim('$EXEC1', array[$E2]::bigint[])")"
interleave "add/add" "select public.add_funding_claim_expense($C1, $T)" "select public.add_funding_claim_expense($C2, $T)"
expect "B waited for A's lock" "1" "$B_BLOCKED"
expect "the target is on one claim only, 300.00" "1,300.00" "$(q "select count(*) || ',' || coalesce(sum(claimed_amount), 0) from public.funding_claim_expenses where expense_id = $T")"
expect "no claim total drifted from its links" "0" "$(q "select count(*) from public.funding_claims c where c.id in ($C1, $C2) and c.requested_amount <> (select coalesce(sum(claimed_amount), 0) from public.funding_claim_expenses l where l.claim_id = c.id)")"

# ---------------------------------------------------------------------------
# finance-2: a claim cannot take an expense that is being voided
# ---------------------------------------------------------------------------
echo "finance-2: void_finance_expense while create_funding_claim runs"
E="$(q "select conc.club_expense('$EXEC1', 90)")"
interleave "void/create" "select public.void_finance_expense($E, 'race test void')" \
  "select public.create_funding_claim('Voided', 'GPSG Senate', '', '', null, '', array[$E]::bigint[])"
expect "B waited for the void" "1" "$B_BLOCKED"
expect "expense is voided and on no claim" "voided,0" "$(q "select e.status || ',' || (select count(*) from public.funding_claim_expenses where expense_id = e.id) from public.finance_expenses e where e.id = $E")"
grep -q "cannot be claimed" <<<"$B_OUT" && echo "  ok   B was refused" || { echo "  FAIL B was not refused: $B_OUT"; FAILED=1; }

echo "finance-2: void_finance_expense while add_funding_claim_expense runs"
E="$(q "select conc.club_expense('$EXEC1', 90)")"
interleave "void/add" "select public.void_finance_expense($E, 'race test void')" "select public.add_funding_claim_expense($C1, $E)"
expect "B waited for the void" "1" "$B_BLOCKED"
expect "expense is voided and on no claim" "voided,0" "$(q "select e.status || ',' || (select count(*) from public.funding_claim_expenses where expense_id = e.id) from public.finance_expenses e where e.id = $E")"
grep -q "cannot be claimed" <<<"$B_OUT" && echo "  ok   B was refused" || { echo "  FAIL B was not refused: $B_OUT"; FAILED=1; }

echo "finance-2: void_finance_payment (it voids a club purchase too) while create_funding_claim runs"
E="$(q "select conc.club_expense('$EXEC1', 70)")"; P="$(q "select id from public.finance_payments where expense_id = $E")"
interleave "void payment/create" "select public.void_finance_payment($P, 'race test void')" \
  "select public.create_funding_claim('Voided payment claim', 'GPSG Senate', '', '', null, '', array[$E]::bigint[])"
expect "B waited for the void" "1" "$B_BLOCKED"
expect "expense is voided and on no claim" "voided,0" "$(q "select e.status || ',' || (select count(*) from public.funding_claim_expenses where expense_id = e.id) from public.finance_expenses e where e.id = $E")"

echo "finance-2: a link written directly (the table is open to executives) is held to the same rule"
E="$(q "select conc.club_expense('$EXEC1', 40)")"; EBIG="$(q "select conc.club_expense('$EXEC1', 1000)")"
CBIG="$(q "select conc.claim('$EXEC1', array[$EBIG]::bigint[])")"
q "update public.funding_claims set requested_amount = 2000 where id = $CBIG" >/dev/null   # room for the link under test
interleave "void/direct insert" "select public.void_finance_expense($E, 'race test void')" \
  "insert into public.funding_claim_expenses (claim_id, expense_id, claimed_amount) values ($CBIG, $E, 40)"
expect "expense is voided and on no claim" "voided,0" "$(q "select e.status || ',' || (select count(*) from public.funding_claim_expenses where expense_id = e.id) from public.finance_expenses e where e.id = $E")"

# ---------------------------------------------------------------------------
# finance-7: one lock order, so no deadlocks
# ---------------------------------------------------------------------------
check_race() { # check_race <label>
  echo "  $1"
  local combined="$RACE_A
$RACE_B"
  expect_not_match "no deadlock" "deadlock detected|40P01" "$combined"
  local ok; ok="$(grep -c RESULT_OK <<<"$combined")"
  [ "$ok" -ge 1 ] && echo "  ok   at least one side completed ($ok)" || { echo "  FAIL neither side completed:"; sed 's/^/       /' <<<"$combined"; FAILED=1; }
}

echo "finance-7: opposite lock orders on the same rows"
for round in 1 2; do
  IFS=, read -r E R <<<"$(q "select conc.member_request('$MEMBER')")"
  race "" "$EXEC1" "select public.void_finance_expense($E, 'race void')" "$MEMBER" "select public.withdraw_member_reimbursement($R)"
  check_race "void expense x withdraw (round $round)"

  E="$(q "select conc.club_expense('$EXEC1', 25)")"
  P="$(q "select id from public.finance_payments where expense_id = $E")"
  race "" "$EXEC1" "select public.void_finance_expense($E, 'race void')" "$EXEC2" "select public.void_finance_payment($P, 'race void payment')"
  check_race "void expense x void payment, club purchase (round $round)"

  IFS=, read -r E R <<<"$(q "select conc.member_request('$MEMBER')")"
  race "" "$EXEC1" "select public.update_finance_expense($E, 'Edited by exec', 'Shop', 'Supplies', '1111')" "$MEMBER" \
    "select public.update_member_reimbursement($R, 'Edited by member', 'Shop', 100, current_date, 'Supplies', '1111')"
  check_race "executive edit x member edit (round $round)"

  IFS=, read -r E R <<<"$(q "select conc.member_request('$MEMBER', '$EXEC2')")"
  race "" "$EXEC1" "select public.void_finance_expense($E, 'race void')" "$EXEC2" "select public.pay_personal_reimbursement($R, current_date)"
  check_race "void expense x pay reimbursement (round $round)"

  IFS=, read -r E R <<<"$(q "select conc.member_request('$MEMBER', '$EXEC2')")"
  PAY="$(q "select conc.pay('$EXEC2', $R)")"
  race "" "$EXEC1" "select public.void_finance_payment($PAY, 'race void payment')" "$EXEC2" "select public.void_finance_expense($E, 'race void')"
  check_race "void reimbursement payment x void expense (round $round)"

  IFS=, read -r E R <<<"$(q "select conc.member_request('$MEMBER')")"
  race "" "$EXEC1" "select public.void_finance_expense($E, 'race void')" "$EXEC2" "select public.review_personal_reimbursement($R, 'rejected', null, 'no')"
  check_race "void expense x reject (round $round)"
done

echo "finance-7: overlapping claims that list the same expenses in opposite order"
for round in 1 2 3; do
  E1="$(q "select conc.club_expense('$EXEC1', 10)")"; E2="$(q "select conc.club_expense('$EXEC1', 20)")"
  race "" "$EXEC1" "select public.create_funding_claim('Claim X', 'GPSG Senate', '', '', null, '', array[$E1, $E2]::bigint[])" \
    "$EXEC2" "select public.create_funding_claim('Claim Y', 'GPSG Senate', '', '', null, '', array[$E2, $E1]::bigint[])"
  check_race "claim [a,b] x claim [b,a] (round $round)"
  expect "each expense is on exactly one claim" "1,1" "$(q "select (select count(*) from public.funding_claim_expenses where expense_id = $E1) || ',' || (select count(*) from public.funding_claim_expenses where expense_id = $E2)")"
done

echo
if [ "$FAILED" = "0" ]; then echo "concurrency: all checks passed"; else echo "concurrency: FAILED"; fi
exit "$FAILED"
