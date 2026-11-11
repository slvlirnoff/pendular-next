/**
 * Writes packages/engine/data/nova/stop-links.json: the pairs of stops (station numbers) that
 * lie within walking distance of each other, where a traveller changes on foot ("Lausanne" and
 * "Lausanne, gare"). The fare data has hops between stops but no positions; the zone-path rule
 * "a chain of hops joins the two ends inside the zone set" (fares/zonePaths.ts) needs to know
 * where a chain can go on from another stop.
 *
 * From the timetable (GTFS stops.txt, station level: the mean position of a station's
 * platforms), for the stops that have a hop in a zone plan of the fare data only.
 *
 *   pnpm tsx tools/zone-paths/export-stop-links.ts [metres=300] [gtfs.zip]
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { loadNova } from '../../packages/engine/src/fares/nova';
import { gtfsStationNumber } from '../../packages/engine/src/fares/segmentTags';

const ROOT = resolve(import.meta.dirname, '../..');
const METRES = Number(process.argv[2] ?? 300);
const gtfs = resolve(process.argv[3] ?? resolve(ROOT, 'data/raw/gtfs.zip'));
const OUT = resolve(ROOT, 'packages/engine/data/nova/stop-links.json');

function lines(file: string): AsyncIterable<string> {
  const child = spawn('unzip', ['-p', gtfs, file], { stdio: ['ignore', 'pipe', 'inherit'] });
  return createInterface({ input: child.stdout, crlfDelay: Infinity });
}
function fields(raw: string): string[] {
  const line = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return line.startsWith('"') ? line.slice(1, line.endsWith('"') ? -1 : undefined).split('","') : line.split(',');
}

async function main() {
  const nova = loadNova();
  const zonal = new Set<number>();
  for (const a of nova.alliances()) {
    for (const p of a.plans) for (const edge of nova.raw.planEdges(a.id, p.id).keys()) for (const s of edge.split(' ')[0]!.split('-')) zonal.add(Number(s));
  }
  const sum = new Map<number, { lat: number; lon: number; n: number }>();
  let col: Record<string, number> | undefined;
  for await (const line of lines('stops.txt')) {
    const f = fields(line);
    if (!col) {
      col = Object.fromEntries(f.map((name, i) => [name, i]));
      continue;
    }
    const n = gtfsStationNumber(f[col.stop_id!]!, f[col.parent_station!]);
    const lat = Number(f[col.stop_lat!]);
    const lon = Number(f[col.stop_lon!]);
    if (n === null || !zonal.has(n) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const s = sum.get(n) ?? { lat: 0, lon: 0, n: 0 };
    s.lat += lat;
    s.lon += lon;
    s.n++;
    sum.set(n, s);
  }
  const stops = [...sum.entries()].map(([id, s]) => ({ id, lat: s.lat / s.n, lon: s.lon / s.n }));
  // Grid of cells a little larger than the distance: a pair lies in the same or a neighbouring cell.
  const dLat = METRES / 111_320;
  const cellOf = (s: { lat: number; lon: number }) => [Math.floor(s.lat / dLat), Math.floor((s.lon * Math.cos((s.lat * Math.PI) / 180)) / dLat)] as const;
  const grid = new Map<string, typeof stops>();
  for (const s of stops) {
    const [y, x] = cellOf(s);
    const key = `${y},${x}`;
    const l = grid.get(key);
    if (l) l.push(s);
    else grid.set(key, [s]);
  }
  const metres = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
    const dy = (a.lat - b.lat) * 111_320;
    const dx = (a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
    return Math.hypot(dx, dy);
  };
  const pairs: number[] = [];
  for (const s of stops) {
    const [y, x] = cellOf(s);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const t of grid.get(`${y + dy},${x + dx}`) ?? []) if (t.id > s.id && metres(s, t) <= METRES) pairs.push(s.id, t.id);
      }
    }
  }
  writeFileSync(
    OUT,
    `${JSON.stringify({ kind: 'stop-links', metres: METRES, source: 'GTFS stops.txt (station level), stops with a hop in a zone plan', stops: stops.length, pairs }).replace('"pairs":[', '"pairs":[\n')}\n`,
  );
  console.log(`${stops.length} stops, ${pairs.length / 2} pairs within ${METRES} m -> ${OUT}`);
}
main();
