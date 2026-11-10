/**
 * Builds packages/engine/data/density/density-1km.json: residents and jobs on a LV95 grid
 * for the whole of Switzerland, from two BFS hectare files (100 m grid, semicolon CSV, LV95).
 *
 *   residents: STATPOP, column BBTOT (older files: B\d\dBTOT), year in ERHJAHR
 *   jobs:      STATENT, column B\d\dEMPT (employed persons), year in ERHJAHR
 *
 * Run: pnpm tsx data/scripts/build-density.ts [--pop file.csv] [--statent file.csv] [--out file.json]
 * The 1 km sum is not stored; the engine adds up the cells whose centre is within 1,000 m (see
 * packages/engine/src/density.ts). This script also checks that approximation against the exact
 * hectare sum on sample points and prints the error.
 *
 * Rows with NOLOC=1 are people/jobs the BFS could not place; it parks them on one hectare per
 * municipality. They are skipped here, they would fake a dense spot in every village.
 */
import { createReadStream, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { densityFromFile, wgs84ToLv95, type DensityFile } from '../../packages/engine/src/density.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? resolve(process.argv[i + 1]!) : dflt;
};
const POP = arg('pop', resolve(root, 'data/raw/density/pop2025_ha.csv'));
const JOBS = arg('statent', resolve(root, 'data/raw/density/statent2024_ha.csv'));
const OUT = arg('out', resolve(root, 'packages/engine/data/density/density-1km.json'));

const CELL = 100;
const E0 = 2_480_000;
const N0 = 1_070_000;
const WIDTH = 3_600; // covers E up to 2,840,000
const RADIUS = 1_000;

type Hectares = Map<number, number>; // key = (E/100) * 100000 + N/100 ... see hk()
const hk = (e: number, n: number) => (e / 100) * 100_000 + n / 100;

/** Reads one hectare CSV; returns the hectare map and the survey year. */
async function readHectares(file: string, column: RegExp): Promise<{ map: Hectares; year: number; column: string }> {
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  const map: Hectares = new Map();
  let ie = -1, inn = -1, iv = -1, iy = -1, il = -1;
  let name = '';
  let year = 0;
  for await (const line of rl) {
    const f = line.split(';');
    if (iv < 0) {
      ie = f.indexOf('E_KOORD');
      inn = f.indexOf('N_KOORD');
      iy = f.indexOf('ERHJAHR');
      il = f.indexOf('NOLOC');
      iv = f.findIndex((h) => column.test(h));
      if (ie < 0 || inn < 0 || iv < 0) throw new Error(`${file}: columns not found in header`);
      name = f[iv]!;
      continue;
    }
    if (il >= 0 && f[il] === '1') continue;
    const v = Math.round(Number(f[iv]));
    if (!(v > 0)) continue;
    year = Math.max(year, Number(f[iy]));
    const k = hk(Number(f[ie]), Number(f[inn]));
    map.set(k, (map.get(k) ?? 0) + v);
  }
  return { map, year, column: name };
}

const pop = await readHectares(POP, /^(B\d\d)?BTOT$|^BBTOT$/);
const jobs = await readHectares(JOBS, /^B\d\dEMPT$/);
console.log(`residents ${pop.column} ${pop.year}: ${pop.map.size} hectares; jobs ${jobs.column} ${jobs.year}: ${jobs.map.size} hectares`);

// Aggregate to the grid (CELL = 100 m keeps the sums exact; a coarser CELL makes the file smaller but
// the 1 km sum less exact, about 6% off at 200 m). A hectare belongs to the cell that contains its south-west corner
// (CELL is a multiple of 100, so a hectare never straddles two cells).
const cells = new Map<number, [number, number]>();
const add = (m: Hectares, slot: 0 | 1) => {
  for (const [k, v] of m) {
    const e = Math.floor(k / 100_000) * 100;
    const n = (k % 100_000) * 100;
    const id = Math.floor((n - N0) / CELL) * WIDTH + Math.floor((e - E0) / CELL);
    let c = cells.get(id);
    if (!c) cells.set(id, (c = [0, 0]));
    c[slot] += v;
  }
};
add(pop.map, 0);
add(jobs.map, 1);

