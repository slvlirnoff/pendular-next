# Bicycle and e-bike commute cost: sources and proposed defaults

Researched 2026-11-10. Every figure in the "Sources" tables was read in a page or
document fetched during this research session. Downloaded copies are in
`data/raw/bike-costs/` (git-ignored). Anything marked ASSUMPTION is NOT sourced.

## 1. Sources

### 1a. Official tax values (deduction, not cost)

| What | Value | Year | URL |
|---|---|---|---|
| Direct federal tax, Berufskostenverordnung (SR 642.118.1), Annex "Abzug für die Benützung eines privaten Fahrzeugs" (Art. 5 Abs. 2 Bst. b): Fahrräder, Motorfahrräder und Motorräder mit gelbem Kontrollschild | CHF 700 per year (flat) | version "Stand am 1. Januar 2026" | https://res.cloudinary.com/adminch/image/private/s--eHzTtpFy--/v1719842657/Bundespublikationen/642-118-1d.pdf |
| Same annex, context: Motorräder mit weissem Kontrollschild | CHF 0.40 per km | Stand 1.1.2026 | same |
| Same annex, context: Autos | CHF 0.75 per km | Stand 1.1.2026 | same |
| Canton Vaud, general instructions, "Usage d'autres moyens de transport": vélo, cyclomoteur, motocycle léger (up to 50 cm3) | up to CHF 700 per year (same as federal) | tax return 2025 | https://www.vd.ch/fileadmin/user_upload/organisation/dfin/aci/fichiers_pdf/21001_2025.pdf |
| Canton Vaud, same page, context: motocycle > 50 cm3 | 40 ct/km | 2025 | same |
| Canton Vaud, same page, context: car | 70 ct/km up to 15 000 km, 35 ct/km beyond | 2025 | same |
| Canton Vaud ACI employer guideline: employer km allowance for a private bike used for business trips (not commuting) | CHF 0.10/km (bike), CHF 0.15/km (e-bike), max CHF 2.90 per day | 2025 | https://vd.ch/fileadmin/user_upload/organisation/dfin/aci/fichiers_pdf/2025_LignesDirectrices_Mobilit%C3%A9.pdf |

