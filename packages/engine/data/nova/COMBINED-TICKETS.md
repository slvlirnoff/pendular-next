# Journeys that combine fare systems: what NOVA says, what the tariffs say, what to build

Research note of 10.11.2026. Question: does the NOVA linked-data pilot carry the rules for
journeys made of zones + a point-to-point stretch + zones (a village bus inside Mobilis, a train
that leaves the network for Fribourg or Bern, a city network at the other end), or for a trip
from inside a network to outside it?

**Short answer: no.** The data describes each fare system on its own, well enough to measure
each piece (zones crossed, tariff kilometres, which products exist). The rules that join the
pieces, and almost all prices, are only in the tariff documents. They are few and simple
enough to code.

Every statement below is marked **[data]** (checked in the snapshot; the check is named),
**[document]** (quoted from an Alliance SwissPass tariff) or **[inference]** (my reading).

Documents used: T600.7 City-Tickets, T601 Allgemeiner Personentarif, T650 Streckenabonnemente,
T657 Modulabonnemente, all edition 01.06.2026, from allianceswisspass.ch, in the copies listed
in `../tariffs/NATIONAL-SOURCES.md`. Not obtained: the Alliance SwissPass handbook the cookbook
points to (login required), T603/T604 distance and routing prescriptions beyond their titles,
the Mobilis tariff T651.22, the "linking points" T657 mentions.

## 1. What the data encodes

### Networks are closed worlds

- **[data]** Every zone edge belongs to zoning plans of one or more alliances; of 47 258 edges
  only 2 are in no plan. An edge lists the zones it uses per plan. Nothing on an edge, zone,
  plan or alliance points to the direct service or to another alliance.
- **[data]** `Relationsgebiet` and `Relation` (the direct service, "DV") have these properties
  only: stops, tariff value, effective kilometres, priority; area label, provider, price table,
  class type, number, line code. None links to an alliance, a zone or a "network crossing".
  (Property census of both classes, 10.11.2026.)
- **[data]** The two worlds overlap on the ground: 2 674 of the 2 790 Mobilis stops also have
  DV relations, and 4 914 Mobilis stop pairs exist both as a zone edge and as a relation. So the
  existence of a relation does **not** mean a DV ticket is sold there.
- **[document]** T601 9.1.1: "Für alle Verbindungen innerhalb der Verbundgebiete werden,
  aufgrund des Verbundsortimentes, grundsätzlich nur Verbundfahrausweise ausgegeben." Inside a
  network the network's tickets replace the DV ones. That rule is not in the data.

### Anwendungsbereich (165): which tariffs apply on an edge, not how to combine them

- **[data]** 436 164 links from 34 621 edges to 165 "areas of application": T601 single tickets
  (34 120 edges), T650 route passes (32 031 edges), GA,
  half fare, T652 multi-ride cards, each network's own tickets ("T651.22 Mobilis
  Einzelbillette", "T651.4 Frimobil Einzelbillette" ...), regional passes, seat reservation.
  Each has `streckenAnwendbarkeitsbedingung` (GANZE_STRECKE, or TEILSTRECKE for reservations)
  and sometimes `tuAnwendbarkeitsbedingung` (IV, IV_DV).
- **[data]** Of the 4 043 Mobilis edges, 4 015 carry "T601 (IV/DV)", 3 757 "T650 (IV/DV)" and
  all 4 043 "T651.22 Mobilis". The rail edge Lucens – Moudon carries T601, T650, Mobilis *and*
  Frimobil tickets. So the list says "a ticket of this tariff may include this edge"; it does
  not say which tariff wins for a given journey.
- **[data]** It is a weak filter. The 286 Mobilis edges without `t650-streckenabonnemente-iv-dv`
  are almost all rail-replacement bus edges (operators `sbb-ev`, `tpc-ev`, `mbc-ev` ...); town
  bus edges in Lausanne carry T601 and T650 like any other. Whether a route pass or DV ticket
  can really cover a stretch is better read from the relations: no relation, no tariff
  distance (Lovatens – Lucens by bus and Renens – EPFL by m1 have none).
  `edgeInfo(a, b).applications`, `relationsBetween(a, b)`.

