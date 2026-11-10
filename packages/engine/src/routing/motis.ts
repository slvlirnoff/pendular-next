import type {
  DataVersions,
  Itinerary,
  LatLon,
  Leg,
  LegMode,
  ReachableStop,
  RoutingProvider,
  StopPoint,
  StreetProfile,
  StreetRoute,
  TimeWindow,
} from '../types.js';
import { localToUtc, minutesBetween, windowToUtc } from '../time.js';

/** Minimal shapes of the MOTIS v2 API responses that the adapter reads. */
interface MotisPlace {
  name: string;
  stopId?: string;
  parentId?: string;
  lat: number;
  lon: number;
}
interface MotisLeg {
  mode: string;
  from: MotisPlace;
  to: MotisPlace;
  duration: number;
  startTime: string;
  endTime: string;
  distance?: number;
  tripId?: string;
  headsign?: string;
  category?: { id: string; name: string; shortName: string };
  agencyName?: string;
  routeShortName?: string;
  routeLongName?: string;
  tripShortName?: string;
  displayName?: string;
  intermediateStops?: MotisPlace[];
  legGeometry?: { points: string; precision: number; length: number };
}
interface MotisItinerary {
  duration: number;
  startTime: string;
  endTime: string;
  transfers: number;
  legs: MotisLeg[];
}
interface MotisPlanResponse {
  direct?: MotisItinerary[];
  itineraries?: MotisItinerary[];
  nextPageCursor?: string;
  previousPageCursor?: string;
}

export interface MotisOptions {
  baseUrl: string;
  timezone: string;
  /** E-bike cruising speed, m/s (bike uses the MOTIS default). */
  ebikeSpeed?: number;
  /**
   * The timetable has no route shapes, so a leg's length is measured along straight lines between
   * its stops. These factors bring that closer to the distance travelled (rail, other modes).
   */
  transitDistanceFactor?: { rail: number; other: number };
  /** Any instant inside the loaded timetable (MOTIS rejects street queries outside it). */
  referenceTime: string;
  /** Safety cap on result pages fetched per window. */
  maxPages?: number;
  versions?: DataVersions;
  fetch?: typeof fetch;
}

const MODE_MAP: Record<string, LegMode> = {
  WALK: 'walk',
  BIKE: 'bike',
  CAR: 'car',
  CAR_PARKING: 'car',
  TRAM: 'tram',
  SUBWAY: 'metro',
  METRO: 'metro',
  FERRY: 'boat',
  BUS: 'bus',
  COACH: 'bus',
  FUNICULAR: 'funicular',
  CABLE_CAR: 'funicular',
  AERIAL_LIFT: 'cableway',
  AREAL_LIFT: 'cableway',
};

export function mapMode(mode: string): LegMode {
  return MODE_MAP[mode] ?? 'rail';
}

/** Google polyline algorithm with a configurable precision. Returns [lon, lat] pairs. */
export function decodePolyline(points: string, precision: number): [number, number][] {
  const factor = 10 ** precision;
  const out: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  while (index < points.length) {
    for (const which of [0, 1] as const) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = points.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && index < points.length);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += delta;
      else lon += delta;
    }
    out.push([lon / factor, lat / factor]);
  }
  return out;
}

const place = (p: LatLon) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;

/**
 * Station-level id as a Swiss stop number (DiDok/UIC, e.g. "8504121").
 * MOTIS ids look like "ch_Parentch:1:sloid:4121" or "ch_ch:1:sloid:4121:1:2"; the number after
 * "sloid" is the stop number without the country prefix 85.
 */
export function stationId(p: { stopId?: string; parentId?: string }): string | undefined {
  const raw = p.parentId ?? p.stopId;
  if (!raw) return undefined;
  const id = raw.replace(/^[a-z0-9]+_/i, '').replace(/^Parent/, '');
  const sloid = /^ch:1:sloid:(\d+)/.exec(id);
  if (sloid) return `85${sloid[1]!.padStart(5, '0')}`;
  return id.split(':')[0];
}

function toStop(p: MotisPlace): StopPoint {
  return { name: p.name, lat: p.lat, lon: p.lon, stopId: stationId(p) };
}

export class MotisRouting implements RoutingProvider {
  private readonly f: typeof fetch;
  constructor(private readonly o: MotisOptions) {
    this.f = o.fetch ?? fetch;
  }

