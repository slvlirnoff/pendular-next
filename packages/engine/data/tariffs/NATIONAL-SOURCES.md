# National tariff sources

Downloaded 2026-11-10 into `data/raw/tariffs/` (git-ignored). All from allianceswisspass.ch.

| Document | URL | Validity | Taken |
|---|---|---|---|
| Tarifmassnahmen page (Stand 12.10.2026) | https://www.allianceswisspass.ch/de/tarife-vorschriften/tarifmassnahmen | **valid from 13.12.2026** | GA yearly/monthly for all categories, GA-Monatskarte, Tageskarte (zum Halbtax), Halbtax adult new/renewal |
| T654 | https://www.allianceswisspass.ch/de/asp/Downloads?download=2673 | edition 01.06.2026 | previous GA prices (13.2.1), Halbtax incl. youth (13.2.2), day/multi-day cards (13.2.6), age rules (4.2, 5.2, 5.3) |
| T601 | https://www.allianceswisspass.ch/de/asp/Downloads?download=16350 | edition 01.06.2026 | single-trip price table (section 12, image), half-fare rule 2.4.1, minimums 11.2.1, zone rule 11.1.4/11.2.1 |
| T650 | https://www.allianceswisspass.ch/de/asp/Downloads?download=2671 | edition 01.06.2026, table "gültig ab 10.12.2023" | route-pass table 4.2.1 (image), year = 9 x month (4.1.7), zone rule 4.1.5 |

Tables in T601 and T650 are images in the PDFs; they were transcribed by reading the rendered images. Checks passed: T650 year = 9 x month on all 53 rows (adult 2nd/1st, junior), bands contiguous, prices non-decreasing, T601 1st/2nd class ratio within 1.6-1.75 on all 93 rows.

## Rules found
- Tariff km: T601 prices are read at the last km of the zone (zones 1-8 km: 4 km; 9-30: 2 km; 31-60: 3 km; 61-100: 4 km; 101-150: 5 km; 151-300: 10 km; 301-1500: 20 km). Prices rounded up to 20 Rp, from 69 km to the next franc. Min fare 2nd/1st class CHF 3.00/5.20 (half fare 2.20/2.60). The distance itself comes from NOVA (T650 3.1.1); no rule on rounding of actual km was found beyond the table bands.
- Half fare ticket = full price halved, no rounding (T601 2.4.1), not below the minimum.
- T650: year (12 months) = month x 9; junior table is 2nd class only.
- Age: GA Jugend / Halbtax Jugend 16-24.99, GA 25-year-olds, adult from 26 (women to 63.99, men to 64.99), senior = AHV age (T654 4.2, 5.2, 5.3). Children 6-15.99 use the Junior discount (T600.3), GA Kind.

## Not found
- T601 single-ticket prices valid from 13.12.2026 (the measures page lists none; table is 01.06.2026 edition).
- T650 route-pass prices valid from 13.12.2026; table above 240 tariff km (table image ends at 231-240 although 4.1.3 mentions up to 250 km).
- Halbtax Jugend (16-24.99) price for 2027 (not in the measures list; 01.06.2026: 120 new / 100 renewal in `previous`).
- Multi-Tageskarte price for 2027 (01.06.2026: 468 / 768).
- GA monthly price from the 13th month for 2027.
- Child Halbtax (no card; Junior discount).

## Doubts
- The 13.12.2026 measures page lists only changed prices; "no mention" for Halbtax Jugend probably means unchanged but this is not stated, so it is null.
- The page's "Tageskarte 81/134" is assumed to be the Tageskarte zum Halbtax (the 2026 prices 78/128 in T654 13.2.6 match that product).
- T601/T650 tables may change on 13.12.2026; treat their values as 2026 figures.
- Image transcription (only consistency-checked, no second source).
- Half-fare minimum 2.20/2.60 applied to all short trips by `distanceSingle` (T601 11.2.1 wording).
- Senior GA/Halbtax mapped from AgeGroup 'senior' (AHV age); the 25-year tier is exposed separately as `gaYearly25`.

## Second pass (2026-11-10)
Independent re-read of both tables, done before looking at the JSON values. Both tables are embedded raster images (T601 page 35, 607x690 px; T650 page 12, 564x1021 px), so text extraction was not possible. The images were extracted at native resolution (`pdfimages -png`), upscaled 3-4x and cropped into strips of about 10 rows; every cell was transcribed by eye into `data/raw/tariffs/second-pass/` (git-ignored), then diffed programmatically against `previous.distanceSingle` and `previous.routePass`.

- T601 `distanceSingle`: 93 rows x (kmFrom, kmTo, 2nd, 1st) compared. Corrections needed: none.
- T650 `routePass`: 53 rows x (kmFrom, kmTo, 6 price columns) compared. Corrections needed: none.
- Total 796 cells compared, 0 mismatches, 0 cells unverified.
- Source-logic checks re-run on my transcription: bands contiguous from 1 km, prices non-decreasing in every column, T650 year = 9 x month in all 53 rows (adult 2nd, adult 1st, junior), T601 1st/2nd ratio within 1.6-1.75 on all rows.
- Validity printed: T650 table headed "Gültig ab 10.12.2023" (4.2.1); the T601 table image carries no validity date, only the footer "Gen 5005 rst20230424" (document edition 01.06.2026).
- Observation: the T601 image table ends at 981-1000 km; the return-trip columns ('<=>') were not transcribed because they are not stored.
