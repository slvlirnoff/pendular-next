# NOVA snapshot against the engine's current data

Snapshot of 10.11.2026. The tables below are printed by `pnpm tsx tools/nova-import/compare.ts`;
the text is written by hand. Sources and limits of the NOVA data: `SOURCES.md`.

## Summary

**(a) Stop zones.** Our table `../zones/mobilis-stops.json` (read off the zone plan drawing)
names 1 363 station numbers; NOVA's Mobilis pass plan has 2 790 stops; 1 339 are in both.

- **86.0 % agree exactly** (1 151 stops). 11.4 % (153) overlap: one side gives a border stop two
  zones where the other gives one. **2.6 % (35) have no zone in common**; 6 of those are a
  mix-up between Lausanne's zones 11 and 12, which never changes a price. That leaves **29
  stops with a wrong zone in our table**, 5 of them marked confident (Bremblens bas du village,
  Le Solliat ×2, Les Planches (Aigle), Romanel-sur-Lausanne).
- Among the stops our table calls confident, 92.0 % agree exactly (701 of 762).
- For the 1 451 NOVA stops our table does not list, the engine's fallback (stop name, else the
  nearest drawn stops) gives the same zone for 76.5 %, a different one for 13.3 % (192 stops)
  and no answer for 7.4 %. Even where the engine calls its guess confident, 109 of 1 143 are
  in another zone than NOVA says.
- "NOVA's own zones of a stop" are the zones common to all edges at the stop. That is an
  inference: NOVA gives zones per edge, never per stop. For 145 of the 153 overlaps NOVA's
  own zone is a single one and our table lists two (the drawing shows the stop on a border;
  the edges show on which side it is sold).
- 24 station numbers are only in our table: 11 are in Geneva (Bellevue, Cologny: mis-matched
  names), 5 are in neighbouring networks, 8 have no fare edge at all in NOVA.
- The three Mobilis plans (pass, ticket, connecting ticket) carry identical zones on every edge.

NOVA is the better source for stop zones: it covers twice as many stops, needs no geometry
and no name matching, and gives the zones crossed between two stops directly, including zones
crossed without stopping (the edge Palézieux – Lausanne lists 63, 64, 19, 11, 12).

**(b) Mobilis pass prices.** NOVA holds the prices of the **2026 tariff year**; our grid
`../tariffs/mobilis-2027.json` is the one valid from 13.12.2026. NOVA carries **no validity
date and no future prices** (no date property on any price, pay level or product).

- Annual and monthly passes, 3 zones to all zones, adult / junior / senior, both classes: NOVA
  equals our grid for 3 and 4 zones and is 2 % to 4.5 % lower from 5 zones up, which is the
  increase of 13.12.2026 (adult 2nd class annual, 9 zones: 2 313 in NOVA, 2 376 in our grid).
- NOVA's values match what sbb.ch quoted on 10.11.2026 for validity in 2026
  (`../zones/REFERENCE-CHECKS.md`): 7 zones 1 989, 9 zones 2 313, 10 zones 2 376, all zones 2 475.
- How the table was obtained matters: NOVA does not say which product or zone count a zone
  price belongs to. The entries of one pay level have consecutive ids; the ten blocks around
  the three known 2026 prices were taken as the Mobilis ladder and ranked by price. **This is a
  reconstruction, not a lookup**, and it cannot be automated safely for other networks. The 1-
  and 2-zone prices (pay levels "1 Zone", "2 Zonen", "Grand Lausanne") were not located.

**(c) National distance prices.** NOVA publishes tariff kilometres but **no prices for T601
(single tickets) or T650 (route passes)**: all 297 tables named T601 … and "T650 Standard
KILOMETER" are empty.

- Single ticket, 2nd class, full fare, for 10 / 20 / 41 / 60 / 97 km: 4.60 / 8.60 / 17.20 /
  22.80 / 34.00 in our table (T601, edition 01.06.2026); nothing to compare with in NOVA.
- Route pass: the precalculated table "LEX Preistabelle DV Abo" (Léman Express, 432 prices)
  turns out to be the T650 table: **52 of our 53 distance bands are identical on all six
  columns**. The one difference, junior annual 181–190 km, is 3 582 in our table and 2 582 in
  NOVA; ours equals 9 × the monthly price (398) as T650 4.1.7 requires, so NOVA has the typo.
  This is an independent check of the table we transcribed from an image. The LEX table also
  has the band 241–250 km that our table lacks.
- Whether these are the prices valid from 13.12.2026 is not known (no date in NOVA; our table is
  the 01.06.2026 edition). See the modular-pass check in `COMBINED-TICKETS.md`, which suggests
  route-pass prices about 2 % higher for 2027.
- Tariff kilometres: Romont FR – Lausanne 41; **Lausanne – Bern 105** (69 to Fribourg + 36;
  effective 97); Yverdon – Bern 86 via Payerne and Fribourg, 91 via Neuchâtel. The engine's
  `estimatedTariffKm` should be replaced by these where a relation exists. T601 and T650
  distances differ where tickets carry a surcharge (Genève – Genève-Aéroport: 16 and 6).

## (a) Stop zones: our table against NOVA

Plan compared: `mobilis/mobilis-abo-abo` (the pass plan; the ticket and connecting-ticket plans carry the same zones on every edge in this snapshot: checked, 0 differences).

