# Mobilis stop to fare-zone table: quality report

Generated 2026-11-10T14:09:15Z by `tools/mobilis-zones/` (see its README for how to rerun). Output: `packages/engine/data/zones/mobilis-stops.json`.

## Validity of the plan

- `plan-general.pdf` prints **"Valable dès le 14.12.2025"** (valid from 14 December 2025, i.e. timetable year 2026). PDF created/modified 2025-10-30.
- `plan-page.html` contains no validity text (searched for "valable", "202x", "décembre").
- The GTFS feed in `data/raw/gtfs.zip` is timetable 2027 (`SBB,https://sbb.ch,DE,20261213,20271211,20261107`). `grille-tarifaire-h27.txt` is headed "Grille tarifaire dès le 13 décembre 2026". **The zone plan is therefore one timetable year older than the GTFS and the H27 tariff grid**; zone changes on 13.12.2026 would not be reflected.

## Counts

| item | n |
|---|---|
| zone polygons parsed (all unique ids region_N) | 155 (137 polygon, 16 rect, 2 path; 3 rects carry a rotate(-45) transform, applied) |
| `HaltBahn` + `HaltBus` elements in the SVG | 1075 (276 + 799) |
| of which real stop markers | 814 (rail/metro 276, bus 538) |
| `HaltBus` elements that are NOT stops | 261 (pictogram glyph paths in `<g id="text">`, legend icons) - excluded |
| markers with at least one zone | 789 |
| border markers (centre within 4 units of 2+ polygons; valid in all) | 123 |
| markers outside every polygon | 25 (all are diamond-shaped bus markers in `busshapes`, 18-100 units from the nearest polygon; listed in `unmatchedMarkers`) |
| markers with a name label assigned (of zoned) | 765 (97.0%) |
| entries in `stops` (zoned + labelled) | 765 (rail 271, bus 494) |
| zoned markers without label (`unmatchedMarkers`) | 24 |
| PDF text labels not assigned to any marker (`unmatchedLabels`) | 28 of 777 labels (mostly outside-region towns, canton tags, legend/lake texts) |

### GTFS matching (primary candidate match type, per stop entry)

| match | stops | high | medium | low |
|---|---|---|---|---|
| exact | 261 | 260 | 1 | 0 |
| normalised | 34 | 30 | 3 | 1 |
| locality | 448 | 0 | 338 | 110 |
| fuzzy | 5 | 0 | 0 | 5 |
| none | 17 | 0 | 0 | 17 |
| **total** | 765 | 290 | 342 | 133 |

Flags: geoFiltered=20, geoOutlier=8, labelFar=20, labelShared=38, noGtfsMatch=17, railMarkerNoRailStation=6

What the match types mean: `exact` = the whole label equals the whole GTFS station name (a label "X-sur-Y" never matches "Y"; the individual lines of a stacked label are used only as weak `locality` hints, via `label-line`); `normalised` = identical after case/accent/hyphen/comma/Saint folding; `locality` = the plan label is a village name and the candidates are the GTFS stops of that village (`via: town`) or the plan label equals the stop part of "Town, Stop" (`via: stop-part`); the first candidate is the preferred one (gare/village/centre/poste first) but **the zone applies to the whole village drawn as one point, the specific stop is not identified**; `fuzzy` = similar spelling (rapidfuzz ratio >= 86).
Confidence: high = exact/normalised, label within 9 pt, no flags; medium = locality (<=3 candidates) or high with one flag; low = more than 3 locality candidates, fuzzy, geographic outlier, no GTFS match. Candidates that are geographic outliers of a zone are dropped from locality lists when others remain (`geoFiltered`).

### Station check (plan label -> zones)

Entries whose normalised label equals the station name (a trailing `*` in the query = starts with). Zones come from the marker geometry only; "-" = no label with that name has a zoned marker.

