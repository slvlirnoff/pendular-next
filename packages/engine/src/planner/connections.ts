import { segmentTagsOfZones } from '../fares/segmentTags.js';
import type { Itinerary, LatLon, RoutingProvider, RuleSet, TimeWindow } from '../types.js';
import { TRANSIT_MODES } from '../types.js';

/**
 * Every connection of a period that one ticket allows, in one direction: the timetable view
 * behind a card of the comparison. A zone pass is any line inside its zones; a route pass is
 * the route (the two ends of its main vehicle); without either, every connection.
 */
export interface ConnectionsRequest {
  /** Where the public transport part starts and ends on the way to work: home (or the car park) and the workplace. */
  from: LatLon & { name?: string };
  to: LatLon & { name?: string };
  /** 'out': from → to, the window is on arrival. 'back': to → from, the window is on departure. */
  direction: 'out' | 'back';
  window: TimeWindow;
  date?: string;
  /** The zones of the pass. */
  zones?: { alliance: string; zones: number[] };
  /** The stops the route passes on the way to work, in order (reversed here for the way back). */
  via?: string[];
}

export interface ConnectionsResult {
  date: string;
  direction: 'out' | 'back';
  itineraries: Itinerary[];
  /**
   * How the search was held to the ticket: 'zones' (only lines inside the pass), 'route'
   * (through the stops of the route), 'none' (every connection: the timetable server cannot
   * restrict a search to zones, or the ticket has neither zones nor a route).
   */
  within: 'zones' | 'route' | 'none';
}

/** Longest door-to-door time of a connection inside a pass, minutes: beyond, it is a wait for the next morning. */
const MAX_TRAVEL_MIN = 240;

export async function connections(req: ConnectionsRequest, deps: { routing: RoutingProvider; rules: RuleSet }): Promise<ConnectionsResult> {
  const { routing, rules } = deps;
  const date = req.date ?? rules.referenceDate;
  const out = req.direction === 'out';
  const tags = routing.segmentFilter && req.zones?.zones.length ? segmentTagsOfZones(req.zones.alliance, req.zones.zones) : [];
  const via = tags.length ? [] : out ? (req.via ?? []) : [...(req.via ?? [])].reverse();
  const from = out ? req.from : req.to;
  const to = out ? req.to : req.from;
  const found = await routing.transit({
    from,
    to,
    date,
    window: req.window,
    by: out ? 'arrive' : 'depart',
    maxWalkToStopMin: rules.walkToStopMaxMin,
    ...(tags.length ? { allowedSegmentTags: tags, maxTravelMin: MAX_TRAVEL_MIN } : {}),
    ...(via.length ? { via } : {}),
  });
  const itineraries = found
    .filter((it) => it.legs.some((l) => (TRANSIT_MODES as readonly string[]).includes(l.mode)))
    .sort((a, b) => a.departure.localeCompare(b.departure) || a.arrival.localeCompare(b.arrival));
  // The routing engine names free coordinates START and END: use the places' own labels.
  for (const it of itineraries) {
    const first = it.legs[0];
    const last = it.legs[it.legs.length - 1];
    if (first && from.name && !first.from.stopId) first.from.name = from.name;
    if (last && to.name && !last.to.stopId) last.to.name = to.name;
  }
  return { date, direction: req.direction, itineraries, within: tags.length ? 'zones' : via.length ? 'route' : 'none' };
}
