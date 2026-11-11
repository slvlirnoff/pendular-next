# Which zones are a network's own

Written by `tools/nova-import/derive.ts` on 2026-11-11 with `network-zones.json`; do not edit.

## The question

Where two fare networks overlap, both have a zone over the same stops (Lucens: Mobilis 103 and Frimobil 45). A trip inside such a zone belongs to one of them only; the other network's zone there merely lets its own trips reach across. `own: false` marks a zone a network may use only together with one of its own zones.

## The rule, and how far it goes

- NOVA gives zones per edge. A stop is put in the zones all its edges share, or in every zone its edges use when they share none. The area of a zonal network is its largest pass plan that is not a joint plan.
- partnerShare: share of the zone's stops that are also stops of one other zonal network (the one with most). Below 0.8: the zone is the network's own.
- From 0.8: the zone and the partner's zone cover the same ground, and the stops cannot say whose it is. The rule then gives it to the network that has more stops of its own (served by no other zonal network) in the canton where most of the zone's stops lie.
- Where the tariff of one of the two networks names the tariff that applies inside the shared zone (tools/nova-import/zone-primacy.json), that decides `own`; `ownByRule` keeps what the rule said.
- Zones of joint products (umbrellas) are own only where no zonal network covers them.

**The stops alone do not answer the question.** Overlap zones mirror each other: the two networks' zones hold the same stops, so the share is high on both sides. Who has primacy is a decision written in the tariffs. The canton rule is a guess for zones no tariff we read covers: on the 57 zones where a tariff names the answer it is right for 41 and wrong for 16:

- frimobil 14 (Flamatt): tariff says libero, rule says own
- frimobil 51 (Avenches): tariff says frimobil, rule says not own
- frimobil 58 (Montmagny): tariff says frimobil, rule says not own
- frimobil 81 (Payerne): tariff says frimobil, rule says not own
- frimobil 86 (Vuissens): tariff says frimobil, rule says not own
- frimobil 87 (Châtonnaye): tariff says frimobil, rule says not own
- frimobil 95 (Perrey): tariff says mobilis, rule says own
- mobilis 79 (Châtel-Saint-Denis): tariff says mobilis, rule says not own
- mobilis 100 (Payerne): tariff says frimobil, rule says own
- mobilis 105 (Combremont-le-Petit, poste): tariff says frimobil, rule says own
- mobilis 130 (Avenches): tariff says frimobil, rule says own
- mobilis 132 (Montmagny): tariff says frimobil, rule says own
- mobilis 135 (Châtonnaye): tariff says frimobil, rule says own
- mobilis 182 (Allières): tariff says frimobil, rule says own
- mobilis 183 (Montbovon): tariff says frimobil, rule says own
- unireso 10 (Genève): tariff says unireso, rule says not own

A second guess was tried and not kept: counting the edges from the zone to stops only one of the two networks serves. It was right on about as many of the same zones, and wrong on other ones.

Zones decided by a tariff have `basis: "tariff"`; all others `basis: "rule"` and deserve a look when a network pair matters (list the zones with `partnerShare` ≥ 0.8).

## Tariffs read, and open cases

- T651.22: Mobilis, Règlement tarifaire T651.22, 'dès le 01.06.2025', https://www.mobilis-vaud.ch/download/reglement-tarifaire-t651-22/ (fetched 2026-11-10)
- T651.4: Frimobil, Tarif T651.4, edition 01.06.2026, https://frimobil.ch/fileadmin/user_upload/public/Frimobil/T651.4_au_1er_juin_2026_FR.pdf (fetched 2026-11-10)
- T651.3: Onde Verte, Tarif T651.3, edition 01.06.2026, https://www.ondeverte.ch/fileadmin/pdf/T651.3_juillet_2026.pdf (fetched 2026-11-10)
- T651.11: unireso, Conditions générales de vente T651.11, edition 01.06.2026, https://www.unireso.com/wp-content/uploads/2026/06/CGV-unireso-Juin-2026-1.pdf (read 2026-11-10); confirmed in the SBB shop on 2026-11-11 (packages/engine/data/zones/sbb-checks-leman-pass/RESULTS.md)