| station | plan label(s) | kind | zones | first GTFS candidate |
|---|---|---|---|---|
| Renens VD (8501118) | Renens | rail | 12 | Renens VD (8501118) normalised |
| Prilly-Malley | Prilly-Malley | rail | 11,12 | Prilly-Malley (8518452) exact |
| Pully | Pully | bus | 12 | Pully, gare (8588445) locality |
| Pully | Pully | bus | 11,12 | Pully, gare (8588445) locality |
| Pully | Pully | rail | 11,12 | Pully (8501121) exact |
| Lutry | Lutry | bus | 12 | Lutry, gare (8593861) locality |
| Lutry | Lutry | bus | 12 | Lutry, gare (8593861) locality |
| Lutry | Lutry | rail | 12 | Lutry (8501122) exact |
| Cully | Cully | rail | 19 | Cully (8501124) exact |
| Bussigny | Bussigny | rail | 15 | Bussigny (8501117) exact |
| Cossonay-Penthalaz | Cossonay-Penthalaz | rail | 44 | Cossonay-Penthalaz (funi) (8593755) normalised |
| Cossonay-Penthalaz | Cossonay-Penthalaz | rail | 44 | Cossonay-Penthalaz (8501115) exact |
| Montreux | Montreux | rail | 73 | Montreux (8501300) exact |
| Aigle | Aigle | rail | 80 | Aigle (8501400) exact |
| Bex | Bex | rail | 84 | Bex (8501402) exact |
| Payerne | Payerne | rail | 100 | Payerne (8504134) exact |
| Avenches | Avenches | rail | 130 | Avenches (8504126) exact |
| Vallorbe | Vallorbe | rail | 110 | Vallorbe (8501103) exact |
| Le Sentier-L'Orient | Le Sentier-L’Orient | bus | 119 | Le Sentier-L'Orient, gare (8579146) locality |
| Gland | Gland | rail | 23 | Gland (8501031) exact |
| Rolle | Rolle | rail | 25 | Rolle (8501033) exact |
| Allaman | Allaman | rail | 26 | Allaman (8501035) exact |
| St-Prex | St-Prex | rail | 31 | St-Prex (8501036) exact |
| Yverdon-les-Bains | Yverdon-les-Bains | rail | 40 | Yverdon-les-Bains (8504200) exact |
| Grandson | Grandson | rail | 123 | Grandson (8504201) exact |
| Ste-Croix | Ste-Croix | rail | 120 | Ste-Croix (8504298) exact |
| Orbe | Orbe | rail | 48 | Orbe (8501191) exact |
| Chavornay | Chavornay | rail | 42,43 | Chavornay (8501112) exact |
| La Sarraz | La Sarraz | bus | 49 | La Sarraz, gare (8570142) locality |
| La Sarraz | La Sarraz | rail | 49 | La Sarraz (8501108) exact |
| Echallens | Echallens | rail | 50,51 | Echallens (8501173) exact |
| Bercher | Bercher | rail | 52 | Bercher (8501177) exact |
| Cheseaux(-sur-Lausanne) | Cheseaux-sur-Lausanne | rail | 16 | Cheseaux (8501169) locality |
| Romanel(-sur-Lausanne) | Romanel-sur-Lausanne | bus | 12,17 | Romanel-sur-Lausanne (8501166) exact |
| Epalinges | Epalinges | rail | 12 | Epalinges, Croisettes (8579239) locality |
| Epalinges | Epalinges | bus | 12 | Epalinges, Polny (8591969) locality |
| Epalinges | Epalinges | bus | 12 | Epalinges, Polny (8591969) locality |
| Le Mont-sur-Lausanne | - | - | - | NOT FOUND (no such label on the plan) |
| Savigny | Savigny | bus | 18 | Savigny, centre (8504173) locality |
| Oron | Oron-la-Ville | bus | 62 | Oron-la-Ville, gare routière (8579800) locality |
| Oron | Oron-le-Châtel | rail | 62 | Oron-le-Châtel, gare (8577681) locality |
| Palezieux | Palézieux | rail | 63 | Palézieux, gare (8570440) locality |
| Palezieux | Palézieux | rail | 63 | Palézieux (8504014) exact |
| Puidoux | Puidoux | bus | 64 | Puidoux, gare (8570567) locality |
| Puidoux | Puidoux | rail | 64 | Puidoux (8504012) exact |
| Chexbres | Chexbres-Village | - | - | NOT FOUND with a zone (label on plan: no marker within reach) |
| Vevey | Vevey | rail | 70 | Vevey (8501200) exact |
| La Tour-de-Peilz | La Tour-de-Peilz | rail | 70 | La Tour-de-Peilz (8501201) exact |
| Blonay | Blonay | rail | 74 | Blonay (8501281) exact |
| Villeneuve VD | Villeneuve | bus | 102 | Villeneuve FR, grande salle (8505816) locality |
| Villeneuve VD | Villeneuve | rail | 77 | Villeneuve VD (8501303) exact |
| Leysin | Leysin-Village | rail | 144 | Leysin-Village (8501481) exact |
| Leysin | Leysin-Feydey | rail | 144 | Leysin-Feydey (8501482) exact |
| Leysin | Leysin-Grand-Hôtel | rail | 144 | Leysin-Grand-Hôtel (8501483) exact |
| Les Diablerets | Les Diablerets | rail | 147,170 | Les Diablerets (8501479) exact |
| Chateau-d'Oex | Château-d‘Oex | rail | 186 | Château-d'Oex (8501394) normalised |

