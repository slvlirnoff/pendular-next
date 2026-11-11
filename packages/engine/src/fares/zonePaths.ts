import type { Leg } from '../types.js';
import type { NovaData } from './nova.js';
import { networkPlans, tripResolver, type Network, type Networks } from './networks.js';
import { segmentTagsOfZones } from './segmentTags.js';
import { stationKey } from './zones.js';

/**
 * Zone paths: which sets of fare zones can join two places inside one fare network, cheapest
 * first. The planner asks the timetable for the connections inside each such set (the MOTIS fork
 * restricts a search to route sections whose zones lie in a list), because a search without
 * restriction only returns the fastest connections: a slower one that needs fewer zones, and so
 * a cheaper pass, is hidden by them. See data/nova/ZONE-PATHS.md.
 *
 * The fare data gives zones per hop (two stops a vehicle joins), never per stop. From it:
 *  - the zones of a stop: those every hop at the stop uses; when no zone is common to all of
 *    them (a stop on a border), those of its smallest hops;
 *  - the zone graph of a pass plan: a step from zone a to zone b exists when a hop joins a stop
 *    of a with a stop of b, or when one stop lies in both. A hop that crosses further zones
 *    without a stop there (a fast train) is a step that adds those zones too.
 * A zone path is a chain of steps from a zone of the origin to a zone of the destination; what
 * counts is its set of zones, with the zones the network always sells together.
 */

/** A step of the zone graph: to zone `to`, crossing `via` (zones other than the two ends). */
interface Step {
  to: number;
  via: number[];
}

export interface ZoneGraph {
  alliance: string;
  plan: string;
  /** Zone codes of the plan that some hop uses, ascending. */
  zones: number[];
  /** Zones next to a zone (reachable in one step), ascending. */
  neighbours(zone: number): number[];
  /** Zones of a stop (station number or engine stop id); empty when the plan has no hop there. */
  zonesOfStop(stop: string): number[];
  /** Price-relevant count of a set of zones, with the zones always sold together. */
  count(zones: Iterable<number>): number;
  /** The set with the zones always sold together, ascending. */
  complete(zones: Iterable<number>): number[];
  steps: ReadonlyMap<number, readonly Step[]>;
  weight(zone: number): number;
}

export interface ZonePath {
  /** Zones of the path with those sold together, ascending. */
  zones: number[];
  /** Price-relevant number of zones (before the network's minimum). */
  count: number;
}

export interface ZonePathOptions {
  /** Paths may count this many zones more than the cheapest one. Default 2. */
  extra?: number;
  /** Safety limit on the steps tried. Default 200 000. */
  maxSteps?: number;
}

const graphs = new WeakMap<NovaData, Map<string, ZoneGraph>>();

