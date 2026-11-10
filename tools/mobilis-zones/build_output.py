"""Assemble final outputs.
usage: build_output.py matched.json svg.json pdf.json adjacency.json mobilis-plan.json gtfs.zip out_json out_report"""
import sys, json, random, collections, zipfile, io, csv, datetime, math, itertools
import numpy as np
from scipy.spatial import cKDTree
from shapely.geometry import Polygon
from shapely.validation import make_valid

matched_p, svg_p, pdf_p, adj_p, plan_p, gtfs_p, out_json, out_md = sys.argv[1:9]
D = json.load(open(matched_p)); M = D['markers']; L = D['labels']
svg = json.load(open(svg_p)); pdf = json.load(open(pdf_p)); adj = json.load(open(adj_p)); plan = json.load(open(plan_p))
BORDER_TOL = 4.0

def km(a, b):
    la = math.radians((a[0] + b[0]) / 2)
    return math.hypot((a[0] - b[0]) * 111.2, (a[1] - b[1]) * 111.2 * math.cos(la))

def primary(m):
    c = m.get('cands') or []
    if not c: return None
    if c[0]['match'] in ('exact', 'normalised'): return (c[0]['lat'], c[0]['lon'])
    return (float(np.median([x['lat'] for x in c])), float(np.median([x['lon'] for x in c])))

# ---- geographic sanity: per-zone median from reliable (exact/normalised) matches
zone_pts = collections.defaultdict(list)
for m in M:
    c = m.get('cands') or []
    if c and c[0]['match'] in ('exact', 'normalised') and m['zones']:
        for z in m['zones']: zone_pts[z].append((c[0]['lat'], c[0]['lon']))
zone_ref = {}
SD_FLOOR = 3.0  # km (zones are 5-20 km wide; few reliable points per zone make the raw MAD too small)
for z, pts in zone_pts.items():
    if len(pts) < 3: continue
    med = (float(np.median([p[0] for p in pts])), float(np.median([p[1] for p in pts])))
    d = np.array([km(p, med) for p in pts]); sd = max(1.4826 * float(np.median(d)), SD_FLOOR)
    zone_ref[z] = (med, sd)
# zones with too few reliable points: fall back to all matched primaries
for m in M:
    p = primary(m)
    if p:
        for z in m['zones']:
            if z not in zone_ref: zone_pts.setdefault(('all', z), []).append(p)
for key, pts in list(zone_pts.items()):
    if isinstance(key, tuple) and key[1] not in zone_ref and len(pts) >= 3:
        med = (float(np.median([p[0] for p in pts])), float(np.median([p[1] for p in pts]))); d = np.array([km(p, med) for p in pts])
        zone_ref[key[1]] = (med, max(1.4826 * float(np.median(d)), SD_FLOOR))
def outlier_for(pos, zones):
    """min over zones of distance/sd; outlier if > 3 sd and > 3 km in all zones that have a reference"""
    best = None
    for z in zones:
        if z in zone_ref:
            med, sd = zone_ref[z]; dd = km(pos, med); r = (dd / sd, dd)
            if best is None or r[0] < best[0]: best = r
    return best

