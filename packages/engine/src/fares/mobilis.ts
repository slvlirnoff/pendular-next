import type { AgeGroup, TravelClass } from '../types.js';
import table from '../../data/tariffs/mobilis-2027.json' with { type: 'json' };

/** Mobilis (Vaud fare network) price grid, valid from this day. */
export const MOBILIS_VALID_FROM: string = table.validFrom;
/** Official price grid the data was transcribed from. */
export const MOBILIS_SOURCE: string = table.source;

export type MobilisZones = number | 'all';
export type MobilisPassPeriod = 'week' | 'month' | 'year' | 'flexi';
export type MobilisPassCategory = 'junior' | 'adult' | 'senior';

type ZoneRow = Readonly<Record<string, number>>;

const MAX_TICKET_ZONE = 14;
const MAX_PASS_ZONE = 11;

/** Column key for a zone count; counts above the last numbered column map to 'all'. */
function zoneKey(zones: MobilisZones, maxNumbered: number): string | null {
  if (zones === 'all') return 'all';
  if (!Number.isInteger(zones) || zones < 1) return null;
  return zones > maxNumbered ? 'all' : String(zones);
}

function classKey(c: TravelClass): '1' | '2' {
  return c === 1 ? '1' : '2';
}

function ticketRow(
  family: typeof table.tickets.single | typeof table.dayPass,
  opts: { travelClass: TravelClass; half: boolean },
): ZoneRow {
  return family[opts.half ? 'half' : 'full'][classKey(opts.travelClass)];
}

function lookup(row: ZoneRow, zones: MobilisZones, maxNumbered: number): number | null {
  const key = zoneKey(zones, maxNumbered);
  if (key === null) return null;
  return row[key] ?? null;
}

/** Single ticket price in CHF (full fare 1/1 or half fare 1/2), or null for an invalid zone count. */
export function mobilisSingle(
  zones: MobilisZones,
  opts: { travelClass: TravelClass; half: boolean },
): number | null {
  return lookup(ticketRow(table.tickets.single, opts), zones, MAX_TICKET_ZONE);
}

/** Day pass ("Carte journalière") price in CHF. */
export function mobilisDayPass(
  zones: MobilisZones,
  opts: { travelClass: TravelClass; half: boolean },
): number | null {
  return lookup(ticketRow(table.dayPass, opts), zones, MAX_TICKET_ZONE);
}

/** Weekly, monthly, annual or FlexiAbo price in CHF; null where the grid has no such product. */
export function mobilisPass(
  period: MobilisPassPeriod,
  zones: MobilisZones,
  opts: { category: MobilisPassCategory; travelClass: TravelClass },
): number | null {
  const byCategory: Readonly<Record<string, Readonly<Record<string, ZoneRow>>>> = table.passes[period];
  const row = byCategory[opts.category]?.[classKey(opts.travelClass)];
  if (!row) return null;
  return lookup(row, zones, MAX_PASS_ZONE);
}

/**
 * Inverse lookup: which zone count has exactly this single-ticket price (to the cent).
 * Returns null when nothing matches or when several zone counts share the price.
 */
export function zonesFromSinglePrice(
  price: number,
  opts: { travelClass: TravelClass; half: boolean },
): MobilisZones | null {
  const cents = Math.round(price * 100);
  const matches = Object.entries(ticketRow(table.tickets.single, opts)).filter(
    ([, p]) => Math.round(p * 100) === cents,
  );
  if (matches.length !== 1) return null;
  const key = matches[0]![0];
  return key === 'all' ? 'all' : Number(key);
}

/**
 * Pass category for an age group.
 * TODO: the exact age limits (junior upper bound, senior start) must be checked against the
 * Mobilis regulation; this maps child and youth to junior as a simplification.
 */
export function mobilisPassCategory(ageGroup: AgeGroup): MobilisPassCategory {
  switch (ageGroup) {
    case 'child':
    case 'youth':
      return 'junior';
    case 'adult':
      return 'adult';
    case 'senior':
      return 'senior';
  }
}