### Station-claim conflicts

Each GTFS station may be an exact/normalised match of only one marker. 9 later claims were demoted (the weaker marker lost the station and was re-matched without it: Cossonay-Penthalaz rail zones [44] lost 8501115; Mex bus zones [15] lost 8580440; Attalens La Fin bus zones [63, 79] lost 8579191; St-Saphorin bus zones [32] lost 8501127; Vernand-Camarès rail zones [16] lost 8501168; Les Planches rail zones [145] lost 8501473; Palézieux rail zones [63] lost 8504014; Corbier rail zones [83] lost 8501726; Union-Prilly rail zones [12] lost 8501162). **Remaining conflicts: 0**.

## Zone derivation

Distance from each marker centre to the second-nearest polygon (for markers inside one polygon; to the nearest one for markers outside all) has bins [0.0, 0.5, 1.0, 2.0, 3.0, 4.0, 6.0, 8.0, 12.0, 20.0, 50.0] (svg units) with counts [121, 3, 0, 2, 0, 0, 0, 3, 26, 315, 344]. Gap: nothing between 3 and 6 units, so the tolerance of 4 units (marker radius 4-8.5 units, polygon strokes ~4.5) separates "on the border" from "inside" without ambiguity. Markers beyond 6 units are either interior markers or the outside-zone diamond markers. Edge-of-map markers within tolerance of only one polygon get that single zone.

## Adjacency validation (mobilis-plan.json vs polygons)

- zones: plan 155, SVG 155, missing either way: none.
- plan adjacency is symmetric (0 asymmetric pairs). Plan edges: 236. Polygon pairs in edge contact (shared boundary >= 8 units, gap <= 3): 313.
- **Every plan edge is confirmed by polygons (236/236, recall 100%)**, and no plan edge touches only at a corner.
- 77 polygon contacts are NOT in mobilis-plan.json (precision 75%). Examples: 102-105, 111-115, 113-114, 114-121, 118-165, 119-164, 12-64, 121-127. 7 of them involve a Frimobil/common/Onde-verte zone (100-107, 126, 127, 130-135, 160, 161, 182, 183), consistent with the plan json listing only Mobilis-internal neighbours; the rest (e.g. 12-64, 15-16, 20-22) are real boundary contacts that the json simply does not list, so the json is a subset of geometric adjacency, not an equivalent definition. Polygons are therefore not contradicted by the json.
- Independent check: all 155 PDF zone-number labels fall inside the polygon of the same number after registration (155/155).

## Registration PDF to SVG

Shapes, not text, were used: the PDF carries the markers as vector circles (rail: 3.8 pt white circles, bus: 2.6 pt cyan dots). A Hough vote over scale/translation on rail markers found the transform (275/275 votes), refined by iterated mutual-nearest-neighbour least squares over all markers. The PDF is the same drawing: pure scale 0.2250 with no rotation/shear (svg = 4.4444 * pdf + t).

