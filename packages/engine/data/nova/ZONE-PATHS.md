# Zone paths: searching the timetable inside the zones of a cheaper pass

Code: `packages/engine/src/fares/zonePaths.ts` (zone graph, paths, which sets to search, `realisable`),
`packages/engine/src/planner/compare.ts` (`withinZones`: the searches and the merge; `insideSet`; `sameVehicleOnce`),
`packages/engine/src/planner/prune.ts` (what a car park is shown with),
`packages/engine/src/routing/motis.ts` (`transit` with `allowedSegmentTags`, `stopsWithinWalk`, `drivable`).
Data: `stop-links.json` (stops within 300 m of each other; `pnpm tsx tools/zone-paths/export-stop-links.ts`).
Tests: `packages/engine/test/zonePaths.test.ts`, `zoneSearchRules.test.ts`, `planner-tickets.test.ts`, `segmentTags.test.ts`.
Tools: `tools/zone-paths/measure.ts` (the test trips: ticket groups, calls, times), `analyse.ts` (the sets of a
trip and what the timetable returns in each), `find-borders.ts` (homes between two zones).

## Why

The timetable search returns the connections that nothing beats on departure, arrival and number of
changes. A slower connection that needs fewer fare zones, and so a cheaper pass, is beaten on those
three and never comes back. Lovatens → EPFL, arrival 07:30–08:30: only bus 475 + train + m1 came
back (Mobilis, 9 zones, CHF 2,376); bus 475 + bus 361 + m2 + m1 (7 zones, CHF 2,052) arrives two
minutes later with one more change and was missing.

The MOTIS fork (`tools/motis-fork`) can restrict a search to route sections whose zones lie in a
list. So the planner searches once without restriction and then once per set of zones that could
hold a cheaper connection, and merges the answers.

## The zone graph

The fare data gives zones per hop (two stops a vehicle joins), on the pass plan of each network
(`networkPlans`), never per stop.

- **Zones of a stop**: the zones that every hop at the stop uses. When no zone is common to all
  hops (a stop on a border), the zones of the hops that use fewest zones.
- **Steps**: from zone a to zone b when a hop joins a stop of a with a stop of b, or when one stop
  lies in both. A hop that crosses other zones without a stop there (a fast train: up to 11 zones
  on one hop in Mobilis) is a step that adds those zones too; it never makes two far-apart zones
  neighbours. Between the same two zones only the steps crossing fewest zones are kept.
- **Count of a set**: as the price does (`Network.rules`): NOVA's zone factors, or every zone once
  where the network counts that way; zones always sold together are added (Lausanne 11 + 12).

## The paths

`zonePaths(graph, from, to, { extra })`: every simple path (no zone twice) from a zone of `from` to
a zone of `to`, searched depth first and cut as soon as its zones plus the fewest still needed
exceed the limit. What is kept is the **set of zones** of each path. Returned: the cheapest set and
those counting at most `extra` zones more (rule `zoneSearchExtraZones`, 2), cheapest first.

Lucens → Lausanne (Mobilis): 20 sets within two zones of the cheapest, in about 10 ms the first
time and a few milliseconds after. First `11 12 18 60 61 65 103` (7 zones: bus 361 + m2, as the SBB shop sells it), among the
9-zone ones `11 12 19 60 61 62 63 64 103` (the train).

## Which sets are searched

`zoneSearches(trips, { nova, networks }, { max, extra })`, from the connections the unrestricted
search returned (`trips`: their public transport legs):

- **Ends**: the zones of the first boarding stops and of the last alighting stops of those
  connections, and the zones of every stop within 15 minutes on foot of home and of work (rule
  `zoneSearchWalkMin`; see "The stops within walking reach"). A stop in a zone already there
  changes nothing.
- **Networks**: every network with a pass plan and a price grid that has one of the first stops and
  one of the last stops (joint passes such as Z-Pass are left out, as for pricing; Léman Pass is a
  network, and its zone 10 is added to every set).
  Nothing is Mobilis-specific. A trip not inside one network: nothing is searched.
- **Candidates**: the zone paths, plus the zone sets of the connections found when within the same
  limit (searching them shows the departures of that ticket which a faster, dearer one hides).
- **All-zones price**: a set that reaches the count from which the network charges its all-zones
  price (`allZonesFrom`: Frimobil 7, Libero 10, ZVV 6 ...) is replaced by the whole network.