| | Stops |
| --- | ---: |
| Station numbers in our table (with a zone) | 1363 |
| Stops on Mobilis edges in NOVA | 2790 |
| In both | 1339 |
| Only in our table | 24 |
| Only in NOVA | 1451 |

| Verdict for the stops in both | Stops | Share |
| --- | ---: | ---: |
| same zones as NOVA's own zones of the stop | 1151 | 86.0 % |
| overlap (one side lists more zones: a border stop) | 153 | 11.4 % |
| different (no zone in common) | 35 | 2.6 % |
| of the non-identical ones, mix-ups inside Lausanne's zones 11/12 (no effect on the price) | 21 | |
| stops our table marks as confident: same / overlap / different | 701 / 56 / 5 of 762 | 92.0 % same |

For the 1451 NOVA stops that are not in our table, the engine answers from the stop name or from drawn stops nearby (`zonesOfStop`, coordinates from DiDok; 11 stops have none):

| Engine answer for stops outside the table | Stops | Share |
| --- | ---: | ---: |
| same zone | 1102 | 76.5 % |
| overlap | 39 | 2.7 % |
| different | 192 | 13.3 % |
| no answer | 107 | 7.4 % |
| answers the engine itself calls confident: same / overlap / different | 1003 / 31 / 109 of 1143 | 87.8 % same |

### Disagreements, stops in both (ours ≠ NOVA)

