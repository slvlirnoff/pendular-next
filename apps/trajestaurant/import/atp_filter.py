"""Keeps the Swiss places of one All The Places spider file (GeoJSON on stdin, one feature per line).

Writes one feature per line. A place is Swiss when its address says CH; a place without a country
is kept when it lies inside the Swiss bounding box (the import drops what is far from any Swiss town).
"""
import json
import sys

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
    if country == 'CH' or (not country and 5.95 <= lon <= 10.5 and 45.81 <= lat <= 47.81):
        sys.stdout.write(json.dumps({'id': f.get('id'), 'geometry': g, 'properties': p}, ensure_ascii=False) + '\n')
