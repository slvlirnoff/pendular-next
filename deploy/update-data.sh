#!/usr/bin/env bash
# Refreshes the data (timetable, OSM, parking, MOTIS index) without touching what is serving.
#
#   1. builds into a NEW directory  $DATA_DIR/releases/<timestamp>.partial
#   2. checks the result (files present, parking.json parses, a throw-away MOTIS loads it and answers)
#   3. only then renames it to releases/<timestamp>, flips the "current" symlink and recreates the
#      motis and app containers; if the new MOTIS is not healthy afterwards, the symlink is flipped back.
# Any failure before step 3 deletes the partial directory and leaves the running data untouched.
#
# Needs only Docker (with the compose plugin). Run from anywhere:  deploy/update-data.sh
# Options (environment): SKIP_SMOKE=1 skips the throw-away MOTIS check; KEEP_RELEASES=2 (default).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
DEPLOY_DIR=$PWD
REPO_DIR=$(dirname "$DEPLOY_DIR")

if [ -f .env ]; then set -a; . ./.env; set +a; fi
DATA_DIR=$(realpath -m "${DATA_DIR:-./data}")
export DATA_DIR
KEEP_RELEASES=${KEEP_RELEASES:-2}
MIN_FREE_GB=${MIN_FREE_GB:-10}

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

command -v docker >/dev/null || die "docker not found"
mkdir -p "$DATA_DIR/releases"

# One update at a time.
exec 9>"$DATA_DIR/.update.lock"
flock -n 9 || die "another update is running"

free_gb=$(df -Pk "$DATA_DIR" | awk 'NR==2 {print int($4/1024/1024)}')
[ "$free_gb" -ge "$MIN_FREE_GB" ] || die "only ${free_gb} GB free in $DATA_DIR, need ${MIN_FREE_GB} GB (raw download + index)"

STAMP=$(date -u +%Y%m%d-%H%M%S)
NEW="$DATA_DIR/releases/$STAMP.partial"
FINAL="$DATA_DIR/releases/$STAMP"
CHECK_NAME="pendular-motis-check-$STAMP"
cleanup() {
  rc=$?
  docker rm -f "$CHECK_NAME" >/dev/null 2>&1 || true
  if [ -d "$NEW" ]; then
    # Files written by the container may belong to another uid; remove through a container if needed.
    rm -rf "$NEW" 2>/dev/null || docker run --rm -v "$DATA_DIR/releases:/r" --entrypoint rm pendular-data:local -rf "/r/$STAMP.partial" || true
  fi
  [ "$rc" -eq 0 ] || log "FAILED (exit $rc): running data was not touched."
}
trap cleanup EXIT

mkdir -p "$NEW/raw" "$NEW/build" "$NEW/motis"

log "building images (cached when unchanged)"
docker compose build motis data

log "fetching inputs and building into $NEW"
# The scripts and config.yml come from this checkout; raw/, build/ and motis/data from the new directory.
# The MOTIS binary is the one inside the image (same version as the server), so fetch.sh's "motis" step is skipped.
docker compose --profile tools run --rm --no-deps --user "$(id -u):$(id -g)" \
  -v "$REPO_DIR/data/scripts:/pipeline/data/scripts:ro" \
  -v "$REPO_DIR/data/motis/config.yml:/pipeline/data/motis/config.yml:ro" \
  -v "$NEW/raw:/pipeline/data/raw" \
  -v "$NEW/build:/pipeline/data/build" \
  -v "$NEW/motis:/pipeline/data/motis/data" \
  data bash -euxo pipefail -c '
    cd /pipeline/data/scripts
    ./fetch.sh gtfs
    ./fetch.sh osm
    ./fetch.sh parking
    cd /pipeline
    tsx data/scripts/build-parking.ts
    cd /pipeline/data/motis
    motis import -c config.yml -d data
  '

