# Golden commutes report

Generated 2026-11-10T14:11:29.459Z against http://127.0.0.1:8787.
Timetable GTFS 2027, fetched 2026-11-10, tariffs Mobilis 13.12.2026; GA/Half Fare 13.12.2026; T601/T650 edition 01.06.2026, engine MOTIS 2, reference day 2027-01-19.

Checks: 483 PASS, 0 WARN, 5 FAIL.

| Commute | Cheapest | Fastest | Greenest | Options | Left out |
|---|---|---|---|---|---|
| lucens-lausanne-gare | Lucens, centre → Lausanne, gare, 361 · m2 (2'052 CHF, 59 min) | car (13'611 CHF, 26 min) | Lucens → Lausanne, R8/R9 (2'376 CHF, 55 min), 145 kg CO2 | 5 (transit, parkRail, cityParkRide, car) | 12 |
| echallens-lausanne-flon | ebike (0 CHF, 41 min) | car (8'511 CHF, 15 min) | Echallens → Lausanne-Flon, R20/R25 (1'305 CHF, 35 min), 54 kg CO2 | 5 (ebike, transit, cityParkRide, car) | 9 |
| morges-epfl | bike (0 CHF, 26 min) | car (5'351 CHF, 8 min) | bike (0 CHF, 26 min), 17 kg CO2 | 6 (bike, ebike, transit, parkRail, cityParkRide, car) | 7 |
| vevey-geneve | Vevey → Genève, IR90/IR95/RE33 (2'961 CHF, 74 min) | car (33'245 CHF, 51 min) | Vevey → Genève, IR90/IR95/RE33 (2'961 CHF, 74 min), 279 kg CO2 | 2 (transit, car) | 9 |
| lausanne-bern | Lausanne → Bern, IC1/IR15 (3'024 CHF, 75 min) | car (39'574 CHF, 59 min) | Lausanne → Bern, IC1/IR15 (3'024 CHF, 75 min), 295 kg CO2 | 2 (transit, car) | 8 |
| chapelle-sur-moudon-lausanne | ebike (0 CHF, 59 min) | car (10'780 CHF, 21 min) | ebike (0 CHF, 59 min), 116 kg CO2 | 6 (ebike, transit, cityParkRide, parkRail, car) | 8 |
| yverdon-lausanne | Yverdon-les-Bains → Lausanne, IC5/IC51/R1/R2 (2'376 CHF, 37 min) | car (16'064 CHF, 24 min) | Yverdon-les-Bains → Lausanne, IC5/IC51/R1/R2 (2'376 CHF, 37 min), 121 kg CO2 | 4 (transit, bikeRide, cityParkRide, car) | 13 |
| nyon-geneve | ebike (0 CHF, 60 min) | car (12'718 CHF, 19 min) | Nyon → Genève, IR15/IR57/IR95/RE33 (1'674 CHF, 31 min), 78 kg CO2 | 5 (ebike, transit, bikeRide, parkRail, car) | 5 |
| aigle-lausanne | Aigle → Lausanne, IR90/IR95/RE33 (2'475 CHF, 47 min) | car (18'355 CHF, 30 min) | Aigle → Lausanne, IR90/IR95/RE33 (2'475 CHF, 47 min), 141 kg CO2 | 6 (transit, bikeRide, parkRail, car) | 10 |
| chailly-flon | walk (0 CHF, 35 min) | car (4'194 CHF, 4 min) | walk (0 CHF, 35 min), 0 kg CO2 | 8 (walk, bike, ebike, transit, bikeRide, cityParkRide, car) | 12 |
| renens-chuv | bike (0 CHF, 21 min) | car (5'261 CHF, 8 min) | bike (0 CHF, 21 min), 14 kg CO2 | 8 (bike, ebike, transit, bikeRide, cityParkRide, car) | 11 |
| bulle-fribourg | Bulle, gare routière → Fribourg, Tilleul/Cathédrale, 234 · 10 · 6 (1'809 CHF, 63 min) | car (13'770 CHF, 21 min) | Bulle → Fribourg, Tilleul/Cathédrale, RE2 · 2 (2'268 CHF, 53 min), 185 kg CO2 | 7 (transit, parkRail, car) | 5 |
| zurich-hb-winterthur | Zürich Stadelhofen → Winterthur, S11/S12 (1'602 CHF, 27 min) | car (11'170 CHF, 19 min) | Zürich HB → Winterthur, IC1/IR13/IR75/S11/S12/S8 (1'674 CHF, 32 min), 82 kg CO2 | 4 (bikeRide, transit, car) | 7 |
| yverdon-lausanne-youth | request failed | | | | |
| yverdon-lausanne-senior | request failed | | | | |
| yverdon-lausanne-halffare | request failed | | | | |
| yverdon-lausanne-first-class | request failed | | | | |
| yverdon-lausanne-part-time-2d | request failed | | | | |

## Automatic flags (heuristics, may be noise)

- **lucens-lausanne-gare**: transit-0 "Lucens → Lausanne, R8/R9": 9 zone(s) (zonePassYearly, 2'376 CHF)
- **lucens-lausanne-gare**: parkRail "Châtillens → Lausanne, R8/R9" costs 9'136 vs transit 2'052
- **lucens-lausanne-gare**: cityParkRide "Lausanne, Vennes → Lausanne, gare, m2" costs 10'629 vs transit 2'052
- **echallens-lausanne-flon**: cityParkRide "Lausanne, Parc Vélodrome → Lausanne, Bel-Air, 1" costs 6'047 vs transit 1'305
- **echallens-lausanne-flon**: cityParkRide "Lausanne, Vennes → Lausanne, Flon, m2" costs 6'982 vs transit 1'305
- **morges-epfl**: parkRail "Denges, Les Oches → Ecublens VD, EPFL (bus), 705" costs 3'315 vs transit 1'305
- **morges-epfl**: cityParkRide "Lausanne, Bourdonnette → Ecublens VD, EPFL, m1" costs 5'161 vs transit 1'305
- **chapelle-sur-moudon-lausanne**: ebike "ebike" offered for 22 km (59 min)
- **chapelle-sur-moudon-lausanne**: cityParkRide "Le Mont-sur-L., Grand-Mont → Lausanne, gare, 60/8 · m2" costs 7'189 vs transit 1'575
- **chapelle-sur-moudon-lausanne**: cityParkRide "Lausanne, Vennes → Lausanne, gare, m2" costs 7'797 vs transit 1'575
- **chapelle-sur-moudon-lausanne**: parkRail "Châtillens → Lausanne, R8/R9" costs 8'082 vs transit 1'575
- **yverdon-lausanne**: transit-0 "Yverdon-les-Bains → Lausanne, IC5/IC51/R1/R2": 9 zone(s) (zonePassYearly, 2'376 CHF)
- **yverdon-lausanne**: bikeRide-4 "Yverdon-les-Bains → Lausanne, IC5/IC51/R1/R2": 9 zone(s) (zonePassYearly, 2'376 CHF)
- **yverdon-lausanne**: cityParkRide "Lausanne, Parc Vélodrome → Lausanne, gare, 1 · m2" costs 13'890 vs transit 2'376
- **nyon-geneve**: ebike "ebike" offered for 22 km (60 min)
- **nyon-geneve**: parkRail "Genève, Maison de la Paix → Genève, gare Cornavin, 15" costs 9'303 vs transit 1'674
- **aigle-lausanne**: transit-1 "Aigle → Lausanne, IR90/IR95/RE33": 10 zone(s) (zonePassYearly, 2'475 CHF)
- **aigle-lausanne**: bikeRide-11 "Aigle → Lausanne, IR90/IR95/RE33": 10 zone(s) (zonePassYearly, 2'475 CHF)
- **aigle-lausanne**: transit-0 "Aigle, place du Marché → Lausanne, 101 · IR95": 12 zone(s) (zonePassYearly, 2'583 CHF)
- **aigle-lausanne**: parkRail "Vevey, funiculaire → Lausanne, 212 · IR90/R3" costs 11'551 vs transit 2'475
- **aigle-lausanne**: parkRail "Puidoux → Lausanne, R8/R9/S30/S31" costs 13'048 vs transit 2'475
- **chailly-flon**: cityParkRide "Lausanne, Vennes → Lausanne, Flon, m2" costs 2'703 vs transit 729
- **renens-chuv**: cityParkRide "Lausanne, Bourdonnette → Lausanne, CHUV, m1 · m2" costs 2'666 vs transit 729
- **renens-chuv**: cityParkRide "Lausanne, Vennes → Lausanne, CHUV, m2" costs 4'365 vs transit 729
- **bulle-fribourg**: parkRail "Matran, école → Fribourg, Tilleul/Cathédrale, 11 · 123/182" costs 8'670 vs transit 1'809
- **bulle-fribourg**: parkRail "Belfaux CFF → Fribourg, Tilleul/Cathédrale, S30/S31 · 1" costs 11'422 vs transit 1'809
- **bulle-fribourg**: parkRail "Fribourg/Freiburg, Pl. Gare → Fribourg, Tilleul/Cathédrale, 1/2/6" costs 11'899 vs transit 1'809

## Human review: things that look implausible

Read as a Swiss commuter would, on the run of 2026-11-10 (timetable 2027, reference day 2027-01-19). Numbers are one-way
unless stated; yearly CHF for adult, 2nd class, 5 days, 5 weeks off (470 trips). This file is hand-written and copied into
REPORT.md on every run; update it when you re-review.

1. **Rail kilometres / national tariff km look like straight-line distances, so long-distance route passes are too cheap.**
   lausanne-bern: rail leg 78.1 km, route pass "km79" at CHF 3'024 (74 % of the 4'095 GA). Real track and tariff distance
   Lausanne-Fribourg-Bern is about 97 km, and a real Bern-Lausanne annual route pass is close to GA money. vevey-geneve: 73.9 km
   (real about 87), CHF 2'961. aigle-lausanne: 37.3 km (real about 52). nyon-geneve 20.6 km (real about 25). Also understates CO2.

2. **Car is free-flow speed in the morning peak (carPeakFactor 1, carParkingMin 0).** lausanne-bern car 59 min for 103 km
   (105 km/h door to door), nyon-geneve 19 min for 26 km, aigle-lausanne 30 min for 44 km, yverdon-lausanne 24 min for 37 km,
   zurich-hb-winterthur 19 min for 25 km. Real 07:30-08:30 arrivals into Geneva/Lausanne/Zurich take 1.5-2x as long, so
   "fastest = car" verdicts are overstated.

3. **E-bike (cost CHF 0) wins "cheapest" and "greenest" on 15-22 km commutes.** chapelle-sur-moudon-lausanne ebike 21.7 km / 59 min,
   nyon-geneve ebike 21.9 km / 60 min (beats the train at CHF 1'674 on cost), echallens-lausanne-flon 15.0 km / 41 min.
   Nobody commutes 22 km each way by e-bike through a year; no bike purchase, battery or maintenance cost; no hill/weather penalty.
   ebikeAllWayMaxMin is 60 min each way, which is too generous.

4. **P+Rail that is really "drive the whole way".** aigle-lausanne: parkRail-2 Puidoux drives 31.8 km of a 42.6 km trip (rail 10.8 km)
   for CHF 13'048 vs transit 2'475, parkRail-5 "Vevey, funiculaire" drives 25.7 km then takes bus 212 to a station (CHF 11'551).
   bulle-fribourg: parkRail "Fribourg, Pl. Gare" drives 28.1 km then 1 km of bus (CHF 11'899). nyon-geneve: parkRail "Genève, Maison
   de la Paix" drives 25 km, then 1.2 km tram, parking CHF 0 (CHF 9'303). A park-and-ride that is 95 % car adds nothing.

5. **Same origin and destination, different price depending on the first leg.** lucens-lausanne-gare: bus 361 + m2 = 7 zones CHF 2'052,
   rail R8/R9 = 9 zones CHF 2'376 (stops 400 m apart). aigle-lausanne: IR from the station 10 zones / 2'475 vs bus-then-IR from
   "Aigle, place du Marché" 12 zones / 2'583. bulle-fribourg: bus route pass km26 CHF 1'809 vs rail km37 CHF 2'268 for the same
   Bulle -> Fribourg pair. A Mobilis pass priced by the zones crossed should not depend on the vehicle.

6. **Senior annual Mobilis pass is out of line with its monthly price.** yverdon-lausanne-senior: zonePassYearly CHF 1'071 (45 % of
   adult 2'376) but zonePassMonthly 2'618 (90 % of adult 2'904, so monthly x1 is 2.4x the annual). Youth: yearly 833 vs monthly 2'035.
   Possibly the Vaud resident discount applies only to the annual, but a 55-65 % discount needs checking.

7. **National route-pass tariff used where regional tariff networks exist.** zurich-hb-winterthur (ZVV zones) and bulle-fribourg
   (Frimobil) show "routePassYearly" (CHF 1'674 for km22; 1'809 for a bus). Bus Bulle -> Fribourg priced with the national tariff
   (TPF/Frimobil zones should apply). Not Vaud, but the bus pricing is the thing to check.

8. **City P+R proposed when the car already passes the destination.** morges-epfl: cityParkRide Bourdonnette drives 10.4 km vs 6.4 km
   direct (1.62x, over cityParkRideMaxDetour 1.3) and costs CHF 5'161 vs transit 1'305. renens-chuv: drive 3.2 km to Bourdonnette to
   save 3 km of a 6 km trip (CHF 2'666 vs 729). chailly-flon: Vennes P+R for a 3 km trip (CHF 2'703). Pass component is priced
   "zonePassMonthly: 0, z11+12", i.e. the ticket is assumed included in a CHF 1'560/yr P+R (Parc Vélodrome) while Vennes is CHF 990/yr.

9. **bikeRide (e-bike to a station) with a trivial or backwards ride.** yverdon-lausanne bikeRide-1: e-bike 0.5 km + rail, same CHF 2'376 as
   plain transit, differs by 1 min. aigle-lausanne 0.9 km, nyon-geneve 0.6 km, renens-chuv e-bikes 1.7 km to Renens for a 5 km trip.
   chailly-flon: "Lausanne, gare -> Flon" e-bike 2.7 km then walk + m2 0.3 km (17 min) while e-bike all the way takes 8 min.
   These are near-duplicates of transit and clutter the list.

10. **P+Rail parking CHF 0.** bulle-fribourg "Matran, école" and nyon-geneve "Genève, Maison de la Paix" have parking.day 0.
    Probably unknown rather than free; should be flagged as estimated or dropped.

11. **Door-to-door time looks long for IC trips.** zurich-hb-winterthur 32 min Zürich HB -> Winterthur (IC takes 20 min); nyon-geneve
    31 min (IR 15-20 min); bikeRide from Stadelhofen is 5 min faster than leaving from HB.

12. **No GA alternative on city P+R options.** cityParkRide products never include the GA (10 WARNs in the first run), although a GA is always
    possible, and they carry zonePassMonthly = 0.

13. **Near-duplicate transit options.** bulle-fribourg transit-2 and transit-3 (same stops, 63 vs 75 min, same price).

Checked and looked fine: Echallens LEB 35 min / 4 zones / CHF 1'305; Renens -> CHUV 2 zones CHF 729; Yverdon IC 37 min / 9 zones CHF 2'376;
GA 4'095 (2nd) and 6'770 (1st); Half Fare holder gets no discount on zone passes (correct); 1st class 1.7x; youth/senior GA 2'875/3'260;
the part-timer (188 trips) correctly flips to a Flexi pass (CHF 1'320); chapelle-sur-moudon has no train but a 57 min bus + m2 with only 2 departures in the window.