/** The zone graph of one plan of one network; built once per data set. */
export function zoneGraph(nova: NovaData, alliance: string, plan: string, net?: Network): ZoneGraph {
  let byPlan = graphs.get(nova);
  if (!byPlan) graphs.set(nova, (byPlan = new Map()));
  const key = `${alliance}|${plan}|${net?.rules.countBy ?? ''}|${JSON.stringify(net?.rules.together ?? [])}`;
  const hit = byPlan.get(key);
  if (hit) return hit;

  const factor = new Map((nova.plan(alliance, plan)?.zones ?? []).map((z) => [z.code, z.factor]));
  const byZones = net?.rules.countBy === 'zones';
  const weight = (z: number) => (byZones ? 1 : (factor.get(z) ?? 1));
  const together = net?.rules.together ?? [];

  // Hops per stop, to read the zones of each stop.
  const hops: { a: number; b: number; zones: number[] }[] = [];
  const atStop = new Map<number, number[][]>();
  for (const [edge, zones] of nova.raw.planEdges(alliance, plan)) {
    if (zones.length === 0) continue;
    const [a, b] = edge.split(' ')[0]!.split('-').map(Number) as [number, number];
    hops.push({ a, b, zones });
    for (const s of [a, b]) {
      const l = atStop.get(s);
      if (l) l.push(zones);
      else atStop.set(s, [zones]);
    }
  }
  const stopZones = new Map<number, number[]>();
  const zonesOf = (stop: number): number[] => {
    let z = stopZones.get(stop);
    if (z) return z;
    const sets = atStop.get(stop) ?? [];
    let common = sets[0] ?? [];
    for (const s of sets) common = common.filter((x) => s.includes(x));
    if (common.length === 0 && sets.length) {
      // On a border: the zones of the hops that use fewest zones (those that stay in one zone).
      const least = Math.min(...sets.map((s) => s.length));
      common = [...new Set(sets.filter((s) => s.length === least).flat())];
    }
    z = [...common].sort((x, y) => x - y);
    stopZones.set(stop, z);
    return z;
  };

  const steps = new Map<number, Step[]>();
  const used = new Set<number>();
  const add = (from: number, to: number, via: number[]) => {
    let list = steps.get(from);
    if (!list) steps.set(from, (list = []));
    // Between the same two zones only the steps that cross fewest zones matter.
    if (list.some((s) => s.to === to && s.via.every((v) => via.includes(v)))) return;
    for (let i = list.length - 1; i >= 0; i--) if (list[i]!.to === to && via.every((v) => list![i]!.via.includes(v))) list.splice(i, 1);
    list.push({ to, via });
  };
  for (const h of hops) {
    for (const z of h.zones) used.add(z);
    const za = zonesOf(h.a).filter((z) => h.zones.includes(z));
    const zb = zonesOf(h.b).filter((z) => h.zones.includes(z));
    for (const x of za) {
      for (const y of zb) {
        if (x === y) continue;
        const via = h.zones.filter((z) => z !== x && z !== y);
        add(x, y, via);
        add(y, x, via);
      }
    }
  }
  // One stop in two zones joins them.
  for (const stop of atStop.keys()) {
    const z = zonesOf(stop);
    for (const x of z) for (const y of z) if (x !== y) add(x, y, []);
  }

  const complete = (zones: Iterable<number>): number[] => {
    const set = new Set(zones);
    for (const group of together) if (group.some((z) => set.has(z))) for (const z of group) set.add(z);
    return [...set].sort((x, y) => x - y);
  };
  const graph: ZoneGraph = {
    alliance,
    plan,
    zones: [...used].sort((x, y) => x - y),
    neighbours: (zone) => [...new Set((steps.get(zone) ?? []).map((s) => s.to))].sort((x, y) => x - y),
    zonesOfStop: (stop) => zonesOf(Number(stationKey(String(stop).trim()))),
    count: (zones) => complete(zones).reduce((s, z) => s + weight(z), 0),
    complete,
    steps,
    weight,
  };
  byPlan.set(key, graph);
  return graph;
}

/**
 * The zone sets of the paths from any zone of `from` to any zone of `to`: the cheapest and those
 * counting at most `extra` zones more, cheapest first (then fewest zones, then by code).
 *
 * Simple paths only (no zone twice), searched depth first. A path is abandoned as soon as its
 * zones plus the fewest it still needs exceed the limit, which keeps the search small: the limit
 * is the count of one real path (the shortest when every crossed zone is counted as new) plus
 * `extra`.
 */
