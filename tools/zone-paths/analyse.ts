/**
 * For each test trip: the stops within walking reach of both ends and their zones, the zone sets
 * the planner would search (with and without the walkable stops), whether a chain of hops can
 * make each (`realisable`), and what the timetable returns inside each without a time limit.
 * Used to choose the rules in data/nova/ZONE-PATHS.md.
 *
 *   MOTIS_SEGMENT_FILTER=1 pnpm tsx tools/zone-paths/analyse.ts [--only=name] [lat,lon lat,lon]
 */
import { MotisRouting, PENDULAR_RULES, loadNetworks, loadNova, networkPlans, zoneGraph, zoneSearches, realisable, stopLinks, type Itinerary, type LatLon } from '../../packages/engine/src/index.js';

import { httpGet } from '../../apps/api/src/httpGet.js';

const args = process.argv.slice(2);
const ONLY = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const CASES: [string, number, number, number, number][] = [
  ['lovatens-epfl', 46.6918052, 6.8641889, 46.52219562, 6.56613675],
  ['lucens-lausanne', 46.7085, 6.8393, 46.5167, 6.6291],
  ['lelocle-neuchatel', 47.0577, 6.747, 46.9905, 6.929],
  ['marin-neuchatel', 47.003, 7.018, 46.9905, 6.929],
  ['chapelle-lausanne', 46.6693, 6.735, 46.5167, 6.6291],
  ['aigle-lausanne', 46.317, 6.964, 46.5167, 6.6291],
  ['morges-epfl', 46.5112, 6.4985, 46.5191, 6.5668],
  ['bulle-fribourg', 46.6183, 7.057, 46.8031, 7.1513],
  ['zurich-uster', 47.3779, 8.5403, 47.351, 8.7185],
  ['geneve-plo', 46.2102, 6.1424, 46.1667, 6.105],
];
const points = args.filter((a) => /^[\d.]+,[\d.]+$/.test(a)).map((a) => a.split(',').map(Number));
if (points.length === 2) CASES.splice(0, CASES.length, ['custom', points[0]![0]!, points[0]![1]!, points[1]![0]!, points[1]![1]!]);

const nova = loadNova();
const networks = loadNetworks();
const routing = new MotisRouting({ baseUrl: process.env.MOTIS_URL ?? 'http://127.0.0.1:8080', timezone: PENDULAR_RULES.timezone, referenceTime: `${PENDULAR_RULES.referenceDate}T11:00:00Z`, segmentFilter: true, fetch: httpGet });
const isTransit = (l: { line?: unknown }) => !!l.line;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('de-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' });

