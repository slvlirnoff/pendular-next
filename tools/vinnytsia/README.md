# Vinnytsia (Ukraine): a GTFS of its city transport, and its places

Vinnytsia publishes no GTFS: it is in neither the Mobility Database nor Transitous, and the
city's open data on data.gov.ua (stops 2018, bus timetables 2019, routes and carriers 2024) sit on
opendata.gov.ua, which does not answer from outside Ukraine. `build_gtfs.py` makes one from:

| Source | What it gives |
| --- | --- |
| OpenStreetMap (oblast extract, openstreetmap.fr) | Each line in each direction as a PTv2 route: its stops in order and the ways it runs on: stops, shapes, distances |
| [depo.vn.ua](https://depo.vn.ua/route/bytable/tram), the operator КП «Вінницька транспортна компанія» | Trams, trolleybuses, buses: first and last departure and interval per line and direction, working days and weekends apart |
| [depo.vn.ua, share taxis](https://depo.vn.ua/content/marshrutnoe-taksi) | The lines with a letter (1А, 2Б…): first and last departures and the range of their interval, or every departure (the lines to the villages) |

The trips are frequencies (`exact_times=0`, "every 12 min from 06:01 to 22:56") as the operator
publishes them, except the share taxis whose every departure is listed. The time between stops
is not published: it is the distance along the route (never less than the straight line × 1.2)
at a commercial speed per mode, stops included: tram 16 km/h, trolleybus 17, bus 19, share taxi
21. Working days are Monday to Friday; Ukraine's public holidays are not days off under martial
law, so there are no exceptions.

```bash
bash tools/vinnytsia/fetch.sh            # OSM extract, GTFS (+ check), rail GTFS, places
bash tools/vinnytsia/fetch.sh gtfs       # the GTFS only (depo.vn.ua's pages are kept in src/depo)
bash tools/vinnytsia/fetch.sh places     # Overture, All The Places, NSI
```

Output in `data/build/vinnytsia/`: `vinnytsia-gtfs.zip`, `vinnytsia-gtfs-report.json` (each OSM
route and the operator's runs it was matched with, and what was not matched), and in `src/`:
`ukrzaliznytsia.gtfs.zip` (national rail, a community feed listed by Transitous: 17 trains a day
at Vinnytsia, valid to December 2027), and the places below.

## Places (November 2026)

| Source | File | In the oblast | In the city |
| --- | --- | --- | --- |
| OpenStreetMap | `data/raw/vinnytsia_oblast.osm.pbf` | 47,565 shops and amenities | 3,484 shops, 1,078 healthcare, 356 offices, 88 crafts |
| Overture, everything | `overture-places.jsonl` | 10,685 places (834 across the border, in Moldova) | 5,741 |
| Overture, Trajestaurant's selection | `overture.jsonl` | 2,341 (food and drink; shops and services at confidence ≥ 0.8) | 1,302 |
| All The Places | `atp.geojsonseq` | 832 (PrivatBank terminals and ATMs 642, Avrora 98, PUMB, Sinsay, car dealers) | 270 |
| Name Suggestion Index | `nsi.json`, `nsi-wikidata.json` | brands, their Wikidata ids and logos | |

OSM is by far the fullest here. Overture holds few places in Ukraine, most at low confidence, and
its categories are less sure than in Switzerland (a butcher's as a pharmacy): the confidence and
category checks of the Trajestaurant import would want calibrating again on this region.

## What the GTFS holds (November 2026)

46 lines, 541 stops, 274 trips (90 route directions × day types; 143 as frequencies), checked by
`check_gtfs.py` (references, times and distances in order, frequencies, speeds, stops within
150 m of their shape): no error, no warning. Median trip 26 min.

- **Trams** (5): 1, 3, 4, 5, 6.
- **Trolleybuses** (13): 1–7, 9–13, 15.
- **Buses and share taxis** (28): 1, 1А, 2, 2А, 2Б, 3А, 3Б, 5, 5А, 6, 7, 7А, 8, 9А, 10А, 11, 11Б,
  12А, 14, 16, 16А, 17А, 18А, 19, 22А, 23А, 24, 31А.

**Missing** — the operator runs them but OSM has no route for them yet (they would be added by
mapping them in OSM, PTv2): tram 2 (its current path), trolleybuses 14, 16, 17, 18, 19, 20, 22,
buses 4, 20, 21, 22, 27, 30, 32, share taxis 8А, 8Б, 14А, 19А, 19Б, 20А, 21А, 28А, 30А, 30Б, 34А.
OSM's routes the operator no longer lists are left out: trolleybuses 6а and 8, buses 13А, 17, 25,
29А, 32А, share taxi 17Б, tram 2's old path. A few OSM routes are incomplete (bus 22А: three
stops).

**Also tried**: the operator's stop-by-stop timetable (depo.vn.ua/route, a Drupal form that did
not answer outside a browser session); the live map of КП «Вінницякартсервіс» (map.et.vn.ua:
routes, stops and vehicle positions over socket.io, for private use only by its terms); EasyWay
(behind a bot challenge, data by agreement only).

## Licences

The stops, routes and shapes come from OpenStreetMap: the GTFS is a database derived from it, under
the ODbL (attribution: © OpenStreetMap contributors). The departures and intervals are the
operator's published timetable facts (depo.vn.ua); `attributions.txt` names both.
