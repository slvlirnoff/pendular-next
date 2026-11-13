#!/usr/bin/env bash
# MOTIS (public transport, street routing, geocoding) for Trajestaurant's regions: one instance per
# region, or one shared by several (each site then points MOTIS_URL at it).
#
#   bash apps/trajestaurant/scripts/motis.sh import vinnytsia          # data/motis-vinnytsia
#   bash apps/trajestaurant/scripts/motis.sh start vinnytsia           # serves on 127.0.0.1:8081
#   bash apps/trajestaurant/scripts/motis.sh import ch vinnytsia       # data/motis-ch-vinnytsia, one for both
#   bash apps/trajestaurant/scripts/motis.sh start ch vinnytsia        # MOTIS_PORT=8082 by default
#   bash apps/trajestaurant/scripts/motis.sh stop vinnytsia
#
# Switzerland alone is Pendular's MOTIS (data/motis, scripts/dev.sh): not managed here.
# A shared instance merges the regions' OpenStreetMap extracts (osmium) and keeps the days every
# timetable covers (Switzerland's timetable year: Vinnytsia's timetables start earlier, end later).
# The site of each region reads the days from the instance's config.yml (MOTIS_CONFIG).
# MOTIS_HOST and MOTIS_PORT set where it listens (127.0.0.1; for deploy/compose.trajestaurant.yml:
# MOTIS_HOST=0.0.0.0 MOTIS_PORT=8080).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
bin="${MOTIS_BIN:-$root/data/motis/bin/motis}"

cmd="${1:-}"; shift || true
[ $# -gt 0 ] || { echo "usage: motis.sh import|start|stop <region>... (ch, vinnytsia)" >&2; exit 1; }
regions=("$@")
name="$(IFS=-; echo "${regions[*]}")"
dir="$root/data/motis-$name"
if [ "${#regions[@]}" -eq 1 ] && [ "$name" = vinnytsia ]; then port="${MOTIS_PORT:-8081}"; else port="${MOTIS_PORT:-8082}"; fi
[ "$name" = ch ] && { echo "Switzerland alone is Pendular's MOTIS (data/motis): scripts/dev.sh" >&2; exit 1; }

# Each region: its OpenStreetMap extract, its timetables (dataset name=path) and the days they cover.
osm=(); datasets=(); first=""; last=""
for r in "${regions[@]}"; do
  case "$r" in
    ch)
      osm+=("$root/data/raw/switzerland.osm.pbf")
      datasets+=("ch=$root/data/raw/gtfs.zip")
      f=2026-12-13; l=2027-12-11 ;;            # the Swiss timetable year 2027 (data/motis/config.yml)
    vinnytsia)
      osm+=("$root/data/raw/vinnytsia_oblast.osm.pbf")
      datasets+=("vinnytsia=$root/data/build/vinnytsia/vinnytsia-gtfs.zip" "ua-rail=$root/data/build/vinnytsia/src/ukrzaliznytsia.gtfs.zip")
      f=2026-11-01; l=2027-10-31 ;;            # tools/vinnytsia: timetables from 1 November 2026
    *) echo "unknown region $r" >&2; exit 1 ;;
  esac
  [[ -z "$first" || "$f" > "$first" ]] && first="$f"
  [[ -z "$last" || "$l" < "$last" ]] && last="$l"
done
days=$(( ( $(date -d "$last" +%s) - $(date -d "$first" +%s) ) / 86400 + 1 ))

import() {
  mkdir -p "$dir/input"
  for p in "${osm[@]}"; do [ -f "$p" ] || { echo "missing $p" >&2; exit 1; }; done
  if [ "${#osm[@]}" -eq 1 ]; then ln -sf "${osm[0]}" "$dir/input/osm.pbf"
  else osmium merge "${osm[@]}" -o "$dir/input/osm.pbf" --overwrite --no-progress; fi
  {
    echo "# Written by apps/trajestaurant/scripts/motis.sh for: ${regions[*]}"
    echo "osm: input/osm.pbf"
    echo "timetable:"
    echo "  first_day: $first"
    echo "  num_days: $days"
    echo "  railviz: false"
    echo "  with_shapes: true"
    # Trips without a shape follow the streets or tracks of OpenStreetMap, not straight lines.
    echo "  route_shapes:"
    echo "    mode: all"
    echo "    clasz: { COACH: false, AIR: false, SHIP: false, OTHER: false }"
    echo "  adjust_footpaths: true"
    echo "  link_stop_distance: 100"
    echo "  max_footpath_length: 15"
    echo "  default_transfer_time: 2"
    echo "  datasets:"
    for d in "${datasets[@]}"; do
      [ -f "${d#*=}" ] || { echo "missing ${d#*=}" >&2; exit 1; }
      ln -sf "${d#*=}" "$dir/input/${d%%=*}.gtfs.zip"
      echo "    ${d%%=*}:"
      echo "      path: input/${d%%=*}.gtfs.zip"
      echo "      default_bikes_allowed: false"
    done
    echo "street_routing: true"
    echo "osr_footpath: false"
    echo "geocoding: true"
    echo "reverse_geocoding: true"
    echo "server:"
    echo "  host: ${MOTIS_HOST:-127.0.0.1}"
    echo "  port: $port"
    echo "limits:"
    echo "  onetoall_max_travel_minutes: 180"
  } > "$dir/config.yml"
  (cd "$dir" && "$bin" import -c config.yml -d data)
  cp "$dir/config.yml" "$dir/data/config.yml" 2>/dev/null || true
  echo "motis $name: $first + $days days, ${#datasets[@]} timetables, in $dir"
}

start() {
  if curl -sf -m 2 "http://127.0.0.1:$port/api/v1/health" >/dev/null 2>&1; then echo "motis $name already on :$port"; return; fi
  (cd "$dir" && nohup "$bin" server -d data > "$dir/server.log" 2>&1 </dev/null &)
  for _ in $(seq 1 60); do curl -sf -m 2 "http://127.0.0.1:$port/api/v1/health" >/dev/null 2>&1 && { echo "motis $name on :$port"; return; }; sleep 2; done
  echo "motis $name did not start: $dir/server.log" >&2; exit 1
}

stop() {
  # The MOTIS server running in this instance's folder.
  for p in $(pgrep -f "motis server" || true); do
    [ "$(readlink "/proc/$p/cwd" 2>/dev/null)" = "$dir" ] && kill "$p" && echo "motis $name stopped"
  done
}

case "$cmd" in
  import) import ;;
  start) start ;;
  stop) stop ;;
  *) echo "usage: motis.sh import|start|stop <region>..." >&2; exit 1 ;;
esac