  private async get<T>(path: string, params: Record<string, string | number | boolean>): Promise<T> {
    const url = new URL(path, this.o.baseUrl);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    // One retry: a single failed call must not silently drop an option (the car, for instance).
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await this.f(url);
        if (res.ok) return (await res.json()) as T;
        if (res.status < 500 || attempt > 0) throw new Error(`MOTIS ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
      } catch (e) {
        if (attempt > 0 || (e instanceof Error && e.message.startsWith('MOTIS '))) throw e;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  private toLeg(l: MotisLeg, streetAs?: LegMode): Leg {
    const mapped = mapMode(l.mode);
    const mode = streetAs && (mapped === 'bike' || mapped === 'car' || mapped === 'walk') ? streetAs : mapped;
    const transit = !['walk', 'bike', 'ebike', 'car'].includes(mode);
    const geometry = l.legGeometry ? decodePolyline(l.legGeometry.points, l.legGeometry.precision) : undefined;
    return {
      mode,
      from: toStop(l.from),
      to: toStop(l.to),
      departure: l.startTime,
      arrival: l.endTime,
      durationMin: Math.round(l.duration / 60),
      distanceM: Math.round(
        l.distance ??
          (geometry ? pathLength(geometry) : 0) *
            // A geometry with more points than stops follows the tracks: its length is the
            // distance. A straight line from stop to stop is corrected by a factor.
            (transit && !(geometry && geometry.length > (l.intermediateStops?.length ?? 0) + 2)
              ? mode === 'rail'
                ? (this.o.transitDistanceFactor?.rail ?? 1)
                : (this.o.transitDistanceFactor?.other ?? 1)
              : 1),
      ),
      line: transit
        ? {
            name: l.displayName ?? l.routeShortName ?? l.tripShortName ?? l.category?.shortName ?? '',
            category: l.category?.shortName,
            operator: l.agencyName,
            headsign: l.headsign,
          }
        : undefined,
      tripId: transit ? l.tripId : undefined,
      intermediateStops: transit ? l.intermediateStops?.map(toStop) : undefined,
      geometry,
    };
  }

  private toItinerary(it: MotisItinerary, streetAs?: LegMode): Itinerary {
    return {
      departure: it.startTime,
      arrival: it.endTime,
      durationMin: Math.round(it.duration / 60),
      changes: it.transfers,
      legs: it.legs.map((l) => this.toLeg(l, streetAs)),
    };
  }

  async transit(q: {
    from: LatLon;
    to: LatLon;
    date: string;
    window: TimeWindow;
    by: 'arrive' | 'depart';
    alternateTies?: boolean;
  }): Promise<Itinerary[]> {
    const { start, end } = windowToUtc(q.date, q.window, this.o.timezone);
    const arriveBy = q.by === 'arrive';
    const out = new Map<string, Itinerary>();
    let cursor: string | undefined;
    const maxPages = this.o.maxPages ?? 6;
    for (let page = 0; page < maxPages; page++) {
      const res = await this.get<MotisPlanResponse>('/api/v6/plan', {
        fromPlace: place(q.from),
        toPlace: place(q.to),
        // MOTIS searches the interval [time, time + searchWindow] on the departure
        // (or [time - searchWindow, time] on the arrival) side.
        time: (arriveBy ? end : start).toISOString(),
        arriveBy,
        searchWindow: Math.round((end.getTime() - start.getTime()) / 1000),
        directModes: 'WALK',
        detailedTransfers: false,
        ...(q.alternateTies ? { algorithm: TIE_ALGORITHM } : {}),
        ...(cursor ? { pageCursor: cursor } : {}),
      });
      let outside = 0;
      for (const it of res.itineraries ?? []) {
        const t = new Date(arriveBy ? it.endTime : it.startTime).getTime();
        if (t < start.getTime() || t > end.getTime()) {
          outside++;
          continue;
        }
        out.set(`${it.startTime}|${it.endTime}|${it.legs.map((l) => l.tripShortName ?? l.mode).join('>')}`, this.toItinerary(it));
      }
      // One call returns every connection of the window, plus one beyond it (checked on windows
      // of two and eight hours, up to 104 connections; a result cap would force paging and
      // paging never added anything). The loop goes on only if a very long response ends
      // inside the window, which means the server cut it short.
      cursor = arriveBy ? res.previousPageCursor : res.nextPageCursor;
      if (!cursor || outside > 0 || (res.itineraries ?? []).length < NEAR_RESULT_CAP) break;
    }
    return [...out.values()].sort((a, b) => a.arrival.localeCompare(b.arrival));
  }

  async street(q: { from: LatLon; to: LatLon; profile: StreetProfile }): Promise<StreetRoute | null> {
    const mode = q.profile === 'car' ? 'CAR' : q.profile === 'walk' ? 'WALK' : 'BIKE';
    const res = await this.get<MotisPlanResponse>('/api/v6/plan', {
      fromPlace: place(q.from),
      toPlace: place(q.to),
      directModes: mode,
      transitModes: '',
      time: this.o.referenceTime,
      maxDirectTime: 4 * 3600,
      detailedTransfers: false,
      ...(q.profile === 'ebike' ? { cyclingSpeed: this.o.ebikeSpeed ?? 6.1 } : {}),
      ...(q.profile === 'bike' || q.profile === 'ebike' ? { elevationCosts: 'LOW' } : {}),
    });
    const it = res.direct?.[0];
    if (!it) return null;
    const legs = it.legs.map((l) => this.toLeg(l, q.profile));
    return {
      durationMin: it.duration / 60,
      distanceM: legs.reduce((s, l) => s + l.distanceM, 0),
      geometry: legs.flatMap((l) => l.geometry ?? []),
    };
  }

  async streetMatrix(q: {
    points: LatLon[];
    anchor: LatLon;
    profile: StreetProfile;
    direction: 'toAnchor' | 'fromAnchor';
    maxMin: number;
  }): Promise<(StreetRoute | null)[]> {
    if (q.points.length === 0) return [];
    const mode = q.profile === 'car' ? 'CAR' : q.profile === 'walk' ? 'WALK' : 'BIKE';
    // E-bikes use the bike network; MOTIS's matrix has no speed setting, so scale afterwards.
    const speedUp = q.profile === 'ebike' ? EBIKE_MATRIX_SPEEDUP : 1;
    const chunks: LatLon[][] = [];
    for (let i = 0; i < q.points.length; i += 120) chunks.push(q.points.slice(i, i + 120));
    const answers = await Promise.all(
      chunks.map((chunk) =>
        this.get<{ duration?: number; distance?: number }[]>('/api/v1/one-to-many', {
          one: `${q.anchor.lat};${q.anchor.lon}`,
          many: chunk.map((p) => `${p.lat};${p.lon}`).join(','),
          mode,
          max: Math.round(q.maxMin * 60 * speedUp),
          maxMatchingDistance: 250,
          arriveBy: q.direction === 'toAnchor',
          withDistance: true,
        }),
      ),
    );
    const out = answers.flat().map((d) =>
      d.duration === undefined || d.duration === null ? null : { durationMin: d.duration / 60 / speedUp, distanceM: d.distance ?? 0 },
    );
    return out;
  }

  async lastTrip(q: { from: LatLon; to: LatLon; date: string; time: string }): Promise<Itinerary | null> {
    // Not a timetable view: "arrive by T" alone returns the connections that leave last.
    const res = await this.get<MotisPlanResponse>('/api/v6/plan', {
      fromPlace: place(q.from),
      toPlace: place(q.to),
      time: localToUtc(q.date, q.time, this.o.timezone).toISOString(),
      arriveBy: true,
      timetableView: false,
      directModes: 'WALK',
      detailedTransfers: false,
    });
    const its = (res.itineraries ?? []).filter((it) => it.legs.some((l) => !['WALK', 'BIKE', 'CAR'].includes(l.mode)));
    if (its.length === 0) return null;
    const last = its.reduce((a, b) => (b.startTime > a.startTime ? b : a));
    return this.toItinerary(last);
  }

  async reachability(q: { to: LatLon; date: string; time: string; maxMin: number }): Promise<ReachableStop[]> {
    const res = await this.get<{ all?: { place?: MotisPlace; duration?: number }[] }>('/api/v6/one-to-all', {
      one: place(q.to),
      time: localToUtc(q.date, q.time, this.o.timezone).toISOString(),
      arriveBy: true,
      maxTravelTime: q.maxMin,
    });
    const out: ReachableStop[] = [];
    for (const r of res.all ?? []) {
      if (r.place && typeof r.duration === 'number') out.push({ lat: r.place.lat, lon: r.place.lon, minutes: r.duration });
    }
    return out;
  }

  async versions(): Promise<DataVersions> {
    return this.o.versions ?? {};
  }
}

/** MOTIS returns at most 256 connections per call; only an answer this long may be cut short. */
const NEAR_RESULT_CAP = 200;

/**
 * MOTIS has three search algorithms that give the same optimal times but pick differently
 * between tied connections. The default one is used for every search; this one for the
 * second look (checked on Lovatens – EPFL: default returns the train, this one the bus).
 */
const TIE_ALGORITHM = 'RAPTOR';

/** Ratio of e-bike to plain bike cruising speed used to scale matrix times. */
const EBIKE_MATRIX_SPEEDUP = 1.35;

function pathLength(g: [number, number][]): number {
  let m = 0;
  for (let i = 1; i < g.length; i++) m += haversineM(g[i - 1]!, g[i]!);
  return m;
}

export function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export { minutesBetween };
