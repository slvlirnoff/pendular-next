#!/usr/bin/env bash
# Fetches the raw inputs: timetable (GTFS), street network (OSM), parking, MOTIS binary.
# A failed download never replaces a good file: each file is written to .part and moved on success.
set -euo pipefail
cd "$(dirname "$0")/.."
RAW=raw; mkdir -p "$RAW" motis/bin
UA="pendular-data-pipeline"

fetch() { # url dest
  local url="$1" dest="$2"
  echo "fetch $dest"
  curl -fsSL --retry 4 --retry-delay 2 -A "$UA" "$url" -o "$dest.part"
  mv "$dest.part" "$dest"
}

GTFS_URL="${GTFS_URL:-https://data.opentransportdata.swiss/dataset/timetable-2027-gtfs2020/permalink}"
OSM_URL="${OSM_URL:-https://download.openstreetmap.fr/extracts/europe/switzerland-latest.osm.pbf}"
PARKING_URL="${PARKING_URL:-https://data.opentransportdata.swiss/dataset/bike-and-car-parking/permalink}"
MOTIS_URL="${MOTIS_URL:-https://github.com/motis-project/motis/releases/latest/download/motis-linux-amd64.tar.bz2}"

case "${1:-all}" in
  gtfs|all) fetch "$GTFS_URL" "$RAW/gtfs.zip" ;;&
  osm|all) fetch "$OSM_URL" "$RAW/switzerland.osm.pbf" ;;&
  parking|all) fetch "$PARKING_URL" "$RAW/bike-and-car-parking.json" ;;&
  motis|all) fetch "$MOTIS_URL" "$RAW/motis.tar.bz2"; tar -xjf "$RAW/motis.tar.bz2" -C motis/bin ;;&
esac
date -u +%FT%TZ > "$RAW/fetched-at.txt"
ls -la "$RAW"