### "Anschlussbillett" zoning plans: connecting tickets *inside* a network

- **[data]** Only Mobilis has a separate plan named so (`mobilis-billett-anschlussbillett`,
  product `449-ab` "Mobilis Anschlussbillett"). Its edges and zones are identical to the
  ticket plan (0 differences over 4 043 edges). Its pay levels go by number of zones, 1 to 14,
  plus a short trip, with validities of 1 to 4 hours. Sixteen other alliances list
  connecting-ticket products (`470-ab` Libero, `484-ab` Frimobil, `490-ab-eb` ZVV ...) on their
  ordinary ticket plan.
- **[inference]** This is the ticket a pass holder buys for the zones the pass does not cover,
  inside the same network, priced on the number of extra zones. sbb.ch showed exactly that
  for Lucens – Lausanne: "10 zones via billet de raccordement avec zone 71" (`../zones/REFERENCE-CHECKS.md`).
  It is not a ticket for leaving the network.
- **[document]** T657 3.5.2: connecting tickets inside an integral network follow that
  network's tariff; 3.5.1: beyond the network, "streckenabhängige Anschlussbillette des
  Direkten Verkehrs" (ordinary DV route tickets).

### Local networks (150) and route-type pay levels: short trips and small-town flat fares

- **[data]** 148 local networks belong to ZVV, 2 to Onde Verte (La Chaux-de-Fonds, Le Locle).
  2 894 edges name their local network. 29 pay levels of type STRECKENTYP / LOKALNETZ (23 ZVV,
  6 Onde Verte) list the networks they are valid in; `490-jabo-mod/lokalnetz` (ZVV modular pass,
  annual) lists all 148.
- **[data]** 109 727 directed stop pairs are tagged KURZ or LANG with the pay levels valid on
  them (short-trip tickets of about a dozen networks: for Mobilis `449-eb/kurzstrecke`, e.g. Lausanne,
  Flon → Lausanne, gare). `shortRoutes(from, to)`.
- **[document]** T600.7 lists the ZVV local networks as the "Geltungsbereich" of some 25 City-Tickets
  (Adliswil, Bülach, Uster ...). So for ZVV towns the local network is the city part of a
  City-Ticket; for all other cities the city part is one or more named zones.

### City-Ticket and modular pass: the products exist, their zones are marked, the rule is absent

- **[data]** No product is called City-Ticket except two small plans (Martigny, Oberengadin).
  The modular pass is everywhere: 52 products named `…-jabo-…mod` / `…-mabo-…mod` (annual /
  monthly) across the networks and several towns outside them, sold on the network's pass plan
  or on a plan of their own.
- **[data]** Zones carry pay levels of type ZONENNUMMER that name fixed groups of zones:
  Mobilis 11 and 12 → `zonen-grand-laus` (for 14 products, including `450-jabo-mod`); Libero
  100 and 101 → `477-jabo-mod/zonen-100-101`; ZVV 110 → `490-jabo-mod/zone-110`. The Mobilis
  modular pass has pay levels for 1 to 4 zones and for Grand Lausanne, nothing above.
  `plan.zones[i].payLevels`, `payLevels(tarif)`.
- **[data]** 13 zones have a price factor of 2 (ZVV 110 and 120, Passepartout 10): they count
  double. `zoneCount()`.
- **[document]** T600.7 2.1.1: a City-Ticket is a T601 route ticket "mit integrierter Tageskarte
  der Verkehrsbetriebe der entsprechenden Ziel- und/oder Quell-Stadt bzw. mit einer
  Zonengültigkeit". 3.1: the route part is priced by T601 2.2.1, rounded up to 10 Rp; the city
  part is a flat price from the table in section 5 (same for both classes), e.g. Lausanne
  (Mobilis 11, 12) 7.80 full / 4.80 half, Bern (Libero 100, 101) 10.40 / 6.00, Fribourg
  (Frimobil 10) 8.20 / 5.80, Yverdon (Mobilis 40) 6.40 / 4.80, Zürich (ZVV 110) 8.50 / 5.90,
  Genève (unireso 10) 6.00 / 4.00. Valid one calendar day.
