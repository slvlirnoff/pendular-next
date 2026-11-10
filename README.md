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
| `data/` | Data pipeline: fetch scripts, MOTIS configuration, parking build. Raw and built data are not committed. |
| `tools/` | One-off extraction tools (Mobilis zones). |

## Run locally

```sh
pnpm install
data/scripts/fetch.sh                      # GTFS, OSM, parking, MOTIS binary
pnpm tsx data/scripts/build-parking.ts     # data/build/parking.json
(cd data/motis && ./bin/motis import -c config.yml -d data && ./bin/motis server -d data)
pnpm dev:api                               # :8787
pnpm dev:web                               # :5173
pnpm test
```

## Data and credits

Timetable and parking: opentransportdata.swiss. Streets and places: © OpenStreetMap contributors.
Routing: MOTIS. Tariffs: Mobilis, Alliance SwissPass. Emission factors: mobitool.
Pictograms: SBB. Car costs: TCS.
