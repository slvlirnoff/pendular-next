import type pg from 'pg';
import { localToUtc, type DensityIndex, type LatLon, type MotisRouting } from '@pendular/engine';
import type { BrandHit, MapPlaces, PlaceSummary, SearchResponse, SearchResult, Suggestion, Target } from '../src/api.js';
import { FOOD_BY_KEY, FOOD_ORDER, matchFoods } from '../src/foods.js';
import { KIND_SEARCH_BY_KEY, matchKinds } from '../src/kinds.js';
import { sameName, searchKey } from '../src/text.js';
import type { CarRouter } from './car.js';
import type { CarSharing } from './sharing.js';
import { distanceM, transitToPlaces, usefulTransit, type StopReach } from './estimate.js';
import { openState } from './open.js';
import { localNow, routingDate, TIMEZONE, type TimetableRange } from './timetable.js';
import { clockOf, createTraffic } from './traffic.js';

export interface SearchDeps {
  db: pg.Pool;
  /** Residents and jobs around each point: traffic and parking for car times (Pendular's). */
  density: DensityIndex;
  /** Cars at the car-sharing stations, live (server/sharing.ts). */
  sharing: CarSharing;
  routing: MotisRouting;
  /** Car times and routes: Valhalla when configured, else MOTIS (server/car.ts). */
  car: CarRouter;
  motisUrl: string;
  fetch: typeof fetch;
  timetable: TimetableRange;
}

/**
 * How far a search looks and how many places get travel times: places to eat are everywhere, so
 * the 40 nearest within 40 km; a chain or a name may have its nearest branch further away (the
 * nearest IKEA), so the 30 nearest within 250 km.
 */
export const LIMITS = {
  food: { radiusM: 40_000, candidates: 40 },
  wide: { radiusM: 250_000, candidates: 24 },
};

interface Row {
  id: string;
  name: string;
  kind_key: string;
  kind: string;
  brand: string | null;
  brand_key: string | null;
  sources: string[];
  source: string;
  source_id: string;
  town: string | null;
  lat: number;
  lon: number;
  opening_hours: string | null;
  foods: string[];
  dist: number;
}

const SUMMARY = `
  p.id, p.name, p.kind_key, p.kind, p.brand, p.brand_key, p.sources, p.source, p.source_id, p.town, st_y(p.geom::geometry) as lat, st_x(p.geom::geometry) as lon, p.opening_hours,
  array(select food from place_food f2 where f2.place_id = p.id) as foods,
  st_distance(p.geom, o.g) as dist`;
const ORIGIN = `cross join (select st_setsrid(st_makepoint($2, $1), 4326)::geography as g) o`;
const likeEscape = (s: string) => s.replace(/[%_\\]/g, (c) => `\\${c}`);

/** Most specific food first, the generic kinds (restaurant, fast food…) last. */
export function sortFoods(foods: string[]): string[] {
  return [...foods].sort((a, b) => (FOOD_ORDER.get(a) ?? 999) - (FOOD_ORDER.get(b) ?? 999));
}

function toSummary(r: Row, now: Date): PlaceSummary {
  return {
    id: Number(r.id),
    name: r.name,
    kindKey: r.kind_key,
    kind: r.kind,
    brand: r.brand,
    town: r.town,
    lat: r.lat,
    lon: r.lon,
    foods: sortFoods(r.foods),
    distanceM: Math.round(r.dist),
    open: openState(r.opening_hours, r.lat, r.lon, now),
  };
}

/** Chains whose name (or another name of theirs) starts with or contains the text, exact name and largest first. */
export async function findBrands(db: pg.Pool, text: string, limit = 5): Promise<BrandHit[]> {
  if (text.length < 2) return [];
  const contains = text.length >= 4;
  const r = await db.query<{ key: string; name: string; kind_key: string; kind: string; count: string }>(
    `select name_folded as key, (array_agg(name order by count desc))[1] as name,
            (array_agg(kind_key order by count desc))[1] as kind_key, (array_agg(kind order by count desc))[1] as kind,
            sum(count) as count
     from brand
     where name_folded like $1 || '%' or exists (select 1 from unnest(aliases) a where a like $1 || '%')
        or ($3 and name_folded like '%' || $1 || '%')
     group by name_folded
     order by bool_or(name_folded = $2) desc, bool_or(name_folded like $1 || '%') desc, sum(count) desc
     limit $4`,
    [likeEscape(text), text, contains, limit],
  );
  return r.rows.map((x) => ({ key: x.key, name: x.name, kindKey: x.kind_key, kind: x.kind, count: Number(x.count) }));
}

