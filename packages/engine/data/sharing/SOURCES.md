# Shared bikes: operators and prices

Read on 11.11.2026. `bike-share.json` lists the station-based bike-share operators of the
national shared-mobility feed (sharedmobility.ch, Swiss Federal Office of Energy; the feed MOTIS
loads, see `data/motis/GBFS.md`) and what a daily commute costs with each. A price that could not
be found is `null`: the planner then says that the price is unknown. Nothing is estimated.

## What the feed contains (stations with bicycles, 11.11.2026)

| Area | Operator (feed provider id) | Stations |
|---|---|---|
| Geneva canton | Donkey Republic (`donkey_ge`) | 621 in the feed, 529 in the city box |
| Lausanne | EPFL campus bikes (`epfl_lausanne`) | 6. No PubliBike or other network in the feed |
| Fribourg | Velospot (`velospot`) | 62 (PickEBike: 4 stations, free-floating otherwise) |
| Bern | Velospot | 275 |
| Zürich | Velospot | 259 |
| Basel | Velospot | 293 |
| Biel/Bienne | Velospot | 53 |
| Yverdon-les-Bains | Donkey Republic (`donkey_yverdon-les-bains`) | 80 |
| Neuchâtel | Donkey Republic (`donkey_neuchatel`) | 48 in the town box, 69 in all |
| Vevey–Montreux | Velospot | 22 |
| Sion / Sierre | Velospot | 41 / 17 |
| Martigny, Aigle–Monthey, La Chaux-de-Fonds | Velospot (e-bikes) | 26, 18, 20 |
| Lugano | Velospot | 48 |
| Luzern | nextbike (`nextbike_ch`) | 111 (399 in all) |
| Chur | invia BikeShare (`nextbike_ms`) | 24 (60 in all) |
| Thun | Donkey Republic (`donkey_thun`) | 37 |
| Kreuzlingen | Donkey Republic (`donkey_kreuzlingen`) | 9 |
| Nyon, Gland, Morges, Bulle, Delémont | none with bicycles at stations | 0 |

PubliBike no longer appears under its own name: PubliBike and Velospot are one operator
("PubliBike Velospot", one feed provider `velospot`, 1,684 stations in Switzerland).

Left out on purpose (free-floating or mostly scooters, not a station-based bike network): Voi,
Lime, Bolt, Dott, PickEBike, carvelo (cargo bikes, returned where taken), Sponti-Car, Share
Birrer, LIEmobil. The planner only asks MOTIS for the providers listed in `bike-share.json`.

## Prices

| Operator | Annual subscription | Included | Pay as you go | Source |
|---|---|---|---|---|
| PubliBike Velospot | "B-Fit Local" CHF 69 a year in Aarau, Agglo Valais Central, Basel, Bern, Biel/Bienne, Fribourg, Riviera, Ticino, Zürich | Bike: first 30 min of each ride free, then CHF 0.10/min. E-bike: CHF 2 for the first 15 min, CHF 1 for the next 15, then CHF 0.20/min | "B-Quick National": bike CHF 3 for 30 min then CHF 0.10/min; e-bike CHF 5 for 30 min then CHF 0.20/min | https://www.publibike.ch/fr/abos (operator, read 11.11.2026) |
| PubliBike Velospot, e-bike only networks | Martigny, Aigle: CHF 69 (e-bike rides paid as above) or "E-Bike" CHF 199 (first 15 min free, next 15 CHF 2). La Chaux-de-Fonds – Le Locle: CHF 49 or CHF 169 | as stated | as above | same page |
| Donkey Republic, Geneva (VéloPartage) | **not found** (`null`) | | Bike: 15 or 30 min CHF 2, 1 h CHF 3.50. E-bike: 15 min CHF 3.10, 30 min CHF 5, 1 h CHF 7.50 | https://www.geneve.com/fr/attractions/detail/velopartage-les-velos-en-libre-service-officiels-du-canton-de-geneve (Geneva Tourism; its linked price sheet is dated March 2026) |
| Donkey Republic, Yverdon-les-Bains | CHF 45 a year | one hour free per rental | not found | City press release of 8.7.2020: https://www.yverdon-les-bains.ch/fileadmin/user_upload/Comm_presse_Velos_libre-service_lancement_saison_estivale.pdf. Old: shown with its year |
| Donkey Republic, Neuchâtel | CHF 60 a year | 12 hours per rental | not found | EPFL staff page (regular price next to the EPFL price of CHF 48): https://www.epfl.ch/campus/mobility/fr/mobilite-et-voyages/mobilite-pendulaire/autres-services-autour-du-velo/donkey-republic-a-neuchatel/ |
| Donkey Republic, Thun and Kreuzlingen | not found | | not found | |
| nextbike (Luzern and region) | none listed | Residents of partner municipalities: first 30 min free on a classic bike | Bike CHF 2 for 30 min, then CHF 1 per 15 min; e-bike CHF 4 for 30 min, then CHF 2 per 15 min | https://www.nextbike.ch/ (operator) |
| invia BikeShare (Chur), EPFL campus bikes | not researched / not public | | | |

The Velospot areas in the data file are boxes drawn generously around each town; outside them
the planner uses the pay-as-you-go price, since the page names no subscription there.

## Not found, or not readable

- **Donkey Republic's own prices.** donkey.bike (city pages and /pricing) shows no amounts:
  "prices vary depending on the city", to be seen in the app. No annual price for Geneva could
  be confirmed anywhere, so Geneva is priced per ride. Genèveroule, which maintains the bikes, says the
  same: "All rates are directly in the app" (https://www.geneveroule.ch/en/velopartage/).
- **Geneva, offer for public transport pass holders.** tpg sells Donkey Republic subscriptions
  of 3 or 6 months at a reduced price to holders of an annual unireso pass (terms of July 2024:
  https://tpg.ch/sites/default/files/2024-07/CGVU-Offre-Velopartage-tpg-07.2024.pdf, product
  sheet https://tpg.ch/sites/default/files/2024-09/tpgcommunes-Fiche-Produit-velopartage.pdf).
  Both documents answered 403 to an automated request and were not read; no price from them is
  used. The canton's page (https://www.ge.ch/teaser/velopartage) gives no prices; it says that
  some communes subsidise the subscription (Bernex, Carouge, Confignon, Meyrin,
  Pregny-Chambésy, Versoix) and that students of HES-SO Genève ride free.
- **Employer and partner rates** ("BusinessBike" of PubliBike Velospot, University of Fribourg,
  TCS members 20 % off): they exist, without a public price; not used.
- **Mobilis, Frimobil:** no bike-share offer tied to these passes was found.
- https://www.yverdonlesbainsregion.ch/en/P69606 (CHF 45 a year or CHF 6 a month) answered 404
  when opened; known only from a search result.

## How the planner uses it

Cheapest of the subscriptions valid where the bike is taken (annual price plus what each ride
costs beyond the included minutes), or, when no subscription price is known, the pay-as-you-go
price times the rides of a year. Rides are priced on a classic bike wherever the network has
some; the extra cost of an e-bike is given as a remark.
