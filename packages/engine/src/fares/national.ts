/**
 * National public transport tariff lookups (Alliance SwissPass: T601, T650, T654 and the
 * "Tarifmassnahmen" page). Data: data/tariffs/national-2027.json (see NATIONAL-SOURCES.md).
 * Every lookup returns null when the figure is not in the data. Only `valid2027` figures are
 * confirmed for 13.12.2026; distance and route-pass tables are the 01.06.2026 edition (see `*_VALIDITY`).
 */
import type { AgeGroup, TravelClass } from '../types.js';
import raw from '../../data/tariffs/national-2027.json' with { type: 'json' };

type ClassPrices = Record<'1' | '2', number | null>;
interface GaPrices {
  yearly: ClassPrices;
  monthly: ClassPrices;
}
interface HalfFareBlock {
  adult: { new: number | null; renewal: number | null };
  youth: { new: number | null; renewal: number | null };
}
type GaCategory = 'adult' | 'child' | 'youth' | 'age25' | 'senior';
interface Data {
  valid2027: {
    validFrom: string;
    source: string;
    ga: Record<GaCategory, GaPrices>;
    halfFareCard: HalfFareBlock;
    dayCardHalfFare: ClassPrices;
  };
  previous: {
    ga: Record<GaCategory, GaPrices>;
    halfFareCard: HalfFareBlock;
    distanceSingle: {
      validFrom: string;
      source: string;
      halfFareMinimum: ClassPrices;
      rows: number[][];
    };
    routePass: { validFrom: string; source: string; yearMonthsFactor: number; rows: number[][] };
  };
}
const data = raw as unknown as Data;

/** Validity of the GA / Half Fare / day-card figures (official announcement). */
export const NATIONAL_VALID_FROM = data.valid2027.validFrom;
export const NATIONAL_SOURCE = data.valid2027.source;
/** Distance tariff T601 table: edition 01.06.2026, not confirmed for 13.12.2026. */
export const DISTANCE_TABLE_VALID_FROM = data.previous.distanceSingle.validFrom;
export const DISTANCE_TABLE_SOURCE = data.previous.distanceSingle.source;
/** Route pass T650 table: "gültig ab 10.12.2023" inside the 01.06.2026 edition, not confirmed for 2027. */
export const ROUTE_PASS_TABLE_VALID_FROM = data.previous.routePass.validFrom;
export const ROUTE_PASS_TABLE_SOURCE = data.previous.routePass.source;

function gaCategory(age: AgeGroup): GaCategory {
  return age;
}

/** Yearly GA price (valid from 13.12.2026). 'senior' = AHV age. */
export function gaYearly(ageGroup: AgeGroup, travelClass: TravelClass): number | null {
  return data.valid2027.ga[gaCategory(ageGroup)]?.yearly[String(travelClass) as '1' | '2'] ?? null;
}

/** Yearly GA for 25-year-olds (a tier outside AgeGroup), valid from 13.12.2026. */
export function gaYearly25(travelClass: TravelClass): number | null {
  return data.valid2027.ga.age25.yearly[String(travelClass) as '1' | '2'] ?? null;
}

/** Monthly-billing GA price, months 1-12 (valid from 13.12.2026). */
export function gaMonthly(ageGroup: AgeGroup, travelClass: TravelClass): number | null {
  return data.valid2027.ga[gaCategory(ageGroup)]?.monthly[String(travelClass) as '1' | '2'] ?? null;
}

/** Same as gaYearly but from the 01.06.2026 edition (superseded; for comparison only). */
export function gaYearlyPrevious(ageGroup: AgeGroup, travelClass: TravelClass): number | null {
  return data.previous.ga[gaCategory(ageGroup)]?.yearly[String(travelClass) as '1' | '2'] ?? null;
}

/**
 * Half Fare Travelcard per year. Adults and seniors pay the adult price; youth (16-24.99)
 * has no announced 2027 price (null); children travel with the Junior discount, no card price.
 */