Notes on the tax values:
- The federal and Vaud rule applies only where the private vehicle use is justified (the PDF text is
  conditional, "sofern kein öffentliches Verkehrsmittel zur Verfügung steht oder dessen Benützung
  objektiv nicht zumutbar ist" in Art. 5 Abs. 2). Vaud states the same "exceptional use" condition.
- Both are flat tax deductions, i.e. what the state lets you deduct, not a measured cost. CHF 700 / 3 520 km
  (8 km x 2 x 220 days) = CHF 0.20/km, so it is an upper bound relative to the cost estimates below.
- The e-bike (25 km/h) falls under "Fahrräder"; the federal text lists no separate e-bike line. A yellow
  plate is needed for the 45 km/h class (not looked into here).
- The exact legal citation for the amount is the annex of SR 642.118.1, referenced from Art. 3 / Art. 5 Abs. 2
  Bst. b. The annex heading in the fetched version carries no separate tax-year label beyond "Stand 1.1.2026".

### 1b. Cost references

| What | Value | Year | URL |
|---|---|---|---|
| TCS car reference (context) | 74 Rp/km in 2026, model car CHF 45 000 | 2026 | https://www.tcs.ch/de/der-tcs/presse/medienmitteilungen-2026/kilometerkosten-2026.php |
| Velosuisse (Martin Platter, quoted in NZZ): average e-bike price in Switzerland | about CHF 4 000 (press quote, not a published statistic) | NZZ article dated 09.10.2026 | https://www.nzz.ch/zuerich/drogensuechtige-verramschen-kostbare-e-bikes-an-einen-fluechtling-er-verkauft-sie-weiter-der-boomende-zuercher-velomarkt-ist-ein-lukratives-feld-fuer-diebe-ld.10028184 |
| Topten.ch e-bike guide: electricity for a full charge | about 10 Rp per full charge | page cites publications of June 2024 | https://old.topten.ch/business/adviser/ratgeber-e-bikes |
| Topten.ch: energy need of an e-bike | about 0.1 litre petrol per 100 km (roughly 1 kWh/100 km; the conversion is my own) | same | same |
| Topten.ch: battery replacement | CHF 500 to 1 000 | same | same |
| ElCom: median household electricity price (H4, 4 500 kWh/yr, basic supply) | 27.7 Rp/kWh | 2026 | https://www.elcom.admin.ch/dam/de/sd-web/znXqHISH0pFP/Newsletter_09-2025_D.pdf |
| BikeX (Germany, Motor Presse): e-bike example | purchase EUR 3 000, 5 years, 11 000 km/yr, maintenance and parts EUR 500/yr, 1 kWh/100 km, EUR 0.359/kWh, result EUR 0.10/km, electricity about EUR 40/yr | Feb 2023 prices | https://www.bike-x.de/e-bike/werkstatt/wie-teuer-ist-e-biken |
| ACE (German motoring club) "Gute Wege" infographic: all fixed and variable costs, 5 000 km/yr bicycles, 15 000 km/yr car | Fahrrad 5 ct/km, Pedelec 20 ct/km, Pkw > 50 ct/km (EUR) | infographic, stock figures of 2019 | https://images.ace.de/dokumente/autoclub/infografik-fahrrad.pdf |
| Dynamot via Velojournal: Swiss bike trade turnover 2024 (context, not per-bike) | CHF 1.81 billion | 2024 | https://www.velojournal.ch/aktuell/nachrichten/detail/schweizer-velobranche-umsatz-sinkt-trotz-mehr-verkaeufen/ |
| Velosuisse via swissinfo: e-bikes delivered to trade 2024 | 151 772 (-12 %), about 45 % share (units, not prices) | 2024 | https://www.swissinfo.ch/eng/life-aging/nearly-one-in-two-bicycles-sold-in-switzerland-is-an-e-bike/89014424 |

Sanity check of the ACE German figures: 5 ct/km x 5 000 km = EUR 250/yr for a bike; 20 ct/km x 5 000 = EUR 1 000/yr
for a pedelec. These are euro figures and 5 000 km/yr, so only indicative for Switzerland.

## 2. Proposed default model

Commute: 8 km each way, 220 days, so 8 x 2 x 220 = **3 520 km/yr**.

### Conventional bicycle

| Item | Value | Status |
|---|---|---|
| Purchase price | CHF 800 | ASSUMPTION (no Swiss average price for conventional bikes found) |
| Lifetime | 10 years | ASSUMPTION |
| Depreciation | 800 / 10 = CHF 80/yr | derived |
| Maintenance, tyres, chain, service | CHF 100/yr | ASSUMPTION (no Swiss source found) |
| Energy | 0 | n/a |
| Insurance/theft | 0 | ASSUMPTION: not modelled (no source found) |

- Running cost only: CHF 100/yr = **CHF 0.028/km** (100 / 3 520).
- Full cost: 80 + 100 = CHF 180/yr = **CHF 0.051/km**. Close to the ACE 5 ct/km (German, in EUR), which is a coincidence-level cross-check, not a validation.

### E-bike (25 km/h pedelec)

| Item | Value | Status |
|---|---|---|
| Purchase price | CHF 4 000 | SOURCED (Velosuisse spokesperson quoted by NZZ, 2026, press quote) |
| Lifetime of frame/motor | 8 years | ASSUMPTION |
| Depreciation | 4 000 / 8 = CHF 500/yr | derived |
| Battery replacement | CHF 750, one replacement over the 8 years, so 750 / 8 = CHF 93.75/yr | price range CHF 500-1 000 SOURCED (Topten), midpoint and one-replacement count ASSUMPTION |
| Maintenance, wear parts | CHF 200/yr | ASSUMPTION (BikeX uses EUR 500/yr at 11 000 km/yr, deliberately high; scaled down to 3 520 km this is about EUR 160) |
| Electricity | 1 kWh/100 km x CHF 0.277/kWh = CHF 0.277/100 km; x 3 520 km = CHF 9.75/yr | consumption SOURCED loosely (Topten 0.1 L petrol-equivalent, BikeX 1 kWh/100 km), price SOURCED (ElCom 27.7 Rp/kWh, 2026) |
| Insurance/theft | 0 | not modelled (no source found) |

- Running cost only (battery + maintenance + electricity): 93.75 + 200 + 9.75 = CHF 303.5/yr = **CHF 0.086/km**.
- Full cost: 500 + 303.5 = CHF 803.5/yr = **CHF 0.228/km**. Close to the ACE pedelec 20 ct/km (German, EUR).

### Summary

| | CHF/km full | CHF/yr full | CHF/km running | CHF/yr running |
|---|---|---|---|---|
| Bicycle | 0.051 | 180 | 0.028 | 100 |
| E-bike | 0.228 | 804 | 0.086 | 304 |

Comparison: car full 0.74 x 3 520 = CHF 2 605/yr; car running 0.276 x 3 520 = CHF 972/yr.
Tax flat deduction for a bike or e-bike (CHF 700) lies between the e-bike running and full cost.

## 3. Not found, doubts

- Not found: any Swiss source for the average price of a conventional bicycle (Velosuisse statistik page fetched, units only).
- Not found: any Swiss source for yearly maintenance cost of bicycle or e-bike in CHF (Velojournal 6/2022 "Was kostet Velofahren" PDF was not retrievable; the URL returned 404 to curl).
- Not found: theft/insurance premium for bikes (only an Axa average theft claim of CHF 2 350 reported by NZZ, which is not a premium).
- Not found: TCS or Pro Velo cost-per-km calculation for bikes or e-bikes; ARE/BFS per-km bike cost.
- Not found: a Vaud-specific tax value different from the federal one; both are CHF 700/yr.
- The NZZ CHF 4 000 is an oral estimate quoted in a press article, not a Velosuisse publication. The paywall-free text was read fully.
- The 1 kWh/100 km figure is a rule of thumb; Topten gives it only as petrol-equivalent. BikeX is German.
- Velojournal and swissinfo pages were not usable for prices. The ACE and BikeX figures are German, in EUR.
- Annual km differ: ACE assumes 5 000 km/yr and BikeX 11 000 km/yr, versus 3 520 km/yr here; fixed-cost shares per km therefore differ.
- sbb.ch style refusals were not encountered; the Fedlex HTML page was a JS app, so the Berufskostenverordnung was read from the admin.ch PDF. The ESTV Steuermäppchen PDFs returned 404 and are not cited.
