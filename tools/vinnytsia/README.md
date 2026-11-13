# Vinnytsia (Ukraine): a GTFS of its city transport, and its places

Vinnytsia publishes no GTFS: it is in neither the Mobility Database nor Transitous, and the
city's open data on data.gov.ua (stops 2018, bus timetables 2019, routes and carriers 2024) sit on
opendata.gov.ua, which does not answer from outside Ukraine. `build_gtfs.py` makes one from:

| Source | What it gives |
| --- | --- |
| [vn.rozklad.in.ua](https://vn.rozklad.in.ua/), the timetables posted at the stops | Trams, trolleybuses, city and suburban buses (58 lines): each direction's stops in order with the minutes from the first one, and every departure on working days and on weekends, with the low-floor runs and the runs to the depot marked |
| OpenStreetMap (oblast extract, openstreetmap.fr) | Where the stops are, and each line's route in each direction (PTv2): its shape |
| [depo.vn.ua, share taxis](https://depo.vn.ua/content/marshrutnoe-taksi), the operator КП «Вінницька транспортна компанія» | The share taxis rozklad does not have (1А, 2Б…): first and last departures and the range of their interval, or every departure |

**rozklad's lines** (56 of its 58) are exact: a trip for each departure, the time at each stop as
posted. Each stop is put at OSM's stop of the same name, the one making the shortest way from stop
to stop, each hop no faster than 48 km/h for the minutes between them, those of the line's own OSM
route preferred (`locate`). Names are compared word by word, renamed schools and streets' former
names allowed for ("Школа-коледж №29" is "Ліцей № 29", "вул. Дьогтянецька (Лізи Чайкіної)" is "Вул.
Дьогтянецька"; "Ринок «Вишенька»" is not "Вул. Вишенька"). A stop OSM does not have, or that would
make a detour, stays out of the trip (the report lists them): 2,084 of the 2,424 stops of the
timetables are placed. The line's OSM route is its shape when every stop lies within 150 m of it
(57 of the 116 directions; the others have no shape).

- A run marked as going to the depot is a whole trip, its headsign ending "(у депо)": where it
  leaves the line is not published.
- Underlined (low-floor) runs are `wheelchair_accessible=1`; the other runs of trams and
  trolleybuses `2`; buses `0` (rozklad marks no low-floor bus).
- Stops "на вимогу" (on request) have `pickup_type` and `drop_off_type` 3: tell the driver.

**The share taxis** (17 lines) are laid on OSM's route of the line, matched by number and ends: the
time between stops is the distance along the route (never less than the straight line × 1.2) at
a commercial speed, stops included (19 km/h where OSM maps the line as a bus, 21 as a share taxi),
and the trips are frequencies (`exact_times=0`: the first and last departures, every so many
minutes, the middle of the range depo.vn.ua gives), except on the lines to the villages, whose
every departure is listed.

Working days are Monday to Friday; Ukraine's public holidays are not days off under martial law,
so there are no exceptions. The feed starts on the day the timetables start (1 November 2026).

```bash
bash tools/vinnytsia/fetch.sh            # OSM extract, GTFS (+ check), rail GTFS, places
bash tools/vinnytsia/fetch.sh gtfs       # the GTFS only (rozklad's and depo's pages are kept in src/)
bash tools/vinnytsia/fetch.sh places     # Overture, All The Places, NSI
```

Output in `data/build/vinnytsia/`: `vinnytsia-gtfs.zip`, `vinnytsia-gtfs-report.json` (the lines
each source knows and where each line of the GTFS comes from; per direction of rozklad, the OSM
route used and the stops not placed; the share taxis matched and not), and in `src/`:
`ukrzaliznytsia.gtfs.zip` (national rail, a community feed listed by Transitous: 17 trains a day
at Vinnytsia, valid to December 2027), and the places below. Delete `src/rozklad` or `src/depo`
to read the current timetables again.

## What the GTFS holds (November 2026)

73 lines, 568 stops, 5,415 trips (5,251 from rozklad), checked by `check_gtfs.py` (references,
times and distances in order, frequencies, speeds, stops within 150 m of their shape): no error,
no warning. Median trip 39 min.

- **Trams** (6): 1–6.
- **Trolleybuses** (20): 1–7, 9–20, 22.
- **Buses** (30): 1, 2, 4–9, 11, 14, 16, 19, 19А, 19Б, 20–22, 24, 27, 30, 30А, 30Б, 32, and the
  suburban 115, 138, 138с, 170, СОС, ГА, КОР.
- **Share taxis** (17, from depo.vn.ua and OSM): 1А, 2А, 2Б, 3А, 3Б, 5А, 7А, 9А, 10А, 11Б, 12А, 16А,
  17А, 18А, 22А, 23А, 31А.

The lines each source knows:

| | rozklad | depo.vn.ua | OSM route |
| --- | --- | --- | --- |
| Trams 1–6, trolleybuses 1–7, 9–13, 15, buses 1, 2, 5–8, 11, 14, 16, 19, 24 | ✓ | ✓ | ✓ |
| Trolleybuses 14, 16–20, 22, buses 4, 20, 21, 27, 30, 32, 19А, 19Б, 30А, 30Б | ✓ | ✓ | |
| Buses 9, 22, 115, 137, 138, 138с, 170, М.К., СОС, ГА, КОР | ✓ | | |
| Share taxis 1А, 2А, 2Б, 3А, 3Б, 5А, 7А, 9А, 10А, 11Б, 12А, 16А, 17А, 18А, 22А, 23А, 31А | | ✓ | ✓ |
| Share taxis 8А, 8Б, 14А, 20А, 21А, 28А, 34А | | ✓ | |
| Trolleybuses 6а, 8, buses 13А, 17, 25, 29А, 32А, share taxi 17Б | | | ✓ |

**Missing**:
- The share taxis 8А, 8Б, 14А, 20А, 21А, 28А, 34А: depo.vn.ua gives only their ends and times,
  and OSM has no route for them (mapping them in OSM, PTv2, would bring them in).
- Buses 137 and М.К.: three stops each, their town end ("Вінниця АС-1") not in OSM.
- OSM's routes that no operator lists any more (trolleybuses 6а and 8, buses 13А, 17, 25, 29А, 32А,
  share taxi 17Б).

**Also tried**:
- The operator's stop-by-stop timetable (depo.vn.ua/route): a Drupal form that did not answer
  outside a browser session.
- The live map of КП «Вінницякартсервіс» (map.et.vn.ua): routes, stops and vehicle positions over
  socket.io, for private use only by its terms.
- EasyWay: behind a bot challenge, data by agreement only.

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

## Licences

The stops, routes and shapes come from OpenStreetMap: the GTFS is a database derived from it, under
the ODbL (attribution: © OpenStreetMap contributors). The departures, the minutes between stops and
the intervals are published timetable facts (vn.rozklad.in.ua, whose robots.txt allows any reader,
and depo.vn.ua); `attributions.txt` names all three. The pages are read one at a time, half a
second apart, and kept: a build reads them once.