const ids = [...cells.keys()].sort((a, b) => a - b);
const file: DensityFile = {
  format: 'pendular-density/1',
  cellM: CELL,
  e0: E0,
  n0: N0,
  width: WIDTH,
  radiusM: RADIUS,
  sources: {
    residents: { name: `BFS STATPOP hectare data (${pop.column})`, year: pop.year },
    jobs: { name: `BFS STATENT hectare data (${jobs.column})`, year: jobs.year },
  },
  key: ids.map((id, i) => id - (i ? ids[i - 1]! : 0)),
  res: ids.map((id) => cells.get(id)![0]),
  jobs: ids.map((id) => cells.get(id)![1]),
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(file));
console.log(`${OUT}: ${ids.length} cells, ${(statSync(OUT).size / 1e6).toFixed(2)} MB`);

// Exact sum over hectare centres (+50 m) within the radius, to compare with the grid.
function exact(m: Hectares, e: number, n: number): number {
  let s = 0;
  const r2 = RADIUS * RADIUS;
  for (let x = Math.floor((e - RADIUS) / 100) * 100; x <= e + RADIUS; x += 100) {
    for (let y = Math.floor((n - RADIUS) / 100) * 100; y <= n + RADIUS; y += 100) {
      const v = m.get(hk(x, y));
      if (!v) continue;
      if ((x + 50 - e) ** 2 + (y + 50 - n) ** 2 <= r2) s += v;
    }
  }
  return s;
}

const idx = densityFromFile(file);
const places: [string, number, number][] = [
  ['Lausanne gare', 46.5167, 6.6291], ['Morges centre', 46.5112, 6.4985], ['Lovatens', 46.693, 6.862],
  ['EPFL', 46.5191, 6.5668], ['Zürich HB', 47.3779, 8.5403], ['Genève Cornavin', 46.2102, 6.1424],
  ['Bern', 46.9489, 7.4391], ['Nyon', 46.3833, 6.2397], ['Vevey', 46.4628, 6.8431], ['Yverdon', 46.7785, 6.6411],
];
// Plus a deterministic spread of populated cells (every n-th, so rural and urban both appear).
const spread = Array.from({ length: 12 }, (_, i) => ids[Math.floor(((i + 0.5) * ids.length) / 12)]!);
const points: [string, number, number][] = places.map(([name, lat, lon]) => {
  const { e, n } = wgs84ToLv95(lat, lon);
  return [name, e, n];
});
for (const id of spread) {
  points.push([`cell ${id}`, E0 + ((id % WIDTH) + 0.5) * CELL + 37, N0 + (Math.floor(id / WIDTH) + 0.5) * CELL - 61]);
}
let maxRel = 0, maxAbs = 0;
console.log('point'.padEnd(18), 'exact res/jobs', '   grid res/jobs', '   err res/jobs');
for (const [name, e, n] of points) {
  const er = exact(pop.map, e, n), ej = exact(jobs.map, e, n);
  const g = idx.aroundLv95(e, n);
  const dr = g.residents - er, dj = g.jobs! - ej;
  console.log(name.padEnd(18), `${er}/${ej}`.padStart(14), `${g.residents}/${g.jobs}`.padStart(16), `${dr}/${dj}`.padStart(14));
  maxAbs = Math.max(maxAbs, Math.abs(dr), Math.abs(dj));
  if (er >= 500) maxRel = Math.max(maxRel, Math.abs(dr) / er);
  if (ej >= 500) maxRel = Math.max(maxRel, Math.abs(dj) / ej);
}
console.log(`max abs error ${maxAbs}, max relative error ${(maxRel * 100).toFixed(1)}% (values >= 500)`);
