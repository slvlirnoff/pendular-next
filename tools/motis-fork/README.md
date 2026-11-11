# MOTIS fork prototype

> The code now lives in the forks: `github.com/slvlirnoff/nigiri` and `github.com/slvlirnoff/motis`,
> branch `segment-tags` in both (from the commits of MOTIS v2.11.4). The patch files here are the
> same change, kept for reference; `deploy/Dockerfile.motis-fork` builds from the fork.

## Per-request "allowed segments" filter

Question: can MOTIS answer "what is the last trip home that a given zone pass covers?" – i.e. can the
search be restricted, per request, to route sections whose fare zones are all in the pass?

Answer: yes. The prototype built, runs on the unchanged production data (no re-import) and returns
the expected trip. 492 added lines in 15 files after the third round (nigiri 341 lines / 9 files, MOTIS 151 lines / 6 files).
The engine uses it for the last trip home of options with a zone pass (`MOTIS_SEGMENT_FILTER=1`, see the
main README).

Nothing here is pushed or upstreamed. Sources and build live outside the repository (scratchpad, see below).

## Files

| File | What |
| --- | --- |
| `nigiri.patch` | `git diff` against nigiri `18bf63c2` (the commit pinned by MOTIS v2.11.4) |
| `motis.patch` | `git diff` against MOTIS `v2.11.4` (`e020e64d`) |
| `export-segments.ts` | timetable (GTFS) + NOVA snapshot → `segments.csv` (`from_station,to_station,tags`) |
| `segments.csv` | generated (1.5 MB): every pair of consecutive stops of a trip, with the zones of every zonal network that has them; 48 106 rows, 21 networks |
| `commute-zones.ts` | prints the zone set of the Lucens → Lausanne commute (bus 361 + m2) as a parameter value |

## Request

```
GET /api/v6/plan?...&allowedSegmentTags=mobilis:11,mobilis:12,mobilis:18,mobilis:60,mobilis:61,mobilis:65,mobilis:103
GET /api/v6/one-to-all?...&allowedSegmentTags=...
```

A transit ride may only cross route sections (two consecutive stops of a trip) that have a tag group lying
entirely in the list. A section carries one group per fare network (`frimobil:45|frimobil:47;mobilis:60|mobilis:103`:
`;` between groups, `|` between the tags of a group), so a pass of one network is enough where two networks
overlap (3027 station pairs). Sections without a row in the file are forbidden as soon as the parameter is given. Walking and
transfers are not affected. Without the parameter nothing changes. The parameter is declared in
`openapi.yaml` (the C++ struct `api::plan_params` is generated from it at build time by `openapi_generate`,
so this was not painful), for GET `plan` and GET `one-to-all` only.

## Build (commands that worked)

Ubuntu 24.04, gcc 13.3, cmake 3.28, ninja, 4 cores / 15 GB. No apt packages were needed.

```sh
S=/tmp/claude-0/-home-user/a251acae-5567-5cee-9d37-b3a96dec20c5/scratchpad
git config --global url."https://github.com/".insteadOf "git@github.com:"   # pkg clones the deps over ssh otherwise
mkdir -p $S/motis-build && cd $S/motis-build
CXX=g++-13 CC=gcc-13 cmake -GNinja -DCMAKE_BUILD_TYPE=Release -DNO_BUILDCACHE=ON \
  -DCMAKE_JOB_POOLS=link=1 -DCMAKE_JOB_POOL_LINK=link $S/motis-src/motis
# cmake downloads the `pkg` tool and clones the dependencies into motis-src/motis/deps (4 min)
cd $S/motis-src/motis/deps/nigiri && git apply /home/user/pendular-next/tools/motis-fork/nigiri.patch
cd $S/motis-src/motis            && git apply /home/user/pendular-next/tools/motis-fork/motis.patch
cd $S/motis-build && cmake . && ninja -j4 motis      # target `motis` only: no tests, no UI, no GPU
```

