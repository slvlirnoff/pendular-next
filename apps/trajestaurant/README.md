# Trajestaurant

Find where to eat nearby (pizza, burger, sushi…) and how to get there: on foot, by public
transport or by car. Built on the Pendular infrastructure: the same MOTIS (streets and Swiss
timetable), the same PostgreSQL, the same map style. French interface, phone first.

Three screens: a welcome screen (sign-in comes later), a full map with a search bar and the list
of restaurants with their travel times, and a restaurant with its routes and what is known about it.

## Layout

| Path | What |
| --- | --- |
| `src/foods.ts` | The 32 food types (emoji, label, synonyms) and how an OSM place gets them: cuisine, brand, name |
| `src/api.ts` | What the API answers (shared by server and site) |
| `import/` | OSM import: `osm.sh` extracts the places with osmium, `load.ts` loads them into PostgreSQL |
| `server/` | Hono API on port 8789; also serves the built site |
| `web/` | The site (Vite, React, MapLibre) |
| `SOURCES.md` | Other data sources studied (Overture, Foursquare, All The Places, open government data…), in French |

## Run locally

Needs what Pendular needs (see the main README): the Swiss OSM extract and an imported MOTIS, and
PostgreSQL with PostGIS (`apt install postgresql-16-postgis-3`).

```sh
data/scripts/fetch.sh                                   # once: OSM, timetable, MOTIS
(cd data/motis && ./bin/motis import -c config.yml -d data)
scripts/dev.sh                                          # PostgreSQL on 5433 and MOTIS on 8080 (and Pendular)
pnpm --filter @pendular/trajestaurant import:osm        # creates the database "trajestaurant" (about 1 minute)
pnpm --filter @pendular/trajestaurant dev:server        # API on http://127.0.0.1:8789
pnpm --filter @pendular/trajestaurant dev:web           # site on http://127.0.0.1:5174
```

Production: `pnpm --filter @pendular/trajestaurant build`, then `pnpm --filter @pendular/trajestaurant start`
serves the site and the API on port 8789. Settings: `DATABASE_URL` (default
`postgres://pendular@127.0.0.1:5433/trajestaurant`), `MOTIS_URL`, `PORT`.

A link can open a search directly: `/?ici=46.7085,6.8405,Lucens&food=burger` (and `&r=<id>` for a restaurant).

## How the travel times are found

- **Candidates**: the 40 nearest places of the food type within 40 km (PostGIS).
- **On foot and by car**: two MOTIS matrix calls for the whole list (up to 60 minutes).
- **Public transport**: one MOTIS one-to-all call from the searcher (leaving now, waiting
  included, up to 90 minutes) gives the time to every stop; each restaurant takes the best stop
  within 700 m plus the walk. Shown only when it beats walking.
- **A restaurant**: the real routes (MOTIS plan): walk, car, and the next departures within 90 minutes.

The imported timetable is the 2027 one (from 13.12.2026). On a day it does not cover, searches use
the same weekday and time of the week of 18.01.2027, and the site says it is a typical timetable.

Opening hours come from OSM (`opening_hours`), read with the opening_hours library in Swiss time.

## Data

About 32 000 named places from OpenStreetMap (restaurants, cafés, fast food, ice cream). OSM is
thin in some villages (three places within 3 km of Lucens): Overture Maps Places is the next
source to add (see `SOURCES.md`). Restaurants © OpenStreetMap contributors (ODbL).
