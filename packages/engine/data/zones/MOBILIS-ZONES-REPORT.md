# Mobilis stop to fare-zone table: quality report

Generated 2026-11-10T13:46:41Z by `tools/mobilis-zones/` (see its README for how to rerun). Output: `packages/engine/data/zones/mobilis-stops.json`.

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
| exact | 318 | 308 | 10 | 0 |
| normalised | 56 | 40 | 14 | 2 |
| locality | 372 | 0 | 295 | 77 |
| fuzzy | 3 | 0 | 0 | 3 |
| none | 16 | 0 | 0 | 16 |
| **total** | 765 | 348 | 319 | 98 |

Flags: geoFiltered=11, geoOutlier=20, labelFar=20, labelShared=38, noGtfsMatch=16, railMarkerNoRailStation=5

What the match types mean: `exact` = identical GTFS station name; `normalised` = identical after case/accent/hyphen/comma/Saint folding; `locality` = the plan label is a village name and the candidates are the GTFS stops of that village (`via: town`) or the plan label equals the stop part of "Town, Stop" (`via: stop-part`); the first candidate is the preferred one (gare/village/centre/poste first) but **the zone applies to the whole village drawn as one point, the specific stop is not identified**; `fuzzy` = similar spelling (rapidfuzz ratio >= 86).
Confidence: high = exact/normalised, label within 9 pt, no flags; medium = locality (<=3 candidates) or high with one flag; low = more than 3 locality candidates, fuzzy, geographic outlier, no GTFS match. Candidates that are geographic outliers of a zone are dropped from locality lists when others remain (`geoFiltered`).

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
- Stops labelled Lausanne / Lausanne-Flon: Lausanne-Flon zones [11, 12] (8501181); Lausanne zones [11, 12] (8501120)
- PDF legend: "Pour les voyages des zones 62, 63, 72, 79 directement vers les zones 160, 161 ..." (direct lines, contiguity is not claimed). Polygon gap to nearest of 160/161 in svg units (plan is ~5200 wide): {62: 118, 63: 0, 72: 0, 79: 0} - all are close, 63 and 72 and 79 touch.
- PDF legend: "zones 126 et 127 ... Onde verte" (each exclusively inside; no adjacency claimed). Polygons 126/127 are 626 units apart, so they are correctly not contiguous in the drawing nor in mobilis-plan.json (126 -> [125], 127 -> [120]).
- Frimobil zone list in the legend ([100, 105, 106, 107, 130, 131, 132, 133, 134, 135, 160, 161, 182, 183]) -> zone-number labels exist for all of them: True.
- Visual check: rendered the PDF and drew marker-to-label assignment lines for central Lausanne and Vevey/Montreux; labels were attached to the right markers apart from dense interchange clusters (see problems).

## 30 random rows (seed 20251030)

