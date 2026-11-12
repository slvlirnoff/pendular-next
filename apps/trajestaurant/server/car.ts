import { decodePolyline, type LatLon, type MotisRouting } from '@pendular/engine';

/**
 * Car times and routes. MOTIS (the default) explores every road up to the time limit: a matrix
 * to places 100 km away takes seconds. Valhalla (VALHALLA_URL), with its road hierarchy, answers
 * the same in tens of milliseconds; it is used when configured, MOTIS when it is not or fails.
 */
export interface CarRouter {
  readonly name: string;
  /** Minutes from `from` to each point, null when out of reach. */
  matrix(from: LatLon, points: LatLon[], maxMin: number): Promise<(number | null)[]>;
  route(from: LatLon, to: LatLon): Promise<{ durationMin: number; distanceM: number; geometry: [number, number][] } | null>;
}

/** Times and routes on the streets for one way of going (walk, bike or car): the same shape as CarRouter. */
export type StreetRouter = CarRouter;

export function motisCar(routing: MotisRouting): CarRouter {
  return motisStreet(routing, 'car');
}

/** MOTIS for one street profile. */
export function motisStreet(routing: MotisRouting, profile: 'walk' | 'bike' | 'car'): StreetRouter {
  return {
    name: 'motis',
    async matrix(from, points, maxMin) {
      const res = await routing.streetMatrix({ points, anchor: from, profile, direction: 'fromAnchor', maxMin });
      return res.map((r) => (r ? r.durationMin : null));
    },
    async route(from, to) {
      const r = await routing.street({ from, to, profile });
      return r && r.geometry && r.geometry.length > 1 ? { durationMin: r.durationMin, distanceM: r.distanceM, geometry: r.geometry } : null;
    },
  };
}

const loc = (p: LatLon) => ({ lat: Number(p.lat.toFixed(6)), lon: Number(p.lon.toFixed(6)) });

/** Valhalla's matrix answers at most this many targets at once (service_limits.auto.max_matrix_location_pairs). */
const VALHALLA_CHUNK = 50;

export function valhallaCar(baseUrl: string, get: typeof fetch): CarRouter {
  return valhallaStreet(baseUrl, get, 'auto');
}

/**
 * Valhalla for one costing: 'auto' (car), 'pedestrian' or 'bicycle'. On foot and by bike, times
 * beyond the search's limit are null, as MOTIS gives them; by car the limit is not applied (the
 * car reaches the farthest place of a list).
 */
export function valhallaStreet(baseUrl: string, get: typeof fetch, costing: 'auto' | 'pedestrian' | 'bicycle'): StreetRouter {
  const call = async <T>(path: string, body: unknown): Promise<T> => {
    const url = new URL(path, baseUrl);
    url.searchParams.set('json', JSON.stringify(body));
    const r = await get(url);
    if (!r.ok) throw new Error(`Valhalla ${path} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return (await r.json()) as T;
  };
  return {
    name: 'valhalla',
    async matrix(from, points, maxMin) {
      const capped = costing !== 'auto';
      const out: (number | null)[] = [];
      for (let i = 0; i < points.length; i += VALHALLA_CHUNK) {
        const chunk = points.slice(i, i + VALHALLA_CHUNK);
        const res = await call<{ sources_to_targets: { time: number | null }[][] }>('/sources_to_targets', {
          sources: [loc(from)],
          targets: chunk.map(loc),
          costing,
        });
        for (const cell of res.sources_to_targets[0] ?? []) {
          const min = typeof cell.time === 'number' ? cell.time / 60 : null;
          out.push(min !== null && capped && min > maxMin ? null : min);
        }
      }
      return out;
    },
    async route(from, to) {
      const res = await call<{ trip?: { summary: { time: number; length: number }; legs: { shape: string }[] } }>('/route', {
        locations: [loc(from), loc(to)],
        costing,
        units: 'kilometers',
        directions_type: 'none',
      });
      if (!res.trip) return null;
      const geometry = res.trip.legs.flatMap((l) => decodePolyline(l.shape, 6));
      return { durationMin: res.trip.summary.time / 60, distanceM: res.trip.summary.length * 1000, geometry };
    },
  };
}

/** Valhalla first, MOTIS when Valhalla fails (not running, a place off its roads). */
export function withFallback(first: CarRouter, second: CarRouter): CarRouter {
  return {
    name: `${first.name}+${second.name}`,
    async matrix(from, points, maxMin) {
      try {
        return await first.matrix(from, points, maxMin);
      } catch (e) {
        console.error(`${first.name} matrix`, (e as Error).message);
        return second.matrix(from, points, maxMin);
      }
    },
    async route(from, to) {
      try {
        return (await first.route(from, to)) ?? (await second.route(from, to));
      } catch (e) {
        console.error(`${first.name} route`, (e as Error).message);
        return second.route(from, to);
      }
    },
  };
}
