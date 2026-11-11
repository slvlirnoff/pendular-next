# Zone paths: searching the timetable inside the zones of a cheaper pass

Code: `packages/engine/src/fares/zonePaths.ts` (zone graph, paths, which sets to search),
`packages/engine/src/planner/compare.ts` (`withinZones`: the searches and the merge),
`packages/engine/src/routing/motis.ts` (`transit` with `allowedSegmentTags`).
Tests: `packages/engine/test/zonePaths.test.ts`, `planner-tickets.test.ts`, `segmentTags.test.ts`.

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
  connections. Stops within walking reach that no returned connection uses are not looked at.
- **Networks**: every network with a pass plan and a price grid that has one of the first stops and
  one of the last stops (joint passes such as Léman Pass and Z-Pass are left out, as for pricing).
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
- **Bound**: cheapest first, at most `max` sets in all (rule `zoneSearches`, 4), taken in turn from
  each network when there are several.

## The searches

- From home: one `plan` call per set, same window and walking limits as the normal search, plus
  `allowedSegmentTags`, `numItineraries=1` (otherwise MOTIS widens the search by hours until it has
  five connections: 0.4 s instead of 0.1 s) and `maxTravelTime`. They start as soon as the
  unrestricted answer is there and run beside the searches from the car parks, so they add no time
  of their own when there are such searches.
- A connection found this way is kept only if it takes at most 1.5 × the fastest connection found
  + 15 minutes. Inside a few zones the "best" connection is often absurd (Lucens → Lausanne in
  1 h 57 through Thierrens against 54 minutes by train).
- From each car park or bike park tried: at most one search (rule `zoneSearchesPerSite`), for the
  cheapest set and only when it counts fewer zones than every connection found from the site. It
  runs after the site's own search, so it costs about 0.1 s when any site has such a set.
- Answers are merged (the same vehicles at the same times once), then grouped, priced and pruned
  as before.
- Only with a routing provider that has `segmentFilter` (the fork, `MOTIS_SEGMENT_FILTER=1`) and
  with `EngineDeps.zoneSearches`. Otherwise nothing changes.

Measured on Lovatens → EPFL (median of 5, 2026-11-11): 1.40 s before, 1.55 s after; without the
per-site searches 1.41 s.

## Limits

- The zone graph says which zones touch, not that a vehicle runs: three of the four sets searched
  for Lovatens → EPFL return nothing. Such a search costs about 0.1 s of server time, in parallel.
- A stop whose only hops cross a border is placed in both zones (the data does not say on which
  side it lies); the cheapest path can then be one zone short of what any vehicle needs, and its
  search returns nothing.
- Mobilis has four zones with no step to any other zone (all their hops stay inside them); Zug's
  plan is in two parts. No path, no search.
- One-zone networks (Unireso, TNW) have nothing to search.
- The ends come from the connections found: a cheaper route that starts at another stop near home,
  in another zone than every stop used, is not looked for.
