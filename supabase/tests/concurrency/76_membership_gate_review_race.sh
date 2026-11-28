#!/usr/bin/env bash
# Two-session tests for review_pending_member (Phase 4.1, the membership gate): two executives
# act on the same sign-up at the same time. The function locks the profile row, so the second
# waits, then is told what the first did; nothing is applied twice and the audit log has one
# row per real change.
#
# A SQL test file runs in one transaction and cannot show a race, so this script works on a
# private clone of the replayed database with committed data and two connections
# (see 80_finance_locks.sh, whose interleaving helper this one follows).
#
#   scripts/db-replay.sh runs it after the SQL tests. By hand, against a cluster started with KEEP=1:
#
#     PGHOST=<socket dir> PGPORT=<port> PGUSER=postgres bash supabase/tests/concurrency/76_membership_gate_review_race.sh
set -uo pipefail

DBNAME="conc76_$$"
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
expect_text() { # expect_text <label> <pattern> <text>
  if grep -q "$2" <<<"$3"; then echo "  ok   $1"; else echo "  FAIL $1: /$2/ not found in: $3"; FAILED=1; fi
}

admin -c "create database $DBNAME template postgres" || { echo "could not clone the database (is another session connected to the postgres database?)"; exit 1; }

EXEC1="$(q "select test.make_user('Race Exec One', 'executive')")"
EXEC2="$(q "select test.make_user('Race Exec Two', 'executive')")"
signup() { q "select test.make_user('$1', p_status => 'pending')"; }

start_session() { # start_session <name> <sql>: its own connection, output in $TMP/<name>.out
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

# interleave <label> <sqlA> <sqlB>
#   Executive 1 runs A and keeps the row lock until executive 2 (B) is blocked on it, then commits.
interleave() {
  local label="$1" sql_a="$2" sql_b="$3"
  B_BLOCKED=0
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

echo "approve / approve on the same sign-up"
P="$(signup 'Race Applicant One')"
interleave "approve/approve" "select public.review_pending_member('$P', true, '')" "select public.review_pending_member('$P', true, '')"
expect "B waited for A's row lock" "1" "$B_BLOCKED"
expect "the person is active" "active" "$(q "select status from public.profiles where id = '$P'")"
expect "one approval in the audit log" "1" "$(q "select count(*) from public.admin_audit_log where action = 'signup_approved' and target_id = '$P'")"
expect "the first executive is on the record" "$EXEC1" "$(q "select decided_by from public.signup_reviews where member_id = '$P'")"
expect_text "B was told it had already happened" "already an active member" "$B_OUT"
expect "B did not report success" "0" "$(grep -c B_OK <<<"$B_OUT")"

echo "approve / decline on the same sign-up"
P="$(signup 'Race Applicant Two')"
interleave "approve/decline" "select public.review_pending_member('$P', true, '')" "select public.review_pending_member('$P', false, 'too late')"
expect "B waited for A's row lock" "1" "$B_BLOCKED"
expect "the approval stands" "active" "$(q "select status from public.profiles where id = '$P'")"
expect "no decline in the audit log" "0" "$(q "select count(*) from public.admin_audit_log where action = 'signup_declined' and target_id = '$P'")"
expect_text "B was refused" "so the sign-up cannot be declined" "$B_OUT"

echo "decline / approve on the same sign-up (the undo, one after the other)"
P="$(signup 'Race Applicant Three')"
interleave "decline/approve" "select public.review_pending_member('$P', false, 'first thoughts')" "select public.review_pending_member('$P', true, '')"
expect "B waited for A's row lock" "1" "$B_BLOCKED"
expect "the second decision (the undo) stands" "active" "$(q "select status from public.profiles where id = '$P'")"
expect "both decisions are in the audit log, in order" "signup_declined,signup_approved" "$(q "select string_agg(action, ',' order by id) from public.admin_audit_log where target_id = '$P'")"
expect "the record names the second executive" "$EXEC2,approved" "$(q "select decided_by || ',' || decision from public.signup_reviews where member_id = '$P'")"
expect "B reported success" "1" "$(grep -c B_OK <<<"$B_OUT")"

echo "decline / decline on the same sign-up"
P="$(signup 'Race Applicant Four')"
interleave "decline/decline" "select public.review_pending_member('$P', false, 'one')" "select public.review_pending_member('$P', false, 'two')"
expect "B waited for A's row lock" "1" "$B_BLOCKED"
expect "declined" "rejected" "$(q "select status from public.profiles where id = '$P'")"
expect "one decline in the audit log" "1" "$(q "select count(*) from public.admin_audit_log where action = 'signup_declined' and target_id = '$P'")"
expect "the first reason stays" "one" "$(q "select reason from public.signup_reviews where member_id = '$P'")"
expect_text "B was told it was already declined" "already declined" "$B_OUT"

exit $FAILED
