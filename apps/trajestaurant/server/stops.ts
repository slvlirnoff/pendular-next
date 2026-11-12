import { localToUtc } from '@pendular/engine';
import type { Departure, DeparturesResponse, MapStop } from '../src/api.js';
import type { SearchDeps } from './search.js';
import { localNow, routingDate, TIMEZONE } from './timetable.js';

/**
 * Public transport stops (MOTIS's timetable) for the map, and the departure board of a stop.
 *
 * MOTIS lists every platform of a stop with its parent: one stop per parent here, with the modes
 * of all its platforms. A stop's departures include those of the stops MOTIS holds as the same
 * place (Lucens: the station's trains and the buses at the bus stop in front).
 */

interface MotisStop {
  name: string;
  stopId: string;
  parentId?: string;
  lat: number;
  lon: number;
  modes?: string[];
  importance?: number;
}

/** The map shows stops from this zoom on: no larger box is asked for (degrees). */
const MAX_SPAN = { lat: 0.06, lon: 0.09 };

export async function mapStops(deps: Pick<SearchDeps, 'motisUrl' | 'fetch'>, min: [number, number], max: [number, number]): Promise<MapStop[]> {
  if (max[0] - min[0] > MAX_SPAN.lat || max[1] - min[1] > MAX_SPAN.lon) return [];
  const url = new URL('/api/v1/map/stops', deps.motisUrl);
  url.searchParams.set('min', `${min[0]},${min[1]}`);
  url.searchParams.set('max', `${max[0]},${max[1]}`);
  const r = await deps.fetch(url);
  if (!r.ok) throw new Error(`MOTIS map/stops ${r.status}`);
  return groupStops((await r.json()) as MotisStop[]);
}

/** One stop per parent (its platforms together), placed at the parent or its first platform. */
export function groupStops(list: MotisStop[]): MapStop[] {
  const byParent = new Map<string, MapStop & { own: boolean }>();
  for (const s of list) {
    const id = s.parentId ?? s.stopId;
    const modes = (s.modes ?? []).map(modeOf);
    const hit = byParent.get(id);
    if (!hit) {
      byParent.set(id, { id, name: s.name, lat: s.lat, lon: s.lon, modes: [...new Set(modes)], own: s.stopId === id });
      continue;
    }
    for (const m of modes) if (!hit.modes.includes(m)) hit.modes.push(m);
    if (s.stopId === id && !hit.own) Object.assign(hit, { lat: s.lat, lon: s.lon, own: true });
  }
  return [...byParent.values()].map(({ own: _own, ...s }) => ({ ...s, modes: s.modes.sort((a, b) => MODE_ORDER.indexOf(a) - MODE_ORDER.indexOf(b)) }));
}

const MODE_ORDER = ['rail', 'tram', 'metro', 'bus', 'boat', 'cableway', 'funicular', 'other'];

/** MOTIS's mode (REGIONAL_RAIL, BUS…) → the few the board tells apart. */
export function modeOf(m: string): Departure['mode'] {
  if (/RAIL|TRAIN|SUBURBAN/.test(m)) return 'rail';
  if (m === 'TRAM') return 'tram';
  if (m === 'SUBWAY' || m === 'METRO') return 'metro';
  if (m === 'BUS' || m === 'COACH' || m === 'ODM') return 'bus';
  if (m === 'FERRY') return 'boat';
  if (m === 'AERIAL_LIFT') return 'cableway';
  if (m === 'FUNICULAR') return 'funicular';
  return 'other';
}

interface MotisStopTime {
  mode: string;
  routeShortName?: string;
  displayName?: string;
  tripShortName?: string;
  headsign?: string;
  agencyName?: string;
  cancelled?: boolean;
  tripCancelled?: boolean;
  realTime?: boolean;
  place: { name: string; departure?: string; scheduledDeparture?: string; track?: string; scheduledTrack?: string; pickupType?: string };
}

const hhmm = (iso: string) =>
  new Intl.DateTimeFormat('fr-CH', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

/**
 * The next departures from a stop, from now (on the same weekday and time of the reference week
 * when the timetable does not cover today: "horaire type"). Trips that end at the stop are left
 * out.
 */
export async function departures(deps: Pick<SearchDeps, 'motisUrl' | 'fetch' | 'timetable'>, stopId: string, count: number, now = new Date()): Promise<DeparturesResponse> {
  const local = localNow(now);
  const day = routingDate(local.date, deps.timetable);
  const at = localToUtc(day.date, local.time, TIMEZONE);
  const url = new URL('/api/v1/stoptimes', deps.motisUrl);
  url.searchParams.set('stopId', stopId);
  url.searchParams.set('time', at.toISOString());
  url.searchParams.set('n', String(count + 6));
  const r = await deps.fetch(url);
  if (!r.ok) throw new Error(`MOTIS stoptimes ${r.status}`);
  const body = (await r.json()) as { stopTimes?: MotisStopTime[]; place?: { name?: string } };
  const list: Departure[] = [];
  for (const s of body.stopTimes ?? []) {
    const p = s.place;
    if (!p.departure || p.pickupType === 'NOT_ALLOWED') continue;
    // A trip that ends here (its headsign is this stop) is an arrival.
    if (s.headsign && s.headsign === p.name) continue;
    const scheduled = p.scheduledDeparture ?? p.departure;
    const delayMin = Math.round((Date.parse(p.departure) - Date.parse(scheduled)) / 60_000);
    list.push({
      time: hhmm(scheduled),
      minutes: Math.max(0, Math.round((Date.parse(p.departure) - at.getTime()) / 60_000)),
      ...(s.realTime && delayMin > 0 ? { delayMin } : {}),
      mode: modeOf(s.mode),
      line: s.routeShortName || s.displayName || s.tripShortName || '',
      direction: s.headsign ?? '',
      ...(p.track || p.scheduledTrack ? { track: p.track ?? p.scheduledTrack } : {}),
      ...(s.agencyName ? { operator: s.agencyName } : {}),
      ...(s.cancelled || s.tripCancelled ? { cancelled: true } : {}),
    });
    if (list.length >= count) break;
  }
  return { stopId, name: body.place?.name ?? null, departures: list, typicalTimetable: day.typical };
}
