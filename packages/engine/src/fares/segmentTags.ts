import type { NovaData } from './nova.js';
import { networkPlans, type Networks } from './networks.js';

/**
 * "Segment tags": which fare zones a vehicle crosses between two consecutive stops of its trip.
 * The MOTIS fork (tools/motis-fork) reads them from a file and restricts a search to the
 * sections a list of tags allows; the planner asks with the zones of a pass. Both sides use the
 * names and the zone logic of this file, so that a pass always allows the trip it was priced for.
 */

/** The tag of one zone of one fare network: "mobilis:60". */
export const segmentTag = (alliance: string, zone: number): string => `${alliance}:${zone}`;

/** The tags a pass of these zones allows. */
export const segmentTagsOfZones = (alliance: string, zones: number[]): string[] => zones.map((z) => segmentTag(alliance, z));

/** Every zonal network with a pass plan, and that plan: the networks the trip resolver prices on. */
export function zonalPassPlans(nova: NovaData, networks: Networks): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of nova.alliances()) {
    const p = networkPlans(nova, networks, a.id);
    if (p) out.set(a.id, p.pass);
  }
  return out;
}

export interface SectionZones {
  alliance: string;
  zones: number[];
  /** 'hop': the fare data has this very edge; 'bridged': joined through stops the vehicle skips. */
  how: 'hop' | 'bridged';
}

export interface SectionTags {
  /** One entry per network that has the zones of the section. */
  networks: SectionZones[];
  /** Networks that serve both stops but cannot say which zones lie between them. */
  unresolved: string[];
}

/**
 * Zones of the section from stop `a` to stop `b` (station numbers) in every network of `plans`
 * that serves both: those of the edge when the fare data has one, else those along the chain of
 * edges that joins them (`zonesForStops`, exactly what the trip resolver does for a leg).
 */
export function sectionTags(nova: NovaData, plans: ReadonlyMap<string, string>, a: number | string, b: number | string): SectionTags {
  const from = String(a);
  const to = String(b);
  const out: SectionTags = { networks: [], unresolved: [] };
  const atB = new Set(nova.alliancesAt(to));
  for (const alliance of nova.alliancesAt(from)) {
    const plan = plans.get(alliance);
    if (!plan || !atB.has(alliance)) continue;
    const direct = nova.zonesOnEdge(alliance, plan, from, to);
    if (direct) {
      if (direct.length) out.networks.push({ alliance, zones: direct, how: 'hop' });
      else out.unresolved.push(alliance);
      continue;
    }
    const z = nova.zonesForStops(alliance, plan, [from, to]);
    if (z.missingEdges.length === 0 && z.zones.length > 0) out.networks.push({ alliance, zones: z.zones, how: 'bridged' });
    else out.unresolved.push(alliance);
  }
  out.networks.sort((x, y) => x.alliance.localeCompare(y.alliance));
  return out;
}

/**
 * The tags column of the segment file: one group per network, groups joined by ";", the tags of
 * a group by "|" ("frimobil:50;mobilis:60|mobilis:103"). The fork allows a section when one
 * group lies entirely in the allowed tags: a pass of one network is enough.
 */
export function formatSectionTags(networks: SectionZones[]): string {
  return networks.map((n) => segmentTagsOfZones(n.alliance, n.zones).join('|')).join(';');
}

/**
 * Station number of a stop of the Swiss GTFS feed, as the fork derives it from the same ids
 * (`station_key` in motis.patch) and as `stationId()` does for MOTIS ids. `parentStation` wins
 * over the stop's own id.
 *   "Parentch:1:sloid:4121", "ch:1:sloid:4121:0:1", "ch:1:sloid:4121_gen:…" → 8504121 (85 + five digits)
 *   "Parent8002140", "8002140", "8014474_gen:missingSLOID_pf:5"             → 8002140, 8014474
 *   "ch:1:sloid:1400679" (six digits and more: stops abroad, taken as is)   → 1400679
 *   "8774549", "Parent8774549" (plain numbers, taken as they are)           → 8774549
 */
export function gtfsStationNumber(stopId: string, parentStation?: string): number | null {
  const id = (parentStation || stopId).replace(/^Parent/, '');
  const sloid = /^ch:1:sloid:(\d+)/.exec(id);
  if (sloid) {
    const n = Number(sloid[1]);
    if (!(n > 0)) return null;
    return sloid[1]!.length > 5 ? n : 8_500_000 + n;
  }
  const plain = /^(\d+)/.exec(id);
  return plain && Number(plain[1]) > 0 ? Number(plain[1]) : null;
}
