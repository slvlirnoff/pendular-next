"""Group PDF words into labels and assign them to markers.
usage: labels.py out/svg.json out/pdf.json out/markers.json
Writes markers.json with zones (point-in-polygon with border tolerance), PDF position, label."""
import sys, json, re, collections
import numpy as np
from shapely.geometry import Polygon, Point
from shapely.validation import make_valid
from scipy.optimize import linear_sum_assignment

BORDER_TOL = 4.0     # svg units; marker radius is 4-8.5, gap in distance histogram between 3 and 8
CANTON = {'VD', 'FR', 'NE', 'BE', 'GE', 'VS', 'JU', '(F)'}

def zone_polys(svg):
    return {z: make_valid(Polygon(v['pts'])) for z, v in svg['zones'].items()}

def assign_zones(svg, P):
    real = [m for m in svg['markers'] if m['grp'] != 'text']
    hist = []
    for m in real:
        pt = Point(m['x'], m['y'])
        ds = {z: p.distance(pt) for z, p in P.items()}
        m['dist_all'] = sorted(ds.items(), key=lambda kv: kv[1])[:4]
        m['zones'] = sorted(int(z) for z, dd in ds.items() if dd <= BORDER_TOL)
        # distance to the *second* nearest zone among markers in 1 zone: how clear the border call is
        hist.append(m['dist_all'][1][1] if m['dist_all'][0][1] == 0 else m['dist_all'][0][1])
    return real, np.histogram(hist, bins=[0, 0.5, 1, 2, 3, 4, 6, 8, 12, 20, 50, 1e9])

def make_lines(chars):
    """lines = runs of characters in content-stream order with the same font/size/baseline and contiguous x"""
    runs = []; cur = None
    for c in chars:
        if not c['upright']: continue
        if cur and cur['font'] == c['fontname'] and abs(cur['size'] - c['size']) < 0.15 and abs(cur['top'] - c['top']) < 0.5 and -1.5 < c['x0'] - cur['x1'] < 3.0:
            if c['text'] == ' ' or c['x0'] - cur['x1'] > 1.0: cur['text'] += ' '
            if c['text'] != ' ': cur['text'] += c['text']
            cur['x1'] = max(cur['x1'], c['x1']); cur['bottom'] = max(cur['bottom'], c['bottom'])
        else:
            if cur: runs.append(cur)
            cur = dict(font=c['fontname'], size=c['size'], top=c['top'], bottom=c['bottom'], x0=c['x0'], x1=c['x1'], text=c['text'] if c['text'] != ' ' else '', color=c['color'])
    if cur: runs.append(cur)
    lines = []
    for r in runs:
        r['text'] = re.sub(r'\s+', ' ', r['text']).strip()
        if r['text']: lines.append(r)
    return lines

def merge_lines(lines):
    """merge vertically stacked lines of the same font/size that belong to one label"""
    lines.sort(key=lambda L: (L['top'], L['x0']))
    out = []
    taken = [False] * len(lines)
    for i, A in enumerate(lines):
        if taken[i]: continue
        cur = [A]
        while True:
            last = cur[-1]; found = None
            lt = last['text']
            for j, B in enumerate(lines):
                if taken[j] or B is last or B in cur: continue
                hyph0 = last['text'].endswith('-')
                same_style = B['font'] == last['font'] and abs(B['size'] - last['size']) <= 0.15
                # a hyphenated big label may continue in a smaller size of the same weight (e.g. 9pt 'Yverdon-' / 6.8pt 'les-Bains')
                cont_style = hyph0 and ('Bold' in B['font'] or 'Black' in B['font']) == ('Bold' in last['font'] or 'Black' in last['font']) and 0.6 < B['size'] / last['size'] <= 1.0
                if not (same_style or cont_style): continue
                pitch = B['top'] - last['top']
                if not (0.8 * last['size'] <= pitch <= 1.3 * last['size'] or (cont_style and 0.7 * last['size'] <= pitch <= 1.5 * last['size'])): continue
                cdiff = abs((B['x0'] + B['x1']) / 2 - (last['x0'] + last['x1']) / 2)
                ldiff = abs(B['x0'] - last['x0']); rdiff = abs(B['x1'] - last['x1'])
                hyph = lt.endswith('-')
                aligned = cdiff < 1.2 or ldiff < 0.8 or rdiff < 0.8
                if (hyph and (cdiff < 8 or ldiff < 3)) or aligned:
                    if found is None or abs(pitch - last['size']) < abs(found[1] - last['size']): found = (j, pitch)
            if found is None: break
            taken[found[0]] = True; cur.append(lines[found[0]])
        out.append(cur)
    labels = []
    for grp in out:
        texts = [L['text'] for L in grp]
        txt = texts[0]
        for t in texts[1:]:
            txt = txt + t if txt.endswith('-') else txt + ' ' + t
        cant = None
        toks = txt.split(' ')
        while len(toks) > 1 and toks[-1] in CANTON:
            cant = toks.pop().strip('()'); 
        txt = ' '.join(toks)
        # a canton tag on its own line was merged above if aligned; also strip leading tags
        x0 = min(L['x0'] for L in grp); x1 = max(L['x1'] for L in grp)
        labels.append(dict(text=txt, canton=cant, lines=texts, font=grp[0]['font'], size=round(grp[0]['size'], 1), bold='Bold' in grp[0]['font'] or 'Black' in grp[0]['font'],
                           x0=x0, x1=x1, top=min(L['top'] for L in grp), bottom=max(L['bottom'] for L in grp)))
    return labels

