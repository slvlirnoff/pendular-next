/**
 * Looks for homes between two fare zones: points of a grid where the stops within 15 minutes on
 * foot lie in other zones than the stops the timetable search boards at, and where that gives a
 * zone set with fewer zones than every connection found.
 *
 *   pnpm tsx tools/zone-paths/find-borders.ts <latMin,lonMin> <latMax,lonMax> <workLat,workLon> [step=0.008]
 */
import { MotisRouting, PENDULAR_RULES, loadNetworks, loadNova, zoneSearches } from '../../packages/engine/src/index.js';
import { httpGet } from '../../apps/api/src/httpGet.js';

const [a, b, w] = process.argv.slice(2, 5).map((x) => x.split(',').map(Number)) as [number[], number[], number[]];
const step = Number(process.argv[5] ?? 0.008);
const nova = loadNova();
const networks = loadNetworks();
const routing = new MotisRouting({ baseUrl: 'http://127.0.0.1:8080', timezone: PENDULAR_RULES.timezone, referenceTime: `${PENDULAR_RULES.referenceDate}T11:00:00Z`, segmentFilter: true, fetch: httpGet });
const work = { lat: w[0]!, lon: w[1]! };
const far = await routing.stopsWithinWalk({ at: work, maxMin: 15, direction: 'to' });
for (let lat = a[0]!; lat <= b[0]!; lat += step) {
  for (let lon = a[1]!; lon <= b[1]!; lon += step * 1.45) {
    const home = { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4 };
    try {
      const near = await routing.stopsWithinWalk({ at: home, maxMin: 15, direction: 'from' });
      if (near.length < 2) continue;
      const found = (await routing.transit({ from: home, to: work, date: PENDULAR_RULES.referenceDate, window: { from: '07:30', to: '08:30' }, by: 'arrive', maxWalkToStopMin: PENDULAR_RULES.walkToStopMaxMin })).filter((it) => it.legs.some((l) => l.line));
      if (!found.length) continue;
      const trips = found.map((it) => it.legs.filter((l) => l.line));
      const o = { max: 6, extra: 2 };
      const without = zoneSearches(trips, { nova, networks }, o);
      const withWalk = zoneSearches(trips, { nova, networks }, { ...o, fromStops: near.map((s) => s.stopId), toStops: far.map((s) => s.stopId) });
      const least = (l: { count: number; cheaper: boolean }[]) => Math.min(Infinity, ...l.filter((s) => s.cheaper).map((s) => s.count));
      if (least(withWalk) < least(without)) console.log(`${home.lat},${home.lon} boards ${[...new Set(trips.map((l) => l[0]!.from.name))].join(' / ')}: cheaper set ${least(withWalk)}z [${withWalk[0]!.zones}] (without the walkable stops: ${Number.isFinite(least(without)) ? `${least(without)}z` : 'none'})`);
    } catch (e) {
      console.log('error', home, (e as Error).message.slice(0, 80));
    }
  }
}
