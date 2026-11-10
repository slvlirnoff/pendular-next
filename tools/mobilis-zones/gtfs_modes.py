"""Which transport modes serve each GTFS station? usage: gtfs_modes.py gtfs.zip out/stop_modes.json
Streams stop_times.txt (1.4 GB) and maps trip -> route_type; only stops inside the Vaud bbox are kept."""
import sys, zipfile, io, csv, json, collections
LAT = (46.15, 47.0); LON = (6.0, 7.3)
z = zipfile.ZipFile(sys.argv[1])
stops = list(csv.DictReader(io.TextIOWrapper(z.open('stops.txt'), 'utf-8-sig')))
parent_of = {}
for s in stops:
    if LAT[0] <= float(s['stop_lat']) <= LAT[1] and LON[0] <= float(s['stop_lon']) <= LON[1]:
        parent_of[s['stop_id']] = s['stop_id'] if s['location_type'] == '1' else s['parent_station']
rt = {r['route_id']: r['route_type'] for r in csv.DictReader(io.TextIOWrapper(z.open('routes.txt'), 'utf-8-sig'))}
trip_rt = {}
f = io.TextIOWrapper(z.open('trips.txt'), 'utf-8-sig'); rd = csv.reader(f); h = next(rd); ir, it = h.index('route_id'), h.index('trip_id')
for row in rd: trip_rt[row[it]] = rt.get(row[ir], '?')
print('trips', len(trip_rt), file=sys.stderr)
modes = collections.defaultdict(collections.Counter)
f = io.TextIOWrapper(z.open('stop_times.txt'), 'utf-8-sig', newline=''); rd = csv.reader(f); h = next(rd); it, isd = h.index('trip_id'), h.index('stop_id')
for n, row in enumerate(rd):
    p = parent_of.get(row[isd])
    if p: modes[p][trip_rt.get(row[it], '?')] += 1
json.dump({k: dict(v) for k, v in modes.items()}, open(sys.argv[2], 'w'))
print('stations with service', len(modes), 'rows', n, file=sys.stderr)
