#!/usr/bin/env bash
# One edition of the site, on its own ports (src/regions.ts), next to the others:
#
#   bash apps/trajestaurant/scripts/run.sh ch          # Trajestaurant: API :8789, site :5174
#   bash apps/trajestaurant/scripts/run.sh vinnytsia   # Тролейбуфет: API :8790, site :5175
#   bash apps/trajestaurant/scripts/run.sh vinnytsia start   # production: the API serves web/dist on :8790 (pnpm build first)
#   bash apps/trajestaurant/scripts/run.sh vinnytsia stop
#
# MOTIS, Valhalla and PostgreSQL must be running (scripts/motis.sh, scripts/valhalla.sh,
# scripts/dev.sh). The environment overrides the region's defaults: PORT, WEB_PORT, DATABASE_URL,
# MOTIS_URL, MOTIS_CONFIG, VALHALLA_URL (default http://127.0.0.1:8002, the shared Valhalla),
# SHAREDMOBILITY_CONTACT. Logs in $TRAJ_LOG_DIR (default /tmp/trajestaurant-logs).
set -euo pipefail
app="$(cd "$(dirname "$0")/.." && pwd)"
region="${1:-ch}"; mode="${2:-dev}"
log="${TRAJ_LOG_DIR:-/tmp/trajestaurant-logs}"; mkdir -p "$log"
export REGION="$region" VALHALLA_URL="${VALHALLA_URL:-http://127.0.0.1:8002}"
# The region's ports, from src/regions.ts.
read -r api web < <(cd "$app" && pnpm exec tsx -e "
import { regionOf } from './src/regions.ts';
const r = regionOf(process.env.REGION);
console.log(process.env.PORT ?? r.defaults.port, process.env.WEB_PORT ?? r.defaults.webPort);")
export PORT="$api" WEB_PORT="$web"
up() { curl -sf -m 2 "$1" >/dev/null 2>&1; }

case "$mode" in
  dev)
    up "http://127.0.0.1:$api/api/health" || (cd "$app" && nohup pnpm exec tsx watch server/server.ts > "$log/$region-api.log" 2>&1 </dev/null &)
    up "http://127.0.0.1:$web/" || (cd "$app" && nohup pnpm exec vite --host 127.0.0.1 > "$log/$region-web.log" 2>&1 </dev/null &)
    for _ in $(seq 1 30); do up "http://127.0.0.1:$api/api/health" && up "http://127.0.0.1:$web/" && break; sleep 1; done
    echo "$region: site http://127.0.0.1:$web/ (API :$api), logs in $log" ;;
  start)
    [ -f "$app/web/dist/index.html" ] || { echo "build the site first: pnpm --filter @pendular/trajestaurant build" >&2; exit 1; }
    up "http://127.0.0.1:$api/api/health" || (cd "$app" && NODE_ENV=production nohup pnpm exec tsx server/server.ts > "$log/$region-api.log" 2>&1 </dev/null &)
    for _ in $(seq 1 30); do up "http://127.0.0.1:$api/api/health" && break; sleep 1; done
    echo "$region: http://127.0.0.1:$api/, log $log/$region-api.log" ;;
  stop)
    for p in $(pgrep -f "server/server.ts|vite --host" || true); do
      tr '\0' '\n' < "/proc/$p/environ" 2>/dev/null | grep -qx "REGION=$region" && kill "$p" 2>/dev/null || true
    done
    echo "$region stopped" ;;
  *) echo "usage: run.sh <region> [dev|start|stop]" >&2; exit 1 ;;
esac
