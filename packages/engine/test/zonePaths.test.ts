import { describe, expect, it } from 'vitest';
import { loadNetworks, networkPlans } from '../src/fares/networks.js';
import { loadNova } from '../src/fares/nova.js';
import { zoneGraph, zonePaths, zoneSearches, type ZoneGraph } from '../src/fares/zonePaths.js';
import type { Leg, StopPoint } from '../src/types.js';

// The real fare data snapshot and the real price grids.
const nova = loadNova();
const networks = loadNetworks();
const graphOf = (alliance: string) => zoneGraph(nova, alliance, networkPlans(nova, networks, alliance)!.pass, networks.get(alliance));

const LUCENS = '8504121';
const LUCENS_BUS = '8583110';
const LAUSANNE = '8501120';
const LAUSANNE_BUS = '8592050';
const BULLE = '8504086';
const FRIBOURG = '8504100';
/** Lucens – Lausanne by bus 361 and m2 (7 zones) and by train (9 zones), as the SBB shop sells them. */
const BUS = [11, 12, 18, 60, 61, 65, 103];
const TRAIN = [11, 12, 19, 60, 61, 62, 63, 64, 103];

const stop = (stopId: string): StopPoint => ({ name: nova.stopName(stopId) ?? stopId, stopId, lat: 46.6, lon: 6.7 });
const ride = (from: string, to: string, mid: string[] = []): Leg => ({
  mode: 'rail',
  from: stop(from),
  to: stop(to),
  departure: '2027-01-19T06:40:00+01:00',
  arrival: '2027-01-19T07:34:00+01:00',
  durationMin: 54,
  distanceM: 30000,
  line: { name: 'R8' },
  intermediateStops: mid.map(stop),
});

/** A hand-made graph: steps between zones, each with the zones crossed on the way. */
function graph(steps: [number, number, number[]?][], opts: { weights?: Record<number, number>; together?: number[][] } = {}): ZoneGraph {
  const map = new Map<number, { to: number; via: number[] }[]>();
  const zones = new Set<number>();
  for (const [a, b, via = []] of steps) {
    for (const [x, y] of [[a, b], [b, a]] as const) map.set(x, [...(map.get(x) ?? []), { to: y, via }]);
    for (const z of [a, b, ...via]) zones.add(z);
  }
  const weight = (z: number) => opts.weights?.[z] ?? 1;
  const complete = (set: Iterable<number>) => {
    const s = new Set(set);
    for (const g of opts.together ?? []) if (g.some((z) => s.has(z))) for (const z of g) s.add(z);
    return [...s].sort((a, b) => a - b);
  };
  return {
    alliance: 'test',
    plan: 'test',
    zones: [...zones].sort((a, b) => a - b),
    neighbours: (z) => (map.get(z) ?? []).map((s) => s.to),
    zonesOfStop: () => [],
    count: (set) => complete(set).reduce((s, z) => s + weight(z), 0),
    complete,
    steps: map,
    weight,
  };
}

