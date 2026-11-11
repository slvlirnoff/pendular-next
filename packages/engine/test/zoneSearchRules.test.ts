import { describe, expect, it } from 'vitest';
import { loadNetworks, networkPlans } from '../src/fares/networks.js';
import { loadNova } from '../src/fares/nova.js';
import { realisable, stopLinks, zoneGraph, zoneSearches, type ZoneGraph } from '../src/fares/zonePaths.js';
import { compare, insideSet, type EngineDeps, type ZoneSearchSet } from '../src/planner/compare.js';
import { prune, type Conn } from '../src/planner/prune.js';
import { MotisRouting } from '../src/routing/motis.js';
import { PENDULAR_RULES } from '../src/rules.js';
import type { CommuteOption, CommuteRequest, Itinerary, Leg, LeftOut, OptionKind, PricedProduct, RoutingProvider, StopPoint, WalkableStop } from '../src/types.js';

// The real fare data snapshot and the real price grids.
const nova = loadNova();
const networks = loadNetworks();
const deps = { nova, networks };
const mobilis = zoneGraph(nova, 'mobilis', networkPlans(nova, networks, 'mobilis')!.pass, networks.get('mobilis'));

const stop = (stopId: string): StopPoint => ({ name: nova.stopName(stopId) ?? stopId, stopId, lat: 46.6, lon: 6.7 });
const ride = (from: string, to: string, mid: string[] = [], mode: Leg['mode'] = 'bus'): Leg => ({
  mode,
  from: stop(from),
  to: stop(to),
  departure: '2027-01-19T06:40:00+01:00',
  arrival: '2027-01-19T07:34:00+01:00',
  durationMin: 54,
  distanceM: 30000,
  line: { name: 'x' },
  intermediateStops: mid.map(stop),
});

// ---- the stops within walking reach of the two ends ------------------------------------------------

describe('zones of the stops within walking reach', () => {
  // A home between Echandens (zone 33) and Ecublens (zone 12). The timetable boards bus 705 at
  // Echandens, Chocolatière, 8 minutes away: three zones to Lausanne, Flon. Ecublens, Larges
  // Pièces, the next stop of the same bus, is 11 minutes away and in zone 12: two zones.
  const CHOCOLATIERE = '8592244';
  const LARGES_PIECES = '8592248';
  const RIAZ = '8592243';
  const trip = [
    ride(CHOCOLATIERE, '8579233', [LARGES_PIECES, '8591961', '8591946', '8591951', '8591947']),
    ride('8501214', '8591818', ['8501213', '8501212', '8501211', '8501210', '8501209', '8501208', '8501207', '8592133'], 'metro'),
  ];

  it('places the three stops as the map does', () => {
    expect(mobilis.zonesOfStop(CHOCOLATIERE)).toEqual([33]);
    expect(mobilis.zonesOfStop(RIAZ)).toEqual([33]);
    expect(mobilis.zonesOfStop(LARGES_PIECES)).toEqual([12]);
  });
  it('without them nothing cheaper than the connection found is known', () => {
    expect(zoneSearches([trip], deps)).toEqual([]);
  });
  it('a stop in another zone adds that zone to the end: the two-zone pass is searched', () => {
    const sets = zoneSearches([trip], deps, { fromStops: [LARGES_PIECES], toStops: [] });
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ alliance: 'mobilis', zones: [11, 12], count: 2, why: 'path', cheaper: true });
  });
  it('a stop in a zone already there adds nothing', () => {
    expect(zoneSearches([trip], deps, { fromStops: [RIAZ], toStops: [] })).toEqual([]);
  });
  it('a set is searched only when it saves enough on the dearest pass found', () => {
    // Three zones CHF 1,008, two zones CHF 729 (adult, 2nd class, a year).
    expect(zoneSearches([trip], deps, { fromStops: [LARGES_PIECES], toStops: [], minSavingChf: 250 })).toHaveLength(1);
    expect(zoneSearches([trip], deps, { fromStops: [LARGES_PIECES], toStops: [], minSavingChf: 300 })).toEqual([]);
  });
  it('tells which sections a set allows', () => {
    const [set] = zoneSearches([trip], deps, { fromStops: [LARGES_PIECES], toStops: [] });
    expect(set!.allows(CHOCOLATIERE, LARGES_PIECES)).toBe(false);
    expect(set!.allows(LARGES_PIECES, '8591961')).toBe(true);
  });
});

