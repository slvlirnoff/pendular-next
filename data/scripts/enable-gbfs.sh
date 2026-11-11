#!/usr/bin/env bash
# Adds the national shared-mobility feed (GBFS, sharedmobility.ch) to the MOTIS configuration,
# so that the planner can suggest shared bikes. See data/motis/GBFS.md.
#
#   SHAREDMOBILITY_CONTACT=someone@example.org bash data/scripts/enable-gbfs.sh
#
# The feed asks for a contact e-mail address in a request header. It is read from the
# environment and written only to data/motis/data/config.yml, which is not in the repository.
# Running it again changes nothing. Restart MOTIS afterwards; no re-import is needed.
set -euo pipefail
cd "$(dirname "$0")/../.."
CONFIG="${MOTIS_CONFIG:-data/motis/data/config.yml}"

if [ -z "${SHAREDMOBILITY_CONTACT:-}" ]; then
  echo "SHAREDMOBILITY_CONTACT is not set: the feed needs a contact e-mail address." >&2
  exit 1
fi
case "$SHAREDMOBILITY_CONTACT" in
  *[[:space:]]* | *'"'* | *"'"*) echo "SHAREDMOBILITY_CONTACT must be a plain e-mail address." >&2; exit 1 ;;
  *@*.*) ;;
  *) echo "SHAREDMOBILITY_CONTACT must be an e-mail address." >&2; exit 1 ;;
esac
if [ ! -f "$CONFIG" ]; then
  echo "$CONFIG not found: import the MOTIS data first." >&2
  exit 1
fi
if grep -q '^gbfs:' "$CONFIG"; then
  echo "$CONFIG already has a gbfs block: nothing changed."
  exit 0
fi

# A line break first, in case the file does not end with one.
[ -z "$(tail -c1 "$CONFIG")" ] || echo >> "$CONFIG"
cat >> "$CONFIG" <<YAML
gbfs:
  feeds:
    sharedmobility:
      url: https://gbfs.prod.sharedmobility.ch/v2/gbfs
      headers:
        Authorization: $SHAREDMOBILITY_CONTACT
  update_interval: 300
  http_timeout: 60
YAML
echo "gbfs block added to $CONFIG. Restart MOTIS to load the feed (about 30 seconds)."
