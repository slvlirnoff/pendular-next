## Human review: things that look implausible

Re-reviewed 2026-11-10 against the current engine code (`rules.ts`, `planner/compare.ts`, `planner/prune.ts`, `routing/motis.ts`,
`apps/api/src/deps.ts`) and `expected.json`. Numbers are one-way unless stated; yearly CHF for adult, 2nd class, 5 days, 5 weeks off
(470 trips). This file is hand-written and copied into REPORT.md on every run; update it when you re-review.

### Still open

1. **Car runs at free-flow speed in the morning peak (`carPeakFactor` 1, `carParkingMin` 0).** lausanne-bern car 59 min for 103 km,
   nyon-geneve 19 min, aigle-lausanne 30 min, yverdon-lausanne 24 min, zurich-hb-winterthur 19 min. Real 07:30-08:30 arrivals into
   Geneva, Lausanne and Zurich take 1.5-2x as long, so "fastest = car" verdicts are overstated. Being changed separately.
2. **Park and ride with unknown parking prices counts as free.** `parkingPerYear` returns null when a site has no day, month or year
   price, and the option then carries no parking cost (earlier run: Matran, école; Genève, Maison de la Paix). Unknown should be flagged as
   estimated or the option dropped. Latent: no parkRail option survives in the current golden set.
3. **National route-pass tariff where regional tariff networks exist.** zurich-hb-winterthur (ZVV) and bulle-fribourg (Frimobil/TPF) still
   show `routePassYearly` (1'881 and 1'953 for the bus). No regional fare model exists in `packages/engine/src/fares`.
4. **Included-ticket P+R is assumed, not verified.** chapelle-sur-moudon "Le Mont-sur-L., Grand-Mont" is priced with
   `zonePassMonthly` 0 (`parking.includesTransit`) and offers no other product. That is deliberate (the parking product includes the
   ticket), but the zones and the month/day basis come from the parking data and were not re-checked against the operator.

### Resolved

1. **Rail kilometres looked like straight-line distances** (route passes too cheap, CO2 too low). Resolved by `transitDistanceFactor`
   (rail 1.25, other 1.15) in `apps/api/src/deps.ts`, applied in `routing/motis.ts`. Tariff km now: lausanne-bern 98 (real about 97),
   nyon-geneve 26 (about 25), vevey-geneve 93 (about 87, slightly high), lausanne-bern pass CHF 3'375.
2. **E-bike cost CHF 0 won cheapest and greenest on 15-22 km commutes.** Resolved: bike and e-bike carry per-km costs
   (`bikeFullCostPerKm` 0.05, `ebikeFullCostPerKm` 0.23 in `rules.ts`; sources in `packages/engine/data/factors/BIKE-COST-SOURCES.md`).
   `compare.ts` also drops bike/e-bike when walking takes `walkInsteadOfBikeMaxMin` (15) or less, or when public transport is faster
   and cheaper. Only morges-epfl, chailly-flon and renens-chuv keep a bike or e-bike now. `ebikeAllWayMaxMin` is still 60 min.
3. **P+Rail that is really "drive the whole way".** Resolved by `parkRailMaxDriveShare` (drive at most 0.5 of the direct drive),
   `accessMinKmFromWork` (site at least 2 km from work) and the `noBetterThanTransit` rule (must save 5 minutes on public transport or
   cost less). No parkRail option remains for aigle-lausanne, bulle-fribourg or nyon-geneve.
4. **City P+R proposed when the car already passes the destination.** Resolved by `cityParkRideMaxDetour` (now 1: the drive to the site
   may not exceed the direct drive), `accessMinKmFromWork` and `noBetterThanTransit`. morges-epfl, renens-chuv and chailly-flon no
   longer get one; the remaining ones (lucens, chapelle-sur-moudon) are long trips.
5. **bikeRide with a trivial or backwards ride.** Resolved by `bikeRideMinMin` (4 min) and `noBetterThanTransit`. Only
   zurich-hb-winterthur keeps one (Stadelhofen, 27 min against 32 min by transit).
6. **No GA on city P+R options.** Resolved: cityParkRide products now list the GA (lucens, chapelle-sur-moudon Vennes). The
   included-ticket option (open point 4) lists only its included ticket.
7. **Near-duplicate transit options.** Resolved by dominance and the cap per kind in `planner/prune.ts`, plus the
   twice-the-fastest-plus-30-minutes limit in `compare.ts`. bulle-fribourg now has two distinct options (bus 63 min, rail + bus 56 min).

### Checked and correct — do not change

1. **Same origin and destination, different price depending on the first leg.** sbb.ch sells Lucens -> Lausanne as 7 zones via Epalinges
   (bus 361 + m2, CHF 2'052) and 9 zones direct (train R8/R9, CHF 2'376); Pendular matches to the franc. See
   `packages/engine/data/zones/REFERENCE-CHECKS.md` (Lucens -> Lausanne rows; also Lovatens -> EPFL). SBB prices the pass per route.
   The aigle-lausanne (10 against 12 zones) and bulle-fribourg (bus route pass against rail route pass) differences come from the same
   mechanism but were not compared with sbb.ch individually.
2. **Senior and youth annual passes are far below the monthly ones.** Expected: the canton of Vaud's 50 % discount applies only to
   annual Mobilis passes, not to monthly ones (yverdon-lausanne-senior 1'071 yearly against 2'618 monthly; youth 833 against 2'035).
3. **Door-to-door time looks long for IC trips.** zurich-hb-winterthur 32 min = 6 min walk + 25 min rail (typical connection, not only the
   IC) + 1 min walk; nyon-geneve 31 min = 13 min walk + 16 min rail + 2 min walk. The time includes walking to the station.
4. Echallens LEB 35 min / 4 zones / CHF 1'305 (SBB 2027 price); Renens -> CHUV 2 zones CHF 729; Yverdon IC 37 min / 9 zones CHF 2'376;
   GA 4'095 (2nd) and 6'770 (1st); Half Fare holder gets no discount on zone passes; 1st class 1.7x; youth/senior GA 2'875/3'260;
   the part-timer (188 trips) flips to a Flexi pass (CHF 1'320); chapelle-sur-moudon has no train but a 57 min bus + m2 with only 2
   departures in the window.