- Time: configure 4 min; full build of the `motis` target about 23 min wall on 4 cores (about 1.3 CPU hours;
  2197 ninja steps). A rebuild after touching `raptor.h` is about 7 min (320 steps), most of it unrelated
  dependencies that were still missing in my first pass.
- Disk: dependencies 3.1 GB (`motis-src/motis/deps`), build directory 0.6 GB, binary 50 MB, data copy 2.8 GB.
- Obstacles: none worth the name. The ssh→https rewrite is needed; new `.cc` files need a `cmake .`
  (sources are globbed). gcc 13 is one of the two supported compilers; `-Werror` is on and passed.
- Note: the patch was applied in `motis-src/motis/deps/nigiri` (the clone made by `pkg`, same commit);
  the separate clone `motis-src/nigiri` is unused.

## Run

The fork reads the production import unchanged; it runs on a copy with port 8082:

```sh
S=/tmp/claude-0/-home-user/a251acae-5567-5cee-9d37-b3a96dec20c5/scratchpad
# once: cp -r /home/user/pendular-next/data/motis/data $S/motis-data/data ; set `port: 8082` in $S/motis-data/data/config.yml
cd /home/user/pendular-next && pnpm tsx tools/motis-fork/export-segments.ts      # writes segments.csv (20 s, needs data/raw/gtfs.zip)
cd $S/motis-data && MOTIS_SEGMENT_TAGS=/home/user/pendular-next/tools/motis-fork/segments.csv \
  nohup $S/motis-build/motis server -d data > fork.log 2>&1 &
```

Start-up takes a few seconds (RSS 1.1 GB); the log line confirms the table:
`segments.csv: 48106 rows, 696 tags, 1759 tag sets, 534284/661076 route sections tagged`.
To restart: `kill $(pgrep -f 'motis-build/motis server')` and run the last command again.

The API that uses it (the normal one on 8787 with the release MOTIS is not affected):

```sh
cd /home/user/pendular-next/apps/api && PORT=8789 MOTIS_URL=http://127.0.0.1:8082 MOTIS_SEGMENT_FILTER=1 pnpm start
```

## The segment file

`export-segments.ts` reads the consecutive stops of every trip from the GTFS feed (`stop_times.txt`, streamed;
stops mapped to station numbers by `gtfsStationNumber()`, the same rule as `station_key` in `motis.patch`) and
asks the engine for the zones of each pair (`sectionTags()` in `packages/engine/src/fares/segmentTags.ts`): the
zones of the NOVA edge when there is one, else those along the chain of edges that joins the two stops (a
vehicle that skips stops) - what the trip resolver does for a leg, so a pass always allows the trip it was
priced for. Networks: every alliance with a pass plan, chosen as the trip resolver does (`networkPlans()`;
joint passes such as Z-Pass are left out; Léman Pass is a network since 2026-11-11 and its sections are
tagged `leman-pass:<zone>`; since the third round below the French bus stops and stations have a
station number too, see "Station numbers"). Counts of 2026-11-11, before Léman Pass was added (now
48 112 tagged, 1 875 of them with Léman Pass tags):

- 62 864 directed station pairs in the timetable (15.8 million stop times, 976 295 trips);
- 48 106 tagged: 47 659 have an edge in the fare data in at least one network, 447 only by bridging;
  3027 carry the tags of several networks;
- 199 where both stops are in a zonal network but no chain of edges joins them; 14 559 that are not inside
  one zonal network (long-distance sections, areas without a zonal network, stops abroad).

