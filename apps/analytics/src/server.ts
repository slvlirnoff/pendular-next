import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { buildDeps, readConfig } from '../../api/src/deps.js';
import { httpGet } from '../../api/src/httpGet.js';
import { openDb } from './db.js';
import { resultsToCsv } from './exportCsv.js';
import { createGeocoder } from './geocode.js';
import { computeIndicators } from './indicators.js';
import { DEFAULT_SETTINGS, createStore } from './store.js';
import type { AddressStatus, AnalysisSettings, PersonInput } from './types.js';
import { startWorker } from './worker.js';

const cfg = readConfig();
const port = Number(process.env.ANALYTICS_PORT ?? 8788);
const MAX_ROWS = 50_000;
const STATUSES = ['pending', 'exact', 'check', 'notfound', 'manual'];
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const KINDS = ['transit', 'parkRail', 'cityParkRide', 'bikeRide', 'walk', 'bike', 'ebike', 'car'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const db = await openDb();
const store = createStore(db);
const worker = startWorker({ store, engine: buildDeps(cfg), geocoder: createGeocoder({ motisUrl: cfg.motisUrl }) });

class BadRequest extends Error {}
const bad = (msg: string): never => {
  throw new BadRequest(msg);
};
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const coord = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined);
const id = (v: string) => (UUID.test(v) ? v : bad('unknown id'));
const page = (q: (k: string) => string | undefined) => ({
  offset: Math.max(0, Number(q('offset')) || 0),
  limit: Math.min(500, Math.max(1, Number(q('limit')) || 50)),
});

function parseRows(rows: unknown): PersonInput[] {
  if (!Array.isArray(rows) || rows.length === 0) bad('rows must be a non-empty array');
  const list = rows as Record<string, unknown>[];
  if (list.length > MAX_ROWS) bad(`a list holds at most ${MAX_ROWS} rows`);
  const seen = new Set<string>();
  return list.map((r, i) => {
    const extId = text(r?.extId, 100) || bad(`row ${i + 1}: extId is missing`);
    if (seen.has(extId)) bad(`row ${i + 1}: extId "${extId}" appears twice`);
    seen.add(extId);
    const lat = coord(r.lat, 45, 48.5);
    const lon = coord(r.lon, 5, 11.5);
    const attrs: Record<string, string> = {};
    if (r.attrs && typeof r.attrs === 'object') {
      for (const [k, v] of Object.entries(r.attrs as Record<string, unknown>).slice(0, 30)) attrs[k.slice(0, 60)] = String(v ?? '').slice(0, 200);
    }
    return { extId, address: text(r.address, 200) || undefined, postcode: text(r.postcode, 12) || undefined, city: text(r.city, 100) || undefined, lat: lat !== undefined && lon !== undefined ? lat : undefined, lon: lat !== undefined && lon !== undefined ? lon : undefined, attrs };
  });
}

const app = new Hono();
app.onError((e, c) => {
  if (e instanceof BadRequest) return c.json({ error: e.message }, 400);
  console.error(e);
  return c.json({ error: 'internal error' }, 500);
});

app.get('/api/health', async (c) => c.json({ ok: true, queue: await store.queue() }));

app.get('/api/places', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (q.length < 2) return c.json([]);
  const url = new URL('/api/v1/geocode', cfg.motisUrl);
  url.searchParams.set('text', q);
  const res = await httpGet(url).catch(() => null);
  if (!res?.ok) return c.json({ error: 'place search unavailable' }, 502);
  const matches = (await res.json()) as { type: string; name: string; lat: number; lon: number; street?: string; houseNumber?: string; zip?: string; areas?: { name: string; default?: boolean }[] }[];
  return c.json(
    matches.slice(0, 8).map((m) => {
      const town = m.areas?.find((a) => a.default)?.name ?? m.areas?.[0]?.name;
      const street = m.type === 'ADDRESS' ? [m.street ?? m.name, m.houseNumber].filter(Boolean).join(' ') : m.name;
      return { label: [street, m.type !== 'STOP' && town && town !== street ? [m.zip, town].filter(Boolean).join(' ') : null].filter(Boolean).join(', '), type: m.type === 'STOP' ? 'stop' : m.type === 'ADDRESS' ? 'address' : 'place', lat: m.lat, lon: m.lon };
    }),
  );
});

