"""vn.rozklad.in.ua: Vinnytsia's timetables, line by line and direction by direction.

For each line and direction the site shows the stops in order with the minutes from the first one
(1', 4', …), and every departure from the first stop on working days and on weekends. A departure
can be marked:

  - in bold ("depot"): the vehicle goes to the depot after it (it ends its day on the way);
  - underlined: a low-floor vehicle;
  - with a letter or a star: a short trip, to the stop the legend names ("С – до "Майдан Небесної
    Сотні"", "Д – короткий рейс" without a stop).

    python3 rozklad.py <cache dir>     # prints the lines it read

The pages are kept in the cache directory: delete it to read the current timetables again.
"""
from __future__ import annotations

import html
import json
import os
import re
import sys
import time
import urllib.request
from dataclasses import dataclass, field

BASE = 'https://vn.rozklad.in.ua'
MODE = {'tram': 'tram', 'trolleybus': 'trol', 'bus': 'avt'}


@dataclass
class Departure:
    minute: int                 # minutes after midnight (after 24:00 past midnight)
    depot: bool = False         # goes to the depot after this trip
    low_floor: bool = False
    note: str | None = None     # the legend's letter (С, Н, В, Д, М, *): a short trip


@dataclass
class Direction:
    id: int
    mode: str                   # tram, trol, avt
    ref: str
    name: str                   # "Залізничний вокзал - Електромережа"
    stops: list[tuple[int, int, str]]   # (station id, minutes from the first stop, name)
    working: list[Departure]
    weekend: list[Departure]
    notes: dict[str, str] = field(default_factory=dict)  # letter → what the legend says
    reverse: int | None = None
    valid_from: str | None = None       # YYYYMMDD


def _get(url: str, cache: str) -> str:
    path = os.path.join(cache, re.sub(r'[^A-Za-z0-9.]+', '_', url))
    if os.path.exists(path):
        return open(path, encoding='utf-8').read()
    req = urllib.request.Request(url, headers={'User-Agent': 'trajestaurant-gtfs-builder (non-commercial)'})
    for attempt in range(4):
        try:
            text = urllib.request.urlopen(req, timeout=60).read().decode('utf-8', 'replace')
            break
        except OSError:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)
    os.makedirs(cache, exist_ok=True)
    open(path, 'w', encoding='utf-8').write(text)
    time.sleep(0.5)  # one page at a time, gently
    return text


def _text(s: str) -> str:
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s))).strip()


def _table(block: str) -> list[Departure]:
    deps: list[Departure] = []
    prev = -1
    for row in re.findall(r'<tr>(.*?)</tr>', block, flags=re.S):
        cells = re.findall(r'<td([^>]*)>(.*?)</td>', row, flags=re.S)
        if not cells:
            continue
        hour = _text(cells[0][1])
        if not hour.isdigit():
            continue
        for attrs, inner in cells[1:]:
            m = re.search(r'(\d{1,2})', _text(re.sub(r'<(sup|span)[^>]*>.*?</\1>', '', inner, flags=re.S)))
            if not m:
                continue
            minute = int(hour) * 60 + int(m.group(1))
            # Past midnight, the hours start again from 0: keep the day going (24:xx, 25:xx).
            while minute < prev - 6 * 60:
                minute += 24 * 60
            prev = minute
            note = re.search(r'<(sup|span)[^>]*>\s*([^<\s]+)\s*</\1>', inner)
            deps.append(Departure(minute, 'depot' in attrs, 'underline-class' in inner, note.group(2) if note else None))
    return deps


def direction(page: str, id_: int, mode: str) -> Direction:
    page = re.sub(r'<svg.*?</svg>', '', page, flags=re.S)
    # The text is written as character references (&#x412;…): read it as letters.
    page = re.sub(r'&#x([0-9A-Fa-f]+);', lambda m: chr(int(m.group(1), 16)), page)
    ref = _text(re.search(r'<div class="number">(.*?)</div>', page, re.S).group(1))
    name = _text(re.search(r'<h1 class="name-route">(.*?)</h1>', page, re.S).group(1))
    stops = []
    route = re.search(r'<div class="chosen-route active">(.*?)</ul>', page, re.S).group(1)
    for sid, inner in re.findall(r'GetSchedule\(\d+,\s*(\d+)\)[^>]*>(.*?)</li>', route, flags=re.S):
        off = re.search(r'<span>\s*(\d*)', inner).group(1)
        stops.append((int(sid), int(off) if off else 0, _text(re.search(r'<p>(.*?)</p>', inner, re.S).group(1))))
    tables = re.findall(r'<div class="column (?:working-days|weekend)[^"]*">\s*(?:<div class="title">[^<]*</div>)?\s*<table>(.*?)</table>', page, flags=re.S)
    # The page holds each table twice (the mobile and the wide layout): the last two are the wide ones.
    working, weekend = (_table(tables[-2]), _table(tables[-1])) if len(tables) >= 2 else ([], [])
    notes = {}
    for letter, what in re.findall(r'<li class="[a-z]+ other-note"[^>]*><span>00(?:<sup>|<span class="note">)\s*([^<\s]+)\s*</(?:sup|span)></span>\s*[–-]\s*([^<]+)</li>', page):
        notes[letter] = html.unescape(what).strip()
    rev = re.search(r'js-sort-route"[^>]*GetSchedule\((\d+),\s*null\)', page)
    valid = re.search(r'Розклад діє з (\d{2})\.(\d{2})\.(\d{4})', page)
    return Direction(id_, mode, ref, name, stops, working, weekend, notes, int(rev.group(1)) if rev else None,
                     f'{valid.group(3)}{valid.group(2)}{valid.group(1)}' if valid else None)


def directions(cache: str) -> list[Direction]:
    """Every line in both directions."""
    home = _get(BASE + '/', cache)
    todo: list[tuple[int, str]] = []
    for mode, block in re.findall(r'<div class="route js-route js-(\w+)">(.*?)</ul>', home, flags=re.S):
        for id_ in re.findall(r'href="/home/schedule/(\d+)"', block):
            todo.append((int(id_), MODE[mode]))
    out: list[Direction] = []
    seen: set[int] = set()
    while todo:
        id_, mode = todo.pop(0)
        if id_ in seen:
            continue
        seen.add(id_)
        d = direction(_get(f'{BASE}/home/schedule/{id_}', cache), id_, mode)
        out.append(d)
        if d.reverse and d.reverse not in seen:
            todo.append((d.reverse, mode))
    return out


if __name__ == '__main__':
    for d in directions(sys.argv[1]):
        print(json.dumps({'id': d.id, 'mode': d.mode, 'ref': d.ref, 'name': d.name, 'stops': len(d.stops),
                          'minutes': d.stops[-1][1] if d.stops else None, 'working': len(d.working), 'weekend': len(d.weekend),
                          'depot': sum(x.depot for x in d.working + d.weekend), 'low': sum(x.low_floor for x in d.working + d.weekend),
                          'notes': {k: sum(x.note == k for x in d.working + d.weekend) for k in d.notes} or None,
                          'legend': d.notes or None, 'reverse': d.reverse, 'from': d.valid_from}, ensure_ascii=False))
