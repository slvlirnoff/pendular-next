#!/usr/bin/env bash
# Trajestaurant: restaurants, cafés, fast food and ice cream from the Swiss OpenStreetMap extract
# (data/raw/switzerland.osm.pbf, fetched by data/scripts/fetch.sh osm) into PostgreSQL.
# Needs the osmium command-line tool. DATABASE_URL defaults to the local database of scripts/dev.sh.
#
#   pnpm --filter @pendular/trajestaurant import:osm
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
pbf="${OSM_PBF:-$root/data/raw/switzerland.osm.pbf}"
[ -f "$pbf" ] || pbf="$root/data/raw/switzerland-raw.osm.pbf"
[ -f "$pbf" ] || { echo "no OSM extract: run data/scripts/fetch.sh osm" >&2; exit 1; }
out="$root/data/build/trajestaurant"; mkdir -p "$out"

# Food places (points, buildings and areas) and the towns and villages that name where they are.
osmium tags-filter "$pbf" \
  nwr/amenity=restaurant,fast_food,cafe,ice_cream,food_court,biergarten \
  n/place=city,town,village \
  -o "$out/food.osm.pbf" --overwrite --no-progress
# One GeoJSON feature per line; areas as polygons (the loader takes their centre).
osmium export "$out/food.osm.pbf" -f geojsonseq --format-option=print_record_separator=false \
  --add-unique-id=type_id --geometry-types=point,polygon \
  -o "$out/food.geojsonseq" --overwrite --no-progress
echo "extracted $(wc -l < "$out/food.geojsonseq") features from $(basename "$pbf")"
cd "$here/.." && pnpm exec tsx import/load.ts "$out/food.geojsonseq"
