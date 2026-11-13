#!/usr/bin/env bash
# Vinnytsia (Ukraine): the sources for a GTFS of its city transport and for its places.
#
#   bash tools/vinnytsia/fetch.sh [osm|gtfs|places|all]
#
#   osm     the OpenStreetMap extract of the Vinnytsia oblast (openstreetmap.fr, ~45 MB, daily)
#   gtfs    the city GTFS built from vn.rozklad.in.ua, OSM and depo.vn.ua (build_gtfs.py, then
#           check_gtfs.py), and the national rail GTFS (Ukrzaliznytsia, community feed listed by
#           Transitous)
#   places  Overture, All The Places and the Name Suggestion Index for the oblast, through
#           apps/trajestaurant/import/fetch.sh (TRAJ_COUNTRY=UA, TRAJ_BBOX = the oblast), and every
#           Overture place of the oblast, unfiltered (overture_places.py)
#
# Files go to data/raw (the OSM extract) and data/build/vinnytsia (the rest). A failed download
# never replaces a good file.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
raw="$root/data/raw"; out="$root/data/build/vinnytsia"; src="$out/src"
mkdir -p "$raw" "$src"
UA="trajestaurant-data-pipeline"
# The oblast, lon_min,lat_min,lon_max,lat_max.
OBLAST="27.35,47.95,30.05,49.95"

osm() {
  curl -fsSL --retry 4 -A "$UA" -o "$raw/vinnytsia_oblast.osm.pbf.part" \
    https://download.openstreetmap.fr/extracts/europe/ukraine/vinnytsia_oblast-latest.osm.pbf
  mv "$raw/vinnytsia_oblast.osm.pbf.part" "$raw/vinnytsia_oblast.osm.pbf"
  echo "osm: $(du -h "$raw/vinnytsia_oblast.osm.pbf" | cut -f1)"
}

gtfs() {
  [ -f "$raw/vinnytsia_oblast.osm.pbf" ] || osm
  # rozklad's and depo.vn.ua's pages are kept (src/rozklad, src/depo): delete them to read the
  # current timetables again.
  python3 "$here/build_gtfs.py" --osm "$raw/vinnytsia_oblast.osm.pbf" --out "$out/vinnytsia-gtfs.zip" --cache "$src/depo" --rozklad "$src/rozklad"
  python3 "$here/check_gtfs.py" "$out/vinnytsia-gtfs.zip"
  curl -fsSL --retry 4 -A "$UA" -o "$src/ukrzaliznytsia.gtfs.zip.part" https://jbb.ghsq.de/gtfs/ua-ukrzaliznytsya.gtfs.zip
  mv "$src/ukrzaliznytsia.gtfs.zip.part" "$src/ukrzaliznytsia.gtfs.zip"
  echo "rail: $(du -h "$src/ukrzaliznytsia.gtfs.zip" | cut -f1)"
}

places() {
  for step in nsi overture atp; do
    TRAJ_COUNTRY=UA TRAJ_BBOX="$OBLAST" TRAJ_OUT="$src" bash "$root/apps/trajestaurant/import/fetch.sh" "$step"
  done
  python3 "$here/overture_places.py" "$src/overture-places.jsonl.part" "$OBLAST"
  mv "$src/overture-places.jsonl.part" "$src/overture-places.jsonl"
}

case "${1:-all}" in
  osm) osm ;;
  gtfs) gtfs ;;
  places) places ;;
  all) osm; gtfs; places ;;
  *) echo "usage: fetch.sh [osm|gtfs|places|all]" >&2; exit 1 ;;
esac