- matched marker pairs: rail 275/275 PDF (svg 276), bus 538/540 PDF (svg 538); total 813 of 814 real SVG markers.
- residuals (svg units): rms 0.0048, p95 0.0078, max 0.0102 (marker pitch ~10-17 units), i.e. exact.
- SVG markers without a PDF twin: 1 (rail at svg (4037, 2943)); PDF marker-coloured shapes without an SVG twin: 2 (legend icons).

## Name labels

Text was rebuilt from characters in content-stream order (pdfplumber word grouping garbled overlapping lines), split into lines by font/size/baseline, and stacked lines merged when hyphen-ended or aligned (centre/left/right) at line pitch; trailing canton tags (VD, FR, ...) are stripped into `canton`. Markers were assigned labels with the Hungarian algorithm on marker-to-text-box distance (max 13 pt, 19.5 pt for 9 pt city names), then a second pass lets a marker without label share the label of a labelled marker within 12 pt (station + metro stop, flagged `labelShared`). Median marker-label distance 4.1 pt; 90th percentile 5.9 pt.

## Spot checks against facts printed in the PDF

- Zone-number labels (13.5 pt numbers in the PDF) located inside their own SVG polygon after registration: see counts above (all 155 expected).
- PDF legend: "Les zones 11 et 12 couvrant le périmètre Grand Lausanne ..." -> polygons 11 and 12 touch: True.
- Stops labelled Lausanne / Lausanne-Flon: Lausanne-Flon zones [11, 12] (8591818); Lausanne zones [11, 12] (8501120)
- PDF legend: "Pour les voyages des zones 62, 63, 72, 79 directement vers les zones 160, 161 ..." (direct lines, contiguity is not claimed). Polygon gap to nearest of 160/161 in svg units (plan is ~5200 wide): {62: 118, 63: 0, 72: 0, 79: 0} - all are close, 63 and 72 and 79 touch.
- PDF legend: "zones 126 et 127 ... Onde verte" (each exclusively inside; no adjacency claimed). Polygons 126/127 are 626 units apart, so they are correctly not contiguous in the drawing nor in mobilis-plan.json (126 -> [125], 127 -> [120]).
- Frimobil zone list in the legend ([100, 105, 106, 107, 130, 131, 132, 133, 134, 135, 160, 161, 182, 183]) -> zone-number labels exist for all of them: True.
- Visual check: rendered the PDF and drew marker-to-label assignment lines for central Lausanne and Vevey/Montreux; labels were attached to the right markers apart from dense interchange clusters (see problems).

## 30 random rows (seed 20251030)