export function zonePaths(graph: ZoneGraph, from: number[], to: number[], opts: ZonePathOptions = {}): ZonePath[] {
  const extra = opts.extra ?? 2;
  const targets = new Set(to);
  const origins = [...new Set(from)].filter((z) => graph.steps.has(z) || targets.has(z));
  if (origins.length === 0 || targets.size === 0) return [];

  // Fewest zones still needed from each zone to a target, target included and the zone itself
  // not: `low` counts only the zone a step ends in (never too much), `high` every zone crossed.
  const reverse = new Map<number, { from: number; via: number[] }[]>();
  for (const [a, list] of graph.steps) {
    for (const s of list) {
      const l = reverse.get(s.to);
      if (l) l.push({ from: a, via: s.via });
      else reverse.set(s.to, [{ from: a, via: s.via }]);
    }
  }
  const distances = (withVia: boolean): Map<number, number> => {
    const dist = new Map<number, number>();
    const queue: [number, number][] = [...targets].map((z) => [z, 0]);
    for (const [z] of queue) dist.set(z, 0);
    while (queue.length) {
      let at = 0;
      for (let i = 1; i < queue.length; i++) if (queue[i]![1] < queue[at]![1]) at = i;
      const [z, d] = queue.splice(at, 1)[0]!;
      if (d > (dist.get(z) ?? Infinity)) continue;
      for (const r of reverse.get(z) ?? []) {
        const nd = d + graph.weight(z) + (withVia ? r.via.reduce((s, v) => s + graph.weight(v), 0) : 0);
        if (nd < (dist.get(r.from) ?? Infinity)) {
          dist.set(r.from, nd);
          queue.push([r.from, nd]);
        }
      }
    }
    return dist;
  };
  const low = distances(false);
  const high = distances(true);
  let limit = Infinity;
  for (const o of origins) if (high.has(o)) limit = Math.min(limit, graph.count([o]) + high.get(o)!);
  if (!Number.isFinite(limit)) return [];
  // Zones sold together can make the one real path dearer than its plain count.
  let slack = 0;
  for (const z of graph.zones) slack = Math.max(slack, graph.count([z]) - graph.weight(z));
  limit += extra + slack;

  const found = new Map<string, ZonePath>();
  let budget = opts.maxSteps ?? 200_000;
  const walk = (zone: number, set: Set<number>, cost: number) => {
    if (targets.has(zone)) {
      const zones = graph.complete(set);
      const key = zones.join(',');
      if (!found.has(key)) found.set(key, { zones, count: graph.count(zones) });
      return;
    }
    for (const s of graph.steps.get(zone) ?? []) {
      if (set.has(s.to) || budget-- <= 0) continue;
      const added = [s.to, ...s.via].filter((z) => !set.has(z));
      const next = cost + added.reduce((sum, z) => sum + graph.weight(z), 0);
      const rest = low.get(s.to);
      if (rest === undefined || next + rest > limit) continue;
      for (const z of added) set.add(z);
      walk(s.to, set, next);
      for (const z of added) set.delete(z);
    }
  };
  for (const o of origins) walk(o, new Set([o]), graph.weight(o));

  const all = [...found.values()];
  if (all.length === 0) return [];
  const least = Math.min(...all.map((p) => p.count));
  return all
    .filter((p) => p.count <= least + extra)
    .sort((a, b) => a.count - b.count || a.zones.length - b.zones.length || a.zones.join(',').localeCompare(b.zones.join(',')));
}

// ---------------------------------------------------------------------------------------------
// Which zone sets are worth a search of their own
// ---------------------------------------------------------------------------------------------

/** A set of zones to restrict a timetable search to. */
export interface ZoneSearch {
  alliance: string;
  /** Zones allowed, ascending (with the zones sold together). */
  zones: number[];
  /** Price-relevant count; for 'network', that of the whole network. */
  count: number;
  /**
   * 'path': a zone path between the two ends; 'present': the zones of a connection already
   * found (the search shows its other departures); 'network': every zone of the network, where
   * the path costs the all-zones price anyway.
   */
  why: 'path' | 'present' | 'network';
  /** The value for the routing engine: "<alliance>:<zone>" per zone. */
  tags: string[];
}

export interface ZoneSearchOptions extends ZonePathOptions {
  /** Most zone sets returned. Default 4. */
  max?: number;
}

const stopId = (p: { stopId?: string; name: string }) => p.stopId;

/**
 * The zone sets to search, given the connections a search without restriction returned (the
 * public transport legs of each).
 *
 * For every fare network with a pass plan and a price grid that has a first stop and a last stop
 * of these connections:
 *  1. the zone paths between the zones of the first stops and those of the last stops: the
 *     cheapest and those up to `extra` zones dearer (`zonePaths`);
 *  2. the zone sets of the connections themselves, when within the same limit: a search inside
 *     them shows the departures of that ticket which faster connections on a dearer one hide;
 *  3. where a set reaches the count from which the network charges its all-zones price, the
 *     whole network instead (the pass is valid everywhere).
 * Left out: a set that contains every connection already found (the restricted search would
 * return the same answer), a set that contains a set already chosen (it costs more and allows
 * the same connections and more: the least useful), and, where the data says which zones are a
 * network's own, a set with none (the network does not sell it). Cheapest first, at most `max`.
 */
