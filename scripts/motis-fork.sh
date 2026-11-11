#!/usr/bin/env bash
# The MOTIS fork (branch segment-tags) for local work, from the published image.
#
#   scripts/motis-fork.sh pull      pull the image
#   scripts/motis-fork.sh binary    copy the fork binary out of the image to data/motis/bin/motis-fork
#                                   (then scripts/dev.sh uses it without Docker; needs a Linux with
#                                   glibc 2.39 or later, e.g. Ubuntu 24.04)
#   scripts/motis-fork.sh import    run `motis import` with the image (after data/scripts/fetch.sh)
#   scripts/motis-fork.sh stop      stop the container started by scripts/dev.sh
#
# The image is private by default: `docker login ghcr.io` with a token that can read packages.
set -euo pipefail
cd "$(dirname "$0")/.."
IMAGE="${MOTIS_IMAGE:-ghcr.io/slvlirnoff/pendular-motis:fork-latest}"
case "${1:-}" in
  pull) docker pull "$IMAGE" ;;
  binary)
    id="$(docker create "$IMAGE")"
    mkdir -p data/motis/bin
    docker cp "$id:/usr/local/bin/motis" data/motis/bin/motis-fork
    docker rm "$id" >/dev/null
    chmod +x data/motis/bin/motis-fork
    data/motis/bin/motis-fork --version ;;
  import)
    docker run --rm --user "$(id -u):$(id -g)" -v "$PWD/data:/work" -w /work/motis "$IMAGE" \
      motis import -c config.yml -d data ;;
  stop) docker rm -f pendular-motis ;;
  *) sed -n '2,12p' "$0"; exit 1 ;;
esac