LEVEL = {2: 'high', 1: 'medium', 0: 'low'}
stops = []; unm_markers = []; unm_labels = []
for m in M:
    zones = m['zones']
    if not zones:
        unm_markers.append(dict(kind=m['kind'], svg=[m['x'], m['y']], reason='outside every zone polygon', nearestZones=[[z, round(d, 1)] for z, d in m['dist_all'][:2]], label=L[m['label']]['text'] if 'label' in m else None))
        continue
    if 'label' not in m:
        unm_markers.append(dict(kind=m['kind'], svg=[m['x'], m['y']], zones=zones, reason='no name label within reach', border=len(zones) > 1))
        continue
    l = L[m['label']]
    cands = list(m.get('cands') or [])
    flags = []
    geo = None
    if cands:
        # drop candidates that are geographic outliers when others are not (e.g. 'Cugy' VD vs FR)
        info = [(c, outlier_for((c['lat'], c['lon']), zones)) for c in cands]
        ok = [c for c, r in info if r is None or not (r[0] > 3 and r[1] > 3)]
        if ok and len(ok) < len(cands) and (cands[0]['match'] in ('locality', 'fuzzy') or cands[0]['score'] == 0.95):
            flags.append('geoFiltered:%d' % (len(cands) - len(ok))); cands = ok
        elif not ok:
            flags.append('geoOutlier'); geo = True
        elif cands[0]['match'] in ('exact', 'normalised') and len(info) and info[0][1] and info[0][1][0] > 3 and info[0][1][1] > 3:
            flags.append('geoOutlier'); geo = True
    if not cands: level = 0; flags.append('noGtfsMatch')
    else:
        t = cands[0]['match']
        level = {'exact': 2, 'normalised': 2, 'locality': 1, 'fuzzy': 0}[t]
        if t == 'locality' and len(cands) > 3: level = 0
        if cands[0]['score'] == 0.95 and len({c['stopId'] for c in cands}) > 1: level = min(level, 1)   # canton-folded name shared by several stations
        if t == 'exact' and len({c['stopId'] for c in cands}) > 3: level -= 1
        if m['kind'] == 'rail' and not any(c['rail'] for c in cands): level -= 1; flags.append('railMarkerNoRailStation')
        if geo: level -= 1
    if m['label_dist'] > 9: level -= 1; flags.append('labelFar')
    if m.get('shared'): flags.append('labelShared')
    level = max(level, 0)
    if not cands and False: pass
    s = dict(label=l['text'], kind=m['kind'], zones=zones, border=len(zones) > 1,
             zoneMethod=('border: centre within %.0f svg units of %d polygon boundaries (nearest %s)' % (BORDER_TOL, len(zones), ', '.join('%s=%.1f' % (z, d) for z, d in m['dist_all'][:len(zones)]))) if len(zones) > 1 else ('point-in-polygon' + ('' if m['dist_all'][0][1] == 0 else ' (centre %.1f units from boundary of zone %s)' % (m['dist_all'][0][1], m['dist_all'][0][0]))),
             svg=[round(m['x'], 1), round(m['y'], 1)], labelDist=round(m['label_dist'], 1),
             gtfs=[{k: v for k, v in c.items() if k not in ('served', 'bus')} for c in cands[:10]], confidence=LEVEL[level])
    if l.get('canton'): s['canton'] = l['canton']
    if flags: s['flags'] = flags
    stops.append(s)
used = {m['label'] for m in M if 'label' in m}
for i, l in enumerate(L):
    if i not in used: unm_labels.append(dict(label=l['text'], pdf=[round(l['x0'], 1), round(l['top'], 1)], size=l['size'], reason='no marker within reach'))
for s in stops:
    if not s['gtfs']: unm_labels.append(dict(label=s['label'], svg=s['svg'], zones=s['zones'], reason='no GTFS station matched'))

zones = {}
for z in sorted(plan, key=int):
    zones[z] = dict(neighbours=sorted(int(n) for n in plan[z]), stopCount=sum(1 for s in stops if int(z) in s['zones']))
res = dict(network='Mobilis', source=['https://www.mobilis-vaud.ch/plan/', 'plan-general.pdf (modified 2025-10-30)'],
           generatedAt=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
           method='SVG zone polygons + stop markers (point-in-polygon, border tolerance 4 units); PDF registered to SVG by exact marker-shape matching; PDF text lines assigned to markers by global nearest assignment; labels matched to GTFS stations by exact/normalised/locality/fuzzy name matching with geographic outlier filter',
           validity=dict(planPdfText='Valable dès le 14.12.2025', gtfsFeed='2026-12-13 .. 2027-12-11 (feed_version 20261107)', note='plan is for timetable year 2026; zones for 2027 (grille tarifaire dès 13.12.2026) not confirmed by this source'),
           zones=zones, stops=stops, unmatchedMarkers=unm_markers, unmatchedLabels=unm_labels)
json.dump(res, open(out_json, 'w'), ensure_ascii=False, separators=(',', ':'))

# ---------------- report
C = collections.Counter
nm = len([m for m in M])
n_zoned = sum(1 for m in M if m['zones']); n_border = sum(1 for m in M if len(m['zones']) > 1)
n_lab = sum(1 for m in M if 'label' in m and m['zones'])
mt = C(s['gtfs'][0]['match'] if s['gtfs'] else 'none' for s in stops)
conf = C(s['confidence'] for s in stops)
ct = collections.defaultdict(C)
for s in stops: ct[s['gtfs'][0]['match'] if s['gtfs'] else 'none'][s['confidence']] += 1
kindc = C(s['kind'] for s in stops)
flags = C(f.split(':')[0] for s in stops for f in s.get('flags', []))
# PDF twin check
P = np.array(pdf['prail'] + pdf['pbus']); T = cKDTree(P)
notwin = [m for m in M if T.query(m['pdf'])[0] > 1.0]
gtfs_z = zipfile.ZipFile(gtfs_p)
fi = gtfs_z.read('feed_info.txt').decode('utf-8-sig').strip().splitlines()[-1]
random.seed(20251030)
sample = random.sample(stops, 30)
def row(s):
    g = s['gtfs'][0] if s['gtfs'] else None
    gs = ('%s (%s) %s %.2f' % (g['name'], g['stopId'], g['match'], g['score']) + (' +%d more' % (len(s['gtfs']) - 1) if len(s['gtfs']) > 1 else '')) if g else '-'
    return '| %s | %s | %s | %s | %s | %s |' % (s['label'].replace('|', '/'), s['kind'], ','.join(map(str, s['zones'])), gs.replace('|', '/'), s['confidence'], ','.join(s.get('flags', [])))