| Stop | Number | Ours | Confident | NOVA own | NOVA all edges | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| Aigle, place du Marché | 8570601 | 84 | no | 80 | 80, 81 | different |
| Bremblens, bas du village | 8570092 | 33 | yes | 32 | 32 | different |
| Chavannes-sur-Moudon, Burinaux | 8577648 | 60 | no | 103 | 60, 103 | different |
| Corsier-sur-Vevey, Omballes | 8579166 | 70 | no | 72 | 70, 72 | different |
| Corsier-sur-Vevey, Sous-Nant | 8579173 | 70 | no | 72 | 72 | different |
| Echandens, centre | 8588875 | 32 | no | 33 | 33 | different |
| Echandens, Chocolatière | 8592244 | 32 | no | 33 | 12, 15, 33 | different |
| Echandens, collège | 8595213 | 32 | no | 33 | 33 | different |
| Echandens, poste | 8588874 | 32 | no | 33 | 12, 33 | different |
| Echandens, Riaz | 8592243 | 32 | no | 33 | 33 | different |
| Ecublens VD, Parc | 8591953 | 80 | no | 12 | 12 | different |
| Ferlens VD, Le Moulin | 8570422 | 17, 57 | no | 65 | 65 | different |
| Forel (Lavaux), Grand Champ | 8582772 | 65 | no | 64 | 64 | different |
| Forel (Lavaux), La Chesaude | 8582774 | 65 | no | 64 | 64 | different |
| Forel (Lavaux), Le Plane | 8582773 | 65 | no | 64 | 64 | different |
| Gollion, En Crausaz | 8507269 | 37, 39 | no | 44 | 37, 39, 44 | different |
| Huémoz, Les Combes | 8501558 | 154 | no | 157 | 157, 158 | different |
| Le Solliat, centre | 8506061 | 118 | yes | 119 | 119 | different |
| Le Solliat, Chez le Brigadier | 8506059 | 118 | yes | 119 | 119 | different |
| Les Granges (Orbe), gare | 8595482 | 28 | no | 48 | 42, 43, 48 | different |
| Les Planches (Aigle) | 8501473 | 73 | yes | 145 | 142, 145 | different |
| Les Rasses, Bois de Ban | 8504270 | 121 | no | 120 | 120 | different |
| Les Rasses, Crêt-Junod | 8504271 | 121 | no | 120 | 120, 121 | different |
| Lonay, Gracieuse | 8592252 | 33 | no | 30 | 30, 33 | different |
| Mont-sur-Rolle, Bellefontaine | 8582676 | 28 | no | 25 | 25, 26 | different |
| Noville, La Mouniaz | 8502637 | 82 | no | 77 | 77 | different |
| Noville, Les Saviez | 8502636 | 82 | no | 77 | 77 | different |
| Noville, Pré des Fourches | 8570582 | 82 | no | 77 | 77 | different |
| Pully, Osches | 8588442 | 12 | no | 11 | 11 | different (11/12 only) |
| Pully, Roses | 8592196 | 12 | no | 11 | 11 | different (11/12 only) |
| Pully, Rosiaz | 8588434 | 12 | no | 11 | 11 | different (11/12 only) |
| Pully, Somais | 8588440 | 12 | no | 11 | 11 | different (11/12 only) |
| Pully, Vallon | 8588449 | 12 | no | 11 | 11 | different (11/12 only) |
| Pully, Verney | 8592198 | 12 | no | 11 | 11 | different (11/12 only) |
| Romanel-sur-Lausanne | 8501166 | 12, 17 | yes | 16 | 12, 16 | different |
| Allières | 8501378 | 182, 183 | yes | – | 180, 181, 182, 183 | border |
| Attalens, La Fin | 8579191 | 63, 79 | yes | 79 | 63, 79 | border |
| Attalens, Montessinge | 8510497 | 63, 79 | no | 63 | 63, 79 | border |
| Aubonne, Bougy-St-Martin | 8501865 | 28, 34 | no | 28 | 28, 34 | border |
| Aubonne, Curzilles | 8570045 | 28, 34 | no | 28 | 28, 34 | border |
| Aubonne, gare | 8501870 | 28, 34 | no | 28 | 28, 34 | border |
| Aubonne, Roveray | 8579080 | 28, 34 | no | 28 | 26, 28, 34 | border |
| Bavois | 8501113 | 43, 45 | yes | – | 43, 45, 53 | border |
| Begnins, poste | 8501851 | 92, 93 | yes | – | 92, 93 | border |
| Bollion, Mussillens | 8504725 | 106, 107 | no | – | 106, 107 | border |
| Bossonnens | 8504060 | 63, 79 | yes | – | 63, 79, 160 | border |
| Bossonnens, gare | 8579195 | 63, 79 | no | – | 63, 79, 160 | border |
| Bossonnens, route d'Oron | 8511794 | 63, 79 | no | – | 63, 79, 160 | border |
| Burier | 8501202 | 70, 73 | yes | – | 70, 73 | border |
| Bussy-sur-Moudon, La Cauderie | 8570360 | 60, 69 | no | 69 | 60, 69 | border |
| Carrouge VD, centre | 8504165 | 61, 65 | no | – | 61, 65 | border |
| Champagne, Chèzeaux | 8511686 | 122, 124 | no | 122 | 122, 124 | border |
| Champagne, collège | 8504989 | 122, 124 | no | – | 122, 124 | border |
| Champagne, Le Moulin | 8570274 | 122, 124 | no | 124 | 122, 124 | border |
| Chanéaz, village | 8507660 | 54, 56 | no | – | 54, 56 | border |
| Changins | 8501733 | 20, 23 | yes | – | 20, 23 | border |
| Châtel-St-Denis, Bellière | 8504965 | 79, 160 | no | 160 | 72, 79, 160 | border |
| Chavornay | 8501112 | 42, 43 | yes | – | 41, 42, 43, 48 | border |
| Cheiry, village | 8570383 | 102, 105 | no | 105 | 101, 105 | border |
| Chesières, cimetière | 8579130 | 156, 157 | yes | – | 156, 157 | border |
| Concise, Camp de Vaumarcus | 8573440 | 125, 126 | no | – | 125, 126 | border |
| Corseaux-Cornalles | 8504040 | 70, 71 | yes | – | 70, 71 | border |
| Corsier-sur-Vevey, Champ-Ban | 8579172 | 70 | no | – | 70, 72 | border |
| Cossonay-Penthalaz (funi) | 8593755 | 44 | no | 39, 44 | 39, 44 | border |
| Cossonay-Ville | 8530003 | 39 | yes | 39, 44 | 39, 44 | border |
| Crissier, Timonet | 8588845 | 12, 15 | no | – | 12, 15 | border |
| Cugy FR | 8504133 | 100, 106, 107 | yes | – | 100, 106 | border |
| Cugy VD, Le Moulin | 8570164 | 17, 57 | no | 17 | 17, 57 | border |
| Echallens | 8501173 | 50, 51 | yes | 50 | 50, 51 | border |
| Echichens, Signal | 8570071 | 31, 32 | yes | 31 | 30, 31, 32 | border |
| Eclépens, gare | 8570139 | 53 | no | – | 43, 44, 45, 53 | border |
| Epalinges, Giziaux | 8593821 | 12 | no | 12, 18 | 12, 18 | border |
| Epalinges, Lion d'Or | 8587546 | 12 | no | – | 12, 18 | border (11/12 only) |
| Epautheyres, croisée | 8507675 | 41, 55 | no | – | 41, 55 | border |
| Essert-sous-Champvent | 8504293 | 46, 121 | yes | – | 46, 121 | border |
| Essert-sous-Champvent, village | 8570334 | 46, 121 | no | – | 40, 46, 47, 121 | border |
| Essertes, Le Pralet | 8587545 | 62, 65 | no | 65 | 65 | border |
| Essertes, village | 8570461 | 62, 65 | no | – | 62, 65 | border |
| Etagnières | 8501171 | 16, 50 | yes | – | 16, 50 | border |
| Féchy, Auberge | 8581659 | 26, 28 | yes | 26 | 25, 26 | border |
| Fey | 8501176 | 51, 52 | yes | – | 51, 52 | border |
| Flendruz | 8501396 | 187, 188 | yes | – | 187, 188 | border |
| Forel (Lavaux), rte Industrie | 8557076 | 64, 65 | no | – | 64, 65 | border |
| Frasses | 8504721 | 106 | yes | – | 106, 107 | border |
| Givrins | 8501067 | 91, 92 | yes | – | 91, 92 | border |
| Gollion, grande salle | 8511586 | 37, 39 | no | 39 | 37, 39 | border |
| Gollion, L'Arzillier | 8507283 | 37, 39 | no | 37 | 37, 39, 44 | border |
| Gorgier-St-Aubin | 8504205 | 126 | yes | 125, 126 | 40, 123, 124, 125, 126 | border |
| Gossens, La Cernia | 8579735 | 55, 109 | no | 55 | 55, 109 | border |
| Gossens, village | 8507682 | 55, 109 | no | 109 | 55, 109 | border |
| Goumoens-la-Ville, Eclagnens | 8570189 | 51, 53 | no | 53 | 51, 53 | border |
| Goumoens-la-Ville, Tuilerie | 8570201 | 51, 53 | no | 51 | 51, 53 | border |
| Grandson | 8504201 | 123 | yes | 40, 123 | 40, 123 | border |
| Grandson, Corcelettes | 8501981 | 123, 124 | no | – | 123, 124 | border |
| Grandvaux, Pra Grana | 8588454 | 12, 19 | no | 19 | 12, 19 | border |
| Grésaley | 8501178 | 50, 51 | yes | 51 | 50, 51 | border |
| Jor | 8501386 | 180, 181 | yes | – | 180, 181 | border |
| L'Abbaye, Crêt-Blanc | 8570160 | 116, 168 | no | – | 116, 168 | border |
| La Chaudanne-Les Moulins | 8501393 | 185, 186 | yes | – | 185, 186 | border |
| La Chèvrerie-Monterêt | 8501057 | 93, 94 | yes | – | 93, 94 | border |
| La Gaité (Champtauroz) | 8570390 | 54, 105 | yes | – | 54, 105 | border |
| La Lécherette, village | 8501799 | 149, 172 | yes | – | 149, 172 | border |
| La Mauguettaz, croisée | 8507687 | 108, 109 | no | – | 108, 109 | border |
| La Tine | 8501391 | 184, 185 | yes | – | 183, 184, 185, 186 | border |
| Lausanne | 8501120 | 11, 12 | yes | 11 | 11, 12, 15, 19, 20, 23, 24, 25, 26, 30, 31, 33, 40, 41, 42, 43, 44, 45, 49, 53, 63, 64, 70, 71, 73, 110, 111, 112, 113 | border (11/12 only) |
| Lausanne, CHUV | 8592017 | 11, 12 | no | 11 | 11 | border (11/12 only) |
| Lausanne, Flon | 8591818 | 11, 12 | yes | 11 | 11 | border (11/12 only) |
| Lausanne, Malley | 8501209 | 11, 12 | no | – | 11, 12 | border (11/12 only) |
| Lausanne, Ouchy-Olympique | 8592086 | 11, 12 | no | 11 | 11 | border (11/12 only) |
| Lausanne, Sallaz | 8579238 | 11, 12 | no | – | 11, 12 | border (11/12 only) |
| Lavigny, croisée de St-Livres | 8570050 | 28, 34 | no | 34 | 28, 34 | border |
| Lavigny, hôpital | 8570088 | 28, 34 | no | 34 | 28, 34 | border |
| Le Brassus, Combe des Amburnex | 8583878 | 164, 165 | no | – | 119, 164, 165 | border |
| Le Mont-sur-L., Grand-Mont | 8504177 | 12, 17 | no | 12 | 12, 17 | border |
| Le Muids | 8501065 | 92, 93 | yes | – | 92, 93 | border |
| Le Sentier-L'Orient, gare | 8579146 | 119 | yes | – | 118, 119 | border |
| Les Avants | 8501377 | 76, 180 | yes | – | 74, 75, 76, 180, 181, 182, 183 | border |
| Les Cases | 8501387 | 181, 182 | yes | – | 181, 182 | border |
| Les Clées-La Russille, croisée | 8579100 | 112, 114 | no | – | 40, 41, 42, 48, 112, 114 | border |
| Les Diablerets | 8501479 | 147, 170 | yes | 147 | 147 | border |
| Les Esserts-de-Rive | 8501154 | 117, 118 | yes | – | 117, 118 | border |
| Les Esserts-de-Rive, gare | 8507214 | 117, 118 | no | – | 117, 118 | border |
| Les Granges-Gérignoz | 8501395 | 186, 187 | yes | – | 186, 187 | border |
| Lonay-Préverenges, gare nord | 8511344 | 12, 33 | no | 33 | 30, 33 | border |
| Lonay-Préverenges, gare sud | 8595218 | 12, 33 | no | 33 | 30, 33 | border |
| Lonay, parc | 8592254 | 32, 33 | yes | – | 30, 32, 33 | border |
| Mont-la-Ville, Le Battoir | 8570155 | 38, 115 | no | – | 38, 115, 166, 167 | border |
| Morrens VD, village | 8582065 | 16, 17 | no | – | 16, 17 | border |
| Neyruz-sur-Moudon, collège | 8581437 | 68, 69 | no | 68 | 60, 68, 69 | border |
| Ogens, village | 8570397 | 55, 56 | no | 56 | 52, 55, 56 | border |
| Oppens, croisée | 8507696 | 52, 55 | no | 55 | 52, 55 | border |
| Oppens, La Tuilière | 8581610 | 52, 55 | yes | – | 52, 55 | border |
| Pailly, Moulin-Pacot | 8502735 | 52, 55 | no | 52 | 52, 55 | border |
| Palézieux-Village | 8504016 | 62, 63 | yes | – | 62, 63 | border |
| Peney-le-Jorat, Moulin Peney | 8570346 | 58, 61 | no | – | 58, 61 | border |
| Peney-le-Jorat, poste | 8570174 | 57, 58 | no | 58 | 57, 58 | border |
| Poliez-le-Grand, Der. Le Chêne | 8570206 | 50, 51, 57 | no | 50, 51 | 50, 51, 57 | border |
| Poliez-le-Grand, La Sauvenière | 8570208 | 50, 51, 57 | no | 57 | 50, 51, 57 | border |
| Poliez-le-Grand, village | 8570207 | 50, 51, 57 | no | – | 50, 51, 57 | border |
| Poliez-Pittet, collège | 8579669 | 57, 58 | no | 57 | 51, 57, 58 | border |
| Poliez-Pittet, Grands-Champs | 8570210 | 57, 58 | no | 57 | 57, 58 | border |
| Poliez-Pittet, village | 8570212 | 57, 58 | no | – | 51, 57, 58 | border |
| Pomy, Centre Orif | 8570302 | 40, 41, 109 | no | – | 40, 41, 109 | border |
| Pont-de-Drapel | 8501179 | 80, 141 | no | 141 | 141, 142 | border |
| Prilly-Malley | 8518452 | 11, 12 | yes | 12 | 11, 12 | border (11/12 only) |
| Prilly, Chasseur | 8592175 | 11, 12 | yes | 12 | 12 | border (11/12 only) |
| Pully | 8501121 | 11, 12 | yes | – | 11, 12, 19, 64, 70, 71 | border (11/12 only) |
| Pully-Nord | 8504000 | 11, 12 | yes | – | 11, 12 | border (11/12 only) |
| Pully, gare | 8588445 | 12 | no | – | 11, 12 | border (11/12 only) |
| Pully, port | 8588439 | 12 | no | – | 11, 12 | border (11/12 only) |
| Pully, Val-Vert | 8579256 | 12 | yes | – | 11, 12 | border (11/12 only) |
| Remaufens, route du Crage | 8511793 | 160 | no | – | 79, 160 | border |
| Rennaz, centre commercial | 8570583 | 77, 81, 82 | no | 77 | 77, 81, 82 | border |
| Rennaz, hôpital | 8570584 | 77, 81, 82 | no | 77 | 77, 81, 82 | border |
| Rennaz, village | 8570585 | 77, 81, 82 | no | – | 77, 81, 82 | border |
| Rivaz | 8501126 | 64, 71 | yes | 64 | 19, 64, 71 | border |
| Rueyres-les-Prés, bif. | 8577639 | 100, 134 | no | 134 | 134 | border |
| Rueyres-les-Prés, école | 8595537 | 100, 134 | no | 134 | 100, 134 | border |
| Rueyres-les-Prés, village | 8570410 | 100, 134 | no | 134 | 100, 134 | border |
| St-Barthélemy, Champ Cadet | 8570182 | 50, 53 | no | 50 | 50, 53 | border |
| St-Barthélemy, Château | 8570184 | 50, 53 | no | 53 | 50, 53 | border |
| St-Cierges, Grande Salle | 8507960 | 56, 58, 68 | no | 58 | 56, 58, 68 | border |
| St-Cierges, La Tondiaz | 8570351 | 56, 58, 68 | no | 58 | 56, 58, 68 | border |
| St-Cierges, Transformateur | 8581512 | 56, 58, 68 | no | 56, 68 | 56, 58, 68 | border |
| St-George, village | 8501855 | 96, 162 | yes | – | 96, 162 | border |
| St-Saphorin | 8501127 | 64, 71 | yes | 71 | 64, 70, 71 | border |
| Ste-Croix | 8504298 | 120 | yes | 114, 120 | 114, 120 | border |
| Thierrens, Carron | 8570371 | 56, 68 | no | 68 | 56, 68 | border |
| Thierrens, En Tombaz | 8570317 | 56, 68 | no | 56 | 56, 68 | border |
| Thierrens, gare routière | 8581943 | 56, 68 | no | – | 52, 54, 55, 56, 68 | border |
| Thierrens, Le Planchy | 8581514 | 56, 68 | no | 68 | 56, 68 | border |
| Thierrens, poste | 8507963 | 56, 68 | no | 56 | 56, 68 | border |
| Trélex dépôt | 8510670 | 20, 91 | yes | – | 20, 91 | border |
| Treytorrens (Payerne), Nord | 8577613 | 54, 105 | no | 105 | 54, 105 | border |
| Treytorrens (Payerne), village | 8577614 | 54, 105 | no | 105 | 54, 105 | border |
| Treytorrens, Les Molliettes | 8502506 | 54, 105 | no | 105 | 54, 105 | border |
| Union-Prilly | 8501162 | 11, 12 | yes | – | 11, 12 | border (11/12 only) |
| Vers-Chez-Grosjean | 8579140 | 117, 118 | yes | – | 117, 118 | border |
| Vich, La Bichette | 8570033 | 23, 92 | no | 23 | 23, 92 | border |
| Vich, poste | 8501857 | 23, 92 | no | – | 23, 92 | border |
| Villars-sous-Champvent | 8570335 | 46, 121 | yes | 46 | 46, 121 | border |
| Villars-Tiercelin, Fontaines | 8570216 | 57, 58 | no | 58 | 57, 58 | border |
| Villars-Tiercelin, sentier H&N | 8511209 | 57, 58 | no | 57 | 18, 57, 58 | border |
| Vionnaz | 8501423 | 87, 88 | yes | – | 83, 87, 88 | border |
| Vionnaz, Crébellay | 8579371 | 87, 88 | no | 87 | 83, 87, 88 | border |
| Vionnaz, croisée d'Illarsaz | 8570616 | 87, 88 | no | – | 80, 83, 87, 88 | border |
| Vionnaz, Les Nayaz | 8579369 | 87, 88 | no | 88 | 87, 88 | border |
| Vionnaz, Village | 8504663 | 87, 88 | no | – | 83, 87, 88 | border |