export function zoneSearches(trips: Leg[][], deps: { nova: NovaData; networks: Networks }, opts: ZoneSearchOptions = {}): ZoneSearch[] {
  const { nova, networks } = deps;
  const max = opts.max ?? 4;
  const extra = opts.extra ?? 2;
  const withStops = trips.filter((legs) => legs.length > 0);
  if (withStops.length === 0 || max <= 0) return [];
  const firsts = [...new Set(withStops.map((legs) => stopId(legs[0]!.from)).filter((s): s is string => !!s))];
  const lasts = [...new Set(withStops.map((legs) => stopId(legs[legs.length - 1]!.to)).filter((s): s is string => !!s))];
  if (firsts.length === 0 || lasts.length === 0) return [];
  const atFirst = new Set(firsts.flatMap((s) => nova.alliancesAt(s)));
  const atLast = new Set(lasts.flatMap((s) => nova.alliancesAt(s)));

  // The zones of each connection in each network that contains it.
  const resolve = tripResolver(nova, networks);
  const inNetwork = withStops.map((legs) => {
    const seqs = legs.map((l) => [l.from, ...(l.intermediateStops ?? []), l.to].map(stopId));
    if (!seqs.every((s): s is string[] => s.every((x) => !!x))) return new Map<string, number[]>();
    return new Map(resolve(seqs).candidates.map((c) => [c.alliance, c.zones]));
  });

  const perNetwork: ZoneSearch[][] = [];
  for (const alliance of [...atFirst].filter((a) => atLast.has(a)).sort()) {
    const net = networks.get(alliance);
    const plans = networkPlans(nova, networks, alliance);
    if (!net || !plans) continue;
    const graph = zoneGraph(nova, alliance, plans.pass, net);
    const from = [...new Set(firsts.flatMap((s) => graph.zonesOfStop(s)))];
    const to = [...new Set(lasts.flatMap((s) => graph.zonesOfStop(s)))];
    const paths = zonePaths(graph, from, to, { extra, maxSteps: opts.maxSteps });
    if (paths.length === 0) continue;
    const least = paths[0]!.count;
    const allFrom = net.rules.allZonesFrom ?? Infinity;
    const own = networks.ownZones?.alliances?.[alliance]?.[plans.pass];

    const sets = new Map<string, ZoneSearch>();
    const put = (zones: number[], count: number, why: ZoneSearch['why']) => {
      const whole = count >= allFrom;
      const z = whole ? graph.zones : zones;
      const key = z.join(',');
      if (!sets.has(key)) sets.set(key, { alliance, zones: z, count: whole ? graph.count(z) : count, why: whole ? 'network' : why, tags: segmentTagsOfZones(alliance, z) });
    };
    for (const p of paths) put(p.zones, p.count, 'path');
    for (const m of inNetwork) {
      const zones = m.get(alliance);
      if (!zones) continue;
      const z = graph.complete(zones);
      const count = graph.count(z);
      if (count <= least + extra) put(z, count, 'present');
    }

    const chosen: ZoneSearch[] = [];
    const within = (inner: number[], outer: number[]) => inner.every((z) => outer.includes(z));
    for (const s of [...sets.values()].sort((a, b) => a.count - b.count || a.zones.length - b.zones.length)) {
      if (inNetwork.every((m) => m.has(alliance) && within(m.get(alliance)!, s.zones))) continue;
      if (own && !s.zones.some((z) => own[String(z)]?.own === true)) continue;
      if (chosen.some((c) => within(c.zones, s.zones))) continue;
      chosen.push(s);
      if (chosen.length >= max) break;
    }
    if (chosen.length) perNetwork.push(chosen);
  }
  // Several networks: the cheapest set of each first, then their second ones, and so on.
  const out: ZoneSearch[] = [];
  for (let rank = 0; out.length < max && perNetwork.some((l) => l.length > rank); rank++) {
    for (const list of perNetwork) if (list[rank] && out.length < max) out.push(list[rank]!);
  }
  return out;
}