- **[document]** T657 2.1.1: a modular pass joins a route pass with network zones: possible are
  zone–route–zone, zone–route, route–zone–route–zone, zone–route–zone–route–zone; not possible
  route–zone–route (a zone in the middle needs a zone at one end). 4.1.2: the prices of the
  routes and of the zones are added; they are joined "nach den vorgegebenen und im
  Vertriebssystem hinterlegten Verknüpfungspunkten". 4.2.1: route part = T650 price for the
  distance, less 15 %, rounded up to the franc. 4.2.2: zone part = the network's base zone
  price less the network's discount (1.2: Mobilis 27 %, Frimobil at least 24 %, Libero at least
  27 %, unireso 17 %, ZVV 10 %, Onde Verte at least 25 % ...); zones counted double in the
  network count double. 1.5: a 1st class modular pass uses the 2nd class zone price, except in
  A-Welle, ZVV, TNW, Arcobaleno. 4.2.4: never sold above the GA price. 3.1.2: adults from 25,
  youth to 24.99 (2nd class only); month or year.
- **Not in the data:** the linking points, the discounts, the flat city prices, the list of
  City-Ticket cities.

### Inter-network alliances: a crossing is priced only where a joint plan exists

- **[data]** Some "alliances" are joint tariffs over two networks, with their own zoning plans
  covering the stops of both: `z-pass-a-welle-zvv`, `z-pass-ostwind-zvv`,
  `z-pass-tv-schwyz-zug-zvv`, `leman-pass` (Geneva and neighbouring France), A-Welle's
  "Kombi A-Welle & WTV", Ostwind's "Kombi OTV & VHB" / "OTV & VVV", Onde Verte's
  "transfrontalier", TNW's triregio, Bodensee Ticket. A stop then appears in several alliances:
  `alliancesAt('8503504')` (Baden) = a-welle, z-pass-a-welle-zvv, zvv.
- **[data]** Neighbouring networks overlap at their edge without a joint plan: 341 stops are in
  both Mobilis and Frimobil. Lucens is Mobilis zone 103 and Frimobil zone 45/47; Lovatens,
  village is Mobilis 103 and Frimobil 45; Romont FR is Frimobil 44 only. Lucens → Romont is
  therefore a plain Frimobil trip, not a combined one.
- **[data]** No alliance contains both Lausanne and Bern, or both Lausanne and Fribourg.
- **[inference]** Rule: for a trip across a network border, first look for one alliance that
  contains every stop (`alliancesAt` intersected over the stops). Only if there is none is it
  a combined journey.

### Relations and tariff kilometres

- **[data]** Relations exist only inside one line area. Lausanne – Bern has none; chained at
  Fribourg it is 69 + 36 = 105 tariff km (97 effective).
- **[document]** T601 2.2.1.3: when the two stations are in different triangles, read the
  partial distances "in den für den Reiseweg zutreffenden Streckendreiecken" and add them; at a
  junction the distance runs "über jene Abzweigstation, über die der Reisende fährt". The price
  is then read once, on the total. Operators with their own price steps ("Anstosspreise",
  tables with unit PREIS: 247 of the 297 T601 tables) are priced separately and added.
  `tariffKm()` does the first part; each part says whether its unit is KILOMETER or PREIS.
- **[data]** Areas exist per price table. T601 and T650 copies differ where single tickets
  carry a surcharge that passes do not (Genève – Genève-Aéroport: 16 km in T601, 6 km in T650).
  3 166 distinct areas remain after merging identical copies; only 258 areas were identical
  for T601 and T650.
- **[data]** Prices: none for T601 and T650. The T650 route-pass table is present by accident
  as "LEX Preistabelle DV Abo" (COMPARISON.md).

## 2. The rules for crossing a network border (documents only)

- T601 9.2.1: "Verbundfahrausweise sind in allen Regelzügen gültig, welche im gelösten
  Geltungsbereich des Verbundes fahrplanmässig anhalten. In den Zügen sind die
  Verbundfahrausweise daher nur bis zum letzten bzw. erst ab dem ersten fahrplanmässigen
  Halteort innerhalb des gelösten Geltungsbereichs gültig."
