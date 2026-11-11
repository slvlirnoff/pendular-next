import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compare, type EngineDeps } from '../src/planner/compare.js';
import { MotisRouting } from '../src/routing/motis.js';
import { PENDULAR_RULES } from '../src/rules.js';
import { bikeShareCostPerYear, loadBikeShare, ridePrice, type BikeShareOperator } from '../src/sharing/bikeShare.js';
import type { CommuteRequest, Itinerary, Leg, PricedProduct, RoutingProvider, StopPoint } from '../src/types.js';

const at = (name: string, lat: number, lon: number, stopId?: string): StopPoint => ({ name, lat, lon, stopId });
const HOME = at('Home', 46.21, 6.142);
const WORK = at('Office', 46.167, 6.105);
const CENTRAL = at('Central', 46.2105, 6.1425, '8501008');
const MIDWAY = at('Midway', 46.2, 6.13, '8501100');
const SUBURB = at('Suburb', 46.174, 6.129, '8517142');
const NEAR_WORK = at('Office stop', 46.1675, 6.106, '8587000');
const HUB_HOME = at('Hub Home', 46.2101, 6.1423);
const HUB_SUBURB = at('Hub Suburb', 46.1741, 6.1295);
const HUB_WORK = at('Hub Office', 46.1668, 6.1045);

const iso = (hhmm: string) => `2027-01-19T${hhmm}:00+01:00`;
function leg(mode: Leg['mode'], from: StopPoint, to: StopPoint, dep: string, arr: string, extra: Partial<Leg> = {}): Leg {
  const durationMin = (Date.parse(iso(arr)) - Date.parse(iso(dep))) / 60000;
  return { mode, from, to, departure: iso(dep), arrival: iso(arr), durationMin, distanceM: mode === 'walk' ? durationMin * 75 : durationMin * 250, ...extra };
}
const ride = (from: StopPoint, to: StopPoint, dep: string, arr: string, electric = false) =>
  leg('sharedBike', from, to, dep, arr, { sharedBike: { providerId: 'test:bikes', system: 'Test Bikes City', fromStation: from.name, toStation: to.name, electric } });
function trip(...legs: Leg[]): Itinerary {
  const first = legs[0]!;
  const last = legs[legs.length - 1]!;
  const transit = legs.filter((l) => l.line).length;
  return { departure: first.departure, arrival: last.arrival, durationMin: (Date.parse(last.arrival) - Date.parse(first.departure)) / 60000, changes: Math.max(0, transit - 1), legs };
}

/** Public transport from home: a tram all the way, 37 minutes, no change. */
const TRAM = trip(leg('walk', HOME, CENTRAL, '07:20', '07:22'), leg('tram', CENTRAL, NEAR_WORK, '07:22', '07:55', { line: { name: '15' } }), leg('walk', NEAR_WORK, WORK, '07:55', '07:57'));
/** Train to the suburb, then a shared bike: 26 minutes. */
const TRAIN_BIKE = trip(
  leg('walk', HOME, CENTRAL, '07:30', '07:32'),
  leg('rail', CENTRAL, SUBURB, '07:32', '07:41', { line: { name: 'RE33' } }),
  leg('walk', SUBURB, HUB_SUBURB, '07:41', '07:44'),
  ride(HUB_SUBURB, HUB_WORK, '07:44', '07:54'),
  leg('walk', HUB_WORK, WORK, '07:54', '07:56'),
);
/** A shared bike to a train that the tram misses: 33 minutes. */
const BIKE_TRAIN = trip(
  leg('walk', HOME, HUB_HOME, '07:20', '07:21'),
  ride(HUB_HOME, HUB_SUBURB, '07:21', '07:30'),
  leg('walk', HUB_SUBURB, MIDWAY, '07:30', '07:33'),
  leg('rail', MIDWAY, NEAR_WORK, '07:33', '07:51', { line: { name: 'S1' } }),
  leg('walk', NEAR_WORK, WORK, '07:51', '07:53'),
);
/** All the way on a shared bike: 24 minutes with the walks. */
const BIKE_ONLY = trip(leg('walk', HOME, HUB_HOME, '07:30', '07:31'), ride(HUB_HOME, HUB_WORK, '07:31', '07:52', true), leg('walk', HUB_WORK, WORK, '07:52', '07:54'));

