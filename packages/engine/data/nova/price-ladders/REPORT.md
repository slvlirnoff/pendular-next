# Price ladders read from NOVA: report of the last run

Written by `tools/nova-import/derive.ts` on 2026-11-10; do not edit. What the files are and how far to trust them: `README.md`.

## Matching zone price entries with pay levels

- entries: 23859
- entriesWithoutPrice: 47
- blocks: 4735
- payLevels: 4735
- tarifs: 837
- widestGapInsideBlock: 17
- narrowestGapBetweenBlocks: 41
- tarifsTested: 595
- tarifsOfWrongKind: 473_SCHULKLASSE

## Alliances

| Alliance | Confidence | Annual | Monthly | Single | Day pass | Checked against | Remarks |
| --- | --- | --- | --- | --- | --- | --- | --- |
| a-welle | partial | 435_JABO (8) | 435_MABO (8) | 435_EB (8) | 435_TK (8) | – | assumption on levels that are not a number of zones: single |
| arcobaleno | partial | 464_JABO_SP (8) | 464_MABO_SP (8) | 463_EB (8) | 463_TK (8) | – | assumption on levels that are not a number of zones: single |
| bcs | partial | – | SION_ABONNEMENTS_MENSUELS (3) | SION_BILLETS_INDIVIDUELS (3) | 765_TK (3) | – | year: 765_SION_2EME_ENFANT_ANNUEL not usable (a pay level without adult price) |
| bodensee-ticket-bahn-bus-fahre | – | | | | | | no pass ladder: dayPass: 508_BOTIC_1_TAG not usable (entries with a code that is not understood) |
| bs | – | | | | | | no pass ladder: no standard annual or monthly pass with zone prices on its plans |
| bum | – | | | | | | no pass ladder: no standard annual or monthly pass with zone prices on its plans |
| communaute-de-communes-pays-d-evian-vallee-d-abondance | – | | | | | | no pass ladder: no standard annual or monthly pass with zone prices on its plans |
| engadin-mobil | – | | | | | | no pass ladder: year: 475_JABO not usable (no pay level by number of zones); month: 475_MABO not usable (no pay level by number of zones) |
| frimobil | validated | 484_JABO (7) | 484_MABO (7) | 484_EB (7) | 484_TK (7) | tariffs/networks/frimobil.json (previous): 112 cells equal, 0 different |  |
| leman-pass | – | | | | | | no pass ladder: year: 419_ZONEN_JABO not usable (entries with a code that is not understood); month: 419_ZONEN_MABO not usable (entries with a code that is not understood); single: 419_ZONEN_EB not usable (no pay level by number of zones); dayPass: 419_ZONEN_TK not usable (no pay level by number of zones) |
| li-emobil | – | | | | | | no pass ladder: no standard annual or monthly pass with zone prices on its plans |
| libero | partial | 477_JABO (10) | 477_MABO (10) | 470_EB (15) | 470_TK (15) | – | assumption on levels that are not a number of zones: single, dayPass |
| mobilis | validated | 450_ZT_72484 (12) | 450_ZT_72478 (12) | 449_EB (15) | 449_TK (15) | tools/nova-import/ladder-reference.json: 6 cells equal, 0 different | assumption on levels that are not a number of zones: year, month, single, dayPass |
| onde-verte | validated | 441_JABO (5) | 441_MABO (5) | 436_EB (6) | 436_24H (6) | tariffs/networks/onde-verte.json: 88 cells equal, 0 different | assumption on levels that are not a number of zones: single, dayPass |
| ostwind | partial | 452_JABO (8) | 452_MABO (8) | 452_EB (13) | 452_TK (13) | – | assumption on levels that are not a number of zones: year, month, single, dayPass |
| pag | – | | | | | | no pass ladder: no standard annual or monthly pass with zone prices on its plans |
| passepartout | partial | 474_JABO (7) | 474_MABO (7) | 473_EB1 (13) | – | – | assumption on levels that are not a number of zones: year, month, single |
| regio-verkehrsverbund-lorrach | – | | | | | | no pass ladder: no standard annual or monthly pass with zone prices on its plans |
| tarifverbund-davos | consistent | 740_JABO (3) | 740_MABO (3) | 412_EB (5) | 412_TK (4) | – |  |
| tarifverbund-klosters | consistent | 417_JABO (2) | 417_MABO (2) | 417_EB (2) | 417_TK (2) | – |  |
| tarifverbund-schwyz | consistent | 451_JABO (5) | 451_MABO (5) | 451_EB (6) | 451_TK (6) | – |  |
| tarifverbund-waldshut | – | | | | | | no pass ladder: no standard annual or monthly pass with zone prices on its plans |
| tarifverbund-zug | consistent | 431_JABO (5) | 431_MABO (5) | 431_EB (5) | 431_TK (5) | – |  |
| tnw | partial | 460_JABO_AW_PERS (2) | 460_MABO_AW_PERS (2) | 460_EB (8) | 460_TK (2) | – | assumption on levels that are not a number of zones: single |
| tpc | – | | | | | | no pass ladder: no standard annual or monthly pass with zone prices on its plans |
| transreno | consistent | 766_JABO (6) | 766_MABO (6) | CHUR_STADT_EB (6) | CHUR_STADT_TK (6) | – |  |
| unireso | validated | 447_JABO_GE (2) | 447_MABO_GE (2) | 439_EB_GE (2) | 439_TK_GE (2) | tariffs/networks/unireso.json: 36 cells equal, 0 different | assumption on levels that are not a number of zones: year, month, single, dayPass |
| vagabond | partial | 479_JABO (5) | 479_MABO (5) | – | – | – |  |
| vbd | – | | | | | | no pass ladder: no standard annual or monthly pass with zone prices on its plans |
| vhb | – | | | | | | no pass ladder: single: 438_EB not usable (entries with a code that is not understood) |
| vvv | – | | | | | | no pass ladder: no standard annual or monthly pass with zone prices on its plans |
| z-pass-a-welle-zvv | consistent | 455_JABO (9) | 455_MABO (9) | 467_EB (10) | 467_TK (10) | – |  |
| z-pass-ostwind-zvv | consistent | 466_JABO (9) | 466_MABO (9) | 466_EB (10) | 466_TK (10) | – |  |
| z-pass-tv-schwyz-zug-zvv | consistent | 456_JABO (9) | 456_MABO (9) | 468_EB (13) | 468_TK (13) | – |  |
| zvv | partial | 490_JABO (6) | 490_MABO (6) | 490_EB (8) | 490_TK (8) | – | assumption on levels that are not a number of zones: year, month, single, dayPass |

In the product columns: the NOVA tarif read, and the number of zone columns of its ladder.
