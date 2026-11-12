"""A GTFS for the city transport of Vinnytsia (Ukraine): trams, trolleybuses and buses.

No timetable of the city is published as GTFS. Two sources make one:

  - OpenStreetMap: every line in each direction as a public transport route (PTv2): its stops in
    order and the ways it runs on (the stops, the shapes, the distances between stops);
  - depo.vn.ua, the site of the operator (КП «Вінницька транспортна компанія»): for each line and
    direction, on working days and on weekends and holidays, the first and last departure and the
    interval (the trips, as frequencies); and for the share taxis (маршрутні таксі, the lines with
    a letter: 1А, 2Б…), their first and last departures and the range of their interval, the same
    every day.

The times between stops are not published in these tables: they come from the distance along
the route at a commercial speed per mode (stops included). The departures are frequencies
(exact_times=0): "every 12 minutes from 06:01 to 22:56", as the operator publishes them.

    python3 build_gtfs.py --osm vinnytsia_oblast.osm.pbf --out vinnytsia-gtfs.zip [--cache dir]

Needs pyosmium. Writes a report of the lines matched and not matched next to the zip.
"""
from __future__ import annotations

import argparse
import csv
import html
import io
import json
import math
import os
import re
import sys
import urllib.request
import zipfile
from dataclasses import dataclass, field

import osmium

# The city and its suburbs served by the city lines.
CITY = (49.13, 28.28, 49.33, 28.68)  # south, west, north, east
MODES = {'tram': 'tram', 'trolleybus': 'trol', 'bus': 'avt', 'share_taxi': 'avt', 'minibus': 'avt'}
ROUTE_TYPE = {'tram': 0, 'trolleybus': 11, 'bus': 3, 'share_taxi': 3, 'minibus': 3}
# Commercial speed, stops included (km/h): Vinnytsia's trams and trolleybuses run in mixed traffic.
SPEED_KMH = {'tram': 16.0, 'trolleybus': 17.0, 'bus': 19.0, 'share_taxi': 21.0, 'minibus': 21.0}
COLOURS = {'tram': 'D93A24', 'trolleybus': '1E40AF', 'bus': '0F766E', 'share_taxi': 'B45309', 'minibus': 'B45309'}
DEPO = 'https://depo.vn.ua/route/bytable/'
DEPO_TAXI = 'https://depo.vn.ua/content/marshrutnoe-taksi'
SERVICES = ('WD', 'WE', 'ALL')  # working days; weekends and holidays (the two tables of each page); every day (share taxis)


# ------------------------------------------------------------------------------------------------
# depo.vn.ua: first and last departure and interval, per line and direction
# ------------------------------------------------------------------------------------------------

@dataclass
class Run:
    mode: str          # tram, trol, avt
    ref: str           # "1", "10А"
    stops: list[str]   # "Залізничний вокзал - Електромережа" split
    first: int         # minutes after midnight
    last: int
    interval: int      # minutes (0: the departures are listed in `times`)
    service: str       # WD, WE or ALL
    times: list[int] | None = None


def minutes(hhmm: str) -> int | None:
    m = re.fullmatch(r'(\d{1,2}):(\d{2})', hhmm.strip())
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def fetch(url: str, cache: str | None) -> str:
    path = os.path.join(cache, re.sub(r'[^A-Za-z0-9.]+', '_', url)) if cache else None
    if path and os.path.exists(path):
        return open(path, encoding='utf-8').read()
    req = urllib.request.Request(url, headers={'User-Agent': 'trajestaurant-gtfs-builder (non-commercial)'})
    text = urllib.request.urlopen(req, timeout=60).read().decode('utf-8', 'replace')
    if path:
        os.makedirs(cache, exist_ok=True)
        open(path, 'w', encoding='utf-8').write(text)
    return text


