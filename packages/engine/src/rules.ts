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
  cityParkRideMaxDetour: 1.3,
  accessCandidates: 4,
  maxOptionsPerKind: 3,
  arrivalSliceMin: 30,
  returnWindow: { from: '16:00', to: '23:59' },
  carFullCostPerKm: 0.74,
  carRunningCostPerKm: 0.276,
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
