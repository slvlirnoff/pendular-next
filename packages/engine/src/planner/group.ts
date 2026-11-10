import type { Itinerary, Leg } from '../types.js';
import { TRANSIT_MODES } from '../types.js';

const isTransit = (l: Leg) => (TRANSIT_MODES as readonly string[]).includes(l.mode);

/** Connections that use the same lines between the same stops are one route. */
export interface RouteGroup {
  signature: string;
  title: string;
  itineraries: Itinerary[];
  /** The itinerary whose duration is the median of the group. */
  typical: Itinerary;
  typicalMin: number;
  bestMin: number;
  changes: number;
  departures: number;
  firstArrival: string;
  lastArrival: string;
  /** Arrival instants (ISO), ascending. */
  arrivals: string[];
}

/**
 * One route = the same kinds of vehicle in the same order between the same first and last stop.
 * Where the change happens (Lucens or Moudon for the same two buses) and which of two
 * alternating lines runs (R8 or R9) do not make it another route for a commuter.
 */
export function signature(it: Itinerary): string {
  const legs = it.legs.filter(isTransit);
  if (legs.length === 0) return '';
  const first = legs[0]!.from;
  const last = legs[legs.length - 1]!.to;
  return `${legs.map((l) => l.mode).join('>')}@${first.stopId ?? first.name}>${last.stopId ?? last.name}`;
}

/** "Lucens → Lausanne, R8/R9": the lines of all connections of the route, leg by leg. */
export function routeTitle(its: Itinerary[]): string {
  const legsOf = (it: Itinerary) => it.legs.filter(isTransit);
  const first = legsOf(its[0]!);
  if (first.length === 0) return '';
  const lines = first.map((leg, i) => {
    const names = new Set(its.map((it) => legsOf(it)[i]?.line?.name || leg.mode));
    const sorted = [...names].sort();
    return sorted.length > 3 ? `${sorted.slice(0, 3).join('/')}…` : sorted.join('/');
  });
  return `${first[0]!.from.name} → ${first[first.length - 1]!.to.name}, ${lines.join(' · ')}`;
}

/** Where the changes happen: the stops of every public transport leg. */
const stopsKey = (it: Itinerary) =>
  it.legs
    .filter(isTransit)
    .map((l) => `${l.from.stopId ?? l.from.name}>${l.to.stopId ?? l.to.name}`)
    .join('|');

/**
 * `fareKey` tells which connections need the same ticket: a route never mixes two tickets, so
 * that each option has one price (a bus through one more zone is another option than the train).
 */
export function groupItineraries(its: Itinerary[], fareKey?: (it: Itinerary) => string): RouteGroup[] {
  const by = new Map<string, Itinerary[]>();
  for (const it of its) {
    const route = signature(it);
    if (!route) continue;
    const sig = fareKey ? `${fareKey(it)}#${route}` : route;
    const list = by.get(sig) ?? [];
    // The same vehicles reached by a different walk are one departure.
    if (!list.some((x) => x.arrival === it.arrival && x.departure === it.departure)) list.push(it);
    by.set(sig, list);
  }
  // The same lines taken to or from a neighbouring stop (a bus left one stop earlier, with a
  // longer walk) are the same route: merge such groups when they need the same ticket.
  const linesOf = (list: Itinerary[]) => {
    const n = list[0]!.legs.filter(isTransit).length;
    return Array.from({ length: n }, (_, i) => new Set(list.map((it) => it.legs.filter(isTransit)[i]?.line?.name ?? '')));
  };
  const prefix = (sig: string) => sig.slice(0, sig.lastIndexOf('@'));
  const keys = [...by.keys()];
  for (let i = 0; i < keys.length; i++) {
    const a = by.get(keys[i]!);
    if (!a) continue;
    for (let j = i + 1; j < keys.length; j++) {
      const b = by.get(keys[j]!);
      if (!b || prefix(keys[i]!) !== prefix(keys[j]!)) continue;
      const la = linesOf(a);
      const lb = linesOf(b);
      if (!la.every((set, k) => [...set].some((name) => name !== '' && lb[k]!.has(name)))) continue;
      for (const it of b) if (!a.some((x) => x.arrival === it.arrival && x.departure === it.departure)) a.push(it);
      by.delete(keys[j]!);
    }
  }
  const groups: RouteGroup[] = [];
  for (const [sig, list] of by) {
    const byDur = [...list].sort((a, b) => a.durationMin - b.durationMin);
    // The typical connection: median duration, among those changing where most of them change.
    const counts = new Map<string, number>();
    for (const i of list) counts.set(stopsKey(i), (counts.get(stopsKey(i)) ?? 0) + 1);
    const usual = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    const usualByDur = byDur.filter((i) => stopsKey(i) === usual);
    const typical = usualByDur[Math.floor((usualByDur.length - 1) / 2)]!;
    const arrivals = list.map((i) => i.arrival).sort();
    groups.push({
      signature: sig,
      // Named after the typical connection and those that change at the same stops: a title
      // mixing the lines of two different ways through would describe a trip nobody makes.
      title: routeTitle(list.filter((i) => stopsKey(i) === stopsKey(typical))),
      itineraries: list,
      typical,
      typicalMin: typical.durationMin,
      bestMin: byDur[0]!.durationMin,
      changes: typical.changes,
      departures: list.length,
      firstArrival: arrivals[0]!,
      lastArrival: arrivals[arrivals.length - 1]!,
      arrivals,
    });
  }
  return groups.sort((a, b) => a.typicalMin - b.typicalMin);
}