- **Left out**:
  1. a set that contains every connection found (the search would return the same answer);
  2. a set counting as many zones as the dearest connection found, or more, when all connections
     are priced in this network: what a restricted search adds is always beaten on times and
     changes by a connection already found, so it is worth having only on a cheaper pass;
  3. a set that contains a set already chosen (dearer, and it allows the same connections);
  4. where `network-zones.json` says which zones are a network's own, a set with none of them
     (the network does not sell that trip; the same rule as for pricing).
  5. a set whose yearly pass (adult or the traveller's category, the traveller's class) saves less
     than CHF 100 on the pass of the dearest connection found (rule `zoneSearchMinSavingChf`): one
     Mobilis zone is CHF 144 to 180 a year, anything smaller is a rounding of the grid, and the
     network's minimum (two zones paid for one) saves nothing;
  6. a set that no chain of hops can make (`realisable`, below).
- **Bound**: cheapest first, at most `max` sets in all (rule `zoneSearches`, 4), taken in turn from
  each network when there are several.

## The stops within walking reach

The search without restriction boards where it is fastest. A stop a few minutes further, in another
zone, can make a pass with fewer zones possible, and the zone paths never started there.

- `routing.stopsWithinWalk({ at, maxMin, direction })` (MOTIS: `GET /api/v1/map/stops` for the map
  section around the point, one position per station, then `GET /api/v1/one-to-many`, `mode=WALK`,
  `max` = 15 minutes; 'from' home, 'to' work). Both ends are asked beside the first searches: 17 ms
  alone for 20 stops (Morges), 70 ms for Zürich HB; no time added to the search (see the numbers).
- Their zones (`graph.zonesOfStop`: those every hop at the stop shares) join the ends. Only the
  networks that hold a stop of the connections found at both ends are looked at, as before.
- 15 minutes: what the timetable server allows on foot at the end of a trip, and less than
  `walkToStopMaxMin` (25) at its start, so every such stop can be the first or the last of a
  connection found from the door.
- From a car park or bike park the stops around are not asked for; the stops around work are used.

Two homes between two zones (to Lausanne, Flon, arrival 07:30–08:30; `find-borders.ts`):

| Home | Without | With the stops within 15 minutes |
| --- | --- | --- |
| 46.536, 6.550, between Echandens and Ecublens | boards bus 705 at Echandens, Chocolatière (8 min, zone 33) or trains at Bussigny / Denges: 3 zones, CHF 1,008 | Ecublens VD, Larges Pièces, the next stop of bus 705, is 11 min away in zone 12: zones 11 12, **CHF 729**, 705 · m1, 6 departures, 34–39 min (fastest 33) |
| 46.696, 6.6196, Corcelles-sur-Chavornay | boards bus 428 at Corcelles-sur-Chav., Tuilerie (zone 42): 7 zones, CHF 2,052 | Penthéréaz, Champ-de-Vaud, 5 min away in zone 52: zones 11 12 16 50 51 52, **CHF 1,827**, the same bus 428 · R20, 63 min |

In the ten other test trips no stop within 15 minutes lies in another zone: nothing changes there.

## A chain of hops inside the set (`realisable`)

The zone graph says which zones touch. `realisable(graph, zones, fromStops, toStops, links)` says
that vehicles can make the trip: a search over stops, from the stops of the origin end to those of
the destination end, along hops whose zones all lie in the set. Between two hops the traveller may
walk to a stop within 300 m (`stop-links.json`, from the timetable's stop positions: the fare data
has none), once: a chain of walks from stop to stop would cross a town for free. It is the question
the restricted timetable search answers, without the times, so a set that fails is not searched.

- Asked only when the stops within walking reach of both ends are known (from home): from the
  boarding stop alone, Poliez-Pittet → Lausanne inside 11 12 17 57 fails, though bus 670 runs
  from the village stop 10 minutes away.
- Measured on the sets of the test trips and four border homes: 4 sets refused (Poliez-Pittet
  11 12 18 57; Corcelles-sur-Chavornay 11 12 17 51 52 57, 11 12 18 51 52 57, 11 12 15 44 51 52 53),
  every one of them empty in the timetable without a time limit; no set refused that the timetable
  could serve.
- It does not know the times: Lovatens → EPFL still searches three sets of 8 zones in which
  vehicles run, but not in the window (each 20 to 100 ms of server time, beside the others).

## Inside the set, for sure (`insideSet`)

