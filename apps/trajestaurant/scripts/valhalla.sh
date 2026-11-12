#!/usr/bin/env bash
# Valhalla for Trajestaurant's car times and car routes (optional: without it MOTIS computes them,
# about ten times slower for places far away). Runs the official image with Docker.
#
#   bash apps/trajestaurant/scripts/valhalla.sh build   # road tiles from data/raw/switzerland.osm.pbf (about 5 minutes, 0.8 GB)
#   bash apps/trajestaurant/scripts/valhalla.sh start   # service on 127.0.0.1:8002 (about 70 MB of memory)
#   bash apps/trajestaurant/scripts/valhalla.sh stop
# then start the server with VALHALLA_URL=http://127.0.0.1:8002.
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
dir="$root/data/build/valhalla"
image="${VALHALLA_IMAGE:-ghcr.io/valhalla/valhalla:latest}"
pbf="${OSM_PBF:-$root/data/raw/switzerland.osm.pbf}"

case "${1:-}" in
  build)
    [ -f "$pbf" ] || { echo "no OSM extract: run data/scripts/fetch.sh osm" >&2; exit 1; }
    mkdir -p "$dir"
    docker run --rm --user root -v "$dir:/data" -v "$(dirname "$pbf"):/raw:ro" "$image" bash -c "
      valhalla_build_config --mjolnir-tile-dir /data/tiles --mjolnir-tile-extract /data/tiles.tar \
        --mjolnir-admin /data/admin.sqlite --mjolnir-timezone /data/tz.sqlite > /data/valhalla.json &&
      valhalla_build_admins -c /data/valhalla.json /raw/$(basename "$pbf") &&
      valhalla_build_tiles -c /data/valhalla.json /raw/$(basename "$pbf") &&
      valhalla_build_extract -c /data/valhalla.json -v"
    ;;
  start)
    [ -f "$dir/tiles.tar" ] || { echo "no tiles: run $0 build" >&2; exit 1; }
    docker rm -f trajestaurant-valhalla >/dev/null 2>&1 || true
    docker run -d --name trajestaurant-valhalla --user root -p 127.0.0.1:8002:8002 -v "$dir:/data:ro" "$image" \
      valhalla_service /data/valhalla.json 2 >/dev/null
    for _ in $(seq 1 30); do curl -sf -m 2 http://127.0.0.1:8002/status >/dev/null && { echo "valhalla on http://127.0.0.1:8002"; exit 0; }; sleep 1; done
    echo "valhalla did not start: docker logs trajestaurant-valhalla" >&2; exit 1
    ;;
  stop) docker rm -f trajestaurant-valhalla ;;
  *) echo "usage: $0 build|start|stop" >&2; exit 1 ;;
esac