- Open: onde-verte 31 (La Ferrière/Sonvilier) and 66 (Cormoret/Chasseral), shared with Libero: T651.3 names only zones 42 and 65 as overlap zones 'sans primauté tarifaire' of Onde Verte, which suggests 31 and 66 are Onde Verte's own; no table says so and the Libero tariff T651.10 was not read. Left to the rule (not own).
- Open: libero 697 (Kerzers), all of its stops also Frimobil stops (zone 56): not in the list of T651.4 1.3.1; the Libero tariff T651.10 was not read. Left to the rule (not own).
- Open: mobilis 182 and 183 hold Les Avants, which Frimobil does not serve; they are marked not own because both tariffs give Frimobil the trips inside the shared part (Frimobil 23, 24).
- Open: Every other pair of networks (Libero, A-Welle, Passepartout, Zug, Schwyz, Ostwind, ZVV, Vagabond ...): no tariff read; flags come from the rule alone.

## Networks

- Zonal networks (they have a pass plan; the plan taken as their area): a-welle (`a-welle-abo-amp-billett`), arcobaleno (`arcobaleno-abo-abo`), bs (`sierre-siders-abo-amp-billett`), engadin-mobil (`oberengadin-abo`), frimobil (`frimobil-billett-amp-abo`), leman-pass (`leman-pass-abo-amp-billett`), li-emobil (`li-emobil-abo-amp-billett`), libero (`libero-abo-abo-libero`), mobilis (`mobilis-abo-abo`), onde-verte (`onde-verte-abo-abo`), ostwind (`ostwind-abo`), passepartout (`passepartout-abo-abo`), tarifverbund-davos (`davos-abo-amp-billett`), tarifverbund-klosters (`klosters-abo-amp-billett`), tarifverbund-schwyz (`schwyzerpass-abo-amp-billett`), tarifverbund-zug (`zugerpass-abo-amp-billett`), tnw (`tnw-abo`), transreno (`transreno-abo-amp-billett`), unireso (`unireso-abo-amp-billett-zone-10`), vagabond (`vagabond-abo`), zvv (`zvv-abo-amp-billett`).
- Joint products, never counted as "another network": **z-pass-a-welle-zvv** (joint pass ZVV + A-Welle: every stop is also a ZVV or A-Welle stop); **z-pass-ostwind-zvv** (joint pass ZVV + Ostwind: every stop is also a ZVV or Ostwind stop); **z-pass-tv-schwyz-zug-zvv** (joint pass ZVV + Schwyz/Zug: every stop is also a ZVV, Schwyz or Zug stop); **bodensee-ticket-bahn-bus-fahre** (tourist day ticket around Lake Constance over Ostwind, Vorarlberg, Liechtenstein and German networks; no pass plan).
- Alliances without a pass plan in the snapshot (local or foreign tariffs; listed in the file with no zones, not counted as neighbours): bcs, bum, communaute-de-communes-pays-d-evian-vallee-d-abondance, pag, regio-verkehrsverbund-lorrach, tarifverbund-waldshut, tpc, vbd, vhb, vvv.
- Joint plans inside a zonal network (a combined pass with a neighbour, the plan of a former network) are in the file with their zones but are not the network's area.
- Passepartout, TNW, Ostwind, A-Welle and the like are zonal networks, not umbrellas: they have zones and prices of their own.
- Léman Pass is a zonal network too, not an umbrella: its French ring zones 200, 210, 230, 240 and 250 are its own, and it sells every trip that uses one of them. Its zone 10 lies over unireso's zone 10; the tariff gives the trips entirely inside it to unireso (zone-primacy.json, T651.11), so Léman Pass 10 is `own: false` and unireso 10 `own: true` although the stops are the same. Zone 10 is part of every Léman Pass zone pass all the same: the price file adds it (`rules.always` in data/tariffs/networks/leman-pass.json).

## Zones to check by hand

Every zone of one network of the pair that holds stops of the other. Columns: stops of the zone, share of them the other network serves, cantons of the stops, what the rule says, what a tariff says, the flag written.

### Mobilis and Frimobil