/** Well-known chains shown as shortcuts, those present in the data, in this order. */
export const POPULAR_BRANDS = ['migros', 'coop', 'denner', 'lidl', 'aldi', 'manor', 'ikea', 'dosenbach', 'interdiscount', 'decathlon', 'mcdonald s', 'burger king', 'starbucks', 'fust', 'ochsner sport', 'jumbo'];

export async function popularBrands(db: pg.Pool): Promise<BrandHit[]> {
  const r = await db.query<{ key: string; name: string; kind_key: string; kind: string; count: string }>(
    `select name_folded as key, (array_agg(name order by count desc))[1] as name,
            (array_agg(kind_key order by count desc))[1] as kind_key, (array_agg(kind order by count desc))[1] as kind, sum(count) as count
     from brand where name_folded = any($1) group by name_folded`,
    [POPULAR_BRANDS],
  );
  const order = new Map(POPULAR_BRANDS.map((k, i) => [k, i]));
  return r.rows
    .map((x) => ({ key: x.key, name: x.name, kindKey: x.kind_key, kind: x.kind, count: Number(x.count) }))
    .sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
}

/** What is being typed: food types, chains, all places of a name, and single places (nearest first). */
export async function suggest(deps: SearchDeps, q: string, at: LatLon | null): Promise<Suggestion> {
  const foods = matchFoods(q).slice(0, 4);
  const kinds = matchKinds(q).slice(0, 3);
  const text = searchKey(q);
  if (text.length < 2) return { foods, kinds, brands: [], named: null, places: [] };
  const origin = at ?? { lat: 46.8, lon: 8.2 };
  const [brands, places, named] = await Promise.all([
    findBrands(deps.db, text),
    deps.db.query<Row>(
      `select ${SUMMARY} from place p ${ORIGIN}
       where p.name_folded like '%' || $3 || '%'
       order by (p.name_folded like $3 || '%') desc, p.geom <-> o.g limit 6`,
      [origin.lat, origin.lon, likeEscape(text)],
    ),
    text.length >= 3 ? deps.db.query<{ n: string }>(`select count(*) as n from place where name_folded like '%' || $1 || '%'`, [likeEscape(text)]) : null,
  ]);
  const now = new Date();
  const n = Number(named?.rows[0]?.n ?? 0);
  // A food type or a chain that matches already lists the places; "all places named …" is for the rest (Mix-Image).
  const covered = foods.length > 0 || kinds.length > 0 || brands.some((b) => b.key.startsWith(text));
  return {
    foods,
    kinds,
    brands,
    named: n >= 2 && !covered ? { key: text, count: n } : null,
    places: places.rows.map((r) => toSummary(r, now)),
  };
}

/**
 * One result per place in a search by kind: a shop that two sources place a few metres apart
 * under similar names (OSM "Coiffure Sandra", Overture "Sandra Coiffure") is shown once, the
 * record with the most sources standing for it. Two shops of one kind in one mall keep their own lines.
 */
export function onePlace(rows: Row[]): Row[] {
  const kept: Row[] = [];
  for (const r of [...rows].sort((a, b) => b.sources.length - a.sources.length)) {
    const twin = kept.find((k) => k.kind_key === r.kind_key && k.kind === r.kind && distanceM(k, r) < 80 && sameName(k.name, r.name));
    if (!twin) kept.push(r);
  }
  return kept.sort((a, b) => a.dist - b.dist);
}

/** The largest area the map asks places for, degrees: beyond, it is zoomed out too far to show them. */
export const MAP_MAX_SPAN = { lon: 0.3, lat: 0.2 };
export const MAP_MAX_PLACES = 600;

/**
 * Places inside an area of the map, to show when nothing is searched: places to eat first, then
 * the branches of chains, then the others, the nearest to the centre of the area first within each.
 */
