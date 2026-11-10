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
    gtfs?: { stopId: string; name?: string }[];
  }[];
}

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

export function createZoneIndex(table: ZoneTable): ZoneIndex {
  const byId = new Map<string, { zones: number[]; confident: boolean }>();
  const byName = new Map<string, { zones: number[]; confident: boolean }>();
  for (const s of table.stops) {
    if (!s.zones?.length) continue;
    const entry = { zones: s.zones, confident: s.confidence !== 'low' };
    for (const g of s.gtfs ?? []) {
      const k = stationKey(g.stopId);
      const prev = byId.get(k);
      // A stop matched by several labels keeps the more confident one.
      if (!prev || (!prev.confident && entry.confident)) byId.set(k, entry);
    }
    const n = norm(s.label);
    if (n && !byName.has(n)) byName.set(n, entry);
  }
  const adj = new Map<number, number[]>();
  for (const [z, v] of Object.entries(table.zones)) adj.set(Number(z), v.neighbours.map(Number));

  const neighbours = (z: number) => adj.get(z) ?? [];

  function zonesOfStop(stop: StopPoint) {
    if (stop.stopId) {
      const hit = byId.get(stationKey(stop.stopId));
      if (hit) return hit;
    }
    const byLabel = byName.get(norm(stop.name));
    return byLabel ? { zones: byLabel.zones, confident: false } : null;
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
    for (const leg of legs) {
      const stops = [leg.from, ...(leg.intermediateStops ?? []), leg.to];
      const known: { zones: number[] }[] = [];
      for (let i = 0; i < stops.length; i++) {
        const z = zonesOfStop(stops[i]!);
        const isEnd = i === 0 || i === stops.length - 1;
        if (!z) {
          // Boarding or alighting outside the table: not a Mobilis trip.
          if (isEnd) return null;
          exact = false;
          notes.push(`stop not in zone table: ${stops[i]!.name}`);
          continue;
        }
        if (!z.confident) {
          exact = false;
          notes.push(`uncertain zone match: ${stops[i]!.name}`);
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
    // Zone 12 is only sold together with a neighbouring zone ("Grand Lausanne" = 11 + 12).
    if (used.size === 1 && used.has(12)) used.add(11);
    return { zones: [...used].sort((a, b) => a - b), exact, notes: [...new Set(notes)] };
  }

  return { zonesOfStop, zonesForLegs, neighbours };
}
