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
interface MotisRental {
  providerId: string;
  systemName?: string;
  /** Empty for a vehicle that stands anywhere (free-floating). */
  fromStationName?: string;
  /** Empty when MOTIS lets the vehicle be left at the door. */
  toStationName?: string;
  formFactor?: string;
  propulsionType?: string;
}
interface MotisRentalStation {
  providerId: string;
  name: string;
  lat: number;
  lon: number;
  formFactors?: string[];
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
  rental?: MotisRental;
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
  /**
   * The server is the fork that understands `allowedSegmentTags` (tools/motis-fork) and was
   * started with a segment file. Off by default: the release MOTIS rejects the parameter.
   */
  segmentFilter?: boolean;
}

const MODE_MAP: Record<string, LegMode> = {
  WALK: 'walk',
  BIKE: 'bike',
  RENTAL: 'sharedBike',
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
/** The station-level MOTIS id of a Swiss stop number ("8504121" → "ch_Parentch:1:sloid:4121"); null for others. */
export function motisStationId(stopNumber: string): string | null {
  const m = /^85(\d{5})$/.exec(stopNumber);
  return m ? `ch_Parentch:1:sloid:${Number(m[1])}` : null;
}

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
  readonly segmentFilter: boolean;
  constructor(private readonly o: MotisOptions) {
    this.f = o.fetch ?? fetch;
    this.segmentFilter = o.segmentFilter === true;
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
    const transit = !['walk', 'bike', 'ebike', 'sharedBike', 'car'].includes(mode);
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
      ...(mode === 'sharedBike' && l.rental
        ? {
            sharedBike: {
              providerId: l.rental.providerId,
              system: l.rental.systemName ?? '',
              fromStation: (l.rental.fromStationName ?? '').trim(),
              toStation: (l.rental.toStationName ?? '').trim(),
              electric: (l.rental.propulsionType ?? 'HUMAN') !== 'HUMAN',
            },
          }
        : {}),
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
    maxWalkToStopMin?: number;
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
        ...(q.maxWalkToStopMin ? { maxPreTransitTime: Math.round(q.maxWalkToStopMin * 60) } : {}),
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

  async lastTrip(q: { from: LatLon; to: LatLon; date: string; time: string; via?: string[]; allowedSegmentTags?: string[] }): Promise<Itinerary | null> {
    const via = (q.via ?? []).map(motisStationId).filter((x): x is string => x !== null).slice(0, 2);
    const tags = this.segmentFilter && q.allowedSegmentTags?.length ? q.allowedSegmentTags : null;
    const by = localToUtc(q.date, q.time, this.o.timezone);
    // Not a timetable view: "arrive by T" alone returns the connections that leave last.
    const res = await this.get<MotisPlanResponse>('/api/v6/plan', {
      fromPlace: place(q.from),
      toPlace: place(q.to),
      time: by.toISOString(),
      arriveBy: true,
      timetableView: false,
      directModes: 'WALK',
      detailedTransfers: false,
      ...(via.length ? { via: via.join(','), viaMinimumStay: via.map(() => 0).join(',') } : {}),
      // With the filter the direct connection no longer cuts the search short: without a limit
      // it goes back days for a trip with fewer changes. Minutes.
      ...(tags ? { allowedSegmentTags: tags.join(','), maxTravelTime: LAST_TRIP_MAX_HOURS * 60 } : {}),
    });
    // With the filter, older trips come back too (one per number of changes): only those of
    // the evening in question count.
    const earliest = tags ? new Date(by.getTime() - LAST_TRIP_MAX_HOURS * 3600_000).toISOString() : '';
    const its = (res.itineraries ?? []).filter(
      (it) => it.legs.some((l) => !['WALK', 'BIKE', 'CAR'].includes(l.mode)) && (!tags || new Date(it.startTime).toISOString() >= earliest),
    );
    if (its.length === 0) return null;
    const last = its.reduce((a, b) => (new Date(b.startTime).getTime() > new Date(a.startTime).getTime() ? b : a));
    return this.toItinerary(last);
  }

  /** Provider ids of the shared-mobility feed loaded in MOTIS; empty without a feed. Asked once every ten minutes. */
  private rentalProviders(): Promise<Set<string>> {
    const now = Date.now();
    if (!this.providers || now - this.providers.at > PROVIDERS_TTL_MS) {
      const url = new URL('/api/v1/rentals', this.o.baseUrl);
      for (const k of ['withStations', 'withVehicles', 'withZones']) url.searchParams.set(k, 'false');
      const ids = this.f(url)
        .then(async (res) => {
          if (!res.ok) return new Set<string>();
          // Not read as JSON: providers without vehicles come with "Infinity" in their bounding box.
          return new Set([...(await res.text()).matchAll(/"id":"([^"]+)","name":"[^"]*","groupId"/g)].map((m) => m[1]!));
        })
        .catch(() => new Set<string>());
      this.providers = { at: now, ids };
    }
    return this.providers.ids;
  }
  private providers?: { at: number; ids: Promise<Set<string>> };
  private readonly stationCache = new Map<string, Promise<MotisRentalStation[]>>();

  /** Bike stations of one provider (or several, comma-separated) in a box of `radiusM` around a point. */
  private stationsNear(p: LatLon, providerId: string, radiusM: number): Promise<MotisRentalStation[]> {
    const key = `${providerId}|${p.lat.toFixed(4)},${p.lon.toFixed(4)}|${radiusM}`;
    let hit = this.stationCache.get(key);
    if (!hit) {
      const dLat = radiusM / 111_000;
      const dLon = dLat / Math.cos((p.lat * Math.PI) / 180);
      hit = this.get<{ stations?: MotisRentalStation[] }>('/api/v1/rentals', {
        min: `${p.lat - dLat},${p.lon - dLon}`,
        max: `${p.lat + dLat},${p.lon + dLon}`,
        providers: providerId,
        withVehicles: false,
        withZones: false,
        withProviders: false,
      })
        .then((r) => (r.stations ?? []).filter((s) => providerId.split(',').includes(s.providerId) && (s.formFactors ?? ['BICYCLE']).includes('BICYCLE')))
        .catch(() => []);
      if (this.stationCache.size > 500) this.stationCache.clear();
      this.stationCache.set(key, hit);
    }
    return hit;
  }

  /**
   * MOTIS lets some bikes of a station-based network be left at the door (the feed marks part
   * of each fleet as free to return anywhere). The operators want them back at a station: the
   * ride then ends at the station nearest to where MOTIS left the bike, and the rest is walked.
   * The ride keeps its time (the station is at most a few hundred metres away), the walk is
   * added: at the end of the trip, or before the departure when the bike is the first leg.
   * Null when no station is within `maxWalkM`.
   */
  private async returnAtStation(it: Itinerary, use: 'whole' | 'lastLeg' | 'firstLeg', maxWalkM: number): Promise<Itinerary | null> {
    const i = it.legs.findIndex((l) => l.mode === 'sharedBike');
    const ride = it.legs[i];
    if (!ride?.sharedBike) return null;
    if (ride.sharedBike.toStation) return it;
    const drop = ride.to;
    const stations = await this.stationsNear(drop, ride.sharedBike.providerId, maxWalkM);
    let best: { s: MotisRentalStation; m: number } | undefined;
    for (const s of stations) {
      const m = haversineM([drop.lon, drop.lat], [s.lon, s.lat]) * WALK_DETOUR;
      if (!best || m < best.m) best = { s, m };
    }
    if (!best || best.m > maxWalkM) return null;
    const walkMin = Math.max(1, Math.round(best.m / WALK_M_PER_MIN));
    const shift = (iso: string, min: number) => new Date(new Date(iso).getTime() + min * 60000).toISOString();
    const station: StopPoint = { name: best.s.name.trim(), lat: best.s.lat, lon: best.s.lon };
    const legs = it.legs.map((l) => ({ ...l }));
    const r = legs[i]!;
    r.sharedBike = { ...ride.sharedBike, toStation: station.name };
    r.to = station;
    const walk = (departure: string): Leg => ({
      mode: 'walk',
      from: station,
      to: drop,
      departure,
      arrival: shift(departure, walkMin),
      durationMin: walkMin,
      distanceM: Math.round(best!.m),
      geometry: [[station.lon, station.lat], [drop.lon, drop.lat]],
    });
    if (use === 'firstLeg') {
      // Leave earlier: the train does not wait.
      for (let k = 0; k <= i; k++) {
        legs[k]!.departure = shift(legs[k]!.departure, -walkMin);
        legs[k]!.arrival = shift(legs[k]!.arrival, -walkMin);
      }
      const next = legs[i + 1];
      if (next && next.mode === 'walk') {
        next.from = station;
        next.departure = r.arrival;
        next.durationMin += walkMin;
        next.distanceM += Math.round(best.m);
      } else {
        legs.splice(i + 1, 0, walk(r.arrival));
      }
      return { ...it, legs, departure: shift(it.departure, -walkMin), durationMin: it.durationMin + walkMin };
    }
    legs.splice(i + 1, 0, walk(r.arrival));
    for (let k = i + 2; k < legs.length; k++) {
      legs[k]!.departure = shift(legs[k]!.departure, walkMin);
      legs[k]!.arrival = shift(legs[k]!.arrival, walkMin);
    }
    return { ...it, legs, arrival: shift(it.arrival, walkMin), durationMin: it.durationMin + walkMin };
  }

  async sharedBike(q: {
    from: LatLon;
    to: LatLon;
    date: string;
    window: TimeWindow;
    use: 'whole' | 'lastLeg' | 'firstLeg';
    providers: string[];
    maxStationWalkM: number;
    maxMin: number;
  }): Promise<Itinerary[]> {
    const loaded = await this.rentalProviders();
    const offered = q.providers.filter((p) => loaded.has(p));
    if (offered.length === 0) return [];
    // A look at the stations first (a millisecond) spares the search wherever no network is
    // near: the bike is returned near the destination (last leg, whole trip) and taken near
    // the origin (first leg, whole trip).
    const around = async (p: LatLon) => new Set((await this.stationsNear(p, offered.join(','), q.maxStationWalkM)).map((s) => s.providerId));
    const [atFrom, atTo] = await Promise.all([q.use === 'lastLeg' ? null : around(q.from), q.use === 'firstLeg' ? null : around(q.to)]);
    const providers = offered.filter((p) => (atFrom?.has(p) ?? true) && (atTo?.has(p) ?? true));
    if (providers.length === 0) return [];
    const { start, end } = windowToUtc(q.date, q.window, this.o.timezone);
    const common = { fromPlace: place(q.from), toPlace: place(q.to), detailedTransfers: false };
    let raw: MotisItinerary[];
    if (q.use === 'whole') {
      // No timetable involved: one search at the start of the window. The time limit leaves
      // room for the walks at both ends.
      const res = await this.get<MotisPlanResponse>('/api/v6/plan', {
        ...common,
        time: start.toISOString(),
        directModes: 'WALK,RENTAL',
        transitModes: '',
        directRentalFormFactors: 'BICYCLE',
        directRentalProviders: providers.join(','),
        maxDirectTime: Math.round((q.maxMin + 10) * 60),
      });
      raw = res.direct ?? [];
    } else {
      const side = q.use === 'lastLeg' ? 'postTransit' : 'preTransit';
      const res = await this.get<MotisPlanResponse>('/api/v6/plan', {
        ...common,
        time: end.toISOString(),
        arriveBy: true,
        searchWindow: Math.round((end.getTime() - start.getTime()) / 1000),
        directModes: 'WALK',
        [`${side}Modes`]: 'WALK,RENTAL',
        [`${side}RentalFormFactors`]: 'BICYCLE',
        [`${side}RentalProviders`]: providers.join(','),
        [q.use === 'lastLeg' ? 'maxPostTransitTime' : 'maxPreTransitTime']: Math.round(q.maxMin * 60),
      });
      raw = (res.itineraries ?? []).filter((it) => {
        const t = new Date(it.endTime).getTime();
        return t >= start.getTime() && t <= end.getTime();
      });
    }
    const isStreet = (l: MotisLeg) => ['WALK', 'BIKE', 'CAR', 'RENTAL'].includes(l.mode);
    const fits = raw.filter((it) => {
      const rides = it.legs.filter((l) => l.mode === 'RENTAL');
      const ride = rides[0];
      // One ride, on a bicycle taken at a station (a bike standing anywhere may not be there tomorrow).
      if (rides.length !== 1 || !ride?.rental || !ride.rental.fromStationName?.trim() || (ride.rental.formFactor ?? 'BICYCLE') !== 'BICYCLE') return false;
      const at = it.legs.indexOf(ride);
      const firstTransit = it.legs.findIndex((l) => !isStreet(l));
      if (q.use === 'whole') return firstTransit < 0;
      if (firstTransit < 0) return false;
      const lastTransit = it.legs.length - 1 - [...it.legs].reverse().findIndex((l) => !isStreet(l));
      return q.use === 'lastLeg' ? at > lastTransit : at < firstTransit;
    });
    const settled = await Promise.all(fits.map((it) => this.returnAtStation(this.toItinerary(it), q.use, q.maxStationWalkM)));
    return settled.filter((it): it is Itinerary => it !== null).sort((a, b) => a.arrival.localeCompare(b.arrival));
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

/** With a segment filter, the last trip may not leave more than this long before the arrive-by time. */
const LAST_TRIP_MAX_HOURS = 12;

/** MOTIS returns at most 256 connections per call; only an answer this long may be cut short. */
const NEAR_RESULT_CAP = 200;

/**
 * MOTIS has three search algorithms that give the same optimal times but pick differently
 * between tied connections. The default one is used for every search; this one for the
 * second look (checked on Lovatens – EPFL: default returns the train, this one the bus).
 */
const TIE_ALGORITHM = 'RAPTOR';

/** How long the list of shared-mobility providers is kept. */
const PROVIDERS_TTL_MS = 10 * 60_000;
/** From a straight line to a walk along streets, and the walking pace, metres per minute. */
const WALK_DETOUR = 1.3;
const WALK_M_PER_MIN = 75;

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
