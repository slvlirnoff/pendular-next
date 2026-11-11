# Shared mobility (GBFS) in MOTIS: trial of 11.11.2026

Not enabled in `config.yml`. To try it, add to the config MOTIS runs with (`data/config.yml`
after an import) and restart the server; no re-import is needed:

```yaml
gbfs:
  feeds:
    sharedmobility:
      # One sub-feed per provider, with vehicle types. The service asks for a contact e-mail
      # address in this header (not kept in the repository).
      url: https://gbfs.prod.sharedmobility.ch/v2/gbfs
      headers:
        Authorization: <contact e-mail address>
  update_interval: 300
  http_timeout: 60
```

What the trial showed (MOTIS 2.11.4):

- The per-provider service loads all 46 providers in about 30 seconds at start, with proper
  vehicle types: Mobility and 2EM are cars, Donkey Republic bicycles, Voi scooters and bikes.
- `GET /api/v1/rentals?min=lat,lon&max=lat,lon` lists stations and vehicles. `/api/v6/plan`
  accepts `RENTAL` in `directModes`, `preTransitModes` and `postTransitModes`, and
  `directRentalFormFactors=BICYCLE` (and the `preTransit…` / `postTransit…` forms) keeps cars
  and scooters out.
- Geneva Cornavin - Plan-les-Ouates on a timetable morning: tram and walking 37 min; shared
  bike all the way 29 min; train to Lancy-Bachet and a shared bike for the last leg 25-26 min.
- Lausanne gare - EPFL with bicycles only: no result (no bike-share network there in the feed).
- The older open feed (`https://sharedmobility.ch/gbfs.json`, no header needed) is not usable:
  it has no vehicle types, so MOTIS rides car-sharing cars as bicycles.
- Availability is today's. For a commute planned on a timetable day in 2027 only the existence
  and place of stations matters, not the live counts.
- Terms: open use, source must be named (Swiss Federal Office of Energy, sharedmobility.ch).

Stations per provider in the open feed (bounding boxes): Geneva canton: Donkey Republic 621,
2EM 313, Mobility 129, carvelo2go 29, Voi 17. Lausanne area: 2EM 270, Mobility 125, carvelo2go
23, EPFL 6. Bern: Voi 522, Velospot 308, Mobility 161. Zürich: Mobility 323, Velospot 275, Voi
158, Dott 64.
