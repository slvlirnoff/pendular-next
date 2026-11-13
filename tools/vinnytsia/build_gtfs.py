"""A GTFS for the city transport of Vinnytsia (Ukraine): trams, trolleybuses, buses and share taxis.

No timetable of the city is published as GTFS. Three sources make one:

  - vn.rozklad.in.ua, the timetables posted at the stops: for each line and direction its stops in
    order with the minutes from the first one, and every departure on working days and on weekends
    (trams, trolleybuses, buses, the suburban lines). Each departure is a trip;
  - OpenStreetMap: where the stops are (OSM's stops of the same names, the shortest plausible way
    from one to the next, those of the line's own route preferred) and each line's route (PTv2), its
    shape when every stop lies along it;
  - depo.vn.ua, the operator's site (КП «Вінницька транспортна компанія»): the share taxis
    (маршрутні таксі: 1А, 2Б…) rozklad does not have, with their first and last departures and
    interval or every departure, laid on OSM's route of the line: there, the time between stops is
    the distance along the route at a commercial speed per mode, and the trips are frequencies.

    python3 build_gtfs.py --osm vinnytsia_oblast.osm.pbf --out vinnytsia-gtfs.zip [--cache dir] [--rozklad dir]

Needs pyosmium. Writes a report next to the zip: the lines each source knows and where each line of
the GTFS comes from, the stops not placed, the OSM routes matched and not.
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
from collections import Counter, defaultdict
from dataclasses import dataclass, field

import osmium

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rozklad  # noqa: E402

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
    taxi: bool = False  # from the share-taxi page (the other lines: the operator's own tables)


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
                    runs.append(Run('avt', ref, stops, first, last if last >= first else last + 1440, round(sum(iv) / len(iv)), service, taxi=True))
            elif len(cells) == 1:
                times = sorted(m for m in (minutes(x) for x in re.findall(r'\d{1,2}:\d{2}', cells[0])) if m is not None)
                if times:
                    runs.append(Run('avt', ref, stops, times[0], times[-1], 0, service, times, taxi=True))
    return runs


# ------------------------------------------------------------------------------------------------
# Names: Cyrillic and Latin look-alikes, case, punctuation
# ------------------------------------------------------------------------------------------------

LOOKALIKE = str.maketrans({'A': 'А', 'B': 'В', 'C': 'С', 'E': 'Е', 'H': 'Н', 'I': 'І', 'K': 'К', 'M': 'М', 'O': 'О', 'P': 'Р', 'T': 'Т', 'X': 'Х', 'Y': 'У'})


def norm_ref(ref: str) -> str:
    return re.sub(r'\s+', '', ref.upper().translate(LOOKALIKE))


GENERIC = {'вул', 'вулиця', 'пр', 'просп', 'проспект', 'пл', 'площа', 'зупинка', 'кінцева', 'вінниця', 'м', 'село', 'с', 'смт', 'селище', 'ім', 'імені',
           'тов', 'пат', 'прат', 'кп', 'пп',  # company forms
           'пров', 'провулок', 'бульв'}
# The words that make a name a street's (вулиця, провулок, проспект, площа, шосе…).
STREET = {'вул', 'вулиця', 'пров', 'провулок', 'пр', 'просп', 'проспект', 'бульв', 'бульвар', 'пл', 'площа', 'майдан', 'шосе', 'узвіз', 'проїзд'}


def is_street(name: str) -> bool:
    return bool(set(re.sub(r"[^\w']+", ' ', name.lower()).split()) & STREET)
# Schools were renamed (школа № 29 is now ліцей № 29): with their number, one word.
SCHOOL = {'школа', 'ліцей', 'гімназія', 'коледж', 'колегіум', 'зош', 'нвк'}


def words(name: str) -> set[str]:
    t = re.sub(r"[^\w']+", ' ', name.lower().replace('ʼ', "'").replace('’', "'"))
    # An apostrophe inside a word (П'ятничани) belongs to it; around one, it is a quote ('Урожай').
    ws = {w.strip("'") for w in t.split()}
    return {'школа' if w in SCHOOL else w for w in ws if (len(w) > 1 or w.isdigit()) and w not in GENERIC}


def same_stop(a: str, b: str) -> bool:
    """Two names of one stop: every word of the shorter name in the longer one, and a name of one
    word only in a name of the same kind, two streets or two places that are not ("Обласна лікарня"
    is "Вінницька обласна клінічна лікарня ім. М. Пирогова", "Вул. Заболотного" is "вул. Академіка
    Заболотного"; "Ринок «Вишенька»" is not "Вул. Вишенька", "9-й мікрорайон" not "Мікрорайон
    Академічний"). A street's former name in brackets may be left out ("вул.
    Дьогтянецька (Лізи Чайкіної)" is "Вул. Дьогтянецька"). Words are compared on their first six
    letters (Пирогова, Пирогов; not Хутори, Хуторянка)."""
    for x in (a, re.sub(r'\([^)]*\)', ' ', a)):
        for y in (b, re.sub(r'\([^)]*\)', ' ', b)):
            wx, wy = words(x) - REQUEST_WORDS, words(y) - REQUEST_WORDS
            if not wx or not wy:
                continue
            if len(wx) > len(wy):
                wx, wy = wy, wx
            shared = sum(1 for w in wx if any(w[:6] == v[:6] for v in wy))
            if shared == len(wx) and (shared >= 2 or len(wy) == 1 or is_street(x) == is_street(y)):
                return True
    return False


# "На вимогу" (on request) says how a stop works, not where it is.
REQUEST_WORDS = {'на', 'вимогу'}


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


def project(line: list[tuple[float, float]], cum: list[float], p: tuple[float, float], after: float) -> tuple[float, float]:
    """Where p falls along the line, not before `after` (stops come in order), and how far p is from
    it (metres). Where the line passes p twice (a loop, out and back on one street), the first pass
    that comes as close as the nearest one (within 30 m) is taken: the next stops are after it."""
    hits: list[tuple[float, float]] = []
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
        along = max(after, cum[i] + t * (cum[i + 1] - cum[i]))
        hits.append((along, math.hypot(px - (ax + t * dx), py - (ay + t * dy))))
    if not hits:
        return after, float('inf')
    nearest = min(d for _, d in hits)
    return min((h for h in hits if h[1] <= nearest + 30), key=lambda h: h[0])


# ------------------------------------------------------------------------------------------------
# Where the stops are: OSM's named stops near the city, and its villages for the stops it lacks
# ------------------------------------------------------------------------------------------------

# Around the city, as far as the suburban lines go (south, west, north, east).
AROUND = (48.85, 27.90, 49.80, 29.30)
VILLAGES = {'city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood', 'quarter', 'isolated_dwelling'}


@dataclass
class Spot:
    id: str                     # n123, w45 (an OSM stop), p67 (a village's centre)
    name: str
    pos: tuple[float, float]
    tram: bool = False
    village: bool = False


class Spots(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.stops: list[Spot] = []
        self.places: list[Spot] = []

    def node(self, n):
        t = n.tags
        name = t.get('name:uk') or t.get('name')
        if not name:
            return
        p = (n.location.lat, n.location.lon)
        if not (AROUND[0] <= p[0] <= AROUND[2] and AROUND[1] <= p[1] <= AROUND[3]):
            return
        if t.get('highway') == 'bus_stop' or t.get('public_transport') in ('platform', 'stop_position') or t.get('railway') in ('tram_stop', 'platform') or t.get('amenity') == 'bus_station':
            self.stops.append(Spot(f'n{n.id}', name, p, t.get('railway') == 'tram_stop' or t.get('tram') == 'yes'))
        elif t.get('place') in VILLAGES:
            self.places.append(Spot(f'p{n.id}', name, p, village=True))


def by_word(spots: list[Spot]) -> dict[str, list[Spot]]:
    idx: dict[str, list[Spot]] = defaultdict(list)
    for sp in spots:
        for w in words(sp.name):
            idx[w[:5]].append(sp)
    return idx


def route_distance(line: list[tuple[float, float]]):
    """How far a point is from a line (metres, from its nearest vertex after cutting the line into
    pieces of 25 m at most), quickly: the vertices are kept in a grid of about 220 m."""
    pts: list[tuple[float, float]] = []
    for a, b in zip(line, line[1:]):
        n = max(1, int(metres(a, b) // 25))
        pts.extend((a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) for k in range(n))
    pts.extend(line[-1:])
    grid: dict[tuple[int, int], list[tuple[float, float]]] = defaultdict(list)
    for p in pts:
        grid[(int(p[0] / 0.002), int(p[1] / 0.003))].append(p)

    def distance(p: tuple[float, float]) -> float:
        gy, gx = int(p[0] / 0.002), int(p[1] / 0.003)
        near = [q for dy in (-1, 0, 1) for dx in (-1, 0, 1) for q in grid.get((gy + dy, gx + dx), ())]
        return min((metres(p, q) for q in near), default=1000.0)
    return distance


# The farthest a vehicle goes in a minute between two stops (48 km/h; the timetables give whole
# minutes, so a minute more is allowed for the rounding).
HOP_M = 800
# Leaving a stop unplaced costs as much as a detour of this many metres.
SKIP_M = 2500.0


def locate(stops: list[tuple[int, int, str]], tram: bool, route: OsmRoute | None, spots: dict, places: dict) -> list[Spot | None]:
    """Where each stop of a timetable is: among OSM's stops of the same name, the ones that make the
    shortest way from stop to stop, each hop no longer than the minutes between them allow (HOP_M),
    those on the line's own OSM route preferred. A stop OSM does not have stays unplaced; one named
    after a village it does not have a stop in is put at the village's centre."""
    on_route = {sid for sid, _, _ in route.pts} if route else set()
    near = route_distance(route.line) if route else None
    steps: list[tuple[int, int, list[tuple[Spot, float]]]] = []
    for i, (_, off, name) in enumerate(stops):
        found: dict[str, tuple[Spot, float]] = {}
        for w in words(name):
            for sp in spots.get(w[:5], ()):
                if sp.id not in found and same_stop(name, sp.name):
                    found[sp.id] = (sp, 1.0)
        if not found:
            for w in words(name):
                for sp in places.get(w[:5], ()):
                    if same_stop(name, sp.name):
                        found[sp.id] = (sp, 1.0)
        # A stop of the line's OSM route costs nothing; another one, its distance from the route.
        cands = [(sp, (min(near(sp.pos), 1000) if route and sp.id not in on_route else 0) + (400 if tram and not sp.tram else 0) + (300 if sp.village else 0))
                 for sp, _ in found.values()]
        if cands:
            steps.append((i, off, cands))
    if not steps:
        return [None] * len(stops)
    # The cheapest chain of candidates, a hop reaching back over at most WINDOW steps.
    WINDOW = 4
    best: list[list[tuple[float, tuple[int, int] | None]]] = []
    for j, (i, off, cands) in enumerate(steps):
        row = []
        for sp, nc in cands:
            b_cost, b_back = SKIP_M * j + nc, None
            for k in range(max(0, j - WINDOW), j):
                ki, koff, kc = steps[k]
                gap = SKIP_M * (j - k - 1)
                lim = (off - koff + 1) * HOP_M + 300
                for c2, (sp2, _) in enumerate(kc):
                    base = best[k][c2][0] + gap + nc
                    if base >= b_cost:
                        continue
                    d = metres(sp2.pos, sp.pos)
                    hop = d if d <= lim else d + 1e6
                    # Two stops of different names a few steps apart: one of them is wrong.
                    if d < 80 and stops[ki][2] != stops[i][2]:
                        hop += SKIP_M
                    if base + hop < b_cost:
                        b_cost, b_back = base + hop, (k, c2)
            row.append((b_cost, b_back))
        best.append(row)
    end, end_cost = None, float('inf')
    for j in range(len(steps)):
        for c, (cost, _) in enumerate(best[j]):
            if cost + SKIP_M * (len(steps) - 1 - j) < end_cost:
                end, end_cost = (j, c), cost + SKIP_M * (len(steps) - 1 - j)
    placed: list[Spot | None] = [None] * len(stops)
    while end:
        j, c = end
        placed[steps[j][0]] = steps[j][2][c][0]
        end = best[j][c][1]
    # A stop far off the way from the one before to the one after (a detour of more than 800 m,
    # longer than the way itself): another stop of that name, the stop stays unplaced.
    changed = True
    while changed:
        changed = False
        idx = [i for i, sp in enumerate(placed) if sp]
        for a, b, c in zip(idx, idx[1:], idx[2:]):
            pa, pb, pc = placed[a].pos, placed[b].pos, placed[c].pos
            direct = metres(pa, pc)
            if metres(pa, pb) + metres(pb, pc) - direct > max(800, direct):
                placed[b] = None
                changed = True
                break
    # A hop that is still too long (no other way): its far end stays unplaced.
    last = None
    for i, sp in enumerate(placed):
        if sp is None:
            continue
        if last is not None and metres(placed[last].pos, sp.pos) > (stops[i][1] - stops[last][1] + 1) * HOP_M + 300:
            placed[i] = None
            continue
        last = i
    return placed


# ------------------------------------------------------------------------------------------------
# OpenStreetMap's routes, ready to use: stops in order, shape, ends
# ------------------------------------------------------------------------------------------------

@dataclass
class OsmRoute:
    id: int
    mode: str                   # OSM's: tram, trolleybus, bus, share_taxi, minibus
    ref: str
    tags: dict
    master: dict
    pts: list                   # [(stop id "n123", name, (lat, lon))]
    line: list
    cum: list
    frm: str
    to: str
    first_name: str
    last_name: str


def osm_routes(path: str) -> list[OsmRoute]:
    rel = Relations()
    rel.apply_file(path)
    way_ids = {ref for r in rel.routes.values() for t, ref, role in r.members if t == 'w'}
    stop_nodes = {ref for r in rel.routes.values() for t, ref, role in r.members if t == 'n'}
    ways = Ways(way_ids)
    ways.apply_file(path)
    node_ids = set(stop_nodes)
    for ns in ways.nodes.values():
        node_ids.update(ns)
    nodes = Nodes(node_ids, stop_nodes | {ns[0] for ns in ways.nodes.values() if ns})
    nodes.apply_file(path)

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
    out = []
    for r in sorted(rel.routes.values(), key=lambda r: (r.tags.get('route'), norm_ref(r.tags.get('ref', '')), r.id)):
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
        pts = [(f'{t}{x}', name_of(t, x), centre(t, x)) for t, x in seq]
        pts = [x for x in pts if x[2]]
        if len(pts) < 2 or not any(in_city(p) for _, _, p in pts):
            continue
        line = chain([way_line(ref_) for t, ref_, role in r.members if t == 'w' and not role.startswith('platform')])
        if len(line) < 2:
            line = [p for _, _, p in pts]
        cum = [0.0]
        for a, b in zip(line, line[1:]):
            cum.append(cum[-1] + metres(a, b))
        first_name = next((n for _, n, _ in pts if n), r.tags.get('from', ''))
        last_name = next((n for _, n, _ in reversed(pts) if n), r.tags.get('to', ''))
        out.append(OsmRoute(r.id, r.tags['route'], norm_ref(r.tags.get('ref', '')), r.tags, rel.masters.get(rel.master_of.get(r.id, -1), {}),
                            pts, line, cum, r.tags.get('from') or first_name, r.tags.get('to') or last_name, first_name, last_name))
    return out


def ends_of(name: str) -> list[str]:
    return [x.strip() for x in re.split(r'\s+[-–—]\s+', name) if x.strip()]


def route_for(d: rozklad.Direction, routes: list[OsmRoute]) -> OsmRoute | None:
    """OSM's route of a timetable's line and direction: same mode and number, same ends, and the most
    of its stops."""
    ends = ends_of(d.name)
    first, last = d.stops[0][2], d.stops[-1][2]
    best, best_score = None, 0.0
    for r in routes:
        if MODES[r.mode] != d.mode or r.ref != norm_ref(d.ref):
            continue
        a = max(alike(first, r.first_name), alike(first, r.frm), alike(ends[0], r.frm) if len(ends) > 1 else 0)
        b = max(alike(last, r.last_name), alike(last, r.to), alike(ends[-1], r.to) if len(ends) > 1 else 0)
        names = [n for _, n, _ in r.pts]
        share = sum(1 for _, _, n in d.stops if any(alike(n, m) >= 0.99 for m in names)) / len(d.stops)
        if a + b + share > best_score:
            best, best_score = r, a + b + share
    return best if best_score >= 1.5 else None


# ------------------------------------------------------------------------------------------------
# GTFS
# ------------------------------------------------------------------------------------------------

def minutes_of(t: str) -> float:
    h, m, s_ = (int(x) for x in t.split(':'))
    return h * 60 + m + s_ / 60


def hms(m: float) -> str:
    s = int(round(m * 60))
    return f'{s // 3600:02d}:{s % 3600 // 60:02d}:{s % 60:02d}'


OSM_MODE = {'tram': 'tram', 'trol': 'trolleybus', 'avt': 'bus'}
# The stops where a vehicle halts only when asked (rozklad: "на вимогу"): tell the driver.
ON_REQUEST = re.compile(r'на вимогу', re.I)
# How far a stop may lie from its line's OSM route for the route to be its shape.
SHAPE_M = 150
# The share taxis (маршрутні таксі: a number of one or two digits and a letter, 1А, 19Б) stop
# anywhere on their way: flagged down, and asked to stop. GTFS says so with continuous stopping
# (continuous_pickup 0: board anywhere; continuous_drop_off 3: tell the driver), along the trip's
# shape: a trip without one keeps its stops only.
SHARE_TAXI = re.compile(r'\d{1,2}[А-ЯІЇЄҐ]')


def flag_anywhere(mode: str, ref: str, shape_id: str) -> dict:
    if mode == 'avt' and shape_id and SHARE_TAXI.fullmatch(ref):
        return {'continuous_pickup': 0, 'continuous_drop_off': 3}
    return {'continuous_pickup': '', 'continuous_drop_off': ''}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--osm', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--cache', default=None, help="depo.vn.ua's pages")
    ap.add_argument('--rozklad', default=None, help="vn.rozklad.in.ua's pages (default: next to --cache)")
    ap.add_argument('--start', default=None, help='first day (YYYYMMDD; default: when the timetables start)')
    ap.add_argument('--end', default='20271231')
    args = ap.parse_args()

    runs = depo_runs(args.cache)
    rz_cache = args.rozklad or os.path.join(os.path.dirname(os.path.abspath(args.cache)) if args.cache else '.', 'rozklad')
    dirs = rozklad.directions(rz_cache)
    print(f'depo.vn.ua: {len(runs)} runs (line, direction, day type); vn.rozklad.in.ua: {len(dirs)} line directions', file=sys.stderr)
    start = args.start or max((d.valid_from for d in dirs if d.valid_from), default='20261101')

    routes = osm_routes(args.osm)
    found = Spots()
    found.apply_file(args.osm)
    # The routes' own stops (some are platforms drawn as ways) count too, and so do tram stops.
    known = {sp.id: sp for sp in found.stops}
    for r in routes:
        for sid, name, p in r.pts:
            if name and AROUND[0] <= p[0] <= AROUND[2] and AROUND[1] <= p[1] <= AROUND[3]:
                sp = known.setdefault(sid, Spot(sid, name, p))
                sp.tram = sp.tram or r.mode == 'tram'
    spots, places = by_word(list(known.values())), by_word(found.places)

    stops: dict[str, dict] = {}
    routes_out: dict[str, dict] = {}
    trips, stop_times, freqs, shapes = [], [], [], []
    shaped: set[str] = set()
    report = {'lines': {}, 'rozklad': [], 'matched': [], 'unmatched_osm': [], 'unmatched_depo': []}
    depo_vtk = {(r.mode, r.ref) for r in runs if not r.taxi}
    timetabled = {(d.mode, norm_ref(d.ref)) for d in dirs}
    built_rz, built_depo = set(), set()

    def add_route(route_id, mode, ref, osm, long_name, agency):
        if route_id in routes_out:
            return
        colour = ((osm.tags.get('colour') or osm.master.get('colour') or '') if osm else '').lstrip('#')
        routes_out[route_id] = {
            'route_id': route_id,
            'agency_id': agency,
            'route_short_name': ref,
            'route_long_name': long_name,
            'route_type': ROUTE_TYPE[mode],
            'route_color': colour.upper() if re.fullmatch(r'[0-9A-Fa-f]{6}', colour) else COLOURS[mode],
            'route_text_color': 'FFFFFF',
        }

    def add_shape(r: OsmRoute):
        sid = f'r{r.id}'
        if sid not in shaped:
            shaped.add(sid)
            for i, p in enumerate(r.line):
                shapes.append({'shape_id': sid, 'shape_pt_lat': f'{p[0]:.6f}', 'shape_pt_lon': f'{p[1]:.6f}', 'shape_pt_sequence': i, 'shape_dist_traveled': f'{r.cum[i]:.1f}'})
        return sid

    def add_stop(sid, name, p):
        if sid not in stops:
            stops[sid] = {'stop_id': sid, 'stop_name': name, 'stop_lat': f'{p[0]:.6f}', 'stop_lon': f'{p[1]:.6f}'}

    # 1. The lines rozklad has: every departure, the minutes between stops as posted at the stops.
    for d in dirs:
        mode = OSM_MODE[d.mode]
        ref = norm_ref(d.ref)
        osm = route_for(d, routes)
        placed = locate(d.stops, d.mode == 'tram', osm, spots, places)
        kept = [(i, sp) for i, sp in enumerate(placed) if sp]
        entry = {'line': f'{mode} {d.ref}', 'name': d.name, 'rozklad': f'{rozklad.BASE}/home/schedule/{d.id}',
                 'osm_route': f'r{osm.id}' if osm else None, 'stops': len(d.stops), 'placed': len(kept),
                 'unplaced': [n for (_, _, n), sp in zip(d.stops, placed) if not sp],
                 'at_village_centre': [n for (_, _, n), sp in zip(d.stops, placed) if sp and sp.village]}
        report['rozklad'].append(entry)
        if len(kept) < 2:
            entry['skipped'] = 'fewer than two stops placed'
            continue
        # The OSM route is the shape when every stop lies along it.
        shape_id, along = '', []
        if osm and len(osm.line) > 2:
            pos, far = 0.0, []
            for i, sp in kept:
                a, dist = project(osm.line, osm.cum, sp.pos, pos)
                along.append(a)
                if dist > SHAPE_M:
                    far.append(i)
                else:
                    pos = a
            if not far:
                shape_id = add_shape(osm)
            elif len(far) <= max(1, len(kept) // 10):
                # One stop in ten at most off the line's route: OSM's stop of that name the line
                # uses is not mapped (another one was found): the stop stays unplaced.
                entry['off_route'] = [d.stops[i][2] for i in far]
                drop = set(far)
                along = [a for (i, _), a in zip(kept, along) if i not in drop]
                kept = [(i, sp) for i, sp in kept if i not in drop]
                shape_id = add_shape(osm)
            else:
                entry['shape'] = f'not used: {len(far)} stops more than {SHAPE_M} m from it'
        route_id = f"{'bus' if d.mode == 'avt' else mode}-{ref}"
        built_rz.add((d.mode, ref))
        agency = 'vtk' if d.mode != 'avt' or (d.mode, ref) in depo_vtk else 'carriers'
        add_route(route_id, osm.mode if osm else mode, d.ref, osm, ' — '.join(ends_of(d.name)) or d.name, agency)
        ends = ends_of(d.name)
        headsign = ends[-1] if len(ends) > 1 else d.stops[-1][2]
        for i, sp in kept:
            add_stop(sp.id, d.stops[i][2] if sp.village else sp.name, sp.pos)
        anywhere = flag_anywhere(d.mode, ref, shape_id)
        if SHARE_TAXI.fullmatch(ref) and d.mode == 'avt':
            entry['flag_anywhere'] = bool(shape_id)
        for service, deps in (('WD', d.working), ('WE', d.weekend)):
            seen: Counter = Counter()
            for dep in deps:
                hhmm = f'{dep.minute // 60:02d}{dep.minute % 60:02d}'
                seen[hhmm] += 1
                trip_id = f'rz{d.id}-{service}-{hhmm}' + (f'-{seen[hhmm]}' if seen[hhmm] > 1 else '')
                trips.append({'route_id': route_id, 'service_id': service, 'trip_id': trip_id,
                              # Where a run to the depot leaves the line is not published.
                              'trip_headsign': headsign + (' (у депо)' if dep.depot else ''),
                              'shape_id': shape_id,
                              # Low-floor runs are marked for trams and trolleybuses only.
                              'wheelchair_accessible': 1 if dep.low_floor else (2 if d.mode != 'avt' else 0)})
                for k, (i, sp) in enumerate(kept):
                    t = hms(dep.minute + d.stops[i][1])
                    request = 3 if ON_REQUEST.search(d.stops[i][2]) else ''
                    stop_times.append({'trip_id': trip_id, 'arrival_time': t, 'departure_time': t, 'stop_id': sp.id, 'stop_sequence': k,
                                       'pickup_type': request, 'drop_off_type': request, **anywhere,
                                       'shape_dist_traveled': f'{along[k]:.1f}' if shape_id else ''})

    # 2. The other lines (the share taxis): OSM's route, depo.vn.ua's first and last departures and
    #    intervals, the time between stops from the distance at the mode's commercial speed.
    used_runs = set()
    for r in routes:
        if (MODES[r.mode], r.ref) in timetabled:
            continue
        cands = [i for i, run in enumerate(runs) if run.mode == MODES[r.mode] and run.ref == r.ref]

        def score(run):
            return max(alike(r.frm, run.stops[0]), alike(r.first_name, run.stops[0])) + max(alike(r.to, run.stops[-1]), alike(r.last_name, run.stops[-1]))
        by_service = {}
        for service in SERVICES:
            opts = sorted(((score(runs[i]), i) for i in cands if runs[i].service == service), reverse=True)
            if opts and opts[0][0] >= 0.5:
                by_service[service] = opts[0][1]
        label = f"{r.mode} {r.tags.get('ref', '?')} {r.frm} → {r.to} (r{r.id})"
        if not by_service:
            report['unmatched_osm'].append(label)
            continue
        report['matched'].append(f"{label} ⇐ " + '; '.join(f"{s}: {' - '.join(runs[i].stops)} {runs[i].first // 60:02d}:{runs[i].first % 60:02d}-{runs[i].last // 60:02d}:{runs[i].last % 60:02d} /{runs[i].interval}'" for s, i in by_service.items()))
        used_runs.update(by_service.values())
        route_id = f"{'bus' if MODES[r.mode] == 'avt' else r.mode}-{r.ref}"
        built_depo.add((MODES[r.mode], r.ref))
        add_route(route_id, r.mode, r.tags.get('ref', r.ref), r, r.master.get('name:uk') or r.master.get('name') or f'{r.frm} — {r.to}',
                  'vtk' if MODES[r.mode] != 'avt' or (MODES[r.mode], r.ref) in depo_vtk else 'carriers')
        shape_id = add_shape(r)
        along, pos = [], 0.0
        for _, _, p in r.pts:
            a = project(r.line, r.cum, p, pos)[0] if len(r.line) > 2 else pos
            along.append(a)
            pos = a
        speed = SPEED_KMH[r.mode] * 1000 / 60  # metres a minute
        # The time to each stop: the distance along the route, never less than the straight line
        # with a detour of a fifth (where a stop falls off a gap in the route's ways).
        elapsed = [0.0]
        for k in range(1, len(r.pts)):
            hop = max(along[k] - along[k - 1], metres(r.pts[k - 1][2], r.pts[k][2]) * 1.2)
            elapsed.append(elapsed[-1] + hop / speed)
        for sid, name, p in r.pts:
            add_stop(sid, name or r.frm, p)
        for service, i in by_service.items():
            run = runs[i]
            trip_id = f'{shape_id}-{service}'
            base = {'route_id': route_id, 'service_id': service, 'trip_id': trip_id, 'trip_headsign': run.stops[-1], 'shape_id': shape_id, 'wheelchair_accessible': 0}
            block = [{'trip_id': trip_id, 'arrival_time': hms(off), 'departure_time': hms(off), 'stop_id': sid, 'stop_sequence': k,
                      'pickup_type': '', 'drop_off_type': '', **flag_anywhere(MODES[r.mode], r.ref, shape_id), 'shape_dist_traveled': f'{a:.1f}'}
                     for k, ((sid, _, _), a, off) in enumerate(zip(r.pts, along, elapsed))]
            if run.times:
                # Every departure listed: the trip's times shifted to each (exact times).
                for dep in run.times:
                    tid = f'{trip_id}-{dep // 60:02d}{dep % 60:02d}'
                    trips.append({**base, 'trip_id': tid})
                    for st in block:
                        off = hms(dep + minutes_of(st['arrival_time']))
                        stop_times.append({**st, 'trip_id': tid, 'arrival_time': off, 'departure_time': off})
            else:
                # Departures every `interval` minutes from the first to the last one (included).
                trips.append(base)
                stop_times.extend(block)
                freqs.append({'trip_id': trip_id, 'start_time': hms(run.first), 'end_time': hms(run.last + 1), 'headway_secs': run.interval * 60, 'exact_times': 0})
    report['unmatched_depo'] = [f"{r.mode} {r.ref} {' - '.join(r.stops)} ({r.service})" for i, r in enumerate(runs) if i not in used_runs and (r.mode, r.ref) not in timetabled]

    # The lines each source knows, and where each line of the GTFS comes from.
    lines: dict[tuple[str, str], set[str]] = defaultdict(set)
    for d in dirs:
        lines[(d.mode, norm_ref(d.ref))].add('rozklad')
    for run in runs:
        lines[(run.mode, run.ref)].add('depo')
    for r in routes:
        lines[(MODES[r.mode], r.ref)].add('osm')
    order = {'tram': 0, 'trol': 1, 'avt': 2}
    for (mode, ref), srcs in sorted(lines.items(), key=lambda x: (order[x[0][0]], len(x[0][1]), x[0][1])):
        how = 'rozklad' if (mode, ref) in built_rz else ('depo + osm' if (mode, ref) in built_depo else 'not in the GTFS')
        report['lines'][f'{mode} {ref}'] = {'sources': sorted(srcs), 'gtfs': how}

    files = {
        'agency.txt': [
            {'agency_id': 'vtk', 'agency_name': 'КП «Вінницька транспортна компанія»', 'agency_url': 'https://depo.vn.ua/', 'agency_timezone': 'Europe/Kyiv', 'agency_lang': 'uk'},
            {'agency_id': 'carriers', 'agency_name': 'Перевізники за договором (маршрутні таксі, приміські автобуси)', 'agency_url': rozklad.BASE + '/', 'agency_timezone': 'Europe/Kyiv', 'agency_lang': 'uk'},
        ],
        'stops.txt': list(stops.values()),
        'routes.txt': list(routes_out.values()),
        'trips.txt': trips,
        'stop_times.txt': stop_times,
        'frequencies.txt': freqs,
        'shapes.txt': shapes,
        'calendar.txt': [
            {'service_id': 'ALL', 'monday': 1, 'tuesday': 1, 'wednesday': 1, 'thursday': 1, 'friday': 1, 'saturday': 1, 'sunday': 1, 'start_date': start, 'end_date': args.end},
            {'service_id': 'WD', 'monday': 1, 'tuesday': 1, 'wednesday': 1, 'thursday': 1, 'friday': 1, 'saturday': 0, 'sunday': 0, 'start_date': start, 'end_date': args.end},
            {'service_id': 'WE', 'monday': 0, 'tuesday': 0, 'wednesday': 0, 'thursday': 0, 'friday': 0, 'saturday': 1, 'sunday': 1, 'start_date': start, 'end_date': args.end},
        ],
        'feed_info.txt': [{'feed_publisher_name': 'Trajestaurant (generated from vn.rozklad.in.ua, OpenStreetMap and depo.vn.ua)', 'feed_publisher_url': 'https://www.openstreetmap.org/copyright', 'feed_lang': 'uk', 'feed_start_date': start, 'feed_end_date': args.end, 'feed_version': start}],
        'attributions.txt': [
            {'attribution_id': 'rozklad', 'organization_name': 'vn.rozklad.in.ua: departures and minutes between stops (trams, trolleybuses, buses)', 'is_data_source': 1, 'attribution_url': rozklad.BASE + '/'},
            {'attribution_id': 'osm', 'organization_name': 'OpenStreetMap contributors (ODbL): stops, routes, shapes', 'is_data_source': 1, 'attribution_url': 'https://www.openstreetmap.org/copyright'},
            {'attribution_id': 'depo-taxi', 'organization_name': 'depo.vn.ua (КП «Вінницька транспортна компанія»): share taxis (маршрутні таксі), first and last departures, intervals', 'is_data_source': 1, 'attribution_url': DEPO_TAXI},
        ],
    }
    with zipfile.ZipFile(args.out, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, rows in files.items():
            if not rows:
                continue
            fields = list(dict.fromkeys(k for row in rows for k in row))
            buf = io.StringIO()
            w = csv.DictWriter(buf, fieldnames=fields, restval='', lineterminator='\n')
            w.writeheader()
            w.writerows(rows)
            z.writestr(name, buf.getvalue())
    with open(os.path.splitext(args.out)[0] + '-report.json', 'w', encoding='utf-8') as h:
        json.dump(report, h, ensure_ascii=False, indent=1)
    placed = sum(e['placed'] for e in report['rozklad'])
    total = sum(e['stops'] for e in report['rozklad'])
    with_shape = sum(1 for e in report['rozklad'] if e['osm_route'] and 'shape' not in e and 'skipped' not in e)
    print(f"{len(routes_out)} lines, {len(trips)} trips, {len(stops)} stops. rozklad: {len(dirs)} directions, stops placed {placed}/{total}, "
          f"{with_shape} with OSM's route as shape; depo + OSM: matched {len(report['matched'])} OSM routes, unmatched {len(report['unmatched_osm'])}, "
          f"depo runs not used {len(report['unmatched_depo'])}", file=sys.stderr)


if __name__ == '__main__':
    main()
