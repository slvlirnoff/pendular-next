# Trajestaurant

Find where to eat nearby (pizza, burger, sushi…), the nearest shop, service or place of a kind
(pharmacy, hairdresser, doctor, vet, Bancomat, déchetterie, cobbler, fuel, cinema…), the nearest branch of a chain (Migros, IKEA, Manor,
Dosenbach…) or a place by its name, and how to get there: on foot, by bike, by public transport or by car. Built on the Pendular infrastructure: the same MOTIS (streets and Swiss
timetable), the same PostgreSQL, the same map style. French interface, phone first.

Three screens: a welcome screen (sign-in comes later), a full map with a search bar and the list
of places with their travel times, and a place with its routes and what is known about it. The
search bar suggests food types, kinds of shops and places, chains ("Migros · 747 in Switzerland"),
all places of a name ("all « mix image »") and single places, nearest first. Shortcuts under it:
food types, shops, health, services, well-known chains. When nothing is searched, the map shows the places
around from zoom 14 on (`/api/map/places`, at most 600, places to eat and chains first; the map
leaves out icons that would overlap; a click opens the place).

## Editions: one per region

The same code runs one edition per region, chosen with `REGION` (`src/regions.ts`): its name,
languages, country (public holidays, brands, foods), time zone, map, area, and the defaults that let
editions run side by side on one machine (port, database, MOTIS).

| REGION | Edition | Languages | API / site (dev) | Database | MOTIS |
| --- | --- | --- | --- | --- | --- |
| `ch` (default) | Trajestaurant | fr, de, it, en | 8789 / 5174 | `trajestaurant` | Pendular's, :8080 |
| `vinnytsia` | Тролейбуфет · Trolleybuffet (trolleybus + buffet: Vinnytsia is a city of trams and trolleybuses) | uk, en | 8790 / 5175 | `trolleybuffet` | its own, :8081 (`scripts/motis.sh`) |

```sh
bash scripts/run.sh ch            # Trajestaurant on http://127.0.0.1:5174
bash scripts/run.sh vinnytsia     # Тролейбуфет on http://127.0.0.1:5175
REGION=vinnytsia bash import/osm.sh   # its places (tools/vinnytsia/fetch.sh first)
```

The site is built once for every edition: the server writes the region into the page
(`src/page.ts`; vite does the same in development). Names are compared in any script (Cyrillic
included: `searchKey`, `nameTokens`, the Ukrainian apostrophe inside words). Foods can belong to a
country (`countries`: Swiss cuisine and fondue in Switzerland, Ukrainian cuisine in Ukraine).
Outside Switzerland there is no grid of residents and jobs (car times on free roads, 5 min to
park) and no live shared vehicles. Deployment side by side, with one PostgreSQL, one MOTIS and one
Valhalla for both: `deploy/TRAJESTAURANT.md`.

## Layout

| Path | What |
| --- | --- |
| `src/foods.ts` | The 32 food types (emoji, label, synonyms) and how a place gets them: cuisine, brand, name |
| `src/kinds.ts` | Which kinds of places are kept (shops, health, services, trades, fitness…), with emoji and French label; the 91 kinds one can search for, in three rows (shops, health, services; each one or more OSM kinds, synonyms in four languages) |
| `src/api.ts` | What the API answers (shared by server and site) |
| `import/fetch.sh` | Downloads the other sources: Name Suggestion Index, All The Places (Swiss places of every chain), Overture (food and drink; shops and services it is sure of), car sharing |
| `import/overture-categories.json` | Overture's categories of shops and services and the OSM kind each is (read by the download and the import) |
| `import/osm.sh` | Extracts the places from the Swiss OSM extract, then runs `build.ts` |
| `import/build.ts` | Merges the four sources and loads them into PostgreSQL (places, food types, chains, towns) |
| `server/` | Hono API on port 8789; also serves the built site. `car.ts`: car times and routes from Valhalla or MOTIS |
| `server/sharing.ts` | Cars at the car-sharing stations, live from sharedmobility.ch |
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
SHAREDMOBILITY_CONTACT=<e-mail> bash apps/trajestaurant/import/fetch.sh   # NSI, Overture (10 s), All The Places (2 min), car sharing
pnpm --filter @pendular/trajestaurant import:osm        # creates the database "trajestaurant" (about 1 minute)
bash apps/trajestaurant/scripts/valhalla.sh build && bash apps/trajestaurant/scripts/valhalla.sh start   # optional
SHAREDMOBILITY_CONTACT=<e-mail> VALHALLA_URL=http://127.0.0.1:8002 pnpm --filter @pendular/trajestaurant dev:server   # API on :8789
pnpm --filter @pendular/trajestaurant dev:web           # site on http://127.0.0.1:5174
```

Production: `pnpm --filter @pendular/trajestaurant build`, then `pnpm --filter @pendular/trajestaurant start`
serves the site and the API on port 8789. Settings: `DATABASE_URL` (default
`postgres://pendular@127.0.0.1:5433/trajestaurant`), `MOTIS_URL`, `VALHALLA_URL` (none: car times
from MOTIS), `SHAREDMOBILITY_CONTACT` (the contact e-mail address the national shared-mobility feed
asks for in its Authorization header; never in the repository: without it there are no car-sharing
stations at import and no cars counted at run time), `PORT`.

