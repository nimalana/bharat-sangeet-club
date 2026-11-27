#!/usr/bin/env bash
# Contract check between the frontend and the database the migrations build.   npm run test:contract
#
#   scripts/contract-check/run.sh                run the check (about 10 seconds)
#   scripts/contract-check/run.sh --selftest     also prove the check catches each kind of break (see selftest.mjs)
#   scripts/contract-check/run.sh --probes       also print the role probes (probe.sql, informational)
#
# 1. replays every migration on a throwaway PostgreSQL 16 cluster (scripts/db-replay.sh, schema only: no SQL suites)
# 2. extract.mjs: every Supabase call in the frontend, read with the TypeScript checker
# 3. check.mjs: compares them with the replayed database (tables, columns, RPCs and their arguments, enum values,
#    buckets, and what role `authenticated` may write / execute)
# 4. event-target-scan.mjs: the P1-08 scan (currentTarget read after an await)
# The cluster is always stopped and every scratch file removed, also when a step fails or the script is interrupted.
#
# Environment
#   REPO           repository root (default: two levels above this file); supabase/ and scripts/db-replay.sh come from here
#   FRONTEND       the directory with tsconfig.json and the source to check (default: REPO). A temporary copy of the
#                  source can be checked against the real migrations this way.
#   CONTRACT_OUT   keep facts.json, report.txt and replay.log in this directory instead of a temp dir that is deleted
#   CONTRACT_DB=existing   use the PGHOST/PGPORT/PGUSER already in the environment (a replayed cluster) instead of starting one
#   PGPORT         port of the throwaway cluster (default 54329). It only names the socket file inside the cluster's own
#                  temp directory, so parallel runs do not collide.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${REPO:-$(cd "$HERE/../.." && pwd)}"
export FRONTEND="${FRONTEND:-$REPO}"
SELFTEST=0; PROBES=0
for arg in "$@"; do case "$arg" in --selftest) SELFTEST=1 ;; --probes) PROBES=1 ;; *) echo "unknown option $arg" >&2; exit 2 ;; esac; done

tmproot="${TMPDIR:-/tmp}"; [ "${#tmproot}" -le 60 ] || tmproot=/tmp   # a unix socket path is limited to about 107 bytes
WORK=""; OUT=""; STARTED=0
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
RUN_AS=""; [ "$(id -u)" = "0" ] && RUN_AS="runuser -u postgres --"

cleanup() {
  trap - EXIT INT TERM HUP
  if [ "$STARTED" = "1" ] && [ -n "$WORK" ] && [ -d "$WORK/data" ]; then
    $RUN_AS "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  fi
  [ -n "$WORK" ] && rm -rf "$WORK"
  [ -n "$OUT" ] && [ -z "${CONTRACT_OUT:-}" ] && rm -rf "$OUT"
}
trap cleanup EXIT
trap 'echo "interrupted" >&2; exit 130' INT TERM HUP

if [ -n "${CONTRACT_OUT:-}" ]; then OUT="$CONTRACT_OUT"; mkdir -p "$OUT"; else OUT="$(mktemp -d "$tmproot/contract-out.XXXXXX")"; fi

if [ "${CONTRACT_DB:-}" = "existing" ]; then
  : "${PGHOST:?CONTRACT_DB=existing needs PGHOST}"
  export PGPORT="${PGPORT:-54329}" PGUSER="${PGUSER:-postgres}"
else
  [ -x "$PG_BIN/initdb" ] || { echo "PostgreSQL server binaries not found; set PG_BIN" >&2; exit 2; }
  WORK="$(mktemp -d "$tmproot/contract-pg.XXXXXX")"
  export PGPORT="${PGPORT:-54329}" PGHOST="$WORK" PGUSER=postgres
  STARTED=1   # set before the replay: even a replay that fails half way leaves a cluster to stop
  echo "Replaying migrations on a throwaway cluster..."
  if ! REPLAY_WORK="$WORK" REPLAY_ONLY=1 "$REPO/scripts/db-replay.sh" >"$OUT/replay.log" 2>&1; then
    echo "The migrations did not replay (the database side of the contract is not available):" >&2
    tail -20 "$OUT/replay.log" >&2
    exit 2
  fi
  grep -E "^Replayed" "$OUT/replay.log"
fi

status=0
if [ "$SELFTEST" = "1" ]; then
  node "$HERE/selftest.mjs" || status=1
fi

echo "--- contract check: $FRONTEND"
node "$HERE/extract.mjs" --frontend "$FRONTEND" --out "$OUT/facts.json" || { echo "the extractor failed" >&2; exit 2; }
node "$HERE/check.mjs" "$OUT/facts.json" --json "$OUT/report.json" | tee "$OUT/report.txt"
[ "${PIPESTATUS[0]}" = "0" ] || status=1

echo "--- P1-08 scan (currentTarget read after an await)"
node "$HERE/event-target-scan.mjs" --frontend "$FRONTEND" || status=1

if [ "$PROBES" = "1" ]; then
  echo "--- role probes (informational, nothing is asserted)"
  psql -X -At -d postgres -f "$HERE/probe.sql" 2>&1 | grep -o 'PROBE.*'
fi
[ -n "${CONTRACT_OUT:-}" ] && echo "facts and report kept in $OUT"
exit $status