// ---- a chain of hops inside the set ------------------------------------------------------------------

describe('realisable zone sets', () => {
  /** A hand-made plan: stops 1–2–3 in zones a–b–c along one line, stop 4 in zone d on a line 1–4, stop 5 near stop 4. */
  const hops = new Map<number, { to: number; zones: number[] }[]>();
  const hop = (a: number, b: number, zones: number[]) => {
    for (const [x, y] of [[a, b], [b, a]] as const) hops.set(x, [...(hops.get(x) ?? []), { to: y, zones }]);
  };
  hop(1, 2, [10, 20]);
  hop(2, 3, [20, 30]);
  hop(1, 4, [10, 40]);
  hop(5, 3, [40, 30]);
  const g = { hopsAt: (s: number) => hops.get(s) ?? [] } as unknown as ZoneGraph;

  it('needs a chain of hops whose zones all lie in the set', () => {
    expect(realisable(g, [10, 20, 30], [1], [3])).toBe(true);
    expect(realisable(g, [10, 30], [1], [3])).toBe(false);
    // Zones 10, 40 and 30 touch, but no vehicle joins stop 4 to stop 5.
    expect(realisable(g, [10, 40, 30], [1], [3])).toBe(false);
  });
  it('lets the traveller walk to a stop nearby between two hops, once', () => {
    const links = new Map([[4, [5]], [5, [4]]]);
    expect(realisable(g, [10, 40, 30], [1], [3], links)).toBe(true);
    // Two walks in a row would cross a town for free: 4 → 5 → 6 is not a transfer.
    hop(6, 3, [40, 30]);
    const chain = new Map([[4, [7]], [7, [4, 6]], [6, [7]]]);
    expect(realisable(g, [10, 40], [1], [6], chain)).toBe(false);
  });
  it('starts from any stop given, and passes a graph without hops', () => {
    expect(realisable(g, [20, 30], [1, 2], [3])).toBe(true);
    expect(realisable({} as ZoneGraph, [1], [1], [2])).toBe(true);
  });

  it('Poliez-Pittet → Lausanne: zones 11 12 17 57 can be ridden, 11 12 18 57 only touch', () => {
    // Found: bus 440 to Echallens and the LEB, five zones. Two paths of four zones exist on the map.
    const POLIEZ = '8570210';
    const FLON = '8501181';
    const trip = [ride(POLIEZ, '8570203', ['8570208', '8570207', '8570206', '8570205', '8570204']), ride('8501174', FLON, ['8501173', '8501172', '8501171', '8587727', '8501169', '8501170', '8501168', '8501166', '8501165', '8501164', '8501163', '8501162', '8501160'], 'rail')];
    // Les Roches and the village stop, 6 and 10 minutes from the home, are where bus 670 calls.
    const near = { fromStops: ['8570211', '8570212'], toStops: ['8591818'] };
    const all = zoneSearches([trip], deps, { ...near, realisableOnly: false }).map((s) => s.zones.join(' '));
    expect(all).toEqual(expect.arrayContaining(['11 12 17 57', '11 12 18 57']));
    const kept = zoneSearches([trip], deps, near).map((s) => s.zones.join(' '));
    expect(kept).toContain('11 12 17 57');
    expect(kept).not.toContain('11 12 18 57');
    // Without the stops around the ends the question is not asked.
    expect(zoneSearches([trip], deps).map((s) => s.zones.join(' '))).toContain('11 12 18 57');
    const from = [POLIEZ, ...near.fromStops].map(Number);
    expect(realisable(mobilis, [11, 12, 17, 57], from, [Number(FLON), 8591818], stopLinks(nova))).toBe(true);
    expect(realisable(mobilis, [11, 12, 18, 57], from, [Number(FLON), 8591818], stopLinks(nova))).toBe(false);
    // From the stop the timetable search boards at, no vehicle stays inside zones 11 12 17 57.
    expect(realisable(mobilis, [11, 12, 17, 57], [Number(POLIEZ)], [Number(FLON), 8591818], stopLinks(nova))).toBe(false);
  });
  it('knows the stops a traveller changes between on foot', () => {
    // Lausanne (station) and Lausanne, gare (metro and buses).
    expect(stopLinks(nova).get(8501120)).toContain(8592050);
  });
});

