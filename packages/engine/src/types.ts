/**
 * The commute engine contract. Products (Pendular, later analytics, parking…) talk to the
 * engine only through these types. The engine keeps no state and stores no personal data.
 */

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Place extends LatLon {
  label: string;
  /** Timetable stop id when the place is a stop. */
  stopId?: string;
}

/** 6–15, 16–24, 25–64, AVS age (64/65+). */
export type AgeGroup = 'child' | 'youth' | 'adult' | 'senior';
export type TravelClass = 1 | 2;
export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/** Local wall-clock times, "HH:MM". `to` earlier than `from` means the window crosses midnight. */
export interface TimeWindow {
  from: string;
  to: string;
}

export interface Traveller {
  ageGroup: AgeGroup;
  travelClass: TravelClass;
  /** Already owns a Half Fare Travelcard (its price is then not counted). */
  halfFare: boolean;
  /** Already owns a GA. */
  ga?: boolean;
  /** Lives in the canton of Vaud (cantonal discount on annual Mobilis passes). */
  vaudResident: boolean;
}

export interface WorkPattern {
  weekdays: Weekday[];
  /** Weeks per year without commuting (holidays, leave). */
  weeksOff: number;
}

export interface BikeSettings {
  /** CHF per km for a conventional bicycle; the rule set's full cost when omitted. */
  costPerKm?: number;
  /** CHF per km for an e-bike; the rule set's full cost when omitted. */
  ebikeCostPerKm?: number;
}

export interface CarSettings {
  /** CHF per km used for the headline car cost. */
  costPerKm: number;
  /** CHF per month for parking at work. */
  parkingAtWorkPerMonth: number;
}

export type OptionKind =
  | 'transit'
  | 'parkRail'
  | 'cityParkRide'
  | 'bikeRide'
  | 'walk'
  | 'bike'
  | 'ebike'
  | 'car';

export interface CommuteRequest {
  home: Place;
  work: Place;
  /** Arrival window at work. */
  arrival: TimeWindow;
  pattern: WorkPattern;
  traveller: Traveller;
  car: CarSettings;
  bike?: BikeSettings;
  /** Option kinds to consider; all when omitted. */
  kinds?: OptionKind[];
  /** Reference day, "YYYY-MM-DD"; the rule set's default when omitted. */
  date?: string;
  /** Overrides on top of the instance's rule set. */
  rules?: Partial<RuleSet>;
}

// ---------------------------------------------------------------------------------------------
// Rules: every calculation rule is a named setting with a default per instance.
// ---------------------------------------------------------------------------------------------

export interface RuleSet {
  id: string;
  /** Reference day for timetable queries, "YYYY-MM-DD" (a Tuesday outside school holidays). */
  referenceDate: string;
  timezone: string;
  weeksPerYear: number;
  /** Multiplier on street-network car time (1 = plain route time). */
  carPeakFactor: number;
  /** Minutes added to car trips for parking at the destination. */
  carParkingMin: number;
  /** Minutes to park and walk to the platform at a P+Rail or P+R site. */
  parkTransferMin: number;
  /** Minutes to lock a bike and walk to the platform. */
  bikeTransferMin: number;
  walkAllWayMaxMin: number;
  bikeAllWayMaxMin: number;
  ebikeAllWayMaxMin: number;
  /** Longest drive to a P+Rail site considered. */
  parkRailMaxDriveMin: number;
  /** Longest e-bike ride to a station considered. */
  bikeRideMaxMin: number;
  /** A city P+R is offered only when driving to it takes at most this share of the direct drive. */
  cityParkRideMaxDetour: number;
  /** A P+Rail site is offered only when driving to it takes at most this share of the direct drive. */
  parkRailMaxDriveShare: number;
  /** Shortest ride for which a bike-and-ride option is worth showing, minutes. */
  bikeRideMinMin: number;
  /** A site this close to work is not park and ride: one drives to work. Kilometres. */
  accessMinKmFromWork: number;
  /** When walking takes at most this long, bike and e-bike are not offered. Minutes. */
  walkInsteadOfBikeMaxMin: number;
  /** Access stations tried per access type after the cheap pre-selection. */
  accessCandidates: number;
  /** Options kept per kind after pruning. */
  maxOptionsPerKind: number;
  /** Size of the arrival slices used by the "only way to arrive at that time" rule, minutes. */
  arrivalSliceMin: number;
  /** Departure window home used for the first/last return trip. */
  returnWindow: TimeWindow;
  /** TCS reference values, CHF per km. */
  carFullCostPerKm: number;
  carRunningCostPerKm: number;
  /**
   * Bicycle and e-bike cost, CHF per km: full cost (purchase spread over its life, upkeep,
   * battery, electricity) and running cost only. See data/factors/BIKE-COST-SOURCES.md.
   */
  bikeFullCostPerKm: number;
  bikeRunningCostPerKm: number;
  ebikeFullCostPerKm: number;
  ebikeRunningCostPerKm: number;
}

