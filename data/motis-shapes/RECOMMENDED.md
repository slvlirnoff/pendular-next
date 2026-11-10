# Route-following shapes for MOTIS v2.11.4

GTFS (input/gtfs.zip) has NO shapes.txt, so `with_shapes: true` alone gives straight lines.
MOTIS can route shapes over OSM (`timetable.route_shapes`); the OSM rail graph then gives track-following geometry.

## Patch for data/motis/config.yml (under `timetable:`)

```diff
-  with_shapes: false
+  with_shapes: true
+  route_shapes:
+    mode: all            # or `missing` (identical here, GTFS has no shapes)
+    clasz:               # valid names verified on 2.11.4: COACH AIR BUS SHIP OTHER (CABLE_CAR/AERIAL_LIFT/AREAL_LIFT are rejected)
+      COACH: false       # slow long-distance street routing
+      AIR: false
+      SHIP: false
+      OTHER: false
```
(BUS is routed. Rail-only variant: also add `BUS: false`.) No server.port change needed for production;
for the test instance `server: {port: 8081}` was appended (server key is `server.port`; `motis server` has no --port/-c flag, it reads data/config.yml).
Then re-run `motis import` (osm + street_routing: true already set).

## Measurements (4 cores)
| | existing | with shapes (bus on) | rail only |
|---|---|---|---|
| import time | 1m48s | 4m38s (route_shapes 2m42s) | 3m09s (route_shapes 48s) |
| data dir | 1.9 GB | 2.8 GB | 2.5 GB |
Peak RAM during import ~4.5 GB used (+ page cache). Extra files: routed_shapes_data.bin (~600 MB rail), routed_shapes_cache.mdb (cache; delete before re-import to re-route all).
Server RAM and plan latency unchanged (~13-55 ms median); response size grows 2-4x (e.g. Lausanne-Bern 14 KB -> 58 KB for 3 itineraries) because of polylines.

## Client
Read distance from `leg.legGeometry`: decode `points` (precision `leg.legGeometry.precision`, 6 on this build) and sum haversine segment lengths.
`legGeometry.length` is the NUMBER OF POINTS, not metres. `leg.distance` is not present for transit legs.
Needs `detailedLegs=true` (default); with `detailedLegs=false` geometry is omitted. `detailedTransfers` / `joinInterlinedLegs` do not change the geometry.
Drop the 1.25/1.15 factors when the polyline has more than 2 points per hop (i.e. shapes are present); keep them as a fallback otherwise.
Decoded length is OSM track length, within about 1% of line kilometres, not the official tariff km (tariff km are rounded/ via-routing based).

## Limits
- Shapes are map-matched on OSM: stations can be a few hundred m off; very short hops may be bee-lined if OSM routing fails (debug via route_shapes.debug).
- Coach/air/ship/other not routed (straight lines, as before). Cable car/funicular/lifts are not selectable by clasz and fall under defaults.

## Start the test instance again
    cd /home/user/pendular-next/data/motis-shapes && nohup ../motis/bin/motis server -d data > server.log 2>&1 &
(port 8081 is stored in data/config.yml; serving data/motis-shapes/data)
