# Density data (residents and jobs within 1 km)

Used by `packages/engine/src/density.ts` to estimate "minutes to find a parking space and walk to the door".

## Sources

| What | Dataset | Year | File used |
|---|---|---|---|
| Residents | BFS STATPOP, "Statistik der Bevölkerung und Haushalte (STATPOP) - Geodaten", hectare level | 2025 (end of year; published 17.09.2026) | `statistik-bevoelkerung_haushalte_2025_ha_2056.csv`, column `BBTOT` |
| Jobs | BFS STATENT, "Statistik der Unternehmensstruktur (STATENT) - Geodaten", hectare level | 2024 (published 2026) | `betriebszaehlungen_2024_ha_2056.csv`, column `B08EMPT` (employed persons, not FTE) |

- STATPOP 2025 on data.geo.admin.ch: https://data.geo.admin.ch/browser/index.html#/collections/ch.bfs.statistik-bevoelkerung_haushalte/items/statistik-bevoelkerung_haushalte_2025
- STATENT 2024: https://data.geo.admin.ch/browser/index.html#/collections/ch.bfs.betriebszaehlungen/items/betriebszaehlungen_2024
- BFS catalogue entries: https://dam-api.bfs.admin.ch/hub/api/dam/assets/36856441 (STATPOP 2025), https://dam-api.bfs.admin.ch/hub/api/dam/assets/36793063 (STATENT 2024)
- BFS GEOSTAT page: https://www.bfs.admin.ch/bfs/de/home/dienstleistungen/geostat/geodaten-bundesstatistik/gebaeude-wohnungen-haushalte-personen/bevoelkerung-haushalte-ab-2010.html
- Older STATPOP 2022 (asset 27965868) was downloaded first and is superseded.

Both files: 100 m hectares, semicolon CSV, LV95 (EPSG:2056); `E_KOORD`/`N_KOORD` is the south-west corner, the centre is +50 m.
The BFS replaces counts of 1 to 3 (STATPOP) or 1 to 4 (STATENT) by 3 or 4 for privacy, so sums are slightly high in thinly built areas.

## Licence

The BFS catalogue marks both datasets with terms of use `OPEN-BY`: "Open use - Must provide the source" (German label: "Freie Nutzung - Quellenangabe ist Pflicht"). The data.geo.admin.ch collection links to https://opendata.swiss/en/terms-of-use/#terms_by; that page was not reachable from the build machine (403), so its text is not quoted here. Attribution to use: "Source: Federal Statistical Office (BFS), STATPOP 2025 and STATENT 2024".

## How the file is built

`pnpm tsx data/scripts/build-density.ts` (raw CSVs expected in `data/raw/density/`, git-ignored) reads both CSVs, drops rows with `NOLOC=1`, sums them per 100 m cell and writes `density-1km.json`: column arrays (`key` delta-coded cell ids, `res`, `jobs`), about 368,000 cells, 2.6 MB.
Rows with `NOLOC=1` (1,920 hectares, 1.3 % of residents; 6,321 hectares, 4 % of jobs) are people and jobs the BFS could not place; it puts them on one hectare per municipality, which would fake a dense spot in every village.
At lookup time the engine adds up all cells whose centre lies within 1,000 m of the point (straight line). WGS84 is converted to LV95 with the swisstopo approximate formulas (about 1 m).
The grid equals the BFS hectares, so the sums match the exact hectare computation (0 error on 22 sample points, checked by the build script). A 200 m grid was tried first: 1.2 MB, but up to 6 % error on residents and 24 % on one job concentration, so it was dropped.

## Thresholds (ASSUMPTIONS)

Taken over from an earlier prototype, not measured. Defined in `DEFAULT_PARKING_THRESHOLDS` (residents within 1 km):

| Residents within 1 km | Minutes | Kind |
|---|---|---|
| >= 20,000 | 15 | cityCentre |
| >= 8,000 | 10 | townCentre |
| otherwise | 5 | elsewhere |

For residents plus jobs no default is set: `parkingAt` accepts `measure: 'residentsAndJobs'` with thresholds supplied by the caller. See the table below before choosing any.

## Sample figures (1 km radius)

Coordinates are approximate station or centre points.

| Place | Residents | Jobs | Sum | Minutes by residents rule |
|---|---|---|---|---|
| Lausanne gare | 33,743 | 60,573 | 94,316 | 15 (cityCentre) |
| Lausanne Flon | 36,786 | 58,685 | 95,471 | 15 (cityCentre) |
| CHUV | 28,792 | 50,882 | 79,674 | 15 (cityCentre) |
| Renens gare | 27,373 | 14,069 | 41,442 | 15 (cityCentre) |
| EPFL | 7,460 | 10,600 | 18,060 | 5 (elsewhere) |
| Morges centre | 11,789 | 6,943 | 18,732 | 10 (townCentre) |
| Nyon gare | 10,803 | 9,953 | 20,756 | 10 (townCentre) |
| Vevey gare | 19,464 | 14,160 | 33,624 | 10 (townCentre) |
| Yverdon gare | 14,614 | 10,059 | 24,673 | 10 (townCentre) |
| Aigle gare | 7,853 | 3,378 | 11,231 | 5 (elsewhere) |
| Lucens | 4,075 | 989 | 5,064 | 5 (elsewhere) |
| Genève Cornavin | 49,299 | 60,479 | 109,778 | 15 (cityCentre) |
| Bern HB | 18,440 | 85,009 | 103,449 | 10 (townCentre) |
| Zürich HB | 20,424 | 112,115 | 132,539 | 15 (cityCentre) |
| Lovatens (village) | 171 | 48 | 219 | 5 (elsewhere) |

Observations: the residents figures here (2025) are close to the earlier prototype for Lausanne gare (33,743 against about 33,600) but lower for Morges (11,789 against about 13,100, probably another year or reference point). On the combined sum, EPFL (18,060) lands next to Morges (18,732) and below Nyon (20,756), so a combined limit that puts EPFL in "townCentre" at about 18,000 would also pull in every town centre of Morges size; Bern HB, which is a clear car-hostile centre, only reaches 10 by residents but 103,000 combined.
