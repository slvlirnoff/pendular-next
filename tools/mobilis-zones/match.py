"""Match PDF labels of markers to GTFS stations. usage: match.py markers.json gtfs.zip stop_modes.json out/matched.json"""
import sys, json, zipfile, io, csv, re, unicodedata, collections, math
import numpy as np
from rapidfuzz import process, fuzz

LAT = (46.15, 47.0); LON = (6.0, 7.3)

def norm(s):
    s = unicodedata.normalize('NFKC', s)   # ligatures (U+FB02 -> fl)
    s = unicodedata.normalize('NFKD', s); s = ''.join(c for c in s if not unicodedata.combining(c)).lower()
    s = s.replace('’', "'").replace('‘', "'").replace('œ', 'oe')
    s = re.sub(r"[-–—,/.'()]+", ' ', s)
    toks = [{'saint': 'st', 'sainte': 'ste'}.get(t, t) for t in s.split()]
    return ' '.join(toks)

CANT = {'vd', 'fr', 'ne', 'be', 'ge', 'vs', 'ju'}
def town_keys(town):
    k = {norm(town)}
    k.add(norm(re.sub(r'\([^)]*\)', ' ', town)))
    for x in list(k):
        t = x.split()
        if len(t) > 1 and t[-1] in CANT: k.add(' '.join(t[:-1]))
    return {x for x in k if x}

PREF = ['gare', 'village', 'centre', 'poste', 'eglise', 'temple', 'college', 'place', 'ecole']
def pref_rank(name):
    n = norm(name)
    for i, p in enumerate(PREF):
        if re.search(r'\b' + p + r'\b', n): return i
    return len(PREF)

def railish(types):
    return any((len(t) == 3 and t[0] == '1') or t[0] == '4' or t == '1400' for t in types)

def main(markers_p, gtfs_p, modes_p, out):
    D = json.load(open(markers_p)); M = D['markers']; L = D['labels']
    modes = json.load(open(modes_p)) if modes_p != '-' else {}
    z = zipfile.ZipFile(gtfs_p)
    st = []
    for s in csv.DictReader(io.TextIOWrapper(z.open('stops.txt'), 'utf-8-sig')):
        if s['location_type'] != '1': continue
        lat, lon = float(s['stop_lat']), float(s['stop_lon'])
        if not (LAT[0] <= lat <= LAT[1] and LON[0] <= lon <= LON[1]): continue
        name = s['stop_name']; town = name.split(', ')[0] if ', ' in name else name
        mt = modes.get(s['stop_id'], {})
        st.append(dict(stopId=s['didok'], gtfsId=s['stop_id'], name=name, lat=lat, lon=lon, nn=norm(name), nt=norm(town), rail=railish(mt), served=bool(mt)))
    print('stations in bbox', len(st), 'served', sum(s['served'] for s in st), 'rail', sum(s['rail'] for s in st))
    by_full = collections.defaultdict(list); by_town = collections.defaultdict(list); by_raw = collections.defaultdict(list); by_part = collections.defaultdict(list); by_full2 = collections.defaultdict(list)
    for s in st:
        by_full[s['nn']].append(s); by_raw[s['name']].append(s)
        town = s['name'].split(', ')[0]
        for k in town_keys(town): by_town[k].append(s)
        if ', ' not in s['name']:
            for k in town_keys(s['name']): by_full2[k].append(s)
        if ', ' in s['name']: by_part[norm(s['name'].split(', ', 1)[1])].append(s)
    names = [s['nn'] for s in st]
    def cand(s, match, score): return dict(stopId=s['stopId'], gtfsId=s['gtfsId'], name=s['name'], lat=s['lat'], lon=s['lon'], match=match, score=round(score, 3), rail=s['rail'], served=s['served'])
    def lookup(text, kind):
        """returns list of candidate dicts for one text variant"""
        res = []
        if text in by_raw: res = [cand(s, 'exact', 1.0) for s in by_raw[text]]
        if not res:
            n = norm(text)
            if n in by_full: res = [cand(s, 'normalised', 0.97) for s in by_full[n]]
            if not res and n in by_full2: res = [cand(s, 'normalised', 0.95) for s in by_full2[n]]   # differs only by canton tag / parenthesis, e.g. Renens -> 'Renens VD'
            if not res and n in by_town:
                ss = sorted(by_town[n], key=lambda s: (not (s['rail'] if kind == 'rail' else True), ', ' in s['name'], pref_rank(s['name']), len(s['name'])))
                if kind == 'rail' and any(s['rail'] for s in ss): ss = [s for s in ss if s['rail']]
                res = [dict(cand(s, 'locality', 0.75 if len(ss) == 1 else 0.6), via='town') for s in ss[:10]]
            if not res and n in by_part:
                ss = sorted(by_part[n], key=lambda s: (not (s['rail'] if kind == 'rail' else True), len(s['name'])))
                res = [dict(cand(s, 'locality', 0.7 if len(ss) == 1 else 0.55), via='stop-part') for s in ss[:10]]
            if not res:
                hits = process.extract(n, names, scorer=fuzz.ratio, limit=5, score_cutoff=86)
                if hits:
                    top = hits[0][1]
                    res = [cand(st[i], 'fuzzy', sc / 100) for _, sc, i in hits if sc >= top - 1.5]
        if kind == 'rail':
            r = [c for c in res if c['rail']]
            if r: res = r
        else:
            # bus marker: prefer stations that are actually served
            r = [c for c in res if c['served']]
            if r and modes: res = r
        return res
    out_m = []
    for m in M:
        o = dict(m)
        if 'label' in m:
            l = L[m['label']]
            variants = [(l['text'], 1.0)]
            if l.get('canton'): variants.insert(0, (l['text'] + ' ' + l['canton'], 1.0))
            if len(l['lines']) > 1: variants += [(t, 0.9) for t in l['lines'] if len(t) > 3]
            rank = {'exact': 4, 'normalised': 3, 'locality': 2, 'fuzzy': 1}
            best = []; bs = -1
            for t, f in variants:
                r = lookup(t, m['kind'])
                if not r: continue
                s = rank[r[0]['match']] * f
                if s > bs: best, bs = r, s; used = t
            # dedupe
            seen = set(); cands = []
            for c in best:
                if c['stopId'] in seen: continue
                seen.add(c['stopId']); cands.append(c)
            o['cands'] = cands; o['label_used'] = used if best else None
        out_m.append(o)
    json.dump(dict(markers=out_m, labels=L, stations=len(st), border_hist=D['border_hist']), open(out, 'w'))
    c = collections.Counter((m['cands'][0]['match'] if m.get('cands') else ('nomatch' if 'label' in m else 'nolabel')) for m in out_m)
    print(c)

main(*sys.argv[1:5])
