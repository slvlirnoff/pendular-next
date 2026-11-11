import { describe, expect, it } from 'vitest';
import { compare, type AccessCandidate, type EngineDeps } from '../src/planner/compare.js';
import { groupItineraries } from '../src/planner/group.js';
import { covers, prune, type Conn } from '../src/planner/prune.js';
import { PENDULAR_RULES, tripsPerYear, workingDaysPerYear } from '../src/rules.js';
import type {
  CommuteOption,
  CommuteRequest,
  Itinerary,
  LeftOut,
  Leg,
  LegMode,
  OptionKind,
  PricedProduct,
  RoutingProvider,
  StopPoint,
  Weekday,
} from '../src/types.js';

// ---- fixtures ------------------------------------------------------------------------------

const stop = (name: string, stopId: string, lat: number, lon: number): StopPoint => ({ name, stopId, lat, lon });
const HOME = stop('Village', '100', 46.7, 6.8);
const STATION = stop('Bigtown', '200', 46.68, 6.75);
const MID = stop('Midway', '250', 46.6, 6.7);
const CITY = stop('City', '300', 46.52, 6.63);

function leg(mode: LegMode, from: StopPoint, to: StopPoint, dep: string, arr: string, line?: string, tripId?: string, km = 20): Leg {
  const d = `2027-01-19T${dep}:00+01:00`;
  const a = `2027-01-19T${arr}:00+01:00`;
  return { mode, from, to, departure: d, arrival: a, durationMin: (Date.parse(a) - Date.parse(d)) / 60000, distanceM: km * 1000, line: line ? { name: line } : undefined, tripId };
}
const rail = (from: StopPoint, to: StopPoint, dep: string, arr: string, line: string, tripId?: string) => leg('rail', from, to, dep, arr, line, tripId);
function trip(...legs: Leg[]): Itinerary {
  const first = legs[0]!;
  const last = legs[legs.length - 1]!;
  return { departure: first.departure, arrival: last.arrival, durationMin: (Date.parse(last.arrival) - Date.parse(first.departure)) / 60000, changes: legs.filter((l) => l.mode === 'rail').length - 1, legs };
}

/** From home (matched by latitude) `home` comes back; from any other point `site`. */
function routing(home: Itinerary[], site: Itinerary[], driveMin = 10): RoutingProvider {
  return {
    async transit(q) {
      return Math.abs(q.from.lat - HOME.lat) < 1e-6 ? home : site;
    },
    async street(q) {
      return q.profile === 'car' ? { durationMin: 30, distanceM: 30000 } : { durationMin: 400, distanceM: 30000 };
    },
    async streetMatrix(q) {
      return q.points.map(() => ({ durationMin: driveMin, distanceM: 6000 }));
    },
    async versions() {
      return { timetable: 'test' };
    },
  };
}

const product = (yearly: number): PricedProduct => ({ kind: 'singles', yearly, provenance: 'tariff', components: [{ key: 'test.ticket', yearly, provenance: 'tariff' }] });
const site = (id: string, kind: AccessCandidate['kind'], prices: AccessCandidate['prices'], at: { lat: number; lon: number } = STATION): AccessCandidate => ({ id, name: id, kind, lat: at.lat, lon: at.lon, prices });
const PAID = { day: null, month: null, year: 500 };

