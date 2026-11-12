"""Car-sharing stations in Switzerland from the national shared-mobility feed (GBFS v2,
sharedmobility.ch, Swiss Federal Office of Energy), as JSON lines.

The feed asks for a contact e-mail address in the Authorization header: SHAREDMOBILITY_CONTACT
(never written to the repository). Only providers with cars, and of mixed providers (cargo bikes
and cars) only the stations that hold cars. myBuxi is left out: its "cars" are the stops of an
on-demand minibus, not cars one drives.

    SHAREDMOBILITY_CONTACT=… python3 carsharing.py <out.jsonl>
"""
import json
import os
import sys
import urllib.request

BASE = 'https://gbfs.prod.sharedmobility.ch/v2/gbfs'
SKIP = {'mybuxi_ch'}

contact = os.environ.get('SHAREDMOBILITY_CONTACT', '').strip()
if '@' not in contact:
    sys.exit('SHAREDMOBILITY_CONTACT (a contact e-mail address) is needed by the feed')
headers = {'Authorization': contact, 'User-Agent': 'trajestaurant-data-pipeline'}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=90) as r:
        return json.load(r)


out = sys.argv[1]
n = 0
with open(out, 'w') as h:
    for system in get(BASE)['systems']:
        sid = system['id']
        if sid in SKIP:
            continue
        feeds = {f['name'] for f in get(f'{BASE}/{sid}/gbfs')['data']['en']['feeds']}
        if not {'vehicle_types', 'station_information', 'station_status'} <= feeds:
            continue
        cars = {v['vehicle_type_id'] for v in get(f'{BASE}/{sid}/vehicle_types')['data']['vehicle_types'] if v.get('form_factor') == 'car'}
        if not cars:
            continue
        info = get(f'{BASE}/{sid}/system_information')['data']
        status = {s['station_id']: s for s in get(f'{BASE}/{sid}/station_status')['data']['stations']}
        for st in get(f'{BASE}/{sid}/station_information')['data']['stations']:
            types = {t['vehicle_type_id'] for t in status.get(st['station_id'], {}).get('vehicle_types_available', [])}
            # A station of a mixed provider is kept when it holds cars.
            if types and not types & cars:
                continue
            h.write(json.dumps({
                'provider': sid,
                'provider_name': info.get('name') or sid,
                'provider_url': info.get('url'),
                'station_id': st['station_id'],
                'name': (st.get('name') or '').strip(),
                'address': (st.get('address') or '').strip() or None,
                'lat': st['lat'],
                'lon': st['lon'],
                'rental_uri': (st.get('rental_uris') or {}).get('web'),
            }, ensure_ascii=False) + '\n')
            n += 1
print(f'car sharing: {n} stations', file=sys.stderr)
