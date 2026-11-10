# Price ladders read from NOVA

`<alliance>.json`: for a fare network, "number of zones → price" for the annual pass, the monthly
pass, the single ticket and the day pass, in the format of `../../tariffs/networks/*.json`, with
`"origin": "nova"`. Written by `tools/nova-import/derive.ts` (step `ladders`, run at the end of an
import). `REPORT.md` is the report of the last run. Both are generated: do not edit.

**What they are for.** A labelled fallback for networks whose tariff has not been transcribed. A
grid under `tariffs/networks/` always wins. The prices are those NOVA held on the day of the import
(`year`, `notes[0]`): NOVA has no validity dates and no future prices, so until an import made after
13 December these are the prices of the 2026 tariff year.

## Is a zone price linked to a product in NOVA? No, but it can be derived

Re-examined on 10.11.2026 on https://lindas.admin.ch/query, graph `https://lindas.admin.ch/sbb/nova`.

| Question | Query (in short) | Answer |
| --- | --- | --- |
| Properties of a `ZoningPriceCharacteristic` | `?s a otd:ZoningPriceCharacteristic ; ?p ?o` grouped by `?p` | `rdf:type` 23 859, `schema:price` 23 812, `schema:currency` 23 812, `otd:class` 23 050, `otd:frequencyCode` 12 919, `otd:customerSegment` 1 075. Nothing else; no blank node; no `schema:billingDuration` (that is on distance prices only). |
| Anything pointing at one | `?s ?p ?o . ?o a otd:ZoningPriceCharacteristic`, in the graph and over all graphs | 0 triples |
| Incoming and outgoing properties of PayLevel, Tarif, Zone, ZoningPlan, LocalNetwork, Alliance, CustomerSegment | the same two queries per class | PayLevel ← Tarif (4 735), Zone (1 610), TransportEdge; Tarif ← ZoningPlan, PayLevel; CustomerSegment ← ZoningPriceCharacteristic (1 075), Tarifwertpreisauspraegung (312). No path from a price to a pay level, a tarif or an alliance. |
| The IRI | `…/zoningpricecharacteristic/67523618` | a bare number |
| Upstream schema and shapes | `otd-schema.ttl`, `nova-shapes.html`, `datamodel.md` of zazuko/opentransportdata-swiss | the class has an empty comment; its (closed) shape allows class, frequencyCode, currency, price, customerSegment only; the diagram draws it joined to CustomerSegment and nothing else. The link was not converted. |

So the earlier finding stands: **no link in the data**. But the ids carry one:

1. **Blocks.** Sorted by id, the 23 859 entries fall into groups: inside a group ids are 8 to 17
   apart, between groups 41 or more. There are **4 735 groups, and 4 735 pay levels**.
2. **Order.** The groups follow the tarifs (products) sorted by `schema:identifier` in plain
   character order (`412_AB`, `412_AB_TK`, … `450_ZT_72484`, `451_AB`, … `SION_MABO_SP_MOD`), each
   tarif taking as many groups as it has pay levels. Checked on every tarif whose kind can be told
   from its pay levels: of 595 tarifs, 594 receive entries of their own kind (passes get `(ABO)`
   codes, tickets and day passes none), from the first identifier to the last; a single tarif out of
   place would shift everything behind it. (The one exception, `473_SCHULKLASSE`, is a school-class
   ticket coded as a pass.)
3. **Inside a tarif** the groups are *not* in the order of the pay levels (Mobilis annual pass: 4, 5,
   all, 9, 10, 2 zones …). They are ranked by price and laid on the pay levels ranked by number of
   zones: more zones never cost less.
4. **The frequency code** says what a price is: `(1.)`/`(2.)`/`(L)` class or "any"; `(ABO)` pass,
   `(V)` or `(EF)` single ticket, `(TK)` day pass, `(MFK)` multi-ride, `(GA)` class change;
   `(HA)`, `(1/2-ABO)`, `(1/2)` reduced ticket; for passes a number whose first digit is the customer
   category: 1 adult, 2 reduced, 3 senior where the network uses it (`(2.)(ABO)(240)`: 2nd class,
   reduced, annual; the last digit is 0 for annual, 1 for monthly, 7 for weekly passes in most
   networks). The duration is taken from the pay level, not from the code.