def rect_dist(px, py, L):
    dx = max(L['x0'] - px, 0, px - L['x1']); dy = max(L['top'] - py, 0, py - L['bottom'])
    return float(np.hypot(dx, dy))

def main(svg_p, pdf_p, out):
    svg = json.load(open(svg_p)); pdf = json.load(open(pdf_p))
    P = zone_polys(svg)
    real, hist = assign_zones(svg, P)
    print('hist of distance to 2nd-nearest zone (or nearest if outside); bins 0,.5,1,2,3,4,6,8,12,20,50,inf', hist[0].tolist(), hist[1].tolist())
    M = np.array(pdf['M'])
    # PDF position of each svg marker: inverse affine
    A = M[:2].T; t = M[2]
    for m in real:
        m['pdf'] = (np.linalg.solve(A, np.array([m['x'], m['y']]) - t)).tolist()
    alllines = make_lines(pdf['chars'])
    numlines = [L for L in alllines if abs(L['size'] - 13.5) < 0.05 and L['text'].isdigit()]
    labels = [l for l in merge_lines([L for L in alllines if L['size'] < 15 and not L['text'].replace(' ', '').isdigit()]) if l['text'] not in CANTON and len(l['text']) > 1]
    # drop legend-ish labels: size >= 9 only if they could be marker labels (kept; assignment decides)
    print('labels', len(labels), 'markers', len(real))
    nm, nl = len(real), len(labels)
    MAXD = 13.0
    C = np.full((nm, nl), 1e6)
    for i, m in enumerate(real):
        px, py = m['pdf']
        for j, L in enumerate(labels):
            d = rect_dist(px, py, L)
            lim = MAXD * (1.5 if L['size'] >= 9 else 1.0)
            if d <= lim:
                cx = (L['x0'] + L['x1']) / 2; cy = (L['top'] + L['bottom']) / 2
                # rail markers are labelled in bold, bus dots almost always in regular weight (245/261 vs 35/513): soft kind penalty
                pen = (8.0 if L['size'] >= 9 else 3.5) if ((m['kind'] == 'rail') != L['bold'] and m['grp'] != 'metro') else 0.0
                C[i, j] = d + pen + 0.05 * np.hypot(px - cx, py - cy)
    r, c = linear_sum_assignment(C)
    for i, j in zip(r, c):
        if C[i, j] < 1e5:
            real[i]['label'] = int(j); real[i]['label_dist'] = rect_dist(*real[i]['pdf'], labels[j])
    # second pass: a marker without label that sits within 9 svg-independent pdf units (pt) of a labelled marker may share its label
    # (station + metro stop, rail + bus dot drawn at the same place)
    for i, m in enumerate(real):
        if 'label' in m: continue
        best = None
        for k, o in enumerate(real):
            if 'label' not in o or k == i or o.get('shared') or labels[o['label']]['size'] >= 9: continue
            dd = float(np.hypot(m['pdf'][0] - o['pdf'][0], m['pdf'][1] - o['pdf'][1]))
            if dd <= 12 and rect_dist(*m['pdf'], labels[o['label']]) <= 15 and (best is None or dd < best[0]): best = (dd, o['label'])
        if best:
            m['label'] = best[1]; m['label_dist'] = rect_dist(*m['pdf'], labels[best[1]]); m['shared'] = True
    # zone number labels (control): which polygon contains each number label?
    num = numlines
    seen = set(); nchk = []; 
    for w in num:
        key = (w['text'], round(w['x0']), round(w['top']))
        if key in seen: continue
        seen.add(key)
        cx = (w['x0'] + w['x1']) / 2; cy = (w['top'] + w['bottom']) / 2
        sx, sy = (M[:2].T @ np.array([cx, cy]) + M[2])
        inside = [z for z, p in P.items() if p.contains(Point(sx, sy))]
        nchk.append(dict(label=w['text'], inside=inside, ok=w['text'] in inside))
    json.dump(dict(markers=real, labels=labels, border_hist=[hist[0].tolist(), hist[1].tolist()], zone_number_check=nchk, zones={z: dict(area=v['area']) for z, v in svg['zones'].items()}), open(out, 'w'))
    asg = [m for m in real if 'label' in m]
    print('assigned', len(asg), 'of', len(real), 'rail', sum(1 for m in asg if m['kind'] == 'rail'), '/', sum(1 for m in real if m['kind'] == 'rail'))
    print('dist pct', np.percentile([m['label_dist'] for m in asg], [50, 90, 99, 100]).round(2))
    print('zone number labels', len(nchk), 'inside own polygon', sum(x['ok'] for x in nchk), [x for x in nchk if not x['ok']][:10])
    print('zones with a number label', len(set(x['label'] for x in nchk)))

main(*sys.argv[1:4])
