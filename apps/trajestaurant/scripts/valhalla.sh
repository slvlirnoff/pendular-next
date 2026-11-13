#!/usr/bin/env bash
# Valhalla for Trajestaurant's car, walk and bike times and routes (optional: without it MOTIS
# computes them, about ten times slower for places far away). Runs the official image with Docker.
# One tile set per region, or one for several regions (a shared instance: each site's
# VALHALLA_URL points at it).
#
#   bash apps/trajestaurant/scripts/valhalla.sh build [region...]   # road tiles (Switzerland: about 5 minutes, 0.8 GB)
#   bash apps/trajestaurant/scripts/valhalla.sh start [region...]   # the service (about 70 MB of memory)
#   bash apps/trajestaurant/scripts/valhalla.sh stop [region...]
#
# Regions: ch (default), vinnytsia, or several (ch vinnytsia). Ports: 8002 (ch, or several), 8003
# (vinnytsia alone), or VALHALLA_PORT. Then start the site with VALHALLA_URL=http://127.0.0.1:<port>.
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
image="${VALHALLA_IMAGE:-ghcr.io/valhalla/valhalla:latest}"
cmd="${1:-}"; shift || true
[ $# -gt 0 ] || set -- ch
name="$(IFS=-; echo "$*")"
pbfs=()
for r in "$@"; do
  case "$r" in
    ch) pbfs+=("${OSM_PBF:-$root/data/raw/switzerland.osm.pbf}") ;;
    vinnytsia) pbfs+=("$root/data/raw/vinnytsia_oblast.osm.pbf") ;;
    *) echo "unknown region $r" >&2; exit 1 ;;
  esac
done
# Switzerland keeps the folder and the container it always had.
if [ "$name" = ch ]; then dir="$root/data/build/valhalla"; container=trajestaurant-valhalla
else dir="$root/data/build/valhalla-$name"; container="trajestaurant-valhalla-$name"; fi
if [ "$name" = vinnytsia ]; then port="${VALHALLA_PORT:-8003}"; else port="${VALHALLA_PORT:-8002}"; fi

case "$cmd" in
  build)
    raw="$(dirname "${pbfs[0]}")"
    files=""
    for p in "${pbfs[@]}"; do
      [ -f "$p" ] || { echo "no OSM extract $p" >&2; exit 1; }
      [ "$(dirname "$p")" = "$raw" ] || { echo "the extracts must be in one folder ($raw)" >&2; exit 1; }
      files="$files /raw/$(basename "$p")"
    done
    mkdir -p "$dir"
    docker run --rm --user root -v "$dir:/data" -v "$raw:/raw:ro" "$image" bash -c "
      valhalla_build_config --mjolnir-tile-dir /data/tiles --mjolnir-tile-extract /data/tiles.tar \
        --mjolnir-admin /data/admin.sqlite --mjolnir-timezone /data/tz.sqlite > /data/valhalla.json &&
      valhalla_build_admins -c /data/valhalla.json $files &&
      valhalla_build_tiles -c /data/valhalla.json $files &&
      valhalla_build_extract -c /data/valhalla.json -v"
    ;;
  start)
    [ -f "$dir/tiles.tar" ] || { echo "no tiles: run $0 build $*" >&2; exit 1; }
    docker rm -f "$container" >/dev/null 2>&1 || true
    docker run -d --name "$container" --user root -p "127.0.0.1:$port:8002" -v "$dir:/data:ro" "$image" \
      valhalla_service /data/valhalla.json 2 >/dev/null
    for _ in $(seq 1 30); do curl -sf -m 2 "http://127.0.0.1:$port/status" >/dev/null && { echo "valhalla ($name) on http://127.0.0.1:$port"; exit 0; }; sleep 1; done
    echo "valhalla did not start: docker logs $container" >&2; exit 1
    ;;
  stop) docker rm -f "$container" ;;
  *) echo "usage: $0 build|start|stop [region...]" >&2; exit 1 ;;
esac
