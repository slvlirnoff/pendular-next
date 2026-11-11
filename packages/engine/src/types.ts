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
  /**
   * Multiplier on street-network car time (1 = empty roads). An assumption: the street network
   * knows nothing about rush-hour traffic.
   */
  carPeakFactor: number;
  /**
   * True: the factor is worked out per route from how built-up its surroundings are
   * (`carPeakFactor` is then the fallback when that is not available).
   */
  carPeakByDensity: boolean;
  /**
   * Minutes to find a space and walk to the door at the destination. Null = by how dense the
   * area is (residents and jobs within 1 km); a number = set by hand (employer car park…).
   */
  carParkingMin: number | null;
  /** Public holidays of the timetable year, "YYYY-MM-DD": no commuting on those days. */
  publicHolidays: string[];
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
  /** A site this close to home is reached on foot, not by car. Kilometres. */
  accessMinKmFromHome: number;
  /**
   * Driving to the station to board the very train or bus that public transport from home
   * reaches anyway is worth showing only when one leaves home at least this much later. Minutes.
   */
  sameVehicleMinSaving: number;
  /** Longest walk from home to a stop that public transport from home may start with. Minutes. */
  walkToStopMaxMin: number;
  /** A site this close to work is not park and ride: one drives to work. Kilometres. */
  accessMinKmFromWork: number;
  /** When walking takes at most this long, bike and e-bike are not offered. Minutes. */
  walkInsteadOfBikeMaxMin: number;
  /** Access stations tried per access type after the cheap pre-selection. */
  accessCandidates: number;
  /** Tickets (groups of options with the same `ticketGroup`) kept per kind after pruning. */
  maxOptionsPerKind: number;
  /** Routes kept per ticket: those that add most departures. */
  maxRoutesPerTicket: number;
  /**
   * Extra timetable searches from home, each restricted to one set of fare zones, to find the
   * connections of a cheaper pass that faster ones hide (fares/zonePaths.ts). 0 = none.
   */
  zoneSearches: number;
  /** A zone set is searched when it counts at most this many zones more than the cheapest path. */
  zoneSearchExtraZones: number;
  /**
   * The same from each car park or bike park tried: at most this many searches per site (0 or 1),
   * made only for a zone path with fewer zones than every connection found from the site.
   */
  zoneSearchesPerSite: number;
  /** Size of the arrival slices used by the "only way to arrive at that time" rule, minutes. */
  arrivalSliceMin: number;
  /**
   * The last trip home is the latest connection arriving by this time, "HH:MM"; a time before
   * noon is on the following day.
   */
  lastTripHomeBy: string;
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
  /** Look for a shared-bike suggestion (station-based bike sharing). False switches it off. */
  sharedBike: boolean;
  /** Longest walk between a door or a stop and a bike-share station. Metres (400 m = 5 min). */
  sharedBikeStationMaxWalkM: number;
  /** Longest ride for the whole trip by shared bike. Minutes. */
  sharedBikeMaxRideMin: number;
  /** Longest first or last leg by shared bike, walk to the station included. Minutes. */
  sharedBikeLegMaxMin: number;
  /**
   * A shared bike for the first or last leg is suggested when it saves at least this much on
   * the fastest public transport option of the list (or when it saves a change). Minutes.
   */
  sharedBikeMinSavingMin: number;
}

// ---------------------------------------------------------------------------------------------
// Trips
// ---------------------------------------------------------------------------------------------

export type LegMode =
  | 'walk'
  | 'bike'
  | 'ebike'
  | 'sharedBike'
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
  /** Timetable run of the vehicle, when the routing engine gives one. */
  tripId?: string;
  intermediateStops?: StopPoint[];
  /** [lon, lat] pairs. */
  geometry?: [number, number][];
  /** For a ride on a shared bike (mode 'sharedBike'). */
  sharedBike?: SharedBikeRide;
}

