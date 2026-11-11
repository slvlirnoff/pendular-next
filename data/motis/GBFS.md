# Shared mobility (GBFS) in MOTIS: trial of 11.11.2026

Not enabled in `config.yml`. To try it, add to the config MOTIS runs with (`data/config.yml`
after an import) and restart the server; no re-import is needed:

```yaml
gbfs:
  feeds:
    sharedmobility:
      url: https://sharedmobility.ch/gbfs.json
  update_interval: 300
  http_timeout: 60
```

What the trial showed (MOTIS 2.11.4):

- The open national feed (Swiss Federal Office of Energy, GBFS 2.0, one feed for all 46
  providers, 12,602 stations, about 7 MB of free vehicles) loads in about 8 seconds.
- `GET /api/v1/rentals?min=lat,lon&max=lat,lon` lists stations and vehicles; `/api/v6/plan`
  accepts `RENTAL` in `directModes`, `preTransitModes` and `postTransitModes`.
- **Not usable as is:** this feed has no vehicle types, so MOTIS treats everything as one
  provider of bicycles. Car-sharing cars (Mobility, 2EM) are then ridden as bikes: a "rental"
  from Lausanne station to EPFL came back on a BMW M4.
- The newer service (`gbfs.prod.sharedmobility.ch/v2/gbfs`, one sub-feed per provider with
  vehicle types) asks for a contact e-mail address in the `Authorization` header
  (https://github.com/SFOE/sharedmobility/blob/main/Access%20the%20data.md). MOTIS can send
  headers per feed (`headers:` under the feed). Not tried: it needs an address to give.
- Availability is today's. For a commute planned on a timetable day in 2027 only the existence
  and place of stations matters, not the live counts.

Stations per provider in the open feed (bounding boxes): Geneva canton: Donkey Republic 621,
2EM 313, Mobility 129, carvelo2go 29, Voi 17. Lausanne area: 2EM 270, Mobility 125, carvelo2go
23, EPFL 6. Bern: Voi 522, Velospot 308, Mobility 161. Zürich: Mobility 323, Velospot 275, Voi
158, Dott 64.