export function halfFareCardYearly(
  ageGroup: AgeGroup,
  opts?: { renewal?: boolean },
): number | null {
  if (ageGroup === 'child') return null;
  const block = ageGroup === 'youth' ? data.valid2027.halfFareCard.youth : data.valid2027.halfFareCard.adult;
  return (opts?.renewal ? block.renewal : block.new) ?? null;
}

/** Half Fare card price from the 01.06.2026 edition (includes youth), superseded. */
export function halfFareCardYearlyPrevious(
  ageGroup: AgeGroup,
  opts?: { renewal?: boolean },
): number | null {
  if (ageGroup === 'child') return null;
  const block = ageGroup === 'youth' ? data.previous.halfFareCard.youth : data.previous.halfFareCard.adult;
  return (opts?.renewal ? block.renewal : block.new) ?? null;
}

/** Day card with Half Fare (Tageskarte zum Halbtax), valid from 13.12.2026. */
export function dayCardHalfFare(travelClass: TravelClass): number | null {
  return data.valid2027.dayCardHalfFare[String(travelClass) as '1' | '2'] ?? null;
}

/**
 * Single-trip price for a tariff-km distance (T601 table, edition 01.06.2026). Half fare is the
 * full price halved without rounding (T601 2.4.1), but not below the minimum fare (T601 11.2.1).
 * Distances must be whole tariff km 1..1000, else null.
 */
export function distanceSingle(
  tariffKm: number,
  opts: { travelClass: TravelClass; half: boolean },
): number | null {
  if (!Number.isFinite(tariffKm)) return null;
  const km = Math.ceil(tariffKm);
  const t = data.previous.distanceSingle;
  const row = t.rows.find((r) => km >= (r[0] ?? 0) && km <= (r[1] ?? 0));
  if (!row) return null;
  const full = opts.travelClass === 1 ? row[3] : row[2];
  if (full === undefined) return null;
  if (!opts.half) return full;
  const min = t.halfFareMinimum[String(opts.travelClass) as '1' | '2'] ?? 0;
  return Math.max(Math.round((full / 2) * 100) / 100, min);
}

/**
 * Route pass price (T650, table dated 10.12.2023 in the 01.06.2026 edition). 'junior' = 6-24.99,
 * 2nd class only (1st class junior -> null). Table covers 1..240 tariff km, else null.
 */
export function routePass(
  period: 'month' | 'year',
  tariffKm: number,
  opts: { travelClass: TravelClass; category: 'junior' | 'adult' },
): number | null {
  if (!Number.isFinite(tariffKm)) return null;
  const km = Math.ceil(tariffKm);
  const row = data.previous.routePass.rows.find((r) => km >= (r[0] ?? 0) && km <= (r[1] ?? 0));
  if (!row) return null;
  // columns: 0 from, 1 to, 2 adultYear2, 3 adultYear1, 4 adultMonth2, 5 adultMonth1, 6 juniorYear2, 7 juniorMonth2
  let idx: number;
  if (opts.category === 'junior') {
    if (opts.travelClass === 1) return null;
    idx = period === 'year' ? 6 : 7;
  } else if (opts.travelClass === 2) idx = period === 'year' ? 2 : 4;
  else idx = period === 'year' ? 3 : 5;
  // The table is the 2026 one. From 13.12.2026 route passes cost about 2 % more: the monthly
  // price × 1.02 rounded up to the franc, the annual one nine times that, reproduces the three
  // prices read in the SBB shop for 04.01.2027 (see data/tariffs/NATIONAL-SOURCES.md).
  const monthIdx = opts.category === 'junior' ? 7 : opts.travelClass === 2 ? 4 : 5;
  const month = row[monthIdx];
  if (month == null) return row[idx] ?? null;
  const month2027 = Math.ceil(Math.round(month * ROUTE_PASS_RISE_2027 * 100) / 100);
  return period === 'month' ? month2027 : month2027 * 9;
}

/** Assumed rise of route-pass prices on 13.12.2026 (two shop quotes, not a published table). */
export const ROUTE_PASS_RISE_2027 = 1.02;
