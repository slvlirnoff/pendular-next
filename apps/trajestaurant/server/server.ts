import './tz.js';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { loadDensity, MotisRouting, type LatLon } from '@pendular/engine';
import { httpGet } from '../../api/src/httpGet.js';
import type { PlaceHit, Target } from '../src/api.js';
import { FOODS, FOOD_BY_KEY } from '../src/foods.js';
import { KIND_SEARCH_BY_KEY } from '../src/kinds.js';
import { motisCar, valhallaCar, withFallback } from './car.js';
import { createPool } from './db.js';
import { routesTo } from './routes.js';
import { placesIn, popularBrands, searchPlaces, suggest, type SearchDeps } from './search.js';
import { searchKey } from '../src/text.js';
import { readTimetableRange, referenceMonday, TIMEZONE } from './timetable.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const motisUrl = process.env.MOTIS_URL ?? 'http://127.0.0.1:8080';
const port = Number(process.env.PORT ?? 8789);
const timetable = readTimetableRange(process.env.MOTIS_CONFIG ?? resolve(ROOT, 'data/motis/config.yml'));

const routing = new MotisRouting({
    baseUrl: motisUrl,
    fetch: httpGet,
    timezone: TIMEZONE,
    // Street searches need an instant inside the timetable: midday of the reference week.
    referenceTime: `${referenceMonday(timetable)}T11:00:00Z`,
    maxPages: 1,
});
// VALHALLA_URL (e.g. http://127.0.0.1:8002): car times and routes from Valhalla, MOTIS as the fallback.
const valhallaUrl = process.env.VALHALLA_URL;
const deps: SearchDeps = {
  db: createPool(),
  density: loadDensity(),
  motisUrl,
  fetch: httpGet,
  timetable,
  routing,
  car: valhallaUrl ? withFallback(valhallaCar(valhallaUrl, httpGet), motisCar(routing)) : motisCar(routing),
};

const app = new Hono();

/** A position from the query (?lat=…&lon=…), inside Switzerland and around. */
function position(lat: string | undefined, lon: string | undefined): LatLon | null {
  const a = Number(lat);
  const b = Number(lon);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 45 || a > 48.5 || b < 5 || b > 11.5) return null;
  return { lat: a, lon: b };
}

app.get('/api/health', async (c) => {
  const n = await deps.db.query<{ n: string }>('select count(*) as n from place').catch(() => null);
  return c.json({ ok: n !== null, places: Number(n?.rows[0]?.n ?? 0), timetable });
});

/** Every food type, with how many places in the data have it. */
let foodCounts: Map<string, number> | null = null;
app.get('/api/foods', async (c) => {
  if (!foodCounts) {
    const r = await deps.db.query<{ food: string; n: string }>('select food, count(*) as n from place_food group by food');
    foodCounts = new Map(r.rows.map((x) => [x.food, Number(x.n)]));
  }
  return c.json(FOODS.map((f) => ({ key: f.key, emoji: f.emoji, label: f.label, generic: f.generic === true, count: foodCounts!.get(f.key) ?? 0 })));
});

/** What is being typed in the search bar: food types and restaurant names. */
app.get('/api/suggest', async (c) => {
  const q = (c.req.query('q') ?? '').trim().slice(0, 60);
  return c.json(await suggest(deps, q, position(c.req.query('lat'), c.req.query('lon'))));
});

/** Chains shown as shortcuts under the search bar. */
let popular: Awaited<ReturnType<typeof popularBrands>> | null = null;
app.get('/api/brands/popular', async (c) => c.json((popular ??= await popularBrands(deps.db))));

