/**
 * End-to-end smoke run against the local database, MOTIS and the engine:
 *   pnpm tsx apps/analytics/test/smoke.ts [people]
 * Creates a list of people at real positions in Vaud, runs one analysis to Lausanne station,
 * prints timing and the key figures, then deletes the list.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildDeps, readConfig } from '../../api/src/deps.js';
import { openDb } from '../src/db.js';
import { computeIndicators } from '../src/indicators.js';
import { DEFAULT_SETTINGS, createStore } from '../src/store.js';
import { startWorker } from '../src/worker.js';

const n = Number(process.argv[2] ?? 40);
const vaud = new Set((JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../packages/engine/data/zones/vaud-stops.json'), 'utf8')) as { stops: string[] }).stops);
const zones = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../packages/engine/data/zones/mobilis-stops.json'), 'utf8')) as { stops: { gtfs: { stopId: string; lat: number; lon: number }[] }[] };
const points = zones.stops.flatMap((s) => s.gtfs).filter((g) => vaud.has(g.stopId));
// A fixed spread over the canton, a little off the stop itself.
const rows = Array.from({ length: n }, (_, i) => {
  const g = points[Math.floor((i * points.length) / n)]!;
  return { extId: `P${String(i + 1).padStart(4, '0')}`, lat: g.lat + 0.002, lon: g.lon + 0.002, attrs: { department: ['A', 'B', 'C'][i % 3]! } };
});

const db = await openDb();
const store = createStore(db);
const worker = startWorker({ store, engine: buildDeps(readConfig()), geocoder: { check: async () => ({ status: 'notfound', candidates: [], reasons: [] }) }, log: () => undefined });
const list = await store.createList(`smoke ${new Date().toISOString()}`, rows);
const a = await store.createAnalysis(list.id, { name: 'smoke', site: { label: 'Lausanne, gare', lat: 46.51679, lon: 6.62909 }, arrival: { from: '07:00', to: '09:00' }, weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'], settings: DEFAULT_SETTINGS });
worker.poke();
const t0 = Date.now();
for (;;) {
  const cur = (await store.analysis(a.id))!;
  if (cur.status === 'done' || cur.status === 'failed') break;
  await new Promise((r) => setTimeout(r, 500));
}
const secs = (Date.now() - t0) / 1000;
const { rows: results } = await store.results(a.id);
const errors = results.filter((r) => r.error);
console.log(`${n} people in ${secs.toFixed(1)} s (${(secs / n).toFixed(2)} s each), ${errors.length} errors`);
if (errors[0]) console.log('first error:', errors[0].error);
const ind = computeIndicators(results, n, { by: 'department' });
console.log(JSON.stringify({ ...ind, boardStops: ind.boardStops.slice(0, 5), by: ind.by?.groups.map((g) => [g.value, g.indicators.people, g.indicators.ptWithin]) }, null, 1));
console.log('sample row:', JSON.stringify(results[Math.floor(n / 2)]));
await store.deleteList(list.id);
worker.stop();
await db.end();
