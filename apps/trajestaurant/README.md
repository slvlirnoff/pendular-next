# Trajestaurant

Find where to eat nearby (pizza, burger, sushi…), the nearest shop or place of a kind (pharmacy,
hairdresser, fuel, post office, cinema…), the nearest branch of a chain (Migros, IKEA, Manor,
Dosenbach…) or a place by its name, and how to get there: on foot, by public transport or by car. Built on the Pendular infrastructure: the same MOTIS (streets and Swiss
timetable), the same PostgreSQL, the same map style. French interface, phone first.

Three screens: a welcome screen (sign-in comes later), a full map with a search bar and the list
of places with their travel times, and a place with its routes and what is known about it. The
search bar suggests food types, kinds of shops and places, chains ("Migros · 747 in Switzerland"),
all places of a name ("all « mix image »") and single places, nearest first. Shortcuts under it:
food types, kinds of shops, well-known chains.

## Layout

| Path | What |
| --- | --- |
| `src/foods.ts` | The 32 food types (emoji, label, synonyms) and how a place gets them: cuisine, brand, name |
| `src/kinds.ts` | Which kinds of places are kept (shops, pharmacies, fuel, fitness…), with emoji and French label; the 50 kinds one can search for (each one or more OSM kinds, synonyms in four languages) |
| `src/api.ts` | What the API answers (shared by server and site) |
| `import/fetch.sh` | Downloads the other sources: Name Suggestion Index, All The Places (Swiss places of every chain), Overture (food and drink; shops, hairdressers and gyms it is sure of) |
| `import/osm.sh` | Extracts the places from the Swiss OSM extract, then runs `build.ts` |
| `import/build.ts` | Merges the four sources and loads them into PostgreSQL (places, food types, chains, towns) |
| `server/` | Hono API on port 8789; also serves the built site. `car.ts`: car times and routes from Valhalla or MOTIS |
| `scripts/valhalla.sh` | Builds the Valhalla road tiles and runs Valhalla with Docker (optional, faster car times) |
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
bash apps/trajestaurant/scripts/valhalla.sh build && bash apps/trajestaurant/scripts/valhalla.sh start   # optional
VALHALLA_URL=http://127.0.0.1:8002 pnpm --filter @pendular/trajestaurant dev:server   # API on http://127.0.0.1:8789
pnpm --filter @pendular/trajestaurant dev:web           # site on http://127.0.0.1:5174
```

Production: `pnpm --filter @pendular/trajestaurant build`, then `pnpm --filter @pendular/trajestaurant start`
serves the site and the API on port 8789. Settings: `DATABASE_URL` (default
`postgres://pendular@127.0.0.1:5433/trajestaurant`), `MOTIS_URL`, `VALHALLA_URL` (none: car times
from MOTIS), `PORT`.

A link can open a search directly: `/?ici=46.7085,6.8405,Lucens&food=burger`, `&kind=pharmacie`,
`&brand=ikea` (a chain by its name in lower case) or `&name=mix image`, and `&r=<id>` for a place.

## How the travel times are found

- **Candidates**: the 40 nearest places of the food type within 40 km (PostGIS); for a kind, a chain
  or a name, the 24 nearest within 250 km (the nearest IKEA from Lucens is 43 km away). Places of
  one chain within 150 m count once (a store and its café), and so do places of one kind within
  80 m with similar names (one hairdresser seen by OSM and Overture).
- **On foot**: one MOTIS matrix call for the places within 7 km (up to an hour).
- **By car**: one Valhalla matrix call (`VALHALLA_URL`), else MOTIS (long enough for the farthest
  place, up to three hours). Both agree within a minute (median difference 0.1 min on 40 pizzerias).
- **Public transport**: one MOTIS one-to-all call from the searcher (leaving now, waiting
  included, up to 90 minutes) gives the time to every stop; each restaurant takes the best stop
  within 700 m plus the walk. Shown only when it beats walking.
- **A place**: the real routes: walk and the next departures within two hours (MOTIS), car
  (Valhalla, else MOTIS).
- **Order** ("le plus rapide"): each place shows its quickest way, walking when it takes 12 minutes
  or less; when ranking, the car counts 5 more minutes for parking and walking to the door.
- **Caches**: street times from a place are kept for an hour (a search for pizza, then for Italian
  food, computes only the places that are new), and the stops reached by public transport from a
  place for the minute. At start, one search in the background loads the routing engines' data.

Measured from Lucens, warm (MOTIS for car / Valhalla for car): pizza 0.4 / 0.3 s, Migros 0.55 / 0.35 s,
IKEA 2.95 / 0.25 s, the way to a place 1.0 / 0.2 s; first search after start 12 s / 0.4 s. MOTIS
explores every road up to the time limit, Valhalla uses its road hierarchy: the difference grows
with the distance.

The imported timetable is the 2027 one (from 13.12.2026). On a day it does not cover, searches use
the same weekday and time of the week of 18.01.2027, and the site says it is a typical timetable.

Opening hours come from All The Places for chains, else OSM (`opening_hours`), read with the
opening_hours library in Swiss time.

## Data

| Source | What it gives | Licence |
| --- | --- | --- |
| OpenStreetMap | 126 600 places: places to eat, shops, pharmacies, fuel, banks, fitness, hotels…; towns | ODbL |
| All The Places | 14 200 branches of 207 chains from their own store finders, 10 600 with opening hours: 6 300 complete OSM places (their hours replace OSM's), 7 300 are added | CC0 |
| Overture Maps places | 49 000 places to eat: 19 000 add food types to known places, 22 400 are added (confidence ≥ 0.6, or lower with a phone or website). 59 000 shops, hairdressers, beauty salons and gyms with a confidence of 0.8 or more: 21 800 complete known places, 33 300 are added | CDLA-Permissive-2.0 (some Apache-2.0, CC0) |
| Name Suggestion Index | The chains present in Switzerland: brand of places tagged with a name only ("Migros Lucens"), cuisine of chains, proper names | BSD-3-Clause |

In all about 189 500 places, of which 1 712 chains with at least two places. Lucens, almost empty
in OSM (three places within 3 km), now has Sherlock, Vesuvio, Grill House and the Café du Poids,
from Overture. Other sources studied: `SOURCES.md` (in French).

Credits: © OpenStreetMap contributors, Overture Maps Foundation, All The Places, name-suggestion-index;
routing MOTIS with the timetable of opentransportdata.swiss.
