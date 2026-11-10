import { readFileSync } from 'node:fs';
import type { LatLon } from '../types.js';
import cityParkRideData from '../../data/parking/lausanne-pr.json' with { type: 'json' };

/** One car park (P+Rail) or one station's bike parking, built by data/scripts/build-parking.ts. */
export interface ParkingSite {
  id: string;
  kind: 'parkRail' | 'bikeParking';
  name: string;
  stationName: string | null;
  stationId: string | null;
  stationIdType: 'uic' | 'sloid' | null;
  lat: number;
  lon: number;
  capacity: number | null;
  /** CHF; null when the dataset has no such price. */
  prices: { day: number | null; month: number | null; year: number | null };
  covered?: boolean;
  free?: boolean;
}

/** Reads data/build/parking.json (`{ sites }`) or a bare array of sites. */
export function loadParking(path: string): ParkingSite[] {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as ParkingSite[] | { sites: ParkingSite[] };
  return Array.isArray(parsed) ? parsed : parsed.sites;
}

/** Cheapest yearly cost among day x working days, month x 12 and year; null prices are ignored. */
export function cheapestParkingPerYear(
  site: Pick<ParkingSite, 'prices'>,
  workingDaysPerYear: number,
): { yearly: number; basis: 'day' | 'month' | 'year' } | null {
  const { day, month, year } = site.prices;
  const candidates: { yearly: number; basis: 'day' | 'month' | 'year' }[] = [];
  if (day !== null) candidates.push({ yearly: day * workingDaysPerYear, basis: 'day' });
  if (month !== null) candidates.push({ yearly: month * 12, basis: 'month' });
  if (year !== null) candidates.push({ yearly: year, basis: 'year' });
  let best: { yearly: number; basis: 'day' | 'month' | 'year' } | null = null;
  for (const c of candidates) if (best === null || c.yearly < best.yearly) best = c;
  return best;
}

export function haversineKm(a: LatLon, b: LatLon): number {
  const r = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Sites of `kind` within `radiusKm` of `point`, nearest first. */
export function sitesNear(
  sites: ParkingSite[],
  point: LatLon,
  radiusKm: number,
  kind: ParkingSite['kind'],
): { site: ParkingSite; distanceKm: number }[] {
  const out: { site: ParkingSite; distanceKm: number }[] = [];
  for (const site of sites) {
    if (site.kind !== kind) continue;
    const distanceKm = haversineKm(point, site);
    if (distanceKm <= radiusKm) out.push({ site, distanceKm });
  }
  return out.sort((a, b) => a.distanceKm - b.distanceKm);
}

/** A Lausanne city park-and-ride site (data/parking/lausanne-pr.json). null = not found on the city's pages. */
export interface CityParkRide {
  id: string;
  name: string;
  lat: number | null;
  lon: number | null;
  capacity: number | null;
  prices: { day: number | null; month: number | null; year: number | null };
  includesTransit: { day: boolean | null; month: boolean | null };
  zones: number[];
  nearestStop: string | null;
  sourceUrl: string | null;
  notes: string;
}

export function loadCityParkRide(): CityParkRide[] {
  return (cityParkRideData as unknown as { sites: CityParkRide[] }).sites;
}
