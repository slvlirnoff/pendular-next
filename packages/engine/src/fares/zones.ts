import type { Leg, StopPoint } from '../types.js';

/** Shape of data/zones/mobilis-stops.json (built by tools/mobilis-zones). */
export interface ZoneTable {
  network: string;
  zones: Record<string, { neighbours: number[] }>;
  stops: {
    label: string;
    zones: number[];
    border?: boolean;
    confidence?: 'high' | 'medium' | 'low';
    gtfs?: { stopId: string; name?: string; lat?: number; lon?: number; match?: string }[];
  }[];
}

/** A stop not drawn on the plan takes the zone of drawn stops within this distance. */
const NEAREST_MAX_KM = 2.5;
/**
 * The network has zones beyond its home territory (shared with neighbouring networks). A stop
 * outside the territory borrows a zone only from drawn stops that are outside it too, and close.
 */
const NEAREST_OUTSIDE_MAX_KM = 1.5;

export interface ZoneResult {
  zones: number[];
  /** True when every stop of the trip was found in the table with a confident match. */
  exact: boolean;
  /** Why the result is not exact, for the explanation. */
  notes: string[];
}

export interface ZoneIndex {
  /** Zones a stop lies in (two or more for a stop on a border); null when unknown. */
  zonesOfStop(stop: StopPoint): { zones: number[]; confident: boolean } | null;
  /** Zones needed for the trip, or null when it is not (entirely) inside the network. */
  zonesForLegs(legs: Leg[]): ZoneResult | null;
  neighbours(zone: number): number[];
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Station-level id: "8501120:0:1" → "8501120", "Parent8501120" → "8501120". */
export const stationKey = (id: string) => id.replace(/^Parent/, '').split(':')[0]!;

export interface ZoneIndexOptions {
  /**
   * Whether a stop (station-level number) lies inside the fare network's territory. Stops the
   * plan does not draw take a zone from nearby stops only when this says yes; a trip calling
   * at a stop outside the territory is not a trip of this network.
   */
  inNetwork?: (stationNumber: string) => boolean;
}

export function createZoneIndex(table: ZoneTable, options: ZoneIndexOptions = {}): ZoneIndex {
  const outside = (stop: StopPoint) => !!options.inNetwork && !!stop.stopId && !options.inNetwork(stationKey(stop.stopId));
  // A stop id can be claimed by several labels (a village label lists all stops of the village);
  // the most specific match wins.
  const RANK: Record<string, number> = { exact: 4, normalised: 3, fuzzy: 2, locality: 1 };
  const byId = new Map<string, { zones: number[]; confident: boolean; rank: number }>();
  const byName = new Map<string, { zones: number[]; confident: boolean }>();
  for (const s of table.stops) {
    if (!s.zones?.length) continue;
    for (const g of s.gtfs ?? []) {
      const k = stationKey(g.stopId);
      // The table sometimes ties a village label ("Forel-sur-Lucens") to the station of the town
      // it is named after ("Lucens"): a label equal to the stop's own name outranks everything.
      const sameName = g.name !== undefined && norm(g.name) === norm(s.label);
      const rank = (sameName ? 100 : 0) + (RANK[g.match ?? 'exact'] ?? 0) * 10 + (s.confidence === 'high' ? 2 : s.confidence === 'medium' ? 1 : 0);
      const specific = sameName || (g.match !== 'locality' && g.match !== 'fuzzy');
      const entry = { zones: s.zones, confident: s.confidence !== 'low' && specific, rank };
      const prev = byId.get(k);
      if (!prev || rank > prev.rank) byId.set(k, entry);
      // Two equally good claims with different zones: keep the first, but do not trust it.
      else if (rank === prev.rank && prev.zones.join() !== s.zones.join()) prev.confident = false;
    }
    const entry = { zones: s.zones, confident: s.confidence !== 'low' };
    const n = norm(s.label);
    if (n && !byName.has(n)) byName.set(n, entry);
  }
  // Stops with a position, for stops the plan does not draw (most bus stops).
  const located: { lat: number; lon: number; zones: number[]; outside: boolean }[] = [];
  for (const s of table.stops) {
    if (!s.zones?.length || s.confidence === 'low') continue;
    for (const g of s.gtfs ?? []) {
      // Only the claim that won the stop id.
      const won = byId.get(stationKey(g.stopId));
      if (g.lat != null && g.lon != null && won?.zones === s.zones) located.push({ lat: g.lat, lon: g.lon, zones: s.zones, outside: !!options.inNetwork && !options.inNetwork(stationKey(g.stopId)) });
    }
  }
  const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
    Math.hypot((a.lat - b.lat) * 111.2, (a.lon - b.lon) * 111.2 * Math.cos((a.lat * Math.PI) / 180));
  /** The zone most common among the nearest drawn stops, when they are close enough. */
  function nearestZones(p: { lat: number; lon: number }, fromOutside = false): number[] | null {
    const max = fromOutside ? NEAREST_OUTSIDE_MAX_KM : NEAREST_MAX_KM;
    const near = located
      .filter((l) => !fromOutside || l.outside)
      .map((l) => ({ l, d: km(p, l) }))
      .filter((x) => x.d <= max)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);
    if (near.length === 0) return null;
    const votes = new Map<number, number>();
    for (const n of near) for (const z of n.l.zones) votes.set(z, (votes.get(z) ?? 0) + 1 / (0.2 + n.d));
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]!;
    return [best[0]];
  }

  const adj = new Map<number, number[]>();
  for (const [z, v] of Object.entries(table.zones)) adj.set(Number(z), v.neighbours.map(Number));

  const neighbours = (z: number) => adj.get(z) ?? [];

  function zonesOfStop(stop: StopPoint) {
    if (stop.stopId) {
      const hit = byId.get(stationKey(stop.stopId));
      if (hit) return hit;
    }
    if (outside(stop)) {
      const shared = nearestZones(stop, true);
      return shared ? { zones: shared, confident: false } : null;
    }
    const byLabel = byName.get(norm(stop.name));
    if (byLabel) return { zones: byLabel.zones, confident: false };
    const guess = nearestZones(stop);
    return guess ? { zones: guess, confident: false } : null;
  }

  /** Shortest chain of zones from any zone in `from` to any zone in `to`, exclusive of the ends. */
  function bridge(from: number[], to: number[]): number[] | null {
    const target = new Set(to);
    const prev = new Map<number, number | null>(from.map((z) => [z, null]));
    const queue = [...from];
    while (queue.length) {
      const z = queue.shift()!;
      if (target.has(z)) {
        const path: number[] = [];
        for (let c: number | null | undefined = prev.get(z); c != null && !from.includes(c); c = prev.get(c)) path.push(c);
        return path;
      }
      for (const n of neighbours(z)) {
        if (!prev.has(n)) {
          prev.set(n, z);
          queue.push(n);
        }
      }
    }
    return null;
  }

  function zonesForLegs(legs: Leg[]): ZoneResult | null {
    const notes: string[] = [];
    let exact = true;
    const used = new Set<number>();
    let guessed = 0;
    for (const leg of legs) {
      const stops = [leg.from, ...(leg.intermediateStops ?? []), leg.to];
      const known: { zones: number[] }[] = [];
      for (let i = 0; i < stops.length; i++) {
        const z = zonesOfStop(stops[i]!);
        const isEnd = i === 0 || i === stops.length - 1;
        if (!z) {
          // Boarding or alighting outside the table: not a Mobilis trip.
          if (isEnd || outside(stops[i]!)) return null;
          exact = false;
          guessed++;
          continue;
        }
        if (!z.confident) {
          exact = false;
          guessed++;
        }
        known.push(z);
      }
      // Walk along the leg. A stop on a border counts in the zone already in use when
      // possible, else in the zone shared with the next stop, else in its first zone.
      let current: number[] = [];
      known.forEach((k, i) => {
        let pick = k.zones.filter((z) => used.has(z));
        if (pick.length === 0) {
          const next = known[i + 1]?.zones ?? [];
          pick = k.zones.filter((z) => next.includes(z));
        }
        if (pick.length === 0 && k.zones.length > 1) {
          // No zone in common with what comes next: take the side nearest to the next stop.
          const next = known[i + 1]?.zones ?? current;
          const ranked = k.zones
            .map((z) => ({ z, d: next.length ? (bridge([z], next)?.length ?? Infinity) : 0 }))
            .sort((a, b) => a.d - b.d);
          pick = [ranked[0]!.z];
        }
        if (pick.length === 0) pick = [k.zones[0]!];
        const chosen = pick[0]!;
        if (current.length && !current.includes(chosen) && !current.some((c) => neighbours(c).includes(chosen))) {
          // The vehicle crosses zones where it does not stop (express services).
          const via = bridge(current, [chosen]);
          if (via === null) {
            exact = false;
            notes.push('zones not connected in the zone graph');
          } else if (via.length) {
            for (const z of via) used.add(z);
            exact = false;
            notes.push(`zones crossed without a stop, by shortest path: ${via.join(', ')}`);
          }
        }
        used.add(chosen);
        current = [chosen];
      });
    }
    if (used.size === 0) return null;
    if (guessed) notes.unshift(`zone of ${guessed} stop(s) not drawn on the plan taken from nearby stops`);
    // Lausanne's zones 11 and 12 ("Grand Lausanne") always go together: SBB's shop lists both
    // for any pass that reaches either (checked on Lucens – Lausanne, 10.11.2026).
    if (used.has(11) || used.has(12)) {
      used.add(11);
      used.add(12);
    }
    return { zones: [...used].sort((a, b) => a - b), exact, notes: [...new Set(notes)] };
  }

  return { zonesOfStop, zonesForLegs, neighbours };
}
