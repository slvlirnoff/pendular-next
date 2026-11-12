import type pg from 'pg';
import { localToUtc, type LatLon, type MotisRouting } from '@pendular/engine';
import type { RestaurantSummary, SearchResponse, SearchResult, Suggestion } from '../src/api.js';
import { FOOD_ORDER, matchFoods } from '../src/foods.js';
import { fold } from '../src/text.js';
import { transitToPlaces, usefulTransit, type StopReach } from './estimate.js';
import { openState } from './open.js';
import { localNow, routingDate, TIMEZONE, type TimetableRange } from './timetable.js';

export interface SearchDeps {
  db: pg.Pool;
  routing: MotisRouting;
  motisUrl: string;
  fetch: typeof fetch;
  timetable: TimetableRange;
}

/** How many restaurants get travel times: the nearest ones in a straight line. */
export const CANDIDATES = 40;
/** And no further than this. */
export const MAX_RADIUS_M = 40_000;
/** Travel times beyond this are not looked for, minutes. */
export const MAX_MINUTES = { walk: 60, car: 60, transit: 90 };

interface Row {
  id: string;
  name: string;
  kind: string;
  town: string | null;
  lat: number;
  lon: number;
  opening_hours: string | null;
  foods: string[];
  dist: number;
}

const SUMMARY = `
  r.id, r.name, r.kind, r.town, st_y(r.geom::geometry) as lat, st_x(r.geom::geometry) as lon, r.opening_hours,
  array(select food from restaurant_food f2 where f2.restaurant_id = r.id) as foods,
  st_distance(r.geom, o.g) as dist`;
const ORIGIN = `cross join (select st_setsrid(st_makepoint($2, $1), 4326)::geography as g) o`;

/** Most specific food first, the generic kinds (restaurant, fast food…) last. */
export function sortFoods(foods: string[]): string[] {
  return [...foods].sort((a, b) => (FOOD_ORDER.get(a) ?? 999) - (FOOD_ORDER.get(b) ?? 999));
}

function toSummary(r: Row, now: Date): RestaurantSummary {
  return {
    id: Number(r.id),
    name: r.name,
    kind: r.kind,
    town: r.town,
    lat: r.lat,
    lon: r.lon,
    foods: sortFoods(r.foods),
    distanceM: Math.round(r.dist),
    open: openState(r.opening_hours, r.lat, r.lon, now),
  };
}

/** Food types and restaurant names for what is being typed, restaurants nearest first. */
export async function suggest(deps: SearchDeps, q: string, at: LatLon | null): Promise<Suggestion> {
  const foods = matchFoods(q).slice(0, 6);
  const text = fold(q);
  if (text.length < 2) return { foods, restaurants: [] };
  const origin = at ?? { lat: 46.8, lon: 8.2 };
  const res = await deps.db.query<Row>(
    `select ${SUMMARY} from restaurant r ${ORIGIN}
     where r.name_folded like '%' || $3 || '%'
     order by (r.name_folded like $3 || '%') desc, r.geom <-> o.g limit 6`,
    [origin.lat, origin.lon, text.replace(/[%_\\]/g, (c) => `\\${c}`)],
  );
  const now = new Date();
  return { foods, restaurants: res.rows.map((r) => toSummary(r, now)) };
}

/** Restaurants serving a food near a place, with the time to each by foot, car and public transport. */
export async function searchFood(deps: SearchDeps, food: string, from: LatLon, now = new Date()): Promise<SearchResponse> {
  const res = await deps.db.query<Row>(
    `select ${SUMMARY} from restaurant r
     join restaurant_food f on f.restaurant_id = r.id and f.food = $3
     ${ORIGIN}
     where st_dwithin(r.geom, o.g, $4)
     order by r.geom <-> o.g limit $5`,
    [from.lat, from.lon, food, MAX_RADIUS_M, CANDIDATES],
  );
  const rows = res.rows;
  const local = localNow(now);
  const day = routingDate(local.date, deps.timetable);
  if (rows.length === 0) return { food, results: [], typicalTimetable: day.typical };

  const points = rows.map((r) => ({ lat: r.lat, lon: r.lon }));
  const matrix = (profile: 'walk' | 'car') =>
    deps.routing
      .streetMatrix({ points, anchor: from, profile, direction: 'fromAnchor', maxMin: MAX_MINUTES[profile] })
      .catch((e: unknown) => {
        console.error(`${profile} matrix`, e);
        return points.map(() => null);
      });
  const [walk, car, stops] = await Promise.all([
    matrix('walk'),
    matrix('car'),
    reachableStops(deps, from, day.date, local.time).catch((e: unknown) => {
      console.error('one-to-all', e);
      return [] as StopReach[];
    }),
  ]);
  const transit = transitToPlaces(stops, points);

  const results: SearchResult[] = rows.map((r, i) => {
    const walkMin = walk[i] ? Math.round(walk[i]!.durationMin) : null;
    return {
      ...toSummary(r, now),
      walkMin,
      carMin: car[i] ? Math.max(1, Math.round(car[i]!.durationMin)) : null,
      transitMin: usefulTransit(transit[i] ?? null, walkMin),
    };
  });
  results.sort((a, b) => bestMinutes(a) - bestMinutes(b) || a.distanceM - b.distanceM);
  return { food, results, typicalTimetable: day.typical };
}

/** The quickest way there, minutes (Infinity when nothing reaches it). */
export function bestMinutes(r: Pick<SearchResult, 'walkMin' | 'carMin' | 'transitMin'>): number {
  const t = [r.walkMin, r.carMin, r.transitMin].filter((x): x is number => x !== null);
  return t.length ? Math.min(...t) : Infinity;
}

/**
 * Every stop reached by public transport leaving now from the place (MOTIS one-to-all), with
 * the minutes it takes, waiting included. Stops reached on foot only are left out: walking
 * is counted by the street search.
 */
async function reachableStops(deps: SearchDeps, from: LatLon, date: string, time: string): Promise<StopReach[]> {
  const url = new URL('/api/v6/one-to-all', deps.motisUrl);
  url.searchParams.set('one', `${from.lat.toFixed(6)},${from.lon.toFixed(6)}`);
  url.searchParams.set('time', localToUtc(date, time, TIMEZONE).toISOString());
  url.searchParams.set('maxTravelTime', String(MAX_MINUTES.transit));
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
