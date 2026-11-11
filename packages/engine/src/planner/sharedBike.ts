import type {
  CommuteOption,
  CostComponent,
  Itinerary,
  Leg,
  PricedProduct,
  RuleSet,
  SharedBikeCaveat,
  SharedBikeStation,
  SharedBikeSuggestion,
} from '../types.js';
import { TRANSIT_MODES } from '../types.js';
import { bikeShareCostPerYear, type BikeShareOperator } from '../sharing/bikeShare.js';
import { groupItineraries } from './group.js';

const isTransit = (l: Leg) => (TRANSIT_MODES as readonly string[]).includes(l.mode);
/** Walking pace used to tell a walk's length from its time when the leg has no distance. */
const WALK_M_PER_MIN = 75;

export type SharedBikeUse = SharedBikeSuggestion['kind'];

export interface SharedBikeCandidate {
  kind: SharedBikeUse;
  itinerary: Itinerary;
  /** Typical door-to-door time in the window, minutes. */
  durationMin: number;
  changes: number;
  ride: Leg;
  stations: { from: SharedBikeStation; to: SharedBikeStation };
}

/** The walk next to the ride on one side (to the station, or from it); a zero walk when there is none. */
function walkBeside(it: Itinerary, rideIndex: number, side: -1 | 1): { min: number; m: number } {
  const l = it.legs[rideIndex + side];
  if (!l || l.mode !== 'walk') return { min: 0, m: 0 };
  return { min: l.durationMin, m: l.distanceM || l.durationMin * WALK_M_PER_MIN };
}

/**
 * The trip that stands for one way of using a shared bike, or undefined when none qualifies:
 * a station within the walking limit at both ends of the ride, and a ride within the time limit.
 * With public transport, the trips are grouped by route as the options are, and the route with
 * the shortest typical time is kept (its median connection, as for an option of the list).
 */
export function sharedBikeCandidate(kind: SharedBikeUse, its: Itinerary[], rules: RuleSet): SharedBikeCandidate | undefined {
  const maxRide = kind === 'whole' ? rules.sharedBikeMaxRideMin : rules.sharedBikeLegMaxMin;
  const usable = its.filter((it) => {
    const i = it.legs.findIndex((l) => l.mode === 'sharedBike');
    const ride = it.legs[i];
    if (!ride?.sharedBike || it.legs.filter((l) => l.mode === 'sharedBike').length !== 1) return false;
    if (ride.durationMin > maxRide) return false;
    if ((kind === 'whole') === it.legs.some(isTransit)) return false;
    return walkBeside(it, i, -1).m <= rules.sharedBikeStationMaxWalkM && walkBeside(it, i, 1).m <= rules.sharedBikeStationMaxWalkM;
  });
  if (usable.length === 0) return undefined;
  let typical: Itinerary;
  let durationMin: number;
  if (kind === 'whole') {
    typical = usable.reduce((a, b) => (b.durationMin < a.durationMin ? b : a));
    durationMin = typical.durationMin;
  } else {
    const group = groupItineraries(usable).sort((a, b) => a.typicalMin - b.typicalMin || a.changes - b.changes)[0];
    if (!group) return undefined;
    typical = group.typical;
    durationMin = group.typicalMin;
  }
  const i = typical.legs.findIndex((l) => l.mode === 'sharedBike');
  const ride = typical.legs[i]!;
  return {
    kind,
    itinerary: typical,
    durationMin,
    changes: typical.changes,
    ride,
    stations: {
      from: { name: ride.sharedBike!.fromStation || ride.from.name, lat: ride.from.lat, lon: ride.from.lon, walkMin: walkBeside(typical, i, -1).min },
      to: { name: ride.sharedBike!.toStation || ride.to.name, lat: ride.to.lat, lon: ride.to.lon, walkMin: walkBeside(typical, i, 1).min },
    },
  };
}

/**
 * Which shared-bike idea is shown, if any. One rule:
 *
 * 1. Every candidate is measured against the fastest public transport option of the list.
 * 2. The whole trip by shared bike qualifies when it is not slower than that option (or when
 *    the list has no public transport at all). A shared bike for the first or the last leg
 *    qualifies when it saves at least `sharedBikeMinSavingMin` minutes, or saves a change
 *    without being slower.
 * 3. Of those that qualify, the one that saves the most time wins; at equal time, the one with
 *    fewer changes; then the whole trip before the last leg before the first leg.
 */