export interface SharedBikeRide {
  /** Provider id of the shared-mobility feed ("sharedmobility:donkey_ge"). */
  providerId: string;
  /** Name of the system as the feed gives it ("Donkey Republic Geneva"). */
  system: string;
  /** Stations where the bike is taken and returned. */
  fromStation: string;
  toStation: string;
  /** True when the bike found at the station was an e-bike. Availability changes by the hour. */
  electric: boolean;
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
     * Ask for the other answer where two connections tie. The engine optimises departure,
     * arrival and number of changes, and returns one connection per tie; with this flag it
     * resolves ties differently, so merging both calls shows both routes (a bus and a train
     * that feed the same metro, for instance).
     */
    alternateTies?: boolean;
    /** Longest walk from the origin to the first stop, minutes (the engine's default when omitted). */
    maxWalkToStopMin?: number;
    /**
     * Only rides on route sections these tags allow ("<alliance>:<zone>": a set of fare zones).
     * Honoured only by a provider with `segmentFilter`: never pass it to another one, which
     * would answer as if it were not there.
     */
    allowedSegmentTags?: string[];
    /** With `allowedSegmentTags`: longest door-to-door time of a connection, minutes. */
    maxTravelMin?: number;
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
  /**
   * The latest door-to-door connection arriving by `time` ("YYYY-MM-DD", "HH:MM"): one search,
   * where a whole evening of departures would be many times the work.
   */
  lastTrip?(q: {
    from: LatLon;
    to: LatLon;
    date: string;
    time: string;
    /** Stops (timetable ids) the connection has to pass, in order: at most two. */
    via?: string[];
    /**
     * Only rides on route sections these tags allow ("<alliance>:<zone>": the zones of a pass).
     * Honoured only by a provider with `segmentFilter`; others ignore it.
     */
    allowedSegmentTags?: string[];
  }): Promise<Itinerary | null>;
  /**
   * Door-to-door trips that use a shared bicycle taken and returned at stations: the whole
   * trip, or the last or first leg of a public transport trip. Legs on the bike have the mode
   * 'sharedBike'. Empty when the routing engine knows no bike-share network.
   */
  sharedBike?(q: {
    from: LatLon;
    to: LatLon;
    date: string;
    /** Arrival window at `to`. */
    window: TimeWindow;
    use: 'whole' | 'lastLeg' | 'firstLeg';
    /** Feed provider ids of the station-based operators to use. */
    providers: string[];
    /** Longest walk from the station where the bike is returned, metres. */
    maxStationWalkM: number;
    /** Longest ride (whole trip), or longest leg with the walk to the station. Minutes. */
    maxMin: number;
  }): Promise<Itinerary[]>;
  /** True when `transit` and `lastTrip` can restrict the search with `allowedSegmentTags` (the MOTIS fork). */
  readonly segmentFilter?: boolean;
  /**
   * Public transport time from every stop to `to`, arriving by `time` on `date` (one call for
   * the whole network). Used to choose which stations are worth a full search.
   */
  reachability?(q: { to: LatLon; date: string; time: string; maxMin: number }): Promise<ReachableStop[]>;
  versions(): Promise<DataVersions>;
}