### Stops only in our table (24)

Bellevue GE, mairie (8503217; NOVA: leman-pass, unireso); Bellevue GE, Mollies (8503218; NOVA: leman-pass, unireso); Bellevue GE, Roselière (8503243; NOVA: leman-pass, unireso); Buttes (8504288; NOVA: onde-verte); Vallamand (8504575); Provence, Le Couvent (8507666); Bellevue GE, Limites (8510154; NOVA: leman-pass, unireso); Bellevue GE, Rilliet (8511141; NOVA: leman-pass, unireso); Corsier-sur-Vevey, Esplanade (8512646); Romairon, Les Rochats bif. (8570271); Provence, Vuissens (8570272); Villars-Bramard, Farzin (8570485; NOVA: frimobil); Lavey-Village, Route Neuve (8570665); Pont (Veveyse), Perey-Martin (8577677; NOVA: frimobil); Cudrefin, La Sauge (8581750; NOVA: frimobil); Montagny, Les Arbognes (8581804; NOVA: frimobil); Aubonne, Pré-Baulan (8583458); Bellevue GE, Colovrex (8587048; NOVA: leman-pass, unireso); Isérables, parc (8588304); Bellevue GE, Ermitage (8592645; NOVA: leman-pass, unireso); Bellevue GE, Planet (8592648; NOVA: leman-pass, unireso); Bellevue GE, Valavran (8592649; NOVA: leman-pass, unireso); Cologny, Le-Fort (8592748; NOVA: leman-pass, unireso); Bellevue GE, Chênaie (8592930; NOVA: leman-pass, unireso)