describe('zone paths on a small graph', () => {
  // 1 – 2 – 5 (short), 1 – 3 – 4 – 5 (one zone more), 1 – 6 – 7 – 8 – 5 (two more), 1 – 9 – 10 – 11 – 12 – 5 (three more).
  const g = graph([[1, 2], [2, 5], [1, 3], [3, 4], [4, 5], [1, 6], [6, 7], [7, 8], [8, 5], [1, 9], [9, 10], [10, 11], [11, 12], [12, 5]]);

  it('lists the cheapest set first, then those up to two zones dearer', () => {
    expect(zonePaths(g, [1], [5])).toEqual([
      { zones: [1, 2, 5], count: 3 },
      { zones: [1, 3, 4, 5], count: 4 },
      { zones: [1, 5, 6, 7, 8], count: 5 },
    ]);
    expect(zonePaths(g, [1], [5], { extra: 0 })).toEqual([{ zones: [1, 2, 5], count: 3 }]);
    expect(zonePaths(g, [1], [5], { extra: 3 })).toHaveLength(4);
  });
  it('starts and ends in any of the zones given, and stays put when they are the same', () => {
    expect(zonePaths(g, [2, 9], [5])[0]).toEqual({ zones: [2, 5], count: 2 });
    expect(zonePaths(g, [1], [1])).toEqual([{ zones: [1], count: 1 }]);
    expect(zonePaths(g, [1], [99])).toEqual([]);
    expect(zonePaths(g, [], [5])).toEqual([]);
  });
  it('counts a zone by its factor', () => {
    const heavy = graph([[1, 2], [2, 5], [1, 3], [3, 4], [4, 5]], { weights: { 2: 3 } });
    expect(zonePaths(heavy, [1], [5]).map((p) => p.zones)).toEqual([[1, 3, 4, 5], [1, 2, 5]]);
    expect(zonePaths(heavy, [1], [5])[1]!.count).toBe(5);
  });
  it('adds the zones sold together', () => {
    const lausanne = graph([[1, 2], [2, 5], [1, 3], [3, 4], [4, 5]], { together: [[2, 6]] });
    expect(zonePaths(lausanne, [1], [5])).toEqual([
      { zones: [1, 2, 5, 6], count: 4 },
      { zones: [1, 3, 4, 5], count: 4 },
    ]);
  });
  it('a hop that crosses zones without stopping costs all of them', () => {
    // A fast train from 1 to 5 through 20, 21 and 22; the bus needs 1, 2, 5.
    const fast = graph([[1, 2], [2, 5], [1, 5, [20, 21, 22]]]);
    expect(zonePaths(fast, [1], [5])).toEqual([
      { zones: [1, 2, 5], count: 3 },
      { zones: [1, 5, 20, 21, 22], count: 5 },
    ]);
  });
});

describe('zone graph of the fare data', () => {
  const mobilis = graphOf('mobilis');

  it('places stops in their zones', () => {
    expect(mobilis.zonesOfStop(LUCENS)).toEqual([103]);
    expect(mobilis.zonesOfStop(LUCENS_BUS)).toEqual([103]);
    expect(mobilis.zonesOfStop(LAUSANNE)).toEqual([11]);
    expect(mobilis.zonesOfStop('ch_Parentch:1:sloid:999999')).toEqual([]);
  });
  it('joins neighbouring zones both ways, and not zones a fast train merely links', () => {
    expect(mobilis.neighbours(103)).toContain(60);
    expect(mobilis.neighbours(60)).toContain(103);
    expect(mobilis.neighbours(11)).toContain(12);
    // Lucens (103) and Lausanne (11) are no neighbours, whatever train runs between them.
    expect(mobilis.neighbours(103)).not.toContain(11);
    expect(mobilis.count([11])).toBe(2); // 11 and 12 are sold together
    expect(mobilis.count(BUS)).toBe(7);
    expect(mobilis.count(TRAIN)).toBe(9);
  });
  it('Lucens → Lausanne: the bus set of 7 zones first, the train set of 9 among the alternatives', () => {
    const paths = zonePaths(mobilis, mobilis.zonesOfStop(LUCENS), mobilis.zonesOfStop(LAUSANNE));
    expect(paths[0]).toEqual({ zones: BUS, count: 7 });
    expect(paths.filter((p) => p.count === 7)).toHaveLength(1);
    expect(paths).toContainEqual({ zones: TRAIN, count: 9 });
    expect(paths.every((p) => p.count <= 9)).toBe(true);
    for (let i = 1; i < paths.length; i++) expect(paths[i]!.count).toBeGreaterThanOrEqual(paths[i - 1]!.count);
    // Every set holds both ends and Lausanne's second zone.
    expect(paths.every((p) => [11, 12, 103].every((z) => p.zones.includes(z)))).toBe(true);
  });
  it('is quick enough to be asked on every search', () => {
    const t = performance.now();
    for (let i = 0; i < 20; i++) zonePaths(mobilis, [103], [11]);
    expect((performance.now() - t) / 20).toBeLessThan(50);
  });
});