// ---------------------------------------------------------------------------------------------
// Trips
// ---------------------------------------------------------------------------------------------

export type LegMode =
  | 'walk'
  | 'bike'
  | 'ebike'
  | 'car'
  | 'rail'
  | 'bus'
  | 'tram'
  | 'metro'
  | 'boat'
  | 'funicular'
  | 'cableway';

export const TRANSIT_MODES: readonly LegMode[] = [
  'rail',
  'bus',
  'tram',
  'metro',
  'boat',
  'funicular',
  'cableway',
];

export interface StopPoint extends LatLon {
  name: string;
  /** Timetable stop id (station level where known). */
  stopId?: string;
}

export interface Line {
  /** Display name as in the timetable, e.g. "IR 15", "S3", "m2", "17". */
  name: string;
  /** Product category, e.g. "IR", "S", "RE", "B", "M". */
  category?: string;
  operator?: string;
  headsign?: string;
}

export interface Leg {
  mode: LegMode;
  from: StopPoint;
  to: StopPoint;
  /** ISO 8601 with offset. */
  departure: string;
  arrival: string;
  durationMin: number;
  distanceM: number;
  line?: Line;
  intermediateStops?: StopPoint[];
  /** [lon, lat] pairs. */
  geometry?: [number, number][];
}

export interface Itinerary {
  departure: string;
  arrival: string;
  durationMin: number;
  /** Changes between public transport vehicles. */
  changes: number;
  legs: Leg[];
}

export interface StreetRoute {
  durationMin: number;
  distanceM: number;
  geometry?: [number, number][];
}

export type StreetProfile = 'walk' | 'bike' | 'ebike' | 'car';

export interface DataVersions {
  timetable?: string;
  streets?: string;
  parking?: string;
  tariffs?: string;
  engine?: string;
}

/** The one seam to the routing engine (MOTIS today). */
export interface RoutingProvider {
  /** Door-to-door public transport itineraries arriving inside the window on `date`. */
  transit(q: {
    from: LatLon;
    to: LatLon;
    date: string;
    window: TimeWindow;
    /** 'arrive': window is on arrival at `to`; 'depart': on departure from `from`. */
    by: 'arrive' | 'depart';
    /**
     * Leave trains out. The engine returns the fastest connections only; a bus route that is
     * as good but crosses fewer fare zones shows up only when asked for.
     */
    withoutRail?: boolean;
  }): Promise<Itinerary[]>;
  street(q: { from: LatLon; to: LatLon; profile: StreetProfile }): Promise<StreetRoute | null>;
  /** Many origins to one destination (or one origin to many destinations with `reverse`). */
  streetMatrix(q: {
    points: LatLon[];
    anchor: LatLon;
    profile: StreetProfile;
    /** 'toAnchor': each point → anchor; 'fromAnchor': anchor → each point. */
    direction: 'toAnchor' | 'fromAnchor';
    maxMin: number;
  }): Promise<(StreetRoute | null)[]>;
  versions(): Promise<DataVersions>;
}

