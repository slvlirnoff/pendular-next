import type { LatLon } from '@pendular/engine';

/** A stop reached by public transport from the searcher: minutes from now, waiting included. */
export interface StopReach extends LatLon {
  minutes: number;
}

/** Walking pace from the last stop to the door, metres per minute, on straight lines stretched by the detour factor. */
export const WALK_M_PER_MIN = 75;
export const WALK_DETOUR = 1.3;
/** The last stop must be within this straight-line distance of the restaurant. */
export const MAX_STOP_DISTANCE_M = 700;

export function distanceM(a: LatLon, b: LatLon): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Time to each place by public transport, from one search to every stop (MOTIS one-to-all):
 * the best of "reach a stop near the place + walk the rest". One request answers for the whole
 * list, where a full route search per restaurant would take a second each.
 */
export function transitToPlaces(stops: StopReach[], places: LatLon[]): (number | null)[] {
  // Stops in cells of about 1 km, so each place looks at its own cell and the eight around it.
  const cell = 0.01;
  const key = (lat: number, lon: number) => `${Math.floor(lat / cell)}:${Math.floor(lon / (cell * 1.5))}`;
  const grid = new Map<string, StopReach[]>();
  for (const s of stops) {
    const k = key(s.lat, s.lon);
    const list = grid.get(k);
    if (list) list.push(s);
    else grid.set(k, [s]);
  }
  return places.map((p) => {
    const i = Math.floor(p.lat / cell);
    const j = Math.floor(p.lon / (cell * 1.5));
    let best: number | null = null;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (const s of grid.get(`${i + di}:${j + dj}`) ?? []) {
          const d = distanceM(s, p);
          if (d > MAX_STOP_DISTANCE_M) continue;
          const total = s.minutes + (d * WALK_DETOUR) / WALK_M_PER_MIN;
          if (best === null || total < best) best = total;
        }
      }
    }
    return best === null ? null : Math.round(best);
  });
}

/** Public transport is shown only when it beats walking. */
export function usefulTransit(transitMin: number | null, walkMin: number | null): number | null {
  if (transitMin === null) return null;
  if (walkMin !== null && walkMin <= transitMin) return null;
  return transitMin;
}
