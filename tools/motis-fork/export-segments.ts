/**
 * Writes the "segment tags" file read by the MOTIS fork (MOTIS_SEGMENT_TAGS):
 *
 *   from_station,to_station,tags        e.g.  8504121,8504122,mobilis:60|mobilis:103
 *
 * One row per direction for every edge of a zone plan in the NOVA snapshot; a tag is
 * `<alliance>:<zone code>`. Station ids are Swiss station numbers (85 + sloid, 7 digits).
 * When several edges join the same two stations (rail and bus, two operators) the one with the
 * fewest zones is kept, as `zonesOnEdge()` does without a mode.
 *
 *   pnpm tsx tools/motis-fork/export-segments.ts [out.csv] [alliance] [plan]
 */
import { writeFileSync } from 'node:fs';
import { loadNova } from '../../packages/engine/src/fares/nova';

const out = process.argv[2] ?? 'tools/motis-fork/segments-mobilis.csv';
const alliance = process.argv[3] ?? 'mobilis';
const plan = process.argv[4] ?? 'mobilis-abo-abo';

const nova = loadNova();
const best = new Map<string, number[]>();
let edges = 0;
let conflicts = 0;
for (const [key, zones] of nova.raw.planEdges(alliance, plan)) {
  edges++;
  const [a, b] = key.split(' ')[0]!.split('-');
  const pair = Number(a) < Number(b) ? `${a},${b}` : `${b},${a}`;
  const prev = best.get(pair);
  if (prev && prev.join() !== [...zones].sort((x, y) => x - y).join()) conflicts++;
  if (!prev || zones.length < prev.length) best.set(pair, [...zones].sort((x, y) => x - y));
}
const lines = ['from_station,to_station,tags'];
for (const [pair, zones] of best) {
  if (!zones.length) continue;
  const [a, b] = pair.split(',');
  const tags = zones.map((z) => `${alliance}:${z}`).join('|');
  lines.push(`${a},${b},${tags}`, `${b},${a},${tags}`);
}
writeFileSync(out, lines.join('\n') + '\n');
console.error(`${alliance}/${plan}: ${edges} edges, ${best.size} station pairs (${conflicts} pairs with differing zone sets, fewest kept), ${lines.length - 1} rows -> ${out}`);