### Engine guesses with no zone in common, stops outside the table (145; first 60)

| Stop | Number | Engine | Confident | NOVA |
| --- | --- | --- | --- | --- |
| Antagnes, Glutières | 8504687 | 157 | no | 158 |
| Antagnes, Pissot | 8508334 | 153 | no | 83 |
| Antagnes, place de la Dîme | 8504443 | 153 | no | 83 |
| Antagnes, rte d'Antagnes | 8504442 | 153 | no | 83 |
| Baulmes, Cul de Villars | 8584515 | 114 | yes | 47 |
| Bex, bif. Salaz | 8570641 | 153 | yes | 84 |
| Bex, Grand Chêne | 8510408 | 85 | no | 84 |
| Bex, La Pelouse | 8510330 | 85 | no | 84 |
| Bex, Le Chavalet | 8570640 | 153 | no | 84 |
| Bex, Les Besses | 8510331 | 85 | no | 84 |
| Bex, Les Dévens | 8570642 | 153 | yes | 84 |
| Bex, Mines de Sel | 8505919 | 153 | no | 84 |
| Bex, Pré Meuran | 8511068 | 153 | yes | 84 |
| Bex, route des Monts bif. | 8570647 | 84 | yes | 153 |
| Bex, Vasselin | 8510409 | 85 | yes | 84 |
| Blonay, Novalles | 8593911 | 72 | yes | 74 |
| Bretigny-sur-Morrens, croisée | 8570176 | 17 | no | 57 |
| Carrouge VD, Le Borgeau | 8557075 | 65 | no | 61 |
| Châbles FR, école | 8596066 | 106 | yes | 107 |
| Châbles FR, Pales | 8577610 | 106 | yes | 107 |
| Chailly-Montreux, Bonnettes | 8579205 | 74 | no | 73 |
| Cheseaux-N., gymnase d'Yverdon | 8504458 | 109 | no | 40 |
| Choëx, Champian | 8579042 | 83 | no | 86 |
| Choëx, Combasse | 8579034 | 83 | no | 86 |
| Collombey, Les Neyres Chapelle | 8575520 | 83 | yes | 86 |
| Collombey, Les Neyres Raccot | 8582434 | 83 | yes | 86 |
| Corcelles-près-Concise,village | 8507664 | 125 | no | 124 |
| Corseaux, Chatacombe | 8579155 | 72 | no | 70 |
| Corseaux, Gonelles | 8579154 | 71 | yes | 70 |
| Corsier-Vevey, Cure d'Attalens | 8504963 | 72 | no | 70 |
| Crissier, Arc-en-Ciel | 8591935 | 12 | yes | 15 |
| Crissier, Mongevon | 8595516 | 12 | yes | 15 |
| Echallens, La Fontaine | 8570301 | 50 | yes | 51 |
| Echallens, La Robellaz | 8570204 | 50 | yes | 51 |
| Echallens, Les Coulisses | 8570202 | 50 | yes | 51 |
| Echichens, Crêt | 8596052 | 32 | yes | 30 |
| Echichens, croisée | 8570097 | 31 | yes | 32 |
| Ecublens VD, Larges Pièces | 8592248 | 33 | no | 12 |
| Epalinges, Bois-de-Ban | 8593819 | 18 | no | 12 |
| Epalinges, En Praz Bin | 8591967 | 18 | no | 12 |
| Essertines-s.-Yv., Gde Salle | 8583030 | 52 | yes | 55 |
| Féchy, En Burnens | 8583527 | 25 | no | 26 |
| Frenières-sur-Bex, bif. | 8504691 | 153 | yes | 154 |
| Gland, Lignière-Dullive | 8583430 | 24 | no | 23 |
| Gland, Perron/Riant-Coteau | 8583804 | 24 | no | 23 |
| Gland, Riant-Coteau | 8581928 | 24 | no | 23 |
| Grandson, Péroset | 8507950 | 122 | yes | 123 |
| Grandvaux, Le Tronchet | 8582777 | 64 | yes | 19 |
| Jongny, Chaudette | 8504958 | 79 | yes | 72 |
| Jongny, Reposoir | 8504728 | 78 | no | 72 |
| La Lécherette,cont.de la Borne | 8501344 | 174 | no | 172 |
| La Tour-de-Peilz, gymnase | 8593962 | 73 | yes | 70 |
| Le Mont-sur-L., Etavez | 8592141 | 12 | yes | 17 |
| Les Combes | 8501388 | 154 | no | 187 |
| Les Diablerets, Commune | 8584839 | 147 | yes | 170 |
| Les Diablerets, Les Ormonts | 8584838 | 147 | yes | 170 |
| Les Diablerets, Les Vioz | 8584841 | 147 | yes | 170 |
| Les Diablerets, Lilas/Chamois | 8584842 | 147 | yes | 170 |
| Les Diablerets,parc des sports | 8584840 | 147 | yes | 170 |
| Leysin, En Crettaz | 8570629 | 145 | yes | 144 |

