#!/usr/bin/env bash
# Replays every migration on a throwaway PostgreSQL 16 cluster and then runs
# the SQL tests in supabase/tests/*.test.sql.
#
# This checks SQL logic, constraints, triggers and table policies. It does not
# exercise real Supabase Storage or Auth; see supabase/tests/README.md.
#
# Usage: scripts/db-replay.sh            replay and run tests
#        KEEP=1 scripts/db-replay.sh     leave the cluster running and print its port
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PG_BIN/initdb" ] || { echo "PostgreSQL server binaries not found; set PG_BIN" >&2; exit 2; }
WORK="$(mktemp -d)"
PORT="${PGPORT:-54329}"
RUN_AS=""
if [ "$(id -u)" = "0" ]; then RUN_AS="runuser -u postgres --"; chown postgres "$WORK"; fi

cleanup() { $RUN_AS "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
[ "${KEEP:-0}" = "1" ] || trap cleanup EXIT

$RUN_AS "$PG_BIN/initdb" -D "$WORK/data" -U postgres --auth=trust >/dev/null
$RUN_AS "$PG_BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -c listen_addresses='' -k $WORK" -l "$WORK/log" -w start >/dev/null
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -U postgres -d postgres)

# The admin migration bootstraps one specific address; read it from the file
# rather than repeating it here.
ADMIN_MIGRATION="$ROOT/supabase/migrations/20260812000000_admin_console.sql"
BOOTSTRAP_EMAIL="$(grep -oE "lower\(email\) = '[^']+'" "$ADMIN_MIGRATION" | head -1 | sed -E "s/.*'([^']+)'/\1/")"

"${PSQL[@]}" -f "$ROOT/supabase/tests/shims.sql"
bootstrapped=0
for file in "$ROOT"/supabase/migrations/*.sql; do
  name="$(basename "$file")"
  if [ "$bootstrapped" = "0" ] && [[ "$name" > "20260811" ]]; then
    PGOPTIONS="$PGOPTIONS -c replay.bootstrap_email=$BOOTSTRAP_EMAIL" "${PSQL[@]}" -f "$ROOT/supabase/tests/bootstrap.sql"
    bootstrapped=1
  fi
  "${PSQL[@]}" -f "$file" >/dev/null || { echo "FAILED applying $name" >&2; exit 1; }
done
echo "Replayed $(ls "$ROOT"/supabase/migrations/*.sql | wc -l) migrations."

"${PSQL[@]}" -f "$ROOT/supabase/tests/helpers.sql"
status=0
for testfile in "$ROOT"/supabase/tests/*.test.sql; do
  [ -e "$testfile" ] || continue
  if "${PSQL[@]}" -f "$testfile" >"$WORK/out" 2>&1; then echo "ok   $(basename "$testfile")"
  else echo "FAIL $(basename "$testfile")"; sed 's/^/     /' "$WORK/out"; status=1; fi
done

# Access snapshot: any change to grants, policies or callable functions must
# be deliberate. UPDATE_SNAPSHOT=1 rewrites the file after a reviewed change.
SNAPSHOT="$ROOT/supabase/tests/permissions.snapshot"
"${PSQL[@]}" -f "$ROOT/supabase/tests/permissions.sql" >"$WORK/permissions"
if [ "${UPDATE_SNAPSHOT:-0}" = "1" ]; then cp "$WORK/permissions" "$SNAPSHOT"; echo "Wrote permissions.snapshot"
elif diff -u "$SNAPSHOT" "$WORK/permissions" >"$WORK/permdiff" 2>&1; then echo "ok   permissions.snapshot"
else echo "FAIL permissions.snapshot (run with UPDATE_SNAPSHOT=1 if the change is intended)"; sed 's/^/     /' "$WORK/permdiff"; status=1; fi

if [ "${KEEP:-0}" = "1" ]; then echo "Cluster left running: psql -h $WORK -p $PORT -U postgres postgres"; fi
exit $status
