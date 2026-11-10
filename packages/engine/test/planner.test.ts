import { describe, expect, it } from 'vitest';
import { compare, type AccessCandidate, type EngineDeps } from '../src/planner/compare.js';
import { groupItineraries } from '../src/planner/group.js';
import { priceTransit } from '../src/fares/price.js';
import { createZoneIndex, type ZoneTable } from '../src/fares/zones.js';
import { mobilisPass, mobilisSingle } from '../src/fares/mobilis.js';
import { PENDULAR_RULES, tripsPerYear, workingDaysPerYear } from '../src/rules.js';
import type { CommuteRequest, Itinerary, Leg, RoutingProvider, StopPoint, StreetRoute } from '../src/types.js';

const stop = (name: string, stopId: string, lat = 46.6, lon = 6.7): StopPoint => ({ name, stopId, lat, lon });
const HOME = stop('Village', '100', 46.7, 6.8);
const STATION = stop('Bigtown', '200', 46.68, 6.75);
const CITY = stop('City', '300', 46.52, 6.63);

function rail(from: StopPoint, to: StopPoint, dep: string, arr: string, line: string, km = 20, mid: StopPoint[] = []): Leg {
  const d = `2027-01-19T${dep}:00+01:00`;
  const a = `2027-01-19T${arr}:00+01:00`;
  return { mode: 'rail', from, to, departure: d, arrival: a, durationMin: (Date.parse(a) - Date.parse(d)) / 60000, distanceM: km * 1000, line: { name: line }, intermediateStops: mid };
}
function trip(...legs: Leg[]): Itinerary {
  const first = legs[0]!;
  const last = legs[legs.length - 1]!;
  return { departure: first.departure, arrival: last.arrival, durationMin: (Date.parse(last.arrival) - Date.parse(first.departure)) / 60000, changes: legs.length - 1, legs };
}

const TABLE: ZoneTable = {
  network: 'Mobilis',
  zones: { '1': { neighbours: [2] }, '2': { neighbours: [1, 3] }, '3': { neighbours: [2, 4] }, '4': { neighbours: [3] }, '12': { neighbours: [11] }, '11': { neighbours: [12] } },
  stops: [
    { label: 'Village', zones: [1], gtfs: [{ stopId: '100' }], confidence: 'high' },
    { label: 'Bigtown', zones: [1, 2], border: true, gtfs: [{ stopId: '200' }], confidence: 'high' },
    { label: 'City', zones: [4], gtfs: [{ stopId: '300' }], confidence: 'high' },
    { label: 'Centre', zones: [12], gtfs: [{ stopId: '400' }], confidence: 'high' },
  ],
};
const zones = createZoneIndex(TABLE);

const ctx = (over: Partial<CommuteRequest['traveller']> = {}) => ({
  traveller: { ageGroup: 'adult' as const, travelClass: 2 as const, halfFare: false, vaudResident: true, ...over },
  tripsPerYear: 470,
  workingDaysPerYear: 235,
  weeksWorked: 47,
  rules: PENDULAR_RULES,
});