// --- lists ---------------------------------------------------------------------------------------

app.get('/api/lists', async (c) => c.json(await store.listSummaries()));

app.post('/api/lists', async (c) => {
  const b = (await c.req.json().catch(() => bad('body must be JSON'))) as Record<string, unknown>;
  const name = text(b.name, 120) || bad('name is missing');
  const list = await store.createList(name, parseRows(b.rows));
  worker.poke();
  return c.json(list, 201);
});

app.get('/api/lists/:id', async (c) => {
  const list = (await store.listSummaries(id(c.req.param('id'))))[0];
  if (!list) return c.json({ error: 'not found' }, 404);
  return c.json({ ...list, analyses: await store.analysesOfList(list.id) });
});

app.delete('/api/lists/:id', async (c) => ((await store.deleteList(id(c.req.param('id')))) ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404)));

app.get('/api/lists/:id/people', async (c) => {
  const status = c.req.query('status');
  if (status && !STATUSES.includes(status)) bad('unknown status');
  const { offset, limit } = page((k) => c.req.query(k));
  return c.json(await store.people(id(c.req.param('id')), status as AddressStatus | undefined, offset, limit));
});

app.post('/api/lists/:id/accept-checks', async (c) => c.json({ accepted: await store.acceptChecks(id(c.req.param('id'))) }));

app.patch('/api/people/:id', async (c) => {
  const pid = Number(c.req.param('id'));
  const person = Number.isInteger(pid) ? await store.person(pid) : null;
  if (!person) return c.json({ error: 'not found' }, 404);
  const b = (await c.req.json().catch(() => bad('body must be JSON'))) as Record<string, unknown>;
  if (typeof b.candidate === 'number') {
    const cand = person.candidates[b.candidate] ?? bad('no such candidate');
    return c.json(await store.place(pid, cand.lat, cand.lon, cand.label));
  }
  const lat = coord(b.lat, 45, 48.5);
  const lon = coord(b.lon, 5, 11.5);
  if (lat !== undefined && lon !== undefined) return c.json(await store.place(pid, lat, lon, null));
  const address = text(b.address, 200) || bad('give an address, coordinates or a candidate');
  const updated = await store.editAddress(pid, { address, postcode: text(b.postcode, 12) || undefined, city: text(b.city, 100) || undefined });
  worker.poke();
  return c.json(updated);
});

// --- analyses --------------------------------------------------------------------------------------

app.post('/api/lists/:id/analyses', async (c) => {
  const listId = id(c.req.param('id'));
  if (!(await store.listSummaries(listId))[0]) return c.json({ error: 'not found' }, 404);
  const b = (await c.req.json().catch(() => bad('body must be JSON'))) as Record<string, any>;
  const site = { label: text(b.site?.label, 200) || bad('site.label is missing'), lat: coord(b.site?.lat, 45, 48.5) ?? bad('site.lat is invalid'), lon: coord(b.site?.lon, 5, 11.5) ?? bad('site.lon is invalid') };
  const arrival = { from: text(b.arrival?.from, 5), to: text(b.arrival?.to, 5) };
  if (!HHMM.test(arrival.from) || !HHMM.test(arrival.to)) bad('arrival needs from and to as HH:MM');
  const weekdays = Array.isArray(b.weekdays) ? [...new Set((b.weekdays as unknown[]).filter((d): d is string => WEEKDAYS.includes(d as string)))] : ['mon', 'tue', 'wed', 'thu', 'fri'];
  if (weekdays.length === 0) bad('weekdays needs at least one day');
  const s = (b.settings ?? {}) as Partial<AnalysisSettings>;
  const kinds = Array.isArray(s.kinds) ? s.kinds.filter((k) => KINDS.includes(k)) : DEFAULT_SETTINGS.kinds;
  const settings: AnalysisSettings = {
    // The car is the yardstick of every indicator: always computed.
    kinds: [...new Set([...kinds, 'car'])],
    weeksOff: coord(s.weeksOff, 0, 51) ?? DEFAULT_SETTINGS.weeksOff,
    carCostPerKm: coord(s.carCostPerKm, 0, 5) ?? DEFAULT_SETTINGS.carCostPerKm,
    parkingAtWorkPerMonth: coord(s.parkingAtWorkPerMonth, 0, 2000) ?? DEFAULT_SETTINGS.parkingAtWorkPerMonth,
  };
  const analysis = await store.createAnalysis(listId, { name: text(b.name, 120) || site.label, site, arrival, weekdays, settings });
  worker.poke();
  return c.json(analysis, 201);
});

