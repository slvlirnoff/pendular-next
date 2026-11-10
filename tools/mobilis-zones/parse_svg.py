"""Parse Mobilis plan SVG: zone polygons + stop markers. usage: parse_svg.py plan-page.html out.json"""
import sys, re, json
from svgelements import SVG, Path, Polygon, Rect, Circle, Matrix
from shapely.geometry import Polygon as SP
from shapely.ops import unary_union

def extract_svg(html):
    i = html.find('id="svg-map"'); s = html.rfind('<svg', 0, i); e = html.find('</svg>', i) + 6
    return html[s:e]

def to_pts(el):
    """flatten any element to list of (x,y) with transforms applied (svgelements applies el.transform)"""
    if isinstance(el, Rect):
        p = Path(el)
    else:
        p = Path(el)
    p = abs(p)
    pts = []
    for seg in p:
        n = 1 if seg.__class__.__name__ in ('Move','Line','Close') else 12
        if seg.__class__.__name__ == 'Move':
            pts.append((seg.end.x, seg.end.y)); continue
        for k in range(1, n + 1):
            q = seg.point(k / n) if n > 1 else seg.end
            pts.append((q.x, q.y))
    return pts

def main(html_path, out):
    html = open(html_path, encoding='utf8').read()
    svg_txt = extract_svg(html)
    svg = SVG.parse(__import__('io').StringIO(svg_txt), reify=True)
    zones = {}; markers = []
    for el in svg.elements():
        cls = (el.values.get('class') or '') if hasattr(el, 'values') else ''
        eid = (el.values.get('id') or '') if hasattr(el, 'values') else ''
        if eid.startswith('region_'):
            pts = to_pts(el)
            poly = SP(pts)
            if not poly.is_valid: poly = poly.buffer(0)
            zones[eid[7:]] = dict(type=type(el).__name__, area=poly.area, pts=[list(map(lambda v: round(v, 3), p)) for p in pts])
        elif cls in ('HaltBahn', 'HaltBus'):
            pts = to_pts(el)
            xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
            markers.append(dict(kind='rail' if cls == 'HaltBahn' else 'bus', x=round((min(xs)+max(xs))/2, 3), y=round((min(ys)+max(ys))/2, 3),
                                w=round(max(xs)-min(xs), 2), h=round(max(ys)-min(ys), 2), el=type(el).__name__))
    # group id of each marker (document order): HaltBus paths inside <g id="text"> are legend pictograms, not stops
    groups = [(m.start(), m.group(1)) for m in re.finditer(r'<g id="(\w+)">', svg_txt)]
    occ = [m.start() for m in re.finditer(r'class="(?:HaltBahn|HaltBus)"', svg_txt)]
    assert len(occ) == len(markers), (len(occ), len(markers))
    for pos, mk in zip(occ, markers):
        mk['grp'] = [n for s, n in groups if s < pos][-1]
    json.dump(dict(zones=zones, markers=markers), open(out, 'w'))
    print(len(zones), 'zones', len(markers), 'markers')

main(sys.argv[1], sys.argv[2])