| network | tagged | edge | bridged | not found |
| --- | --- | --- | --- | --- |
| a-welle | 3654 | 3633 | 21 | 0 |
| arcobaleno | 3914 | 3891 | 23 | 2 |
| bcs (Sion) | 277 | 269 | 8 | 0 |
| bs (Sierre) | 120 | 113 | 7 | 0 |
| engadin-mobil | 307 | 307 | 0 | 15 |
| frimobil | 2708 | 2690 | 18 | 0 |
| li-emobil | 509 | 507 | 2 | 0 |
| libero | 8185 | 8122 | 63 | 2 |
| mobilis | 5947 | 5880 | 67 | 0 |
| onde-verte | 1551 | 1486 | 65 | 0 |
| ostwind | 7120 | 7083 | 37 | 84 |
| passepartout | 2973 | 2944 | 29 | 2 |
| tarifverbund-davos | 191 | 191 | 0 | 0 |
| tarifverbund-klosters | 130 | 130 | 0 | 0 |
| tarifverbund-schwyz | 799 | 798 | 1 | 733 |
| tarifverbund-zug | 863 | 859 | 4 | 2 |
| tnw | 2534 | 2517 | 17 | 70 |
| transreno | 472 | 465 | 7 | 0 |
| unireso | 1869 | 1856 | 13 | 0 |
| vagabond | 957 | 950 | 7 | 0 |
| zvv | 6125 | 6038 | 87 | 2586 |

"Not found" is mostly stops that an alliance serves only on another plan than its pass plan (ZVV and Schwyz:
the Z-Pass plans kept under the same alliance), so the pass does not reach them anyway.

## What the patch changes

nigiri
- `include/nigiri/routing/segment_filter.h`, `src/routing/segment_filter.cc` (new). `segment_tags`: reads
  the CSV, interns tags and tag sets (a tag set = the list of tag groups of a row), and stores for every route
  section the id of its tag set (0 = none); also keeps the station-pair hash map for the slow path.
  `segment_filter`: per request, one byte per tag set = "one of its groups is entirely allowed". The hot-path
  test is two array reads.
- `routing/query.h`: `std::shared_ptr<segment_filter const> segment_filter_`.
- `routing/raptor/raptor.h`: `set_segment_filter()`; in `update_route` the current rides are dropped
  (`et = {}`) when the section just crossed is not allowed – same place and same forward/backward index
  rule as the bike/car/wheelchair section filters; `update_rt_transport` does the same through the
  station-pair lookup. It is a run-time `if (segment_filter_ != nullptr)`, not a template variant.
- `routing/search.h`, `src/routing/one_to_all.cc`, `src/routing/raptor/pong.cc`: hand the filter to the
  algorithm (`search.h` refuses a filter for an algorithm without `set_segment_filter`).
- `src/routing/raptor/reconstruct.cc`: `find_start_in_prev_round` stops walking back along a trip at a
  forbidden section, next to `violates_section_flags`.
- `src/routing/raptor/optimize_footpaths.cc` (third round): `filter_allowed_stops()` limits the stops a
  rebuilt ride may be moved to (shorter walk at either end, better transfer) to those reached without
  crossing a forbidden section.

MOTIS
- `include/motis/segment_tags.h`, `src/segment_tags.cc` (new): loads the table once, from the file named by
  the environment variable `MOTIS_SEGMENT_TAGS`; maps a location to its station number (parent location,
  `ch:1:sloid:4121` → `8504121`); builds the per-request filter.
- `src/data.cc`: calls the loader after the timetable is read.
- `src/endpoints/routing.cc`: passes the filter; forces RAPTOR (no PONG, no TB) when it is set.
- `src/endpoints/one_to_all.cc`: passes the filter.
- `openapi.yaml`: the parameter on `plan` and `one-to-all`.

## Verification (2026-11-11, timetable day Tuesday 2027-01-19, times UTC = local − 1 h)

Port 8080 was not listening during this work (no production process was running when I started), so the
reference for (a) is the official v2.11.4 binary (`data/motis/bin/motis`) started on the same data copy,
then stopped.

```sh
Q='fromPlace=46.5167,6.6291&toPlace=46.7085,6.8393&time=2027-01-20T01:00:00Z&arriveBy=true&timetableView=false'
T='allowedSegmentTags=mobilis:11,mobilis:12,mobilis:18,mobilis:60,mobilis:61,mobilis:65,mobilis:103'
curl -s "http://localhost:8082/api/v6/plan?$Q"                       # (a)
curl -s "http://localhost:8082/api/v6/plan?$Q&$T"                    # (b)
curl -s "http://localhost:8082/api/v6/plan?$Q&$T&maxTravelTime=240"  # (b) one itinerary only
```