## (b) Mobilis pass prices

### Annual pass: NOVA (current tariff year) against our grid (valid from 2026-12-13)

10 pay-level blocks found in NOVA; ranked by price they are taken to be 3, 4 … 11 zones and all zones.

| Zones | Adult 2nd: NOVA | grid | Adult 1st: NOVA | grid | Junior 2nd: NOVA | grid | Senior 2nd: NOVA | grid | Senior 1st: NOVA | grid |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 1008 | 1008 | 1719 | 1719 | 711 | 711 | 909 | 909 | 1548 | 1548 |
| 4 | 1305 | 1305 | 2223 | 2223 | 918 | 918 | 1179 | 1179 | 2007 | 2007 |
| 5 | 1539 | 1575 | 2619 | 2682 | 1080 | 1107 | 1386 | 1422 | 2358 | 2421 |
| 6 | 1782 | 1827 | 3033 | 3114 | 1251 | 1287 | 1611 | 1647 | 2745 | 2808 |
| 7 | 1989 | 2052 | 3384 | 3492 | 1395 | 1440 | 1791 | 1854 | 3051 | 3159 |
| 8 | 2151 | 2232 | 3663 | 3798 | 1512 | 1566 | 1944 | 2016 | 3312 | 3429 |
| 9 | 2313 | 2376 | 3933 | 4041 | 1620 | 1665 | 2088 | 2142 | 3555 | 3645 |
| 10 | 2376 | 2475 | 4041 | 4212 | 1665 | 1737 | 2142 | 2232 | 3645 | 3798 |
| 11 | 2439 | 2547 | 4149 | 4338 | 1710 | 1791 | 2196 | 2295 | 3735 | 3906 |
| all | 2475 | 2583 | 4212 | 4392 | 1737 | 1809 | 2232 | 2331 | 3798 | 3969 |

