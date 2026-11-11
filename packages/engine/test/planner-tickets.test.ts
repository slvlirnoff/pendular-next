import { describe, expect, it } from 'vitest';
import { compare, type EngineDeps, type ZoneSearchSet } from '../src/planner/compare.js';
import { coversStrictly, prune, type Conn } from '../src/planner/prune.js';
import { PENDULAR_RULES } from '../src/rules.js';
import type { CommuteOption, CommuteRequest, Itinerary, Leg, LeftOut, OptionKind, PricedProduct, RoutingProvider, StopPoint } from '../src/types.js';

// ---- searches inside zone sets -------------------------------------------------------------------

const stop = (name: string, stopId: string, lat: number, lon: number): StopPoint => ({ name, stopId, lat, lon });
const HOME = stop('Village', '100', 46.7, 6.8);
const CITY = stop('City', '300', 46.52, 6.63);

function leg(mode: Leg['mode'], dep: string, arr: string, line: string): Leg {
  const d = `2027-01-19T${dep}:00+01:00`;
  const a = `2027-01-19T${arr}:00+01:00`;
  return { mode, from: HOME, to: CITY, departure: d, arrival: a, durationMin: (Date.parse(a) - Date.parse(d)) / 60000, distanceM: 20000, line: { name: line }, tripId: `${line}-${dep}` };
}
const trip = (l: Leg): Itinerary => ({ departure: l.departure, arrival: l.arrival, durationMin: l.durationMin, changes: 0, legs: [l] });

const TRAINS = [trip(leg('rail', '07:00', '07:40', 'R1')), trip(leg('rail', '08:00', '08:40', 'R1'))];
const BUSES = [trip(leg('bus', '06:50', '07:45', '361')), trip(leg('bus', '07:50', '08:45', '361'))];
const BUS_TAGS = ['net:1', 'net:2'];

type Call = Parameters<RoutingProvider['transit']>[0];
function routing(opts: { segmentFilter?: boolean; restricted?: (tags: string[]) => Itinerary[] } = {}): RoutingProvider & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    segmentFilter: opts.segmentFilter,
    async transit(q) {
      calls.push(q);
      if (q.allowedSegmentTags) return (opts.restricted ?? (() => [...BUSES, TRAINS[0]!]))(q.allowedSegmentTags);
      // Without restriction the engine returns the trains only: they beat the bus on every count.
      return TRAINS;
    },
    async street(q) {
      return q.profile === 'car' ? { durationMin: 30, distanceM: 30000 } : { durationMin: 400, distanceM: 30000 };
    },
    async streetMatrix(q) {
      return q.points.map(() => null);
    },
    async lastTrip() {
      return null;
    },
    async versions() {
      return {};
    },
  };
}

/** The train needs a pass of three zones, the bus one of two. */
const product = (legs: Leg[]): PricedProduct[] => {
  const bus = legs.every((l) => l.mode === 'bus');
  const zones = bus ? [1, 2] : [1, 3, 4];
  const yearly = bus ? 1000 : 1500;
  return [{ kind: 'zonePassYearly', yearly, provenance: 'tariff', alliance: 'net', zones, components: [{ key: 'network.year', params: { network: 'Net', zones: zones.length }, yearly, provenance: 'tariff' }] }];
};

function deps(r: RoutingProvider, sets: ZoneSearchSet[] = [{ alliance: 'net', zones: [1, 2], tags: BUS_TAGS, cheaper: true }]): EngineDeps & { asked: Leg[][][] } {
  const asked: Leg[][][] = [];
  return {
    asked,
    routing: r,
    rules: PENDULAR_RULES,
    priceTransit: product,
    zoneSearches: (trips, o) => {
      asked.push(trips);
      return sets.slice(0, o.max);
    },
    co2KgPerYear: () => 0,
    parkRail: [],
    bikeParking: [],
    cityParkRide: [],
  };
}