function carNote(car: { peakFactor: number; parkingMin: number } | null | undefined): string | null {
  return car ? `Car minutes include a rush-hour factor of x${car.peakFactor} on the driving time and ${car.parkingMin} min to park at the destination.` : null;
}
function csvNotes(a: Awaited<ReturnType<typeof store.analysis>> & {}): string[] {
  return [
    `${a.name}: site ${a.site.label}, arrival ${a.arrival.from}-${a.arrival.to}, ${a.weekdays.join(' ')}`,
    carNote(a.stamp?.car),
    `Yearly costs: ${a.settings.weeksOff} weeks off, car ${a.settings.carCostPerKm} CHF/km, parking at work ${a.settings.parkingAtWorkPerMonth} CHF/month.`,
    a.outdated ? 'The list changed after this analysis ran: figures may be out of date.' : null,
  ].filter((x): x is string => !!x);
}

const indicatorsOf = async (analysisId: string, by?: string) => {
  const a = await store.analysis(analysisId);
  if (!a) return null;
  const { rows } = await store.results(analysisId);
  return { analysis: a, indicators: rows.length ? computeIndicators(rows, a.total, { by }) : null };
};

app.get('/api/analyses/:id', async (c) => {
  const r = await indicatorsOf(id(c.req.param('id')));
  return r ? c.json({ ...r.analysis, indicators: r.indicators }) : c.json({ error: 'not found' }, 404);
});

app.get('/api/analyses/:id/indicators', async (c) => {
  const r = await indicatorsOf(id(c.req.param('id')), text(c.req.query('by'), 60) || undefined);
  return r?.indicators ? c.json(r.indicators) : c.json({ error: 'no results yet' }, 404);
});

app.get('/api/analyses/:id/results', async (c) => {
  const { offset, limit } = page((k) => c.req.query(k));
  return c.json(await store.results(id(c.req.param('id')), offset, limit));
});

app.get('/api/analyses/:id/results/:personId', async (c) => {
  const detail = await store.resultDetail(id(c.req.param('id')), Number(c.req.param('personId')));
  return detail ? c.json(detail) : c.json({ error: 'not found' }, 404);
});

app.get('/api/analyses/:id/export.csv', async (c) => {
  const a = await store.analysis(id(c.req.param('id')));
  if (!a) return c.json({ error: 'not found' }, 404);
  const { rows } = await store.results(a.id);
  const name = a.name.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'analysis';
  return c.body(resultsToCsv(rows, { notes: csvNotes(a) }), 200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}.csv"` });
});

app.post('/api/analyses/:id/rerun', async (c) => {
  const a = await store.rerun(id(c.req.param('id')));
  worker.poke();
  return a ? c.json(a) : c.json({ error: 'not found' }, 404);
});

app.delete('/api/analyses/:id', async (c) => ((await store.deleteAnalysis(id(c.req.param('id')))) ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404)));

app.use('/*', serveStatic({ root: './public' }));

process.on('unhandledRejection', (e) => console.error('unhandled rejection', e));
// This slice has no sign-in: it listens on the local machine only.
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => console.log(`pendular analytics on 127.0.0.1:${info.port}`));
