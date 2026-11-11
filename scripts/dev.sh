#!/usr/bin/env bash
# Starts everything needed for local work: PostgreSQL (analytics), MOTIS, the API and the site.
# Safe to run again: each service is started only if it is not already answering.
set -uo pipefail
cd "$(dirname "$0")/.."
LOG="${PENDULAR_LOG_DIR:-/tmp/pendular-logs}"; mkdir -p "$LOG"
PGDATA="$PWD/data/pg"; PGPORT="${PGPORT:-5433}"; PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"

up() { curl -sf -m 2 "$1" >/dev/null 2>&1; }

# --- PostgreSQL ---------------------------------------------------------------------------------
if [ -n "$PGBIN" ] && ! "$PGBIN/pg_isready" -q -h 127.0.0.1 -p "$PGPORT" -U pendular -d postgres; then
  run_pg() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$1"; else bash -c "$1"; fi; }
  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    mkdir -p "$PGDATA"; [ "$(id -u)" = 0 ] && chown postgres "$PGDATA"
    run_pg "$PGBIN/initdb -D '$PGDATA' -U pendular --auth=trust -E UTF8 >/dev/null"
  fi
  run_pg "$PGBIN/pg_ctl -D '$PGDATA' -o '-p $PGPORT -c listen_addresses=127.0.0.1' -l '$PGDATA/server.log' -w start >/dev/null 2>&1 </dev/null"
  "$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -U pendular -d postgres -tAc "select 1 from pg_database where datname='pendular'" | grep -q 1 \
    || "$PGBIN/createdb" -h 127.0.0.1 -p "$PGPORT" -U pendular pendular
fi

# --- MOTIS --------------------------------------------------------------------------------------
if ! up http://127.0.0.1:8080/api/v1/health; then
  # Our fork of MOTIS (segment filter: last trip home within a pass, cheaper zone paths) is used
  # when its binary is there; it reads the same data and behaves like the release otherwise.
  if [ -x data/motis/bin/motis-fork ]; then MOTIS_BIN=./bin/motis-fork; else MOTIS_BIN=./bin/motis; fi
  (cd data/motis && MOTIS_SEGMENT_TAGS="$PWD/../../tools/motis-fork/segments.csv" nohup "$MOTIS_BIN" server -d data > "$LOG/motis.log" 2>&1 </dev/null &)
  for _ in $(seq 1 40); do up http://127.0.0.1:8080/api/v1/health && break; sleep 2; done
fi

# --- API, analytics, site -----------------------------------------------------------------------
[ -x data/motis/bin/motis-fork ] && export MOTIS_SEGMENT_FILTER=1
up http://127.0.0.1:8787/api/health || (cd apps/api && nohup pnpm start > "$LOG/api.log" 2>&1 </dev/null &)
if [ -d apps/analytics ]; then
  up http://127.0.0.1:8788/api/health || (cd apps/analytics && DATABASE_URL="postgres://pendular@127.0.0.1:$PGPORT/pendular" nohup pnpm start > "$LOG/analytics.log" 2>&1 </dev/null &)
fi
up http://127.0.0.1:5173/ || (cd apps/web && nohup pnpm dev --host 127.0.0.1 > "$LOG/web.log" 2>&1 </dev/null &)
sleep 5
for s in "motis http://127.0.0.1:8080/api/v1/health" "api http://127.0.0.1:8787/api/health" "analytics http://127.0.0.1:8788/api/health" "site http://127.0.0.1:5173/"; do
  set -- $s; printf '%-10s %s\n' "$1" "$(up "$2" && echo up || echo down)"
done
[ -n "$PGBIN" ] && printf '%-10s %s\n' postgres "$("$PGBIN/pg_isready" -q -h 127.0.0.1 -p "$PGPORT" -U pendular -d postgres && echo up || echo down)"