const OPERATOR: BikeShareOperator = {
  id: 'test',
  name: 'Test Bikes',
  providers: ['test:bikes'],
  url: 'https://bikes.test',
  source: 'https://bikes.test/prices',
  readOn: '2026-11-11',
  priceYear: 2026,
  payPerRide: { name: 'Pay per ride', bike: { tiers: [{ uptoMin: 30, price: 3 }], then: { price: 0.1, perMin: 1 } }, ebike: { tiers: [{ uptoMin: 30, price: 5 }], then: null } },
  memberships: [
    {
      name: 'Annual',
      annual: 99,
      fleet: 'mixed',
      areas: null,
      bike: { tiers: [{ uptoMin: 30, price: 0 }], then: { price: 0.1, perMin: 1 } },
      ebike: { tiers: [{ uptoMin: 15, price: 2 }, { uptoMin: 30, price: 3 }], then: null },
    },
  ],
};

type Shared = Partial<Record<'whole' | 'lastLeg' | 'firstLeg', Itinerary[]>>;
function routing(shared: Shared | null, transit: Itinerary[] = [TRAM]): RoutingProvider & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async transit(q) {
      return q.by === 'arrive' ? transit : [];
    },
    async street(q) {
      if (q.profile === 'walk') return { durationMin: 95, distanceM: 7000 };
      return { durationMin: q.profile === 'car' ? 20 : q.profile === 'ebike' ? 20 : 28, distanceM: 7000 };
    },
    async streetMatrix(q) {
      return q.points.map(() => null);
    },
    ...(shared
      ? {
          async sharedBike(q) {
            asked.push(`${q.use}:${q.providers.join(',')}:${q.maxStationWalkM}:${q.maxMin}`);
            return shared[q.use] ?? [];
          },
        }
      : {}),
    async versions() {
      return {};
    },
  };
}

