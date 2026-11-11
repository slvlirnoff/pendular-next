# Network tariff grids: sources

One file per fare network, `<NOVA alliance id>.json`, read by `packages/engine/src/fares/networks.ts`.
All documents were fetched on **2026-11-10** into `data/raw/tariffs/networks/<network>/` (git-ignored),
one directory per site. The grids were transcribed by script from `pdftotext -layout` output, never
typed by hand; the scripts are not kept in the repository, the checks they ran are listed below.

| File | Year | Valid from | State |
| --- | --- | --- | --- |
| `frimobil.json` | 2027 | 2026-12-13 | **2027 grid found**, complete. The grid in force until 12.12.2026 is kept under `previous`. |
| `onde-verte.json` | 2026 | 2026-06-01 (edition of the tariff) | **Current prices.** An increase of 3.9 % on average is announced for 13.12.2026; the new prices were not published. |
| `unireso.json` | 2026 | 2025-12-14 | **Current prices.** No change for 13.12.2026 was found anywhere; not confirmed by a document dated for 2027. |
| `leman-pass.json` | 2027 | 2026-12-13 | **2027 prices read in the SBB shop** (passes from 04.01.2027) for the zone pass "Multizones"; passes only, per zone set. Route-priced products not modelled (see below). |

## Additions to the agreed format

- `passes.week` (Frimobil, unireso): weekly pass, as in the Mobilis grid.
- `rules.allZonesFrom` is a number only where passes and tickets share it (Frimobil 7, unireso 1).
  Onde Verte has 5 for passes and 6 for tickets: the key is left out and the `all` column starts
  after the last numbered column of each table, which is how `networks.ts` reads a grid without it.
- `previous` (Frimobil): the same sections for the grid in force until 12.12.2026.
- `extras` (Onde Verte): urban-zone and short-trip prices, which are not a number of zones.
- `discounts[].rule` (Onde Verte): a discount that is not a factor (all zones at the price of 4).
- `ages.adult`, `ages.tickets`: the other age limits of the tariff, as text.

## Frimobil (canton of Fribourg and Broye vaudoise) — tariff T651.4

| Document | URL | Validity | Taken |
| --- | --- | --- | --- |
| Price grid 2027 | https://frimobil.ch/fileadmin/user_upload/public/Abonnement/GRILLE_TARIFAIRE_FRIMOBIL_2027.pdf | "valable dès le 13 décembre 2026" (label of the link on https://frimobil.ch/abonnements/abonnement-adulte; PDF created 07.10.2026) | everything in the file |
| Price grid 2024 | https://frimobil.ch/fileadmin/user_upload/public/Abonnement/GRILLE_TARIFAIRE_FRIMOBIL_2024.pdf | "valable jusqu'au 12 décembre 2026" | `previous` |
| Tariff T651.4 | https://frimobil.ch/fileadmin/user_upload/public/Frimobil/T651.4_au_1er_juin_2026_FR.pdf | edition 01.06.2026 | rules, ages, overlap zones (1.3, 1.4), JobAbo (4.2.1); chapter 8 as a check of `previous` |
| Press release | https://frimobil.ch/fileadmin/user_upload/public/Frimobil/Actualites/Communique_de_presse_Mesures_tarifaire_decembre_2026.pdf | 31.03.2026 | "+3,8 % en moyenne" from 13.12.2026; last change December 2023 |

Prices change on 13.12.2026: yes. Annual adult 2nd class: +4.2 % (1 zone), +3.0 % to +3.7 % (2 to 6 zones), +3.3 % (7 and more).

Checks, on both grids: 21 table rows found (3 tables of 7); year = 9 × month on 28/28 cells; strictly
increasing with the number of zones on 22/22 rows; 1st / 2nd class ratio 1.62 to 1.73 on 56 cells;
reduced / full ticket ratio 0.50 to 0.77 (above one half for 1 and 2 zones, as printed). Every value
of the 2024 grid appears in chapter 8 of T651.4. The NOVA snapshot of 10.11.2026 holds exactly the
`previous` prices: 112 cells equal, none different (`../../nova/price-ladders/REPORT.md`).

Doubts:
- T651.4 8.3.1 prints 56.00 for the adult weekly pass, 3 zones, 2nd class; the 2024 grid has 59.00
  (and half of the monthly 118). The grid is taken; the tariff looks like a typing error.