export interface ReachableStop extends LatLon {
  /** Minutes from this stop to the destination, waiting included. */
  minutes: number;
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
  /** Name of the fare network whose zones the product is for ("Mobilis", "Frimobil"). */
  network?: string;
  /** For zone products: id of the fare network in the official fare data ("mobilis", "frimobil"). */
  alliance?: string;
  /** For zone products: the zone codes the product is valid in (with zones always sold together). */
  zones?: number[];
  /** For zone products: the price is that of the whole network (the pass is valid in every zone). */
  allZones?: boolean;
  /** Year of the prices, only when they are not those of the coming timetable year. */
  priceYear?: number;
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
  /** Every connection in the window, door to door: when to leave home, when one arrives ("HH:MM"). */
  connections?: { departure: string; arrival: string; durationMin: number; changes: number }[];
  /**
   * Options with the same key need the same ticket (same zones, same route pass): the list
   * shows them together.
   */
  fareKey?: string;
  /**
   * Options with the same value are routes of one ticket bought for one way of travelling: same
   * kind, same access site, same `fareKey` ("transit||zonePassYearly:…", "parkRail|<site id>|…").
   * The list shows one card per value.
   */
  ticketGroup: string;
  firstArrival?: string;
  lastArrival?: string;
  /** The last trip home: its departure from work and its arrival, "HH:MM". Null when there is none. */
  returnTrips?: {
    last: string;
    lastArrival: string;
    /**
     * Which search gave the time: 'pass' = the last trip on any route the zone pass covers,
     * 'route' = the last one by the route of the morning trip, 'any' = the last one at all.
     */
    within?: 'pass' | 'route' | 'any';
  } | null;
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

/** What the car time assumes on top of the street network's own time. */
export interface CarAssumptions {
  peakFactor: number;
  /** True when the factor comes from how built-up the route's surroundings are. */
  peakAuto?: boolean;
  parkingMin: number;
  /** False when the parking time was set by hand. */
  parkingAuto: boolean;
  parkingKind?: 'cityCentre' | 'townCentre' | 'elsewhere';
  residents1km?: number;
  jobs1km?: number | null;
}

export interface ResultStamp {
  generatedAt: string;
  car?: CarAssumptions;
  data: DataVersions;
  rules: RuleSet;
  tripsPerYear: number;
  workingDaysPerYear: number;
}

/** Public transport for someone at the workplace `daysPerWeek` days a week: the cheapest ticket. */
export interface FlexibleWorkRow {
  daysPerWeek: number;
  workingDaysPerYear: number;
  product: PricedProduct;
}

export interface FlexibleWork {
  /** The public transport option the tickets are for. */
  optionId: string;
  /** One row per number of days, 1 to 5. */
  rows: FlexibleWorkRow[];
}

export type SharedBikeCaveat =
  /** A bike, or a free place to return it, is not guaranteed at rush hour. */
  | 'availabilityNotGuaranteed'
  /** No subscription price could be found: the cost is unknown, or counted ride by ride. */
  | 'membershipPriceUnknown'
  /** An e-bike costs more per ride than counted here. */
  | 'electricSurcharge';

/** One end of the ride: the station and the walk between it and the door or the stop. */
export interface SharedBikeStation extends LatLon {
  name: string;
  walkMin: number;
}

export interface SharedBikeCost {
  /** Ticket plus bike sharing, CHF per year; null when the bike-sharing price is unknown. */
  yearly: number | null;
  /** Cheapest ticket for the public transport part; absent for the whole trip by bike. */
  ticket?: PricedProduct;
  /**
   * Bike sharing: key "bikeShare.annual" (subscription, plus rides beyond the included
   * minutes), "bikeShare.perRide" (no subscription price known: every ride paid) or
   * "bikeShare.unknown" (yearly 0, `unknown` true).
   */
  membership: CostComponent & { unknown: boolean; priceYear?: number; perRide?: number; ebikeExtraPerRide?: number };
}

/**
 * The one shared-bike idea worth showing next to the options: the whole trip on a shared
 * bike, or public transport with a shared bike for the last or the first leg.
 */
export interface SharedBikeSuggestion {
  id: string;
  kind: 'whole' | 'lastLeg' | 'firstLeg';
  /** Operator name for display ("Donkey Republic") and its id in the price data. */
  operator: string;
  operatorId?: string;
  stations: { from: SharedBikeStation; to: SharedBikeStation };
  rideMin: number;
  rideKm: number;
  /** The bike found at the station was an e-bike (as of today; not guaranteed). */
  electric: boolean;
  itinerary: Itinerary;
  durationMin: number;
  changes: number;
  cost: SharedBikeCost;
  co2KgPerYear: number;
  hoursPerYear: number;
  /** The public transport option of the list it is compared with (the fastest one). */
  against?: { optionId: string; minutesSaved: number; changesSaved: number; chfPerYear: number | null };
  caveats: SharedBikeCaveat[];
}

export interface CompareResult {
  options: CommuteOption[];
  leftOut: LeftOut[];
  verdict: Verdict;
  /** Absent when no public transport option is listed. */
  flexibleWork?: FlexibleWork;
  /** Absent when no shared bike makes the commute better (or no network is near). */
  sharedBike?: SharedBikeSuggestion;
  stamp: ResultStamp;
}
