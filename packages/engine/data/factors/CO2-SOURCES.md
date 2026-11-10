# CO2 factor sources

## What was obtained
- **mobitool-Faktoren v3.1, dated 2025-04-08** (Excel, GWP100a, life cycle: direct, non-exhaust, energy chain, maintenance, vehicle, end of life, road; column "sum").
  - File: https://assets.ctfassets.net/4y40wxcxzkmz/oVkB45ifGfz5X44f5Omb1/9d3ef33605fb6154d61d7630536c3a92/mobitool-Faktoren-v3.1-20250408.xlsx
  - Found via the SFOE open-data catalogue README (https://raw.githubusercontent.com/SFOE/open_energy_data/master/README.md).
  - Local copy: `data/raw/factors/mobitool-Faktoren-v3.1-20250408.xlsx` (git-ignored). Sheet `mobitool-Faktoren-v3.1`, values read with openpyxl (cached results), column AG.
- Manual v3.0 (DE): https://assets.ctfassets.net/4y40wxcxzkmz/38i63bjJXJtYF6VTQW1GvT/82ee0f5ce2e7555e7e99e37f43e438a0/mobitool-manual-v3.0_de.pdf (downloaded, not used for numbers).

## Spec vs. found
The spec names "KBOB/BAFU 2022 ... mobitool v2.1". The mobitool.ch website now redirects to energieschweiz.ch, whose old v2.1/v3.0 pages return 404 and no v2.1 file could be located. The newest published workbook is **v3.1**, used here. Values differ from v2.1 (e.g. Swiss rail is far lower). No KBOB list was fetched. The spec text should be updated to v3.1.

## Mapping (per pkm unless stated; rows of the sheet)
| key | row | value g CO2-eq |
|---|---|---|
| rail_long | 103 Train Switzerland, long-distance traffic | 6.8154 |
| rail_regional | 101 Train Switzerland, regional traffic incl. S-Bahn | 8.0381 |
| tram | 18 Tram, fleet average | 42.793 |
| bus_city | 20 City bus 13 m single deck, diesel (no fleet average exists) | 133.8195 |
| boat | 105 Passenger ship, diesel | 161.2961 |
| cableway | 106 Cable car, electric, consumer mix CH | 60.0304 |
| car (per vkm) | 59 Passenger car fleet average (2012) 186.4275 per pkm x occupancy 1.6 | 298.284 |
| car_electric (per vkm) | 90 Battery electric fleet average (2021) 89.7906 per pkm x occupancy 1.6 | 143.665 |
| bike | 9 Bicycle, conventional, urban | 5.58 |
| ebike | 10 E-Bike <25 km/h | 11.3259 |
| walk | 7 On foot | 0 |

Car per-vkm values are **derived** (pkm sum times the sheet's own occupancy cell T). Switching the workbook to vkm and recalculating in LibreOffice gave #DIV/0! for car rows, so the multiplication was done by hand. Tram and rail recalculated in vkm matched sum x occupancy, supporting the method.

Other rows available if wanted: coach diesel single deck 46.54, trolleybus (articulated) 29.61, hybrid city bus 13 m 124.73, BEV city bus 13 m 57.76, average public transport 25.42, Swiss rail average 7.02.

## Not found (value null in co2.json)
- **bus_regional**: no regional-bus row in v3.1. Engine falls back to `bus_city` (diesel city bus; likely an overestimate for regional lines).
- **metro**: no underground row. Engine falls back to `tram`.
- **funicular**: no funicular row. Engine falls back to `cableway`.
- **Bosch eBike Systems figure**: bosch-ebike.com returned HTTP 403 and the bosch-presse.de URLs 404, so nothing was fetched; a web-search snippet mentioned about 14 g/km life cycle, which was NOT used. The ebike value is the mobitool row instead.
- KBOB / BAFU 2022 transport list: not fetched.
