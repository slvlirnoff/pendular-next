"""Every Overture Maps place in a box, as JSON lines: all categories, any confidence.

Trajestaurant's own extract (apps/trajestaurant/import/overture.py) keeps food and drink and the
shops and services it shows, at the confidence it trusts in Switzerland; this one keeps everything,
for looking at what Overture knows of a region before deciding what to use.

    python3 overture_places.py <out.jsonl> [lon_min,lat_min,lon_max,lat_max]

Needs python3 with duckdb (httpfs and spatial are installed on first use). Only the row groups
inside the box are read from Overture's public S3 bucket.
"""
import json
import sys
import urllib.request

import duckdb

out = sys.argv[1]
X0, Y0, X1, Y1 = (float(v) for v in (sys.argv[2] if len(sys.argv) > 2 else '27.35,47.95,30.05,49.95').split(','))
release = json.load(urllib.request.urlopen('https://stac.overturemaps.org/catalog.json', timeout=60))['latest']

con = duckdb.connect()
con.sql('INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;')
# A public bucket: anonymous access (AWS_* variables in the environment would be refused).
con.sql("CREATE SECRET ov (TYPE s3, PROVIDER config, KEY_ID '', SECRET '', REGION 'us-west-2')")
rows = con.sql(f"""
  SELECT id, names.primary AS name, names.common AS names, basic_category, taxonomy.primary AS category,
         taxonomy.alternates AS alternates, taxonomy.hierarchy AS hierarchy, confidence, operating_status,
         brand.names.primary AS brand, brand.wikidata AS brand_wikidata, websites, phones, emails, socials,
         addresses[1].freeform AS street, addresses[1].locality AS locality, addresses[1].postcode AS postcode,
         addresses[1].country AS country, list_transform(sources, lambda s: s.dataset) AS datasets,
         ST_X(geometry) AS lon, ST_Y(geometry) AS lat
  FROM read_parquet('s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/*.parquet')
  WHERE bbox.xmin BETWEEN {X0} AND {X1} AND bbox.ymin BETWEEN {Y0} AND {Y1}
  ORDER BY id
""")
cols = rows.columns
n = 0
with open(out, 'w') as f:
    for r in rows.fetchall():
        row = {k: v for k, v in zip(cols, r) if v not in (None, [], {})}
        row['release'] = release
        f.write(json.dumps(row, ensure_ascii=False, default=str) + '\n')
        n += 1
print(f'overture {release}: {n} places')