- T601 9.3.1: "Zu Verbundfahrausweisen sind anschliessende Fahrausweise ab oder nach dem
  letzten im Geltungsbereich des Verbundfahrausweises liegenden fahrplanmässigen Halteort
  auszugeben." Example given there: Basel – Luzern by InterRegio stopping at Gelterkinden: the
  TNW pass is valid to Gelterkinden, a connecting ticket Gelterkinden – Luzern is needed; by
  InterCity without a stop inside TNW, the connecting ticket must start at Basel.
- T601 3.1.5.1: a connecting ticket to a DV ticket can be a DV ticket or a network ticket.
- T650 1.2 with T601 9: route passes are not issued for trips inside a network.

So the split point is the **last scheduled stop of the train inside the network**, which
depends on the train taken. That needs the stop sequence of the leg, which the engine has.

## 3. Proposed algorithm

Inputs per option: the legs with their ordered stops (board, stops in between, alight) and
mode. Functions are those of `src/fares/nova.ts`. "Price by grid" means the network's own price
table (for Mobilis `../tariffs/mobilis-2027.json`), since NOVA cannot give it.

**Step 0, classify.** `A` = alliances containing *every* stop of every transit leg
(intersection of `alliancesAt`). Prefer an ordinary network over a joint one when both qualify.

**(i) Entirely inside one network** (`A` not empty).
1. Per leg `zonesForStops(alliance, 'pass' | 'ticket', stops, { mode })`; union of the zones.
   If `missingEdges` is not empty, fall back to the present zone table and mark the result
   inexact. `bridged` entries are fine for trains; for buses they are a guess (section 5).
2. Add the zones a ZONENNUMMER pay level ties together (Mobilis: 11 ⇒ 12 and 12 ⇒ 11).
3. `n = zoneCount(...)` (double zones); price by grid for pass and for single ticket; a short
   trip applies when `shortRoutes(from, to)` is not empty for a single-leg trip.
   *Verified:* five SBB reference trips reproduce zone for zone (`test/nova.test.ts`).
   *Document:* T601 9.1.1. *Inference:* step 2 from the pay-level data plus the SBB check.

**(ii) From inside a network to outside it** (origin in network N, destination in none, or the
reverse).
- *Single ticket.* a) If every leg has relations: one DV ticket for the whole way,
  `km = Σ tariffKm(legStops, 'T601').km` over the legs whose parts are all KILOMETER, price read
  once on the total (T601 table); parts with unit PREIS are priced on the operator's table,
  which we do not have, so mark the result as incomplete. b) If the first legs have no relation
  (a village bus that is not in the DV): network ticket for those legs as in (i), up to the
  stop where the first leg with relations starts, plus a DV ticket from there. Offer a) when
  possible, else b).
  *Document:* T601 2.2.1.3, 9.3.1, 3.1.5.1. *Inference:* that the shop sells a) as one ticket
  from a stop inside a network; not checked against sbb.ch.
- *Commute pass.* Three candidates, cheapest wins, all capped by the GA:
  1. Route pass for the whole way: `Σ tariffKm(legStops, 'T650').km`, T650 table. Only if every
     leg has relations (`tariffKm` not null, no loose part).
  2. Modular pass zone–route: zones of N for the legs inside N up to the linking point (take
     the last stop of the trip that is in N *and* has relations onward, usually the station
     where the train is boarded), route from there. Price = ⌈0.85 × T650(km)⌉ + (1 − discount
     of N) × zone price for the zone count, by grid.
  3. Network pass of N for the inside part + nothing for the rest is not a commute product;
     skip.
  *Document:* T657 2.1.1, 4.2. *Inference:* the choice of the linking point.

**(iii) Across two networks with a gap** (origin in N1, destination in N2, `A` empty).
- First the joint-alliance test of step 0 (Z-Pass, Léman Pass, the Ostwind and A-Welle
  combinations): if one alliance holds all stops, it is case (i) on that alliance's plan.
