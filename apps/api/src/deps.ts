import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MotisRouting,
  PENDULAR_RULES,
  coveredByZones,
  createZoneIndex,
  loadCityParkRide,
  loadParking,
  priceTransit,
  type AccessCandidate,
  type EngineDeps,
  type Leg,
  type ZoneIndex,
  type ZoneTable,
} from '@pendular/engine';
import { co2Factor } from '../../../packages/engine/src/environment/co2.js';

const ROOT = resolve(import.meta.dirname, '../../..');
const PARKING_SOURCE = 'https://opentransportdata.swiss/en/dataset/bike-and-car-parking';

export interface Config {
  motisUrl: string;
  parkingPath: string;
  zonesPath: string;
  port: number;
}

export function readConfig(env = process.env): Config {
  return {
    motisUrl: env.MOTIS_URL ?? 'http://127.0.0.1:8080',
    parkingPath: env.PARKING_PATH ?? resolve(ROOT, 'data/build/parking.json'),
    zonesPath: env.ZONES_PATH ?? resolve(ROOT, 'packages/engine/data/zones/mobilis-stops.json'),
    port: Number(env.PORT ?? 8787),
  };
}

function readVersion(path: string): string | undefined {
  return existsSync(path) ? statSync(path).mtime.toISOString().slice(0, 10) : undefined;
}

/** g CO₂-eq per year → kg, leg by leg so that long-distance and regional rail differ. */
function co2KgPerYear(legs: Leg[], trips: number): number {
  let g = 0;
  for (const l of legs) {
    const f = co2Factor(l.mode, { category: l.line?.category });
    if (f) g += f.gPerKm * (l.distanceM / 1000);
  }
  return (g * trips) / 1000;
}

export function buildDeps(cfg: Config): EngineDeps {
  const sites = existsSync(cfg.parkingPath) ? loadParking(cfg.parkingPath) : [];
  const toCandidate = (s: (typeof sites)[number]): AccessCandidate => ({
    id: s.id,
    name: s.stationName ?? s.name,
    kind: s.kind,
    lat: s.lat,
    lon: s.lon,
    prices: s.prices,
    free: s.free,
    priceSource: PARKING_SOURCE,
  });
  const city: AccessCandidate[] = loadCityParkRide()
    // Sites without a position or any price cannot be offered yet.
    .filter((c) => c.lat != null && c.lon != null && (c.prices.day != null || c.prices.month != null || c.prices.year != null))
    .map((c) => ({
      id: c.id,
      name: c.name,
      kind: 'cityParkRide' as const,
      lat: c.lat!,
      lon: c.lon!,
      prices: c.prices,
      includesTransit: { day: c.includesTransit.day === true, month: c.includesTransit.month === true, zones: c.zones },
      priceSource: c.sourceUrl ?? undefined,
    }));

  let zones: ZoneIndex | undefined;
  if (existsSync(cfg.zonesPath)) {
    zones = createZoneIndex(JSON.parse(readFileSync(cfg.zonesPath, 'utf8')) as ZoneTable);
  }

  const gtfs = resolve(ROOT, 'data/raw/gtfs.zip');
  const osm = resolve(ROOT, 'data/raw/switzerland.osm.pbf');
  return {
    routing: new MotisRouting({
      baseUrl: cfg.motisUrl,
      timezone: PENDULAR_RULES.timezone,
      versions: { timetable: `GTFS 2027, fetched ${readVersion(gtfs) ?? '?'}`, streets: `OSM, fetched ${readVersion(osm) ?? '?'}`, engine: 'MOTIS 2' },
    }),
    rules: PENDULAR_RULES,
    priceTransit: (legs, ctx) => priceTransit(legs, ctx, { zones }),
    coveredByZones: (legs, z) => coveredByZones(legs, z, zones),
    co2KgPerYear,
    parkRail: sites.filter((s) => s.kind === 'parkRail').map(toCandidate),
    bikeParking: sites.filter((s) => s.kind === 'bikeParking').map(toCandidate),
    cityParkRide: city,
    tariffVersion: 'Mobilis 13.12.2026; GA/Half Fare 13.12.2026; T601/T650 edition 01.06.2026',
    parkingVersion: readVersion(cfg.parkingPath),
  };
}