Zone set used (`pnpm tsx tools/motis-fork/commute-zones.ts`): **11, 12, 18, 60, 61, 65, 103** (7 zones) –
bus 361 Lucens, gare – Moudon, gare – Vert-Bois/EHL – Croisettes: 12, 18, 60, 61, 65, 103; m2 Croisettes –
Lausanne, gare: 11, 12. The train Moudon – Lucens is zones 60, 103: inside the set, as the SBB shop says.

(a) Without the parameter – identical JSON to the official binary (everything except `debugOutput`), for
this query and for a morning query Lucens → Lausanne:

```
22:54Z → 23:46Z, 0 transfers: walk, R9 Lausanne 22:57Z (23:57 local) → Lucens 23:41Z, walk     (leaves 23:54 local)
```

(b) With the parameter:

```
21:58Z → 23:46Z, 2 transfers                                            (leaves 22:58 local)
  walk → Lausanne, gare
  m2   Lausanne, gare 22:02Z (23:02) → Epalinges, Croisettes 22:17Z (23:17)
  362  Epalinges, Croisettes 22:22Z (23:22) → Moudon, gare 22:56Z (23:56)
  R9   Moudon 23:36Z (00:36) → Lucens 23:41Z (00:41)
  walk → destination 23:46Z
```

That is the expected trip. Without `maxTravelTime` two more itineraries come back, because the search keeps
the best trip per number of transfers and the direct train no longer dominates them: 1 transfer m2 + bus 361
leaving 19:11 local, and 0 transfers by night bus 362 on Saturday 2027-01-16 03:35 local (four days
before the requested arrival – a backward search without a travel time limit goes back that far). The client must take the
itinerary with the latest departure, or send `maxTravelTime`.

Other checks: forward search (Lucens → Lausanne 05:30Z, with and without `timetableView=false`) returns
bus 361 + m2, and later Lucens – Moudon by train + bus 362 + m2; never the direct train.
`allowedSegmentTags=foo:1` returns no itinerary.

(c) Query time, 5 runs each, total HTTP time in ms (the search itself is 0–2 ms, the rest is street routing
for the two coordinates):

| | runs | nigiri `execute_time` |
| --- | --- | --- |
| official binary, no filter | 36, 35, 33, 24, 42 | – |
| fork, no filter | 36, 34, 32, 31, 33 | 0, 0, 0, 0, 0 |
| fork, filter | 38, 34, 33, 36, 40 | 1, 1, 2, 1, 1 |
| fork, filter + `maxTravelTime=240` | (same range) | 0 |

The filtered search is slightly slower here only because it has to look further back (no direct train to
stop it early). Genève → St. Gallen, interval search, no filter, on the fork: 107–121 ms total, 69–88 ms
search – not compared against the official binary under load.

One-to-all (`one=46.7085,6.8393&time=2027-01-20T01:00:00Z&arriveBy=true&maxTravelTime=180`): 3723 reachable
locations without the filter (27–30 ms), 396 with it (6–17 ms); Moudon 86 min, Epalinges, Croisettes
160 min, Lausanne, gare 180 min before 01:00Z, consistent with the trip above.

## Second round (2026-11-11): all networks, tag groups, used by the engine

Fork rebuilt with the tag groups (7 minutes), patches regenerated, server restarted with `segments.csv`.
The query (b) above gives the same trip (leaves 22:58 local); with `maxTravelTime=720` the Saturday night
bus no longer comes back and the call takes 37 ms. The engine sends `maxTravelTime=720` (minutes) and ignores
itineraries leaving more than twelve hours before the arrive-by time.

Through the API (port 8789 with the filter, 8787 without; arrival 07:30–08:30, adult, no Half Fare):