export function pickSharedBike(
  candidates: SharedBikeCandidate[],
  bestTransit: CommuteOption | undefined,
  rules: RuleSet,
): { candidate: SharedBikeCandidate; minutesSaved?: number; changesSaved?: number } | undefined {
  const order: SharedBikeUse[] = ['whole', 'lastLeg', 'firstLeg'];
  const scored = candidates
    .map((c) => ({ candidate: c, minutesSaved: bestTransit ? bestTransit.durationMin - c.durationMin : undefined, changesSaved: bestTransit ? bestTransit.changes - c.changes : undefined }))
    .filter((x) => {
      if (x.minutesSaved === undefined) return x.candidate.kind === 'whole';
      if (x.candidate.kind === 'whole') return x.minutesSaved >= 0;
      return x.minutesSaved >= rules.sharedBikeMinSavingMin || (x.changesSaved! > 0 && x.minutesSaved >= 0);
    });
  scored.sort(
    (a, b) =>
      (b.minutesSaved ?? 0) - (a.minutesSaved ?? 0) || a.candidate.changes - b.candidate.changes || order.indexOf(a.candidate.kind) - order.indexOf(b.candidate.kind),
  );
  return scored[0];
}

/** The picked candidate with its price, CO₂ and hours: what the result carries. */
export function sharedBikeSuggestion(
  picked: NonNullable<ReturnType<typeof pickSharedBike>>,
  o: {
    operators: BikeShareOperator[];
    ticket?: PricedProduct;
    against?: CommuteOption;
    tripsPerYear: number;
    co2KgPerYear: (legs: Leg[], trips: number) => number;
  },
): SharedBikeSuggestion {
  const c = picked.candidate;
  const ride = c.ride.sharedBike!;
  const op = o.operators.find((x) => x.providers.includes(ride.providerId));
  const price = op ? bikeShareCostPerYear(op, { at: c.ride.from, rideMin: c.ride.durationMin, rides: o.tripsPerYear }) : undefined;
  const unknown = !price || price.yearly === null;
  const membership: SharedBikeSuggestion['cost']['membership'] = {
    key: unknown ? 'bikeShare.unknown' : price.basis === 'annual' ? 'bikeShare.annual' : 'bikeShare.perRide',
    params: { operator: op?.name ?? ride.system, ...(price?.plan ? { plan: price.plan } : {}), ...(price?.annual !== undefined ? { annual: price.annual } : {}) },
    yearly: price?.yearly ?? 0,
    provenance: 'tariff',
    source: op?.source ?? op?.url ?? undefined,
    unknown,
    ...(op?.priceYear && !unknown ? { priceYear: op.priceYear } : {}),
    ...(price?.perRide !== undefined ? { perRide: price.perRide } : {}),
    ...(price?.ebikeExtraPerRide !== undefined ? { ebikeExtraPerRide: price.ebikeExtraPerRide } : {}),
  } satisfies CostComponent & Record<string, unknown>;
  const yearly = unknown ? null : Math.round((o.ticket?.yearly ?? 0) + price.yearly!);
  const caveats: SharedBikeCaveat[] = ['availabilityNotGuaranteed'];
  if (unknown || price.subscriptionUnknown) caveats.push('membershipPriceUnknown');
  if (price?.ebikeExtraPerRide !== undefined) caveats.push('electricSurcharge');
  return {
    id: 'sharedBike',
    kind: c.kind,
    operator: op?.name ?? ride.system,
    operatorId: op?.id,
    stations: c.stations,
    rideMin: c.ride.durationMin,
    rideKm: Math.round(c.ride.distanceM / 100) / 10,
    electric: ride.electric,
    itinerary: c.itinerary,
    durationMin: c.durationMin,
    changes: c.changes,
    cost: { yearly, ticket: o.ticket, membership },
    co2KgPerYear: Math.round(o.co2KgPerYear(c.itinerary.legs, o.tripsPerYear)),
    hoursPerYear: Math.round((c.durationMin * o.tripsPerYear) / 60),
    against:
      o.against && picked.minutesSaved !== undefined
        ? { optionId: o.against.id, minutesSaved: picked.minutesSaved, changesSaved: picked.changesSaved ?? 0, chfPerYear: yearly === null ? null : yearly - o.against.cost.yearly }
        : undefined,
    caveats,
  };
}
