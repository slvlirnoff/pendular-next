# Pendular

Compares the ways of commuting between a home and a workplace in Switzerland over a year:
cost, door-to-door time, changes, frequency and CO₂. Prices are tuned for the canton of Vaud
(Mobilis); national tariffs elsewhere. Estimates for comparison, not binding prices.

## Layout

| Path | What |
| --- | --- |
| `packages/engine` | The commute engine: planner, fares, zones, CO₂, routing adapter. No state, no personal data. |
| `packages/engine/data` | Tariff tables, zone table, emission factors: data with sources and validity dates. |
| `apps/api` | HTTP API (`POST /api/compare`, `GET /api/places`). |
| `apps/web` | The site. |
| `apps/analytics` | Commute Analytics: staff list, address check, analysis for a site, indicators, export. |
| `data/` | Data pipeline: fetch scripts, MOTIS configuration, parking build. Raw and built data are not committed. |
| `tools/` | One-off extraction tools (Mobilis zones). |

## Run locally

Needs Node 22 with pnpm, the osmium command-line tool (`apt install osmium-tool` or
`brew install osmium-tool`), Python 3 with the `osmium` package (`pip install osmium`), about
6 GB of free memory for the MOTIS import and 8 GB of disk. Commute Analytics also needs
PostgreSQL 16.

```sh
pnpm install
data/scripts/fetch.sh                      # timetable, streets, parking, MOTIS binary (about 1 GB)
pnpm tsx data/scripts/build-parking.ts     # data/build/parking.json
(cd data/motis && ./bin/motis import -c config.yml -d data)   # about 5 minutes
scripts/dev.sh                             # starts PostgreSQL, MOTIS, API, analytics and the site
pnpm test
```

| Service | Address |
| --- | --- |
| Site (Pendular) | http://127.0.0.1:5173 |
| API | http://127.0.0.1:8787 |
| Commute Analytics (no sign-in, this machine only) | http://127.0.0.1:8788 |
| MOTIS | http://127.0.0.1:8080 |
| PostgreSQL | port 5433, database and user `pendular` |

Good to know:

- `scripts/dev.sh` starts only what is not already running, and writes logs to
  `/tmp/pendular-logs`. Do not pipe its output (it waits for the pipe to close).
- It finds PostgreSQL under `/usr/lib/postgresql/*/bin` (Debian, Ubuntu). Elsewhere, start
  PostgreSQL yourself on port 5433 with a database and a user named `pendular`, or start
  analytics by hand: `DATABASE_URL=postgres://… pnpm --filter ./apps/analytics start`.
- The API and analytics read their data files once at start: restart them after changing
  tariffs, zones or parking, and after a new MOTIS import.
- The first search after MOTIS starts takes several seconds; later ones about one second.
- Fare zones, tariff kilometres, density and tariff tables are committed, so no extra step.
  Refresh the official fare data with `pnpm tsx tools/nova-import/import.ts` (6 minutes).
- Check results against the reference commutes: `pnpm tsx tools/golden/run.ts`
  (`--update` records the current results as the new reference).
- An example staff list for Commute Analytics: `apps/analytics/examples/staff-chuv.csv`
  (60 invented people around Lausanne, with a few wrong addresses on purpose).

### MOTIS fork (optional)

With the release MOTIS, the last trip home of a public-transport option is the last connection by
the route of the morning trip. A patched MOTIS (`tools/motis-fork`, see its README for the build)
can search on every line a zone pass covers instead. It reads the same imported data, on its own
port, with the segment file `tools/motis-fork/segments.csv` (zones of every section between two
consecutive stops, all zonal networks; rewrite it with `pnpm tsx tools/motis-fork/export-segments.ts`):

```sh
MOTIS_SEGMENT_TAGS=$PWD/tools/motis-fork/segments.csv <motis-build>/motis server -d <copy of data/motis/data, port 8082>
(cd apps/api && MOTIS_URL=http://127.0.0.1:8082 MOTIS_SEGMENT_FILTER=1 pnpm start)
```

`MOTIS_SEGMENT_FILTER=1` is off by default and must only be set when `MOTIS_URL` is the fork.
Each option then says which search gave its last trip home (`returnTrips.within`: `pass`, `route`
or `any`). Deployment: `deploy/README.md`.

## Data and credits

Timetable and parking: opentransportdata.swiss. Streets and places: © OpenStreetMap contributors.
Routing: MOTIS. Tariffs: Mobilis, Alliance SwissPass. Emission factors: mobitool.
Pictograms: SBB. Car costs: TCS.