| Network | Zone | Stops | Shared with | Cantons | Rule | Tariff | Flag |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| mobilis | 54 Molondin, village | 21 | frimobil 10 % | VD 21 | own | – | **own** |
| mobilis | 60 Moudon | 19 | frimobil 100 % | VD 19 | own | mobilis (T651.22 1.2.1.2; T651.4 1.4.1) | **own** |
| mobilis | 61 Vuliens | 17 | frimobil 12 % | FR 2, VD 15 | own | – | **own** |
| mobilis | 62 Châtillens/Oron | 27 | frimobil 100 % | VD 21, FR 6 | own | mobilis (T651.22 1.2.1.2; T651.4 1.4.1) | **own** |
| mobilis | 63 Palézieux | 29 | frimobil 100 % | VD 16, FR 13 | own | mobilis (T651.22 1.2.1.2; T651.4 1.4.1) | **own** |
| mobilis | 65 Mezières | 36 | frimobil 3 % | VD 36 | own | – | **own** |
| mobilis | 69 Oulens-sur-Lucens | 7 | frimobil 43 % | VD 7 | own | – | **own** |
| mobilis | 72 St-Légier Gare | 37 | frimobil 35 % | VD 37 | own | mobilis (T651.22 1.2.1.2; T651.4 1.4.1) | **own** |
| mobilis | 79 Châtel-Saint-Denis | 11 | frimobil 91 % | FR 10, ? 1 | not own | mobilis (T651.22 1.2.1.2; T651.4 1.4.1) | **own** |
| mobilis | 100 Payerne | 36 | frimobil 100 % | VD 25, FR 11 | own | frimobil (T651.22 1.2.1.2) | **not own** |
| mobilis | 102 Henniez | 13 | frimobil 15 % | VD 8, FR 5 | own | – | **own** |
| mobilis | 103 Lucens | 17 | frimobil 100 % | VD 17 | own | mobilis (T651.22 1.2.1.2; T651.4 1.4.1) | **own** |
| mobilis | 105 Combremont-le-Petit, poste | 19 | frimobil 100 % | VD 11, FR 8 | own | frimobil (T651.22 1.2.1.2) | **not own** |
| mobilis | 106 Estavayer-le-Lac | 27 | frimobil 100 % | FR 27 | not own | frimobil (T651.22 1.2.1.2) | **not own** |
| mobilis | 107 Cheyres | 21 | frimobil 100 % | FR 20, VD 1 | not own | frimobil (T651.22 1.2.1.2) | **not own** |
| mobilis | 130 Avenches | 27 | frimobil 100 % | FR 4, VD 23 | own | frimobil (T651.22 1.2.1.2) | **not own** |
| mobilis | 131 Domdidier | 8 | frimobil 100 % | FR 8 | not own | frimobil (T651.22 1.2.1.2) | **not own** |
| mobilis | 132 Montmagny | 20 | frimobil 100 % | VD 20 | own | frimobil (T651.22 1.2.1.2) | **not own** |
| mobilis | 133 Portalban | 15 | frimobil 100 % | FR 13, VD 2 | not own | frimobil (T651.22 1.2.1.2) | **not own** |
| mobilis | 134 Grandcour | 21 | frimobil 100 % | FR 13, VD 8 | not own | frimobil (T651.22 1.2.1.2) | **not own** |
| mobilis | 135 Châtonnaye | 17 | frimobil 100 % | VD 11, FR 6 | own | frimobil (T651.22 1.2.1.2) | **not own** |
| mobilis | 160 Châtel | 20 | frimobil 95 % | FR 19, ? 1 | not own | frimobil (T651.22 1.2.1.2 and 1.2.1.3; T651.4 1.4.1) | **not own** |
| mobilis | 161 Les Paccots | 10 | frimobil 100 % | FR 10 | not own | frimobil (T651.22 1.2.1.2 and 1.2.1.3; T651.4 1.4.1) | **not own** |
| mobilis | 180 Jor | 3 | frimobil 33 % | VD 2, FR 1 | own | – | **own** |
| mobilis | 181 Les Cases | 4 | frimobil 50 % | VD 2, FR 2 | own | – | **own** |
| mobilis | 182 Allières | 3 | frimobil 67 % | VD 1, FR 2 | own | frimobil (T651.22 1.2.1.2 and 1.2.1.3; T651.4 1.4.1) | **not own** |
| mobilis | 183 Montbovon | 5 | frimobil 60 % | FR 3, VD 2 | own | frimobil (T651.22 1.2.1.2 and 1.2.1.3; T651.4 1.4.1) | **not own** |
| frimobil | 22 Albeuve | 4 | mobilis 25 % | FR 4 | own | – | **own** |
| frimobil | 23 Les Cases | 3 | mobilis 100 % | FR 3 | own | frimobil (T651.4 1.4.1; T651.22 1.2.1.2 (T651.4 pairs 23 with 182 and 24 with 183, T651.22 the other way round; the tariff named is the same)) | **own** |
| frimobil | 24 Les Cases | 2 | mobilis 100 % | FR 2 | own | frimobil (T651.4 1.4.1; T651.22 1.2.1.2 (T651.4 pairs 23 with 182 and 24 with 183, T651.22 the other way round; the tariff named is the same)) | **own** |
| frimobil | 40 Châtel-Saint-Denis | 17 | mobilis 94 % | FR 17 | own | frimobil (T651.4 1.4.1; T651.22 1.2.1.2 (T651.4 pairs 23 with 182 and 24 with 183, T651.22 the other way round; the tariff named is the same)) | **own** |
| frimobil | 44 Romont | 32 | mobilis 13 % | FR 27, VD 5 | own | – | **own** |
| frimobil | 45 Sarzens | 17 | mobilis 100 % | VD 17 | not own | mobilis (T651.4 1.4.1; T651.22 1.2.1.2) | **not own** |
| frimobil | 46 Vauderens/Porsel | 26 | mobilis 8 % | FR 26 | own | – | **own** |
| frimobil | 47 Chavannes-s.M. | 21 | mobilis 100 % | VD 21 | not own | mobilis (T651.4 1.4.1; T651.22 1.2.1.2) | **not own** |
| frimobil | 49 Les Paccots | 10 | mobilis 100 % | FR 10 | own | frimobil (T651.4 1.4.1; T651.22 1.2.1.2 (T651.4 pairs 23 with 182 and 24 with 183, T651.22 the other way round; the tariff named is the same)) | **own** |
| frimobil | 50 Murten | 30 | mobilis 7 % | FR 25, BE 3, VD 2 | own | – | **own** |
| frimobil | 51 Avenches | 27 | mobilis 100 % | FR 4, VD 23 | not own | frimobil (T651.22 1.2.1.2 (not listed in T651.4)) | **own** |
| frimobil | 54 Sugiez/La Sauge | 14 | mobilis 14 % | FR 11, VD 3 | own | – | **own** |
| frimobil | 57 Domdidier | 10 | mobilis 80 % | FR 10 | own | frimobil (T651.22 1.2.1.2 (not listed in T651.4)) | **own** |
| frimobil | 58 Montmagny | 21 | mobilis 100 % | VD 21 | not own | frimobil (T651.22 1.2.1.2 (not listed in T651.4)) | **own** |
| frimobil | 59 Portalban | 15 | mobilis 100 % | FR 13, VD 2 | own | frimobil (T651.22 1.2.1.2 (not listed in T651.4)) | **own** |
| frimobil | 80 Estavayer-le-Lac | 29 | mobilis 100 % | FR 29 | own | frimobil (T651.22 1.2.1.2 (not listed in T651.4)) | **own** |
| frimobil | 81 Payerne | 36 | mobilis 100 % | VD 25, FR 11 | not own | frimobil (T651.22 1.2.1.2 (not listed in T651.4)) | **own** |
| frimobil | 84 Grandcour | 21 | mobilis 100 % | FR 13, VD 8 | own | frimobil (T651.22 1.2.1.2 (not listed in T651.4)) | **own** |
| frimobil | 85 Ménières/Cheyres | 21 | mobilis 100 % | FR 20, VD 1 | own | frimobil (T651.22 1.2.1.2 (not listed in T651.4)) | **own** |
| frimobil | 86 Vuissens | 19 | mobilis 100 % | VD 11, FR 8 | not own | frimobil (T651.22 1.2.1.2 (not listed in T651.4)) | **own** |
| frimobil | 87 Châtonnaye | 17 | mobilis 100 % | VD 11, FR 6 | not own | frimobil (T651.22 1.2.1.2 (not listed in T651.4)) | **own** |
| frimobil | 92 Oron | 29 | mobilis 97 % | VD 21, FR 8 | not own | mobilis (T651.4 1.4.1; T651.22 1.2.1.2) | **not own** |
| frimobil | 93 Palézieux | 29 | mobilis 100 % | VD 16, FR 13 | not own | mobilis (T651.4 1.4.1; T651.22 1.2.1.2) | **not own** |
| frimobil | 94 La Chaux | 13 | mobilis 100 % | VD 13 | not own | mobilis (T651.4 1.4.1; T651.22 1.2.1.2) | **not own** |
| frimobil | 95 Perrey | 6 | mobilis 100 % | FR 6 | own | mobilis (T651.4 1.4.1; T651.22 1.2.1.2) | **not own** |