export async function placesIn(db: pg.Pool, w: number, s: number, e: number, n: number): Promise<MapPlaces> {
  if (e - w > MAP_MAX_SPAN.lon || n - s > MAP_MAX_SPAN.lat || e <= w || n <= s) return { places: [], truncated: true };
  const r = await db.query<{ id: string; name: string; kind_key: string; kind: string; brand: string | null; town: string | null; lat: number; lon: number; foods: string[] }>(
    `select p.id, p.name, p.kind_key, p.kind, p.brand, p.town, st_y(p.geom::geometry) as lat, st_x(p.geom::geometry) as lon,
            array(select food from place_food f where f.place_id = p.id) as foods
     from place p
     where p.geom && st_makeenvelope($1, $2, $3, $4, 4326)::geography
     order by (case when exists (select 1 from place_food f where f.place_id = p.id) then 0 when p.brand_key is not null then 1 else 2 end),
              p.geom <-> st_setsrid(st_makepoint(($1 + $3) / 2, ($2 + $4) / 2), 4326)::geography
     limit $5`,
    [w, s, e, n, MAP_MAX_PLACES + 1],
  );
  const rows = r.rows.slice(0, MAP_MAX_PLACES);
  return {
    places: rows.map((x) => ({ id: Number(x.id), name: x.name, kindKey: x.kind_key, kind: x.kind, brand: x.brand, town: x.town, lat: x.lat, lon: x.lon, foods: sortFoods(x.foods) })),
    truncated: r.rows.length > MAP_MAX_PLACES,
  };
}

/** The places a search is about, nearest first. */
async function candidates(db: pg.Pool, target: Target, from: LatLon): Promise<Row[]> {
  const lim = target.type === 'food' ? LIMITS.food : LIMITS.wide;
  const where =
    target.type === 'food'
      ? `join place_food f on f.place_id = p.id and f.food = $3`
      : target.type === 'brand'
        ? `join (select key from brand where name_folded = $3) b on b.key = p.brand_key`
        : '';
  const filter =
    target.type === 'name'
      ? `and p.name_folded like '%' || $3 || '%'`
      : target.type === 'kind'
        ? `and (p.kind_key || '=' || p.kind) = any($3::text[])`
        : '';
  const key = target.type === 'name' ? likeEscape(target.key) : target.type === 'kind' ? (KIND_SEARCH_BY_KEY.get(target.key)?.kinds ?? []) : target.key;
  const r = await db.query<Row>(
    `select ${SUMMARY} from place p ${where} ${ORIGIN}
     where st_dwithin(p.geom, o.g, $4) ${filter}
     order by p.geom <-> o.g limit $5`,
    [from.lat, from.lon, key, lim.radiusM, lim.candidates],
  );
  return r.rows;
}

/**
 * How long the street and public transport searches look, minutes: long enough for the places
 * found (a car covers a kilometre in about a minute on country roads; public transport needs the
 * nearest place within about twice that), no longer, since longer searches are slower.
 */
export function maxMinutes(nearestM: number, farthestM: number): { walk: number; bike: number; car: number; transit: number } {
  const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(x)));
  return {
    walk: 60,
    bike: 90,
    car: clamp((farthestM / 1000) * 1.3 + 15, 30, 180),
    transit: clamp((nearestM / 1000) * 2.5 + 40, 90, 180),
  };
}

/**
 * One result per branch: places of one chain within 150 m are one shop seen twice (a building and
 * its entrance, a store and its café, two sources, two Wikidata ids for one company). The one with
 * the chain's main kind, or the most sources, stands for it. In a search by name, only places of
 * one brand are merged.
 */
export function oneBranch(rows: Row[], mainKind?: string, sameChain = false): Row[] {
  const kept: Row[] = [];
  const score = (r: Row) => (mainKind && `${r.kind_key}=${r.kind}` === mainKind ? 10 : 0) + (r.kind_key === 'shop' ? 2 : 0) + r.sources.length;
  for (const r of [...rows].sort((a, b) => score(b) - score(a))) {
    const twin = sameChain || r.brand_key ? kept.find((k) => (sameChain || k.brand_key === r.brand_key) && distanceM(k, r) < 150) : undefined;
    if (!twin) kept.push(r);
  }
  return kept.sort((a, b) => a.dist - b.dist);
}

/** Straight-line distances beyond which walking and cycling are not looked for, metres. */
export const MAX_WALK_M = 7_000;
export const MAX_BIKE_M = 25_000;