describe('rules', () => {
  it('counts working days and trips', () => {
    const p = { weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'] as const, weeksOff: 5 };
    expect(workingDaysPerYear({ ...p, weekdays: [...p.weekdays] }, PENDULAR_RULES)).toBe(230);
    expect(tripsPerYear({ ...p, weekdays: [...p.weekdays] }, PENDULAR_RULES)).toBe(460);
  });
});

describe('zones', () => {
  it('counts a border stop in the zone already in use', () => {
    const r = zones.zonesForLegs([rail(HOME, STATION, '07:00', '07:10', 'R1')])!;
    expect(r.zones).toEqual([1]);
    expect(r.exact).toBe(true);
  });
  it('adds the zones crossed without a stop, by the zone graph', () => {
    const r = zones.zonesForLegs([rail(STATION, CITY, '07:15', '07:40', 'IR 1')])!;
    expect(r.zones).toEqual([2, 3, 4]);
    // A rule checked against SBB's shop: the result stays certain, with a note.
    expect(r.exact).toBe(true);
    expect(r.notes.join(' ')).toContain('crossed without a stop');
  });
  it('is uncertain only when a stop has no reliable zone', () => {
    const idx = createZoneIndex({
      ...TABLE,
      stops: [
        ...TABLE.stops.map((s) => ({ ...s, gtfs: s.gtfs!.map((g) => ({ ...g, name: s.label, lat: 46.6, lon: 6.7 })) })),
        { label: 'Farside', zones: [3], confidence: 'high' as const, gtfs: [{ stopId: '500', name: 'Farside', lat: 46.6, lon: 6.72 }] },
      ],
    });
    // 300 m from drawn stops that all sit at the same place but in different zones: a guess.
    const between = { name: 'Nowhere, croisée', stopId: '777', lat: 46.6, lon: 6.71 };
    expect(idx.zonesOfStop(between)?.confident).toBe(false);
    expect(idx.zonesForLegs([rail(HOME, between, '07:00', '07:10', 'R1')])!.exact).toBe(false);
  });
  it('always counts Lausanne zones 11 and 12 together', () => {
    const centre = stop('Centre', '400');
    expect(zones.zonesForLegs([{ ...rail(centre, centre, '07:00', '07:05', 'm2'), mode: 'metro' }])!.zones).toEqual([11, 12]);
  });
  it('gives no zone to a stop outside the network territory, even near drawn stops', () => {
    const inside = createZoneIndex(
      { ...TABLE, stops: TABLE.stops.map((s) => ({ ...s, gtfs: s.gtfs!.map((g) => ({ ...g, name: s.label, lat: 46.6, lon: 6.7 })) })) },
      { inNetwork: (id) => id !== '999' },
    );
    const near = stop('Borderville', '998');
    const beyond = stop('Otherton FR', '999');
    expect(inside.zonesOfStop(near)).not.toBeNull();
    expect(inside.zonesOfStop(beyond)).toBeNull();
    expect(inside.zonesForLegs([rail(HOME, CITY, '07:00', '07:40', 'IR 1', 20, [beyond])])).toBeNull();
  });
  it('lets a stop outside the territory borrow a zone from a drawn stop that is outside too', () => {
    const shared = createZoneIndex(
      {
        ...TABLE,
        stops: [
          ...TABLE.stops.map((s) => ({ ...s, gtfs: s.gtfs!.map((g) => ({ ...g, name: s.label, lat: 46.6, lon: 6.7 })) })),
          { label: 'Sharedtown', zones: [3], confidence: 'high' as const, gtfs: [{ stopId: '900', name: 'Sharedtown', lat: 46.9, lon: 7.0 }] },
        ],
      },
      { inNetwork: (id) => !id.startsWith('9') },
    );
    // 500 m from the drawn cross-border stop: same zone. Next to drawn stops inside only: none.
    expect(shared.zonesOfStop({ name: 'Sharedtown, école', stopId: '901', lat: 46.9045, lon: 7.0 })?.zones).toEqual([3]);
    expect(shared.zonesOfStop({ name: 'Otherton FR', stopId: '999', lat: 46.6, lon: 6.7 })).toBeNull();
  });
  it('returns null when a trip ends outside the table', () => {
    expect(zones.zonesForLegs([rail(HOME, stop('Elsewhere', '999'), '07:00', '08:00', 'IC 1')])).toBeNull();
  });
});

describe('priceTransit', () => {
  it('prices Mobilis products by zone count and picks the cheapest first', () => {
    const products = priceTransit([rail(HOME, STATION, '07:00', '07:10', 'R1')], ctx(), { zones });
    const byKind = Object.fromEntries(products.map((p) => [p.kind, p]));
    expect(byKind.singles!.yearly).toBe(Math.round(mobilisSingle(1, { travelClass: 2, half: false })! * 470));
    expect(byKind.zonePassYearly!.yearly).toBe(mobilisPass('year', 1, { category: 'adult', travelClass: 2 }));
    expect(byKind.zonePassYearly!.provenance).toBe('tariff');
    expect(products[0]!.yearly).toBe(Math.min(...products.map((p) => p.yearly)));
    expect(byKind.ga).toBeDefined();
  });
  it('halves the annual pass for young Vaud residents', () => {
    const legs = [rail(STATION, CITY, '07:15', '07:40', 'IR 1')];
    const youth = priceTransit(legs, ctx({ ageGroup: 'youth' }), { zones }).find((p) => p.kind === 'zonePassYearly')!;
    expect(youth.yearly).toBe(Math.round(mobilisPass('year', 3, { category: 'junior', travelClass: 2 })! / 2));
    expect(youth.provenance).toBe('tariff');
  });
  it('uses the distance tariff outside the zone table', () => {
    const products = priceTransit([rail(HOME, stop('Elsewhere', '999'), '07:00', '08:00', 'IC 1', 60)], ctx(), { zones });
    expect(products.some((p) => p.kind === 'routePassYearly')).toBe(true);
    expect(products.every((p) => p.kind === 'ga' || p.provenance === 'estimated' || p.kind.includes('DayPass'))).toBe(true);
  });
  it('does not charge the Half Fare card to someone who owns it', () => {
    const p = priceTransit([rail(HOME, STATION, '07:00', '07:10', 'R1')], ctx({ halfFare: true }), { zones }).find((x) => x.kind === 'halfFareSingles')!;
    expect(p.components).toHaveLength(1);
  });
});

describe('groupItineraries', () => {
  it('groups connections of the same lines into one route', () => {
    const g = groupItineraries([
      trip(rail(HOME, CITY, '07:00', '07:40', 'R1')),
      trip(rail(HOME, CITY, '07:30', '08:10', 'R1')),
      trip(rail(HOME, STATION, '07:05', '07:15', 'R1'), rail(STATION, CITY, '07:20', '07:40', 'IR 1')),
    ]);
    expect(g).toHaveLength(2);
    expect(g.find((x) => x.changes === 0)!.departures).toBe(2);
  });
});

function fakeRouting(): RoutingProvider {
  const car: StreetRoute = { durationMin: 30, distanceM: 30000 };
  return {
    async transit(q) {
      if (q.by === 'depart') return [trip(rail(CITY, HOME, '17:05', '17:45', 'R1')), trip(rail(CITY, HOME, '22:35', '23:15', 'R1'))];
      // From home: a slow direct train twice. From the station: a fast train every half hour.
      if (Math.abs(q.from.lat - HOME.lat) < 1e-6) return [trip(rail(HOME, CITY, '07:00', '07:50', 'R1')), trip(rail(HOME, CITY, '08:00', '08:50', 'R1'))];
      return ['07:10', '07:40', '08:10', '08:40'].map((d) => trip(rail(STATION, CITY, d, `${d.slice(0, 3)}${Number(d.slice(3)) + 15}`, 'IR 1')));
    },
    async street(q) {
      if (q.profile === 'car') return car;
      if (q.profile === 'walk') return { durationMin: 400, distanceM: 30000 };
      return { durationMin: q.profile === 'ebike' ? 80 : 110, distanceM: 30000 };
    },
    async streetMatrix(q) {
      return q.points.map(() => ({ durationMin: q.profile === 'car' ? 8 : 15, distanceM: 6000 }));
    },
    async lastTrip() {
      return trip(rail(CITY, HOME, '22:35', '23:15', 'R1'));
    },
    async versions() {
      return { timetable: 'test' };
    },
  };
}

const site = (kind: AccessCandidate['kind'], prices: AccessCandidate['prices']): AccessCandidate => ({ id: `${kind}-1`, name: 'Bigtown', kind, lat: STATION.lat, lon: STATION.lon, prices });

function deps(): EngineDeps {
  return {
    routing: fakeRouting(),
    rules: PENDULAR_RULES,
    priceTransit: (legs, c) => priceTransit(legs, c, { zones }),
    co2KgPerYear: (legs, trips) => (legs.reduce((s, l) => s + (l.mode === 'car' ? 0.3 : 0.01) * (l.distanceM / 1000), 0) * trips),
    parkRail: [site('parkRail', { day: 5, month: 60, year: 500 })],
    bikeParking: [site('bikeParking', { day: null, month: null, year: null })],
    cityParkRide: [],
    now: () => new Date('2026-11-10T12:00:00Z'),
  };
}

const REQUEST: CommuteRequest = {
  home: { label: 'Village', lat: HOME.lat, lon: HOME.lon },
  work: { label: 'City', lat: CITY.lat, lon: CITY.lon },
  arrival: { from: '07:00', to: '09:00' },
  pattern: { weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'], weeksOff: 5 },
  traveller: { ageGroup: 'adult', travelClass: 2, halfFare: false, vaudResident: true },
  car: { costPerKm: 0.74, parkingAtWorkPerMonth: 260 },
};

describe('compare', () => {
  it('builds transit, P+Rail and car options with costs, CO₂ and a verdict', async () => {
    const r = await compare(REQUEST, deps());
    const kinds = r.options.map((o) => o.kind);
    expect(kinds).toContain('transit');
    expect(kinds).toContain('parkRail');
    expect(kinds).toContain('car');
    expect(kinds).not.toContain('walk');
    expect(r.leftOut.some((l) => l.kind === 'walk' && l.code === 'tooLong')).toBe(true);

    const pr = r.options.find((o) => o.kind === 'parkRail')!;
    // 8 min drive × 1.3 peak factor + 5 min transfer + 15 min train = 30.4, rounded to 30.
    expect(pr.durationMin).toBe(30);
    expect(pr.departuresInWindow).toBe(4);
    // Cheapest parking: the yearly pass (500) beats 12 × 60 and 230 × 5.
    expect(pr.cost.extras.find((e) => e.key === 'parking.year')!.yearly).toBe(500);
    expect(pr.cost.extras.some((e) => e.key === 'car.distance')).toBe(true);
    expect(pr.returnTrips).toEqual({ last: '22:35', lastArrival: '23:15' });

    const car = r.options.find((o) => o.kind === 'car')!;
    expect(car.cost.yearly).toBe(Math.round(30 * 460 * 0.74) + 260 * 12);
    expect(pr.co2SavedKgPerYear).toBeGreaterThan(0);

    expect(r.verdict.fastest).toBe(pr.id);
    expect(r.stamp.tripsPerYear).toBe(460);
    expect(r.stamp.rules.id).toBe('pendular-2027');
  });

  it('charges bike and e-bike kilometres at the rule set rates', async () => {
    const r = await compare({ ...REQUEST, kinds: ['bike', 'ebike', 'car'], rules: { ebikeAllWayMaxMin: 120, bikeAllWayMaxMin: 120 } }, deps());
    const ebike = r.options.find((o) => o.kind === 'ebike')!;
    expect(ebike.cost.yearly).toBe(Math.round(30 * 460 * PENDULAR_RULES.ebikeFullCostPerKm));
    const bike = r.options.find((o) => o.kind === 'bike')!;
    expect(bike.cost.extras[0]!.key).toBe('bike.distance');
    expect(bike.cost.yearly).toBe(Math.round(30 * 460 * PENDULAR_RULES.bikeFullCostPerKm));
    const owned = await compare({ ...REQUEST, kinds: ['ebike', 'car'], bike: { ebikeCostPerKm: PENDULAR_RULES.ebikeRunningCostPerKm }, rules: { ebikeAllWayMaxMin: 120 } }, deps());
    expect(owned.options.find((o) => o.kind === 'ebike')!.cost.yearly).toBe(Math.round(30 * 460 * 0.09));
  });

  it('drops an e-bike ride that public transport beats on both time and cost', async () => {
    const r = await compare({ ...REQUEST, rules: { ebikeAllWayMaxMin: 120 } }, deps());
    expect(r.options.some((o) => o.kind === 'ebike')).toBe(false);
    expect(r.leftOut.some((l) => l.kind === 'ebike' && l.code === 'dominated')).toBe(true);
  });

  it('never lets a car option remove public transport', async () => {
    const r = await compare(REQUEST, deps());
    expect(r.options.filter((o) => o.kind === 'transit')).toHaveLength(1);
    expect(r.leftOut.every((l) => l.kind !== 'transit')).toBe(true);
  });

  it('stamps overridden rules', async () => {
    const r = await compare({ ...REQUEST, rules: { carPeakFactor: 1.3, carParkingMin: 10 } }, deps());
    expect(r.stamp.rules.id).toBe('pendular-2027+custom');
    expect(r.options.find((o) => o.kind === 'car')!.durationMin).toBe(49);
  });
});
