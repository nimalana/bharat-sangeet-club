#!/usr/bin/env bash
# Builds a throwaway PostgreSQL 16 cluster, replays every migration, loads the
# load-test dataset (supabase/tests/seed-load.sql) and the measurement harness.
# Leaves the cluster running and prints how to connect; stop it with pg_ctl.
#   PGPORT=54351 scripts/db-perf.sh
# UNTIL=<migration timestamp> stops the replay after that migration (for before/after runs).
# Then: psql ... -v phase=after -v runs=7 -f supabase/tests/perf/bench.sql
# This is a measurement aid on plain PostgreSQL, not hosted Supabase.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
WORK="${PERF_DIR:-$(mktemp -d)}"; mkdir -p "$WORK"
PORT="${PGPORT:-54351}"
RUN_AS=""; if [ "$(id -u)" = "0" ]; then RUN_AS="runuser -u postgres --"; chown postgres "$WORK"; fi
$RUN_AS "$PG_BIN/initdb" -D "$WORK/data" -U postgres --auth=trust >/dev/null
$RUN_AS "$PG_BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -c listen_addresses='' -k $WORK" -l "$WORK/log" -w start >/dev/null
export PGOPTIONS="-c client_min_messages=warning"
PSQL=(psql -X -q -v ON_ERROR_STOP=1 -h "$WORK" -p "$PORT" -U postgres -d postgres)
EMAIL="$(grep -oE "lower\(email\) = '[^']+'" "$ROOT/supabase/migrations/20260812000000_admin_console.sql" | head -1 | sed -E "s/.*'([^']+)'/\1/")"
"${PSQL[@]}" -f "$ROOT/supabase/tests/shims.sql"
b=0
for f in "$ROOT"/supabase/migrations/*.sql; do
  n="$(basename "$f")"
  if [ "$b" = 0 ] && [[ "$n" > "20260811" ]]; then PGOPTIONS="$PGOPTIONS -c replay.bootstrap_email=$EMAIL" "${PSQL[@]}" -f "$ROOT/supabase/tests/bootstrap.sql"; b=1; fi
  if [ -n "${UNTIL:-}" ] && [[ "$n" > "$UNTIL" ]]; then continue; fi   # UNTIL=20261127005000 builds the pre-Phase-2 schema
  "${PSQL[@]}" -f "$f" >/dev/null
done
"${PSQL[@]}" -f "$ROOT/supabase/tests/helpers.sql"
"${PSQL[@]}" -f "$ROOT/supabase/tests/seed-load.sql"
"${PSQL[@]}" -f "$ROOT/supabase/tests/perf/harness.sql"
echo "Ready: psql -h $WORK -p $PORT -U postgres postgres   (stop: $RUN_AS $PG_BIN/pg_ctl -D $WORK/data -m immediate stop)"