describe('zone sets to search', () => {
  const deps = { nova, networks };
  const train = [ride(LUCENS, LAUSANNE)];

  it('the train from Lucens was found: the bus zones are searched, as a cheaper pass', () => {
    const sets = zoneSearches([train], deps);
    expect(sets.length).toBeGreaterThan(0);
    expect(sets.length).toBeLessThanOrEqual(4);
    expect(sets[0]).toMatchObject({ alliance: 'mobilis', zones: BUS, count: 7, why: 'path', cheaper: true });
    expect(sets[0]!.tags).toEqual(BUS.map((z) => `mobilis:${z}`));
    // Never the zones of the train: that search would return what is already known.
    expect(sets.some((s) => TRAIN.every((z) => s.zones.includes(z)))).toBe(false);
    // No set that only adds zones to one already chosen.
    for (const a of sets) for (const b of sets) if (a !== b) expect(a.zones.every((z) => b.zones.includes(z))).toBe(false);
    for (let i = 1; i < sets.length; i++) expect(sets[i]!.count).toBeGreaterThanOrEqual(sets[i - 1]!.count);
    expect(sets.every((s) => s.count <= 9)).toBe(true);
  });
  it('respects the bounds', () => {
    expect(zoneSearches([train], deps, { max: 1 })).toHaveLength(1);
    expect(zoneSearches([train], deps, { max: 0 })).toEqual([]);
    expect(zoneSearches([train], deps, { extra: 0 }).map((s) => s.zones)).toEqual([BUS]);
    expect(zoneSearches([], deps)).toEqual([]);
  });
  it('searches the zones of a ticket already found when a dearer one may hide its departures', () => {
    // The bus (7 zones) and the train (9) were both found: the bus zones are searched for the
    // departures the train hides, then paths of 8 zones; never one as dear as the train.
    const bus = [ride(LUCENS_BUS, '8579239'), ride('8579239', LAUSANNE_BUS)];
    const sets = zoneSearches([train, bus], deps);
    expect(sets[0]).toMatchObject({ zones: BUS, count: 7, cheaper: false });
    expect(sets.slice(1).every((s) => s.count === 8 && !s.cheaper)).toBe(true);
  });
  it('searches nothing that cannot be cheaper than what was found', () => {
    // Only the bus was found: any other zone path is dearer, and what it holds is slower.
    const bus = [ride(LUCENS_BUS, '8579239'), ride('8579239', LAUSANNE_BUS)];
    expect(zoneSearches([bus], deps)).toEqual([]);
  });
  it('nothing to search when no network holds both ends, or without stop ids', () => {
    expect(zoneSearches([[ride(LUCENS, '8507000')]], deps)).toEqual([]);
    const anonymous = { ...ride(LUCENS, LAUSANNE), from: { name: 'Lucens', lat: 46.7, lon: 6.8 } };
    expect(zoneSearches([[anonymous]], deps)).toEqual([]);
  });
  it('where the path costs the all-zones price, the whole network is one search', () => {
    // Bulle → Fribourg: 7 zones and more are Frimobil's all-zones pass.
    const inside = [ride(BULLE, FRIBOURG)];
    // Everything found lies inside the network: the search would add nothing.
    expect(zoneSearches([inside], deps).filter((s) => s.alliance === 'frimobil')).toEqual([]);
    // A connection the network does not hold (a stop it does not know): the network is searched.
    const outside = [ride(BULLE, FRIBOURG, ['8507000'])];
    const sets = zoneSearches([inside, outside], deps).filter((s) => s.alliance === 'frimobil');
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ why: 'network', cheaper: false });
    expect(sets[0]!.zones).toEqual(graphOf('frimobil').zones);
  });
});
