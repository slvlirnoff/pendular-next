import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MotisRouting,
  PENDULAR_RULES,
  coveredByZones,
  createOjpFareClient,
  stopSequenceKey,
  createZoneIndex,
  loadCityParkRide,
  loadDensity,
  loadNova,
  parkingByDensity,
  trafficFactorAlong,
  loadParking,
  priceTransit,
  type AccessCandidate,
  type EngineDeps,
  type Leg,
  type ZoneIndex,
  type ZoneTable,
} from '@pendular/engine';
import { httpGet } from './httpGet.js';
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

export function buildDeps(cfg: Config, env = process.env): EngineDeps {
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
    // Stops of the canton of Vaud: the territory of the Mobilis network.
    const vaudPath = resolve(cfg.zonesPath, '../vaud-stops.json');
    const vaud = existsSync(vaudPath) ? new Set((JSON.parse(readFileSync(vaudPath, 'utf8')) as { stops: string[] }).stops) : null;
    zones = createZoneIndex(JSON.parse(readFileSync(cfg.zonesPath, 'utf8')) as ZoneTable, vaud ? { inNetwork: (id) => vaud.has(id) } : {});
  }

  // Quoted single-ticket prices (OJP Fare). Off unless OJP_FARE=1 and OJP_FARE_TOKEN are set:
  // the service has not answered since this was written, so the path is untested live. Quotes
  // that arrive within the time budget are used; later ones serve the next search.
  const fare = env.OJP_FARE === '1' ? createOjpFareClient() : null;
  const quotes = new Map<string, { single: number; travelClass: 1 | 2; half: boolean }>();
  const quoteKey = (legs: Leg[], cls: 1 | 2, half: boolean) => `${stopSequenceKey(legs)}#${cls}#${half ? 'h' : 'f'}`;
  const FARE_BUDGET_MS = 1500;

  const density = loadDensity();
  // Official fare data (zones per hop, tariff kilometres), refreshed with tools/nova-import.
  const nova = loadNova();
  const gtfs = resolve(ROOT, 'data/raw/gtfs.zip');
  const osm = resolve(ROOT, 'data/raw/switzerland.osm.pbf');
  return {
    routing: new MotisRouting({
      baseUrl: cfg.motisUrl,
      fetch: httpGet,
      timezone: PENDULAR_RULES.timezone,
      // Legs follow the tracks (MOTIS route shapes), so their length is the distance. Fallback
      // for a leg without a shape, calibrated on Lausanne–Bern, Vevey–Genève, Aigle–Lausanne (78, 74, 37 km
      // against about 97, 87 and 52 km of track): a rough correction until legs follow the tracks.
      transitDistanceFactor: { rail: 1.25, other: 1.15 },
      referenceTime: `${PENDULAR_RULES.referenceDate}T11:00:00Z`,
      versions: { timetable: `GTFS 2027, fetched ${readVersion(gtfs) ?? '?'}`, streets: `OSM, fetched ${readVersion(osm) ?? '?'}`, engine: 'MOTIS 2' },
    }),
    rules: PENDULAR_RULES,
    trafficFactor: (route) => trafficFactorAlong(density, route),
    parkingAt: (p) => {
      const d = density.around(p);
      return { ...parkingByDensity(d), residents: d.residents, jobs: d.jobs };
    },
    priceTransit: (legs, ctx) =>
      priceTransit(legs, ctx, {
        zones,
        nova,
        quote: fare ? (l) => quotes.get(quoteKey(l, ctx.traveller.travelClass, ctx.traveller.halfFare)) ?? null : undefined,
      }),
    prepareFares: fare
      ? async (trips, ctx) => {
          const { travelClass, halfFare } = ctx.traveller;
          const pending = trips
            .filter((legs) => !quotes.has(quoteKey(legs, travelClass, halfFare)))
            .map((legs) =>
              fare.quote(legs, { travelClass, halfFare }).then((q) => {
                if (q) quotes.set(quoteKey(legs, travelClass, halfFare), { single: q.single, travelClass: q.travelClass, half: q.half });
              }),
            );
          await Promise.race([Promise.allSettled(pending), new Promise((r) => setTimeout(r, FARE_BUDGET_MS))]);
        }
      : undefined,
    coveredByZones: (legs, z) => coveredByZones(legs, z, zones),
    co2KgPerYear,
    parkRail: sites.filter((s) => s.kind === 'parkRail').map(toCandidate),
    bikeParking: sites.filter((s) => s.kind === 'bikeParking').map(toCandidate),
    cityParkRide: city,
    tariffVersion: 'Mobilis 13.12.2026; GA/Half Fare 13.12.2026; T601/T650 edition 01.06.2026',
    parkingVersion: readVersion(cfg.parkingPath),
  };
}