- *Single ticket:* as (ii) a), one DV ticket end to end where relations allow; else network
  tickets at the ends plus a DV ticket between the last stop inside N1 and the first inside N2
  that the train serves.
- *Commute pass:* modular pass zone–route–zone: zones in N1 to the linking point, T650 route
  between the two linking points, zones in N2. Each network's discount applies to its own
  zones. Compare with a whole-way route pass where relations cover it.

**(iv) Inside-network leg + long-distance train + city network at the destination.**
- *Single ticket:* City-Ticket when the destination (or origin) city is in the T600.7 list and
  the trip uses that city's local transport: T601 price for the route to the city's station,
  rounded up to 10 Rp, plus the flat city price (full or half). The city part is a day pass, so
  it also covers the way back to the station. For the village end, as (ii) b).
- *Commute pass:* modular pass zone–route–zone as in (iii), the city end being the zones the
  ZONENNUMMER pay level names (Bern: Libero 100 + 101, counted as that network counts them;
  Lausanne: Mobilis 11 + 12; ZVV towns: the local network).
  Example, Lovatens village → Bern centre: bus Lovatens – Lucens has no relation (zone part:
  Mobilis 103, 1 zone, 666 × 0.73 = 486.18); Lucens – Palézieux – Fribourg – Bern 23 + 45 + 36 =
  104 km T650 (3 465 × 0.85 = 2 945.25 → 2 946); Bern zones 100/101 at Libero's base price less
  at least 27 % (price not in our data). The sum comes close to the 2nd class GA (4 095), which
  is the cap.

**Always also offer** the GA and, for single trips, half-fare variants, as today.

## 4. One check of the modular-pass formula, and it does not close

sbb.ch, 10.11.2026, validity from 04.01.2027 (`../zones/REFERENCE-CHECKS.md`): Romont FR →
Ecublens VD, EPFL, "Abo modulable incl. Lausanne zones 11, 12": **CHF 2 553**.

Formula with our tables: Romont – Lausanne 41 km (NOVA), T650 annual 2nd class 2 331 →
× 0.85 = 1 981.35 → 1 982; Grand Lausanne = 2 zones 729 (2027 grid) × 0.73 = 532.17; sum
**2 514**, CHF 39 (1.5 %) under the shop.

- With Renens VD as linking point (46 km: 2 457 → 2 089) the sum is 2 621, CHF 68 over.
- The gap closes exactly if the T650 price for 41 km were 2 376 or 2 377 instead of 2 331 (+2 %).
  The same factor explains the shop's route pass for that trip, "from CHF 2 511": Romont –
  Renens is 46 km, 2 457 in our table, × 1.02 ≈ 2 506.
- **[inference]** Route-pass prices valid from 13.12.2026 are probably about 2 % above the table
  we hold (edition 01.06.2026). `NATIONAL-SOURCES.md` already lists the 2027 T650 prices as not
  found. Until they are, a modular-pass estimate will be about 1.5 % low.
- T657 4.2.1 says the route part uses "T650, Basistarif 2". T650 (01.06.2026) does not use that
  term anywhere; it may name a table we have not seen.

## 5. Limits to keep in mind when wiring this in

- Zones along a leg are exact only with the real stop sequence. With the two ends of a bus leg
  the fewest-edges chain can take another road (Chapelle-sur-Moudon → Croisettes comes out
  through Moudon, 6 zones, where bus 435 uses 4).
- `tariffKm` trusts the stops given. A stretch whose area does not list the stops in between is
  marked `loose` and used only when nothing else fits; treat a loose part as an estimate.
- The split point of T601 9.3.1 depends on where the actual train stops; an InterCity and a
  regional train on the same line give different connecting tickets.
- T603 (routing prescriptions, "Wahlstrecken") can allow or forbid ways round; not in the data,
  not modelled.
- Prices in NOVA are the day's. Zone prices cannot be attributed to a product. Keep the price
  grids we transcribe from the networks' own publications as the source of prices, and use NOVA
  for geometry: zones per edge, tariff kilometres, product and pay-level structure.
