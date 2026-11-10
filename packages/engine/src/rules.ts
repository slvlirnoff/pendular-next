import type { RuleSet, WorkPattern } from './types.js';

/**
 * Pendular's default rules. Instances (and later suite tenants) override individual settings;
 * every result is stamped with the rule set it used.
 */
export const PENDULAR_RULES: RuleSet = {
  id: 'pendular-2027',
  // Tuesday in the 2027 timetable year, outside Vaud school holidays.
  referenceDate: '2027-01-19',
  timezone: 'Europe/Zurich',
  weeksPerYear: 52,
  carPeakFactor: 1,
  carParkingMin: 0,
  parkTransferMin: 5,
  bikeTransferMin: 3,
  walkAllWayMaxMin: 45,
  bikeAllWayMaxMin: 60,
  ebikeAllWayMaxMin: 60,
  parkRailMaxDriveMin: 25,
  bikeRideMaxMin: 20,
  cityParkRideMaxDetour: 1,
  parkRailMaxDriveShare: 0.5,
  bikeRideMinMin: 4,
  accessMinKmFromWork: 2,
  walkInsteadOfBikeMaxMin: 15,
  accessCandidates: 4,
  maxOptionsPerKind: 3,
  arrivalSliceMin: 30,
  returnWindow: { from: '16:00', to: '23:59' },
  carFullCostPerKm: 0.74,
  carRunningCostPerKm: 0.276,
  // Rounded from the model in data/factors/BIKE-COST-SOURCES.md (3,520 km a year):
  // bike CHF 800 over 10 years + CHF 100 upkeep; e-bike CHF 4,000 over 8 years, one battery
  // at CHF 750, CHF 200 upkeep, electricity. Lifetimes and upkeep are assumptions.
  bikeFullCostPerKm: 0.05,
  bikeRunningCostPerKm: 0.03,
  ebikeFullCostPerKm: 0.23,
  ebikeRunningCostPerKm: 0.09,
};

export function resolveRules(base: RuleSet, overrides?: Partial<RuleSet>): RuleSet {
  if (!overrides) return base;
  const merged = { ...base, ...overrides };
  const changed = (Object.keys(overrides) as (keyof RuleSet)[]).some(
    (k) => k !== 'id' && overrides[k] !== base[k],
  );
  return changed && !overrides.id ? { ...merged, id: `${base.id}+custom` } : merged;
}

export function workingDaysPerYear(pattern: WorkPattern, rules: RuleSet): number {
  const weeks = Math.max(0, rules.weeksPerYear - pattern.weeksOff);
  return new Set(pattern.weekdays).size * weeks;
}

/** One trip to work and one home per working day. */
export function tripsPerYear(pattern: WorkPattern, rules: RuleSet): number {
  return 2 * workingDaysPerYear(pattern, rules);
}