function deps(r: RoutingProvider, over: Partial<EngineDeps> = {}): EngineDeps {
  return {
    routing: r,
    rules: PENDULAR_RULES,
    priceTransit: () => [product(1000)],
    co2KgPerYear: () => 0,
    parkRail: [site('pr', 'parkRail', PAID)],
    bikeParking: [],
    cityParkRide: [],
    now: () => new Date('2026-11-10T12:00:00Z'),
    ...over,
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

// ---- working days --------------------------------------------------------------------------

describe('working days and public holidays', () => {
  const wd = (weekdays: Weekday[], weeksOff = 5) => ({ weekdays, weeksOff });
  // Holidays in PENDULAR_RULES on weekdays: Fri 1 Jan, Fri 26 Mar, Mon 29 Mar, Thu 6 May,
  // Mon 17 May, Mon 20 Sep (Mon: 3, Thu: 1, Fri: 2); on weekends: Sat 2 Jan, Sun 1 Aug, Sat 25 Dec.
  it('Mon–Fri with 5 weeks off: 5 × 47 − round(6 × 47 / 52) = 235 − 5 = 230, 460 trips', () => {
    const p = wd(['mon', 'tue', 'wed', 'thu', 'fri']);
    expect(workingDaysPerYear(p, PENDULAR_RULES)).toBe(230);
    expect(tripsPerYear(p, PENDULAR_RULES)).toBe(460);
  });
  it('Tue + Thu only: 2 × 47 − round(1 × 47 / 52) = 94 − 1 = 93', () => {
    expect(workingDaysPerYear(wd(['tue', 'thu']), PENDULAR_RULES)).toBe(93);
  });
  it('Sat + Sun only: 2 × 47 − round(3 × 47 / 52) = 94 − 3 = 91', () => {
    expect(workingDaysPerYear(wd(['sat', 'sun']), PENDULAR_RULES)).toBe(91);
  });
  it('no holidays in the rule set: 5 × 47 = 235', () => {
    expect(workingDaysPerYear(wd(['mon', 'tue', 'wed', 'thu', 'fri']), { ...PENDULAR_RULES, publicHolidays: [] })).toBe(235);
  });
  it('is never negative', () => {
    expect(workingDaysPerYear(wd(['mon'], 60), PENDULAR_RULES)).toBe(0);
  });
});

// ---- car -----------------------------------------------------------------------------------

describe('car duration', () => {
  const carOnly = { ...REQUEST, kinds: ['car'] as OptionKind[] };
  const r0 = routing([], []);
  it('is round(route × 1.3 + parking), parking 5 min without a density source', async () => {
    const r = await compare(carOnly, deps(r0));
    // 30 min × 1.3 = 39, + 5 min = 44.
    expect(r.options.find((o) => o.kind === 'car')!.durationMin).toBe(44);
    expect(r.stamp.car).toMatchObject({ peakFactor: 1.3, parkingMin: 5, parkingAuto: true });
    expect(r.stamp.car!.parkingKind).toBeUndefined();
  });
  it('takes parking minutes set by hand and says so', async () => {
    const r = await compare({ ...carOnly, rules: { carParkingMin: 2 } }, deps(r0));
    // 39 + 2 = 41.
    expect(r.options.find((o) => o.kind === 'car')!.durationMin).toBe(41);
    expect(r.stamp.car).toMatchObject({ parkingMin: 2, parkingAuto: false });
  });
  it('asks the density source for the parking minutes at work', async () => {
    let asked: { lat: number; lon: number } | undefined;
    const r = await compare(
      carOnly,
      deps(r0, {
        parkingAt: (p) => {
          asked = p;
          return { minutes: 15, kind: 'townCentre', residents: 1200, jobs: 800 };
        },
      }),
    );
    expect(asked).toMatchObject({ lat: CITY.lat, lon: CITY.lon });
    // 39 + 15 = 54.
    expect(r.options.find((o) => o.kind === 'car')!.durationMin).toBe(54);
    expect(r.stamp.car).toMatchObject({ parkingMin: 15, parkingAuto: true, parkingKind: 'townCentre', residents1km: 1200, jobs1km: 800 });
  });
  it('a hand-set value wins over the density source', async () => {
    const r = await compare({ ...carOnly, rules: { carParkingMin: 3 } }, deps(r0, { parkingAt: () => ({ minutes: 15, kind: 'cityCentre', residents: 1, jobs: null }) }));
    expect(r.options.find((o) => o.kind === 'car')!.durationMin).toBe(42);
    expect(r.stamp.car!.parkingAuto).toBe(false);
  });
});

// ---- park and ride -------------------------------------------------------------------------

describe('park and ride access', () => {
  // Peak factor 1 keeps the minutes whole: drive 10 min.
  const PR = { ...REQUEST, kinds: ['transit', 'parkRail'] as OptionKind[], rules: { carPeakFactor: 1 } };
  const homeTrain = (id = 'H') => [trip(rail(HOME, CITY, '07:00', '07:50', 'R1', id))];

  it('does not count the walk to the platform twice (3 min walk, transfer 5: 2 extra minutes)', async () => {
    const site3 = [trip(leg('walk', STATION, STATION, '07:07', '07:10', undefined, undefined, 0.2), rail(STATION, CITY, '07:10', '07:25', 'IR 1', 'S'))];
    const r = await compare(PR, deps(routing(homeTrain(), site3)));
    // 10 min drive + max(0, 5 − 3) = 2 min + itinerary 07:07–07:25 (18 min) = 30.
    expect(r.options.find((o) => o.kind === 'parkRail')!.durationMin).toBe(30);
  });
  it('adds nothing when the walk is longer than the transfer time (7 min walk)', async () => {
    const site7 = [trip(leg('walk', STATION, STATION, '07:03', '07:10', undefined, undefined, 0.5), rail(STATION, CITY, '07:10', '07:25', 'IR 1', 'S'))];
    const r = await compare(PR, deps(routing(homeTrain(), site7)));
    // 10 min drive + 0 + itinerary 07:03–07:25 (22 min) = 32.
    expect(r.options.find((o) => o.kind === 'parkRail')!.durationMin).toBe(32);
  });
  it('charges the whole transfer time when the itinerary starts on the platform', async () => {
    const site0 = [trip(rail(STATION, CITY, '07:10', '07:25', 'IR 1', 'S'))];
    const r = await compare(PR, deps(routing(homeTrain(), site0)));
    // 10 + 5 + 15.
    expect(r.options.find((o) => o.kind === 'parkRail')!.durationMin).toBe(30);
  });

  describe('same vehicle as public transport from home', () => {
    // The drive and transfer take 15 min: boarding at 07:17 means leaving home at 07:02.
    const siteAt = (dep: string) => [trip(rail(STATION, CITY, dep, '07:50', 'R1', 'T1'))];
    it('leaves a connection out that boards the same train and leaves home only 2 min later', async () => {
      const r = await compare(PR, deps(routing(homeTrain('T1'), siteAt('07:17'))));
      expect(r.options.some((o) => o.kind === 'parkRail')).toBe(false);
      expect(r.leftOut).toContainEqual(expect.objectContaining({ kind: 'parkRail', code: 'noBetterThanTransit' }));
    });
    /** From home the train is reached through a feeder bus, not on foot. */
    const feeder = (busDep: string, trainDep: string, arr: string, id: string) =>
      trip(leg('bus', HOME, STATION, busDep, trainDep, '10', `bus-${id}`, 5), rail(STATION, CITY, trainDep, arr, 'R1', id));
    it('never drives to a train that one can walk to from home, however much later one leaves', async () => {
      const r = await compare(PR, deps(routing(homeTrain('T1'), siteAt('07:25'))));
      expect(r.options.some((o) => o.kind === 'parkRail')).toBe(false);
    });
    it('keeps it when the train is reached by a feeder bus from home and one leaves 10 min later', async () => {
      const r = await compare(PR, deps(routing([feeder('07:00', '07:25', '07:50', 'T1')], siteAt('07:25'))));
      const pr = r.options.find((o) => o.kind === 'parkRail')!;
      expect(pr).toBeDefined();
      expect(pr.connections).toEqual([{ departure: '07:10', arrival: '07:50', durationMin: 40, changes: 0 }]);
    });
    it('does not apply to a different train', async () => {
      const r = await compare(PR, deps(routing(homeTrain('H'), [trip(rail(STATION, CITY, '07:17', '07:40', 'IR 1', 'S'))])));
      expect(r.options.some((o) => o.kind === 'parkRail')).toBe(true);
    });
    it('filters departure by departure: only the connection that is not clearly later goes', async () => {
      const both = [...siteAt('07:17'), trip(rail(STATION, CITY, '07:55', '08:20', 'IR 2', 'T2'))];
      const homeBoth = [feeder('07:00', '07:17', '07:50', 'T1'), feeder('07:30', '07:55', '08:20', 'T2')];
      const r = await compare(PR, deps(routing(homeBoth, both)));
      const pr = r.options.find((o) => o.kind === 'parkRail')!;
      // T1 from the site leaves home 07:02 (2 min after 07:00): dropped. T2 leaves home 07:40,
      // 10 min after the 07:30 train from home: kept.
      expect(pr.connections).toEqual([{ departure: '07:40', arrival: '08:20', durationMin: 40, changes: 0 }]);
    });
  });
});

describe('access sites that are not offered', () => {
  const PR = { ...REQUEST, kinds: ['transit', 'parkRail', 'cityParkRide'] as OptionKind[], rules: { carPeakFactor: 1 } };
  const home = [trip(rail(HOME, CITY, '07:00', '07:50', 'R1', 'H'))];
  const fast = [trip(rail(STATION, CITY, '07:10', '07:25', 'IR 1', 'S'))];
  const run = (sites: AccessCandidate[], cityPr: AccessCandidate[] = []) => compare(PR, deps(routing(home, fast), { parkRail: sites, cityParkRide: cityPr }));

  it('offers a priced car park (control)', async () => {
    expect((await run([site('pr', 'parkRail', PAID)])).options.some((o) => o.kind === 'parkRail')).toBe(true);
  });
  it('does not offer a car park with unknown prices', async () => {
    expect((await run([site('pr', 'parkRail', { day: null, month: null, year: null })])).options.some((o) => o.kind === 'parkRail')).toBe(false);
  });
  it('does not offer a car park priced CHF 0', async () => {
    expect((await run([site('pr', 'parkRail', { day: 0, month: 0, year: 0 })])).options.some((o) => o.kind === 'parkRail')).toBe(false);
  });
  it('does not offer a city park and ride with unknown or zero price', async () => {
    const cityAt = { lat: 46.53, lon: 6.64 };
    const unknown = await run([], [site('c1', 'cityParkRide', { day: null, month: null, year: null }, cityAt)]);
    const zero = await run([], [site('c2', 'cityParkRide', { day: 0, month: 0, year: 0 }, cityAt)]);
    expect(unknown.options.some((o) => o.kind === 'cityParkRide')).toBe(false);
    expect(zero.options.some((o) => o.kind === 'cityParkRide')).toBe(false);
  });
  it('does not offer a P+Rail site closer than 0.8 km to home', async () => {
    // 0.0045° of latitude ≈ 0.5 km.
    const near = site('near', 'parkRail', PAID, { lat: HOME.lat - 0.0045, lon: HOME.lon });
    expect((await run([near])).options.some((o) => o.kind === 'parkRail')).toBe(false);
  });
});

// ---- covers --------------------------------------------------------------------------------

describe('covers', () => {
  const m = 60000;
  /** Minutes since some midnight. */
  const c = (dep: number, arr: number, changes = 0): Conn => ({ dep: dep * m, arr: arr * m, min: arr - dep, changes });

  it('covers a connection arriving at the same time and not slower', () => {
    expect(covers(c(0, 30), 100, c(5, 33), 100)).toBe(true); // within 5 min of arrival, 30 ≤ 28 + 2
  });
  it('same-arrival tolerance: 2 min slower is fine, 3 is not', () => {
    expect(covers(c(0, 30), 100, c(2, 30), 100)).toBe(true); // 30 ≤ 28 + 2
    expect(covers(c(0, 30), 100, c(3, 30), 100)).toBe(false); // 30 > 27 + 2, and leaves 3 min before
  });
  it('same-arrival tolerance: 5 min apart counts, 6 does not', () => {
    expect(covers(c(0, 30), 100, c(5, 35), 100)).toBe(true);
    expect(covers(c(0, 30), 100, c(6, 36), 100)).toBe(false);
  });
  it('covers a connection that is inside another one (leaves no earlier, arrives no later)', () => {
    expect(covers(c(10, 30), 100, c(0, 60), 100)).toBe(true);
  });
  it('inside tolerance: 2 min on each side, not 3', () => {
    expect(covers(c(-2, 62), 100, c(0, 60), 100)).toBe(true);
    expect(covers(c(-3, 60), 100, c(0, 60), 100)).toBe(false);
    expect(covers(c(0, 63), 100, c(0, 60), 100)).toBe(false);
  });
  it('a connection at another time does not cover', () => {
    expect(covers(c(0, 30), 100, c(60, 90), 100)).toBe(false);
  });
  it('more changes never covers; as many does', () => {
    expect(covers(c(0, 30, 1), 100, c(0, 30, 0), 100)).toBe(false);
    expect(covers(c(0, 30, 1), 100, c(0, 30, 1), 100)).toBe(true);
    expect(covers(c(0, 30, 0), 100, c(0, 30, 1), 100)).toBe(true);
  });
  it('a dearer option never covers; an equal price does', () => {
    expect(covers(c(0, 30), 101, c(0, 30), 100)).toBe(false);
    expect(covers(c(0, 30), 100, c(0, 30), 100)).toBe(true);
    expect(covers(c(0, 30), 99, c(0, 30), 100)).toBe(true);
  });
});

// ---- prune ---------------------------------------------------------------------------------

describe('prune', () => {
  const m = 60000;
  const c = (dep: number, arr: number, changes = 0): Conn => ({ dep: dep * m, arr: arr * m, min: arr - dep, changes });
  let n = 0;
  function opt(kind: OptionKind, yearly: number, conns: Conn[] | undefined, over: Partial<CommuteOption> = {}): CommuteOption {
    const durationMin = conns ? Math.min(...conns.map((x) => x.min)) : 30;
    return {
      id: `${kind}-${n++}`,
      kind,
      title: `${kind} ${yearly}`,
      durationMin,
      changes: 0,
      cost: { yearly, products: [], extras: [], provenance: 'tariff' },
      co2KgPerYear: 0,
      ...(conns ? { _conns: conns } : {}),
      ...over,
    } as unknown as CommuteOption;
  }
  const run = (options: CommuteOption[]) => {
    const leftOut: LeftOut[] = [];
    return { kept: prune(options, leftOut, PENDULAR_RULES), leftOut };
  };

  it('leaves out a dearer option whose every connection is covered', () => {
    const transit = opt('transit', 1000, [c(0, 30), c(60, 90)]);
    const pr = opt('parkRail', 1500, [c(1, 30), c(61, 90)]);
    const { kept, leftOut } = run([pr, transit]);
    expect(kept).toEqual([transit]);
    expect(leftOut).toHaveLength(1);
    expect(leftOut[0]).toMatchObject({ kind: 'parkRail', code: 'dominated', against: transit.title });
  });
  it('keeps it when one connection arrives at a time nothing else serves', () => {
    const transit = opt('transit', 1000, [c(0, 30), c(60, 90)]);
    const pr = opt('parkRail', 1500, [c(1, 30), c(100, 130)]);
    const { kept, leftOut } = run([transit, pr]);
    expect(kept).toContain(pr);
    expect(leftOut).toEqual([]);
  });
  it('a cheaper access option is not covered by dearer transit', () => {
    const transit = opt('transit', 1500, [c(0, 30)]);
    const pr = opt('parkRail', 1000, [c(0, 30)]);
    expect(run([transit, pr]).kept).toContain(pr);
  });
  it('transit is not removed by an access option (transit competes with transit and walk only)', () => {
    const transit = opt('transit', 1500, [c(0, 30)]);
    const pr = opt('parkRail', 1000, [c(0, 30)]);
    expect(run([pr, transit]).kept).toContain(transit);
  });
  it('compares access options of the same kind with each other', () => {
    const a = opt('parkRail', 1000, [c(0, 30)]);
    const b = opt('parkRail', 1200, [c(0, 30)]);
    const { kept, leftOut } = run([b, a]);
    expect(kept).toEqual([a]);
    expect(leftOut[0]).toMatchObject({ kind: 'parkRail', code: 'dominated' });
  });
  it('transit is covered by walking, which has no timetable', () => {
    const walk = opt('walk', 0, undefined, { durationMin: 20 });
    const transit = opt('transit', 1000, [c(0, 30)]);
    const { kept, leftOut } = run([walk, transit]);
    expect(kept).toEqual([walk]);
    expect(leftOut[0]).toMatchObject({ kind: 'transit', code: 'dominated' });
  });
  it('never removes the car, walking or cycling', () => {
    const transit = opt('transit', 100, [c(0, 20)]);
    const car = opt('car', 9000, undefined, { durationMin: 40 });
    const bike = opt('bike', 5000, undefined, { durationMin: 50 });
    const ebike = opt('ebike', 6000, undefined, { durationMin: 45 });
    const { kept, leftOut } = run([car, bike, ebike, transit]);
    expect(kept).toEqual(expect.arrayContaining([car, bike, ebike, transit]));
    expect(leftOut).toEqual([]);
  });
  it('caps each kind at maxOptionsPerKind and keeps the fastest first', () => {
    // Four separate routes (no connection covers another), the fastest is the dearest.
    const opts = [
      opt('transit', 100, [c(0, 60)]),
      opt('transit', 110, [c(100, 150)]),
      opt('transit', 120, [c(200, 240)]),
      opt('transit', 130, [c(300, 330)]),
    ];
    const { kept, leftOut } = run(opts);
    expect(PENDULAR_RULES.maxOptionsPerKind).toBe(3);
    expect(kept).toHaveLength(3);
    expect(kept[0]).toBe(opts[3]); // the fastest
    expect(kept).toContain(opts[0]);
    expect(kept).toContain(opts[1]);
    expect(leftOut).toHaveLength(1);
    expect(leftOut[0]).toMatchObject({ code: 'overCap', title: opts[2]!.title, against: opts[3]!.title });
  });
});

// ---- grouping ------------------------------------------------------------------------------

describe('groupItineraries by ticket and route', () => {
  it('makes two groups of the same stops when the tickets differ', () => {
    const a = trip(rail(HOME, CITY, '07:00', '07:40', 'R1'));
    const b = trip(rail(HOME, CITY, '07:30', '08:10', 'R1'));
    const key = (it: Itinerary) => (it.departure.includes('T07:00') ? 'zone' : 'route');
    expect(groupItineraries([a, b])).toHaveLength(1);
    const g = groupItineraries([a, b], key);
    expect(g).toHaveLength(2);
    expect(g.every((x) => x.departures === 1)).toBe(true);
  });
  it('titles a group with the lines of the connections that change at the typical stops only', () => {
    const viaStation = (d1: string, a1: string, d2: string, a2: string, l1: string, l2: string) => trip(rail(HOME, STATION, d1, a1, l1), rail(STATION, CITY, d2, a2, l2));
    const its = [
      viaStation('07:00', '07:10', '07:15', '07:40', 'R1', 'IR 1'),
      viaStation('07:30', '07:40', '07:45', '08:10', 'R2', 'IR 2'),
      trip(rail(HOME, MID, '08:00', '08:15', 'R9'), rail(MID, CITY, '08:20', '08:50', 'IC 5')),
    ];
    const g = groupItineraries(its);
    expect(g).toHaveLength(1);
    expect(g[0]!.departures).toBe(3);
    expect(g[0]!.title).toBe('Village → City, R1/R2 · IR 1/IR 2');
    expect(g[0]!.title).not.toContain('R9');
    expect(g[0]!.title).not.toContain('IC 5');
  });
});

// ---- last trip home ------------------------------------------------------------------------

describe('last trip home follows the route of the morning trip', () => {
  const H = { ...HOME, stopId: '8500001' };
  const X = { ...STATION, stopId: '8500002' };
  const C = { ...CITY, stopId: '8500003' };
  // Bus from home to the station, then the train: the train is the main vehicle.
  const morning = [trip(leg('bus', H, X, '07:00', '07:10', '10', 'b1', 5), rail(X, C, '07:15', '07:50', 'R1', 'T1'))];
  const evening = (dep: string, arr: string) => trip(rail(C, X, dep, arr, 'R1', 'E'));

  it('asks for the last connection through the two ends of the main vehicle, in reverse', async () => {
    const asked: (string[] | undefined)[] = [];
    const r = await compare(
      { ...REQUEST, kinds: ['transit'] },
      deps({
        ...routing(morning, []),
        async lastTrip(q) {
          asked.push(q.via);
          return q.via?.length ? evening('19:10', '19:45') : evening('23:50', '00:25');
        },
      }),
    );
    expect(asked).toContainEqual(['8500003', '8500002']);
    expect(r.options.find((o) => o.kind === 'transit')!.returnTrips).toEqual({ last: '19:10', lastArrival: '19:45' });
  });

  it('falls back to the last connection by any route when none runs that way', async () => {
    const r = await compare(
      { ...REQUEST, kinds: ['transit'] },
      deps({
        ...routing(morning, []),
        async lastTrip(q) {
          return q.via?.length ? null : evening('22:00', '22:35');
        },
      }),
    );
    expect(r.options.find((o) => o.kind === 'transit')!.returnTrips).toEqual({ last: '22:00', lastArrival: '22:35' });
  });
});
