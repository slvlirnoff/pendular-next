# Deploying Trajestaurant's editions side by side

One code base, one image, one edition per region, chosen with `REGION`
(`apps/trajestaurant/src/regions.ts`):

| REGION | Site | Languages | Port | Database | Timetables |
| --- | --- | --- | --- | --- | --- |
| `ch` | Trajestaurant | fr, de, it, en | 8789 | `trajestaurant` | opentransportdata.swiss |
| `vinnytsia` | Тролейбуфет · Trolleybuffet | uk, en | 8790 | `trolleybuffet` | `tools/vinnytsia` (vn.rozklad.in.ua, depo.vn.ua, OSM) + Ukrzaliznytsia |

The site is built once: the API writes the region's name, language and colour into the page
(`src/page.ts`), and the page tells the site which edition it is. Each edition has its own places
database; they share one PostgreSQL server. MOTIS and Valhalla can be shared too: one instance
holding every region (as in `compose.trajestaurant.yml`), or one per region (each site's
`MOTIS_URL`, `MOTIS_CONFIG` and `VALHALLA_URL` point at its own).

```
:8789  site-ch ─────────┐            ┌─ postgres  (trajestaurant, trolleybuffet)
:8790  site-vinnytsia ──┴────────────┼─ motis     (Switzerland + Vinnytsia)
                                     └─ valhalla  (Switzerland + Vinnytsia)
```

## Data (built on the host, mounted read-only)

```sh
# The sources
data/scripts/fetch.sh osm                           # Switzerland: OSM extract (and Pendular's GTFS)
bash apps/trajestaurant/import/fetch.sh             # Switzerland: Overture, All The Places, NSI, car sharing
bash tools/vinnytsia/fetch.sh                       # Vinnytsia: OSM extract, its GTFS, rail GTFS, places

# One MOTIS for both regions, listening inside its container (MOTIS_DIR=../data/motis-ch-vinnytsia)
MOTIS_HOST=0.0.0.0 MOTIS_PORT=8080 bash apps/trajestaurant/scripts/motis.sh import ch vinnytsia
# One Valhalla for both (VALHALLA_DIR=../data/build/valhalla-ch-vinnytsia)
bash apps/trajestaurant/scripts/valhalla.sh build ch vinnytsia
```

A shared MOTIS keeps the days every timetable covers (here the Swiss timetable year, from
13 December 2026); outside them the sites show a typical week's timetable.

## Run

```sh
cd deploy
docker compose -f compose.trajestaurant.yml up -d postgres
# The places, into each edition's database (PostgreSQL is published on 127.0.0.1:5434)
REGION=ch        DATABASE_URL=postgres://pendular:pendular@127.0.0.1:5434/trajestaurant bash ../apps/trajestaurant/import/osm.sh
REGION=vinnytsia DATABASE_URL=postgres://pendular:pendular@127.0.0.1:5434/trolleybuffet bash ../apps/trajestaurant/import/osm.sh
docker compose -f compose.trajestaurant.yml up -d
```

`.env` (next to the compose file): `PGPASSWORD`, `SHAREDMOBILITY_CONTACT` (cars at the Swiss
car-sharing stations; never committed), `BIND` (`127.0.0.1` by default: put Caddy or another proxy
in front, one host name per edition), `MOTIS_DIR`, `VALHALLA_DIR`.

Another region: a profile in `src/regions.ts` (name, languages, country, time zone, area, ports,
database), its data (its OSM extract and timetables in `scripts/motis.sh` and `scripts/valhalla.sh`,
its places with `import/osm.sh`), and one more `site-…` service.

## Without Docker (development)

```sh
bash scripts/dev.sh                                         # PostgreSQL (and Pendular's MOTIS for Switzerland)
bash apps/trajestaurant/scripts/motis.sh start vinnytsia    # Vinnytsia's own MOTIS on :8081
bash apps/trajestaurant/scripts/valhalla.sh start ch vinnytsia   # one Valhalla for both on :8002
bash apps/trajestaurant/scripts/run.sh ch                   # http://127.0.0.1:5174 (API :8789)
bash apps/trajestaurant/scripts/run.sh vinnytsia            # http://127.0.0.1:5175 (API :8790)
```