/** ?food=pizza, ?kind=pharmacie, ?brand=migros (a chain by its folded name) or ?name=mix image, with ?lat=…&lon=… */
app.get('/api/search', async (c) => {
  const from = position(c.req.query('lat'), c.req.query('lon'));
  const food = c.req.query('food');
  const kind = c.req.query('kind');
  const brand = c.req.query('brand');
  const name = c.req.query('name');
  let target: Target | null = null;
  if (food) target = FOOD_BY_KEY.has(food) ? { type: 'food', key: food } : null;
  else if (kind) target = KIND_SEARCH_BY_KEY.has(kind) ? { type: 'kind', key: kind } : null;
  else if (brand) target = { type: 'brand', key: searchKey(brand) };
  else if (name && searchKey(name).length >= 2) target = { type: 'name', key: searchKey(name) };
  if (!target) return c.json({ error: 'food, kind, brand or name needed' }, 400);
  if (!from) return c.json({ error: 'position needed (lat, lon)' }, 400);
  try {
    return c.json(await searchPlaces(deps, target, from));
  } catch (e) {
    console.error(e);
    return c.json({ error: 'search failed' }, 500);
  }
});

/** Places to show on the map in an area: ?bbox=west,south,east,north. */
app.get('/api/map/places', async (c) => {
  const b = (c.req.query('bbox') ?? '').split(',').map(Number);
  if (b.length !== 4 || b.some((x) => !Number.isFinite(x))) return c.json({ error: 'bbox=west,south,east,north needed' }, 400);
  return c.json(await placesIn(deps.db, b[0]!, b[1]!, b[2]!, b[3]!));
});

app.get('/api/places/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const from = position(c.req.query('lat'), c.req.query('lon'));
  if (!Number.isInteger(id)) return c.json({ error: 'bad id' }, 400);
  if (!from) return c.json({ error: 'position needed (lat, lon)' }, 400);
  try {
    const r = await routesTo(deps, id, from);
    return r ? c.json(r) : c.json({ error: 'not found' }, 404);
  } catch (e) {
    console.error(e);
    return c.json({ error: 'route failed' }, 500);
  }
});

/** Where the searcher is: the nearest town or village. */
app.get('/api/where', async (c) => {
  const p = position(c.req.query('lat'), c.req.query('lon'));
  if (!p) return c.json({ town: null });
  const r = await deps.db.query<{ name: string }>(
    'select name from town order by geom <-> st_setsrid(st_makepoint($2, $1), 4326)::geography limit 1',
    [p.lat, p.lon],
  );
  return c.json({ town: r.rows[0]?.name ?? null });
});

/** Place search for "I am in …": the routing engine's geocoder (stops, addresses, places). */
app.get('/api/geocode', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (q.length < 2) return c.json([]);
  const url = new URL('/api/v1/geocode', motisUrl);
  url.searchParams.set('text', q);
  url.searchParams.set('language', 'fr');
  const res = await httpGet(url).catch(() => null);
  if (!res?.ok) return c.json({ error: 'geocoder unavailable' }, 502);
  const matches = (await res.json()) as {
    type: string;
    name: string;
    lat: number;
    lon: number;
    street?: string;
    houseNumber?: string;
    zip?: string;
    areas?: { name: string; default?: boolean }[];
  }[];
  const hits: PlaceHit[] = matches.slice(0, 6).map((m) => {
    const town = m.areas?.find((a) => a.default)?.name ?? m.areas?.[0]?.name;
    const name = m.type === 'ADDRESS' ? [m.street ?? m.name, m.houseNumber].filter(Boolean).join(' ') : m.name;
    return { label: [name, m.type !== 'STOP' && town && town !== name ? town : null].filter(Boolean).join(', '), lat: m.lat, lon: m.lon };
  });
  return c.json(hits);
});

// The built site (production): vite build writes web/dist.
app.use('/*', serveStatic({ root: './web/dist' }));
app.get('*', serveStatic({ root: './web/dist', path: 'index.html' }));

process.on('unhandledRejection', (e) => console.error('unhandled rejection', e));
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`trajestaurant api on :${info.port}, motis ${motisUrl}, car times from ${deps.car.name}`);
  // The routing engines read their data from disk on first use: the first search would wait for
  // it (12 s measured for MOTIS). One search in the background warms them up.
  setTimeout(() => {
    const started = Date.now();
    searchPlaces(deps, { type: 'food', key: 'restaurant' }, { lat: 46.948, lon: 7.4474 })
      .then(() => console.log(`warmed up in ${Date.now() - started} ms`))
      .catch((e: unknown) => console.error('warm-up', e));
  }, 500);
});
