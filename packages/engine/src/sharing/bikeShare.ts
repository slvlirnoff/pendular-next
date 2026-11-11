import type { LatLon } from '../types.js';
import data from '../../data/sharing/bike-share.json' with { type: 'json' };

/** What a ride costs by its length: steps, then a price per started block of minutes. */
export interface RidePrice {
  tiers: { uptoMin: number; price: number }[];
  then: { price: number; perMin: number } | null;
}

export interface BikeSharePlan {
  name: string;
  /** CHF per year; null when the price could not be found. */
  annual: number | null;
  /** What the network has where the plan applies. */
  fleet: 'mixed' | 'mechanical' | 'electric';
  /** [minLat, minLon, maxLat, maxLon] boxes where the plan is sold; null = the whole network. */
  areas: { name: string; bbox: number[] }[] | null;
  /** Price of a ride with the plan; null = not included or unknown. */
  bike: RidePrice | null;
  ebike: RidePrice | null;
}

export interface BikeShareOperator {
  id: string;
  name: string;
  /** Local name of the network ("VéloPartage"). */
  network?: string;
  /** Provider ids of the shared-mobility feed. */
  providers: string[];
  url: string | null;
  /** Where the prices were read. */
  source: string | null;
  /** 'secondary' when the price was not read on the operator's own pages. */
  sourceKind?: string;
  readOn: string;
  priceYear: number | null;
  validity?: string;
  payPerRide: { name: string; bike: RidePrice | null; ebike: RidePrice | null } | null;
  memberships: BikeSharePlan[];
}

/** Station-based bike-share operators and their prices (data/sharing/SOURCES.md). */
export function loadBikeShare(): BikeShareOperator[] {
  return data.operators as BikeShareOperator[];
}

/** Price of one ride of `minutes`; null when the table does not reach that far. */
export function ridePrice(p: RidePrice | null, minutes: number): number | null {
  if (!p) return null;
  const tier = p.tiers.find((x) => minutes <= x.uptoMin);
  if (tier) return tier.price;
  const last = p.tiers[p.tiers.length - 1];
  if (!p.then || !last) return null;
  return last.price + Math.ceil((minutes - last.uptoMin) / p.then.perMin) * p.then.price;
}

const inside = (p: LatLon, b: number[]) => p.lat >= b[0]! && p.lat <= b[2]! && p.lon >= b[1]! && p.lon <= b[3]!;

export interface BikeShareCost {
  /** CHF per year; null when no price is known. */
  yearly: number | null;
  basis: 'annual' | 'perRide' | 'unknown';
  /** Name of the subscription or tariff priced. */
  plan?: string;
  /** CHF per year of the subscription alone (basis 'annual'). */
  annual?: number;
  /** CHF per ride on top of the subscription, or the pay-as-you-go price of a ride. */
  perRide?: number;
  /** True when the ride was priced on an e-bike (the network has nothing else). */
  electric: boolean;
  /** CHF more per ride on an e-bike than priced here; undefined when the same or unknown. */
  ebikeExtraPerRide?: number;
  /** A subscription exists whose price could not be found. */
  subscriptionUnknown: boolean;
}

/**
 * A year of rides of `rideMin` minutes taken at `at`: the cheapest subscription sold there
 * (annual price plus what each ride costs beyond the included minutes); without a known
 * subscription price, the pay-as-you-go price times the rides.
 *
 * Rides are priced on a classic bike wherever the network has some: that is the cheapest way
 * to use it, and which bike stands at the station on a given morning is not known.
 */
export function bikeShareCostPerYear(op: BikeShareOperator, q: { at: LatLon; rideMin: number; rides: number }): BikeShareCost {
  const plans = op.memberships.filter((m) => !m.areas || m.areas.some((a) => inside(q.at, a.bbox)));
  const subscriptionUnknown = plans.some((m) => m.annual === null);
  const fleet = plans[0]?.fleet ?? (op.payPerRide?.bike ? 'mixed' : 'electric');
  const electric = fleet === 'electric';
  const extra = (own: number | null, e: number | null) => (!electric && fleet === 'mixed' && own !== null && e !== null && e > own ? e - own : undefined);

  let best: BikeShareCost | undefined;
  for (const m of plans) {
    if (m.annual === null) continue;
    const perRide = ridePrice(electric ? m.ebike : m.bike, q.rideMin);
    if (perRide === null) continue;
    const yearly = Math.round(m.annual + perRide * q.rides);
    if (!best || yearly < best.yearly!) {
      best = { yearly, basis: 'annual', plan: m.name, annual: m.annual, perRide, electric, ebikeExtraPerRide: extra(perRide, ridePrice(m.ebike, q.rideMin)), subscriptionUnknown: false };
    }
  }
  if (best) return best;

  const pay = op.payPerRide;
  const perRide = pay ? ridePrice(electric ? pay.ebike : pay.bike, q.rideMin) : null;
  if (pay && perRide !== null) {
    return { yearly: Math.round(perRide * q.rides), basis: 'perRide', plan: pay.name, perRide, electric, ebikeExtraPerRide: extra(perRide, ridePrice(pay.ebike, q.rideMin)), subscriptionUnknown };
  }
  return { yearly: null, basis: 'unknown', electric, subscriptionUnknown };
}
