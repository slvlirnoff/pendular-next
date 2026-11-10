import type {
  AccessSite,
  CommuteOption,
  CommuteRequest,
  CompareResult,
  CostComponent,
  Itinerary,
  LatLon,
  Leg,
  LegMode,
  OptionCost,
  OptionKind,
  PricedProduct,
  Provenance,
  RoutingProvider,
  RuleSet,
  StreetProfile,
  StreetRoute,
  TimeWindow,
  Traveller,
} from '../types.js';
import { TRANSIT_MODES } from '../types.js';
import { resolveRules, tripsPerYear, workingDaysPerYear } from '../rules.js';
import { localHHMM } from '../time.js';
import { groupItineraries, type RouteGroup } from './group.js';
import { prune } from './prune.js';
import { verdict } from './verdict.js';

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
  /** True when all legs lie inside the given Mobilis zones (for passes that include transit). */
  coveredByZones?: (legs: Leg[], zones: number[]) => boolean;
  /** kg CO₂-eq per year for the given kilometres per one-way trip. */
  co2KgPerYear: (legs: Leg[], trips: number) => number;
  parkRail: AccessCandidate[];
  bikeParking: AccessCandidate[];
  cityParkRide: AccessCandidate[];
  tariffVersion?: string;
  parkingVersion?: string;
  now?: () => Date;
}

/** Minutes a car or bike access must save on public transport from home to be shown. */
const ACCESS_MIN_SAVING = 5;

const isTransit = (l: Leg) => (TRANSIT_MODES as readonly string[]).includes(l.mode);

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

interface Draft {
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
  const transitTo = (from: LatLon & { name?: string }, window: TimeWindow = req.arrival, withoutRail = false) =>
    safe(
      routing.transit({ from, to: req.work, date, window, by: 'arrive', withoutRail }).then((its) => relabel(its, from.name, work.name)),
      [] as Itinerary[],
    );
  /** From home, also without trains: the cheaper route is not always among the fastest. */
  const transitFromHome = async () => {
    const [fastest, busOnly] = await Promise.all([transitTo(home), transitTo(home, req.arrival, true)]);
    return [...fastest, ...busOnly];
  };
  const street = (profile: StreetProfile) => safe(routing.street({ from: req.home, to: req.work, profile }), null);

  // --- 1. Everything that does not depend on anything else, in parallel -----------------------
  const near = (sites: AccessCandidate[], km: number) =>
    sites.filter((s) => haversineKm(req.home, s) <= km && haversineKm(req.work, s) >= rules.accessMinKmFromWork);
  const prCand = want('parkRail') ? near(deps.parkRail, rules.parkRailMaxDriveMin * 1.1) : [];
  const brCand = want('bikeRide') ? near(deps.bikeParking, rules.bikeRideMaxMin * 0.4) : [];
  const cityCand = want('cityParkRide')
    ? deps.cityParkRide.filter((s) => haversineKm(req.work, s) <= 8 && haversineKm(req.work, s) >= rules.accessMinKmFromWork)
    : [];

  const [direct, car, bike, ebike, walk, prDrive, cityDrive, brRide] = await Promise.all([
    want('transit') || prCand.length || brCand.length ? transitFromHome() : Promise.resolve([] as Itinerary[]),
    street('car'),
    want('bike') ? street('bike') : Promise.resolve(null),
    want('ebike') ? street('ebike') : Promise.resolve(null),
    want('walk') ? street('walk') : Promise.resolve(null),
    safe(routing.streetMatrix({ points: prCand, anchor: req.home, profile: 'car', direction: 'fromAnchor', maxMin: rules.parkRailMaxDriveMin }), prCand.map(() => null)),
    safe(routing.streetMatrix({ points: cityCand, anchor: req.home, profile: 'car', direction: 'fromAnchor', maxMin: 180 }), cityCand.map(() => null)),
    safe(routing.streetMatrix({ points: brCand, anchor: req.home, profile: 'ebike', direction: 'fromAnchor', maxMin: rules.bikeRideMaxMin }), brCand.map(() => null)),
  ]);

  const drafts: Draft[] = [];
  const leftOut: CompareResult['leftOut'] = [];

  // --- 2. Public transport door to door -----------------------------------------------------
  // A connection taking more than twice the fastest (plus half an hour) is not an alternative.
  const withTransit = direct.filter((it) => it.legs.some(isTransit));
  const quickest = Math.min(...withTransit.map((it) => it.durationMin));
  const transitGroups = groupItineraries(withTransit.filter((it) => it.durationMin <= quickest * 2 + 30));
  if (want('transit')) {
    for (const g of transitGroups) {
      drafts.push({ kind: 'transit', title: g.title, itinerary: g.typical, durationMin: g.typicalMin, changes: g.changes, group: g });
    }
  }

