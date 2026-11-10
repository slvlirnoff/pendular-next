/**
 * Acceptance run (AN-A1): checks every row of set/acceptance-set.json with the geocoder and
 * compares the answer with the truth.
 *
 *   pnpm tsx tools/address-test/run.ts            (answers are cached under tools/address-test/cache/)
 *   pnpm tsx tools/address-test/run.ts --limit=100
 *
 * Fair use of the public swisstopo service: 4 requests in flight at most, every answer cached on
 * disk, so a rerun costs no request. Only the address text is ever sent, never the row id.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGeocoder, distanceM } from '../../apps/analytics/src/geocode.js';
import type { GeocodeResult } from '../../apps/analytics/src/types.js';
import { createCachedFetch, CACHE_DIR } from './cachedFetch.js';
import type { SetRow } from './build.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const setArg = process.argv.find((a) => a.startsWith('--set='));
const SET = join(HERE, 'set', `${setArg ? setArg.slice(6) : 'acceptance-set'}.json`);
const OUT = join(HERE, 'out');
const PARALLEL = 4;
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.slice(8), 10) : Infinity;

if (!existsSync(SET)) {
  console.error('no acceptance set yet: run  pnpm tsx tools/address-test/build.ts');
  process.exit(1);
}
const { rows: allRows } = JSON.parse(readFileSync(SET, 'utf8')) as { rows: SetRow[] };
const rows = allRows.slice(0, limit);

const { fetch: cachedFetch, stats } = createCachedFetch();
const geocoder = createGeocoder({ fetch: cachedFetch });

interface Outcome {
  row: SetRow;
  res: GeocodeResult | null;
  error?: string;
  /** Distance from the truth position, m. */
  dist?: number;
  ms: number;
}

const outcomes: Outcome[] = new Array(rows.length);
let next = 0;
const t0 = performance.now();
async function worker() {
  while (next < rows.length) {
    const i = next++;
    const row = rows[i]!;
    const s = performance.now();
    try {
      const res = await geocoder.check(row.input);
      const dist = res.lat !== undefined && res.lon !== undefined && row.truth ? distanceM(res as { lat: number; lon: number }, row.truth) : undefined;
      outcomes[i] = { row, res, dist, ms: performance.now() - s };
    } catch (e) {
      outcomes[i] = { row, res: null, error: String(e), ms: performance.now() - s };
    }
    if ((i + 1) % 100 === 0) process.stderr.write(`  ${i + 1}/${rows.length}\r`);
  }
}
await Promise.all(Array.from({ length: PARALLEL }, worker));
const wallMs = performance.now() - t0;

