# Mobilis stop -> fare-zone table

Builds `packages/engine/data/zones/mobilis-stops.json` and `MOBILIS-ZONES-REPORT.md` from the two Mobilis drawings
(`plan-page.html` SVG, `plan-general.pdf`), `mobilis-plan.json` and the GTFS `stops.txt`.

Requirements: Python 3.13 with `pdfplumber`, `numpy`, `scipy`, `shapely`, `svgelements`, `rapidfuzz`
(`pip install shapely scipy numpy svgelements rapidfuzz`). All scripts take paths as arguments and are run with `python3 -I`.

## One command

From this directory:

    sh run_all.sh ../../data/raw ../../packages/engine/data/zones

`gtfs_modes.py` (which streams the 1.4 GB `stop_times.txt`, about 3 minutes) only runs if `out/stop_modes.json` is missing.
Intermediate files go to `out/` (git-ignored).

## Steps

    python3 -I parse_svg.py   data/raw/mobilis/plan-page.html out/svg.json          # zone polygons + stop markers (+ group id)
    python3 -I register.py    data/raw/mobilis/plan-general.pdf out/svg.json out/pdf.json   # PDF->SVG affine from marker shapes; PDF characters
    python3 -I adjacency.py   out/svg.json data/raw/mobilis/mobilis-plan.json out/adjacency.json
    python3 -I labels.py      out/svg.json out/pdf.json out/markers.json              # zones per marker, text labels, marker<->label assignment
    python3 -I gtfs_modes.py  data/raw/gtfs.zip out/stop_modes.json                   # route types serving each station (rail vs bus)
    python3 -I match.py       out/markers.json data/raw/gtfs.zip out/stop_modes.json out/matched.json
    python3 -I build_output.py out/matched.json out/svg.json out/pdf.json out/adjacency.json data/raw/mobilis/mobilis-plan.json data/raw/gtfs.zip \
        packages/engine/data/zones/mobilis-stops.json packages/engine/data/zones/MOBILIS-ZONES-REPORT.md

## Key facts and parameters

- Real stop markers are `HaltBahn`/`HaltBus` elements outside `<g id="text">` (the 261 `HaltBus` paths there are legend pictograms).
- Border tolerance 4 svg units (`labels.py: BORDER_TOL`): a marker within it of several polygons belongs to all of them.
- The PDF is the same drawing scaled by 0.225; registration uses the marker shapes, residual < 0.01 units.
- Label assignment: max 13 pt marker-to-text distance, soft penalty for bold/regular mismatch (rail markers use bold labels).
- GTFS stations: `location_type=1` inside lat 46.15-47.0, lon 6.0-7.3; `stopId` in the output is the `didok` number, `gtfsId` the parent station id.
- Geographic outlier flag: > 3 robust SD (floor 3 km) and > 3 km from the zone median of exact/normalised matches.