// ---- a connection outside its zone set ----------------------------------------------------------------

describe('insideSet', () => {
  const at = (hhmm: string) => `2027-01-19T${hhmm}:00+01:00`;
  const p = (name: string, extra: Partial<StopPoint> = {}): StopPoint => ({ name, stopId: name, lat: 46.5, lon: 6.5, ...extra });
  const walk: Leg = { mode: 'walk', from: { name: 'Home', lat: 46.5, lon: 6.5 }, to: p('A'), departure: at('06:50'), arrival: at('06:58'), durationMin: 8, distanceM: 600 };
  const bus: Leg = { mode: 'bus', from: p('A'), to: p('D'), departure: at('06:58'), arrival: at('07:20'), durationMin: 22, distanceM: 9000, line: { name: '705' }, tripId: 't1', intermediateStops: [p('B', { arrival: at('07:00'), departure: at('07:01') }), p('C', { arrival: at('07:10'), departure: at('07:10') })] };
  const end: Leg = { mode: 'walk', from: p('D'), to: { name: 'Work', lat: 46.5, lon: 6.6 }, departure: at('07:20'), arrival: at('07:22'), durationMin: 2, distanceM: 150 };
  const it0: Itinerary = { departure: at('06:50'), arrival: at('07:22'), durationMin: 32, changes: 0, legs: [walk, bus, end] };
  const set = (allows: (a: string, b: string) => boolean): ZoneSearchSet => ({ alliance: 'net', zones: [1], tags: ['net:1'], allows });
  const near = (stopId: string, walkMin: number): WalkableStop => ({ stopId, name: stopId, lat: 46.5, lon: 6.5, walkMin });

  it('leaves a connection inside the set alone', () => {
    expect(insideSet(it0, set(() => true), [], [])).toBe(it0);
    expect(insideSet(it0, { alliance: 'net', zones: [1], tags: [] }, [], [])).toBe(it0);
  });
  it('boards at the first stop inside the set when it is within walking reach', () => {
    const fixed = insideSet(it0, set((a) => a !== 'A'), [near('B', 11)], [])!;
    expect(fixed.legs.map((l) => `${l.mode} ${l.from.name}>${l.to.name}`)).toEqual(['walk Home>B', 'bus B>D', 'walk D>Work']);
    // Leaves B at 07:01 after 11 minutes on foot.
    expect(new Date(fixed.departure).toISOString()).toBe(new Date(at('06:50')).toISOString());
    expect(fixed.durationMin).toBe(32);
    expect(fixed.legs[1]).toMatchObject({ departure: at('07:01'), durationMin: 19, distanceM: 6000, tripId: 't1' });
    expect(fixed.legs[1]!.intermediateStops!.map((s) => s.name)).toEqual(['C']);
    expect(fixed.legs[1]!.from).toEqual(p('B'));
  });
  it('drops it when that stop is too far, or when the set is left in the middle', () => {
    expect(insideSet(it0, set((a) => a !== 'A'), [near('C', 9)], [])).toBeNull();
    // Outside between two sections inside: no stop to board or alight at mends that.
    expect(insideSet(it0, set((a) => a !== 'B'), [near('B', 5), near('C', 5)], [near('B', 5), near('C', 5)])).toBeNull();
  });
  it('alights at the last stop inside the set when work is within walking reach of it', () => {
    const fixed = insideSet(it0, set((_a, b) => b !== 'D'), [], [near('C', 6)])!;
    expect(fixed.legs.map((l) => `${l.mode} ${l.from.name}>${l.to.name}`)).toEqual(['walk Home>A', 'bus A>C', 'walk C>Work']);
    expect(new Date(fixed.arrival).toISOString()).toBe(new Date(at('07:16')).toISOString());
    expect(fixed.legs[1]!.intermediateStops!.map((s) => s.name)).toEqual(['B']);
  });
});

