# Trajestaurant

Find where to eat nearby (pizza, burger, sushi…), the nearest branch of a chain (Migros, IKEA,
Manor, Dosenbach…) or a place by its name, and how to get there: on foot, by public transport or
by car. Built on the Pendular infrastructure: the same MOTIS (streets and Swiss
timetable), the same PostgreSQL, the same map style. French interface, phone first.

Three screens: a welcome screen (sign-in comes later), a full map with a search bar and the list
of places with their travel times, and a place with its routes and what is known about it. The
search bar suggests food types, chains ("Migros · 747 in Switzerland"), all places of a name
("all « mix image »") and single places, nearest first.

## Layout

| Path | What |
| --- | --- |
| `src/foods.ts` | The 32 food types (emoji, label, synonyms) and how a place gets them: cuisine, brand, name |
| `src/kinds.ts` | Which kinds of places are kept (shops, pharmacies, fuel, fitness…), with emoji and French label |
| `src/api.ts` | What the API answers (shared by server and site) |
| `import/fetch.sh` | Downloads the other sources: Name Suggestion Index, All The Places (Swiss places of every chain), Overture (food and drink) |
| `import/osm.sh` | Extracts the places from the Swiss OSM extract, then runs `build.ts` |
| `import/build.ts` | Merges the four sources and loads them into PostgreSQL (places, food types, chains, towns) |
| `server/` | Hono API on port 8789; also serves the built site |
| `web/` | The site (Vite, React, MapLibre) |
| `SOURCES.md` | Other data sources studied (Overture, Foursquare, All The Places, open government data…), in French |

## Run locally

Needs what Pendular needs (see the main README): the Swiss OSM extract and an imported MOTIS,
PostgreSQL with PostGIS (`apt install postgresql-16-postgis-3`), and Python 3 with duckdb
(`pip install duckdb`) for Overture.

```sh
data/scripts/fetch.sh                                   # once: OSM, timetable, MOTIS
(cd data/motis && ./bin/motis import -c config.yml -d data)
scripts/dev.sh                                          # PostgreSQL on 5433 and MOTIS on 8080 (and Pendular)
bash apps/trajestaurant/import/fetch.sh                 # NSI, Overture (10 s), All The Places (2 min)
pnpm --filter @pendular/trajestaurant import:osm        # creates the database "trajestaurant" (about 1 minute)
pnpm --filter @pendular/trajestaurant dev:server        # API on http://127.0.0.1:8789
pnpm --filter @pendular/trajestaurant dev:web           # site on http://127.0.0.1:5174
```

Production: `pnpm --filter @pendular/trajestaurant build`, then `pnpm --filter @pendular/trajestaurant start`
serves the site and the API on port 8789. Settings: `DATABASE_URL` (default
`postgres://pendular@127.0.0.1:5433/trajestaurant`), `MOTIS_URL`, `PORT`.

A link can open a search directly: `/?ici=46.7085,6.8405,Lucens&food=burger`, `&brand=ikea` (a
chain by its name in lower case) or `&name=mix image`, and `&r=<id>` for a place.

## How the travel times are found

- **Candidates**: the 40 nearest places of the food type within 40 km (PostGIS); for a chain or a
  name, the 24 nearest within 250 km (the nearest IKEA from Lucens is 43 km away), places of one
  chain within 150 m counted once (a store and its café).
- **On foot and by car**: two MOTIS matrix calls for the whole list (on foot up to an hour; by car
  long enough for the farthest place, up to three hours).
- **Public transport**: one MOTIS one-to-all call from the searcher (leaving now, waiting
  included, up to 90 minutes) gives the time to every stop; each restaurant takes the best stop
  within 700 m plus the walk. Shown only when it beats walking.
- **A place**: the real routes (MOTIS plan): walk, car, and the next departures within two hours.

The imported timetable is the 2027 one (from 13.12.2026). On a day it does not cover, searches use
the same weekday and time of the week of 18.01.2027, and the site says it is a typical timetable.

Opening hours come from All The Places for chains, else OSM (`opening_hours`), read with the
opening_hours library in Swiss time.

## Data

| Source | What it gives | Licence |
| --- | --- | --- |
| OpenStreetMap | 126 600 places: places to eat, shops, pharmacies, fuel, banks, fitness, hotels…; towns | ODbL |
| All The Places | 14 200 branches of 207 chains from their own store finders, 10 600 with opening hours: 6 300 complete OSM places (their hours replace OSM's), 7 300 are added | CC0 |
| Overture Maps places | 49 000 places to eat: 19 000 add food types to known places, 22 400 are added (confidence ≥ 0.6, or lower with a phone or website); the others are left out | CDLA-Permissive-2.0 (some Apache-2.0, CC0) |
| Name Suggestion Index | The chains present in Switzerland: brand of places tagged with a name only ("Migros Lucens"), cuisine of chains, proper names | BSD-3-Clause |

In all about 156 000 places, of which 1 456 chains with at least two places. Lucens, almost empty
in OSM (three places within 3 km), now has Sherlock, Vesuvio, Grill House and the Café du Poids,
from Overture. Other sources studied: `SOURCES.md` (in French).

Credits: © OpenStreetMap contributors, Overture Maps Foundation, All The Places, name-suggestion-index;
routing MOTIS with the timetable of opentransportdata.swiss.