The fork checks every section a vehicle crosses, but it can place the boarding one stop earlier
than its search used when the traveller reaches that stop too: Echandens → Lausanne inside zones
11 12 came back boarding at Echandens, Chocolatière (zone 33), although the section to Larges
Pièces needs zones 12 and 33 (asked alone from that stop, the search rightly returns nothing).
Priced, that connection needs the third zone and the cheaper pass was lost. So every section of a
connection found inside a set is checked again with the fare data (`ZoneSearch.allows`, the logic
of the segment file). A first ride that starts outside the set is boarded at its first stop inside
it, a last ride that ends outside is left at its last stop inside, when that stop is within walking
reach; the walk from `stopsWithinWalk` replaces the one in the answer (intermediate stops now carry
their times). Anything else outside the set drops the connection. To fix in the fork: the
reconstruction of the journey (`reconstruct.cc`) should not move the boarding across a forbidden
section; the last trip home inside a pass uses the same search and can be affected the same way.

## The searches

- From home: one `plan` call per set, same window and walking limits as the normal search, plus
  `allowedSegmentTags`, `numItineraries=1` (otherwise MOTIS widens the search by hours until it has
  five connections: 0.4 s instead of 0.1 s) and `maxTravelTime`. They start as soon as the
  unrestricted answer is there and run beside the searches from the car parks, so they add no time
  of their own when there are such searches.
- A connection found this way is kept only if
  1. it takes at most 1.5 × the fastest connection found + 15 minutes (rules `zoneSearchMaxSlower`,
     `zoneSearchMaxExtraMin`; also sent to the server as `maxTravelTime`): inside a few zones the
     "best" connection is often absurd (Lucens → Lausanne in 1 h 57 through Thierrens against 54
     minutes by train);
  2. and, when it is on a ticket not found yet: it is at most 10 minutes slower than the fastest
     connection of the cheapest ticket found (`zoneSearchFreeExtraMin`), or every hour more over a
     year of commuting saves CHF 3 on that ticket (`zoneSearchMinChfPerHour`). 20 minutes more
     each way has to save about CHF 450 a year, 40 minutes CHF 900. CHF 3 is far below what an
     hour is worth to most people: only the absurd goes. Bus 361 (5 minutes, CHF 324) and a bus 15
     minutes slower for CHF 500 stay; from the car park of Châtillens, 79 minutes against 52 for
     CHF 252 goes, where 1.5 × + 15 let it through.
  A departure of a ticket already found is kept under rule 1 alone: its holder has no faster one
  at that time.
- From each car park or bike park tried: at most one search (rule `zoneSearchesPerSite`), for the
  cheapest set and only when it counts fewer zones than every connection found from the site. It
  runs after the site's own search, so it costs about 0.1 s when any site has such a set.
- Answers are merged (the same vehicles at the same times once), then grouped, priced and pruned
  as before.
- Only with a routing provider that has `segmentFilter` (the fork, `MOTIS_SEGMENT_FILTER=1`) and
  with `EngineDeps.zoneSearches`. Otherwise nothing changes.

## The same vehicle reached by a feeder (`sameVehicleOnce`)

Aigle → Lausanne: the IR 95 of 07:06 was listed twice, on foot to the station (leave 07:01) and with
bus 101 (leave 07:05, one change more), the second as a route of its own and as the fastest. Among
the connections from home on the same ticket that are the same from their main vehicle on (the
one the traveller sits longest in, and whatever follows), one with more changes before it is kept
only when it leaves home at least `sameVehicleMinSaving` (5) minutes later: the same rule as for
driving to a train one can walk to. What differs after the main vehicle is left alone: bus 7 then
the m2 for one stop (Chailly → Flon, 20 minutes against 24, at every departure) is a faster way to
arrive, not a one-off.

## What a car park or bike park is shown with (`prune`)

Every route from a site is a candidate, and a far car park came with three routes (Le Locle →
Neuchâtel: Corcelles-Peseux, CHF 10,556, 49–52 minutes, beside Neuchâtel-Serrières, CHF 10,095,
41 minutes).

- Per site: its cheapest ticket and its fastest ticket, nothing in between.
- Per ticket of a site: at most two routes (`maxRoutesPerAccessTicket`), those that add most departures.
- A site is not shown when another site of the same kind of access (by car: station car parks and
  city park-and-rides together; by bike) has, for each of its tickets, a ticket that is no dearer
  and no slower (two minutes are noise), and better on one of the two. It is named once among what
  was left out.
- Per kind, at most `maxOptionsPerKind` (3) tickets, as before.

## A place a car cannot leave or reach (`MotisRouting.drivable`)

