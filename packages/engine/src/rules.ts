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
  // Assumption (no traffic data yet): rush-hour driving takes 30 % longer than on empty roads.
  carPeakFactor: 1.3,
  carPeakByDensity: true,
  carParkingMin: null,
  // Vaud, timetable year 2027: 1 and 2 January, Good Friday, Easter Monday, Ascension,
  // Whit Monday, 1 August, Monday of the Jeûne fédéral, Christmas.
  publicHolidays: ['2027-01-01', '2027-01-02', '2027-03-26', '2027-03-29', '2027-05-06', '2027-05-17', '2027-08-01', '2027-09-20', '2027-12-25'],
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
  accessMinKmFromHome: 0.8,
  sameVehicleMinSaving: 5,
  // A commuter walks further to a station than a routing engine assumes by default (15 min).
  walkToStopMaxMin: 25,
  accessMinKmFromWork: 2,
  walkInsteadOfBikeMaxMin: 15,
  // Several stations of one line often rank first (they share a train): six leave room for
  // a station on another line.
  accessCandidates: 6,
  maxOptionsPerKind: 3,
  maxRoutesPerTicket: 6,
  // Measured on Lovatens – EPFL: each restricted search takes about 0.1 s and they run beside
  // the searches from the car parks. Two zones more is the train against the bus from Lucens.
  zoneSearches: 4,
  zoneSearchExtraZones: 2,
  // One more search per car park, only for a cheaper zone path: about 0.1 s on Lovatens – EPFL.
  zoneSearchesPerSite: 1,
  arrivalSliceMin: 30,
  lastTripHomeBy: '02:00',
  carFullCostPerKm: 0.74,
  carRunningCostPerKm: 0.276,
  // Rounded from the model in data/factors/BIKE-COST-SOURCES.md (3,520 km a year):
  // bike CHF 800 over 10 years + CHF 100 upkeep; e-bike CHF 4,000 over 8 years, one battery
  // at CHF 750, CHF 200 upkeep, electricity. Lifetimes and upkeep are assumptions.
  bikeFullCostPerKm: 0.05,
  bikeRunningCostPerKm: 0.03,
  ebikeFullCostPerKm: 0.23,
  ebikeRunningCostPerKm: 0.09,
  // Shared bikes: a station within five minutes on foot, a ride one would do every day.
  sharedBike: true,
  sharedBikeStationMaxWalkM: 400,
  sharedBikeMaxRideMin: 25,
  sharedBikeLegMaxMin: 15,
  sharedBikeMinSavingMin: 5,
};

export function resolveRules(base: RuleSet, overrides?: Partial<RuleSet>): RuleSet {
  if (!overrides) return base;
  const merged = { ...base, ...overrides };
  const changed = (Object.keys(overrides) as (keyof RuleSet)[]).some(
    (k) => k !== 'id' && overrides[k] !== base[k],
  );
  return changed && !overrides.id ? { ...merged, id: `${base.id}+custom` } : merged;
}

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/**
 * Selected weekdays × weeks worked, less the public holidays that fall on a selected weekday
 * (in proportion to the weeks worked: some holidays fall in the weeks off).
 */
export function workingDaysPerYear(pattern: WorkPattern, rules: RuleSet): number {
  const weeks = Math.max(0, rules.weeksPerYear - pattern.weeksOff);
  const selected = new Set<string>(pattern.weekdays);
  const holidays = (rules.publicHolidays ?? []).filter((d) => selected.has(DAY_NAMES[new Date(`${d}T12:00:00Z`).getUTCDay()]!)).length;
  return Math.max(0, selected.size * weeks - Math.round((holidays * weeks) / rules.weeksPerYear));
}

/** One trip to work and one home per working day. */
export function tripsPerYear(pattern: WorkPattern, rules: RuleSet): number {
  return 2 * workingDaysPerYear(pattern, rules);
}