log "checking the result"
[ -s "$NEW/build/parking.json" ] || die "parking.json missing"
docker compose --profile tools run --rm --no-deps --user "$(id -u):$(id -g)" \
  -v "$NEW/build:/b:ro" data node -e '
    const j = JSON.parse(require("fs").readFileSync("/b/parking.json", "utf8"));
    if (!Array.isArray(j.sites) || j.sites.length < 100) { console.error("parking.json: too few sites"); process.exit(1); }
    console.log("parking.json ok:", j.sites.length, "sites");'
for f in config.yml tt.bin; do [ -s "$NEW/motis/$f" ] || die "MOTIS data incomplete: $f missing"; done
[ -d "$NEW/motis/osr" ] || die "MOTIS data incomplete: osr/ missing"

# Release layout: parking.json at the top, MOTIS data in motis/. The raw downloads are not kept.
mv "$NEW/build/parking.json" "$NEW/parking.json"
rmdir "$NEW/build"
rm -rf "$NEW/raw"
chmod -R a+rX "$NEW"

if [ -z "${SKIP_SMOKE:-}" ]; then
  log "smoke test: starting a throw-away MOTIS on the new data"
  docker run -d --name "$CHECK_NAME" --memory 1536m -v "$NEW/motis:/data:ro" pendular-motis:local >/dev/null
  ok=
  for _ in $(seq 1 60); do
    if docker exec "$CHECK_NAME" curl -fsS http://127.0.0.1:8080/api/v1/health >/dev/null 2>&1; then ok=1; break; fi
    [ "$(docker inspect -f '{{.State.Running}}' "$CHECK_NAME")" = true ] || break
    sleep 5
  done
  [ -n "$ok" ] || { docker logs --tail 30 "$CHECK_NAME" || true; die "new MOTIS did not become healthy"; }
  hits=$(docker exec "$CHECK_NAME" curl -fsS 'http://127.0.0.1:8080/api/v1/geocode?text=Lausanne' | grep -o '"type"' | wc -l)
  [ "$hits" -gt 0 ] || die "new MOTIS geocoder returned nothing for 'Lausanne'"
  docker rm -f "$CHECK_NAME" >/dev/null
  log "smoke test ok ($hits geocoder hits)"
fi

# ---- swap (nothing above this line has changed what is served) ----
PREVIOUS=$(readlink "$DATA_DIR/current" 2>/dev/null || true)
mv "$NEW" "$FINAL"
ln -sfn "releases/$STAMP" "$DATA_DIR/current.tmp"
mv -T "$DATA_DIR/current.tmp" "$DATA_DIR/current"
log "current -> releases/$STAMP (previous: ${PREVIOUS:-none})"

recreate() { docker compose up -d --force-recreate --no-deps motis app; }

if [ -n "$(docker compose ps -q motis 2>/dev/null)" ]; then
  log "recreating motis and app"
  recreate
  healthy=
  for _ in $(seq 1 60); do
    st=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q app)" 2>/dev/null || true)
    if [ "$st" = healthy ]; then healthy=1; break; fi
    sleep 5
  done
  if [ -z "$healthy" ]; then
    log "services not healthy with the new data"
    if [ -n "$PREVIOUS" ] && [ -d "$DATA_DIR/$PREVIOUS" ]; then
      log "rolling back to $PREVIOUS"
      ln -sfn "$PREVIOUS" "$DATA_DIR/current.tmp"; mv -T "$DATA_DIR/current.tmp" "$DATA_DIR/current"
      recreate
    fi
    die "update rolled back"
  fi
else
  log "stack not running yet: start it with  docker compose up -d"
fi

# Keep the newest releases (rollback), delete the rest.
mapfile -t old < <(find "$DATA_DIR/releases" -mindepth 1 -maxdepth 1 -type d ! -name '*.partial' -printf '%f\n' | sort -r | tail -n +"$((KEEP_RELEASES + 1))")
for r in "${old[@]}"; do
  [ "releases/$r" = "$(readlink "$DATA_DIR/current")" ] && continue
  log "removing old release $r"
  rm -rf "$DATA_DIR/releases/$r"
done
log "done"