// ---- the same vehicle reached by a feeder ------------------------------------------------------------

describe('a feeder to the same vehicle', () => {
  const HOME = { name: 'Village', stopId: '100', lat: 46.3, lon: 6.9 };
  const STATION = { name: 'Station', stopId: '200', lat: 46.31, lon: 6.95 };
  const CITY = { name: 'City', stopId: '300', lat: 46.52, lon: 6.63 };
  const iso = (hhmm: string) => `2027-01-19T${hhmm}:00+01:00`;
  const leg = (mode: Leg['mode'], from: StopPoint, to: StopPoint, dep: string, arr: string, line?: string): Leg => ({
    mode,
    from,
    to,
    departure: iso(dep),
    arrival: iso(arr),
    durationMin: (Date.parse(iso(arr)) - Date.parse(iso(dep))) / 60000,
    distanceM: 1000,
    ...(line ? { line: { name: line }, tripId: `${line}-${dep}` } : {}),
  });
  const door = { name: 'Home', lat: 46.3, lon: 6.9 };
  /** On foot to the station, then the train. */
  const direct = (walkFrom: string, dep: string, arr: string): Itinerary => ({ departure: iso(walkFrom), arrival: iso(arr), durationMin: (Date.parse(iso(arr)) - Date.parse(iso(walkFrom))) / 60000, changes: 0, legs: [leg('walk', door, STATION, walkFrom, dep), leg('rail', STATION, CITY, dep, arr, 'IR95')] });
  /** A bus to the station, then the same train. */
  const fed = (busDep: string, busArr: string, dep: string, arr: string): Itinerary => ({ departure: iso(busDep), arrival: iso(arr), durationMin: (Date.parse(iso(arr)) - Date.parse(iso(busDep))) / 60000, changes: 1, legs: [leg('bus', HOME, STATION, busDep, busArr, '111'), leg('rail', STATION, CITY, dep, arr, 'IR95')] });
  const product = (): PricedProduct[] => [{ kind: 'zonePassYearly', yearly: 2475, provenance: 'tariff', alliance: 'net', zones: [1, 2], components: [{ key: 'network.year', params: { network: 'Net', zones: 2 }, yearly: 2475, provenance: 'tariff' }] }];
  const engine = (its: Itinerary[]): EngineDeps => ({
    routing: {
      transit: async () => its,
      street: async (q) => (q.profile === 'car' ? { durationMin: 30, distanceM: 30000 } : { durationMin: 400, distanceM: 30000 }),
      streetMatrix: async (q) => q.points.map(() => null),
      versions: async () => ({}),
    } as RoutingProvider,
    rules: PENDULAR_RULES,
    priceTransit: product,
    co2KgPerYear: () => 0,
    parkRail: [],
    bikeParking: [],
    cityParkRide: [],
  });
  const request: CommuteRequest = {
    home: { label: 'Home', lat: door.lat, lon: door.lon },
    work: { label: 'City', lat: CITY.lat, lon: CITY.lon },
    arrival: { from: '07:00', to: '09:00' },
    pattern: { weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'], weeksOff: 5 },
    traveller: { ageGroup: 'adult', travelClass: 2, halfFare: false, vaudResident: true },
    car: { costPerKm: 0.74, parkingAtWorkPerMonth: 260 },
    kinds: ['transit'],
  };
  const TRAINS = [direct('06:56', '07:06', '07:40'), direct('07:26', '07:36', '08:10')];

  it('leaving four minutes later for one more change is the same connection', async () => {
    // Aigle → Lausanne: the IR 95 of 07:06 with a bus that leaves home at 07:00.
    const res = await compare(request, engine([...TRAINS, fed('07:00', '07:03', '07:06', '07:40')]));
    const pt = res.options.filter((o) => o.kind === 'transit');
    expect(pt.map((o) => [o.title, o.departuresInWindow, o.durationMin])).toEqual([['Station → City, IR95', 2, 44]]);
  });
  it('leaving five minutes later is another way of travelling', async () => {
    const res = await compare(request, engine([...TRAINS, fed('07:01', '07:04', '07:06', '07:40')]));
    const pt = res.options.filter((o) => o.kind === 'transit');
    expect(pt.map((o) => o.title).sort()).toEqual(['Station → City, IR95', 'Village → City, 111 · IR95']);
  });
  it('another train stays, whatever it is reached by', async () => {
    const res = await compare(request, engine([...TRAINS, fed('07:13', '07:16', '07:21', '07:55')]));
    const pt = res.options.filter((o) => o.kind === 'transit');
    expect(pt).toHaveLength(2);
  });
  it('asks for the stops around both ends beside the first searches and hands them to the zone sets', async () => {
    const asked: unknown[] = [];
    const order: string[] = [];
    const base = engine(TRAINS);
    const d: EngineDeps = {
      ...base,
      routing: {
        ...base.routing,
        segmentFilter: true,
        transit: async (q) => {
          order.push(q.allowedSegmentTags ? 'zones' : 'plain');
          return q.allowedSegmentTags ? [] : TRAINS;
        },
        stopsWithinWalk: async (q) => {
          order.push(`walk ${q.direction} ${q.maxMin}`);
          return [{ stopId: q.direction === 'from' ? '150' : '350', name: 'x', lat: q.at.lat, lon: q.at.lon, walkMin: 9 }];
        },
      } as RoutingProvider,
      zoneSearches: (_trips, o) => {
        asked.push(o);
        return [{ alliance: 'net', zones: [1], tags: ['net:1'] }];
      },
    };
    await compare(request, d);
    expect(asked[0]).toMatchObject({ fromStops: ['150'], toStops: ['350'], minSavingChf: PENDULAR_RULES.zoneSearchMinSavingChf, pass: { category: 'adult', travelClass: 2 }, max: PENDULAR_RULES.zoneSearches });
    // Before the restricted search, and without waiting for the plain one.
    expect(order.indexOf('walk from 15')).toBeLessThan(order.indexOf('zones'));
    expect(order.indexOf('walk to 15')).toBeLessThan(order.indexOf('zones'));
    // Switched off by the rule.
    asked.length = 0;
    order.length = 0;
    await compare({ ...request, rules: { zoneSearchWalkMin: 0 } }, d);
    expect(order.some((x) => x.startsWith('walk'))).toBe(false);
    expect((asked[0] as { fromStops: string[] }).fromStops).toEqual([]);
  });
  it('the rule follows sameVehicleMinSaving', async () => {
    const res = await compare({ ...request, rules: { sameVehicleMinSaving: 3 } }, engine([...TRAINS, fed('07:00', '07:03', '07:06', '07:40')]));
    expect(res.options.filter((o) => o.kind === 'transit')).toHaveLength(2);
  });
});

// ---- car parks and bike parks ---------------------------------------------------------------------------

describe('what a car park is shown with', () => {
  const m = 60000;
  const c = (dep: number, arr: number, changes = 0): Conn => ({ dep: dep * m, arr: arr * m, min: arr - dep, changes });
  let n = 0;
  function opt(kind: OptionKind, site: string, ticket: string, yearly: number, conns: Conn[]): CommuteOption {
    return {
      id: `${kind}-${n++}`,
      kind,
      title: `${site} ${ticket} ${conns[0]!.dep / m}`,
      durationMin: Math.min(...conns.map((x) => x.min)),
      changes: 0,
      cost: { yearly, products: [], extras: [], provenance: 'tariff' },
      co2KgPerYear: 0,
      access: { id: site, name: site, kind: 'parkRail', lat: 46.5, lon: 6.6 },
      ticketGroup: `${kind}|${site}|${ticket}`,
      _conns: conns,
    } as unknown as CommuteOption;
  }
  const run = (options: CommuteOption[], rules = PENDULAR_RULES) => {
    const leftOut: LeftOut[] = [];
    return { kept: prune(options, leftOut, rules), leftOut };
  };

  it('keeps the cheapest and the fastest ticket of a site, nothing in between', () => {
    const cheap = opt('parkRail', 'A', 'bus', 4000, [c(0, 80)]);
    const middle = opt('parkRail', 'A', 'tram', 4300, [c(100, 175)]);
    const fast = opt('parkRail', 'A', 'train', 4700, [c(200, 260)]);
    const { kept, leftOut } = run([cheap, middle, fast]);
    expect(kept).toEqual(expect.arrayContaining([cheap, fast]));
    expect(kept).not.toContain(middle);
    // The site is still shown: it is not named among what was left out.
    expect(leftOut).toEqual([]);
  });
  it('drops a site that another beats on price and time with each of its tickets', () => {
    // Le Locle → Neuchâtel: Corcelles-Peseux, dearer and slower than Neuchâtel-Serrières.
    const near = opt('parkRail', 'Serrières', '1z', 10095, [c(0, 41), c(120, 161)]);
    const far = opt('parkRail', 'Corcelles', '1z', 10556, [c(60, 109)]);
    const farToo = opt('parkRail', 'Corcelles', '1z', 10556, [c(200, 252)]);
    const { kept, leftOut } = run([far, farToo, near]);
    expect(kept).toEqual([near]);
    expect(leftOut).toHaveLength(1);
    expect(leftOut[0]).toMatchObject({ title: 'Corcelles', code: 'dominated', against: near.title });
  });
  it('keeps a site that is faster, or cheaper, than the other', () => {
    const cheap = opt('parkRail', 'A', 't', 4000, [c(0, 80)]);
    const fast = opt('parkRail', 'B', 't', 5000, [c(100, 170)]);
    expect(run([cheap, fast]).kept).toHaveLength(2);
    // Two minutes faster is not faster.
    const hardly = opt('parkRail', 'C', 't', 5000, [c(100, 178)]);
    expect(run([cheap, hardly]).kept).toEqual([cheap]);
  });
  it('compares a station car park with a city park-and-ride, not with a bike park', () => {
    const rail = opt('parkRail', 'A', 't', 4000, [c(0, 60)]);
    const city = opt('cityParkRide', 'B', 't', 9000, [c(100, 170)]);
    const bike = opt('bikeRide', 'C', 't', 4500, [c(200, 270)]);
    const { kept } = run([rail, city, bike]);
    expect(kept).toEqual(expect.arrayContaining([rail, bike]));
    expect(kept).not.toContain(city);
  });
  it('shows at most maxRoutesPerAccessTicket routes of a ticket from a site', () => {
    const routes = [0, 100, 200, 300].map((t) => opt('parkRail', 'A', 't', 4000, [c(t, t + 60)]));
    expect(run(routes).kept).toHaveLength(PENDULAR_RULES.maxRoutesPerAccessTicket);
    expect(run(routes, { ...PENDULAR_RULES, maxRoutesPerAccessTicket: 3 }).kept).toHaveLength(3);
  });
});

// ---- the routing engine: stops around a place, a place a car cannot leave -----------------------------

describe('MotisRouting around a place', () => {
  const make = (answer: (u: URL) => unknown, urls: URL[] = []) =>
    new MotisRouting({
      baseUrl: 'http://motis.test',
      timezone: 'Europe/Zurich',
      referenceTime: '2027-01-19T11:00:00Z',
      fetch: (async (u: URL) => {
        urls.push(u);
        return new Response(JSON.stringify(answer(u)));
      }) as unknown as typeof fetch,
    });
  const at = { lat: 46.536, lon: 6.55 };

  it('lists the stations within the walk, one point each, with the walk by the streets', async () => {
    const urls: URL[] = [];
    const r = make((u) => {
      if (u.pathname.endsWith('/map/stops')) {
        return [
          { name: 'Chocolatière', stopId: 'ch_ch:1:sloid:92244:0:1', parentId: 'ch_Parentch:1:sloid:92244', lat: 46.5364, lon: 6.5469 },
          { name: 'Chocolatière', stopId: 'ch_ch:1:sloid:92244:0:2', parentId: 'ch_Parentch:1:sloid:92244', lat: 46.5365, lon: 6.5467 },
          { name: 'Larges Pièces', stopId: 'ch_ch:1:sloid:92248:0:1', parentId: 'ch_Parentch:1:sloid:92248', lat: 46.5319, lon: 6.5553 },
          { name: 'Across the motorway', stopId: 'ch_ch:1:sloid:99999:0:1', parentId: 'ch_Parentch:1:sloid:99999', lat: 46.5405, lon: 6.556 },
        ];
      }
      // Nearest first: Chocolatière 8 min, Larges Pièces 11 min, the third out of reach by the streets.
      return [{ duration: 480 }, { duration: 660 }, {}];
    }, urls);
    const stops = await r.stopsWithinWalk({ at, maxMin: 15, direction: 'from' });
    expect(stops.map((s) => [s.stopId, s.name, s.walkMin])).toEqual([
      ['8592244', 'Chocolatière', 8],
      ['8592248', 'Larges Pièces', 11],
    ]);
    const matrix = urls.find((u) => u.pathname.endsWith('/one-to-many'))!;
    expect(matrix.searchParams.get('mode')).toBe('WALK');
    expect(matrix.searchParams.get('max')).toBe('900');
    expect(matrix.searchParams.get('arriveBy')).toBe('false');
    expect(matrix.searchParams.get('many')!.split(',')).toHaveLength(3);
    // Towards the place for the work end.
    urls.length = 0;
    await r.stopsWithinWalk({ at, maxMin: 15, direction: 'to' });
    expect(urls.find((u) => u.pathname.endsWith('/one-to-many'))!.searchParams.get('arriveBy')).toBe('true');
  });

  it('starts a car route from a point nearby when the place cannot be left by car', async () => {
    const urls: URL[] = [];
    const stuck = '46.317;6.964';
    const r = make((u) => {
      if (u.pathname.endsWith('/one-to-many')) {
        // From the station forecourt no road leads anywhere; from every other point one does.
        return Array.from({ length: 8 }, () => (u.searchParams.get('one') === stuck ? {} : { duration: 120 }));
      }
      return { direct: [{ duration: 1740, startTime: '2027-01-19T11:00:00Z', endTime: '2027-01-19T11:29:00Z', transfers: 0, legs: [{ mode: 'CAR', from: { name: 'a', lat: 46.3, lon: 6.9 }, to: { name: 'b', lat: 46.5, lon: 6.6 }, duration: 1740, startTime: '2027-01-19T11:00:00Z', endTime: '2027-01-19T11:29:00Z', distance: 43000 }] }] };
    }, urls);
    const route = await r.street({ from: { lat: 46.317, lon: 6.964 }, to: { lat: 46.5167, lon: 6.6291 }, profile: 'car' });
    expect(route).toMatchObject({ durationMin: 29, distanceM: 43000 });
    const plan = urls.find((u) => u.pathname.endsWith('/plan'))!;
    expect(plan.searchParams.get('fromPlace')).not.toBe('46.317000,6.964000');
    expect(plan.searchParams.get('toPlace')).toBe('46.516700,6.629100');
    // Asked once per place: the second route makes one call.
    const before = urls.length;
    await r.street({ from: { lat: 46.317, lon: 6.964 }, to: { lat: 46.5167, lon: 6.6291 }, profile: 'car' });
    expect(urls.length).toBe(before + 1);
    // Walking and cycling start at the door.
    urls.length = 0;
    await r.street({ from: { lat: 46.317, lon: 6.964 }, to: { lat: 46.5167, lon: 6.6291 }, profile: 'walk' });
    expect(urls).toHaveLength(1);
    expect(urls[0]!.searchParams.get('fromPlace')).toBe('46.317000,6.964000');
  });
});
