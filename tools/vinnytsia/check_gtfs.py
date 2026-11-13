"""Checks a GTFS the way a router needs it: references between files, times and distances in
order along each trip, frequencies, plausible speeds, stops near their trip's shape.

    python3 check_gtfs.py vinnytsia-gtfs.zip

Prints the problems found (errors first) and a summary; exits 1 on an error.
"""
import csv
import io
import math
import sys
import zipfile
from collections import defaultdict


def metres(a, b):
    la, lb = math.radians(a[0]), math.radians(b[0])
    h = math.sin((lb - la) / 2) ** 2 + math.cos(la) * math.cos(lb) * math.sin(math.radians(b[1] - a[1]) / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def secs(t):
    h, m, s = (int(x) for x in t.split(':'))
    return h * 3600 + m * 60 + s


def main(path):
    z = zipfile.ZipFile(path)
    read = lambda n: list(csv.DictReader(io.TextIOWrapper(z.open(n), 'utf-8-sig'))) if n in z.namelist() else []
    errors, warnings = [], []
    for required in ('agency.txt', 'stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt'):
        if required not in z.namelist():
            errors.append(f'missing {required}')
    stops = {s['stop_id']: s for s in read('stops.txt')}
    routes = {r['route_id']: r for r in read('routes.txt')}
    trips = {t['trip_id']: t for t in read('trips.txt')}
    services = {c['service_id'] for c in read('calendar.txt')} | {c['service_id'] for c in read('calendar_dates.txt')}
    shapes = defaultdict(list)
    for p in read('shapes.txt'):
        shapes[p['shape_id']].append((int(p['shape_pt_sequence']), float(p['shape_pt_lat']), float(p['shape_pt_lon']), float(p.get('shape_dist_traveled') or 0)))
    for sid, pts in shapes.items():
        pts.sort()
        if any(b[3] < a[3] for a, b in zip(pts, pts[1:])):
            errors.append(f'shape {sid}: distances decrease')
    for t in trips.values():
        if t['route_id'] not in routes:
            errors.append(f"trip {t['trip_id']}: unknown route {t['route_id']}")
        if t['service_id'] not in services:
            errors.append(f"trip {t['trip_id']}: unknown service {t['service_id']}")
        if t.get('shape_id') and t['shape_id'] not in shapes:
            errors.append(f"trip {t['trip_id']}: unknown shape {t['shape_id']}")
    for r in routes.values():
        if int(r['route_type']) not in (0, 1, 2, 3, 4, 5, 6, 7, 11, 12) and not 100 <= int(r['route_type']) < 1800:
            errors.append(f"route {r['route_id']}: route_type {r['route_type']}")
    by_trip = defaultdict(list)
    for st in read('stop_times.txt'):
        if st['stop_id'] not in stops:
            errors.append(f"stop_times: unknown stop {st['stop_id']}")
        if st['trip_id'] not in trips:
            errors.append(f"stop_times: unknown trip {st['trip_id']}")
        by_trip[st['trip_id']].append(st)
    durations, fast, far = [], [], []
    off_shape = {}  # (shape, stop): metres from the shape
    for tid, sts in by_trip.items():
        sts.sort(key=lambda s: int(s['stop_sequence']))
        if len(sts) < 2:
            errors.append(f'trip {tid}: fewer than two stops')
            continue
        for a, b in zip(sts, sts[1:]):
            if secs(b['arrival_time']) < secs(a['departure_time']):
                errors.append(f"trip {tid}: time goes back at stop {b['stop_sequence']}")
            if a.get('shape_dist_traveled') and b.get('shape_dist_traveled') and float(b['shape_dist_traveled']) < float(a['shape_dist_traveled']):
                errors.append(f"trip {tid}: shape distance goes back at stop {b['stop_sequence']}")
            pa, pb = stops[a['stop_id']], stops[b['stop_id']]
            d = metres((float(pa['stop_lat']), float(pa['stop_lon'])), (float(pb['stop_lat']), float(pb['stop_lon'])))
            dt = secs(b['arrival_time']) - secs(a['departure_time'])
            # Times given to the minute (as timetables print them): a hop of "1 min" can be 1:59.
            if a['departure_time'].endswith(':00') and b['arrival_time'].endswith(':00'):
                dt += 59
            if dt > 0 and d / dt * 3.6 > 80:
                fast.append(f"{tid}: {pa['stop_name']} → {pb['stop_name']} {d:.0f} m in {dt} s")
        durations.append((secs(sts[-1]['arrival_time']) - secs(sts[0]['departure_time'])) / 60)
        shape_id = trips.get(tid, {}).get('shape_id')
        if shape_id in shapes:
            for st in sts:
                key = (shape_id, st['stop_id'])
                if key not in off_shape:
                    p = stops[st['stop_id']]
                    q = (float(p['stop_lat']), float(p['stop_lon']))
                    off_shape[key] = min(metres(q, (s[1], s[2])) for s in shapes[shape_id])
                if off_shape[key] > 150:
                    far.append(f"{tid}: {stops[st['stop_id']]['stop_name']} ({st['stop_id']})")
    for tid in trips:
        if tid not in by_trip:
            errors.append(f'trip {tid}: no stop times')
    for f in read('frequencies.txt'):
        if f['trip_id'] not in trips:
            errors.append(f"frequency: unknown trip {f['trip_id']}")
        if secs(f['end_time']) <= secs(f['start_time']) or int(f['headway_secs']) <= 0:
            errors.append(f"frequency {f['trip_id']}: {f['start_time']}–{f['end_time']} every {f['headway_secs']} s")
    if fast:
        warnings.append(f'{len(fast)} hops faster than 80 km/h, e.g. ' + '; '.join(fast[:3]))
    if far:
        warnings.append(f'{len(far)} stop times more than 150 m from their shape, e.g. ' + '; '.join(far[:3]))
    long_ = [d for d in durations if d > 120]
    if long_:
        warnings.append(f'{len(long_)} trips longer than two hours')
    for e in errors[:40]:
        print('ERROR  ', e)
    for w in warnings:
        print('WARNING', w)
    durations.sort()
    print(f'{len(routes)} routes, {len(trips)} trips, {len(stops)} stops, {sum(len(v) for v in by_trip.values())} stop times, '
          f'{len(read("frequencies.txt"))} frequencies, {len(shapes)} shapes; trip duration median {durations[len(durations) // 2]:.0f} min '
          f'(min {durations[0]:.0f}, max {durations[-1]:.0f}); {len(errors)} errors, {len(warnings)} warnings')
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1]))