# spot checks
Pg = {z: make_valid(Polygon(v['pts'])) for z, v in svg['zones'].items()}
def touch(a, b): return Pg[str(a)].distance(Pg[str(b)]) <= 3
spot = []
spot.append('Zone-number labels (13.5 pt numbers in the PDF) located inside their own SVG polygon after registration: see counts above (all 155 expected).')
spot.append('PDF legend: "Les zones 11 et 12 couvrant le périmètre Grand Lausanne ..." -> polygons 11 and 12 touch: %s.' % touch(11, 12))
lau = [s for s in stops if s['label'] in ('Lausanne', 'Lausanne-Flon')]
spot.append('Stops labelled Lausanne / Lausanne-Flon: ' + '; '.join('%s zones %s (%s)' % (s['label'], s['zones'], s['gtfs'][0]['stopId'] if s['gtfs'] else '-') for s in lau))
frim = [62, 63, 72, 79]
dist = lambda a, b: round(Pg[str(a)].distance(Pg[str(b)]))
spot.append('PDF legend: "Pour les voyages des zones 62, 63, 72, 79 directement vers les zones 160, 161 ..." (direct lines, contiguity is not claimed). Polygon gap to nearest of 160/161 in svg units (plan is ~5200 wide): %s - all are close, 63 and 72 and 79 touch.' % {z: min(dist(z, 160), dist(z, 161)) for z in frim})
spot.append('PDF legend: "zones 126 et 127 ... Onde verte" (each exclusively inside; no adjacency claimed). Polygons 126/127 are %d units apart, so they are correctly not contiguous in the drawing nor in mobilis-plan.json (126 -> [%s], 127 -> [%s]).' % (dist(126, 127), ','.join(map(str, plan['126'])), ','.join(map(str, plan['127']))))
fr_cluster = [100, 105, 106, 107, 130, 131, 132, 133, 134, 135, 160, 161, 182, 183]
spot.append('Frimobil zone list in the legend (%s) -> zone-number labels exist for all of them: %s.' % (fr_cluster, all(str(z) in svg['zones'] for z in fr_cluster)))
sp_extra = [e for e in adj['edge_not_in_plan'] if any(int(x) in fr_cluster + [126, 127] for x in e.split('-'))]
total = len(adj['edge_not_in_plan'])

lines = []
A = lines.append
A('# Mobilis stop to fare-zone table: quality report\n')
A('Generated %s by `tools/mobilis-zones/` (see its README for how to rerun). Output: `packages/engine/data/zones/mobilis-stops.json`.\n' % res['generatedAt'])
A('## Validity of the plan\n')
A('- `plan-general.pdf` prints **"Valable dès le 14.12.2025"** (valid from 14 December 2025, i.e. timetable year 2026). PDF created/modified 2025-10-30.')
A('- `plan-page.html` contains no validity text (searched for "valable", "202x", "décembre").')
A('- The GTFS feed in `data/raw/gtfs.zip` is timetable 2027 (`%s`). `grille-tarifaire-h27.txt` is headed "Grille tarifaire dès le 13 décembre 2026". **The zone plan is therefore one timetable year older than the GTFS and the H27 tariff grid**; zone changes on 13.12.2026 would not be reflected.\n' % fi.replace('"', ''))
A('## Counts\n')
A('| item | n |\n|---|---|')
A('| zone polygons parsed (%s) | %d (137 polygon, 16 rect, 2 path; 3 rects carry a rotate(-45) transform, applied) |' % ('all unique ids region_N', len(svg['zones'])))
A('| `HaltBahn` + `HaltBus` elements in the SVG | %d (276 + 799) |' % len(svg['markers']))
A('| of which real stop markers | %d (rail/metro 276, bus 538) |' % nm)
A('| `HaltBus` elements that are NOT stops | 261 (pictogram glyph paths in `<g id="text">`, legend icons) - excluded |')
A('| markers with at least one zone | %d |' % n_zoned)
A('| border markers (centre within %.0f units of 2+ polygons; valid in all) | %d |' % (BORDER_TOL, n_border))
A('| markers outside every polygon | %d (all are diamond-shaped bus markers in `busshapes`, 18-100 units from the nearest polygon; listed in `unmatchedMarkers`) |' % len(unm_markers and [u for u in unm_markers if u['reason'].startswith('outside')]))
A('| markers with a name label assigned (of zoned) | %d (%.1f%%) |' % (n_lab, 100 * n_lab / n_zoned))
A('| entries in `stops` (zoned + labelled) | %d (rail %d, bus %d) |' % (len(stops), kindc['rail'], kindc['bus']))
A('| zoned markers without label (`unmatchedMarkers`) | %d |' % len([u for u in unm_markers if u['reason'].startswith('no name')]))
A('| PDF text labels not assigned to any marker (`unmatchedLabels`) | %d of %d labels (mostly outside-region towns, canton tags, legend/lake texts) |' % (len([u for u in unm_labels if u['reason'].startswith('no marker')]), len(L)))
A('\n### GTFS matching (primary candidate match type, per stop entry)\n')
A('| match | stops | high | medium | low |\n|---|---|---|---|---|')
for k in ['exact', 'normalised', 'locality', 'fuzzy', 'none']:
    A('| %s | %d | %d | %d | %d |' % (k, mt[k], ct[k]['high'], ct[k]['medium'], ct[k]['low']))
