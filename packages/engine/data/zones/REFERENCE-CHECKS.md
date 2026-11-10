# Zone checks against SBB's shop

Manual comparisons of Pendular's zone sets with what sbb.ch offers for a Mobilis annual pass.
Prices on sbb.ch are those valid on the day of the check; Pendular uses the grid valid from
13.12.2026, so prices differ while zone counts must agree.

| Date | Trip | Route | SBB zones | SBB price that day | Pendular zones | Pendular price (grid from 13.12.2026) |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-11-10 | Lucens → Lausanne | via Epalinges, Croisettes (bus 361 + m2) | 7: 11, 12, 18, 60, 61, 65, 103 | CHF 1989 | 7 | CHF 2052 |
| 2026-11-10 | Lucens → Lausanne | direct (train R8/R9) | 9: 11, 12, 19, 60, 61, 62, 63, 64, 103 | CHF 2313 | 9 | CHF 2376 |
| 2026-11-10 | Lucens → Lausanne, validity from 04.01.2027 | via Epalinges, Croisettes | 7 | CHF 2052 | 7 | CHF 2052 |
| 2026-11-10 | Lucens → Lausanne, validity from 04.01.2027 | direct | 9 | CHF 2376 | 9 | CHF 2376 |
| 2026-11-10 | Echallens → Lausanne, Flon, validity from 04.01.2027 | direct (LEB) | 4: 11, 12, 16, 50 | CHF 1305 | 4 | CHF 1305 |
| 2026-11-10 | Chapelle-sur-Moudon, poste → Lausanne, validity from 04.01.2027 | via Epalinges, Croisettes (bus 435 + m2) | 5: 11, 12, 18, 57, 58 | CHF 1575 | 5 | CHF 1575 |

For Chapelle-sur-Moudon SBB also offers 6 zones via Sugnens or Poliez-Pittet (CHF 1827), 8 zones via
Thierrens – Bercher – Lausanne, Flon (CHF 2232), 10 zones via Thierrens – Moudon (CHF 2475) and
11 zones with a connecting ticket for zone 71 (CHF 2547). FlexiAbo 100 days: from CHF 725
(Echallens) and CHF 875 (Chapelle), equal to the grid's 4- and 5-zone prices.

With a validity date in the 2027 tariff year the prices agree to the franc; SBB also shows all
zones at CHF 2583 and FlexiAbo 100 days from CHF 1140, both equal to the grid used by Pendular.

Also shown by SBB for the same trip (validity 10.11.2026): 10 zones "via billet de raccordement avec zone 71" (CHF 2376)
and all zones (CHF 2475); FlexiAbo 100 days from CHF 1105.

What the check taught:
- Lausanne's zones 11 and 12 are always counted together.
- The train crosses zone 19 between Puidoux and Lausanne without stopping; it counts.
- SBB prices the pass per route; the cheaper route (via Epalinges) is the default offer.

## Lovatens → EPFL (10.11.2026, validity from 04.01.2027)

| Trip as entered on sbb.ch | SBB offer | SBB price | Pendular |
| --- | --- | --- | --- |
| Lovatens, village → Ecublens VD, EPFL | Mobilis, 7 zones via Moudon, gare – Epalinges, Croisettes – Lausanne, Flon (11, 12, 18, 60, 61, 65, 103) | CHF 2052 | 7 zones, CHF 2052 (bus 361 + m2 + m1) |
| same | Mobilis, 9 zones via Lucens – Renens VD, gare (11, 12, 19, 60, 61, 62, 63, 64, 103) | CHF 2376 | 9 zones, CHF 2376 (bus 475 + R8/R9 + m1) |
| same | Mobilis, 11 zones via Lucens – Palézieux or Servion | CHF 2547 | not offered |
| Lovatens, village → EPFL via Romont FR | Abo modulable via bus Prévonloup – Romont, incl. Lausanne zones 11, 12 | CHF 2660 | after the fix: route pass estimate CHF 2628 (55 tariff km, distance table); before: wrongly Mobilis 9 zones, CHF 2376 |
| same | Abonnement de parcours | from CHF 2637 | – |
| Romont FR → Ecublens VD, EPFL | Abo modulable incl. Lausanne zones 11, 12 | CHF 2553 | after the fix: route pass estimate CHF 2628 (about 5 % above SBB's route pass at CHF 2511) |
| same | Abonnement de parcours | from CHF 2511 | – |

Lessons:
- Lovatens and Lucens are in the same zone (103); the route decides the price, not the first stop.
- Romont FR is in the canton of Fribourg, outside Mobilis. Trips through it are sold as a route pass,
  or as an "abo modulable" (route pass plus the zones of Lausanne). The modulable pass is not
  modelled yet.
- Last trip home on 04.01.2027: bus 475 from Lucens at 19:19, Lovatens 19:32.

## Cross-border zones (10.11.2026, validity from 04.01.2027)

| Trip | SBB offer | SBB price | Pendular |
| --- | --- | --- | --- |
| Estavayer-le-Lac → Yverdon-les-Bains | Mobilis, 6 zones via direct (40, 54, 106, 107, 108, 109) | CHF 1827 | 6 zones, CHF 1827 (S30/S31; zones 54 and 109 crossed without a stop) |
