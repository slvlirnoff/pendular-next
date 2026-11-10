#!/bin/sh
# Rebuild everything. Run from tools/mobilis-zones/ : sh run_all.sh <raw-dir> <engine-zones-dir>
# raw-dir: data/raw (contains mobilis/ and gtfs.zip); engine-zones-dir: packages/engine/data/zones
RAW=${1:-../../data/raw}; OUT=${2:-../../packages/engine/data/zones}
set -e
mkdir -p out
python3 -I parse_svg.py "$RAW/mobilis/plan-page.html" out/svg.json
python3 -I register.py "$RAW/mobilis/plan-general.pdf" out/svg.json out/pdf.json
python3 -I adjacency.py out/svg.json "$RAW/mobilis/mobilis-plan.json" out/adjacency.json
python3 -I labels.py out/svg.json out/pdf.json out/markers.json
[ -f out/stop_modes.json ] || python3 -I gtfs_modes.py "$RAW/gtfs.zip" out/stop_modes.json   # ~3 min, streams 1.4 GB stop_times
python3 -I match.py out/markers.json "$RAW/gtfs.zip" out/stop_modes.json out/matched.json
python3 -I build_output.py out/matched.json out/svg.json out/pdf.json out/adjacency.json "$RAW/mobilis/mobilis-plan.json" "$RAW/gtfs.zip" "$OUT/mobilis-stops.json" "$OUT/MOBILIS-ZONES-REPORT.md"