- "7+" is stored as `all`. NOVA agrees (pay level "alle Zonen" from 7).
- The JobAbo entry under `discounts` is an employer scheme, not a public subsidy; no cantonal or
  communal subsidy was found on frimobil.ch.
- The junior category is "6 to 25 ans révolus" on the grid and "jusqu'à 24.99 ans" in T651.4; the
  tariff's wording is used.

## Onde Verte (canton of Neuchâtel) — tariff T651.3

| Document | URL | Validity | Taken |
| --- | --- | --- | --- |
| Tariff T651.3 | https://www.ondeverte.ch/fileadmin/pdf/T651.3_juillet_2026.pdf | "Nouvelle édition : 01.06.2026" | chapter 8 (all prices), rules, ages, overlap zones |
| Web tables | https://www.ondeverte.ch/abonnements/abonnements-onde-verte, `/abonnements/flexiabo`, `/billets/billets-individuels-et-court-parcours`, `/billets/cartes-journalieres-et-cartes-multicourses` | read 10.11.2026, undated | second source: every value of chapter 8 used here is on these pages |
| Press release | https://www.ondeverte.ch/fileadmin/pdf/ONDE_VERTE_communique-presse_2026-03-31.pdf | 31.03.2026 | "+3,9 % en moyenne" from 13.12.2026, detailed prices "ultérieurement" |
| Cantonal measures | https://www.ondeverte.ch/actualites/subvention-a-hauteur-de-66-les-abonnements-jeunes-onde-verte | read 10.11.2026 | `discounts` |

Prices change on 13.12.2026: yes, announced. **The 2027 prices were not found**: not on ondeverte.ch
(news, tariff pages, price calculator, the only edition of T651.3 linked), and the Alliance SwissPass
page "Tarife der Verbünde" only links to ondeverte.ch. transn.ch, the main operator's site, refuses
automated access (HTTP 403) and was not read. The file holds the current prices, says so, and has
`year: 2026`.

Checks: year = 9 × month on 20/20 cells; FlexiAbo = 5 × month on 20/20; never falling with the number
of zones on 20/20 rows; 1st / 2nd ratio 1.64 to 1.73; single ticket 2nd class = 2.20 per zone from 2
zones; reduced = half from 3 zones. NOVA holds the same prices: 88 cells equal, none different.

Doubts:
- `validFrom` is the edition date of the tariff; when these prices were introduced is not stated.
- The "1 - 2 zones" price is stored under `1` and `2`; passes are sold from 2 zones (`minZones.pass`),
  which the web page says and the tariff does not.
- Section numbers of T651.3 are lost in the text extraction; rules are quoted by chapter and heading.
- The discount "all zones at the price of 4 zones" is not a factor; it is stored as a `rule`.

## unireso (canton of Geneva) — tariff T651.11

| Document | URL | Validity | Taken |
| --- | --- | --- | --- |
| Tariff T651.11 (Conditions générales de vente) | https://www.unireso.com/wp-content/uploads/2026/06/CGV-unireso-Juin-2026-1.pdf | edition 01.06.2026 | chapter 9 (all prices), ages (3.2.1), Léman Pass (0.1.3, 7) |
| Web tables | https://www.unireso.com/titres-de-transport/ and https://www.tpg.ch/fr/tarifs-titres-de-transport | read 10.11.2026 | second and third source, identical |
| Leaflet "Plan de zones tarifaires" | https://www.unireso.com/wp-content/uploads/2025/12/unireso_DepliantTarifaire-12-2025_FR_Print_DEF.p-df.pdf | "Valable dès le 14.12.2025" | `validFrom`; identical prices |
| State subsidies | https://www.unireso.com/titres-de-transport/ (section "prise en charge"), https://www.unireso.com/prise-en-charge-avs-ai/, https://www.unireso.com/prise-en-charge-6-24-ans/ | read 10.11.2026 | `discounts` |

Prices change on 13.12.2026: **nothing found** on unireso.com (news, tariff page, publications),
tpg.ch or the Alliance SwissPass "Tarifmassnahmen" page. No document says the prices stay either.