/** Places of a food type, a chain or a name near a place, with the time to each on foot, by bike, by car and by public transport. */
export async function searchPlaces(deps: SearchDeps, target: Target, from: LatLon, now = new Date()): Promise<SearchResponse> {
  let rows = await candidates(deps.db, target, from);
  if (target.type === 'brand' || target.type === 'name') {
    const main = target.type === 'brand' ? await deps.db.query<{ k: string }>(`select kind_key || '=' || kind as k from brand where name_folded = $1 order by count desc limit 1`, [target.key]) : null;
    rows = oneBranch(rows, main?.rows[0]?.k, target.type === 'brand');
  } else if (target.type === 'kind') {
    rows = onePlace(rows);
  }
  const local = localNow(now);
  const day = routingDate(local.date, deps.timetable);
  const label = await labelOf(deps.db, target);
  if (rows.length === 0) return { target, label, results: [], typicalTimetable: day.typical };

  const points = rows.map((r) => ({ lat: r.lat, lon: r.lon }));
  const ids = rows.map((r) => r.id);
  const dists = rows.map((r) => r.dist);
  const max = maxMinutes(Math.min(...dists), Math.max(...dists));
  const origin = `${from.lat.toFixed(4)},${from.lon.toFixed(4)}`;
  /** Minutes to each place, from the cache (a search after another reuses the places they share) or computed. */
  const timed = async (profile: 'walk' | 'bike' | 'car', only: (i: number) => boolean, compute: (pts: LatLon[]) => Promise<(number | null)[]>) => {
    const out: (number | null)[] = points.map(() => null);
    const missing: number[] = [];
    points.forEach((_, i) => {
      if (!only(i)) return;
      const hit = streetCache.get(`${profile}|${origin}|${ids[i]}`);
      if (hit !== undefined) out[i] = hit;
      else missing.push(i);
    });
    if (missing.length === 0) return out;
    try {
      const res = await compute(missing.map((i) => points[i]!));
      missing.forEach((i, k) => {
        out[i] = res[k] ?? null;
        streetCache.set(`${profile}|${origin}|${ids[i]}`, out[i]!);
      });
    } catch (e) {
      console.error(`${profile} matrix`, e);
    }
    return out;
  };
  const [walk, bike, car, stops] = await Promise.all([
    // Walking only to places within reach (an hour is about 5 km).
    timed('walk', (i) => dists[i]! < MAX_WALK_M, (pts) =>
      deps.routing.streetMatrix({ points: pts, anchor: from, profile: 'walk', direction: 'fromAnchor', maxMin: max.walk }).then((r) => r.map((x) => (x ? x.durationMin : null))),
    ),
    // Cycling to places within an hour and a half or so (about 25 km).
    timed('bike', (i) => dists[i]! < MAX_BIKE_M, (pts) =>
      deps.routing.streetMatrix({ points: pts, anchor: from, profile: 'bike', direction: 'fromAnchor', maxMin: max.bike }).then((r) => r.map((x) => (x ? x.durationMin : null))),
    ),
    timed('car', () => true, (pts) => deps.car.matrix(from, pts, max.car)),
    reachableStops(deps, from, day.date, local.time, max.transit).catch((e: unknown) => {
      console.error('one-to-all', e);
      return [] as StopReach[];
    }),
  ]);
  const transit = transitToPlaces(stops, points);
  // The matrix gives times on empty roads: the traffic of this hour (along the straight line, as
  // Pendular does without the route's shape) and parking at the place make them door to door.
  const clock = clockOf(local.date, local.time);
  const traffic = createTraffic(deps.density, clock.weekday, clock.minutes);

  const results: SearchResult[] = rows.map((r, i) => {
    const walkMin = walk[i] !== null && walk[i] !== undefined ? Math.round(walk[i]!) : null;
    return {
      ...toSummary(r, now),
      walkMin,
      bikeMin: bike[i] !== null && bike[i] !== undefined ? Math.round(bike[i]!) : null,
      carMin: car[i] !== null && car[i] !== undefined ? traffic.car(car[i]!, [[from.lon, from.lat], [r.lon, r.lat]], r).totalMin : null,
      transitMin: usefulTransit(transit[i] ?? null, walkMin),
    };
  });
  // Sharing stations: the cars or bikes there now.
  await Promise.all(
    rows.map(async (r, i) => {
      if (r.kind === 'car_sharing' && r.source === 'gbfs') results[i]!.cars = await deps.sharing.cars(r.source_id);
      if (r.kind === 'bicycle_rental' && r.source === 'gbfs') results[i]!.bikes = await deps.sharing.bikes(r.source_id);
    }),
  );
  results.sort((a, b) => bestMinutes(a) - bestMinutes(b) || a.distanceM - b.distanceM);
  return { target, label, results, typicalTimetable: day.typical };
}

