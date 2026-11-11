# MOTIS fork prototype: per-request "allowed segments" filter

Question: can MOTIS answer "what is the last trip home that a given zone pass covers?" – i.e. can the
search be restricted, per request, to route sections whose fare zones are all in the pass?

Answer: yes. The prototype built, runs on the unchanged production data (no re-import) and returns
the expected trip. 409 added lines in 14 files (nigiri 267 lines / 8 files, MOTIS 142 lines / 6 files).

Nothing here is pushed or upstreamed. Sources and build live outside the repository (scratchpad, see below).

## Files

| File | What |
| --- | --- |
| `nigiri.patch` | `git diff` against nigiri `18bf63c2` (the commit pinned by MOTIS v2.11.4) |
| `motis.patch` | `git diff` against MOTIS `v2.11.4` (`e020e64d`) |
| `export-segments.ts` | NOVA snapshot → `segments-mobilis.csv` (`from_station,to_station,tags`) |
| `segments-mobilis.csv` | generated: Mobilis pass plan `mobilis-abo-abo`, 3743 station pairs, 7486 rows (both directions) |
| `commute-zones.ts` | prints the zone set of the Lucens → Lausanne commute (bus 361 + m2) as a parameter value |

## Request

```
GET /api/v6/plan?...&allowedSegmentTags=mobilis:11,mobilis:12,mobilis:18,mobilis:60,mobilis:61,mobilis:65,mobilis:103
GET /api/v6/one-to-all?...&allowedSegmentTags=...
```

A transit ride may only cross route sections (two consecutive stops of a trip) whose tags are ALL in the
list. Sections without a row in the file are forbidden as soon as the parameter is given. Walking and
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
cd /home/user/pendular-next && pnpm tsx tools/motis-fork/export-segments.ts      # writes segments-mobilis.csv
cd $S/motis-data && MOTIS_SEGMENT_TAGS=/home/user/pendular-next/tools/motis-fork/segments-mobilis.csv \
  nohup $S/motis-build/motis server -d data > fork.log 2>&1 &
```

Start-up takes a few seconds (RSS 1.1 GB); the log line confirms the table:
`segments-mobilis.csv: 7486 rows, 155 tags, 425 tag sets, 49930/661076 route sections tagged`.
To restart: `kill $(pgrep -f 'motis-build/motis server')` and run the last command again.

## What the patch changes

nigiri
- `include/nigiri/routing/segment_filter.h`, `src/routing/segment_filter.cc` (new). `segment_tags`: reads
  the CSV, interns tags and tag sets, and stores for every route section the id of its tag set (0 = none);
  also keeps the station-pair hash map for the slow path. `segment_filter`: per request, one byte per tag
  set = "all its tags are allowed". The hot-path test is two array reads.
- `routing/query.h`: `std::shared_ptr<segment_filter const> segment_filter_`.
- `routing/raptor/raptor.h`: `set_segment_filter()`; in `update_route` the current rides are dropped
  (`et = {}`) when the section just crossed is not allowed – same place and same forward/backward index
  rule as the bike/car/wheelchair section filters; `update_rt_transport` does the same through the
  station-pair lookup. It is a run-time `if (segment_filter_ != nullptr)`, not a template variant.
- `routing/search.h`, `src/routing/one_to_all.cc`, `src/routing/raptor/pong.cc`: hand the filter to the
  algorithm (`search.h` refuses a filter for an algorithm without `set_segment_filter`).
- `src/routing/raptor/reconstruct.cc`: `find_start_in_prev_round` stops walking back along a trip at a
  forbidden section, next to `violates_section_flags`.

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

## Prototype-grade, and what an upstream version needs

- **Sections that skip stops are untagged.** NOVA edges join neighbouring stops; a train that does not call
  at every stop (R9 Puidoux → Lausanne, any IR) crosses a section with no row and is forbidden even if the
  pass covers the whole line. Only 49 930 of 661 076 route sections got tags (the file is one alliance; but
  part of the gap inside Vaud is this). The exporter should bridge such sections along the edges
  (`zonesForStops` already does, per timetable route) – this is our data work, not MOTIS's, and it is the
  first thing to do before using the filter for real.
- **One edge per station pair**: rail and bus edges between the same two stations are merged (fewest zones
  kept; no pair differs in the Mobilis pass plan today). Tags could be keyed by mode/operator.
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
