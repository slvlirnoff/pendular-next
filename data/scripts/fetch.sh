#!/usr/bin/env bash
# Fetches the raw inputs: timetable (GTFS), street network (OSM), parking, MOTIS binary.
# The OSM clean-up needs the osmium command-line tool (apt install osmium-tool, brew install
# osmium-tool) and python3 with the "osmium" package (pip install osmium).
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
OSM_URL="${OSM_URL:-https://planet.osm.ch/switzerland-padded.osm.pbf}"
# Départements next to Geneva (Haute-Savoie, Ain). Add others the same way, separated by spaces.
OSM_EXTRA="${OSM_EXTRA-https://download.openstreetmap.fr/extracts/europe/france/rhone_alpes/haute_savoie-latest.osm.pbf https://download.openstreetmap.fr/extracts/europe/france/rhone_alpes/ain-latest.osm.pbf}"
PARKING_URL="${PARKING_URL:-https://data.opentransportdata.swiss/dataset/bike-and-car-parking/permalink}"
# MOTIS is pinned to the version everything was tested with. The asset is chosen by platform;
# set MOTIS_URL to override (asset names as on the MOTIS release page).
MOTIS_VERSION="${MOTIS_VERSION:-v2.11.4}"
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) MOTIS_ASSET=motis-linux-amd64.tar.bz2 ;;
  Linux-aarch64|Linux-arm64) MOTIS_ASSET=motis-linux-arm64.tar.bz2 ;;
  Darwin-arm64) MOTIS_ASSET=motis-macos-arm64.tar.bz2 ;;
  Darwin-x86_64) MOTIS_ASSET=motis-macos-x86_64.tar.bz2 ;;
  *) MOTIS_ASSET=motis-linux-amd64.tar.bz2 ;;
esac
MOTIS_URL="${MOTIS_URL:-https://github.com/motis-project/motis/releases/download/$MOTIS_VERSION/$MOTIS_ASSET}"

case "${1:-all}" in
  gtfs|all) fetch "$GTFS_URL" "$RAW/gtfs.zip" ;;&
  osm|all)
    # Clipped extracts hold ways whose nodes lie outside the clip; MOTIS refuses those.
    fetch "$OSM_URL" "$RAW/switzerland-raw.osm.pbf"
    # The Swiss extract is padded by some 20 km only: commuters from further across the border
    # (Annecy, Bonneville, Bellegarde for Geneva) would have no streets, hence no car route
    # and no walk to their stop. OSM_EXTRA lists further extracts to merge in.
    merge=("$RAW/switzerland-raw.osm.pbf")
    for url in $OSM_EXTRA; do
      name="$(basename "$url")"
      fetch "$url" "$RAW/extra-$name"
      merge+=("$RAW/extra-$name")
    done
    if [ "${#merge[@]}" -gt 1 ]; then
      osmium merge "${merge[@]}" -o "$RAW/merged-raw.osm.pbf" --overwrite --no-progress
      # Extracts of different dates overlap: keep the latest version of each object.
      osmium time-filter "$RAW/merged-raw.osm.pbf" -o "$RAW/merged.osm.pbf" --overwrite --no-progress
      rm -f "$RAW/merged-raw.osm.pbf"
    else
      cp "$RAW/switzerland-raw.osm.pbf" "$RAW/merged.osm.pbf"
    fi
    # The temporary name keeps the .osm.pbf ending: the writer picks the format from it.
    scripts/complete-ways.sh "$RAW/merged.osm.pbf" "$RAW/switzerland-part.osm.pbf"
    rm -f "$RAW/merged.osm.pbf"
    mv "$RAW/switzerland-part.osm.pbf" "$RAW/switzerland.osm.pbf" ;;&
  parking|all) fetch "$PARKING_URL" "$RAW/bike-and-car-parking.json" ;;&
  motis|all) fetch "$MOTIS_URL" "$RAW/motis.tar.bz2"; tar -xjf "$RAW/motis.tar.bz2" -C motis/bin ;;&
esac
# MOTIS reads its inputs from motis/input (see motis/config.yml).
mkdir -p motis/input
[ -f "$RAW/gtfs.zip" ] && ln -sf ../../raw/gtfs.zip motis/input/gtfs.zip
[ -f "$RAW/switzerland.osm.pbf" ] && ln -sf ../../raw/switzerland.osm.pbf motis/input/switzerland.osm.pbf
date -u +%FT%TZ > "$RAW/fetched-at.txt"
ls -la "$RAW"