const TICKET: PricedProduct = { kind: 'zonePassYearly', yearly: 500, provenance: 'tariff', components: [{ key: 'pass', yearly: 500, provenance: 'tariff' }] };
function deps(r: RoutingProvider, bikeShare: BikeShareOperator[] | undefined = [OPERATOR]): EngineDeps {
  return {
    routing: r,
    rules: PENDULAR_RULES,
    priceTransit: () => [TICKET],
    co2KgPerYear: (legs, trips) => legs.reduce((s, l) => s + (l.mode === 'car' ? 0.2 : l.mode === 'sharedBike' ? 0.005 : 0.01) * (l.distanceM / 1000), 0) * trips,
    parkRail: [],
    bikeParking: [],
    cityParkRide: [],
    bikeShare,
    now: () => new Date('2026-11-11T12:00:00Z'),
  };
}
const REQUEST: CommuteRequest = {
  home: { label: 'Home', lat: HOME.lat, lon: HOME.lon },
  work: { label: 'Office', lat: WORK.lat, lon: WORK.lon },
  arrival: { from: '07:30', to: '08:30' },
  pattern: { weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'], weeksOff: 5 },
  traveller: { ageGroup: 'adult', travelClass: 2, halfFare: false, vaudResident: false },
  car: { costPerKm: 0.74, parkingAtWorkPerMonth: 0 },
};

describe('shared-bike suggestion', () => {
  it('suggests a shared bike for the last leg when it saves time on public transport', async () => {
    const r = routing({ lastLeg: [TRAIN_BIKE] });
    const res = await compare(REQUEST, deps(r));
    const s = res.sharedBike!;
    expect(s.kind).toBe('lastLeg');
    expect(s.operator).toBe('Test Bikes');
    expect(s.durationMin).toBe(26);
    expect(s.stations.from).toMatchObject({ name: 'Hub Suburb', walkMin: 3 });
    expect(s.stations.to).toMatchObject({ name: 'Hub Office', walkMin: 2 });
    expect(s.rideMin).toBe(10);
    expect(s.rideKm).toBe(2.5);
    const tram = res.options.find((o) => o.kind === 'transit')!;
    expect(s.against).toEqual({ optionId: tram.id, minutesSaved: 11, changesSaved: 0, chfPerYear: 99 });
    // Ticket for the train plus the annual subscription; the ride is within the free half hour.
    expect(s.cost.ticket).toBe(TICKET);
    expect(s.cost.membership).toMatchObject({ key: 'bikeShare.annual', yearly: 99, unknown: false, priceYear: 2026, source: 'https://bikes.test/prices', ebikeExtraPerRide: 2 });
    expect(s.cost.yearly).toBe(599);
    expect(s.caveats).toEqual(['availabilityNotGuaranteed', 'electricSurcharge']);
    expect(s.hoursPerYear).toBe(Math.round((26 * 460) / 60));
    expect(s.co2KgPerYear).toBeGreaterThan(0);
    // The suggestion is not an option of the list.
    expect(res.options.some((o) => o.itinerary.legs.some((l) => l.mode === 'sharedBike'))).toBe(false);
    // The rules reach the routing provider.
    expect(r.asked).toContain('lastLeg:test:bikes:400:15');
    expect(r.asked).toContain('whole:test:bikes:400:25');
  });

  it('suggests the first leg only when it saves five minutes', async () => {
    const res = await compare(REQUEST, deps(routing({ firstLeg: [BIKE_TRAIN] })));
    // 33 minutes against 37: four minutes are not worth a box.
    expect(res.sharedBike).toBeUndefined();
    const lower = await compare({ ...REQUEST, rules: { sharedBikeMinSavingMin: 4 } }, deps(routing({ firstLeg: [BIKE_TRAIN] })));
    expect(lower.sharedBike).toMatchObject({ kind: 'firstLeg', durationMin: 33, stations: { from: { name: 'Hub Home', walkMin: 1 }, to: { name: 'Hub Suburb', walkMin: 3 } } });
    expect(lower.sharedBike!.against!.minutesSaved).toBe(4);
  });

  it('suggests the whole trip by shared bike, and takes what saves the most time', async () => {
    const res = await compare(REQUEST, deps(routing({ whole: [BIKE_ONLY], lastLeg: [TRAIN_BIKE] })));
    const s = res.sharedBike!;
    // 24 minutes against 26 for train and bike, and 37 for the tram.
    expect(s.kind).toBe('whole');
    expect(s.against!.minutesSaved).toBe(13);
    expect(s.electric).toBe(true);
    expect(s.cost.ticket).toBeUndefined();
    // Priced on a classic bike (the network has both): the subscription alone.
    expect(s.cost.yearly).toBe(99);
    expect(s.against!.chfPerYear).toBe(99 - 500);
  });

  it('shows the whole trip without public transport in the list, and nothing that is slower', async () => {
    const none = await compare(REQUEST, deps(routing({ whole: [BIKE_ONLY] }, [])));
    expect(none.sharedBike).toMatchObject({ kind: 'whole', durationMin: 24 });
    expect(none.sharedBike!.against).toBeUndefined();
    const fast = trip(leg('rail', CENTRAL, NEAR_WORK, '07:40', '07:55', { line: { name: 'S9' } }));
    const slower = await compare(REQUEST, deps(routing({ whole: [BIKE_ONLY], lastLeg: [TRAIN_BIKE] }, [fast])));
    expect(slower.sharedBike).toBeUndefined();
  });

  it('prefers fewer changes at equal time, and accepts a saved change without a time gain', async () => {
    const twoBuses = trip(leg('bus', CENTRAL, SUBURB, '07:25', '07:40', { line: { name: '1' } }), leg('bus', SUBURB, NEAR_WORK, '07:42', '07:53', { line: { name: '2' } }));
    const res = await compare(REQUEST, deps(routing({ lastLeg: [TRAIN_BIKE] }, [twoBuses])));
    // 26 minutes against 28: under five minutes, but one change fewer.
    expect(res.sharedBike).toMatchObject({ kind: 'lastLeg', against: { minutesSaved: 2, changesSaved: 1 } });
  });

  it('leaves out rides and walks beyond the rules', async () => {
    const farHub = trip(leg('walk', HOME, HUB_HOME, '07:24', '07:31'), ride(HUB_HOME, HUB_WORK, '07:31', '07:52'), leg('walk', HUB_WORK, WORK, '07:52', '07:54'));
    expect((await compare(REQUEST, deps(routing({ whole: [farHub] })))).sharedBike).toBeUndefined();
    expect((await compare({ ...REQUEST, rules: { sharedBikeMaxRideMin: 20 } }, deps(routing({ whole: [BIKE_ONLY] })))).sharedBike).toBeUndefined();
    expect((await compare({ ...REQUEST, rules: { sharedBikeLegMaxMin: 9 } }, deps(routing({ lastLeg: [TRAIN_BIKE] })))).sharedBike).toBeUndefined();
  });

  it('says so when the subscription price is unknown', async () => {
    const perRide: BikeShareOperator = { ...OPERATOR, memberships: [{ ...OPERATOR.memberships[0]!, annual: null }] };
    const paid = (await compare(REQUEST, deps(routing({ lastLeg: [TRAIN_BIKE] }), [perRide]))).sharedBike!;
    // No subscription price: every ride is paid, 460 rides at CHF 3.
    expect(paid.cost.membership).toMatchObject({ key: 'bikeShare.perRide', yearly: 1380, perRide: 3, unknown: false });
    expect(paid.cost.yearly).toBe(1880);
    expect(paid.caveats).toContain('membershipPriceUnknown');

    const nothing: BikeShareOperator = { ...OPERATOR, payPerRide: null, memberships: [] };
    const unknown = (await compare(REQUEST, deps(routing({ lastLeg: [TRAIN_BIKE] }), [nothing]))).sharedBike!;
    expect(unknown.cost.membership).toMatchObject({ key: 'bikeShare.unknown', unknown: true, yearly: 0 });
    expect(unknown.cost.membership.priceYear).toBeUndefined();
    expect(unknown.cost.yearly).toBeNull();
    expect(unknown.against!.chfPerYear).toBeNull();
    expect(unknown.caveats).toEqual(['availabilityNotGuaranteed', 'membershipPriceUnknown']);
  });

  it('can be switched off, and needs a routing provider and operators that know shared bikes', async () => {
    const r = routing({ lastLeg: [TRAIN_BIKE] });
    expect((await compare({ ...REQUEST, rules: { sharedBike: false } }, deps(r))).sharedBike).toBeUndefined();
    expect(r.asked).toEqual([]);
    expect((await compare(REQUEST, deps(routing(null)))).sharedBike).toBeUndefined();
    expect((await compare(REQUEST, deps(r, []))).sharedBike).toBeUndefined();
    expect(r.asked).toEqual([]);
    // A failing search costs the suggestion, not the result.
    const broken: RoutingProvider = { ...routing({}), sharedBike: async () => Promise.reject(new Error('down')) };
    const res = await compare(REQUEST, deps(broken));
    expect(res.sharedBike).toBeUndefined();
    expect(res.options.length).toBeGreaterThan(0);
  });

  it('does not change the options', async () => {
    const strip = (x: Awaited<ReturnType<typeof compare>>) => JSON.stringify({ o: x.options, l: x.leftOut, v: x.verdict, f: x.flexibleWork });
    const withBike = await compare(REQUEST, deps(routing({ whole: [BIKE_ONLY], lastLeg: [TRAIN_BIKE] })));
    const without = await compare(REQUEST, deps(routing(null)));
    expect(strip(withBike)).toBe(strip(without));
  });

  it('needs no bike for a walk of a quarter of an hour', async () => {
    const r = routing({ whole: [BIKE_ONLY] });
    r.street = async (q) => ({ durationMin: q.profile === 'walk' ? 14 : 5, distanceM: 1000 });
    const close = { ...REQUEST, work: { label: 'Office', lat: 46.205, lon: 6.138 } };
    expect((await compare(close, deps(r))).sharedBike).toBeUndefined();
    expect((await compare(close, deps(routing({ whole: [BIKE_ONLY] })))).sharedBike).toBeDefined();
  });
});

describe('bike-share prices', () => {
  it('prices a ride by steps, then by started blocks of minutes', () => {
    const p = { tiers: [{ uptoMin: 15, price: 2 }, { uptoMin: 30, price: 3 }], then: { price: 1, perMin: 15 } };
    expect(ridePrice(p, 8)).toBe(2);
    expect(ridePrice(p, 30)).toBe(3);
    expect(ridePrice(p, 31)).toBe(4);
    expect(ridePrice(p, 46)).toBe(5);
    expect(ridePrice({ tiers: p.tiers, then: null }, 31)).toBeNull();
    expect(ridePrice(null, 5)).toBeNull();
  });

  it('reads the operators of the data file', () => {
    const ops = loadBikeShare();
    const velospot = ops.find((o) => o.providers.includes('sharedmobility:velospot'))!;
    // Fribourg: CHF 69 a year, classic bike free for half an hour, an e-bike CHF 2 a ride.
    const fribourg = bikeShareCostPerYear(velospot, { at: { lat: 46.803, lon: 7.151 }, rideMin: 8, rides: 460 });
    expect(fribourg).toMatchObject({ yearly: 69, basis: 'annual', electric: false, ebikeExtraPerRide: 2, subscriptionUnknown: false });
    // Martigny has e-bikes only: CHF 199 with the first quarter of an hour free beats CHF 69 plus CHF 2 a ride.
    const martigny = bikeShareCostPerYear(velospot, { at: { lat: 46.1, lon: 7.07 }, rideMin: 8, rides: 460 });
    expect(martigny).toMatchObject({ yearly: 199, basis: 'annual', electric: true, plan: 'B-Fit Local (E-Bike)' });
    expect(martigny.ebikeExtraPerRide).toBeUndefined();
    // Outside the areas with a subscription: the national pay-as-you-go price.
    expect(bikeShareCostPerYear(velospot, { at: { lat: 47.0, lon: 9.0 }, rideMin: 8, rides: 100 })).toMatchObject({ yearly: 300, basis: 'perRide' });
    // Geneva: no subscription price found, CHF 2 a ride.
    const geneva = ops.find((o) => o.providers.includes('sharedmobility:donkey_ge'))!;
    expect(bikeShareCostPerYear(geneva, { at: { lat: 46.2, lon: 6.14 }, rideMin: 12, rides: 460 })).toMatchObject({ yearly: 920, basis: 'perRide', subscriptionUnknown: true, ebikeExtraPerRide: 1.1 });
    // Nothing known: no price.
    const thun = ops.find((o) => o.providers.includes('sharedmobility:donkey_thun'))!;
    expect(bikeShareCostPerYear(thun, { at: { lat: 46.75, lon: 7.63 }, rideMin: 12, rides: 460 })).toMatchObject({ yearly: null, basis: 'unknown', subscriptionUnknown: true });
    // Every provider belongs to one operator; a known price has a source.
    const ids = ops.flatMap((o) => o.providers);
    expect(new Set(ids).size).toBe(ids.length);
    for (const o of ops) if (o.memberships.some((m) => m.annual !== null) || o.payPerRide) expect(o.source).toBeTruthy();
  });
});

describe('MotisRouting.sharedBike', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/motis-shared-bike.json', import.meta.url), 'utf8')) as {
    lastLeg: unknown;
    whole: unknown;
    stations: { stations: { providerId: string }[] };
  };
  const PROVIDERS = '{"providerGroups":[],"providers":[{"id":"sharedmobility:donkey_ge","name":"Donkey Republic Geneva","groupId":"Donkey Republic Geneva","bbox":[Infinity,Infinity,-Infinity,-Infinity]}]}';
  const make = (urls: URL[], gbfs = true, stationsAtOrigin = false) =>
    new MotisRouting({
      baseUrl: 'http://motis.test',
      timezone: 'Europe/Zurich',
      referenceTime: '2027-01-19T11:00:00Z',
      fetch: (async (u: URL) => {
        urls.push(u);
        if (u.pathname === '/api/v1/rentals') {
          if (!u.searchParams.has('min')) return new Response(gbfs ? PROVIDERS : '{"providerGroups":[],"providers":[]}');
          // Stations only around the destination.
          const nearWork = stationsAtOrigin || u.searchParams.get('min')!.startsWith('46.16');
          return new Response(JSON.stringify(nearWork ? fixture.stations : { stations: [] }));
        }
        return new Response(JSON.stringify(u.searchParams.has('directRentalProviders') ? fixture.whole : fixture.lastLeg));
      }) as unknown as typeof fetch,
    });
  const q = {
    from: { lat: 46.2102, lon: 6.1424 },
    to: { lat: 46.1667, lon: 6.105 },
    date: '2027-01-19',
    window: { from: '07:30', to: '08:30' },
    providers: ['sharedmobility:donkey_ge', 'sharedmobility:velospot'],
    maxStationWalkM: 400,
    maxMin: 15,
  };

  it('maps a train and a shared bike for the last leg, and returns the bike at a station', async () => {
    const urls: URL[] = [];
    const its = await make(urls).sharedBike({ ...q, use: 'lastLeg' });
    const plan = urls.find((u) => u.pathname === '/api/v6/plan')!;
    // Only the providers the server has, bicycles only, within the leg limit.
    expect(plan.searchParams.get('postTransitModes')).toBe('WALK,RENTAL');
    expect(plan.searchParams.get('postTransitRentalFormFactors')).toBe('BICYCLE');
    expect(plan.searchParams.get('postTransitRentalProviders')).toBe('sharedmobility:donkey_ge');
    expect(plan.searchParams.get('maxPostTransitTime')).toBe('900');
    expect(plan.searchParams.get('arriveBy')).toBe('true');

    expect(its.length).toBeGreaterThan(0);
    const train = its.find((it) => it.legs.some((l) => l.mode === 'rail'))!;
    expect(train.legs.map((l) => l.mode)).toEqual(['walk', 'rail', 'walk', 'sharedBike', 'walk']);
    const bike = train.legs[3]!;
    expect(bike.sharedBike).toMatchObject({ providerId: 'sharedmobility:donkey_ge', system: 'Donkey Republic Geneva', fromStation: 'Lancy-Bachet-Gare (Pôle de Mobilité)' });
    // MOTIS leaves the bike at the door; the operator wants it at a station: the nearest one, then a walk.
    expect(bike.sharedBike!.toStation).not.toBe('');
    expect(bike.to.name).toBe(bike.sharedBike!.toStation);
    expect(bike.line).toBeUndefined();
    expect(bike.distanceM).toBeGreaterThan(2000);
    const walk = train.legs[4]!;
    expect(walk.from.name).toBe(bike.to.name);
    expect(walk.durationMin).toBeGreaterThanOrEqual(1);
    expect(walk.distanceM).toBeLessThanOrEqual(400);
    expect(Date.parse(train.arrival)).toBe(Date.parse(walk.arrival));
    expect(train.durationMin).toBe(Math.round((Date.parse(train.arrival) - Date.parse(train.departure)) / 60000));
    // Every trip has exactly one ride, after the last vehicle.
    for (const it of its) expect(it.legs.filter((l) => l.mode === 'sharedBike').length).toBe(1);
  });

  it('maps the whole trip by shared bike, and searches only with stations at both ends', async () => {
    const urls: URL[] = [];
    // No station near the origin: no route is asked for.
    expect(await make(urls).sharedBike({ ...q, use: 'whole', maxMin: 30 })).toEqual([]);
    expect(urls.some((u) => u.pathname === '/api/v6/plan')).toBe(false);

    const its = await make(urls, true, true).sharedBike({ ...q, use: 'whole', maxMin: 30 });
    const plan = urls.find((u) => u.pathname === '/api/v6/plan')!;
    expect(plan.searchParams.get('directModes')).toBe('WALK,RENTAL');
    expect(plan.searchParams.get('transitModes')).toBe('');
    expect(plan.searchParams.get('maxDirectTime')).toBe('2400');
    expect(its.length).toBeGreaterThan(0);
    expect(its[0]!.legs.map((l) => l.mode)).toEqual(['walk', 'sharedBike', 'walk']);
    expect(its[0]!.legs[1]!.sharedBike).toMatchObject({ fromStation: 'Genève Cornavin', electric: true });
    expect(its[0]!.changes).toBe(0);
  });

  it('drops a trip whose bike cannot be returned near the destination', async () => {
    const its = await make([]).sharedBike({ ...q, use: 'lastLeg', maxStationWalkM: 30 });
    expect(its).toEqual([]);
  });

  it('returns nothing without a shared-mobility feed, without asking for a route', async () => {
    const urls: URL[] = [];
    expect(await make(urls, false).sharedBike({ ...q, use: 'lastLeg' })).toEqual([]);
    expect(urls.every((u) => u.pathname === '/api/v1/rentals')).toBe(true);
    const down = new MotisRouting({ baseUrl: 'http://motis.test', timezone: 'Europe/Zurich', referenceTime: '2027-01-19T11:00:00Z', fetch: (async () => new Response('not found', { status: 404 })) as unknown as typeof fetch });
    expect(await down.sharedBike({ ...q, use: 'whole' })).toEqual([]);
  });
});