10 of 50 cells equal.

### Monthly pass: NOVA (current tariff year) against our grid (valid from 2026-12-13)

10 pay-level blocks found in NOVA; ranked by price they are taken to be 3, 4 … 11 zones and all zones.

| Zones | Adult 2nd: NOVA | grid | Adult 1st: NOVA | grid | Junior 2nd: NOVA | grid | Senior 2nd: NOVA | grid | Senior 1st: NOVA | grid |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 112 | 112 | 191 | 191 | 79 | 79 | 101 | 101 | 172 | 172 |
| 4 | 145 | 145 | 247 | 247 | 102 | 102 | 131 | 131 | 223 | 223 |
| 5 | 171 | 175 | 291 | 298 | 120 | 123 | 154 | 158 | 262 | 269 |
| 6 | 198 | 203 | 337 | 346 | 139 | 143 | 179 | 183 | 305 | 312 |
| 7 | 221 | 228 | 376 | 388 | 155 | 160 | 199 | 206 | 339 | 351 |
| 8 | 239 | 248 | 407 | 422 | 168 | 174 | 216 | 224 | 368 | 381 |
| 9 | 257 | 264 | 437 | 449 | 180 | 185 | 232 | 238 | 395 | 405 |
| 10 | 264 | 275 | 449 | 468 | 185 | 193 | 238 | 248 | 405 | 422 |
| 11 | 271 | 283 | 461 | 482 | 190 | 199 | 244 | 255 | 415 | 434 |
| all | 275 | 287 | 468 | 488 | 193 | 201 | 248 | 259 | 422 | 441 |

10 of 50 cells equal.

### Our grid values looked up one by one in NOVA

