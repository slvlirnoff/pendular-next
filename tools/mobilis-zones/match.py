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
        st.append(dict(stopId=s['didok'], gtfsId=s['stop_id'], name=name, lat=lat, lon=lon, nn=norm(name), nt=norm(town), rail=railish(mt), bus=any(t[0] in '78' or t == '900' for t in mt), served=bool(mt)))
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
    abbr = []   # towns abbreviated by GTFS ('Cheseaux-sur-L.', 'Corcelles-sur-Chav.')
    for s in st:
        town = s['name'].split(', ')[0].split(',')[0]
        if town.endswith('.') and ' ' not in town.strip('.') or (town.endswith('.') and '-' in town):
            tk = norm(town).split()
            if len(tk) > 1: abbr.append((tk, s))
    def cand(s, match, score): return dict(stopId=s['stopId'], gtfsId=s['gtfsId'], name=s['name'], lat=s['lat'], lon=s['lon'], match=match, score=round(score, 3), rail=s['rail'], bus=s['bus'], served=s['served'])
    TIER = {'exact': 4, 'normalised': 3, 'locality': 2, 'fuzzy': 1}
    def okkind(c, kind):
        return c['rail'] if kind == 'rail' else (c['bus'] if c['served'] else False)
    def tiers(text, kind, excl):
        """candidate lists per tier, best tier first. Whole-name equality only for exact/normalised."""
        n = norm(text); out = []
        ok = lambda s: s['stopId'] not in excl
        r = [cand(s, 'exact', 1.0) for s in by_raw.get(text, []) if ok(s)]
        if r: out.append(r)
        r = [cand(s, 'normalised', 0.97) for s in by_full.get(n, []) if ok(s) and s['name'] != text]
        if r: out.append(r)
        # differs only by canton tag / parenthesis from the whole name, e.g. Renens -> 'Renens VD'
        r = [cand(s, 'normalised', 0.95) for s in by_full2.get(n, []) if ok(s) and s['nn'] != n]
        if r: out.append(r)
        # 'Locality, stop' names: label equals the locality part
        ss = [s for s in by_town.get(n, []) if ', ' in s['name'] and ok(s)]
        ss.sort(key=lambda s: (not (s['rail'] if kind == 'rail' else s['bus']), pref_rank(s['name']), len(s['name'])))
        if kind == 'rail' and any(s['rail'] for s in ss): ss = [s for s in ss if s['rail']]
        if ss: out.append([dict(cand(s, 'locality', 0.75 if len(ss) == 1 else 0.6), via='town') for s in ss[:10]])
        # label equals the stop part of 'Town, Stop'
        ss = [s for s in by_part.get(n, []) if ok(s)]
        ss.sort(key=lambda s: (not (s['rail'] if kind == 'rail' else s['bus']), len(s['name'])))
        if ss: out.append([dict(cand(s, 'locality', 0.7 if len(ss) == 1 else 0.55), via='stop-part') for s in ss[:10]])
        tk = n.split()
        ss = [s for t, s in abbr if len(t) == len(tk) and t[:-1] == tk[:-1] and tk[-1].startswith(t[-1]) and ok(s)]
        ss.sort(key=lambda s: (not (s['rail'] if kind == 'rail' else s['bus']), pref_rank(s['name']), len(s['name'])))
        if ss: out.append([dict(cand(s, 'locality', 0.7 if len(ss) == 1 else 0.55), via='town-abbrev') for s in ss[:10]])
        hits = [(sc, i) for _, sc, i in process.extract(n, names, scorer=fuzz.ratio, limit=5, score_cutoff=86) if ok(st[i])]
        if hits:
            top = hits[0][0]; out.append([cand(st[i], 'fuzzy', sc / 100) for sc, i in hits if sc >= top - 1.5])
        return out
    def lookup(text, kind, excl=frozenset()):
        ts = tiers(text, kind, excl)
        if not ts: return []
        # first tier that offers a station of the right kind (rail marker: railway station; bus marker: bus-served stop)
        for t in ts:
            if t[0]['match'] == 'fuzzy': break
            r = [c for c in t if okkind(c, kind)]
            if r: return r
        return ts[0]
    def variants_for(m):
        l = L[m['label']]
        v = [(l['text'], 1.0)]
        if l.get('canton'): v.insert(0, (l['text'] + ' ' + l['canton'], 1.0))
        return v
    def line_variants(m):
        """lines of a stacked label that are complete words (not hyphen-split), used only as weak locality hints"""
        l = L[m['label']]; ls = l['lines']; res = []
        if len(ls) > 1:
            for i, t in enumerate(ls):
                if len(t) <= 3 or t.endswith('-') or (i > 0 and ls[i - 1].endswith('-')) or t.endswith(','): continue
                res.append(t)
        return res
    def resolve(m, excl):
        best = []; used = None; bs = -1
        for t, f in variants_for(m):
            r = lookup(t, m['kind'], excl)
            if not r: continue
            sc = TIER[r[0]['match']] * f
            if sc > bs: best, bs, used = r, sc, t
        if not best:
            # weak fallback: whole lines of the label, never better than locality, never an exact/normalised claim
            for t in line_variants(m):
                ts = [x for x in tiers(t, m['kind'], excl)]
                ts = [[dict(c, match='locality', score=min(c['score'], 0.6), via='label-line') for c in x] for x in ts]
                for x in ts:
                    r = [c for c in x if okkind(c, m['kind'])] or x
                    if r: best, used = r[:10], t; break
                if best: break
        if m['kind'] == 'rail' and not any(c['rail'] for c in best):
            # 'Cheseaux-sur-Lausanne' is the plan's name for the railway station 'Cheseaux': first part of an X-sur-Y label
            t = L[m['label']]['text']; mm = re.match(r"^(.+?)[- ](?:sur|sous|près|en)[- ]", t)
            if mm:
                ss = [x for x in by_full.get(norm(mm.group(1)), []) if x['rail'] and x['stopId'] not in excl]
                if ss and (not best or best[0]['match'] in ('locality', 'fuzzy')): best, used = [dict(cand(x, 'locality', 0.6), via='label-prefix') for x in ss], t
        seen = set(); cands = []
        for c in best:
            if c['stopId'] in seen: continue
            seen.add(c['stopId']); cands.append(c)
        return cands, (used if best else None)
    out_m = []
    for m in M:
        o = dict(m)
        if 'label' in m: o['cands'], o['label_used'] = resolve(m, frozenset())
        out_m.append(o)
    # each station may be claimed by only one marker with a specific (exact/normalised) match
    def specific(o): return o.get('cands') and o['cands'][0]['match'] in ('exact', 'normalised')
    def strength(o):
        c = o['cands'][0]; l = L[o['label']]
        return (TIER[c['match']], c['score'], okkind(c, o['kind']), norm(l['text']) == norm(c['name']), -o['label_dist'])
    excl = collections.defaultdict(set); demoted = []
    for it in range(8):
        claims = collections.defaultdict(list)
        for i, o in enumerate(out_m):
            if specific(o):
                for c in o['cands']:
                    if c['match'] in ('exact', 'normalised'): claims[c['stopId']].append(i)
        conf = {sid: v for sid, v in claims.items() if len(v) > 1}
        if not conf: break
        for sid, v in conf.items():
            v.sort(key=lambda i: strength(out_m[i]), reverse=True)
            for i in v[1:]:
                excl[i].add(sid); demoted.append((i, sid))
        for i in {i for v in conf.values() for i in v[1:]}:
            o = out_m[i]; o['cands'], o['label_used'] = resolve(o, frozenset(excl[i]))
            # same-name duplicate: keep the station as a (weaker) locality candidate instead of losing it
            for sid in excl[i]:
                s_ = next(x for x in st if x['stopId'] == sid)
                if norm(L[o['label']]['text']) == s_['nn'] and not any(c['stopId'] == sid for c in o['cands']):
                    o['cands'] = o['cands'] + [dict(cand(s_, 'locality', 0.5), via='duplicate-marker')] if o['cands'] and o['cands'][0]['match'] in ('exact','normalised','locality') else [dict(cand(s_, 'locality', 0.5), via='duplicate-marker')] + o['cands']
    remaining = []
    claims = collections.defaultdict(list)
    for i, o in enumerate(out_m):
        if specific(o):
            for c in o['cands']:
                if c['match'] in ('exact', 'normalised'): claims[c['stopId']].append(i)
    for sid, v in claims.items():
        if len(v) > 1: remaining.append(dict(stopId=sid, labels=[L[out_m[i]['label']]['text'] for i in v]))
    conflicts = dict(demoted=[dict(stopId=sid, label=L[out_m[i]['label']]['text'], kind=out_m[i]['kind'], zones=out_m[i]['zones']) for i, sid in demoted], remaining=remaining)
    json.dump(dict(markers=out_m, labels=L, conflicts=conflicts, stations=len(st), border_hist=D['border_hist']), open(out, 'w'))
    c = collections.Counter((m['cands'][0]['match'] if m.get('cands') else ('nomatch' if 'label' in m else 'nolabel')) for m in out_m)
    print(c); print('demoted', len(demoted), 'remaining conflicts', len(remaining))

main(*sys.argv[1:5])
