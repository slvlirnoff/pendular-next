"""All The Places spiders worth reading for Trajestaurant: brands with places in Switzerland.

Reads the per-spider stats (counts per country, category and brand) and prints the spiders that
have Swiss places, name a brand, and hold shops or places one goes to (food, pharmacies, fuel,
banks, fitness, hotels, car dealers…). Open-data spiders (trees, benches, bus stops), charging
stations, post boxes and the like are left out.

    python3 atp_select.py <stats dir>
"""
import json
import os
import sys

KEEP = (
    'shop/',
    'amenity/restaurant', 'amenity/fast_food', 'amenity/cafe', 'amenity/ice_cream', 'amenity/bar', 'amenity/pub',
    'amenity/pharmacy', 'amenity/fuel', 'amenity/bank', 'amenity/car_rental', 'amenity/cinema', 'amenity/post_office',
    'amenity/doctors', 'amenity/dentist', 'amenity/clinic',
    'leisure/fitness_centre', 'leisure/sports_centre', 'leisure/bowling_alley',
    'tourism/hotel', 'tourism/motel', 'tourism/hostel',
    'office/employment_agency', 'office/insurance', 'office/estate_agent',
)

stats_dir = sys.argv[1]
picked = []
for f in sorted(os.listdir(stats_dir)):
    try:
        with open(os.path.join(stats_dir, f)) as h:
            s = json.load(h)
    except (OSError, ValueError):
        continue
    if s.get('atp/country/CH', 0) <= 0:
        continue
    if not any(k.startswith('atp/brand_wikidata/') for k in s):
        continue
    cats = [k.split('/', 2)[2] for k in s if k.startswith('atp/category/')]
    if not any(c.startswith(KEEP) for c in cats):
        continue
    picked.append((s['atp/country/CH'], f[:-5]))
for _, spider in sorted(picked, reverse=True):
    print(spider)
