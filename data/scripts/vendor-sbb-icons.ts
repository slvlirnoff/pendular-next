// Vendors SBB line pictograms + mode/utility icons from the SBB icon CDN into apps/web/public/icons/sbb/.
// Usage (repo root): pnpm tsx data/scripts/vendor-sbb-icons.ts
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const INDEX_PATH = join(ROOT, 'data/raw/sbb/icons-index.json');
const OUT_DIR = join(ROOT, 'apps/web/public/icons/sbb');
const CDN = 'https://icons.app.sbb.ch/icons';
const CONCURRENCY = 8;

/** Line pictogram families: `<f>` and `<f>-<n>` (non-negative variants only). */
const LINE_FAMILIES = [
  'ic', 'ir', 're', 's', 'sn', 'r', 'rb', 'ire', 'ev', 'sl', 'pe',
  'ice', 'ec', 'tgv', 'rj', 'rjx', 'rx', 'nj', 'bex', 'gex', 'vae',
  'cnl', 'en', 'icn', 'ogv', 'ter', 'fr', 'iry', 'fb', 'est', 'es', 'ext',
];

/** Mode / utility icon bases; both -small and -medium are taken when present in the index. */
const ICON_BASES = [
  'train', 'bus', 'tram', 'train-profile', 'bus-profile', 'tram-profile', 'boat-profile', 'funicular-profile',
  'cable-car-profile', 'gondola-profile', 'chairlift-profile', 'rack-railaway-profile',
  'underground-vehicule-profile', 'long-distance-coach-profile', 'locomotive', 'locomotive-high-speed',
  'park-and-rail', 'bicycle', 'cargo-bike', 'bike-microscooter', 'microscooter-profile',
  'microscooter-profile-power-plug', 'scooter-profile', 'bike-profile-power-plug', 'car', 'car-profile',
  'car-power-plug', 'car-profile-power-plug', 'taxi-profile', 'shuttle', 'walk', 'walk-fast', 'walk-slow',
  'clock', 'alarm-clock', 'arrow-change', 'arrow-change-horizontal', 'railway-switch', 'leaf',
  'cloud-co2', 'cloud-co2-arrow-down', 'circle-leaf-power-plug', 'coins', 'coin-stack', 'coin-dollar',
  'money-exchange', 'ticket-route', 'half-fare-card', 'route-circle-start', 'route-circle-end',
  'timetable', 'switzerland-route', 'house', 'location-pin', 'train-station', 'chevron-small-down',
  'chevron-small-up', 'circle-information', 'sign-exclamation-point', 'list',
];

interface Index { version: string; icons: { name: string }[] }

const index: Index = JSON.parse(await readFile(INDEX_PATH, 'utf8'));
const names = new Set(index.icons.map((i) => i.name));

const lines = [...names].filter((n) => {
  const m = /^([a-z]+)(?:-(\d+))?$/.exec(n);
  return m !== null && LINE_FAMILIES.includes(m[1] as string);
}).sort();
const icons = ICON_BASES.flatMap((b) => [`${b}-small`, `${b}-medium`]).filter((n) => names.has(n)).sort();
const missing = ICON_BASES.flatMap((b) => [`${b}-small`, `${b}-medium`]).filter((n) => !names.has(n));

await mkdir(OUT_DIR, { recursive: true });

async function exists(p: string): Promise<boolean> {
  try { return (await stat(p)).size > 0; } catch { return false; }
}

async function download(name: string): Promise<'ok' | 'skipped'> {
  const file = join(OUT_DIR, `${name}.svg`);
  if (await exists(file)) return 'skipped';
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${CDN}/${name}.svg`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      if (!body.includes('<svg')) throw new Error('not an SVG');
      await writeFile(file, body);
      return 'ok';
    } catch (e) { lastErr = e; }
  }
  throw new Error(`${name}: ${String(lastErr)}`);
}

const all = [...lines, ...icons];
let next = 0, ok = 0, skipped = 0;
const failed: string[] = [];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < all.length) {
    const n = all[next++] as string;
    try { (await download(n)) === 'ok' ? ok++ : skipped++; } catch (e) { failed.push(String(e)); }
  }
}));

const failedNames = new Set(failed.map((f) => f.split(':')[0]));
const manifest = {
  version: index.version,
  fetchedAt: new Date().toISOString(),
  lines: lines.filter((n) => !failedNames.has(n)),
  icons: icons.filter((n) => !failedNames.has(n)),
};
await writeFile(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest) + '\n');
await writeFile(join(OUT_DIR, '../../../src/lib/sbb-manifest.json'), JSON.stringify(manifest) + '\n');

let bytes = 0;
for (const n of [...manifest.lines, ...manifest.icons]) bytes += (await stat(join(OUT_DIR, `${n}.svg`))).size;
console.log(`lines=${manifest.lines.length} icons=${manifest.icons.length} downloaded=${ok} skipped=${skipped} failed=${failed.length} bytes=${bytes}`);
if (missing.length) console.log('not in index:', missing.join(' '));
if (failed.length) { console.error(failed.join('\n')); process.exitCode = 1; }
