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
import { createCarSharing } from './sharing.js';
import { createPool } from './db.js';
import { addressPlace, routesTo, routesToPlace } from './routes.js';
import { departures, mapStops, modeOf } from './stops.js';
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
  // SHAREDMOBILITY_CONTACT: the contact e-mail address the shared-mobility feed asks for (cars at
  // the car-sharing stations); without it, stations are shown without their cars.
  sharing: createCarSharing(process.env.SHAREDMOBILITY_CONTACT, fetch),
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

/** Public transport stops in a box (the map, from zoom 15): ?min=lat,lon&max=lat,lon. */
app.get('/api/stops', async (c) => {
  const box = (v: string | undefined) => {
    const [a, b] = (v ?? '').split(',').map(Number);
    return Number.isFinite(a) && Number.isFinite(b) ? ([a, b] as [number, number]) : null;
  };
  const min = box(c.req.query('min'));
  const max = box(c.req.query('max'));
  if (!min || !max) return c.json({ error: 'min and max needed (lat,lon)' }, 400);
  try {
    return c.json(await mapStops(deps, min, max));
  } catch (e) {
    console.error(e);
    return c.json({ error: 'stops failed' }, 502);
  }
});

/** A stop's next departures (its board): ?id=<stop id>. */
app.get('/api/stops/departures', async (c) => {
  const id = c.req.query('id');
  if (!id) return c.json({ error: 'id needed' }, 400);
  try {
    return c.json(await departures(deps, id, 10));
  } catch (e) {
    console.error(e);
    return c.json({ error: 'departures failed' }, 502);
  }
});

/** The way to an address the geocoder found (the address card): ?lat&lon (from), toLat, toLon, label. */
app.get('/api/route', async (c) => {
  const from = position(c.req.query('lat'), c.req.query('lon'));
  const to = position(c.req.query('toLat'), c.req.query('toLon'));
  if (!from || !to) return c.json({ error: 'positions needed (lat, lon, toLat, toLon)' }, 400);
  const label = (c.req.query('label') ?? '').slice(0, 200) || 'Adresse';
  try {
    return c.json(await routesToPlace(deps, addressPlace(label, to, from), from));
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
  // ?type=stop: the stops only (the search bar's stops).
  const onlyStops = c.req.query('type') === 'stop';
  if (onlyStops) url.searchParams.set('type', 'STOP');
  // Near the searcher first ("chemin du…" in Lucens before Geneva's).
  const near = position(c.req.query('lat'), c.req.query('lon'));
  if (near) {
    url.searchParams.set('place', `${near.lat},${near.lon}`);
    url.searchParams.set('placeBias', '5');
  }
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
    areas?: { name: string; default?: boolean; adminLevel?: number }[];
    id?: string;
    modes?: string[];
  }[];
  const hits: PlaceHit[] = matches.slice(0, 6).map((m) => {
    // The commune (admin level 8) rather than a quarter ("Centre Ville").
    const town = m.areas?.find((a) => a.adminLevel === 8)?.name ?? m.areas?.find((a) => a.default)?.name ?? m.areas?.[0]?.name;
    const name = m.type === 'ADDRESS' ? [m.street ?? m.name, m.houseNumber].filter(Boolean).join(' ') : m.name;
    return {
      label: [name, m.type !== 'STOP' && town && town !== name ? town : null].filter(Boolean).join(', '),
      lat: m.lat,
      lon: m.lon,
      type: m.type === 'ADDRESS' ? 'address' : m.type === 'STOP' ? 'stop' : 'place',
      ...(m.type === 'STOP' && m.id ? { stopId: m.id } : {}),
      ...(m.type === 'STOP' && m.modes?.length ? { modes: [...new Set(m.modes.map(modeOf))] } : {}),
    };
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