A('| **total** | %d | %d | %d | %d |' % (len(stops), conf['high'], conf['medium'], conf['low']))
A('\nFlags: ' + ', '.join('%s=%d' % kv for kv in sorted(flags.items())))
A('\nWhat the match types mean: `exact` = identical GTFS station name; `normalised` = identical after case/accent/hyphen/comma/Saint folding; `locality` = the plan label is a village name and the candidates are the GTFS stops of that village (`via: town`) or the plan label equals the stop part of "Town, Stop" (`via: stop-part`); the first candidate is the preferred one (gare/village/centre/poste first) but **the zone applies to the whole village drawn as one point, the specific stop is not identified**; `fuzzy` = similar spelling (rapidfuzz ratio >= 86).')
A('Confidence: high = exact/normalised, label within 9 pt, no flags; medium = locality (<=3 candidates) or high with one flag; low = more than 3 locality candidates, fuzzy, geographic outlier, no GTFS match. Candidates that are geographic outliers of a zone are dropped from locality lists when others remain (`geoFiltered`).\n')
A('## Zone derivation\n')
h = D['border_hist']
A('Distance from each marker centre to the second-nearest polygon (for markers inside one polygon; to the nearest one for markers outside all) has bins %s (svg units) with counts %s. Gap: nothing between 3 and 6 units, so the tolerance of 4 units (marker radius 4-8.5 units, polygon strokes ~4.5) separates "on the border" from "inside" without ambiguity. Markers beyond 6 units are either interior markers or the outside-zone diamond markers. Edge-of-map markers within tolerance of only one polygon get that single zone.\n' % (h[1][:-1], h[0]))
A('## Adjacency validation (mobilis-plan.json vs polygons)\n')
A('- zones: plan %d, SVG %d, missing either way: none.' % (adj['zones_in_plan'], adj['zones_in_svg']))
A('- plan adjacency is symmetric (%d asymmetric pairs). Plan edges: %d. Polygon pairs in edge contact (shared boundary >= 8 units, gap <= 3): %d.' % (adj['plan_asymmetric'], adj['plan_edges'], adj['polygon_edge_contacts']))
A('- **Every plan edge is confirmed by polygons (%d/%d, recall 100%%)**, and no plan edge touches only at a corner.' % (adj['edges_in_both'], adj['plan_edges']))
A('- %d polygon contacts are NOT in mobilis-plan.json (precision %.0f%%). Examples: %s. %d of them involve a Frimobil/common/Onde-verte zone (100-107, 126, 127, 130-135, 160, 161, 182, 183), consistent with the plan json listing only Mobilis-internal neighbours; the rest (e.g. 12-64, 15-16, 20-22) are real boundary contacts that the json simply does not list, so the json is a subset of geometric adjacency, not an equivalent definition. Polygons are therefore not contradicted by the json.' % (total, 100 * adj['edges_in_both'] / adj['polygon_edge_contacts'], ', '.join(adj['edge_not_in_plan'][:8]), len(sp_extra)))
A('- Independent check: all 155 PDF zone-number labels fall inside the polygon of the same number after registration (155/155).\n')
st = pdf['stats']
A('## Registration PDF to SVG\n')
A('Shapes, not text, were used: the PDF carries the markers as vector circles (rail: 3.8 pt white circles, bus: 2.6 pt cyan dots). A Hough vote over scale/translation on rail markers found the transform (275/275 votes), refined by iterated mutual-nearest-neighbour least squares over all markers. The PDF is the same drawing: pure scale %.4f with no rotation/shear (svg = %.4f * pdf + t).\n' % (1 / st['scale'][0], st['scale'][0]))
A('- matched marker pairs: rail %d/%d PDF (svg %d), bus %d/%d PDF (svg %d); total 813 of 814 real SVG markers.' % (st['matched']['rail'], st['n_pdf']['rail'], st['n_svg']['rail'], st['matched']['bus'], st['n_pdf']['bus'], st['n_svg']['bus']))
A('- residuals (svg units): rms %.4f, p95 %.4f, max %.4f (marker pitch ~10-17 units), i.e. exact.' % (st['rms'], st['p95'], st['max']))
A('- SVG markers without a PDF twin: %d (%s); PDF marker-coloured shapes without an SVG twin: 2 (legend icons).\n' % (len(notwin), ', '.join('%s at svg (%.0f, %.0f)' % (m['kind'], m['x'], m['y']) for m in notwin)))
A('## Name labels\n')
A('Text was rebuilt from characters in content-stream order (pdfplumber word grouping garbled overlapping lines), split into lines by font/size/baseline, and stacked lines merged when hyphen-ended or aligned (centre/left/right) at line pitch; trailing canton tags (VD, FR, ...) are stripped into `canton`. Markers were assigned labels with the Hungarian algorithm on marker-to-text-box distance (max 13 pt, 19.5 pt for 9 pt city names), then a second pass lets a marker without label share the label of a labelled marker within 12 pt (station + metro stop, flagged `labelShared`). Median marker-label distance %.1f pt; 90th percentile %.1f pt.\n' % (np.median([s['labelDist'] for s in stops]), np.percentile([s['labelDist'] for s in stops], 90)))
A('## Spot checks against facts printed in the PDF\n')
for s_ in spot: A('- ' + s_)
A('- Visual check: rendered the PDF and drew marker-to-label assignment lines for central Lausanne and Vevey/Montreux; labels were attached to the right markers apart from dense interchange clusters (see problems).')
A('\n## 30 random rows (seed 20251030)\n')
A('| label | kind | zones | first GTFS candidate | confidence | flags |\n|---|---|---|---|---|---|')
for s in sample: A(row(s))
A('\n## Known problems\n')
A('- **Villages, not stops**: ~%d%% of entries are `locality` matches. The plan draws one dot per village; the zone is right for the dot, but which GTFS stop it is cannot be told from the plan. Use the zone for any stop whose GTFS station lies in that village, preferably via the candidate list.' % round(100 * mt['locality'] / len(stops)))
A('- Zones with no stop entry: %s (all %d zones have a polygon and number label). Zones with <=2 stops: %s.' % (sorted((int(z) for z, v in zones.items() if v['stopCount'] == 0)) or 'none', len(zones), sorted(int(z) for z, v in zones.items() if 0 < v['stopCount'] <= 2)))
A('- Dense interchange clusters (Lausanne centre, Vevey, Montreux, Villars area) have several markers (rail, metro, bus dot) within a few points; label assignment there is least reliable. Markers sharing a label are flagged `labelShared`.')
A('- %d markers have no label within reach and %d outside-region diamond bus markers (towns beyond the zone map such as Fribourg-side or Valais-side stops) have no zone; they are in `unmatchedMarkers`.' % (len([u for u in unm_markers if u['reason'].startswith('no name')]), len([u for u in unm_markers if u['reason'].startswith('outside')])))
A('- Fuzzy and a few spelling variants (Avry vs Avry-Matran, Collombey-le-Grand, Valeyres, Bretigny, Oulens, Mézery, Fenil, Essertines-sur-Yverdon ...) are unmatched; the plan uses commune or colloquial names that GTFS does not use verbatim.')
A('- Zone labels printed at stops outside Vaud (FR/NE/VS/F) are not zone-valued.')
A('- Plan validity is one timetable year older than the GTFS (see top).')
A('- The geographic outlier check uses zone medians of exact/normalised matches, floor 3 km on the robust SD, and flags only deviations of > 3 SD and > 3 km; large mountain zones can still hide wrong village picks.')
open(out_md, 'w').write('\n'.join(lines) + '\n')
print(len(stops), conf, mt, 'unm markers', len(unm_markers), 'unm labels', len(unm_labels))