A link can open a search directly: `/?ici=46.7085,6.8405,Lucens&food=burger`, `&kind=pharmacie`,
`&brand=ikea` (a chain by its name in lower case) or `&name=mix image`, and `&r=<id>` for a place.

## How the travel times are found

- **Candidates**: the 40 nearest places of the food type within 40 km (PostGIS); for a kind, a chain
  or a name, the 24 nearest within 250 km (the nearest IKEA from Lucens is 43 km away). Places of
  one chain within 150 m count once (a store and its café), and so do places of one kind within
  80 m with similar names (one hairdresser seen by OSM and Overture).
- **On foot**: one MOTIS matrix call for the places within 7 km (up to an hour).
- **By bike**: one MOTIS matrix call (its bike network and speed) for the places within 25 km
  (up to an hour and a half); the card gives the bike route. The bike has its own sort (🚲: by bike,
  or by public transport beyond cycling distance) and tab; "le plus rapide" leaves it out, since
  not everyone has a bike at hand. Lucens → Moudon (5.4 km): 22 min.
- **By car**: one Valhalla matrix call (`VALHALLA_URL`), else MOTIS (long enough for the farthest
  place, up to three hours). Both agree within a minute (median difference 0.1 min on 40 pizzerias).
  Both give times on empty roads: as in Pendular, each time is slowed by the rush-hour factor of
  the surroundings of the way (×1.1 in open country to ×3 in a city centre, residents and jobs
  within 1 km; along the straight line for the list, along the route for a place) and the time to
  park and walk to the door is added (5, 10 or 15 minutes by the density at the place). Pendular's
  factors are for the morning commute: `server/traffic.ts` applies all of the slow-down at the
  peaks of a working day (07:00–08:45, 16:30–18:45), 60–70 % during the day, 50 % on Saturday, 25 %
  on Sunday, 10–20 % at night (assumptions). Lucens → Manor Lausanne on a Thursday at 15:20: 26 min
  on empty roads, 35 min with the traffic (×1.34), 50 min with parking.
- **Public transport**: one MOTIS one-to-all call from the searcher (leaving now, waiting
  included, up to 90 minutes) gives the time to every stop; each restaurant takes the best stop
  within 700 m plus the walk. Shown only when it beats walking.
- **A place**: the real routes: walk and the next departures within two hours (MOTIS), car
  (Valhalla, else MOTIS).
- **Order** ("le plus rapide"): each place shows its quickest way door to door, walking when it
  takes 12 minutes or less. The 🚆
  order is "without a car": public transport, or walking when it is as quick (the post office next
  door comes first); the 🚶 order walks where one can and takes public transport beyond.