// ───────── evaluation ─────────
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(2)} %` : 'n/a');
const status = (o: Outcome) => o.res?.status ?? 'error';
const clean = outcomes.filter((o) => o.row.kind === 'clean');
const cleanOk = (o: Outcome) => status(o) === 'exact' && (o.dist ?? Infinity) <= 50;
const cleanPass = clean.filter(cleanOk);
const cleanNoTwin = clean.filter((o) => !o.row.twin);
const cleanNoTwinPass = cleanNoTwin.filter(cleanOk);

const missing = outcomes.filter((o) => o.row.kind === 'numberMissingInRegister');
const missingFlagged = missing.filter((o) => status(o) !== 'exact' && o.res?.reasons.includes('houseNumber'));
const other = outcomes.filter((o) => o.row.kind === 'numberOtherBuilding');
const otherResolved = other.filter((o) => status(o) === 'exact' && (o.dist ?? Infinity) <= 50);
const farExact = outcomes.filter((o) => status(o) === 'exact' && ((o.dist ?? 0) > 500 || (o.row.kind === 'garbage')));
const typos = outcomes.filter((o) => o.row.kind === 'typo');
const typosFound = typos.filter((o) => status(o) !== 'notfound' && status(o) !== 'error' && (o.dist ?? Infinity) <= 50);
const noPc = outcomes.filter((o) => o.row.kind === 'noPostcode');
const noPcOk = noPc.filter((o) => status(o) === 'check' && o.res!.reasons.includes('postcode'));
const swapped = outcomes.filter((o) => o.row.kind === 'postcodeSwapped');
const swappedOk = swapped.filter((o) => (status(o) === 'check' && o.res!.reasons.includes('postcode')) || (o.row.expect.status.includes('exact') && status(o) === 'exact'));
const garbage = outcomes.filter((o) => o.row.kind === 'garbage');
const garbageOk = garbage.filter((o) => status(o) === 'notfound');

const count = (xs: Outcome[]) => {
  const c: Record<string, number> = {};
  for (const o of xs) c[status(o)] = (c[status(o)] ?? 0) + 1;
  return c;
};
const byKind: Record<string, Record<string, number>> = {};
for (const k of new Set(rows.map((r) => r.kind))) byKind[k] = count(outcomes.filter((o) => o.row.kind === k));

const canton = clean.filter((o) => o.row.canton === 'VD');
const lines: string[] = [];
const say = (s = '') => lines.push(s);
say(`Address check acceptance run: ${rows.length} rows`);
say('');
say('TARGETS');
say(`  clean addresses returned exact within 50 m: ${cleanPass.length}/${clean.length} = ${pct(cleanPass.length, clean.length)}   (target >= 99 %)`);
say(`    without the ${cleanNoTwin.length === clean.length ? 0 : clean.length - cleanNoTwin.length} rows whose address exists twice > 100 m apart: ${cleanNoTwinPass.length}/${cleanNoTwin.length} = ${pct(cleanNoTwinPass.length, cleanNoTwin.length)}`);
say(`    Vaud only: ${canton.filter(cleanOk).length}/${canton.length}`);
say(`  wrong house numbers (not in the register) flagged: ${missingFlagged.length}/${missing.length}   (target: all)`);
say(`  rows marked exact > 500 m from the truth (or a garbage row marked exact): ${farExact.length}   (target: none)`);
say('');
say('OTHER INJECTED ERRORS');
say(`  street typo, found within 50 m (exact or check): ${typosFound.length}/${typos.length}   (exact: ${typos.filter((o) => status(o) === 'exact').length})`);
say(`  missing postcode, check + 'postcode': ${noPcOk.length}/${noPc.length}`);
say(`  swapped postcode digits, check + 'postcode' (or a real address of that postcode): ${swappedOk.length}/${swapped.length}`);
say(`  garbage, notfound: ${garbageOk.length}/${garbage.length}`);
say(`  number of ANOTHER real building (undetectable by design), resolved to that building: ${otherResolved.length}/${other.length}`);
say('');
say('STATUS COUNTS');
say(`  all rows: ${JSON.stringify(count(outcomes))}`);
for (const [k, c] of Object.entries(byKind)) say(`  ${k.padEnd(24)} ${JSON.stringify(c)}`);
say('');
const reasonCount: Record<string, number> = {};
for (const o of outcomes) for (const r of o.res?.reasons ?? []) reasonCount[r] = (reasonCount[r] ?? 0) + 1;
say(`REASONS (all rows) ${JSON.stringify(reasonCount)}`);
say(`ERRORS ${outcomes.filter((o) => o.error).length}`);
say('');
say('REQUESTS AND SPEED');
say(`  this run: ${stats.live} live requests, ${stats.hits} answered from the cache, max in flight ${stats.maxInFlight}, wall clock ${(wallMs / 1000).toFixed(1)} s`);
const timingFile = join(CACHE_DIR, 'timing.json');
let timings: { at: string; rows: number; live: number; wallMs: number; meanMs: number; parallel: number }[] = [];
try {
  timings = JSON.parse(readFileSync(timingFile, 'utf8'));
} catch {
  /* none yet */
}
if (stats.live > 0) {
  timings.push({ at: new Date().toISOString(), rows: rows.length, live: stats.live, wallMs: Math.round(wallMs), meanMs: Math.round(stats.liveMs / stats.live), parallel: PARALLEL });
  writeFileSync(timingFile, JSON.stringify(timings, null, 1));
}
for (const t of timings.slice(-3)) say(`  live run ${t.at}: ${t.rows} rows, ${t.live} requests, ${(t.wallMs / 1000).toFixed(1)} s with ${t.parallel} in parallel, mean ${t.meanMs} ms per request`);
const cached = readCacheCount();
say(`  answers in the cache: ${cached.swisstopo} swisstopo, ${cached.motis} MOTIS`);

// ───────── failures ─────────
const fails: string[] = [];
const describe = (o: Outcome) =>
  [o.row.id, o.row.kind, o.row.canton ?? '', JSON.stringify(o.row.input), '->', status(o), (o.dist ?? NaN).toFixed(0) + ' m', (o.res?.reasons ?? []).join(','), o.res?.matched ?? '', 'truth: ' + (o.row.register ?? ''), o.row.twin ? 'TWIN' : '', o.row.note ?? '', o.error ?? ''].join('\t');
for (const o of clean) if (!cleanOk(o)) fails.push('CLEAN NOT EXACT/50m\t' + describe(o));
for (const o of missing) if (!missingFlagged.includes(o)) fails.push('WRONG NUMBER NOT FLAGGED\t' + describe(o));
for (const o of farExact) fails.push('EXACT FAR/GARBAGE\t' + describe(o));
for (const o of typos) if (!typosFound.includes(o)) fails.push('TYPO LOST\t' + describe(o));
for (const o of noPc) if (!noPcOk.includes(o)) fails.push('NO POSTCODE\t' + describe(o));
for (const o of swapped) if (!swappedOk.includes(o)) fails.push('SWAPPED POSTCODE\t' + describe(o));
for (const o of garbage) if (!garbageOk.includes(o)) fails.push('GARBAGE\t' + describe(o));
for (const o of other) if (!otherResolved.includes(o)) fails.push('OTHER BUILDING\t' + describe(o));

mkdirSync(OUT, { recursive: true });
const tag = setArg ? `-${setArg.slice(6)}` : '';
writeFileSync(join(OUT, `report${tag}.txt`), lines.join('\n') + '\n');
writeFileSync(join(OUT, `failures${tag}.tsv`), fails.join('\n') + '\n');
writeFileSync(join(OUT, `results${tag}.json`), JSON.stringify(outcomes.map((o) => ({ id: o.row.id, kind: o.row.kind, status: status(o), dist: o.dist, reasons: o.res?.reasons, matched: o.res?.matched })), null, 1));
console.log(lines.join('\n'));
console.log(`\n${fails.length} rows to look at: tools/address-test/out/failures${tag}.tsv`);

function readCacheCount() {
  let swisstopo = 0;
  let motis = 0;
  try {
    for (const f of readdirSync(CACHE_DIR)) {
      if (!f.endsWith('.json') || f === 'timing.json') continue;
      const u = (JSON.parse(readFileSync(join(CACHE_DIR, f), 'utf8')) as { url: string }).url;
      if (u.includes('geo.admin.ch')) swisstopo++;
      else motis++;
    }
  } catch {
    /* ignore */
  }
  return { swisstopo, motis };
}
