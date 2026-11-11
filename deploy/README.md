# Deploying Pendular on one VM

Three long-running containers behind one domain:

```
internet -> caddy (80/443, TLS, compression, headers) -> app (site + API, :8787) -> motis (routing, :8080)
```

Only `caddy` publishes ports. `motis` and `app` are reachable inside the compose network only.
Data (timetable index, parking) is built by a one-off container and mounted read-only.

| File | Purpose |
| --- | --- |
| `compose.yml`, `Caddyfile`, `.env.example` | the stack |
| `Dockerfile.app` | site build + API (Node 22, pnpm via corepack, non-root `node`, cwd `apps/api`) |
| `Dockerfile.motis` | MOTIS binary from a **pinned** release, non-root, serves a mounted data dir |
| `Dockerfile.data` | one-off tooling: curl, bzip2, python3 + osmium, node + tsx, the same MOTIS binary |
| `compose.motis-fork.yml`, `Dockerfile.motis-fork` | optional: the patched MOTIS (last trip home inside the zones of a pass), see below |
| `update-data.sh` | builds new data aside, checks it, swaps it in (also the first data build) |

Why the MOTIS binary is downloaded at build time (pinned `MOTIS_VERSION`) instead of copied from
`data/motis/bin`: the image builds identically on any machine with no prior setup, and the data image
takes the binary *from the motis image*, so the index is always written and read by the same MOTIS
version. `fetch.sh` uses `latest`, which would let server and index drift apart.

## Sizing

| | |
| --- | --- |
| VM | 2 vCPU, **4 GB RAM**, 40 GB disk (Infomaniak Public Cloud: e.g. a 2 vCPU / 4 GB flavour) |
| Running | motis ~0.8 GB resident (limit 1.5 GB), app ~0.1-0.2 GB, caddy ~0.03 GB |
| Data refresh | the MOTIS import needs ~3 GB RAM for ~2 minutes while the stack keeps running: **add a 4 GB swap file** (below) |
| Disk | images ~1.5 GB; each release ~2 GB (two kept: current + previous); a refresh temporarily needs ~2 GB more for the raw downloads (the script refuses to start with less than 10 GB free) |

## First deployment

1. **VM.** Ubuntu 24.04 (or similar), Docker Engine with the compose plugin. Open inbound TCP 80 and
   443 (and UDP 443 for HTTP/3) in the Infomaniak security group; keep SSH restricted.
2. **Swap** (needed for the import on 4 GB):
   ```sh
   sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```
3. **DNS.** Create an A (and AAAA) record for your host name pointing to the VM's public IP *before*
   starting Caddy, otherwise the certificate request fails.
4. **Clone and configure.**
   ```sh
   git clone <repo-url> pendular && cd pendular/deploy
   cp .env.example .env
   $EDITOR .env        # SITE_ADDRESS=pendular.example.ch ; DATA_DIR=/srv/pendular (any path with ~10 GB free)
   sudo mkdir -p /srv/pendular && sudo chown "$USER" /srv/pendular
   ```
5. **First data build** (downloads ~1 GB, imports ~2 min; builds the images first):
   ```sh
   ./update-data.sh
   ```
   It ends with "stack not running yet" and the `current` symlink in place.
6. **Start.**
   ```sh
   docker compose up -d
   docker compose ps          # motis becomes healthy after ~1 min, then app, then caddy
   curl -s https://pendular.example.ch/api/health
   ```
   Without a domain (`SITE_ADDRESS=localhost`) the site is at `https://localhost` with Caddy's local certificate.

If `docker compose up` complains that `.../current/motis` does not exist, step 5 has not completed:
that is intentional (compose will not invent an empty data directory).

## Updating the app

```sh
cd pendular && git pull
cd deploy && docker compose up -d --build app caddy
```
`app` is rebuilt (lockfile is respected: `pnpm install --frozen-lockfile`). To change the MOTIS
version, edit `MOTIS_VERSION` in `.env`, then `docker compose build motis data && ./update-data.sh`
(the index must be rebuilt with the new binary).

## Optional: the MOTIS fork (last trip home with a zone pass)