### Mobilis and unireso / Léman Pass

| Network | Zone | Stops | Shared with | Cantons | Rule | Tariff | Flag |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| mobilis | 90 Chavannes-de-Bogis | 8 | unireso 13 %, leman-pass 13 % | VD 8 | own | – | **own** |
| unireso | 10 Genève | 789 | mobilis 0 %, leman-pass 100 % | ? 8, GE 780, VD 1 | not own | unireso (T651.11 1.1.2: the unireso tariff applies to trips entirely inside zone 10; Léman Pass (T651.12) only across the border (T651.11 7.1)) | **own** |
| leman-pass | 10  | 795 | mobilis 0 %, unireso 99 % | GE 780, ? 14, VD 1 | not own | unireso (T651.11 1.1.2 and 7.1: zone 10 is part of every Léman Pass zone pass but a trip inside it is unireso's; Léman Pass sells the trips that use one of its French zones 200, 210, 230, 240, 250) | **not own** |
| leman-pass | 210  | 128 | unireso 1 % | ? 127, GE 1 | own | – | **own** |
| leman-pass | 230  | 38 | unireso 8 % | ? 37, GE 1 | own | – | **own** |

### Mobilis and Onde Verte

| Network | Zone | Stops | Shared with | Cantons | Rule | Tariff | Flag |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| mobilis | 125 Concise | 15 | onde-verte 13 % | VD 14, NE 1 | own | – | **own** |
| mobilis | 126 Vaumarcus | 25 | onde-verte 96 % | NE 24, VD 1 | not own | onde-verte (T651.22 1.2.2.2 (zone 15 'partiel')) | **not own** |
| mobilis | 127 Buttes | 11 | onde-verte 100 % | NE 11 | not own | onde-verte (T651.22 1.2.2.2 (zone 15 'partiel')) | **not own** |
| onde-verte | 11 Ringzone Neuchâtel | 119 | mobilis 1 % | NE 117, BE 1, ? 1 | own | – | **own** |
| onde-verte | 15 Vaumarcus | 27 | mobilis 89 % | NE 26, VD 1 | own | onde-verte (T651.22 1.2.2.2) | **own** |
| onde-verte | 33 Fleurier | 61 | mobilis 18 % | NE 61 | own | onde-verte (T651.22 1.2.2.2) | **own** |

### Frimobil and Libero

| Network | Zone | Stops | Shared with | Cantons | Rule | Tariff | Flag |
| --- | --- | ---: | --- | --- | --- | --- | --- |
| frimobil | 13 Bösingen/Schmitten | 22 | libero 32 % | FR 19, BE 2, ? 1 | own | – | **own** |
| frimobil | 14 Flamatt | 26 | libero 92 % | FR 18, BE 7, ? 1 | own | libero (T651.4 1.3.1) | **not own** |
| frimobil | 15 Heitenried | 8 | libero 13 % | FR 8 | own | – | **own** |
| frimobil | 16 Schwarzenburg | 4 | libero 100 % | FR 1, BE 3 | not own | libero (T651.4 1.3.1) | **not own** |
| frimobil | 27 Jaun | 8 | libero 25 % | FR 6, BE 2 | own | – | **own** |
| frimobil | 55 Ins | 4 | libero 100 % | BE 4 | not own | libero (T651.4 1.3.1) | **not own** |
| frimobil | 56 Kerzers | 26 | libero 46 % | FR 26 | own | – | **own** |
| libero | 627 Schwarzenburg | 23 | frimobil 17 % | BE 22, FR 1 | own | libero (T651.4 1.3.1) | **own** |
| libero | 696 Ins | 11 | frimobil 36 % | BE 11 | own | libero (T651.4 1.3.1) | **own** |
| libero | 697 Kerzers | 12 | frimobil 100 % | FR 12 | not own | – | **not own** |
| libero | 698 Gümmenen | 29 | frimobil 10 % | BE 28, FR 1 | own | – | **own** |
| libero | 699 Flamatt/Rosshäusern | 29 | frimobil 79 % | FR 16, BE 12, ? 1 | own | libero (T651.4 1.3.1) | **own** |
| libero | 842  | 20 | frimobil 10 % | BE 20 | own | – | **own** |