One zone (zone 10 "Tout Genève"): each price is stored under `1` and `all`. The annual pass is not a
multiple of the monthly one (adult 500 / 70). NOVA holds the same prices: 36 cells equal, none different.

Not stored: "Saut de puce" (3 stops, 2.00 / 1.80), day pass from 9 a.m. (8.00 / 13.60; reduced
5.60 / 9.60), Adulte Duo (450 / 800 a year, 65 / 114 a month), Jeune famille (350 / 40),
transferable passes (900 / 1 530 a year, 100 / 170 a month, 38 / 65 a week), P+R combinations.

## Léman Pass (alliance `leman-pass`) — tariff T651.12: zone passes priced, routes not

Read: https://www.lemanpass.com/tarifs/ (10.11.2026) and T651.11 0.1.3 and 7.

- Léman Pass is the cross-border tariff of Greater Geneva. It applies to any trip across the border
  inside its perimeter that combines a route and zones (zone + route + zone), a route alone, or
  adjoining zones on both sides of the border. Origin or destination outside the perimeter: it does
  not apply.
- Zones: unireso zone 10 (Tout Genève) and French zones 200, 210, 230, 240, 250; zones 300, 380 and
  400 exist but cannot be combined in multi-zone tickets. In NOVA: plan `leman-pass-abo-amp-billett`
  (zones 10, 200, 210, 230, 240, 250), plan `leman-pass-zonen-fr` (210, 300, 380, 400).
- A zone-10 ticket plus a separate ticket for a French zone is not a valid Léman Pass ticket; unireso
  holders buy a "billet complémentaire Léman Pass" for one adjoining French zone (CHF 1.60 in 2nd class).
- Prices depend on the route and the zones (a calculator on lemanpass.com, no published table). In
  NOVA its tarifs (`419_ZONEN_*`) have 19 pay levels by named zone combination, not by number of
  zones, with price codes that carry no customer category: **no ladder from NOVA**. The prices in
  `leman-pass.json` were read in the SBB shop instead (next paragraph).
- Chêne-Bourg – Annemasse by train is sold at the Swiss national tariff; Bellegarde – Genève at the
  French TER tariff.

### What is priced (`leman-pass.json`, since 2026-11-11)

Source: 24 lookups in the SBB shop on 11.11.2026 for passes starting 04.01.2027,
`packages/engine/data/zones/sbb-checks-leman-pass/RESULTS.md` (one text file per screen next to it).

- Product: the zone pass "Léman Pass Multizones", monthly and annual. It exists only when every
  stop lies in zones 10, 200, 210, 230, 240, 250, and always includes zone 10 (`rules.always`):
  Annemasse → Gaillard is 10 + 210.
- The price depends on which zones, so the file lists prices per zone set (`passesBySet`; `like`
  names the sets that cost the same) and not per zone count. Any network file may use this form;
  the loader looks a trip's zone set up after adding the `rules.always` zones.

| Zones | Adult 2nd, year / month | Adult 1st | Youth 2nd | Read or derived |
| --- | --- | --- | --- | --- |
| 10 + one of 200, 230, 240, 250 | 781.60 / 101.30 | 1 277.90 / 166.60 | 623.60 / 69.90 | read (10 + 230 for 1st class and youth; adult 2nd also for 200, 240, 250) |
| 10 + 210 | 914.00 / 111.40 | 1 553.80 / 189.40 | 722.00 / 77.20 | read |
| 10 + 210 + one of 200, 230, 240, 250 | 1 195.60 / 142.70 | 2 032.50 / 242.60 | 944.50 / 98.90 | adult 2nd read; 1st class and youth **derived** from the 10 + 210 ratios (`derived`, shown as estimates) |

- Read cells have provenance `tariff`, derived cells `estimated`.
- Categories: the youth price runs from the 6th to the 26th birthday; seniors pay the adult price.
  The engine's age groups are child 6–15, youth 16–24, adult 25–64, senior: child and youth get
  the youth price, and **a 25-year-old is priced as an adult although the shop still gives the
  youth price**. Youth in 1st class was not read: the adult 1st class price is used, as an estimate.
- Which network: Léman Pass sells a trip that uses one of its own zones 200, 210, 230, 240, 250; a
  trip entirely inside zone 10 stays unireso (CHF 500). See `data/nova/NETWORK-ZONES.md`.