| label | kind | zones | first GTFS candidate | confidence | flags |
|---|---|---|---|---|---|
| Union-Prilly | rail | 12 | Union-Prilly (8501162) exact 1.00 | medium | labelFar,labelShared |
| Vernand-Camarès | rail | 16 | Vernand-Camarès (8501168) exact 1.00 | medium | labelFar,labelShared |
| Treytorrens | bus | 54,105 | Treytorrens (Payerne), village (8577614) locality 0.60 +2 more | medium |  |
| Premier | bus | 112 | Premier, village (8570228) locality 0.60 +2 more | medium |  |
| Vallon | bus | 133 | Vallon, village (8570413) locality 0.60 +1 more | medium |  |
| Belmont-sur-Yverdon | bus | 41 | Belmont-sur-Yverdon, Battoir (8507653) locality 0.60 +1 more | medium |  |
| Lavigny | bus | 28,34 | Lavigny, café (8504653) locality 0.60 +2 more | medium |  |
| Les Esserts-de-Rive | bus | 117,118 | Les Esserts-de-Rive (8501154) exact 1.00 | high |  |
| Pra Grana | bus | 12,19 | Grandvaux, Pra Grana (8588454) locality 0.70 | medium |  |
| Le Day | rail | 110 | Le Day (8501104) exact 1.00 | high |  |
| Les Bioux | bus | 118 | Les Bioux (lac) (8530623) normalised 0.95 | high |  |
| Aux Caudreys | bus | 145 | Le Sépey, Aux Caudreys (8570622) locality 0.70 | medium |  |
| Donneloye | bus | 54 | Donneloye, poste (8507674) locality 0.60 +3 more | low |  |
| Perrey | bus | 79 | Attalens, Perrey (8504957) locality 0.70 | medium |  |
| Essertes | bus | 62,65 | Essertes, village (8570461) locality 0.60 +1 more | medium | labelShared |
| Mont-la-Ville | bus | 38,115 | Mont-la-Ville, Le Battoir (8570155) locality 0.75 | medium |  |
| Eclépens | bus | 53 | Eclépens (8501114) exact 1.00 | high |  |
| Les Moulins, Les Chabloz | bus | 186 | Les Moulins, Les Chabloz (8501343) exact 1.00 | high |  |
| Moulin Peney | bus | 58,61 | Peney-le-Jorat, Moulin Peney (8570346) locality 0.70 | medium |  |
| Les Neyres | bus | 86 | Les Neys (8530378) fuzzy 0.89 | low |  |
| Lonay-Préverenges | bus | 12,33 | Lonay-Préverenges (8501048) exact 1.00 | high | labelShared |
| Champagne | bus | 122,124 | Champagne, collège (8504989) locality 0.60 +2 more | medium |  |
| Les Esserts-de-Rive | rail | 117,118 | Les Esserts-de-Rive (8501154) exact 1.00 | high | labelShared |
| Cugy | rail | 100,106,107 | Cugy FR (8504133) normalised 0.95 | high |  |
| Les Preises | bus | 171 | Les Diablerets, Les Preises (8571278) locality 0.70 | medium |  |
| Les Véneresses | bus | 153 | Bex, Les Véneresses (8570648) locality 0.70 | medium |  |
| Bussigny | rail | 15 | Bussigny (8501117) exact 1.00 | high |  |
| Oron-le-Châtel | rail | 62 | Oron-le-Châtel, gare (8577681) locality 0.60 +2 more | low | railMarkerNoRailStation |
| Pampigny-Sévery | rail | 37 | Pampigny-Sévery (8501097) exact 1.00 | high | labelShared |
| Dompierre | bus | 103 | Dompierre FR (8504124) normalised 0.95 | medium | geoOutlier |

## Known problems

- **Villages, not stops**: ~49% of entries are `locality` matches. The plan draws one dot per village; the zone is right for the dot, but which GTFS stop it is cannot be told from the plan. Use the zone for any stop whose GTFS station lies in that village, preferably via the candidate list.
- Zones with no stop entry: [166] (all 155 zones have a polygon and number label). Zones with <=2 stops: [24, 25, 43, 45, 66, 67, 78, 85, 87, 95, 101, 108, 111, 127, 131, 143, 148, 155, 157, 158, 162, 163, 164, 165, 167, 168, 170, 172, 174, 180, 181, 182, 184, 187, 188].
- Dense interchange clusters (Lausanne centre, Vevey, Montreux, Villars area) have several markers (rail, metro, bus dot) within a few points; label assignment there is least reliable. Markers sharing a label are flagged `labelShared`.
- 24 markers have no label within reach and 25 outside-region diamond bus markers (towns beyond the zone map such as Fribourg-side or Valais-side stops) have no zone; they are in `unmatchedMarkers`.
- Fuzzy and a few spelling variants (Avry vs Avry-Matran, Collombey-le-Grand, Valeyres, Bretigny, Oulens, Mézery, Fenil, Essertines-sur-Yverdon ...) are unmatched; the plan uses commune or colloquial names that GTFS does not use verbatim.
- Zone labels printed at stops outside Vaud (FR/NE/VS/F) are not zone-valued.
- Plan validity is one timetable year older than the GTFS (see top).
- The geographic outlier check uses zone medians of exact/normalised matches, floor 3 km on the robust SD, and flags only deviations of > 3 SD and > 3 km; large mountain zones can still hide wrong village picks.
