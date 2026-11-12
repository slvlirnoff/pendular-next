#!/usr/bin/env bash
# Trajestaurant: downloads the sources besides OpenStreetMap into data/build/trajestaurant/src.
#   - Name Suggestion Index (brands: proper names, Wikidata ids, cuisine of the chains, logos)
#   - All The Places: every spider with places in Switzerland, its Swiss places only
#   - Overture Maps places: food and drink in Switzerland (needs python3 with duckdb)
#   - car-sharing stations from the national shared-mobility feed (needs SHAREDMOBILITY_CONTACT,
#     a contact e-mail address the feed asks for; skipped without it)
#
#   bash import/fetch.sh [nsi|atp|overture|carsharing|all]
# A failed download never replaces a good file (written to .part, moved on success).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
out="$root/data/build/trajestaurant/src"; mkdir -p "$out"
UA="trajestaurant-data-pipeline"
NSI_VERSION="${NSI_VERSION:-8.0.20261101}"

nsi() {
  curl -fsSL --retry 4 -A "$UA" "https://cdn.jsdelivr.net/npm/name-suggestion-index@$NSI_VERSION/dist/json/nsi.min.json" -o "$out/nsi.json.part"
  mv "$out/nsi.json.part" "$out/nsi.json"
  # The brands' Wikidata facts: their logos (Wikimedia Commons) for the place card.
  curl -fsSL --retry 4 -A "$UA" "https://cdn.jsdelivr.net/npm/name-suggestion-index@$NSI_VERSION/dist/wikidata/wikidata.min.json" -o "$out/nsi-wikidata.json.part"
  mv "$out/nsi-wikidata.json.part" "$out/nsi-wikidata.json"
  echo "nsi $NSI_VERSION"
}

atp() {
  local base="https://alltheplaces-data.openaddresses.io/runs"
  local run; run="$(curl -fsSL -A "$UA" https://data.alltheplaces.xyz/runs/latest.json | python3 -c 'import json,sys; print(json.load(sys.stdin)["run_id"])')"
  local dir="$out/atp-$run"; mkdir -p "$dir/stats" "$dir/ch"
  # Which spiders have places in Switzerland: each spider's stats count its places per country.
  curl -fsSL -A "$UA" "$base/$run/stats/_results.json" \
    | python3 -c 'import json,sys; [print(r["spider"]) for r in json.load(sys.stdin)["results"] if r["features"] > 0]' > "$dir/spiders.txt"
  xargs -P 32 -I{} sh -c "[ -s '$dir/stats/{}.json' ] || curl -fsS -m 60 -A '$UA' -o '$dir/stats/{}.json' '$base/$run/stats/{}.json' || true" < "$dir/spiders.txt"
  python3 "$here/atp_select.py" "$dir/stats" > "$dir/ch-spiders.txt"
  echo "atp $run: $(wc -l < "$dir/ch-spiders.txt") spiders with Swiss places"
  # Each spider's file, keeping its Swiss places only (one GeoJSON feature per line).
  xargs -P 8 -I{} sh -c "[ -s '$dir/ch/{}.geojsonseq' ] || { curl -fsS -m 900 -A '$UA' '$base/$run/output/{}.geojson' | python3 '$here/atp_filter.py' > '$dir/ch/{}.part' && mv '$dir/ch/{}.part' '$dir/ch/{}.geojsonseq'; } || echo 'failed: {}' >&2" < "$dir/ch-spiders.txt"
  cat "$dir"/ch/*.geojsonseq > "$out/atp.geojsonseq.part" && mv "$out/atp.geojsonseq.part" "$out/atp.geojsonseq"
  echo "$run" > "$out/atp-run.txt"
  echo "atp: $(wc -l < "$out/atp.geojsonseq") Swiss places"
}

overture() {
  python3 "$here/overture.py" "$out/overture.jsonl.part" && mv "$out/overture.jsonl.part" "$out/overture.jsonl"
  echo "overture: $(wc -l < "$out/overture.jsonl") places"
}

carsharing() {
  if [ -z "${SHAREDMOBILITY_CONTACT:-}" ]; then
    echo "carsharing: SHAREDMOBILITY_CONTACT not set, skipped (the feed needs a contact e-mail address)" >&2
    return 0
  fi
  python3 "$here/carsharing.py" "$out/carsharing.jsonl.part" && mv "$out/carsharing.jsonl.part" "$out/carsharing.jsonl"
}

case "${1:-all}" in
  nsi) nsi ;;
  atp) atp ;;
  overture) overture ;;
  carsharing) carsharing ;;
  all) nsi; overture; atp; carsharing ;;
  *) echo "usage: fetch.sh [nsi|atp|overture|carsharing|all]" >&2; exit 1 ;;
esac