| Product | Class | Values in our grid | Found in NOVA with the same class and the fitting frequency code |
| --- | --- | ---: | ---: |
| year adult | 2 | 12 | 7 (code (2.)(ABO)(140)) |
| year adult | 1 | 12 | 6 (code (1.)(ABO)(140)) |
| year junior | 2 | 12 | 10 (code (2.)(ABO)(240)) |
| year senior | 2 | 12 | 4 (code (2.)(ABO)(340)) |
| year senior | 1 | 12 | 5 (code (1.)(ABO)(340)) |
| month adult | 2 | 12 | 7 (code (2.)(ABO)(141)) |
| month adult | 1 | 12 | 6 (code (1.)(ABO)(141)) |
| month junior | 2 | 12 | 9 (code (2.)(ABO)(241)) |
| month senior | 2 | 12 | 5 (code (2.)(ABO)(341)) |
| month senior | 1 | 12 | 4 (code (1.)(ABO)(341)) |
| week adult | 2 | 12 | 7 (code (2.)(ABO)(147)) |
| week adult | 1 | 12 | 5 (code (1.)(ABO)(147)) |
| week junior | 2 | 12 | 5 (code (2.)(ABO)(247)) |
| week senior | 2 | 12 | 4 (code (2.)(ABO)(347)) |
| week senior | 1 | 12 | 4 (code (1.)(ABO)(347)) |

## (c) National distance prices

| Price table in NOVA | Unit | Prices in NOVA |
| --- | --- | ---: |
| LEX Preistabelle DV Abo | KILOMETER | 432 |
| LEX Preistabelle DV Abo (Cevared) | KILOMETER | 432 |
| LEX_DV_EB 011.00 SBB KILOMETER | KILOMETER | 0 |
| LEX_DV_EB 426.00 SNCF LEX KILOMETER | KILOMETER | 0 |
| LEX_DV_EB 738.03 TPN KILOMETER | KILOMETER | 0 |
| T601 011.00 SBB KILOMETER | KILOMETER | 0 |
| T601 011.02 SBB KILOMETER | KILOMETER | 0 |
| T650 Standard KILOMETER | KILOMETER | 0 |
| all 297 tables named T601 … | | 0 |

Route pass (T650): our table has 53 distance bands (to 240 km). "LEX Preistabelle DV Abo" has 54 bands (to 250 km). Compared on all six columns (adult year/month 2nd and 1st, junior year/month 2nd): **52 of 53 bands identical, 1 cells differ**. Differing (columns adultYear2 / adultYear1 / adultMonth2 / adultMonth1 / juniorYear2 / juniorMonth2): 181–190 km: ours 4932 / 8145 / 548 / 905 / 3582 / 398; NOVA 4932 / 8145 / 548 / 905 / 2582 / 398.

| Tariff km | Single 2nd full (ours, T601) | NOVA T601 | Route pass month adult 2nd (ours, T650) | NOVA LEX DV Abo | Route pass year adult 2nd (ours) | NOVA LEX DV Abo |
| ---: | ---: | --- | ---: | ---: | ---: | ---: |
| 10 | 4.60 | no price | 111 | 111 | 999 | 999 |
| 20 | 8.60 | no price | 178 | 178 | 1602 | 1602 |
| 41 | 17.20 | no price | 259 | 259 | 2331 | 2331 |
| 60 | 22.80 | no price | 298 | 298 | 2682 | 2682 |
| 97 | 34.00 | no price | 375 | 375 | 3375 | 3375 |
| 105 | 36.00 | no price | 385 | 385 | 3465 | 3465 |

Bands of the LEX table beyond our table:

| km | Adult year 2nd | Adult year 1st | Adult month 2nd | Adult month 1st | Junior year 2nd | Junior month 2nd |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 241-250 | 5976 | 9864 | 664 | 1096 | 4338 | 482 |

Tariff kilometres of the test trips (NOVA relations):

| Trip | Stops given | T601 km | T650 km | Effective km | Parts |
| --- | --- | ---: | ---: | ---: | --- |
| Romont FR – Lausanne | Romont FR → Lausanne | 41 | 41 | 41 | Romont FR–Lausanne 41 [Genève-Aéroport / Chêne-Bourg (fr) - Lausanne - Fribourg] |
| Lausanne – Fribourg – Bern | Lausanne → Fribourg/Freiburg → Bern | 105 | 105 | 97 | Lausanne–Fribourg/Freiburg 69 [Genève-Aéroport / Chêne-Bourg (fr) - Lausanne - Fribourg]; Fribourg/Freiburg–Bern 36 [Fribourg - Bern - Thun / Olten] |
| Yverdon – Payerne – Fribourg – Bern | Yverdon-les-Bains → Payerne → Fribourg/Freiburg → Bern | 86 | 86 | 81 | Yverdon-les-Bains–Fribourg/Freiburg 50 [Yverdon - Payerne - Fribourg / Palézieux / Murten]; Fribourg/Freiburg–Bern 36 [Fribourg - Bern - Thun / Olten] |
| Yverdon – Neuchâtel – Bern | Yverdon-les-Bains → Neuchâtel → Bern | 91 | 91 | 79 | Yverdon-les-Bains–Neuchâtel 37 [Lausanne - Biel - Olten]; Neuchâtel–Bern 54 [Neuchâtel - Kerzers - Bern] |
| Genève – Genève-Aéroport | Genève → Genève-Aéroport | 16 | 6 | 6 | Genève–Genève-Aéroport 6 [Genève-Aéroport / Chêne-Bourg (fr) - Lausanne - Fribourg] |