def depo_runs(cache: str | None) -> list[Run]:
    runs: list[Run] = []
    for mode in ('tram', 'trol', 'avt'):
        page = fetch(DEPO + mode, cache)
        tables = re.findall(r'<table.*?</table>', page, flags=re.S)
        # The page shows working days first, then weekends and holidays.
        for service, table in zip(SERVICES, tables):
            for row in re.findall(r'<tr.*?</tr>', table, flags=re.S):
                cells = [re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', c))).strip() for c in re.findall(r'<td[^>]*>(.*?)</td>', row, flags=re.S)]
                if len(cells) < 7 or not re.match(r'^\w', cells[0]):
                    continue
                first, last, interval = minutes(cells[2]), minutes(cells[3]), minutes(cells[6])
                if first is None or last is None or not interval:
                    continue
                if last < first:
                    last += 24 * 60
                runs.append(Run(mode, norm_ref(cells[0]), [s.strip() for s in re.split(r'\s+[-–—]\s+', cells[1]) if s.strip()], first, last, interval, service))
    runs.extend(taxi_runs(cache))
    return runs


def taxi_runs(cache: str | None) -> list[Run]:
    """The share taxis. The table merges cells: a line's number spans its rows, a direction's ends
    span its working-day ("роб.") and weekend ("вих.") rows when they differ. A row then holds the
    first departures, the last ones and the interval as a range ("7-10": its middle), or, for the
    lines to the villages, every departure of the day in one cell."""
    page = fetch(DEPO_TAXI, cache)
    runs: list[Run] = []
    ref = ends = None
    for table in re.findall(r'<table.*?</table>', page, flags=re.S):
        for row in re.findall(r'<tr.*?</tr>', table, flags=re.S):
            cells = [re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', c))).strip() for c in re.findall(r'<td[^>]*>(.*?)</td>', row, flags=re.S)]
            cells = [c for c in cells if c]
            if cells and re.fullmatch(r'\d{1,3}\s*[А-ЯІЇЄA-Z]?', cells[0]):
                ref, cells = norm_ref(cells[0]), cells[1:]
            if cells and re.search(r'\s[—–-]\s', cells[0]) and not re.search(r'\d:\d', cells[0]):
                ends, cells = cells[0], cells[1:]
            service = 'ALL'
            if cells and cells[0].rstrip('.').lower() in ('роб', 'вих'):
                service, cells = ('WD' if cells[0].lower().startswith('роб') else 'WE'), cells[1:]
            if not ref or not ends or not cells:
                continue
            stops = [x.strip() for x in re.split(r'\s+[—–-]\s+', ends) if x.strip()]
            if len(cells) >= 3:
                f = [m for m in (minutes(x) for x in re.findall(r'\d{1,2}:\d{2}', cells[0])) if m is not None]
                l = [m for m in (minutes(x) for x in re.findall(r'\d{1,2}:\d{2}', cells[1])) if m is not None]
                iv = [int(x) for x in re.findall(r'\d+', cells[2])]
                if f and l and iv:
                    first, last = min(f), max(l)
                    runs.append(Run('avt', ref, stops, first, last if last >= first else last + 1440, round(sum(iv) / len(iv)), service))
            elif len(cells) == 1:
                times = sorted(m for m in (minutes(x) for x in re.findall(r'\d{1,2}:\d{2}', cells[0])) if m is not None)
                if times:
                    runs.append(Run('avt', ref, stops, times[0], times[-1], 0, service, times))
    return runs


# ------------------------------------------------------------------------------------------------
# Names: Cyrillic and Latin look-alikes, case, punctuation
# ------------------------------------------------------------------------------------------------

LOOKALIKE = str.maketrans({'A': 'А', 'B': 'В', 'C': 'С', 'E': 'Е', 'H': 'Н', 'I': 'І', 'K': 'К', 'M': 'М', 'O': 'О', 'P': 'Р', 'T': 'Т', 'X': 'Х', 'Y': 'У'})


def norm_ref(ref: str) -> str:
    return re.sub(r'\s+', '', ref.upper().translate(LOOKALIKE))


GENERIC = {'вул', 'вулиця', 'пр', 'просп', 'проспект', 'пл', 'площа', 'зупинка', 'кінцева', 'вінниця', 'м', 'село', 'с', 'смт', 'селище'}


def words(name: str) -> set[str]:
    t = re.sub(r"[^\w']+", ' ', name.lower().replace('ʼ', "'").replace('’', "'"))
    return {w for w in t.split() if len(w) > 1 and w not in GENERIC}


def alike(a: str, b: str) -> float:
    wa, wb = words(a), words(b)
    if not wa or not wb:
        return 0.0
    shared = sum(1 for x in wa if any(x[:5] == y[:5] for y in wb))
    return shared / min(len(wa), len(wb))


# ------------------------------------------------------------------------------------------------
# OpenStreetMap: routes, their stops and ways
# ------------------------------------------------------------------------------------------------

@dataclass
class Route:
    id: int
    tags: dict
    members: list  # (type, ref, role)
    master: dict | None = None


class Relations(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.routes: dict[int, Route] = {}
        self.masters: dict[int, dict] = {}
        self.master_of: dict[int, int] = {}

    def relation(self, r):
        t = dict(r.tags)
        if t.get('type') == 'route' and t.get('route') in MODES:
            self.routes[r.id] = Route(r.id, t, [(m.type, m.ref, m.role) for m in r.members])
        elif t.get('type') == 'route_master' and t.get('route_master') in MODES:
            self.masters[r.id] = t
            for m in r.members:
                if m.type == 'r':
                    self.master_of[m.ref] = r.id


class Ways(osmium.SimpleHandler):
    def __init__(self, wanted: set[int]):
        super().__init__()
        self.wanted = wanted
        self.nodes: dict[int, list[int]] = {}
        self.tags: dict[int, dict] = {}

    def way(self, w):
        if w.id in self.wanted:
            self.nodes[w.id] = [n.ref for n in w.nodes]
            self.tags[w.id] = dict(w.tags)


class Nodes(osmium.SimpleHandler):
    def __init__(self, wanted: set[int], tagged: set[int]):
        super().__init__()
        self.wanted = wanted
        self.tagged = tagged
        self.loc: dict[int, tuple[float, float]] = {}
        self.tags: dict[int, dict] = {}

    def node(self, n):
        if n.id in self.wanted:
            self.loc[n.id] = (n.location.lat, n.location.lon)
            if n.id in self.tagged:
                self.tags[n.id] = dict(n.tags)


def metres(a, b) -> float:
    la, lb = math.radians(a[0]), math.radians(b[0])
    dlat, dlon = lb - la, math.radians(b[1] - a[1])
    h = math.sin(dlat / 2) ** 2 + math.cos(la) * math.cos(lb) * math.sin(dlon / 2) ** 2
    return 2 * 6_371_000 * math.asin(math.sqrt(h))


def chain(ways: list[list[tuple[float, float]]]) -> list[tuple[float, float]]:
    """The ways of a route one after the other, each turned to start where the last one ended."""
    line: list[tuple[float, float]] = []
    for i, w in enumerate(ways):
        if len(w) < 2:
            continue
        if not line:
            # The first way's direction: towards the second way.
            nxt = next((x for x in ways[i + 1:] if len(x) >= 2), None)
            if nxt and min(metres(w[0], nxt[0]), metres(w[0], nxt[-1])) < min(metres(w[-1], nxt[0]), metres(w[-1], nxt[-1])):
                w = w[::-1]
            line.extend(w)
            continue
        if metres(line[-1], w[-1]) < metres(line[-1], w[0]):
            w = w[::-1]
        line.extend(w[1:] if metres(line[-1], w[0]) < 1 else w)
    return line


def project(line: list[tuple[float, float]], cum: list[float], p: tuple[float, float], after: float) -> float:
    """Distance along the line of the point nearest to p, not before `after` (stops come in order)."""
    best, best_d = after, float('inf')
    for i in range(len(line) - 1):
        if cum[i + 1] < after:
            continue
        a, b = line[i], line[i + 1]
        # Local flat projection (metres).
        kx = 111_320 * math.cos(math.radians(a[0]))
        ax, ay, bx, by, px, py = a[1] * kx, a[0] * 110_540, b[1] * kx, b[0] * 110_540, p[1] * kx, p[0] * 110_540
        dx, dy = bx - ax, by - ay
        L = dx * dx + dy * dy
        t = 0.0 if L == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L))
        qx, qy = ax + t * dx, ay + t * dy
        d = math.hypot(px - qx, py - qy)
        along = cum[i] + t * (cum[i + 1] - cum[i])
        if d < best_d - 1e-6 and along >= after:
            best, best_d = along, d
    return best


# ------------------------------------------------------------------------------------------------
# GTFS
# ------------------------------------------------------------------------------------------------

def minutes_of(t: str) -> float:
    h, m, s_ = (int(x) for x in t.split(':'))
    return h * 60 + m + s_ / 60


def hms(m: float) -> str:
    s = int(round(m * 60))
    return f'{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--osm', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--cache', default=None)
    ap.add_argument('--start', default='20261101')
    ap.add_argument('--end', default='20271231')
    args = ap.parse_args()

    runs = depo_runs(args.cache)
    print(f'depo.vn.ua: {len(runs)} runs (line, direction, day type)', file=sys.stderr)

    rel = Relations()
    rel.apply_file(args.osm)
    way_ids = {ref for r in rel.routes.values() for t, ref, role in r.members if t == 'w'}
    stop_nodes = {ref for r in rel.routes.values() for t, ref, role in r.members if t == 'n'}
    ways = Ways(way_ids)
    ways.apply_file(args.osm)
    node_ids = set(stop_nodes)
    for ns in ways.nodes.values():
        node_ids.update(ns)
    nodes = Nodes(node_ids, stop_nodes | {ns[0] for ns in ways.nodes.values() if ns})
    nodes.apply_file(args.osm)

    def way_line(wid):
        return [nodes.loc[n] for n in ways.nodes.get(wid, []) if n in nodes.loc]

    def centre(t, ref):
        if t == 'n':
            return nodes.loc.get(ref)
        pts = way_line(ref)
        return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)) if pts else None

    def name_of(t, ref):
        tags = nodes.tags.get(ref, {}) if t == 'n' else ways.tags.get(ref, {})
        return tags.get('name:uk') or tags.get('name') or ''

    in_city = lambda p: CITY[0] <= p[0] <= CITY[2] and CITY[1] <= p[1] <= CITY[3]

    stops: dict[str, dict] = {}
    routes_out: dict[str, dict] = {}
    trips, stop_times, freqs, shapes = [], [], [], []
    report = {'matched': [], 'unmatched_osm': [], 'unmatched_depo': []}
    used_runs = set()

    for r in sorted(rel.routes.values(), key=lambda r: (r.tags.get('route'), norm_ref(r.tags.get('ref', '')), r.id)):
        mode = r.tags['route']
        ref = norm_ref(r.tags.get('ref', ''))
        # The route's stops: a stop position and the platform after it are one stop; the
        # platform (where people wait) stands for it when there is one.
        seq: list[tuple[str, int]] = []
        pending = None
        for t, mref, role in r.members:
            if t not in ('n', 'w') or not role:
                continue
            if role.startswith('stop'):
                if pending:
                    seq.append(pending)
                pending = (t, mref)
            elif role.startswith('platform'):
                seq.append((t, mref))
                pending = None
        if pending:
            seq.append(pending)
        pts = [(t, ref_, centre(t, ref_)) for t, ref_ in seq]
        pts = [x for x in pts if x[2]]
        if len(pts) < 2 or not any(in_city(p) for _, _, p in pts):
            continue
        line = chain([way_line(ref_) for t, ref_, role in r.members if t == 'w' and not role.startswith('platform')])
        if len(line) < 2:
            line = [p for _, _, p in pts]
        cum = [0.0]
        for a, b in zip(line, line[1:]):
            cum.append(cum[-1] + metres(a, b))

        first_name = next((name_of(t, x) for t, x, _ in pts if name_of(t, x)), r.tags.get('from', ''))
        last_name = next((name_of(t, x) for t, x, _ in reversed(pts) if name_of(t, x)), r.tags.get('to', ''))
        frm, to = r.tags.get('from') or first_name, r.tags.get('to') or last_name

        # The operator's runs of this line in this direction: the row whose ends are this route's.
        cands = [i for i, run in enumerate(runs) if run.mode == MODES[mode] and run.ref == ref]
        def score(run):
            return max(alike(frm, run.stops[0]), alike(first_name, run.stops[0])) + max(alike(to, run.stops[-1]), alike(last_name, run.stops[-1]))
        by_service = {}
        for service in SERVICES:
            opts = sorted(((score(runs[i]), i) for i in cands if runs[i].service == service), reverse=True)
            if opts and opts[0][0] >= 0.5:
                by_service[service] = opts[0][1]
        label = f"{mode} {r.tags.get('ref', '?')} {frm} → {to} (r{r.id})"
        if not by_service:
            report['unmatched_osm'].append(label)
            continue
        report['matched'].append(f"{label} ⇐ " + '; '.join(f"{s}: {' - '.join(runs[i].stops)} {runs[i].first // 60:02d}:{runs[i].first % 60:02d}-{runs[i].last // 60:02d}:{runs[i].last % 60:02d} /{runs[i].interval}'" for s, i in by_service.items()))
        used_runs.update(by_service.values())

        # A share taxi tagged so in one direction and as a bus in the other is one line.
        route_id = f"{'bus' if MODES[mode] == 'avt' else mode}-{ref}"
        if route_id not in routes_out:
            master = rel.masters.get(rel.master_of.get(r.id, -1), {})
            colour = (r.tags.get('colour') or master.get('colour') or '').lstrip('#')
            routes_out[route_id] = {
                'route_id': route_id,
                'agency_id': 'vtk',
                'route_short_name': r.tags.get('ref', ref),
                'route_long_name': master.get('name:uk') or master.get('name') or f"{frm} — {to}",
                'route_type': ROUTE_TYPE[mode],
                'route_color': colour.upper() if re.fullmatch(r'[0-9A-Fa-f]{6}', colour) else COLOURS[mode],
                'route_text_color': 'FFFFFF',
            }

        shape_id = f"r{r.id}"
        for i, p in enumerate(line):
            shapes.append({'shape_id': shape_id, 'shape_pt_lat': f'{p[0]:.6f}', 'shape_pt_lon': f'{p[1]:.6f}', 'shape_pt_sequence': i, 'shape_dist_traveled': f'{cum[i]:.1f}'})

        # Stops along the line, and the time to each at the mode's commercial speed.
        along = []
        last = 0.0
        for t, x, p in pts:
            d = project(line, cum, p, last) if len(line) > 2 else last
            along.append(d)
            last = d
        speed = SPEED_KMH[mode] * 1000 / 60  # metres a minute
        # The time to each stop: the distance along the route, never less than the straight line
        # with a detour of a fifth (where a stop falls off a gap in the route's ways).
        elapsed = [0.0]
        for k in range(1, len(pts)):
            hop = max(along[k] - along[k - 1], metres(pts[k - 1][2], pts[k][2]) * 1.2)
            elapsed.append(elapsed[-1] + hop / speed)
        for service, i in by_service.items():
            run = runs[i]
            trip_id = f"{shape_id}-{service}"
            trips.append({'route_id': route_id, 'service_id': service, 'trip_id': trip_id, 'trip_headsign': run.stops[-1], 'shape_id': shape_id})
            for k, ((t, x, p), d) in enumerate(zip(pts, along)):
                sid = f"{t}{x}"
                if sid not in stops:
                    stops[sid] = {'stop_id': sid, 'stop_name': name_of(t, x) or frm, 'stop_lat': f'{p[0]:.6f}', 'stop_lon': f'{p[1]:.6f}'}
                off = elapsed[k]
                stop_times.append({'trip_id': trip_id, 'arrival_time': hms(off), 'departure_time': hms(off), 'stop_id': sid, 'stop_sequence': k, 'shape_dist_traveled': f'{d:.1f}'})
            if run.times:
                # Every departure listed: the trip's times shifted to each (exact times).
                base = trips.pop()
                block = stop_times[-len(pts):]
                del stop_times[-len(pts):]
                for dep in run.times:
                    tid = f"{trip_id}-{dep // 60:02d}{dep % 60:02d}"
                    trips.append({**base, 'trip_id': tid})
                    for st in block:
                        off = hms(dep + minutes_of(st['arrival_time']))
                        stop_times.append({**st, 'trip_id': tid, 'arrival_time': off, 'departure_time': off})
            else:
                # Departures every `interval` minutes from the first to the last one (included).
                freqs.append({'trip_id': trip_id, 'start_time': hms(run.first), 'end_time': hms(run.last + 1), 'headway_secs': run.interval * 60, 'exact_times': 0})

    report['unmatched_depo'] = [f"{r.mode} {r.ref} {' - '.join(r.stops)} ({r.service})" for i, r in enumerate(runs) if i not in used_runs]

    files = {
        'agency.txt': [{'agency_id': 'vtk', 'agency_name': 'КП «Вінницька транспортна компанія»', 'agency_url': 'https://depo.vn.ua/', 'agency_timezone': 'Europe/Kyiv', 'agency_lang': 'uk'}],
        'stops.txt': list(stops.values()),
        'routes.txt': list(routes_out.values()),
        'trips.txt': trips,
        'stop_times.txt': stop_times,
        'frequencies.txt': freqs,
        'shapes.txt': shapes,
        'calendar.txt': [
            {'service_id': 'ALL', 'monday': 1, 'tuesday': 1, 'wednesday': 1, 'thursday': 1, 'friday': 1, 'saturday': 1, 'sunday': 1, 'start_date': args.start, 'end_date': args.end},
            {'service_id': 'WD', 'monday': 1, 'tuesday': 1, 'wednesday': 1, 'thursday': 1, 'friday': 1, 'saturday': 0, 'sunday': 0, 'start_date': args.start, 'end_date': args.end},
            {'service_id': 'WE', 'monday': 0, 'tuesday': 0, 'wednesday': 0, 'thursday': 0, 'friday': 0, 'saturday': 1, 'sunday': 1, 'start_date': args.start, 'end_date': args.end},
        ],
        'feed_info.txt': [{'feed_publisher_name': 'Trajestaurant (generated from OpenStreetMap and depo.vn.ua)', 'feed_publisher_url': 'https://www.openstreetmap.org/copyright', 'feed_lang': 'uk', 'feed_start_date': args.start, 'feed_end_date': args.end, 'feed_version': args.start}],
        'attributions.txt': [
            {'attribution_id': 'osm', 'organization_name': 'OpenStreetMap contributors (ODbL): stops, routes, shapes', 'is_data_source': 1, 'attribution_url': 'https://www.openstreetmap.org/copyright'},
            {'attribution_id': 'depo', 'organization_name': 'depo.vn.ua (КП «Вінницька транспортна компанія»): first and last departures, intervals', 'is_data_source': 1, 'attribution_url': 'https://depo.vn.ua/route/bytable/tram'},
            {'attribution_id': 'depo-taxi', 'organization_name': 'depo.vn.ua: share taxis (маршрутні таксі), first and last departures, intervals', 'is_data_source': 1, 'attribution_url': DEPO_TAXI},
        ],
    }
    with zipfile.ZipFile(args.out, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, rows in files.items():
            buf = io.StringIO()
            w = csv.DictWriter(buf, fieldnames=list(rows[0].keys()), lineterminator='\n')
            w.writeheader()
            w.writerows(rows)
            z.writestr(name, buf.getvalue())
    with open(os.path.splitext(args.out)[0] + '-report.json', 'w', encoding='utf-8') as h:
        json.dump(report, h, ensure_ascii=False, indent=1)
    print(f"{len(routes_out)} lines, {len(trips)} trips (route directions × day types), {len(stops)} stops; "
          f"matched {len(report['matched'])} OSM routes, unmatched {len(report['unmatched_osm'])}; "
          f"depo runs not used {len(report['unmatched_depo'])}", file=sys.stderr)


if __name__ == '__main__':
    main()