Not modelled:

- Single tickets, day passes and the "billet complémentaire" (not collected): a part-time commuter
  is only offered the monthly and the annual pass; the products carry a note saying so.
- A zone set without a price: 10 + two ring zones without 210 (e.g. Saint-Julien → Ferney, 10 + 230
  + 250; not seen in the shop) and anything with more than three zones. Such a trip is priced by
  distance with the note "inside Léman Pass: no price for this zone combination".
- Route-priced "Léman Pass" modular and point-to-point passes for stations beyond the ring: Annecy,
  Thonon, Évian, Bellegarde, La Roche-sur-Foron, Reignier, Bonneville, Valleiry (prices in
  RESULTS.md, section D). These stations are not in the NOVA zone plan, so the trips stay on the
  national distance pricing, without a note. The rail station Saint-Julien-en-Genevois (8774543)
  is not in the plan either: Saint-Julien is zone-priced from its bus stops ("Saint-Julien, gare").
- Coppet / Nyon → Genève and Annemasse → Nyon are Swiss products, not Léman Pass (unchanged).
- No FlexiAbo exists. State of Geneva subsidies are not applied.
- A traveller who walks across the border to a stop in zone 10 (Gaillard → Thônex, Moillesulaz)
  is priced unireso, as the trip is then inside zone 10.

## Sample trips (zones from the NOVA snapshot of 10.11.2026, pass plan, adult 2nd class)

Zones from `zonesForStops` on the two stops only (the snapshot joins them through the stops in
between; the real train may run another way). All zone factors are 1 in the three networks.

| Network | Trip | Zones | Count | Grid: annual / monthly | NOVA ladder (2026 tariff year) |
| --- | --- | --- | ---: | --- | --- |
| Frimobil | Romont FR → Fribourg | 10, 11, 35, 36, 44 | 5 | 2027: 1 809 / 201; until 12.12.2026: 1 755 / 195 | 1 755 / 195 |
| Frimobil | Bulle → Fribourg (via Romont) | 10, 11, 30, 31, 35, 36, 42, 43, 44 | 9 → all | 2027: 2 511 / 279; before: 2 430 / 270 | 2 430 / 270 |
| Frimobil | Estavayer-le-Lac → Fribourg | 10, 11, 50, 51, 52, 53, 57, 80, 81 | 9 → all | 2027: 2 511 / 279; before: 2 430 / 270 | 2 430 / 270 |
| unireso | Genève → Genève-Aéroport | 10 | 1 | 500 / 70 | 500 / 70 |
| unireso | Genève → Versoix | 10 | 1 | 500 / 70 | 500 / 70 |
| unireso | Genève → Chêne-Bourg | 10 | 1 | 500 / 70 | 500 / 70 |
| Onde Verte | La Chaux-de-Fonds → Neuchâtel | 10, 11, 20, 21, 30 | 5 → all | 1 548 / 172 | 1 548 / 172 |
| Onde Verte | Le Locle → Neuchâtel | 10, 11, 20, 21, 30 | 5 → all | 1 548 / 172 | 1 548 / 172 |
| Onde Verte | Fleurier → Neuchâtel | 10, 11, 30, 33 | 4 | 1 278 / 142 | 1 278 / 142 |

frimobil.ch gives the same counts in its own examples: Fribourg – Romont "il faut 5 zones";
Fribourg (zone 10) – Bulle 7 zones, "toutes zones". Estavayer-le-Lac → Fribourg was joined by the
snapshot through Payerne, Murten and Courtepin; by Payerne and Grolley the count may be lower than 9
but the pair was not checked on a real timetable.

## Refused or not obtained

- https://www.transn.ch/ : HTTP 403 to automated access; not read, not worked around.
- Alliance SwissPass, https://www.allianceswisspass.ch/de/tarife-vorschriften/uebersicht/Tarife-der-Verbuende :
  links to the networks' own sites for T651.3, T651.4, T651.11 and T651.12; no copy of its own. The
  "Tarifmassnahmen" page names none of the three networks for 13.12.2026.
- Léman Pass tariff T651.12 itself (lemanpass.com/conditions-generales): page fetched, the tariff PDF
  not looked for; the zone-pass prices were read in the SBB shop instead.
