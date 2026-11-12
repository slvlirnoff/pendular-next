"""Car-sharing and bike-sharing stations in Switzerland from the national shared-mobility feed
(GBFS v2, sharedmobility.ch, Swiss Federal Office of Energy), as JSON lines, each with the
vehicles it is for ("car" or "bike"; a station with both gives two lines).

The feed asks for a contact e-mail address in the Authorization header: SHAREDMOBILITY_CONTACT
(never written to the repository). Cars: every provider with cars, and of mixed providers only the
stations that hold cars; myBuxi is left out (its "cars" are the stops of an on-demand minibus).
Bikes: the providers with stations one takes a bike from and brings it back to (Velospot, Donkey
Republic, nextbike, carvelo2go, PickeBike, PubliBike…), not the parking zones of free-floating
scooters and bikes (Lime, Bird, Voi, Dott, Bolt).

    SHAREDMOBILITY_CONTACT=… python3 carsharing.py <out.jsonl>
"""
import json
import os
import sys
import time
import urllib.request

BASE = 'https://gbfs.prod.sharedmobility.ch/v2/gbfs'
SKIP = {'mybuxi_ch'}
# Station-based bike sharing (a provider id starts with one of these).
BIKE_PROVIDERS = ('velospot', 'donkey_', 'nextbike_', 'carvelo2go', 'pickebike_', 'publibike', 'liemobil_', 'epfl_')
BIKES = {'bicycle', 'cargo_bicycle'}

contact = os.environ.get('SHAREDMOBILITY_CONTACT', '').strip()
if '@' not in contact:
    sys.exit('SHAREDMOBILITY_CONTACT (a contact e-mail address) is needed by the feed')
headers = {'Authorization': contact, 'User-Agent': 'trajestaurant-data-pipeline'}


def get(url, tries=5):
    # The feed now and then leaves a request unanswered (one in a few dozen): a short timeout and
    # a few tries get through where one long wait fails the whole download.
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=20) as r:
                return json.load(r)
        except (OSError, ValueError) as e:
            if attempt == tries - 1:
                raise
            print(f'retry {url}: {e}', file=sys.stderr)
            time.sleep(2 * (attempt + 1))


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
        vtypes = get(f'{BASE}/{sid}/vehicle_types')['data']['vehicle_types']
        cars = {v['vehicle_type_id'] for v in vtypes if v.get('form_factor') == 'car'}
        bikes = {v['vehicle_type_id'] for v in vtypes if v.get('form_factor') in BIKES} if sid.startswith(BIKE_PROVIDERS) else set()
        if not cars and not bikes:
            continue
        info = get(f'{BASE}/{sid}/system_information')['data']
        status = {s['station_id']: s for s in get(f'{BASE}/{sid}/station_status')['data']['stations']}
        for st in get(f'{BASE}/{sid}/station_information')['data']['stations']:
            types = {t['vehicle_type_id'] for t in status.get(st['station_id'], {}).get('vehicle_types_available', [])}
            for vehicle, of in (('car', cars), ('bike', bikes)):
                # A station of a mixed provider is kept for the vehicles it holds.
                if not of or (types and not types & of):
                    continue
                h.write(json.dumps({
                    'vehicle': vehicle,
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
print(f'car and bike sharing: {n} stations', file=sys.stderr)
