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

export function signature(it: Itinerary): string {
  return it.legs
    .filter(isTransit)
    .map((l) => `${l.mode}@${l.from.stopId ?? l.from.name}>${l.to.stopId ?? l.to.name}`)
    .join('|');
}

/** "Lucens → Lausanne, R8/R9": the lines of all connections of the route, leg by leg. */
export function routeTitle(its: Itinerary[]): string {
  const legsOf = (it: Itinerary) => it.legs.filter(isTransit);
  const first = legsOf(its[0]!);
  if (first.length === 0) return '';
  const lines = first.map((leg, i) => {
    const names = new Set(its.map((it) => legsOf(it)[i]?.line?.name || leg.mode));
    return [...names].sort().join('/');
  });
  return `${first[0]!.from.name} → ${first[first.length - 1]!.to.name}, ${lines.join(' · ')}`;
}

export function groupItineraries(its: Itinerary[]): RouteGroup[] {
  const by = new Map<string, Itinerary[]>();
  for (const it of its) {
    const sig = signature(it);
    if (!sig) continue;
    const list = by.get(sig) ?? [];
    // The same vehicles reached by a different walk are one departure.
    if (!list.some((x) => x.arrival === it.arrival && x.departure === it.departure)) list.push(it);
    by.set(sig, list);
  }
  const groups: RouteGroup[] = [];
  for (const [sig, list] of by) {
    const byDur = [...list].sort((a, b) => a.durationMin - b.durationMin);
    const typical = byDur[Math.floor((byDur.length - 1) / 2)]!;
    const arrivals = list.map((i) => i.arrival).sort();
    groups.push({
      signature: sig,
      title: routeTitle(list),
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