// ---------------------------------------------------------------------------------------------
// Costs
// ---------------------------------------------------------------------------------------------

/** Where a price comes from: an API quote, a published tariff table, or a model. */
export type Provenance = 'quoted' | 'tariff' | 'estimated';

export interface CostComponent {
  /** Stable key for translation, e.g. "mobilis.annual", "halfFare.card", "parking.prail.year". */
  key: string;
  /** Parameters for the label (zone count, site name…). */
  params?: Record<string, string | number>;
  yearly: number;
  provenance: Provenance;
  /** Link or document reference for the price. */
  source?: string;
}

export type ProductKind =
  | 'singles'
  | 'halfFareSingles'
  | 'dayPasses'
  | 'halfFareDayPasses'
  | 'flexiPass'
  | 'zonePassMonthly'
  | 'zonePassYearly'
  | 'zonePassAllYearly'
  | 'routePassMonthly'
  | 'routePassYearly'
  | 'ga';

export interface PricedProduct {
  kind: ProductKind;
  yearly: number;
  components: CostComponent[];
  /** The weakest provenance among the components. */
  provenance: Provenance;
  /** For estimated zone counts: yearly cost with one zone fewer / more. */
  range?: { low: number; high: number };
}

export interface OptionCost {
  /** Cheapest ticket product plus the extras, CHF per year. */
  yearly: number;
  /** All ticket products that can cover the public transport part, cheapest first. */
  products: PricedProduct[];
  /** Parking, driving and other non-ticket costs. */
  extras: CostComponent[];
  provenance: Provenance;
}

// ---------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------

export interface AccessSite {
  id: string;
  name: string;
  kind: 'parkRail' | 'cityParkRide' | 'bikeParking';
  lat: number;
  lon: number;
}

export interface CommuteOption {
  id: string;
  kind: OptionKind;
  /** Short route description, e.g. "Lucens → Lausanne, IR 15". */
  title: string;
  /** A typical trip in the window. */
  itinerary: Itinerary;
  /** Typical door-to-door time in the window, minutes. */
  durationMin: number;
  changes: number;
  /** Distinct departures arriving in the window (transit part); undefined for street-only options. */
  departuresInWindow?: number;
  firstArrival?: string;
  lastArrival?: string;
  /**
   * First and last trip home in the return window: "HH:MM" departures from work, and when the
   * last one arrives.
   */
  returnTrips?: { first: string; last: string; lastArrival: string; count: number } | null;
  /** Kilometres per one-way trip by leg mode. */
  kmByMode: Partial<Record<LegMode, number>>;
  cost: OptionCost;
  co2KgPerYear: number;
  /** Against the car option; positive = less CO₂ than driving. */
  co2SavedKgPerYear?: number;
  hoursPerYear: number;
  access?: AccessSite;
}

export type LeftOutCode =
  | 'dominated'
  | 'nearDuplicate'
  | 'overCap'
  | 'tooLong'
  | 'noBetterThanTransit';

export interface LeftOut {
  kind: OptionKind;
  title: string;
  code: LeftOutCode;
  /** The option it lost against, when there is one. */
  against?: string;
  /** Differences against `against`: positive = this option is worse. */
  delta?: { minutes?: number; chfPerYear?: number; co2KgPerYear?: number };
  durationMin?: number;
  yearly?: number;
}

export interface Verdict {
  cheapest?: string;
  fastest?: string;
  greenest?: string;
  /** For options faster than the cheapest: extra CHF per hour saved over a year. */
  costPerHourSaved: Record<string, number>;
}

export interface ResultStamp {
  generatedAt: string;
  data: DataVersions;
  rules: RuleSet;
  tripsPerYear: number;
  workingDaysPerYear: number;
}

export interface CompareResult {
  options: CommuteOption[];
  leftOut: LeftOut[];
  verdict: Verdict;
  stamp: ResultStamp;
}
