"""Validate polygon adjacency against mobilis-plan.json. usage: adjacency.py svg.json mobilis-plan.json out/adjacency.json"""
import sys, json, itertools
from shapely.geometry import Polygon
from shapely.validation import make_valid
svg = json.load(open(sys.argv[1])); plan = json.load(open(sys.argv[2]))
P = {z: make_valid(Polygon(v['pts'])) for z, v in svg['zones'].items()}
TOL = 3.0   # polygons are separated by a ~4.5 unit white stroke in places
shared = {}
for a, b in itertools.combinations(sorted(P, key=int), 2):
    if P[a].distance(P[b]) <= TOL:
        # length of the common boundary (buffered), to tell edge contact from corner contact
        L = P[a].boundary.buffer(TOL).intersection(P[b].boundary).length
        shared[(a, b)] = L
EDGE_MIN = 8.0
edge = {k for k, L in shared.items() if L >= EDGE_MIN}
corner = {k for k, L in shared.items() if L < EDGE_MIN}
ref = set()
for z, ns in plan.items():
    for n in ns: ref.add(tuple(sorted((z, str(n)), key=int)))
asym = [(z, n) for z, ns in plan.items() for n in ns if z not in [str(x) for x in plan.get(str(n), [])]]
res = dict(zones_in_plan=len(plan), zones_in_svg=len(P), missing_in_svg=sorted(set(plan) - set(P)), missing_in_plan=sorted(set(P) - set(plan)),
           plan_edges=len(ref), polygon_edge_contacts=len(edge), polygon_corner_contacts=len(corner),
           edges_in_both=len(edge & ref), edge_not_in_plan=sorted('-'.join(k) for k in edge - ref), plan_not_touching=sorted('-'.join(k) for k in ref - edge),
           plan_not_touching_but_corner=sorted('-'.join(k) for k in (ref - edge) & corner), plan_asymmetric=len(asym),
           min_edge_len=min(shared[k] for k in edge) if edge else None)
json.dump(res, open(sys.argv[3], 'w'), indent=1)
print(json.dumps(res, indent=1)[:3000])