| commute, option | ticket | without | with | search |
| --- | --- | --- | --- | --- |
| Lucens → Lausanne gare, bus 361 + m2 | Mobilis 7 zones | 19:11 | 22:58 (m2, bus 362, R9) | pass |
| Lucens → Lausanne gare, R8/R9 | Mobilis 9 zones | 23:54 | 23:54 | pass |
| Lucens → Lausanne gare, P+R Vennes + m2 | Mobilis 11, 12 | 00:24 | 00:24 | pass |
| Lovatens → EPFL, bike or car to Lucens, 361 + m2 + m1 | Mobilis 7 zones | 23:02 | 22:42 | pass |
| Lovatens → EPFL, 475 + R8 + m1 | Mobilis 9 zones | 18:07 | 18:07 | pass |
| Lovatens → EPFL, bike or car to Romont, IR/IC + m1 | route pass | 23:52 | 23:52 | route |
| Lovatens → EPFL, P+R Vennes + m2 + m1 | Mobilis 11, 12 | 00:12 | 00:12 | pass |
| Bulle → Fribourg, train | Frimobil 9 zones | 23:57 | 23:57 | pass |
| Bulle → Fribourg, bus 234 | Frimobil 7 zones | 23:57 | 23:35 | pass |
| Bulle → Fribourg, RE + bus 4 | route pass | 23:57 | 23:57 | route |
| Zürich HB → Uster, S5/S9/S15 | ZVV 4 zones | 00:17 | 00:17 | pass |

The two earlier times are corrections: 23:02 was the direct R9 from Renens and 23:57 the train from Fribourg,
both through zones the pass of that option does not have.

## Third round (2026-11-11): stops abroad, rides moved outside the set

Two defects fixed; rebuild 35 s (5 ninja steps, no header touched), patches regenerated
(nigiri 341 lines / 9 files, MOTIS 151 lines / 6 files), `segments.csv` regenerated, server restarted.

### Station numbers (one rule in three places)

`station_key()` in MOTIS `src/segment_tags.cc`, `gtfsStationNumber()` in
`packages/engine/src/fares/segmentTags.ts` (used by `export-segments.ts`) and `stationId()` in
`packages/engine/src/routing/motis.ts` now agree. The id of the parent stop when there is one, without
`Parent`:

| id | station number |
| --- | --- |
| `ch:1:sloid:<n>[:x:y]`, n of up to 5 digits (Swiss stop) | 85 + n on five digits: `ch:1:sloid:4121` → 8504121 |
| `ch:1:sloid:<n>[:x:y]`, n of 6 digits and more (stop abroad) | n as it is: `ch:1:sloid:1400679` → 1400679 (Ferney, mairie) |
| plain number (UIC) | as it is: `8774549`, `Parent8774549` → 8774549 (Annemasse) |

Before, the six-digit and longer sloids had no number in the fork and in the exporter (0 / null), so their
sections had no tag and were forbidden under a filter. `segments.csv` now: 48 962 rows (850 new, none
removed), 22 networks; 71 143 directed station pairs in the timetable (62 864 before); server log
`48962 rows, 703 tags, 1775 tag sets, 541449/661076 route sections tagged`. Léman Pass: 2152 tagged
sections; zones 10 (1912), 200 (8), 210 (14), 230 (76), 240 (20), 250 (159). The pairs now seen abroad
that a network knows but cannot resolve raise "not found" (Ostwind 84 → 4291, Léman Pass 39).

Checks (arrive by 08:30 local on 2027-01-19, `toPlace` Genève Cornavin): Annemasse with
`leman-pass:10,leman-pass:210`: 26 itineraries (RL4 Annemasse – Genève); Annemasse with `10,230`: none;
Saint-Julien-en-Genevois gare with `10,230`: 43 (bus 80, 272); Ferney, mairie with `10,250`: 22 (bus 60,
61). Planner, Annemasse → Cornavin: the Léman Pass options (zones 10+210) have `returnTrips.within: "pass"`.

### A ride moved outside the set after the search

Cause: not the search and not `find_start_in_prev_round`, but `optimize_footpaths()`, which runs at the end
of `reconstruct_journey` on every journey. It moves the boarding stop of the first ride and the alighting
stop of the last one to any stop of the same vehicle with a shorter walk (`optimize_initial_departure`,
`optimize_initial_start_footpath`, `optimize_last_arrival`, `optimize_final_egress_footpath`), and the two
stops of a transfer to a better pair (`optimize_transfers`) - without looking at the filter. Echandens →
Lausanne-Flon inside Mobilis 11, 12: the search boarded bus 705 at Ecublens VD, Larges Pièces (11 min
walk); Echandens, Chocolatière, one stop earlier, is 8 min away, so the ride was moved there, over the
section Chocolatière – Larges Pièces (zones 12, 33). It happens in both search directions and with
`timetableView=false` (same code).

