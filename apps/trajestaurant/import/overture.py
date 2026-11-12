"""Overture Maps places in Switzerland, as JSON lines: food and drink (any confidence: the import
decides), and the shops and services Overture is confident about (0.8): every shop, and the other
categories of overture-categories.json (doctors, vets, garages, trades…).

Needs python3 with duckdb (pip install duckdb); reads the latest release straight from the public
S3 bucket (only the row groups inside the Swiss bounding box are fetched, about 10 seconds).

    python3 overture.py <out.jsonl>
"""
import json
import os
import re
import sys
import urllib.request

import duckdb

out = sys.argv[1]
here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, 'overture-categories.json')) as f:
    categories = sorted(json.load(f)['categories'])
listed = ', '.join("'" + c.replace("'", "''") + "'" for c in categories)
# Switzerland, unless TRAJ_COUNTRY (an ISO code) and TRAJ_BBOX (lon_min,lat_min,lon_max,lat_max)
# say otherwise: there, places without a country inside the box count too.
COUNTRY = os.environ.get('TRAJ_COUNTRY', 'CH').upper()
if not re.fullmatch(r'[A-Z]{2}', COUNTRY):
    sys.exit('TRAJ_COUNTRY: a two-letter country code')
BOX = os.environ.get('TRAJ_BBOX')
X0, Y0, X1, Y1 = (float(v) for v in BOX.split(',')) if BOX else (5.95, 45.81, 10.50, 47.81)
in_country = f"coalesce(addresses[1].country, '{COUNTRY}') = '{COUNTRY}'" if BOX else f"addresses[1].country = '{COUNTRY}'"
release = json.load(urllib.request.urlopen('https://stac.overturemaps.org/catalog.json', timeout=60))['latest']

con = duckdb.connect()
con.sql('INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;')
# A public bucket: anonymous access (AWS_* variables in the environment would be refused).
con.sql("CREATE SECRET ov (TYPE s3, PROVIDER config, KEY_ID '', SECRET '', REGION 'us-west-2')")
rows = con.sql(f"""
  SELECT id, names.primary AS name, basic_category, taxonomy.primary AS category, taxonomy.alternates AS alternates,
         taxonomy.hierarchy[1] AS section,
         confidence, operating_status, brand.names.primary AS brand, brand.wikidata AS brand_wikidata,
         websites[1] AS website, phones[1] AS phone,
         addresses[1].freeform AS street, addresses[1].postcode AS postcode, addresses[1].locality AS locality,
         sources[1].dataset AS dataset, ST_X(geometry) AS lon, ST_Y(geometry) AS lat
  FROM read_parquet('s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/*.parquet')
  WHERE bbox.xmin BETWEEN {X0} AND {X1} AND bbox.ymin BETWEEN {Y0} AND {Y1}
    AND {in_country}
    AND coalesce(operating_status, 'open') <> 'permanently_closed'
    AND (taxonomy.hierarchy[1] = 'food_and_drink'
         OR (confidence >= 0.8 AND (taxonomy.hierarchy[1] = 'shopping' OR taxonomy.primary IN ({listed}))))
""")
cols = rows.columns
with open(out, 'w') as h:
    n = 0
    for r in rows.fetchall():
        d = dict(zip(cols, r))
        d['release'] = release
        h.write(json.dumps(d, ensure_ascii=False, default=str) + '\n')
        n += 1
print(f'overture {release}: {n} places', file=sys.stderr)