  // --- 3. Access options: drive or ride to a station, then public transport -------------------
  const window = req.arrival;
  async function accessOptions(
    kind: 'parkRail' | 'cityParkRide' | 'bikeRide',
    cands: AccessCandidate[],
    routes: (StreetRoute | null)[],
    legMode: LegMode,
    transferMin: number,
  ) {
    const carMin = car ? car.durationMin * rules.carPeakFactor : Infinity;
    const reachable = cands
      .map((site, i) => ({ site, route: routes[i] ?? null }))
      .filter((c): c is { site: AccessCandidate; route: StreetRoute } => c.route !== null)
      // Driving most of the way and then changing is not park and ride; a two-minute ride is a walk.
      .filter((c) => kind !== 'cityParkRide' || c.route.durationMin * rules.carPeakFactor <= carMin * rules.cityParkRideMaxDetour)
      .filter((c) => kind !== 'parkRail' || c.route.durationMin * rules.carPeakFactor <= carMin * rules.parkRailMaxDriveShare)
      .filter((c) => kind !== 'bikeRide' || c.route.durationMin >= rules.bikeRideMinMin)
      // Cheap pre-selection: access time plus a straight-line guess of the onward trip.
      .map((c) => ({ ...c, guess: c.route.durationMin + (haversineKm(c.site, req.work) / 55) * 60 }))
      .sort((a, b) => a.guess - b.guess)
      .slice(0, kind === 'cityParkRide' ? cands.length : rules.accessCandidates);

    const results = await Promise.all(reachable.map((c) => transitTo(c.site)));
    reachable.forEach((c, i) => {
      const groups = groupItineraries((results[i] ?? []).filter((it) => it.legs.some(isTransit)));
      const g = [...groups].sort((a, b) => a.typicalMin - b.typicalMin)[0];
      const label = c.site.name;
      if (!g) return;
      const factor = legMode === 'car' ? rules.carPeakFactor : 1;
      const accessMin = c.route.durationMin * factor + transferMin;
      const total = Math.round(accessMin + g.typicalMin);
      // Keep only when it improves on public transport from home in some respect.
      const boardAt = new Date(new Date(g.typical.departure).getTime());
      const accessLeg = streetLeg(legMode, home, { ...c.site, name: c.site.name }, { ...c.route, durationMin: c.route.durationMin * factor }, boardAt, 0);
      // The access leg ends `transferMin` before the first departure.
      const shift = transferMin * 60000;
      accessLeg.departure = new Date(new Date(accessLeg.departure).getTime() - shift).toISOString();
      accessLeg.arrival = new Date(new Date(accessLeg.arrival).getTime() - shift).toISOString();
      const itinerary: Itinerary = {
        departure: accessLeg.departure,
        arrival: g.typical.arrival,
        durationMin: total,
        changes: g.changes,
        legs: [accessLeg, ...g.typical.legs],
      };
      drafts.push({ kind, title: g.title, itinerary, durationMin: total, changes: g.changes, group: g, access: c.site, accessRoute: c.route });
    });
  }
  await Promise.all([
    accessOptions('parkRail', prCand, prDrive, 'car', rules.parkTransferMin),
    accessOptions('cityParkRide', cityCand, cityDrive, 'car', rules.parkTransferMin),
    accessOptions('bikeRide', brCand, brRide, 'ebike', rules.bikeTransferMin),
  ]);

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
  directOption('car', car, Infinity, rules.carParkingMin, rules.carPeakFactor);

  // --- 5. Price, CO₂ --------------------------------------------------------------------------
  const options: CommuteOption[] = drafts.map((d, i) => {
    const legs = d.itinerary.legs;
    const transitLegs = legs.filter(isTransit);
    const extras: CostComponent[] = [];
    let products: PricedProduct[] = transitLegs.length ? deps.priceTransit(transitLegs, ctx) : [];

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
      // Arrival slices this option covers, used by pruning only.
      ...(g ? { _arrivals: g.arrivals } : {}),
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
    for (let i = options.length - 1; i >= 0; i--) {
      const o = options[i]!;
      if (o.kind !== 'parkRail' && o.kind !== 'cityParkRide' && o.kind !== 'bikeRide') continue;
      if (o.durationMin <= fastestPt.durationMin - ACCESS_MIN_SAVING || o.cost.yearly < cheapestPt.cost.yearly) continue;
      options.splice(i, 1);
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
  const kept = prune(options, leftOut, rules, window, date);

  // --- 7. First and last trip home for what is shown --------------------------------------------
  const returnCache = new Map<string, Promise<Itinerary[]>>();
  await Promise.all(
    kept.map(async (o) => {
      if (!o.itinerary.legs.some(isTransit)) return;
      const target: LatLon = o.access ?? req.home;
      const key = `${target.lat},${target.lon}`;
      if (!returnCache.has(key)) {
        returnCache.set(key, safe(routing.transit({ from: req.work, to: target, date, window: rules.returnWindow, by: 'depart' }), []));
      }
      // A "trip home" that waits for the first bus of the next morning is not a trip home:
      // keep only connections of a duration comparable with the morning trip.
      const longest = o.durationMin * 2 + 30;
      const back = (await returnCache.get(key)!).filter((it) => it.legs.some(isTransit) && it.durationMin <= longest);
      o.returnTrips = back.length
        ? {
            first: localHHMM(back[0]!.departure, tz),
            last: localHHMM(back[back.length - 1]!.departure, tz),
            lastArrival: localHHMM(back[back.length - 1]!.arrival, tz),
            count: back.length,
          }
        : null;
    }),
  );

  // --- 8. Geometry for the access legs of kept options ----------------------------------------
  await Promise.all(
    kept.map(async (o) => {
      const first = o.itinerary.legs[0];
      if (!o.access || !first || first.geometry) return;
      const r = await safe(routing.street({ from: req.home, to: o.access, profile: first.mode === 'car' ? 'car' : 'ebike' }), null);
      if (r?.geometry) first.geometry = r.geometry;
    }),
  );

  for (const o of kept) delete (o as { _arrivals?: unknown })._arrivals;
  kept.sort((a, b) => a.cost.yearly - b.cost.yearly);

  return {
    options: kept,
    leftOut,
    verdict: verdict(kept),
    stamp: {
      generatedAt: (deps.now?.() ?? new Date()).toISOString(),
      data: { ...(await routing.versions()), tariffs: deps.tariffVersion, parking: deps.parkingVersion },
      rules,
      tripsPerYear: trips,
      workingDaysPerYear: days,
    },
  };
}