for (const [name, hLat, hLon, wLat, wLon] of CASES) {
  if (ONLY && !ONLY.includes(name)) continue;
  const home: LatLon = { lat: hLat, lon: hLon };
  const work: LatLon = { lat: wLat, lon: wLon };
  const q = { from: home, to: work, date: PENDULAR_RULES.referenceDate, window: { from: '07:30', to: '08:30' }, by: 'arrive' as const, maxWalkToStopMin: PENDULAR_RULES.walkToStopMaxMin };
  const t0 = performance.now();
  const [plain, alt, near, far] = await Promise.all([
    routing.transit(q),
    routing.transit({ ...q, alternateTies: true }),
    routing.stopsWithinWalk({ at: home, maxMin: 15, direction: 'from' }),
    routing.stopsWithinWalk({ at: work, maxMin: 15, direction: 'to' }),
  ]);
  const found = [...plain, ...alt].filter((it) => it.legs.some(isTransit));
  const trips = found.map((it) => it.legs.filter(isTransit));
  const fastest = Math.min(...found.map((it) => it.durationMin));
  console.log(`\n## ${name}: ${found.length} connections, fastest ${fastest} min; ${near.length} stops within 15 min of home, ${far.length} of work (${Math.round(performance.now() - t0)} ms)`);
  const firsts = new Set(trips.map((l) => l[0]!.from.stopId));
  const lasts = new Set(trips.map((l) => l[l.length - 1]!.to.stopId));
  const alliances = [...new Set([...firsts].flatMap((s) => nova.alliancesAt(s!)))].filter((a) => [...lasts].some((s) => nova.alliancesAt(s!).includes(a)) && networks.get(a) && networkPlans(nova, networks, a));
  for (const a of alliances) {
    const g = zoneGraph(nova, a, networkPlans(nova, networks, a)!.pass, networks.get(a));
    const z = (stops: Iterable<string | undefined>) => [...new Set([...stops].flatMap((s) => g.zonesOfStop(s!)))].sort((x, y) => x - y);
    const used = z(firsts);
    const usedTo = z(lasts);
    const more = near.filter((s) => g.zonesOfStop(s.stopId).some((x) => !used.includes(x)));
    const moreTo = far.filter((s) => g.zonesOfStop(s.stopId).some((x) => !usedTo.includes(x)));
    console.log(` ${a}: home zones [${used}] + walkable ${more.map((s) => `${s.name} ${Math.round(s.walkMin)}′ [${g.zonesOfStop(s.stopId)}]`).join('; ') || 'none'}`);
    console.log(` ${a}: work zones [${usedTo}] + walkable ${moreTo.map((s) => `${s.name} ${Math.round(s.walkMin)}′ [${g.zonesOfStop(s.stopId)}]`).join('; ') || 'none'}`);
  }
  const base = { max: 12, extra: 2, realisableOnly: false };
  const without = zoneSearches(trips, { nova, networks }, base);
  const withWalk = zoneSearches(trips, { nova, networks }, { ...base, fromStops: near.map((s) => s.stopId), toStops: far.map((s) => s.stopId) });
  const key = (s: { alliance: string; zones: number[] }) => `${s.alliance}:${s.zones.join(',')}`;
  const old = new Set(without.map(key));
  const answers = await Promise.all(withWalk.map((s) => routing.transit({ ...q, allowedSegmentTags: s.tags, maxTravelMin: 240 }).catch(() => [] as Itinerary[])));
  withWalk.forEach((s, i) => {
    const g = zoneGraph(nova, s.alliance, networkPlans(nova, networks, s.alliance)!.pass, networks.get(s.alliance));
    const num = (x: string | undefined) => Number(x);
    const real = realisable(g, s.zones, [...firsts, ...near.map((n) => n.stopId)].map(num), [...lasts, ...far.map((n) => n.stopId)].map(num), stopLinks(nova));
    const noLinks = realisable(g, s.zones, [...firsts, ...near.map((n) => n.stopId)].map(num), [...lasts, ...far.map((n) => n.stopId)].map(num));
    const net = networks.get(s.alliance)!;
    const price = net.bySet ? net.setPass('year', s.zones, { category: 'adult', travelClass: 2 })?.price : net.pass('year', s.count, { category: 'adult', travelClass: 2 });
    const its = answers[i]!.filter((it) => it.legs.some(isTransit));
    console.log(
      `  ${old.has(key(s)) ? ' ' : '+'} ${s.alliance} ${s.count}z ${s.why} [${s.zones.join(' ')}] CHF ${price ?? '?'} realisable=${real}${real !== noLinks ? ' (only with walks between stops)' : ''} => ${its.length ? its.map((it) => `${hhmm(it.departure)}-${hhmm(it.arrival)} ${it.durationMin}′ ${it.changes}ch ${it.legs.filter(isTransit).map((l) => l.line?.name).join('·')}`).join(' | ') : 'nothing'}${real === (its.length > 0) ? '' : real ? '   <-- realisable, nothing in the window' : '   <-- NOT realisable, yet found'}`,
    );
  });
  for (const s of without) if (!withWalk.some((w) => key(w) === key(s))) console.log(`  - ${key(s)} (only without the walkable stops)`);
}
