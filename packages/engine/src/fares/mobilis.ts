import type { AgeGroup, TravelClass } from '../types.js';
import table from '../../data/tariffs/mobilis-2027.json' with { type: 'json' };
import { MOBILIS_GRID, createNetwork, passCategory } from './networks.js';

/** Mobilis (Vaud fare network) price grid, valid from this day. */
export const MOBILIS_VALID_FROM: string = table.validFrom;
/** Official price grid the data was transcribed from. */
export const MOBILIS_SOURCE: string = table.source;

export type MobilisZones = number | 'all';
export type MobilisPassPeriod = 'week' | 'month' | 'year' | 'flexi';
export type MobilisPassCategory = 'junior' | 'adult' | 'senior';

// The lookups are those of every zone network (networks.ts); Mobilis is one grid among them.
const net = createNetwork(MOBILIS_GRID);

/** Single ticket price in CHF (full fare 1/1 or half fare 1/2), or null for an invalid zone count. */
export function mobilisSingle(
  zones: MobilisZones,
  opts: { travelClass: TravelClass; half: boolean },
): number | null {
  return net.single(zones, opts);
}

/** Day pass ("Carte journalière") price in CHF. */
export function mobilisDayPass(
  zones: MobilisZones,
  opts: { travelClass: TravelClass; half: boolean },
): number | null {
  return net.dayPass(zones, opts);
}

/** Weekly, monthly, annual or FlexiAbo price in CHF; null where the grid has no such product. */
export function mobilisPass(
  period: MobilisPassPeriod,
  zones: MobilisZones,
  opts: { category: MobilisPassCategory; travelClass: TravelClass },
): number | null {
  return net.pass(period, zones, opts);
}

/**
 * Inverse lookup: which zone count has exactly this single-ticket price (to the cent).
 * Returns null when nothing matches or when several zone counts share the price.
 */
export function zonesFromSinglePrice(
  price: number,
  opts: { travelClass: TravelClass; half: boolean },
): MobilisZones | null {
  return net.zonesFromSinglePrice(price, opts);
}

/**
 * Pass category for an age group.
 * TODO: the exact age limits (junior upper bound, senior start) must be checked against the
 * Mobilis regulation; this maps child and youth to junior as a simplification.
 */
export function mobilisPassCategory(ageGroup: AgeGroup): MobilisPassCategory {
  return passCategory(ageGroup);
}
