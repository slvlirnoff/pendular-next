"""Keeps the places of one country of one All The Places spider file (GeoJSON on stdin, one
feature per line): Switzerland, or TRAJ_COUNTRY (an ISO code) within TRAJ_BBOX.

Writes one feature per line. A place is in the country when its address says so (and, with
TRAJ_BBOX, lies in that box); a place without a country is kept when it lies inside the box (the
Swiss one by default; the import drops what is far from any town).
"""
import json
import os
import sys

COUNTRY = os.environ.get('TRAJ_COUNTRY', 'CH').upper()
BOX = os.environ.get('TRAJ_BBOX')  # lon_min,lat_min,lon_max,lat_max
X0, Y0, X1, Y1 = (float(v) for v in BOX.split(',')) if BOX else (5.95, 45.81, 10.5, 47.81)

for line in sys.stdin:
    line = line.strip().rstrip(',')
    if not line.startswith('{"type": "Feature"') and not line.startswith('{"type":"Feature"'):
        continue
    try:
        f = json.loads(line)
    except ValueError:
        continue
    p = f.get('properties') or {}
    g = f.get('geometry') or {}
    if g.get('type') != 'Point':
        continue
    country = (p.get('addr:country') or '').upper()
    lon, lat = g['coordinates'][:2]
    inside = X0 <= lon <= X1 and Y0 <= lat <= Y1
    if (country == COUNTRY and (inside or not BOX)) or (not country and inside):
        sys.stdout.write(json.dumps({'id': f.get('id'), 'geometry': g, 'properties': p}, ensure_ascii=False) + '\n')