5. **Junior or senior.** Digit 2 covers both. Read as: one entry is the junior price, two entries
   the senior price (women, men). This reading reproduces Frimobil (junior 486, senior 513), unireso
   1st class (seniors only), Onde Verte and Mobilis (which uses digit 3). It is an inference; where
   it was used the file says so, and where NOVA shows one reduced entry only, no senior price is given.

## Validation

| Network | Compared with | Result |
| --- | --- | --- |
| Frimobil | `tariffs/networks/frimobil.json`, block `previous` (grid until 12.12.2026) | 112 cells equal, 0 different (tickets, day passes, monthly and annual passes, adult / junior / senior, both classes) |
| Onde Verte | `tariffs/networks/onde-verte.json` (T651.3 ed. 01.06.2026) | 88 equal, 0 different |
| unireso | `tariffs/networks/unireso.json` (T651.11 ed. 01.06.2026) | 36 equal, 0 different |
| Mobilis | 2026 prices of `../COMPARISON.md` (`tools/nova-import/ladder-reference.json`) | 6 equal, 0 different: annual adult 2nd class, 3, 4, 7, 9, 10 zones and all zones. The 1- and 2-zone prices the earlier import could not locate are 639 and 702 (monthly 71 and 78). |

The step repeats these comparisons on every run and **does not write a ladder that differs from its
reference**. If the number of groups stops matching the number of pay levels, or more than 2 % of
the tarifs receive entries of the wrong kind, it writes no ladder at all and removes the old ones.

## `confidence`

- `validated`: compared with a published grid of the same tariff year, all compared cells equal.
- `consistent`: not compared; all four products found, every level priced, never falling with the
  number of zones, and no pay level other than "n zones" in the products read.
- `partial`: a product missing, or the product has pay levels that are not a number of zones (a city
  zone, a short trip, a local network) which had to be set aside by an assumption: sold in one class
  only, same prices as another level, or the cheapest level(s). Each assumption is in `notes`, and
  `assumedProducts` lists the products concerned: for A-Welle, Arcobaleno, Libero and TNW only
  tickets or day passes are, the pass ladders are clean; for Ostwind, Passepartout and ZVV the
  passes are too (a city zone or local network with its own level).

Result of 10.11.2026: 21 alliances. Validated: frimobil, mobilis, onde-verte, unireso. Consistent:
tarifverbund-davos, tarifverbund-klosters, tarifverbund-schwyz, tarifverbund-zug, transreno,
z-pass-a-welle-zvv, z-pass-ostwind-zvv, z-pass-tv-schwyz-zug-zvv. Partial: a-welle, arcobaleno, bcs,
libero, ostwind, passepartout, tnw, vagabond, zvv. Nothing written for 14 alliances: no standard
pass with zone prices on their plans, levels by named zone only (engadin-mobil, leman-pass), or
codes without a customer category (`REPORT.md` gives the reason for each).

## Limits

- Which tarif is "the" annual pass of a network is chosen by its pay levels (validity), its codes and
  its name: products for a special public or area are left out by a word list, then the shortest
  identifier wins. `novaTarifs` names the tarif read; other candidates are in `notes`.
- A ladder ranked by price cannot be wrong in its values, only in which level a value sits on, and
  only where levels that are not a number of zones are mixed in (`partial`).
- Zones sold together, minimum zones of the tariff, overlap rules, age limits and subsidies are not
  in NOVA. `rules.minZones` is the first zone step NOVA prices, not the tariff's minimum.
- Weekly passes and FlexiAbo are in NOVA too and are not read yet.
- The derivation rests on how NOVA numbers its records. It is checked on every run, not guaranteed.
- `../SOURCES.md` and `../COMPARISON.md` still say that zone prices cannot be tied to a product and
  that the Mobilis ladder "cannot be automated safely"; this file replaces those two statements.