Off by default. The patched MOTIS (`tools/motis-fork`) can restrict a search to the route sections
a zone pass covers; the app then shows the last trip home by any line of the pass instead of the
last one by the morning's route. The image `ghcr.io/<owner>/pendular-motis:fork-latest` is built by
`.github/workflows/motis-fork-image.yml` (never on the VM: 25 minutes on 4 cores). To use it, add to `.env`:

```sh
COMPOSE_FILE=compose.yml:compose.motis-fork.yml
GHCR_OWNER=<github owner of the repository, lower case>
```

and run `docker compose up -d`. The overlay replaces the `motis` image, mounts
`tools/motis-fork/segments.csv` from the checkout (`SEGMENTS_FILE` to use another file) at the path
given in `MOTIS_SEGMENT_TAGS`, and sets `MOTIS_SEGMENT_FILTER=1` on `app`. Both must go together:
the filter with the release MOTIS makes every last-trip search fail (the app then falls back to
the route search, so nothing breaks, but nothing is gained either). The fork is the same MOTIS
version, so the imported data and `update-data.sh` are unchanged; a private image needs
`docker login ghcr.io` first. Regenerate the segment file after a new timetable year or a fare
data import (`pnpm tsx tools/motis-fork/export-segments.ts`, about 20 seconds, needs
`data/raw/gtfs.zip`) and recreate `motis`. Check the log line
`segments.csv: … rows, … route sections tagged` in `docker compose logs motis`.
This overlay has not been run on a VM yet (needs Docker Compose 2.24 or later for `!reset`).

## Weekly data refresh

`./update-data.sh` builds into `$DATA_DIR/releases/<timestamp>.partial`, then verifies: `parking.json`
parses and has sites, MOTIS files exist, and a throw-away MOTIS container loads the new index and
geocodes "Lausanne". Only then does it rename the directory, flip the `current` symlink, and recreate
`motis` and `app` (about a minute of downtime for routing; recreate, not restart, because the bind
mount is resolved when the container is created). If the recreated services are not healthy, it flips
back to the previous release. Any earlier failure deletes the partial directory; running data is never
touched. Two releases are kept (`KEEP_RELEASES`).

Check it by hand once: `./update-data.sh` then `docker compose ps`.

Schedule (not installed automatically). systemd, `/etc/systemd/system/pendular-data.service`:
```ini
[Unit]
Description=Pendular data refresh
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
User=pendular            # a user in the docker group
ExecStart=/home/pendular/pendular/deploy/update-data.sh
TimeoutStartSec=2h
```
and `/etc/systemd/system/pendular-data.timer`:
```ini
[Unit]
Description=Weekly Pendular data refresh

[Timer]
OnCalendar=Tue *-*-* 04:30:00
RandomizedDelaySec=15min
Persistent=true

[Install]
WantedBy=timers.target
```
`sudo systemctl daemon-reload && sudo systemctl enable --now pendular-data.timer`.
Cron alternative: `30 4 * * 2 /home/pendular/pendular/deploy/update-data.sh >> /var/log/pendular-data.log 2>&1`.

Note the timetable year in `data/motis/config.yml` (`first_day`, 364 days): when a new timetable year
starts, update it in the repository and the `GTFS_URL` default in `data/scripts/fetch.sh` (or set
`GTFS_URL` in `.env`; `OSM_URL` and `PARKING_URL` work the same way).

## Backups

Nothing personal is stored: the app keeps no database, no sessions, no logs of requests beyond the
container stdout (Caddy access log, rotated by Docker at 3 x 10 MB). Everything is reproducible from
the repository plus `update-data.sh`.

Worth keeping (all small): your `deploy/.env`, and the Caddy `caddy_data` volume (TLS account and
certificates; losing it only means re-issuing, but Let's Encrypt has rate limits):
```sh
docker run --rm -v pendular_caddy_data:/d -v "$PWD":/b alpine tar czf /b/caddy_data.tgz -C /d .
```
Not worth backing up: `$DATA_DIR/releases` (rebuilt in ~10 minutes). Take a VM snapshot before
big changes if you like.

## Operations

```sh
docker compose logs -f app            # also: motis, caddy
docker compose ps
docker compose restart app            # does NOT pick up new data; use update-data.sh
```