Fix (`optimize_footpaths.cc`): `filter_allowed_stops()` gives, for a ride, the stretch of stops around the
range the search used that is reached over allowed sections only; the five optimisations look for stops
inside that stretch only. Without a filter the stretch is the whole run: nothing changes. (The same
optimisations also ignore the bike/car/wheelchair section flags upstream; not touched.)

After the fix, raw MOTIS answers, every section of every transit leg looked up in `segments.csv`:
Echandens (46.536, 6.550) → Flon, `mobilis:11,mobilis:12`: 9 connections, all board at Larges Pièces, 0
sections outside (before: 9 of 9 boarded at Chocolatière); Corcelles-sur-Chavornay (46.696, 6.6196) → Flon,
zones 11 12 16 50 51 52: bus 428 from Penthéréaz, Champ-de-Vaud + R20, 0 sections outside; forward
searches of both: 0 outside. Last trip Lausanne gare → Lucens by 02:00 (7 zones): unchanged, leaves 22:58
(m2 23:02, bus 362 23:22, R9 00:36). The engine's `insideSet` (compare.ts) no longer has anything to
correct on these cases; it is kept as a safeguard.

## Prototype-grade, and what an upstream version needs

- **Untagged sections** (126 792 of 661 076 route sections): outside every zonal network, or between two
  networks. A pass never covers them, so this is right; the 199 station pairs inside a network that no chain
  of edges joins are the real gap (see the table above).
- **Bridged sections** take the zones along the shortest chain of edges (rail first), which is not always
  the way the vehicle runs; the zone set can be larger than the truth, never smaller than what the engine
  prices.
- **One edge per station pair**: rail and bus edges between the same two stations are merged (fewest zones
  kept; no pair differs in the Mobilis pass plan today). Tags could be keyed by mode/operator.
- **Stops abroad** have a station number since the third round (7445 stops with a six-digit and longer
  `sloid`, 3940 with a plain number); their sections are tagged where the fare data has them.
- **Station ids**: the Swiss `sloid` → station number rule is hard-coded in `src/segment_tags.cc`. Upstream
  would take MOTIS stop ids (`<tag>_<stop_id>`) as they are.
- **Storage**: a global loaded from an environment variable at server start. Upstream: a config key and a
  column in the timetable written at import (like `route_flags_per_section_`), or loaded GTFS fare data
  (`fare_leg_rules` areas/networks) so that no side file is needed.
- **Template variants**: the existing filters are compile-time (`loop_routes<…>` / `update_route<…>`),
  with a per-route "all / some / no sections" pre-check so that fully allowed routes pay nothing and fully
  forbidden ones are skipped. The proper version adds a sixth filter bit that way; the per-route summary
  must be computed per request (or cached per allowed-set), since the allowed set is not known at import.
- **Lower bounds**: the travel time lower bounds ignore the filter (still valid, only less tight).
- **Other algorithms**: PONG got the hook but is not used (forced RAPTOR, untested); TB (transfer-based)
  and the GPU RAPTOR have nothing – `search.h` throws for them. `direct.cc` (`get_direct_journeys`, used by
  PONG and leg alternatives) ignores the filter.
- **Realtime**: `update_rt_transport` and the reconstruction use the station-pair lookup; compiled but not
  exercised (this server has no realtime feed).
- **API**: only GET `plan` and GET `one-to-all`; not POST `plan`, one-to-many, refresh-itinerary or the
  itinerary id (a refreshed itinerary would lose the restriction). The parameter value is echoed nowhere.
- **Tests**: none. Upstream needs nigiri routing tests (forward, backward, vias, rt) and a MOTIS endpoint test.
