import type {
  AccessSite,
  CarAssumptions,
  CommuteOption,
  CommuteRequest,
  CompareResult,
  CostComponent,
  FlexibleWork,
  FlexibleWorkRow,
  Itinerary,
  LatLon,
  Leg,
  LegMode,
  OptionCost,
  OptionKind,
  PricedProduct,
  ReachableStop,
  StopPoint,
  Provenance,
  RoutingProvider,
  RuleSet,
  StreetProfile,
  StreetRoute,
  TimeWindow,
  Traveller,
  WalkableStop,
} from '../types.js';
import { TRANSIT_MODES } from '../types.js';
import { resolveRules, tripsPerYear, workingDaysPerYear } from '../rules.js';
import { localHHMM } from '../time.js';
import { segmentTagsOfZones } from '../fares/segmentTags.js';
import { passCategory, type PassCategory } from '../fares/networks.js';
import { groupItineraries, type RouteGroup } from './group.js';
import { prune, type Conn } from './prune.js';
import { verdict } from './verdict.js';
import type { BikeShareOperator } from '../sharing/bikeShare.js';
import { pickSharedBike, sharedBikeCandidate, sharedBikeSuggestion, type SharedBikeCandidate } from './sharedBike.js';

export interface FareContext {
  traveller: Traveller;
  tripsPerYear: number;
  workingDaysPerYear: number;
  /** Weeks per year with commuting. */
  weeksWorked: number;
  rules: RuleSet;
}

/** A place to leave a car or bike before boarding. Prices in CHF, null when unknown. */
export interface AccessCandidate extends AccessSite {
  prices: { day: number | null; month: number | null; year: number | null };
  /** City P+R: the pass includes public transport in these Mobilis zones. */
  includesTransit?: { day: boolean; month: boolean; zones: number[] };
  free?: boolean;
  priceSource?: string;
}

export interface EngineDeps {
  routing: RoutingProvider;
  rules: RuleSet;
  /** Ticket products for the public transport legs of one trip, cheapest first. */
  priceTransit: (legs: Leg[], ctx: FareContext) => PricedProduct[];
  /**
   * Called once with the public transport legs of every option before pricing, so that an
   * implementation can fetch quoted prices (it must come back quickly and never throw away
   * the table prices: `priceTransit` stays the fallback).
   */
  prepareFares?: (trips: Leg[][], ctx: FareContext) => Promise<void>;
  /** True when all legs lie inside the given Mobilis zones (for passes that include transit). */
  coveredByZones?: (legs: Leg[], zones: number[]) => boolean;
  /** kg CO₂-eq per year for the given kilometres per one-way trip. */
  co2KgPerYear: (legs: Leg[], trips: number) => number;
  /**
   * Minutes to find a parking space and walk to the door at a place, from how dense the area
   * is. Without it, the car is given five minutes.
   */
  parkingAt?: (p: LatLon) => { minutes: number; kind: 'cityCentre' | 'townCentre' | 'elsewhere'; residents: number; jobs: number | null };
  /** Rush-hour factor for a drive along the given [lon, lat] points, from how built-up it is. */
  trafficFactor?: (route: [number, number][]) => number;
  parkRail: AccessCandidate[];
  bikeParking: AccessCandidate[];
  cityParkRide: AccessCandidate[];
  /**
   * The sets of fare zones worth a timetable search of their own, given the public transport
   * legs of the connections a search without restriction found: zone paths between the two ends
   * that need fewer or other zones (fares/zonePaths.ts). Used only with a routing engine that
   * can restrict a search (`segmentFilter`); without it nothing changes.
   */
  zoneSearches?: (trips: Leg[][], opts: ZoneSearchRequest) => ZoneSearchSet[];
  /** Station-based bike-share operators and their prices; without it no shared bike is suggested. */
  bikeShare?: BikeShareOperator[];
  tariffVersion?: string;
  parkingVersion?: string;
  now?: () => Date;
}

/** What the planner tells `EngineDeps.zoneSearches` besides the connections found (see fares/zonePaths.ts, `ZoneSearchOptions`). */
export interface ZoneSearchRequest {
  max: number;
  extra: number;
  /** Stops within walking reach of the origin and of the destination (stop ids). */
  fromStops?: string[];
  toStops?: string[];
  /** Least yearly saving on the dearest pass found for a set to be searched, CHF. */
  minSavingChf?: number;
  pass?: { category: PassCategory; travelClass: 1 | 2 };
}

/** A set of fare zones to restrict a search to; `cheaper` when it counts fewer zones than every connection already found. */
export interface ZoneSearchSet {
  alliance: string;
  zones: number[];
  tags: string[];
  cheaper?: boolean;
  /** True when a vehicle may run from stop `a` to the next stop `b` inside the set (see `insideSet`). */
  allows?: (a: string, b: string) => boolean;
}

/** Longest public transport time considered from an access station to work, minutes. */
const REACH_MAX_MIN = 120;
/** A station is searched when its estimate is within this many minutes of public transport from home. */
const REACH_MARGIN_MIN = 20;

/** Minutes a car or bike access must save on public transport from home to be shown. */
const ACCESS_MIN_SAVING = 5;

/** Tickets valid on every line inside their zones: the way home need not be the way there. */
const ZONE_PASSES: ReadonlySet<string> = new Set(['zonePassYearly', 'zonePassMonthly', 'zonePassAllYearly', 'flexiPass']);

const isTransit = (l: Leg) => (TRANSIT_MODES as readonly string[]).includes(l.mode);

function nextDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function haversineKm(a: LatLon, b: LatLon): number {
  const R = 6371.0088;
  const r = (d: number) => (d * Math.PI) / 180;
  const s =
    Math.sin(r(b.lat - a.lat) / 2) ** 2 +
    Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function kmByMode(legs: Leg[]): Partial<Record<LegMode, number>> {
  const out: Partial<Record<LegMode, number>> = {};
  for (const l of legs) out[l.mode] = (out[l.mode] ?? 0) + l.distanceM / 1000;
  for (const k of Object.keys(out) as LegMode[]) out[k] = Math.round(out[k]! * 10) / 10;
  return out;
}

const worst = (ps: Provenance[]): Provenance =>
  ps.length === 0 || ps.includes('estimated') ? 'estimated' : ps.includes('tariff') ? 'tariff' : 'quoted';

function buildCost(products: PricedProduct[], extras: CostComponent[]): OptionCost {
  const sorted = [...products].sort((a, b) => a.yearly - b.yearly);
  const ticket = sorted[0];
  const yearly = (ticket?.yearly ?? 0) + extras.reduce((s, e) => s + e.yearly, 0);
  return {
    yearly: Math.round(yearly),
    products: sorted,
    extras,
    provenance: worst([...(ticket ? [ticket.provenance] : []), ...extras.map((e) => e.provenance)]),
  };
}

/** Cheapest of day × working days, month × 12 and year. */
export function parkingPerYear(
  site: AccessCandidate,
  workingDays: number,
): { yearly: number; basis: 'day' | 'month' | 'year' | 'free' } | null {
  if (site.free) return { yearly: 0, basis: 'free' };
  const c: { yearly: number; basis: 'day' | 'month' | 'year' }[] = [];
  if (site.prices.day != null) c.push({ yearly: site.prices.day * workingDays, basis: 'day' });
  if (site.prices.month != null) c.push({ yearly: site.prices.month * 12, basis: 'month' });
  if (site.prices.year != null) c.push({ yearly: site.prices.year, basis: 'year' });
  c.sort((a, b) => a.yearly - b.yearly);
  return c[0] ?? null;
}

function streetLeg(mode: LegMode, from: LatLon & { name: string }, to: LatLon & { name: string }, r: StreetRoute, arrival: Date, extraMin = 0): Leg {
  const dur = r.durationMin + extraMin;
  const dep = new Date(arrival.getTime() - dur * 60000);
  return {
    mode,
    from: { name: from.name, lat: from.lat, lon: from.lon },
    to: { name: to.name, lat: to.lat, lon: to.lon },
    departure: dep.toISOString(),
    arrival: arrival.toISOString(),
    durationMin: Math.round(dur),
    distanceM: Math.round(r.distanceM),
    geometry: r.geometry,
  };
}

/** The vehicles of a connection: timetable run where known, else line and arrival at its last stop. */
/** Where a trip boards and alights, vehicle by vehicle: two trips with the same answer follow the same path. */
const pathOf = (it: Itinerary) => it.legs.filter((l) => l.line).map((l) => `${l.from.stopId ?? l.from.name}>${l.to.stopId ?? l.to.name}`).join('|');

/**
 * The legs of one departure for the list: times, lines and stops. The drawn path is kept only
 * when the trip goes another way than the typical one of its route (whose path is already sent).
 */
function connectionLegs(it: Itinerary, typical: Itinerary): Leg[] {
  const samePath = pathOf(it) === pathOf(typical);
  return it.legs.map(({ geometry, intermediateStops, ...l }) => (samePath ? l : { ...l, ...(geometry ? { geometry } : {}), ...(intermediateStops ? { intermediateStops } : {}) }));
}

const vehiclesOf = (it: Itinerary) =>
  it.legs.filter(isTransit).map((l) => l.tripId ?? `${l.line?.name}|${l.arrival}|${l.to.stopId ?? l.to.name}`);
/** The vehicle one spends the longest in. */
function mainVehicle(it: Itinerary): string | undefined {
  const legs = it.legs.filter(isTransit);
  if (legs.length === 0) return undefined;
  const main = legs.reduce((a, b) => (b.durationMin > a.durationMin ? b : a));
  return main.tripId ?? `${main.line?.name}|${main.arrival}|${main.to.stopId ?? main.to.name}`;
}
const ms = (iso: string) => new Date(iso).getTime();

/** Arrival times at which the time from every stop is asked: every quarter of the window. */
function reachTimes(w: TimeWindow): string[] {
  const min = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const from = min(w.from);
  const span = (min(w.to) - from + 1440) % 1440;
  const hhmm = (m: number) => `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return [...new Set([1, 0.75, 0.5, 0.25].map((share) => hhmm(from + Math.round(span * share))))];
}

/** The shortest time per stop over several answers; null when none came back. */
function mergeReach(answers: (ReachableStop[] | null)[]): ReachableStop[] | null {
  const ok = answers.filter((a): a is ReachableStop[] => a !== null);
  if (ok.length === 0) return null;
  const best = new Map<string, ReachableStop>();
  for (const a of ok) {
    for (const r of a) {
      const key = `${r.lat},${r.lon}`;
      const prev = best.get(key);
      if (!prev || r.minutes < prev.minutes) best.set(key, r);
    }
  }
  return [...best.values()];
}

/**
 * A connection found inside a zone set, made to lie inside it, or null when it cannot.
 *
 * The routing engine checks every section a vehicle crosses, except that it may place the
 * boarding at an earlier stop of the same vehicle than the search used, when the traveller can
 * reach that stop too (measured: Echandens → Lausanne inside zones 11 and 12 came back boarding
 * at Echandens, Chocolatière, in zone 33, one stop before Ecublens, Larges Pièces). Such a
 * connection is priced with the extra zone and the cheaper pass is lost. Here every section is
 * checked again (`allows`); a first ride that starts outside the set is boarded at its first
 * stop inside it, a last ride that ends outside is left at its last stop inside, when that stop
 * is within walking reach (`walkFrom`, `walkTo`: the walk replaces the one in the answer).
 * Anything else outside the set drops the connection.
 */
export function insideSet(it: Itinerary, set: ZoneSearchSet, walkFrom: WalkableStop[], walkTo: WalkableStop[]): Itinerary | null {
  if (!set.allows) return it;
  const rides = it.legs.map((l, i) => ({ l, i })).filter((x) => isTransit(x.l));
  if (rides.length === 0) return it;
  const stopsOf = (l: Leg) => [l.from, ...(l.intermediateStops ?? []), l.to];
  /** For each ride: which of its sections are allowed. */
  const ok = rides.map(({ l }) => {
    const seq = stopsOf(l);
    return seq.slice(1).map((b, k) => !!seq[k]!.stopId && !!b.stopId && set.allows!(seq[k]!.stopId!, b.stopId!));
  });
  if (ok.every((sections) => sections.every(Boolean))) return it;
  // Sections outside the set at the start of the first ride and at the end of the last one.
  const first = ok[0]!;
  const last = ok[ok.length - 1]!;
  const lead = first.findIndex(Boolean);
  const trail = last.length - 1 - last.lastIndexOf(true);
  if (lead < 0 || trail >= last.length) return null;
  // Everything between has to be inside.
  const between = ok.flatMap((sections, r) => sections.slice(r === 0 ? lead : 0, r === ok.length - 1 ? sections.length - trail : undefined));
  if (!between.every(Boolean)) return null;
  const legs = [...it.legs];
  let { departure, arrival } = it;
  const bare = ({ arrival: _a, departure: _d, ...stop }: StopPoint): StopPoint => stop;
  // Leave the last ride earlier (done first: the indices of the legs before it stay).
  if (trail > 0) {
    const { l, i } = rides[rides.length - 1]!;
    const to = last.length - trail;
    const at = stopsOf(l)[to]!;
    const walk = walkTo.find((w) => w.stopId === at.stopId);
    // Only when the ride is the one that ends the trip on foot.
    if (!at.arrival || !walk || legs.slice(i + 1).some(isTransit)) return null;
    const ride: Leg = { ...l, to: bare(at), arrival: at.arrival, durationMin: Math.round((ms(at.arrival) - ms(l.departure)) / 60000), distanceM: Math.round((l.distanceM * to) / last.length), intermediateStops: (l.intermediateStops ?? []).slice(0, to - 1), geometry: undefined };
    arrival = new Date(ms(at.arrival) + walk.walkMin * 60000).toISOString();
    const onFoot: Leg = { mode: 'walk', from: bare(at), to: legs[legs.length - 1]!.to, departure: at.arrival, arrival, durationMin: Math.round(walk.walkMin), distanceM: Math.round(walk.walkMin * 75) };
    legs.splice(i, legs.length - i, ride, onFoot);
  }
  // Board the first ride later.
  if (lead > 0) {
    const i = rides[0]!.i;
    const l = legs[i]!;
    const seq = stopsOf(it.legs[i]!);
    const at = seq[lead]!;
    const walk = walkFrom.find((w) => w.stopId === at.stopId);
    // Only when the ride is reached on foot from the origin.
    if (!at.departure || !walk || legs.slice(0, i).some(isTransit)) return null;
    const ride: Leg = { ...l, from: bare(at), departure: at.departure, durationMin: Math.round((ms(l.arrival) - ms(at.departure)) / 60000), distanceM: Math.round((l.distanceM * (first.length - lead - (rides.length === 1 ? trail : 0))) / (first.length - (rides.length === 1 ? trail : 0))), intermediateStops: (l.intermediateStops ?? []).slice(lead), geometry: undefined };
    departure = new Date(ms(at.departure) - walk.walkMin * 60000).toISOString();
    const onFoot: Leg = { mode: 'walk', from: legs[0]!.from, to: bare(at), departure, arrival: at.departure, durationMin: Math.round(walk.walkMin), distanceM: Math.round(walk.walkMin * 75) };
    legs.splice(0, i + 1, onFoot, ride);
  }
  return { ...it, departure, arrival, durationMin: Math.round((ms(arrival) - ms(departure)) / 60000), legs };
}

interface Draft {
  conns?: Conn[];
  fareKey?: string;
  kind: OptionKind;
  title: string;
  itinerary: Itinerary;
  durationMin: number;
  changes: number;
  group?: RouteGroup;
  access?: AccessCandidate;
  accessRoute?: StreetRoute;
}

export async function compare(req: CommuteRequest, deps: EngineDeps): Promise<CompareResult> {
  const rules = resolveRules(deps.rules, req.rules);
  const date = req.date ?? rules.referenceDate;
  const trips = tripsPerYear(req.pattern, rules);
  const days = workingDaysPerYear(req.pattern, rules);
  const ctx: FareContext = {
    traveller: req.traveller,
    tripsPerYear: trips,
    workingDaysPerYear: days,
    weeksWorked: Math.max(0, rules.weeksPerYear - req.pattern.weeksOff),
    rules,
  };
  const want = (k: OptionKind) => !req.kinds || req.kinds.includes(k);
  const { routing } = deps;
  const home = { ...req.home, name: req.home.label };
  const work = { ...req.work, name: req.work.label };
  const tz = rules.timezone;

  // The street network gives the time on empty roads, door to door with a space at the door.
  // Two assumptions make the car comparable: a rush-hour factor, and time to park and walk.
  const density = rules.carParkingMin === null ? deps.parkingAt?.(req.work) : undefined;
  const peakAuto = rules.carPeakByDensity && !!deps.trafficFactor;
  /** Without the route's shape (times from a matrix), the straight line stands in for it. */
  const peakOf = (r: StreetRoute, to: LatLon): number =>
    peakAuto ? deps.trafficFactor!(r.geometry && r.geometry.length > 1 ? r.geometry : [[req.home.lon, req.home.lat], [to.lon, to.lat]]) : rules.carPeakFactor;
  const carAssumptions: CarAssumptions = {
    peakFactor: rules.carPeakFactor,
    peakAuto,
    parkingMin: rules.carParkingMin ?? density?.minutes ?? 5,
    parkingAuto: rules.carParkingMin === null,
    parkingKind: density?.kind,
    residents1km: density?.residents,
    jobs1km: density?.jobs,
  };

  // Which connections need the same ticket. Zone tickets: same products at the same prices.
  // Tickets priced by distance: same first and last stop (two trains between the same stations
  // must not become two options because their estimated distances differ by a kilometre).
  const priceCache = new Map<string, PricedProduct[]>();
  const priceLegs = (legs: Leg[]): PricedProduct[] => {
    const key = legs.map((l) => [l.mode, l.from.stopId ?? l.from.name, ...(l.intermediateStops ?? []).map((x) => x.stopId ?? x.name), l.to.stopId ?? l.to.name].join('>')).join('|');
    let hit = priceCache.get(key);
    if (!hit) priceCache.set(key, (hit = deps.priceTransit(legs, ctx)));
    return hit;
  };
  const fareKey = (it: Itinerary): string => {
    const legs = it.legs.filter(isTransit);
    const cheapest = priceLegs(legs)[0];
    if (!cheapest) return 'none';
    if (cheapest.components.some((c) => c.key.startsWith('national.'))) {
      return `route:${legs[0]!.from.stopId ?? legs[0]!.from.name}>${legs[legs.length - 1]!.to.stopId ?? legs[legs.length - 1]!.to.name}`;
    }
    // The network is part of the ticket: two networks can sell as many zones at the same price.
    // So are the zones: two passes of seven zones are two tickets when the zones differ. Not at
    // the price of the whole network, which is one ticket whatever the trip uses.
    const where = cheapest.allZones ? '@all' : cheapest.zones?.length ? `@${cheapest.zones.join('+')}` : '';
    return `${cheapest.kind}${where}:${cheapest.components.map((c) => `${c.key}:${c.params?.network ? `${c.params.network}:` : ''}${cheapest.allZones ? '' : (c.params?.zones ?? '')}:${c.yearly}`).join(',')}`;
  };

  const safe = <T,>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);
  /** The routing engine names free coordinates START and END: use the places' own labels. */
  const relabel = (its: Itinerary[], fromName: string | undefined, toName: string | undefined) => {
    for (const it of its) {
      const first = it.legs[0];
      const last = it.legs[it.legs.length - 1];
      if (first && fromName && !first.from.stopId) first.from.name = fromName;
      if (last && toName && !last.to.stopId) last.to.name = toName;
    }
    return its;
  };
  const transitTo = (from: LatLon & { name?: string }, window: TimeWindow = req.arrival, alternateTies = false, within?: { tags: string[]; maxTravelMin: number }) =>
    safe(
      routing
        .transit({
          from,
          to: req.work,
          date,
          window,
          by: 'arrive',
          alternateTies,
          maxWalkToStopMin: from === home ? rules.walkToStopMaxMin : undefined,
          ...(within ? { allowedSegmentTags: within.tags, maxTravelMin: within.maxTravelMin } : {}),
        })
        .then((its) => relabel(its, from.name, work.name)),
      [] as Itinerary[],
    );
  /**
   * The search returns the connections that nothing beats on departure, arrival and changes. A
   * slower one inside fewer fare zones (a cheaper pass) is therefore often missing. Where the
   * routing engine can restrict a search to a list of zones, the zone sets that may hold such
   * connections are searched too, one call each, all at once: `found` is the answer without
   * restriction, from which the two ends and the zones already seen are read. Each call asks
   * for the same window. Inside a few zones the best connection can be a very bad one (two
   * hours through four villages against one hour by train): only those taking at most half as
   * long again as the fastest found, plus a quarter of an hour, are kept.
   */
  const zoneSearchOn = routing.segmentFilter === true && !!deps.zoneSearches && rules.zoneSearches > 0;
  /**
   * The stops within a walk of each end, asked beside the first searches. The search without
   * restriction boards where it is fastest; a stop a few minutes further, in another zone, can
   * make a pass with fewer zones possible (a home between two zones). Their zones are added to
   * the ends of the zone paths; a stop in a zone already there changes nothing.
   */
  const stopsNear = (at: LatLon, direction: 'from' | 'to'): Promise<WalkableStop[]> =>
    zoneSearchOn && routing.stopsWithinWalk && rules.zoneSearchWalkMin > 0
      ? safe(routing.stopsWithinWalk({ at, maxMin: rules.zoneSearchWalkMin, direction }), [] as WalkableStop[])
      : Promise.resolve([] as WalkableStop[]);
  const nearHome = stopsNear(req.home, 'from');
  const nearWork = stopsNear(req.work, 'to');
  const noStops = Promise.resolve([] as WalkableStop[]);
  const yearlyOf = (it: Itinerary): number | undefined => priceLegs(it.legs.filter(isTransit))[0]?.yearly;
  const withinZones = async (from: LatLon & { name?: string }, found: Itinerary[], max: number, cheaperOnly = false, fromStops?: Promise<WalkableStop[]>): Promise<Itinerary[]> => {
    if (!zoneSearchOn || found.length === 0 || max <= 0) return [];
    let sets: ZoneSearchSet[] = [];
    // From a car park the stops around are not asked for: the ends are those of its connections.
    const [walkFrom, walkTo] = await Promise.all([fromStops ?? noStops, nearWork]);
    try {
      sets = deps.zoneSearches!(found.map((it) => it.legs.filter(isTransit)), {
        max,
        extra: rules.zoneSearchExtraZones,
        fromStops: fromStops ? walkFrom.map((x) => x.stopId) : undefined,
        toStops: walkTo.map((x) => x.stopId),
        minSavingChf: rules.zoneSearchMinSavingChf,
        pass: { category: passCategory(req.traveller.ageGroup), travelClass: req.traveller.travelClass },
      });
    } catch {
      return [];
    }
    if (cheaperOnly) sets = sets.filter((z) => z.cheaper);
    if (sets.length === 0) return [];
    const fastest = Math.min(...found.map((it) => it.durationMin));
    const maxTravelMin = Math.round(fastest * rules.zoneSearchMaxSlower + rules.zoneSearchMaxExtraMin);
    // What a slower connection on another ticket has to be worth: against the cheapest ticket
    // found (its fastest connection), every hour more over a year has to save
    // `zoneSearchMinChfPerHour`, unless it is only a few minutes slower.
    const priced = found.map((it) => ({ min: it.durationMin, yearly: yearlyOf(it) })).filter((x): x is { min: number; yearly: number } => x.yearly !== undefined);
    const ref = priced.length ? priced.reduce((a, b) => (b.yearly < a.yearly || (b.yearly === a.yearly && b.min < a.min) ? b : a)) : undefined;
    const known = new Set(found.map(fareKey));
    const worth = (it: Itinerary): boolean => {
      if (it.durationMin > maxTravelMin) return false;
      // Another departure of a ticket already found: its holder has no faster one at that time.
      if (known.has(fareKey(it))) return true;
      const extraMin = it.durationMin - (ref?.min ?? fastest);
      if (extraMin <= rules.zoneSearchFreeExtraMin || !ref) return true;
      const yearly = yearlyOf(it);
      if (yearly === undefined) return true;
      return ref.yearly - yearly >= ((extraMin * trips) / 60) * rules.zoneSearchMinChfPerHour;
    };
    const raw = await Promise.all(sets.slice(0, max).map((z) => transitTo(from, req.arrival, false, { tags: z.tags, maxTravelMin })));
    const answers = raw.map((its, i) => its.map((it) => insideSet(it, sets[i]!, walkFrom, walkTo)).filter((it): it is Itinerary => it !== null && worth(it)));
    if (typeof process !== 'undefined' && process.env?.PENDULAR_DEBUG) {
      sets.slice(0, max).forEach((z, i) =>
        console.log('zone search', from.name, z.alliance, z.zones.join(','), '=>', raw[i]!.map((it) => `${localHHMM(it.departure, tz)}-${localHHMM(it.arrival, tz)} ${it.durationMin}′ CHF ${yearlyOf(it)}${answers[i]!.some((x) => x.arrival === it.arrival && vehiclesOf(x).join() === vehiclesOf(it).join()) ? (answers[i]!.includes(it) ? '' : ' (boards or alights elsewhere)') : ' (dropped)'}`).join(' | ') || 'nothing', `[limit ${maxTravelMin}′, reference ${ref?.min}′ CHF ${ref?.yearly}]`),
      );
    }
    return answers.flat();
  };
  /**
   * The same vehicle reached another way is not another connection. Among connections on the
   * same ticket that are the same from their main vehicle on (the one the traveller sits longest
   * in, then whatever follows it), one with more changes before it (a feeder bus to the station
   * instead of the walk) is kept only when it leaves home `sameVehicleMinSaving` minutes later.
   * Otherwise it would be listed as a route of its own, and as the fastest one, for a few
   * minutes that cost a change (Aigle → Lausanne: the IR 95 with bus 101, four minutes later).
   * From home only: from a car park the departures are judged one by one against those from
   * home (step 3). What differs after the main vehicle (a metro for the last stop) is left to
   * the pruning: that is a faster way to arrive, at every departure.
   */
  const sameVehicleOnce = (its: Itinerary[]): Itinerary[] => {
    const info = its.map((it) => {
      const vehicles = vehiclesOf(it);
      const at = vehicles.indexOf(mainVehicle(it) ?? '');
      return { it, feeders: at, onward: at < 0 ? '' : vehicles.slice(at).join('>'), key: fareKey(it), dep: ms(it.departure), arr: ms(it.arrival) };
    });
    const least = rules.sameVehicleMinSaving * 60000;
    return info
      .filter((a) => !info.some((b) => b !== a && a.feeders > 0 && b.feeders >= 0 && b.feeders < a.feeders && b.onward === a.onward && b.key === a.key && b.arr <= a.arr && a.dep - b.dep < least))
      .map((x) => x.it);
  };
  /** Several answers as one list: the same vehicles at the same times once. */
  const merged = (...lists: Itinerary[][]): Itinerary[] => {
    const seen = new Set<string>();
    return lists.flat().filter((it) => {
      const key = `${it.departure}|${it.arrival}|${vehiclesOf(it).join('>')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  /**
   * From home the search runs twice, the second time resolving ties the other way: two routes
   * with the same times and changes can differ in price, and only one of them comes back per call.
   */
  const transitFromHome = async () => {
    const [first, second] = await Promise.all([transitTo(home), transitTo(home, req.arrival, true)]);
    return [...first, ...second];
  };
  const street = (profile: StreetProfile) => safe(routing.street({ from: req.home, to: req.work, profile }), null);

  // --- 1. Everything that does not depend on anything else, in parallel -----------------------
  const near = (sites: AccessCandidate[], km: number) =>
    sites.filter((s) => haversineKm(req.home, s) <= km && haversineKm(req.work, s) >= rules.accessMinKmFromWork);
  // A car park is offered only with a known price above zero: a price of CHF 0 in the source
  // is far more often a gap than a free car park.
  const priced = (s: AccessCandidate) => (parkingPerYear(s, days)?.yearly ?? 0) > 0;
  const prCand = want('parkRail')
    ? near(deps.parkRail, rules.parkRailMaxDriveMin * 1.1).filter((s) => priced(s) && haversineKm(req.home, s) >= rules.accessMinKmFromHome)
    : [];
  const brCand = want('bikeRide') ? near(deps.bikeParking, rules.bikeRideMaxMin * 0.4) : [];
  const cityCand = want('cityParkRide')
    ? deps.cityParkRide.filter((s) => priced(s) && haversineKm(req.work, s) <= 8 && haversineKm(req.work, s) >= rules.accessMinKmFromWork)
    : [];

  // No street search for a ride or walk that cannot fit its time limit even in a straight line
  // at a good pace (km/h): those searches are the slowest of all.
  const crow = haversineKm(req.home, req.work);
  const tooFar = {
    walk: crow > (rules.walkAllWayMaxMin / 60) * 6,
    bike: crow > (rules.bikeAllWayMaxMin / 60) * 25,
    ebike: crow > (rules.ebikeAllWayMaxMin / 60) * 30,
  };
  // The last trip home is searched once per place the traveller returns to. The search to the
  // home itself is needed whenever public transport is in play: start it with the first round.
  const [hh] = rules.lastTripHomeBy.split(':').map(Number) as [number];
  const lastBy = { date: hh < 12 ? nextDay(date) : date, time: rules.lastTripHomeBy };
  const returnCache = new Map<string, Promise<Itinerary | null>>();
  const returnTo = (target: LatLon, via: string[] = [], tags: string[] = []) => {
    const key = `${target.lat},${target.lon}|${via.join('>')}|${tags.join(',')}`;
    if (!returnCache.has(key)) {
      const q = { from: req.work, to: target, ...lastBy, ...(tags.length ? { allowedSegmentTags: tags } : { via }) };
      returnCache.set(key, routing.lastTrip ? safe(routing.lastTrip(q), null) : Promise.resolve(null));
    }
    return returnCache.get(key)!;
  };
  // Shared bikes: three searches (the whole trip, the last leg, the first leg) that run beside
  // everything else and are read once the options are known.
  const bikeProviders = (deps.bikeShare ?? []).flatMap((o) => o.providers);
  const sharedBikeOn = rules.sharedBike && !!routing.sharedBike && bikeProviders.length > 0 && (want('transit') || want('bike'));
  const sharedSearch = (use: SharedBikeCandidate['kind']) =>
    safe(
      routing.sharedBike!({
        from: req.home,
        to: req.work,
        date,
        window: req.arrival,
        use,
        providers: bikeProviders,
        maxStationWalkM: rules.sharedBikeStationMaxWalkM,
        maxMin: use === 'whole' ? rules.sharedBikeMaxRideMin : rules.sharedBikeLegMaxMin,
      }).then((its) => relabel(its, home.name, work.name)),
      [] as Itinerary[],
    );
  const sharedBikeTrips: Promise<SharedBikeCandidate[]> = sharedBikeOn
    ? Promise.all([
        // No ride of half an hour fits a straight line longer than this.
        crow <= (rules.sharedBikeMaxRideMin / 60) * 25 ? sharedSearch('whole') : Promise.resolve([] as Itinerary[]),
        want('transit') ? sharedSearch('lastLeg') : Promise.resolve([] as Itinerary[]),
        want('transit') ? sharedSearch('firstLeg') : Promise.resolve([] as Itinerary[]),
      ]).then(([whole, last, first]) =>
        [sharedBikeCandidate('whole', whole, rules), sharedBikeCandidate('lastLeg', last, rules), sharedBikeCandidate('firstLeg', first, rules)].filter(
          (c): c is SharedBikeCandidate => c !== undefined,
        ),
      )
    : Promise.resolve([]);
  const anyAccess = prCand.length + brCand.length + cityCand.length > 0;
  const [direct, car, bike, ebike, walk, prDrive, cityDrive, brRide, reach] = await Promise.all([
    want('transit') || prCand.length || brCand.length ? transitFromHome() : Promise.resolve([] as Itinerary[]),
    street('car'),
    want('bike') && !tooFar.bike ? street('bike') : Promise.resolve(null),
    want('ebike') && !tooFar.ebike ? street('ebike') : Promise.resolve(null),
    want('walk') && !tooFar.walk ? street('walk') : Promise.resolve(null),
    safe(routing.streetMatrix({ points: prCand, anchor: req.home, profile: 'car', direction: 'fromAnchor', maxMin: rules.parkRailMaxDriveMin }), prCand.map(() => null)),
    // A handful of sites far from home: one route each costs less than a matrix, which explores
    // every road within its time limit.
    Promise.all(cityCand.map((site) => safe(routing.street({ from: req.home, to: site, profile: 'car' }), null))),
    safe(routing.streetMatrix({ points: brCand, anchor: req.home, profile: 'ebike', direction: 'fromAnchor', maxMin: rules.bikeRideMaxMin }), brCand.map(() => null)),
    // Public transport time from every stop to work, in one call: it tells which stations are
    // worth a full search.
    // Asked for several arrival times across the window, keeping the best per stop: measured
    // against the end of the window alone, a fast train that arrives early in it looks half an
    // hour slower than it is, and its station loses its place to slower ones.
    anyAccess && routing.reachability
      ? Promise.all(reachTimes(req.arrival).map((time) => safe(routing.reachability!({ to: req.work, date, time, maxMin: REACH_MAX_MIN }), null as ReachableStop[] | null))).then(mergeReach)
      : Promise.resolve(null as ReachableStop[] | null),
  ]);

  /** Minutes by public transport from a site to work: its nearest reachable stop, plus the walk to it. */
  const onward = (site: LatLon): number | null => {
    if (!reach) return null;
    let best: number | null = null;
    for (const r of reach) {
      if (Math.abs(r.lat - site.lat) > 0.006 || Math.abs(r.lon - site.lon) > 0.009) continue;
      const walkMin = (haversineKm(site, r) * 1000) / 75;
      if (walkMin > 8) continue;
      if (best === null || r.minutes + walkMin < best) best = r.minutes + walkMin;
    }
    return best;
  };

  const leftOut: CompareResult['leftOut'] = [];
  for (const kind of ['walk', 'bike', 'ebike'] as const) {
    if (want(kind) && tooFar[kind]) leftOut.push({ kind, title: kind, code: 'tooLong' });
  }

  // --- 2. Public transport door to door -----------------------------------------------------
  // A connection taking more than twice the fastest (plus half an hour) is not an alternative.
  // The two calls from home mostly return the same connections: each once.
  const withTransit = merged(direct).filter((it) => it.legs.some(isTransit));
  const quickest = Math.min(...withTransit.map((it) => it.durationMin));
  const toConn = (it: Itinerary, leadMs = 0): Conn => ({
    dep: ms(it.departure) - leadMs,
    arr: ms(it.arrival),
    min: Math.round((ms(it.arrival) - ms(it.departure) + leadMs) / 60000),
    changes: it.changes,
    vehicles: vehiclesOf(it),
    it,
  });
  // The searches inside zone sets start now and run beside those from the car parks (step 3),
  // which wait for them only to know every connection from home.
  const homeTransit = withinZones(home, withTransit, rules.zoneSearches, false, nearHome).then((more) => {
    const usable = sameVehicleOnce(merged(withTransit, more.filter((it) => it.legs.some(isTransit))).filter((it) => it.durationMin <= quickest * 2 + 30));
    const drafts: Draft[] = [];
    if (want('transit')) {
      for (const g of groupItineraries(usable, fareKey)) {
        drafts.push({ kind: 'transit', title: g.title, itinerary: g.typical, durationMin: g.typicalMin, changes: g.changes, group: g, conns: g.itineraries.map((it) => toConn(it)), fareKey: fareKey(g.typical) });
      }
    }
    /** `fromHome`: every connection from home, to recognise a drive to a train one could have walked to. */
    return { drafts, fromHome: usable.map((it) => toConn(it)) };
  });

  // --- 3. Access options: drive or ride to a station, then public transport -------------------
  async function accessOptions(
    kind: 'parkRail' | 'cityParkRide' | 'bikeRide',
    cands: AccessCandidate[],
    routes: (StreetRoute | null)[],
    legMode: LegMode,
    transferMin: number,
  ): Promise<Draft[]> {
    const drafts: Draft[] = [];
    const carMin = car ? car.durationMin * peakOf(car, req.work) : Infinity;
    const reachable = cands
      .map((site, i) => ({ site, route: routes[i] ?? null }))
      .filter((c): c is { site: AccessCandidate; route: StreetRoute } => c.route !== null)
      // Driving most of the way and then changing is not park and ride; a two-minute ride is a walk.
      .filter((c) => kind !== 'cityParkRide' || c.route.durationMin * peakOf(c.route, c.site) <= carMin * rules.cityParkRideMaxDetour)
      .filter((c) => kind !== 'parkRail' || c.route.durationMin * peakOf(c.route, c.site) <= carMin * rules.parkRailMaxDriveShare)
      .filter((c) => kind !== 'bikeRide' || c.route.durationMin >= rules.bikeRideMinMin)
      // Rank by access time plus the public transport time from the site to work. That time
      // comes from the one-to-all answer; without it, from a straight-line guess.
      .map((c) => {
        const pt = onward(c.site);
        return { ...c, known: pt !== null, guess: c.route.durationMin * (legMode === 'car' ? peakOf(c.route, c.site) : 1) + transferMin + (pt ?? (haversineKm(c.site, req.work) / 55) * 60) };
      })
      // With real times: a site with no public transport to work within the limit is out, and so
      // is one that cannot come near the fastest public transport from home (the one-to-all time
      // includes waiting, hence the margin).
      .filter((c) => !reach || c.known)
      .filter((c) => !reach || !Number.isFinite(quickest) || c.guess <= quickest + REACH_MARGIN_MIN)
      .sort((a, b) => a.guess - b.guess)
      .slice(0, rules.accessCandidates);

    if (typeof process !== 'undefined' && process.env?.PENDULAR_DEBUG) console.log(kind, 'quickest', quickest, cands.map((site, i) => `${site.name}:${routes[i] ? Math.round(routes[i]!.durationMin) : '-'}/${onward(site) === null ? '-' : Math.round(onward(site)!)}`).join(' '), '=>', reachable.map((c) => `${c.site.name}:${Math.round(c.guess)}`).join(' '));
    const [results, { fromHome }] = await Promise.all([
      // From a site too a cheaper pass can be hidden by faster connections: one more search per
      // site, inside the cheapest zone path, and only when that path needs fewer zones than
      // every connection found from the site (so most sites cost nothing more).
      Promise.all(
        reachable.map(async (c) => {
          const found = (await transitTo(c.site)).filter((it) => it.legs.some(isTransit));
          return merged(found, (await withinZones(c.site, found, Math.min(1, rules.zoneSearchesPerSite), true)).filter((it) => it.legs.some(isTransit)));
        }),
      ),
      homeTransit,
    ]);
    const best = reachable.map((c, i) => {
      const its = results[i] ?? [];
      const factor = legMode === 'car' ? peakOf(c.route, c.site) : 1;
      // Every route from the site, fastest first: the train and the bus from the same car park
      // are two routes, and two tickets when their zones differ.
      return { its, groups: groupItineraries(its, fareKey), factor, rideMs: c.route.durationMin * factor * 60000 };
    });
    // The same train or bus can be boarded at several sites along its way: the one with the
    // shortest drive or ride from home is the one to use.
    const shortestRide = new Map<string, number>();
    // Every connection of every site counts here, not only those of the route a site is shown
    // with: a train that calls at a nearer station is not driven after to a further one.
    for (const b of best) {
      for (const it of b.its) {
        // Only the vehicle boarded AT the site: a train that a nearer site reaches after a
        // change (a regional train to the junction, then the fast train) is not "boardable
        // nearer", and driving to the fast train's own station stays worth showing.
        const v = vehiclesOf(it)[0];
        if (v !== undefined && b.rideMs < (shortestRide.get(v) ?? Infinity)) shortestRide.set(v, b.rideMs);
      }
    }
    reachable.forEach((c, i) => {
      const { groups, factor, rideMs } = best[i]!;
      let shown = 0;
      for (const g of groups) {
        // The search from the site already walks from the car park to the platform: parking and
        // that walk together take the transfer time, or the walk itself when it is longer.
        const leadOf = (it: Itinerary) => {
          const first = it.legs[0]!;
          const walkMs = isTransit(first) ? 0 : ms(first.arrival) - ms(first.departure);
          return rideMs + Math.max(0, transferMin * 60000 - walkMs);
        };
        // Each departure on its own. A vehicle that one can walk to from home, or board at a
        // site nearer home, is not chased by car further down its line. One reached from home
        // only through a feeder bus is worth driving to when one leaves home clearly later.
        const timed = g.itineraries
          .map((it) => ({ it, conn: toConn(it, leadOf(it)) }))
          .filter(({ it, conn }) => {
            const main = mainVehicle(it);
            if (main === undefined) return true;
            if ((shortestRide.get(main) ?? Infinity) < rideMs - 60000) return false;
            const same = fromHome.filter((h) => h.vehicles?.includes(main));
            if (same.some((h) => h.vehicles?.[0] === main)) return false;
            return same.every((h) => conn.dep - h.dep >= rules.sameVehicleMinSaving * 60000);
          })
          .sort((a, b) => a.conn.min - b.conn.min);
        if (timed.length === 0) continue;
        shown++;
        const typical = timed[Math.floor((timed.length - 1) / 2)]!;
        const total = typical.conn.min;
        // Door to door: the drive or ride to the site, then the connection from there.
        const doorToDoor = (x: (typeof timed)[number]): Itinerary => {
          const boardAt = new Date(ms(x.it.departure) - Math.max(0, leadOf(x.it) - rideMs));
          const accessLeg = streetLeg(legMode, home, { ...c.site, name: c.site.name }, { ...c.route, durationMin: c.route.durationMin * factor }, boardAt, 0);
          return { departure: accessLeg.departure, arrival: x.it.arrival, durationMin: x.conn.min, changes: x.it.changes, legs: [accessLeg, ...x.it.legs] };
        };
        for (const x of timed) x.conn.it = doorToDoor(x);
        const itinerary = typical.conn.it!;
        const kept: RouteGroup = { ...g, itineraries: timed.map((x) => x.it), departures: timed.length, arrivals: timed.map((x) => x.it.arrival).sort() };
        kept.firstArrival = kept.arrivals[0]!;
        kept.lastArrival = kept.arrivals[kept.arrivals.length - 1]!;
        drafts.push({ kind, title: g.title, itinerary, durationMin: total, changes: typical.it.changes, group: kept, access: c.site, accessRoute: c.route, conns: timed.map((x) => x.conn), fareKey: fareKey(typical.it) });
      }
      if (groups.length > 0 && shown === 0) leftOut.push({ kind, title: c.site.name, code: 'noBetterThanTransit' });
    });
    return drafts;
  }
  const [fromHomeDrafts, ...accessDrafts] = await Promise.all([
    homeTransit.then((h) => h.drafts),
    accessOptions('parkRail', prCand, prDrive, 'car', rules.parkTransferMin),
    accessOptions('cityParkRide', cityCand, cityDrive, 'car', rules.parkTransferMin),
    accessOptions('bikeRide', brCand, brRide, 'ebike', rules.bikeTransferMin),
  ]);
  const drafts: Draft[] = [...fromHomeDrafts, ...accessDrafts.flat()];

  // --- 4. All the way by one mode -------------------------------------------------------------
  const arriveAt = new Date(drafts[0]?.itinerary.arrival ?? Date.now());
  function directOption(kind: 'walk' | 'bike' | 'ebike' | 'car', r: StreetRoute | null, maxMin: number, extraMin = 0, factor = 1) {
    if (!r || !want(kind)) return;
    const dur = r.durationMin * factor + extraMin;
    if (dur > maxMin) {
      leftOut.push({ kind, title: kind, code: 'tooLong', durationMin: Math.round(dur) });
      return;
    }
    const leg = streetLeg(kind, home, work, { ...r, durationMin: r.durationMin * factor }, arriveAt, extraMin);
    drafts.push({
      kind,
      title: kind,
      itinerary: { departure: leg.departure, arrival: leg.arrival, durationMin: Math.round(dur), changes: 0, legs: [leg] },
      durationMin: Math.round(dur),
      changes: 0,
    });
  }
  directOption('walk', walk, rules.walkAllWayMaxMin);
  directOption('bike', bike, rules.bikeAllWayMaxMin);
  directOption('ebike', ebike, rules.ebikeAllWayMaxMin);
  if (car) carAssumptions.peakFactor = peakOf(car, req.work);
  directOption('car', car, Infinity, carAssumptions.parkingMin, carAssumptions.peakFactor);

  // --- 5. Price, CO₂ --------------------------------------------------------------------------
  if (deps.prepareFares) {
    const trips = drafts.map((d) => d.itinerary.legs.filter(isTransit)).filter((l) => l.length > 0);
    await safe(deps.prepareFares(trips, ctx), undefined);
    priceCache.clear();
  }
  const options: CommuteOption[] = drafts.map((d, i) => {
    const legs = d.itinerary.legs;
    const transitLegs = legs.filter(isTransit);
    const extras: CostComponent[] = [];
    let products: PricedProduct[] = transitLegs.length ? priceLegs(transitLegs) : [];

    if (d.access && (d.kind === 'parkRail' || d.kind === 'cityParkRide')) {
      const p = parkingPerYear(d.access, days);
      if (p) {
        extras.push({ key: `parking.${p.basis}`, params: { site: d.access.name }, yearly: Math.round(p.yearly), provenance: 'tariff', source: d.access.priceSource });
        const inc = d.access.includesTransit;
        if (inc && ((p.basis === 'month' && inc.month) || (p.basis === 'day' && inc.day)) && deps.coveredByZones?.(transitLegs, inc.zones)) {
          products = [{ kind: 'zonePassMonthly', yearly: 0, provenance: 'tariff', components: [{ key: 'parking.includesTransit', params: { zones: inc.zones.join('+') }, yearly: 0, provenance: 'tariff', source: d.access.priceSource }] }];
        }
      }
    }
    if (d.access && d.kind === 'bikeRide') {
      const p = parkingPerYear(d.access, days);
      if (p && p.yearly > 0) extras.push({ key: `bikeParking.${p.basis}`, params: { site: d.access.name }, yearly: Math.round(p.yearly), provenance: 'tariff', source: d.access.priceSource });
    }
    const carKm = legs.filter((l) => l.mode === 'car').reduce((s, l) => s + l.distanceM, 0) / 1000;
    if (carKm > 0) {
      extras.push({ key: 'car.distance', params: { km: Math.round(carKm * 10) / 10, rate: req.car.costPerKm }, yearly: Math.round(carKm * trips * req.car.costPerKm), provenance: 'estimated', source: 'TCS' });
    }
    for (const mode of ['bike', 'ebike'] as const) {
      const km = legs.filter((l) => l.mode === mode).reduce((sum, l) => sum + l.distanceM, 0) / 1000;
      if (km <= 0) continue;
      const rate = mode === 'bike' ? (req.bike?.costPerKm ?? rules.bikeFullCostPerKm) : (req.bike?.ebikeCostPerKm ?? rules.ebikeFullCostPerKm);
      extras.push({ key: `${mode}.distance`, params: { km: Math.round(km * 10) / 10, rate }, yearly: Math.round(km * trips * rate), provenance: 'estimated' });
    }
    if (d.kind === 'car') {
      extras.push({ key: 'parking.work', yearly: Math.round(req.car.parkingAtWorkPerMonth * 12), provenance: 'estimated' });
    }

    const g = d.group;
    return {
      id: `${d.kind}-${i}`,
      kind: d.kind,
      title: d.title,
      itinerary: d.itinerary,
      durationMin: d.durationMin,
      changes: d.changes,
      departuresInWindow: g?.departures,
      firstArrival: g ? localHHMM(g.firstArrival, tz) : undefined,
      lastArrival: g ? localHHMM(g.lastArrival, tz) : undefined,
      kmByMode: kmByMode(legs),
      cost: buildCost(products, extras),
      co2KgPerYear: Math.round(deps.co2KgPerYear(legs, trips)),
      hoursPerYear: Math.round((d.durationMin * trips) / 60),
      access: d.access ? { id: d.access.id, name: d.access.name, kind: d.access.kind, lat: d.access.lat, lon: d.access.lon } : undefined,
      connections: d.conns
        ? [...d.conns].sort((a, b) => a.dep - b.dep).map((c) => ({
            departure: localHHMM(new Date(c.dep).toISOString(), tz),
            arrival: localHHMM(new Date(c.arr).toISOString(), tz),
            durationMin: c.min,
            changes: c.changes,
            ...(c.it ? { legs: connectionLegs(c.it, d.itinerary) } : {}),
          }))
        : undefined,
      fareKey: d.fareKey,
      ticketGroup: `${d.kind}|${d.access?.id ?? ''}|${d.fareKey ?? ''}`,
      // Used by pruning only.
      ...(d.conns ? { _conns: d.conns } : {}),
    } as CommuteOption;
  });

  const carOption = options.find((o) => o.kind === 'car');
  for (const o of options) {
    if (carOption && o !== carOption) o.co2SavedKgPerYear = carOption.co2KgPerYear - o.co2KgPerYear;
  }

  // --- 5b. A car or a bike to the station has to earn its place -------------------------------
  // Kept only when it saves at least five minutes on the fastest public transport from home,
  // or costs less than the cheapest one.
  const pt = options.filter((o) => o.kind === 'transit');
  if (pt.length) {
    const fastestPt = pt.reduce((a, b) => (b.durationMin < a.durationMin ? b : a));
    const cheapestPt = pt.reduce((a, b) => (b.cost.yearly < a.cost.yearly ? b : a));
    const removed: CommuteOption[] = [];
    for (let i = options.length - 1; i >= 0; i--) {
      const o = options[i]!;
      if (o.kind !== 'parkRail' && o.kind !== 'cityParkRide' && o.kind !== 'bikeRide') continue;
      if (o.durationMin <= fastestPt.durationMin - ACCESS_MIN_SAVING || o.cost.yearly < cheapestPt.cost.yearly) continue;
      options.splice(i, 1);
      removed.unshift(o);
    }
    // A site is named once, with its fastest route, and only when none of its routes stays.
    const named = new Set<string>();
    for (const o of removed.sort((a, b) => a.durationMin - b.durationMin)) {
      const site = `${o.kind}|${o.access?.id ?? o.title}`;
      if (named.has(site) || options.some((x) => x.kind === o.kind && x.access?.id === o.access?.id)) continue;
      named.add(site);
      leftOut.push({
        kind: o.kind,
        title: o.access?.name ?? o.title,
        code: 'noBetterThanTransit',
        against: fastestPt.title,
        delta: { minutes: o.durationMin - fastestPt.durationMin, chfPerYear: o.cost.yearly - cheapestPt.cost.yearly },
        durationMin: o.durationMin,
        yearly: o.cost.yearly,
      });
    }
  }

  // --- 5c. Walking, cycling: only where they make sense -----------------------------------------
  const walkOption = options.find((o) => o.kind === 'walk');
  for (let i = options.length - 1; i >= 0; i--) {
    const o = options[i]!;
    if (o.kind !== 'bike' && o.kind !== 'ebike' && o.kind !== 'walk') continue;
    // A walk of a quarter of an hour needs no bike.
    const shortWalk = o.kind !== 'walk' && walkOption && walkOption.durationMin <= rules.walkInsteadOfBikeMaxMin ? walkOption : undefined;
    // Public transport that is both faster and cheaper makes the ride pointless.
    const better = pt.find((t) => t.durationMin < o.durationMin && t.cost.yearly < o.cost.yearly);
    const against = shortWalk ?? better;
    if (!against) continue;
    options.splice(i, 1);
    leftOut.push({
      kind: o.kind,
      title: o.kind,
      code: 'dominated',
      against: against.title,
      delta: { minutes: o.durationMin - against.durationMin, chfPerYear: o.cost.yearly - against.cost.yearly },
      durationMin: o.durationMin,
      yearly: o.cost.yearly,
    });
  }

  // --- 6. Prune, rank ------------------------------------------------------------------------
  const kept = prune(options, leftOut, rules);

  // --- 7. First and last trip home for what is shown --------------------------------------------
  const returns = Promise.all(
    kept.map(async (o) => {
      if (!o.itinerary.legs.some(isTransit)) return;
      const target: LatLon = o.access ?? req.home;
      // A "trip home" that waits for the first bus of the next morning is not a trip home:
      // keep only connections of a duration comparable with the morning trip.
      const longest = o.durationMin * 2 + 30;
      // The way back has to be the way there: the last connection that runs through the two
      // ends of the main vehicle of the morning trip, in reverse (a later one by another line
      // would need another ticket, or would end at another car park). Only when the timetable
      // has no such connection at all is the last one by any route taken.
      const legs = o.itinerary.legs.filter(isTransit);
      const main = legs.length ? legs.reduce((a, b) => (b.durationMin > a.durationMin ? b : a)) : undefined;
      const via = main?.to.stopId && main.from.stopId ? [main.to.stopId, main.from.stopId] : [];
      // With a zone pass the traveller may come back by any line inside its zones: where the
      // timetable server can restrict a search to them, that is the last trip home. It needs no
      // via, and it never uses a section the pass does not cover.
      const ticket = o.cost.products[0];
      const tags =
        routing.segmentFilter && ticket && ZONE_PASSES.has(ticket.kind) && ticket.alliance && ticket.zones?.length
          ? segmentTagsOfZones(ticket.alliance, ticket.zones)
          : [];
      const ok = (it: Itinerary | null) => (it && it.durationMin <= longest ? it : null);
      let within: 'pass' | 'route' | 'any' = 'pass';
      let back = tags.length ? ok(await returnTo(target, [], tags)) : null;
      if (!back) {
        within = 'route';
        back = via.length ? await returnTo(target, via) : null;
        if (!back) {
          within = 'any';
          back = await returnTo(target);
        }
        back = ok(back);
      }
      o.returnTrips = back ? { last: localHHMM(back.departure, tz), lastArrival: localHHMM(back.arrival, tz), within } : null;
    }),
  );

  // --- 8. Geometry for the access legs of kept options ----------------------------------------
  // Several routes can start at the same site: one street search per site and vehicle.
  const shapeCache = new Map<string, Promise<StreetRoute | null>>();
  const shapes = Promise.all(
    kept.map(async (o) => {
      const first = o.itinerary.legs[0];
      if (!o.access || !first || first.geometry) return;
      const profile = first.mode === 'car' ? 'car' : 'ebike';
      const key = `${o.access.id}|${profile}`;
      if (!shapeCache.has(key)) shapeCache.set(key, safe(routing.street({ from: req.home, to: o.access, profile }), null));
      const r = await shapeCache.get(key)!;
      if (r?.geometry) first.geometry = r.geometry;
    }),
  );
  // Both only read the kept options: run them together.
  await Promise.all([returns, shapes]);

  for (const o of kept) delete (o as { _conns?: unknown })._conns;
  kept.sort((a, b) => a.cost.yearly - b.cost.yearly);

  // --- 9. Working from home some days: the cheapest ticket by days at the workplace ------------
  // Days per year in proportion to a Monday-to-Friday week; the searched pattern keeps its own
  // count, so that its row shows the price of the option in the list.
  let flexibleWork: FlexibleWork | undefined;
  const reference = kept.find((o) => o.kind === 'transit');
  if (reference) {
    const legs = reference.itinerary.legs.filter(isTransit);
    const fullWeek = workingDaysPerYear({ weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'], weeksOff: req.pattern.weeksOff }, rules);
    const rows: FlexibleWorkRow[] = [];
    for (let d = 1; d <= 5; d++) {
      const searched = d === req.pattern.weekdays.length;
      const n = searched ? days : Math.round((fullWeek * d) / 5);
      const product = searched ? reference.cost.products[0] : deps.priceTransit(legs, { ...ctx, tripsPerYear: 2 * n, workingDaysPerYear: n })[0];
      if (product) rows.push({ daysPerWeek: d, workingDaysPerYear: n, product });
    }
    if (rows.length) flexibleWork = { optionId: reference.id, rows };
  }

  // --- 10. A shared bike, when it makes the commute better ---------------------------------------
  // Not an option of the list: one suggestion, measured against the fastest public transport
  // option shown (the rule is in planner/sharedBike.ts). A walk of a quarter of an hour needs
  // no bike.
  let sharedBike: CompareResult['sharedBike'];
  // Awaited only here, so that the searches never hold up the options.
  const sharedBikeCandidates = await sharedBikeTrips;
  if (sharedBikeCandidates.length && !(walk && walk.durationMin <= rules.walkInsteadOfBikeMaxMin)) {
    const shown = kept.filter((o) => o.kind === 'transit');
    const fastest = shown.length ? shown.reduce((a, b) => (b.durationMin < a.durationMin || (b.durationMin === a.durationMin && b.cost.yearly < a.cost.yearly) ? b : a)) : undefined;
    const picked = pickSharedBike(sharedBikeCandidates, fastest, rules);
    if (picked) {
      const transitLegs = picked.candidate.itinerary.legs.filter(isTransit);
      sharedBike = sharedBikeSuggestion(picked, {
        operators: deps.bikeShare ?? [],
        ticket: transitLegs.length ? priceLegs(transitLegs)[0] : undefined,
        against: fastest,
        tripsPerYear: trips,
        co2KgPerYear: deps.co2KgPerYear,
      });
    }
  }

  return {
    options: kept,
    leftOut,
    verdict: verdict(kept),
    flexibleWork,
    sharedBike,
    stamp: {
      generatedAt: (deps.now?.() ?? new Date()).toISOString(),
      car: carAssumptions,
      data: { ...(await routing.versions()), tariffs: deps.tariffVersion, parking: deps.parkingVersion },
      rules,
      tripsPerYear: trips,
      workingDaysPerYear: days,
    },
  };
}