Le Locle → Neuchâtel and Marin → Neuchâtel took over 4 s, Aigle → Lausanne 7.6 s: the car route
found nothing (Neuchâtel, Place Pury can be left by car but not reached; the forecourt of Aigle
station neither), after exploring every road within its 4-hour limit, and from Aigle five more
such searches ran at once for the city car parks. Those commutes had no car option at all. One
matrix call per place and direction (cached) asks whether any of eight points 600 m around is
reachable within five minutes; if none is, the nearest of sixteen points 150 and 300 m around that
is connected stands in for the place. With a car route, the rule `parkRailMaxDriveShare` applies
again: the car parks of Le Locle → Neuchâtel (a drive of more than half the way) are gone.

## Numbers (2026-11-11, median of 7, engine called directly, arrival 07:30–08:30)

Before = the state before the walkable stops; calls = MOTIS requests of one search (of which
restricted to zones). Two map calls and two walk matrices are new in every search.

| Trip | Before | After | Calls before → after | Ticket groups (public transport) after |
| --- | --- | --- | --- | --- |
| Lovatens → EPFL | 1.50 s | 1.56 s | 49 (15) → 51 (15) | 7 zones CHF 2,052, 475 · 361 · m2 · m1, 06:22 and 06:50; 9 zones CHF 2,376, 475 · R8 · m1, 06:22 and 06:50 (unchanged) |
| Lucens → Lausanne | 0.99 s | 1.00 s | 35 (10) → 39 (10) | 7 zones CHF 2,052 (361 · m2, 2 departures); 9 zones CHF 2,376 (R8/R9, 2) (unchanged) |
| Le Locle → Neuchâtel | 4.37 s | 0.38 s | 25 (4) → 19 (1) | Onde Verte all zones CHF 1,620, 3 routes, 4 departures (unchanged); car now there, the three car parks gone |
| Marin-Epagnier → Neuchâtel | 4.60 s | 0.40 s | 29 (4) → 24 (2) | 2 zones CHF 711, 2 routes, 10 departures (unchanged); car now there, car parks gone |
| Chapelle-sur-Moudon → Lausanne | 0.87 s | 0.79 s | 27 (3) → 31 (3) | 5 zones CHF 1,575, 2 routes, 3 departures (unchanged) |
| Aigle → Lausanne | 7.62 s | 0.60 s | 16 (1) → 21 (1) | 10 zones CHF 2,475, one route, 4 departures (the feeder route gone); car now there |
| Morges → EPFL | 0.36 s | 0.41 s | 17 (1) → 21 (1) | 4 zones CHF 1,305, 8 departures (unchanged) |
| Bulle → Fribourg | 0.76 s | 0.72 s | 19 (4) → 23 (4) | Frimobil all zones CHF 2,511; route pass CHF 2,628 (unchanged) |
| Zürich HB → Uster | 1.16 s | 1.05 s | 19 (1) → 23 (1) | ZVV 4 zones CHF 1,985, 6 departures (unchanged) |
| Genève → Plan-les-Ouates | 0.79 s | 0.76 s | 21 (1) → 25 (1) | Unireso CHF 500, 3 routes (unchanged) |
| Echandens / Ecublens → Flon | – | 0.89 s | 39 (5) | new: 2 zones CHF 729; 3 zones CHF 1,008 twice (bus, trains) |
| Corcelles-sur-Chavornay → Flon | – | 2.40 s | 40 (6) | new: 6 zones CHF 1,827 in place of 7 zones CHF 2,052; 8 zones CHF 2,232 (earlier train) |

Corcelles-sur-Chavornay: 1.7 s of the 2.4 are the second search from home (`alternateTies`, the
RAPTOR algorithm), as before this work. Times vary by ± 0.1 s with the load of the machine.

## Limits

- `realisable` says that vehicles run inside a set, not when: three of the four sets searched for
  Lovatens → EPFL return nothing in the window. Such a search costs 20 to 100 ms of server time,
  in parallel.
- A stop whose only hops cross a border is placed in both zones (the data does not say on which
  side it lies); the cheapest path can then be one zone short of what any vehicle needs, and its
  search returns nothing.
- Mobilis has four zones with no step to any other zone (all their hops stay inside them); Zug's
  plan is in two parts. No path, no search.
- One-zone networks (Unireso, TNW) have nothing to search.
- From a car park the ends still come from the connections found alone.
- The fork can board outside the set (see `insideSet`): mended in the planner for the first and the
  last ride, to be fixed in the fork.
- `stop-links.json` and the segment file come from the timetable: regenerate both with it.
