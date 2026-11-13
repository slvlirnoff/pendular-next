#!/usr/bin/env bash
# Trajestaurant: places to eat, shops and other places one goes to, from the region's
# OpenStreetMap extract, merged with the other sources (import/fetch.sh) and loaded into
# PostgreSQL by import/build.ts. Needs the osmium command-line tool. DATABASE_URL defaults to the
# region's local database of scripts/dev.sh (src/regions.ts).
#
#   pnpm --filter @pendular/trajestaurant import:osm                    # Switzerland
#   REGION=vinnytsia pnpm --filter @pendular/trajestaurant import:osm   # Vinnytsia (Тролейбуфет)
#
# The extract (OSM_PBF) and the folder of the other sources (TRAJ_OUT/src) by region:
#   ch         data/raw/switzerland.osm.pbf (data/scripts/fetch.sh osm), data/build/trajestaurant
#   vinnytsia  data/raw/vinnytsia_oblast.osm.pbf, data/build/vinnytsia (tools/vinnytsia/fetch.sh)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
case "${REGION:-ch}" in
  ch)
    pbf="${OSM_PBF:-$root/data/raw/switzerland.osm.pbf}"
    [ -f "$pbf" ] || pbf="$root/data/raw/switzerland-raw.osm.pbf"
    out="${TRAJ_OUT:-$root/data/build/trajestaurant}" ;;
  vinnytsia)
    pbf="${OSM_PBF:-$root/data/raw/vinnytsia_oblast.osm.pbf}"
    out="${TRAJ_OUT:-$root/data/build/vinnytsia}" ;;
  *) echo "unknown REGION ${REGION}" >&2; exit 1 ;;
esac
[ -f "$pbf" ] || { echo "no OSM extract $pbf: run data/scripts/fetch.sh osm or tools/vinnytsia/fetch.sh osm" >&2; exit 1; }
mkdir -p "$out"

# Food places, shops, services and other places one goes to (points, buildings and areas), any
# place of a brand, and the towns and villages that name where they are. src/kinds.ts (mainKind)
# keeps what Trajestaurant shows: recycling centres and not the street containers, the offices one
# visits and not every company.
osmium tags-filter "$pbf" \
  nwr/amenity=restaurant,fast_food,cafe,ice_cream,food_court,biergarten,pub,bar \
  nwr/amenity=pharmacy,fuel,bank,post_office,cinema,car_rental,theatre,library,marketplace \
  nwr/amenity=doctors,dentist,clinic,hospital,veterinary,police,townhall,courthouse,driving_school \
  nwr/amenity=car_wash,vehicle_inspection,recycling,atm,bureau_de_change,bicycle_rental \
  nwr/healthcare nwr/craft \
  nwr/office=employment_agency,insurance,estate_agent,lawyer,notary,accountant,tax_advisor,government,diplomatic,coworking,physician,travel_agent \
  nwr/shop \
  nwr/leisure=fitness_centre,sports_centre,bowling_alley,escape_game,trampoline_park,water_park,amusement_arcade,ice_rink,swimming_pool \
  nwr/tourism=hotel,motel,hostel,museum,zoo,theme_park,attraction \
  nwr/brand:wikidata \
  n/place=city,town,village \
  -o "$out/food.osm.pbf" --overwrite --no-progress
# One GeoJSON feature per line; areas as polygons (the loader takes their centre).
osmium export "$out/food.osm.pbf" -f geojsonseq --format-option=print_record_separator=false \
  --add-unique-id=type_id --geometry-types=point,polygon \
  -o "$out/food.geojsonseq" --overwrite --no-progress
echo "extracted $(wc -l < "$out/food.geojsonseq") features from $(basename "$pbf")"
cd "$here/.." && pnpm exec tsx import/build.ts "$out/food.geojsonseq" --src "$out/src"