const REQUEST: CommuteRequest = {
  home: { label: 'Village', lat: HOME.lat, lon: HOME.lon },
  work: { label: 'City', lat: CITY.lat, lon: CITY.lon },
  arrival: { from: '07:00', to: '09:00' },
  pattern: { weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'], weeksOff: 5 },
  traveller: { ageGroup: 'adult', travelClass: 2, halfFare: false, vaudResident: true },
  car: { costPerKm: 0.74, parkingAtWorkPerMonth: 260 },
  kinds: ['transit', 'car'],
};
const transitOf = (r: { options: CommuteOption[] }) => r.options.filter((o) => o.kind === 'transit');

describe('searches inside zone sets', () => {
  it('asks once per zone set, with its tags, and merges the answers', async () => {
    const r = routing({ segmentFilter: true });
    const d = deps(r);
    const res = await compare(REQUEST, d);
    const tagged = r.calls.filter((c) => c.allowedSegmentTags);
    expect(tagged).toHaveLength(1);
    expect(tagged[0]).toMatchObject({ allowedSegmentTags: BUS_TAGS, by: 'arrive', window: REQUEST.arrival, date: PENDULAR_RULES.referenceDate });
    // Nothing slower than one and a half times the fastest plus a quarter of an hour: 40 min → 75.
    expect(tagged[0]!.maxTravelMin).toBe(75);
    expect(tagged[0]!.alternateTies).toBeFalsy();
    // The zone sets were derived from the legs of the unrestricted answer.
    expect(d.asked).toHaveLength(1);
    expect(d.asked[0]!.map((legs) => legs[0]!.line!.name)).toEqual(['R1', 'R1']);

    const pt = transitOf(res);
    expect(pt.map((o) => [o.title, o.cost.yearly, o.departuresInWindow])).toEqual([
      ['Village → City, 361', 1000, 2],
      // The train the restricted search returned again is the same departure, not a third one.
      ['Village → City, R1', 1500, 2],
    ]);
    expect(new Set(pt.map((o) => o.ticketGroup)).size).toBe(2);
    expect(pt[0]!.ticketGroup).toBe(`transit||${pt[0]!.fareKey}`);
    expect(res.verdict.cheapest).toBe(pt[0]!.id);
  });

  it('changes nothing with a routing engine that cannot restrict a search', async () => {
    const r = routing();
    const d = deps(r);
    const res = await compare(REQUEST, d);
    expect(r.calls.some((c) => c.allowedSegmentTags)).toBe(false);
    expect(d.asked).toEqual([]);
    expect(transitOf(res).map((o) => o.title)).toEqual(['Village → City, R1']);
    // And the same without the fare data to derive zone sets from.
    const plain = routing({ segmentFilter: true });
    const { zoneSearches: _none, ...without } = deps(plain);
    expect(transitOf(await compare(REQUEST, without)).map((o) => o.title)).toEqual(['Village → City, R1']);
    expect(plain.calls.some((c) => c.allowedSegmentTags)).toBe(false);
  });

  it('makes at most rules.zoneSearches calls, all of them after the unrestricted answer', async () => {
    const sets = [1, 2, 3, 4, 5, 6].map((n) => ({ alliance: 'net', zones: [n], tags: [`net:${n}`] }));
    const r = routing({ segmentFilter: true, restricted: () => [] });
    await compare(REQUEST, deps(r, sets));
    expect(r.calls.filter((c) => c.allowedSegmentTags).map((c) => c.allowedSegmentTags![0])).toEqual(['net:1', 'net:2', 'net:3', 'net:4']);
    const off = routing({ segmentFilter: true });
    await compare({ ...REQUEST, rules: { zoneSearches: 0 } }, deps(off, sets));
    expect(off.calls.some((c) => c.allowedSegmentTags)).toBe(false);
  });

  it('drops a connection that takes far longer than the fastest', async () => {
    // 40 minutes by train; a bus of 80 minutes through every village is not an alternative.
    const slow = trip(leg('bus', '06:30', '07:50', '999'));
    const r = routing({ segmentFilter: true, restricted: () => [slow, ...BUSES] });
    const res = await compare(REQUEST, deps(r));
    expect(transitOf(res).map((o) => o.title)).toEqual(['Village → City, 361', 'Village → City, R1']);
    expect(res.leftOut.some((l) => l.title.includes('999'))).toBe(false);
  });

  it('survives a failing restricted search', async () => {
    const r = routing({
      segmentFilter: true,
      restricted: () => {
        throw new Error('timetable server down');
      },
    });
    expect(transitOf(await compare(REQUEST, deps(r))).map((o) => o.title)).toEqual(['Village → City, R1']);
  });
});

// ---- pruning inside a ticket and between tickets ---------------------------------------------------

describe('prune by ticket', () => {
  const m = 60000;
  const c = (dep: number, arr: number, changes = 0): Conn => ({ dep: dep * m, arr: arr * m, min: arr - dep, changes });
  let n = 0;
  function opt(kind: OptionKind, ticket: string, yearly: number, conns: Conn[], changes = 0): CommuteOption {
    return {
      id: `${kind}-${n++}`,
      kind,
      title: `${ticket} ${conns.map((x) => x.dep / m).join('/')}`,
      durationMin: Math.min(...conns.map((x) => x.min)),
      changes,
      cost: { yearly, products: [], extras: [], provenance: 'tariff' },
      co2KgPerYear: 0,
      ticketGroup: `${kind}||${ticket}`,
      _conns: conns,
    } as unknown as CommuteOption;
  }
  const run = (options: CommuteOption[], rules = PENDULAR_RULES) => {
    const leftOut: LeftOut[] = [];
    return { kept: prune(options, leftOut, rules), leftOut };
  };

  it('strict cover: no earlier, no later, no more changes', () => {
    expect(coversStrictly(c(10, 50), c(0, 60))).toBe(true);
    expect(coversStrictly(c(0, 60), c(0, 60))).toBe(true);
    expect(coversStrictly(c(0, 59), c(1, 60))).toBe(true); // within the two minutes of tolerance
    expect(coversStrictly(c(0, 50), c(10, 60))).toBe(false); // leaves earlier
    expect(coversStrictly(c(10, 70), c(0, 60))).toBe(false); // arrives later
    expect(coversStrictly(c(10, 50, 1), c(0, 60))).toBe(false); // one more change
  });

  it('inside a ticket a slower route with one more change stays when it adds a departure', () => {
    // The Le Locle case: a bus at 06:57 and 07:27, a train with a change at 07:15, another with two at 06:45.
    const bus = opt('transit', 'all', 1620, [c(57, 116), c(87, 146)]);
    const train = opt('transit', 'all', 1620, [c(75, 133, 1)], 1);
    const early = opt('transit', 'all', 1620, [c(45, 102, 2)], 2);
    const { kept, leftOut } = run([early, train, bus]);
    expect(kept).toHaveLength(3);
    expect(kept).toEqual(expect.arrayContaining([bus, train, early]));
    expect(leftOut).toEqual([]);
  });

  it('between tickets the same routes hide each other as before', () => {
    // One change more and no real gain in time: on a dearer ticket the train offers nothing.
    const bus = opt('transit', 'cheap', 1000, [c(57, 116), c(87, 146)]);
    const train = opt('transit', 'dear', 1100, [c(60, 118, 1)], 1);
    const { kept, leftOut } = run([train, bus]);
    expect(kept).toEqual([bus]);
    expect(leftOut[0]).toMatchObject({ code: 'dominated', title: train.title, against: bus.title });
    // On the same ticket it is a departure like any other.
    const same = opt('transit', 'cheap', 1000, [c(60, 118, 1)], 1);
    expect(run([same, bus]).kept).toHaveLength(2);
  });

  it('inside a ticket a route goes only when every departure of it is served by another', () => {
    const fast = opt('transit', 't', 1000, [c(0, 30), c(60, 90)]);
    const inside = opt('transit', 't', 1000, [c(0, 32), c(58, 90)]); // leaves no later, arrives no earlier
    const partly = opt('transit', 't', 1000, [c(0, 32), c(100, 140)]);
    const { kept, leftOut } = run([inside, partly, fast]);
    expect(kept).toEqual([fast, partly]);
    expect(leftOut).toHaveLength(1);
    expect(leftOut[0]).toMatchObject({ code: 'nearDuplicate', title: inside.title, against: fast.title });
  });

  it('a dearer ticket stays whole once one of its routes offers something', () => {
    const cheap = opt('transit', 'cheap', 1000, [c(0, 60), c(60, 120)]);
    const fast = opt('transit', 'dear', 1500, [c(20, 50)]);
    // Covered by the cheap ticket, but a departure for whoever holds the dear one.
    const also = opt('transit', 'dear', 1500, [c(60, 121)]);
    const { kept, leftOut } = run([also, fast, cheap]);
    expect(kept).toEqual(expect.arrayContaining([cheap, fast, also]));
    expect(leftOut).toEqual([]);
    // Without the fast route the dear ticket offers nothing: all of it goes.
    const alone = run([also, cheap]);
    expect(alone.kept).toEqual([cheap]);
    expect(alone.leftOut[0]).toMatchObject({ code: 'dominated', against: cheap.title });
  });

  it('caps tickets per kind, not routes', () => {
    // Four tickets with separate departures; the first has three routes.
    const a = [opt('transit', 'a', 100, [c(0, 60)]), opt('transit', 'a', 100, [c(10, 75)]), opt('transit', 'a', 100, [c(20, 90)])];
    const b = opt('transit', 'b', 110, [c(100, 150)]);
    const d = opt('transit', 'c', 120, [c(200, 240)]);
    const e = opt('transit', 'd', 130, [c(300, 330)]);
    const { kept, leftOut } = run([...a, b, d, e]);
    expect(PENDULAR_RULES.maxOptionsPerKind).toBe(3);
    // The ticket with the fastest route first, then the cheapest tickets: five routes of three tickets.
    expect(kept).toEqual([e, ...a, b]);
    expect(new Set(kept.map((o) => o.ticketGroup)).size).toBe(3);
    expect(leftOut).toHaveLength(1);
    expect(leftOut[0]).toMatchObject({ code: 'overCap', title: d.title, against: e.title });
  });

  it('caps the routes of a ticket, keeping those that add most departures', () => {
    const routes = [1, 2, 3, 4, 5, 6, 7].map((i) => opt('transit', 't', 100, [c(i * 100, i * 100 + 30 + i)]));
    // The last route has three departures of its own.
    const rich = opt('transit', 't', 100, [c(1000, 1050), c(1100, 1150), c(1200, 1250)]);
    const { kept, leftOut } = run([...routes, rich]);
    expect(PENDULAR_RULES.maxRoutesPerTicket).toBe(6);
    expect(kept).toHaveLength(6);
    expect(kept).toContain(rich);
    expect(leftOut.map((l) => l.code)).toEqual(['overCap', 'overCap']);
    expect(run([...routes, rich], { ...PENDULAR_RULES, maxRoutesPerTicket: 8 }).kept).toHaveLength(8);
  });

  it('names a car park once, and not at all when one of its routes is shown', () => {
    const site = { id: 'p1', name: 'Bigtown', kind: 'parkRail' as const, lat: 0, lon: 0 };
    const transit = opt('transit', 't', 1000, [c(0, 60), c(60, 120)]);
    const pr = (ticket: string, yearly: number, conns: Conn[]) => ({ ...opt('parkRail', ticket, yearly, conns), access: site, ticketGroup: `parkRail|p1|${ticket}` }) as CommuteOption;
    // Two tickets from the same site, both covered by public transport from home.
    const gone = run([transit, pr('x', 2000, [c(0, 60)]), pr('y', 2100, [c(60, 120)])]);
    expect(gone.kept).toEqual([transit]);
    expect(gone.leftOut).toHaveLength(1);
    expect(gone.leftOut[0]).toMatchObject({ kind: 'parkRail', title: 'Bigtown', code: 'dominated' });
    // One of them arrives when nothing else does: the site is shown, and not listed as left out.
    const shown = run([transit, pr('x', 2000, [c(150, 200)]), pr('y', 2100, [c(60, 120)])]);
    expect(shown.kept).toHaveLength(2);
    expect(shown.leftOut).toEqual([]);
  });
});
