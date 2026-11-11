<!--
Notes for a feature request to github.com/motis-project/motis. NOT to be posted as written.

MOTIS's README (Contributing) says: "Communication intended to be read by humans on any channel
(Matrix, Issues, PRs, etc.) should be written by humans, not by AI." This file was drafted by an
AI assistant: use it as a checklist of facts and write the issue in your own words.
-->

# Feature request: restrict a search to allowed route segments (per-request filter)

## Use case

We build a commute comparator for Switzerland on MOTIS. One question we cannot answer with the
current API: **"what is the last connection home that a given zone pass covers?"**

A zone pass covers the segments (stop to next stop) whose fare zones all belong to the pass.
The latest connection overall is easy (`arriveBy=true`, `timetableView=false`). But the latest
connection *inside the pass* is usually slower than one outside it, so it is dominated and never
returned. Filtering the answer afterwards cannot bring it back.

Concrete case (Swiss timetable 2027, Tuesday 19 January, Lausanne → Lucens, arrive by 02:00):

- returned: direct train R9 leaving 23:54. It crosses zones the cheaper pass does not include.
- wanted: metro m2 23:02 → bus 362 23:22 → train R9 00:36 from Moudon, leaving 22:58. Every
  segment is inside the pass.
- `via` does not help: with `via=<Croisettes>,<Moudon>` the answer is the metro up and back down
  plus the same direct train (it also passes Moudon), which again dominates the wanted trip.

The same need shows up as "stay inside this fare network", "avoid this operator" or "only lines
of this region": all are restrictions on which segments a ride may use.

## What we found in the code (v2.11.4, nigiri 18bf63c2)

RAPTOR already drops a ride when it crosses a section that lacks a property: `route_flags_` /
`route_flags_per_section_` (`kBikesAllowed`, `kCarsAllowed`, `kWheelchairAccessible`,
`kReservationNotRequired`), tested per route in `loop_routes`, per section in `update_route`
(`apply_filter` resets `et`), and again in `reconstruct.cc`. The routing endpoint falls back to
RAPTOR when one of these is requested.

Those flags are fixed at import. A pass filter differs in one way: the allowed set comes with the
request.

## Proposal

A generic **segment tag** filter:

1. **Data (import, optional):** a table `from_stop_id, to_stop_id, tags` (for us: one tag per
   fare zone a hop uses, e.g. `mobilis:60`). Each route section stores the id of its tag set.
   Sections without a row have no tags.
2. **Request:** `allowedSegmentTags=tag1,tag2,…`. At query start, mark the tag sets that are
   subsets of the list.
3. **Search:** a ride may only cross sections whose tag set is marked, checked where the bike
   and wheelchair section filters are checked, and in journey reconstruction. Footpaths are not
   affected. Fallback to RAPTOR as for the existing section filters.
4. Whether untagged sections are allowed could be a second parameter (default: not allowed when
   the filter is set).

GTFS Fares v2 areas cannot express this for us: a rule sees where one boards and alights, not the
zones crossed in between (in the Swiss fare data, 2–5 % of hops cross a zone neither end lies in,
mostly fast trains).

## Questions

- Is a per-request section filter something you would accept? In nigiri, in MOTIS, or both?
- Would you prefer tags as proposed, or a filter on existing ids (route ids, agency ids, fare
  areas) with segment tags as a later step?
- The section filters are compile-time variants today (16 combinations). Should a fifth one
  follow that pattern, or be a run-time check?
- Which algorithms would need to support it for you to merge it (RAPTOR only, as for bikes)?

## Prototype

We tried it on a fork of v2.11.4 (RAPTOR only, tag table loaded at server start, run-time check):
about 270 lines in nigiri and 140 in MOTIS, following the existing section filters. On the case
above the filtered query returns the wanted 22:58 trip; without the parameter the answer is
identical to the release binary. The search itself goes from under 1 ms to 1-2 ms; the request
stays at 33-40 ms, dominated by street routing. One-to-all honours the filter too (3,723
reachable locations unfiltered, 396 inside the pass).

We are happy to contribute a proper implementation along the lines you prefer.