| label | kind | zones | first GTFS candidate | confidence | flags |
|---|---|---|---|---|---|
| Union-Prilly | rail | 12 | Union-Prilly (8501162) locality 0.50 | low | labelFar,labelShared |
| Vernand-Camarès | rail | 16 | Vernand-Camarès (8501168) locality 0.50 | low | labelFar,labelShared |
| Treytorrens | bus | 54,105 | Treytorrens (Payerne), village (8577614) locality 0.60 +2 more | medium |  |
| Premier | bus | 112 | Premier, village (8570228) locality 0.60 +2 more | medium |  |
| Vallon | bus | 133 | Vallon, village (8570413) locality 0.60 +1 more | medium |  |
| Belmont-sur-Yverdon | bus | 41 | Belmont-sur-Yverdon, Battoir (8507653) locality 0.60 +1 more | medium |  |
| Lavigny | bus | 28,34 | Lavigny, café (8504653) locality 0.60 +2 more | medium |  |
| Les Esserts-de-Rive | bus | 117,118 | Le Lieu, Les Esserts de Rive (8507214) locality 0.70 | medium |  |
| Pra Grana | bus | 12,19 | Grandvaux, Pra Grana (8588454) locality 0.70 | medium |  |
| Le Day | rail | 110 | Le Day (8501104) exact 1.00 | high |  |
| Les Bioux | bus | 118 | Les Bioux, école (8579141) locality 0.60 +3 more | low |  |
| Aux Caudreys | bus | 145 | Le Sépey, Aux Caudreys (8570622) locality 0.70 | medium |  |
| Donneloye | bus | 54 | Donneloye, poste (8507674) locality 0.60 +3 more | low |  |
| Perrey | bus | 79 | Attalens, Perrey (8504957) locality 0.70 | medium |  |
| Essertes | bus | 62,65 | Essertes, village (8570461) locality 0.60 +1 more | medium | labelShared |
| Mont-la-Ville | bus | 38,115 | Mont-la-Ville, Le Battoir (8570155) locality 0.75 | medium |  |
| Eclépens | bus | 53 | Eclépens, gare (8570139) locality 0.60 +3 more | low |  |
| Les Moulins, Les Chabloz | bus | 186 | Les Moulins, Les Chabloz (8501343) exact 1.00 | high |  |
| Moulin Peney | bus | 58,61 | Peney-le-Jorat, Moulin Peney (8570346) locality 0.70 | medium |  |
| Les Neyres | bus | 86 | Les Neys (8530378) fuzzy 0.89 | low |  |
| Lonay-Préverenges | bus | 12,33 | Lonay-Préverenges, gare sud (8595218) locality 0.60 +1 more | medium | labelShared |
| Champagne | bus | 122,124 | Champagne, collège (8504989) locality 0.60 +2 more | medium |  |
| Les Esserts-de-Rive | rail | 117,118 | Les Esserts-de-Rive (8501154) exact 1.00 | high | labelShared |
| Cugy | rail | 100,106,107 | Cugy FR (8504133) normalised 0.95 | high |  |
| Les Preises | bus | 171 | Les Diablerets, Les Preises (8571278) locality 0.70 | medium |  |
| Les Véneresses | bus | 153 | Bex, Les Véneresses (8570648) locality 0.70 | medium |  |
| Bussigny | rail | 15 | Bussigny (8501117) exact 1.00 | high |  |
| Oron-le-Châtel | rail | 62 | Oron-le-Châtel, gare (8577681) locality 0.60 +2 more | low | railMarkerNoRailStation |
| Pampigny-Sévery | rail | 37 | Pampigny-Sévery (8501097) exact 1.00 | high | labelShared |
| Dompierre | bus | 103 | Dompierre VD, village (8570473) locality 0.60 | medium | geoFiltered:2 |

## Known problems

- **Villages, not stops**: ~59% of entries are `locality` matches. The plan draws one dot per village; the zone is right for the dot, but which GTFS stop it is cannot be told from the plan. Use the zone for any stop whose GTFS station lies in that village, preferably via the candidate list.
- Zones with no stop entry: [166] (all 155 zones have a polygon and number label). Zones with <=2 stops: [24, 25, 43, 45, 66, 67, 78, 85, 87, 95, 101, 108, 111, 127, 131, 143, 148, 155, 157, 158, 162, 163, 164, 165, 167, 168, 170, 172, 174, 180, 181, 182, 184, 187, 188].
- Dense interchange clusters (Lausanne centre, Vevey, Montreux, Villars area) have several markers (rail, metro, bus dot) within a few points; label assignment there is least reliable. Markers sharing a label are flagged `labelShared`.
- 24 markers have no label within reach and 25 outside-region diamond bus markers (towns beyond the zone map such as Fribourg-side or Valais-side stops) have no zone; they are in `unmatchedMarkers`.
- Fuzzy and a few spelling variants (Avry vs Avry-Matran, Collombey-le-Grand, Valeyres, Bretigny, Oulens, Mézery, Fenil, Essertines-sur-Yverdon ...) are unmatched; the plan uses commune or colloquial names that GTFS does not use verbatim.
- Zone labels printed at stops outside Vaud (FR/NE/VS/F) are not zone-valued.
- Plan validity is one timetable year older than the GTFS (see top).
- The geographic outlier check uses zone medians of exact/normalised matches, floor 3 km on the robust SD, and flags only deviations of > 3 SD and > 3 km; large mountain zones can still hide wrong village picks.