async function labelOf(db: pg.Pool, target: Target): Promise<string> {
  if (target.type === 'food') return FOOD_BY_KEY.get(target.key)?.label ?? target.key;
  if (target.type === 'kind') return KIND_SEARCH_BY_KEY.get(target.key)?.label ?? target.key;
  if (target.type === 'brand') {
    const r = await db.query<{ name: string }>('select name from brand where name_folded = $1 order by count desc limit 1', [target.key]);
    return r.rows[0]?.name ?? target.key;
  }
  return target.key;
}

/** The quickest way there, minutes (Infinity when nothing reaches it). */
export function bestMinutes(r: Pick<SearchResult, 'walkMin' | 'carMin' | 'transitMin'>): number {
  const t = [r.walkMin, r.carMin, r.transitMin].filter((x): x is number => x !== null);
  return t.length ? Math.min(...t) : Infinity;
}

/** A small cache with a time to live: entries older than `ttlMs` are gone, the oldest go first beyond `size`. */
export class Ttl<V> {
  private m = new Map<string, { v: V; at: number }>();
  constructor(
    private readonly ttlMs: number,
    private readonly size: number,
  ) {}
  get(k: string): V | undefined {
    const e = this.m.get(k);
    if (!e) return undefined;
    if (Date.now() - e.at > this.ttlMs) {
      this.m.delete(k);
      return undefined;
    }
    return e.v;
  }
  set(k: string, v: V) {
    this.m.delete(k);
    this.m.set(k, { v, at: Date.now() });
    if (this.m.size > this.size) this.m.delete(this.m.keys().next().value!);
  }
}

/** Street times from a place (rounded to about 10 m) to a place: they do not change within the hour. */
const streetCache = new Ttl<number | null>(60 * 60_000, 50_000);
/** Stops reached by public transport from a place, leaving at a given minute: shared by the searches of that minute. */
const stopsCache = new Ttl<Promise<StopReach[]>>(90_000, 200);

/**
 * Every stop reached by public transport leaving now from the place (MOTIS one-to-all), with
 * the minutes it takes, waiting included. Stops reached on foot only are left out: walking
 * is counted by the street search. A search for pizza then one for burgers from the same place
 * in the same minute share one answer, as long as it looks far enough.
 */
function reachableStops(deps: SearchDeps, from: LatLon, date: string, time: string, maxMin: number): Promise<StopReach[]> {
  const key = `${from.lat.toFixed(4)},${from.lon.toFixed(4)}|${date}|${time}`;
  for (const m of [maxMin, 180]) {
    const hit = stopsCache.get(`${key}|${m}`);
    if (hit) return hit;
  }
  const p = fetchStops(deps, from, date, time, maxMin);
  stopsCache.set(`${key}|${maxMin}`, p);
  p.catch(() => stopsCache.set(`${key}|${maxMin}`, Promise.resolve([])));
  return p;
}

async function fetchStops(deps: SearchDeps, from: LatLon, date: string, time: string, maxMin: number): Promise<StopReach[]> {
  const url = new URL('/api/v6/one-to-all', deps.motisUrl);
  url.searchParams.set('one', `${from.lat.toFixed(6)},${from.lon.toFixed(6)}`);
  url.searchParams.set('time', localToUtc(date, time, TIMEZONE).toISOString());
  url.searchParams.set('maxTravelTime', String(maxMin));
  url.searchParams.set('arriveBy', 'false');
  const r = await deps.fetch(url);
  if (!r.ok) throw new Error(`MOTIS one-to-all ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const body = (await r.json()) as { all?: { place?: { lat: number; lon: number }; duration?: number; k?: number }[] };
  const out: StopReach[] = [];
  for (const a of body.all ?? []) {
    if (!a.place || typeof a.duration !== 'number') continue;
    if (typeof a.k === 'number' && a.k < 1) continue;
    out.push({ lat: a.place.lat, lon: a.place.lon, minutes: a.duration });
  }
  return out;
}

export { distanceM };
