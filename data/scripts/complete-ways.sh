#!/usr/bin/env bash
# Makes an OSM extract complete for ways: no way may reference a node the file does not hold
# (MOTIS's street import stops on those). Needs the osmium command-line tool (package
# "osmium-tool") and python3 with the "osmium" package.
#
#   complete-ways.sh IN.osm.pbf OUT.osm.pbf
set -euo pipefail
in="$1"; out="$2"
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/complete-ways.XXXXXX")"; trap 'rm -rf "$tmp"' EXIT

# 1. Which ways reference a node that is not in the file ("n<node> in w<way>").
osmium check-refs --show-ids "$in" > "$tmp/missing.txt" 2> "$tmp/check.log" || true
awk '$2 == "in" && $3 ~ /^w/ { print $3 }' "$tmp/missing.txt" | sort -u > "$tmp/ways.txt"
n="$(wc -l < "$tmp/ways.txt")"
echo "ways with missing nodes: $n"
if [ "$n" -eq 0 ]; then cp "$in" "$out"; exit 0; fi

# 2. Take those ways out, trim them, and put them back.
osmium getid --id-file "$tmp/ways.txt" "$in" -o "$tmp/affected.osm.pbf" --no-progress
osmium removeid --id-file "$tmp/ways.txt" "$in" -o "$tmp/rest.osm.pbf" --no-progress
python3 "$here/complete-ways.py" "$tmp/missing.txt" "$tmp/affected.osm.pbf" "$tmp/fixed.osm.pbf"
osmium merge "$tmp/rest.osm.pbf" "$tmp/fixed.osm.pbf" -o "$out" --overwrite --no-progress

# 3. Prove it.
osmium check-refs "$out" 2>&1 | grep -E "missing|There are" || true