- **Car sharing**: the stations of the providers with cars in the national shared-mobility feed
  (GBFS v2, sharedmobility.ch: Mobility 1 851, 2EM 1 743, Quickrent, eDrive, Sponti-Car, Birrer,
  carvelo2go; not myBuxi, an on-demand minibus) are places of their own ("Car sharing", searched by
  kind or by provider), with the cars the provider reports there now (fetched at most every two
  minutes; a car still has to be booked in the provider's app). A place's card adds a fourth way
  when a station with cars is within 1.2 km of the searcher and it beats walking: the walk to the
  station, the drive with traffic and parking; the car goes back to its station.
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
| OpenStreetMap | 159 400 places: places to eat, shops, pharmacies, fuel, banks and their cash machines, health (doctors, dentists, vets, hospitals, physiotherapists…), public services (commune, police, déchetteries), offices one visits (lawyers, notaries, fiduciaries…), trades (cobblers, electricians, joiners…), fitness, hotels…; towns. A place without a name is named after its operator (the Lucens post office: operator:fr=La Poste) or, for kinds one looks for, after its kind ("Pharmacie"), until another source gives its name | ODbL |
| All The Places | 14 200 branches of 207 chains from their own store finders, 10 600 with opening hours: 6 300 complete OSM places (their hours replace OSM's), 7 300 are added | CC0 |
| Overture Maps places | 49 000 places to eat: 19 000 add food types to known places, 23 400 are added (confidence ≥ 0.6, or lower with a phone or website). 106 000 shops and services with a confidence of 0.8 or more: 26 400 complete known places, 48 800 are added, 30 700 are left out (below) | CDLA-Permissive-2.0 (some Apache-2.0, CC0) |
| Name Suggestion Index | The chains present in Switzerland: brand of places tagged with a name only ("Migros Lucens"), cuisine of chains, proper names | BSD-3-Clause |

Overture's shops and services come from several datasets (meta, Microsoft, BrightQuery, Uberall…)
whose categories are not equally right: Microsoft calls garages, taxi companies and Adecco "home
goods" or "kitchen supply" stores. Two checks: a name that says what a place is wins over its
category ("Garage …", "Carrosserie …", "Pneus …" are garages; "Adecco …" an employment agency; a
taxi or removal company, an architect, a restaurant among shops is left out); and a place no other
source has is added only when its dataset and category mostly agree with OSM on the places both know
(a similar name within 120 m, the town's name not counting): 65 % of them listed as the same sort of
place (30 % for health categories, which OSM tags unevenly), or, for categories with fewer than 8
such places, 60 % for the dataset as a whole. Microsoft's "home_goods_store" agreed for 15 %, meta's
"furniture_store" for 85 %, Microsoft's "veterinarian" for 92 %.

In all about 242 600 places, of which 1 856 chains with at least two places. Lucens, almost empty
in OSM (three places within 3 km), now has Sherlock, Vesuvio, Grill House and the Café du Poids,
from Overture. Other sources studied: `SOURCES.md` (in French).

**Addresses**: when the text is not a food type or a kind of place, the search bar also offers the
addresses, stops and named places of MOTIS's geocoder, near the searcher first. Picking one shows
it close up with the places around it, and a card with the way there from the searcher
(`/api/route`, `&adr=lat,lon,label` in the link).

**Shared bikes and scooters**: the bike-sharing stations of the national shared-mobility feed
(Velospot 1 684, Donkey Republic 832, nextbike 459, carvelo2go 297, PickeBike 125…; the stations
one takes a bike from and brings it back to, not the parking zones of scooters) are places
("Vélos en libre-service"), with the bikes there now in the list. The scooters, bikes and mopeds
parked anywhere (Lime, Bird, Voi, Dott, Bolt, and the free bikes of the others) show live on the
map from zoom 15 (`/api/vehicles`: the 400 nearest the middle of the view, each provider's
vehicles fetched at most every minute and only where it operates), with their operator and range
on a click. Both need SHAREDMOBILITY_CONTACT.

**Stops**: public transport stops (MOTIS's timetable: one per station or stop, its platforms
together, by its main mode 🚆 🚌 🚊 ⛴️ 🚡) show on the map from zoom 15 and in the search bar
("lucens gare"). A stop's card has its departure board: the next ten departures with their time,
line ("R9", "475"), mode, direction and platform, the trips that end there left out, asked again
every minute (`/api/stops/departures`; the typical timetable's day when 2027's does not cover
today). The way there from the searcher is under it.

**On the map**, only the chosen way carries its time; the others are drawn faint, and a click on
one chooses it.

**The place card** shows a picture of the place when OSM has one (image or wikimedia_commons tag:
1 500 places), its logo or its brand's (Wikimedia Commons, from NSI's Wikidata facts: 27 600
places), one-tap actions (call, site, e-mail, Instagram, Facebook, share), and the opening hours
read by the `opening_hours` library and laid out by day for the coming week ("lun.–ven.
08:00–12:00, 13:30–18:30", today in bold, a night that goes past midnight on its evening's line,
"sur rendez-vous" for the usual comments); hours it cannot read are shown as written.

**Languages**: French, German, Italian and English (`web/src/i18n.ts` for the site's texts,
`src/i18n/labels.ts` for the names of food types, kinds of places and searches; French is written
in `src/foods.ts` and `src/kinds.ts`). The language comes from the link (`&lang=de`), else the one
chosen before, else the browser's, else French; the picker (FR DE IT EN) is on the welcome screen
and beside the searcher's place. Numbers, distances, days and times follow the language
(de-CH: 5.2 km), and the geocoder answers in it where the data has names (Genf, Ginevra).
Searching works in all four languages whatever the one shown: the synonyms of each food type and
kind are in the four.

Credits: © OpenStreetMap contributors, Overture Maps Foundation, All The Places, name-suggestion-index;
routing MOTIS with the timetable of opentransportdata.swiss.
