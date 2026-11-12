/**
 * Pendular Plural: shared types. People are known by the client's own pseudonymous id
 * (`extId`); no names or e-mail addresses are stored.
 */

export type AddressStatus = 'pending' | 'exact' | 'check' | 'notfound' | 'manual';

/** One row of an uploaded list. */
export interface PersonInput {
  extId: string;
  /** Street and number, or the whole address in one line. */
  address?: string;
  postcode?: string;
  city?: string;
  /** Coordinates given directly (WGS 84): no address check needed. */
  lat?: number;
  lon?: number;
  /** Any further columns (department, shift, current mode…). */
  attrs?: Record<string, string>;
}

export interface AddressCandidate {
  label: string;
  lat: number;
  lon: number;
  /** 0–1: how well this candidate fits the given address. */
  score: number;
  source: 'swisstopo' | 'motis';
}

/** The result of checking one address. */
export interface GeocodeResult {
  /** exact: one clear match; check: a human should confirm; notfound: nothing usable. */
  status: 'exact' | 'check' | 'notfound';
  lat?: number;
  lon?: number;
  /** The address as the register writes it. */
  matched?: string;
  /** Best candidates, best first (at most 5). */
  candidates: AddressCandidate[];
  /** Why it is not exact, as stable codes: 'postcode', 'houseNumber', 'street', 'ambiguous', 'noNumber', 'fallback'. */
  reasons: string[];
}

export interface Person {
  id: number;
  listId: string;
  extId: string;
  address: string | null;
  postcode: string | null;
  city: string | null;
  attrs: Record<string, string>;
  status: AddressStatus;
  lat: number | null;
  lon: number | null;
  matched: string | null;
  candidates: AddressCandidate[];
  reasons: string[];
}

export interface ListSummary {
  id: string;
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  people: number;
  byStatus: Record<AddressStatus, number>;
}

export type RatioClass = 'ptFaster' | 'upTo1_5' | 'upTo2' | 'over2' | 'noPt';

/** One person's result in one analysis: the figures the indicators are computed from. */
export interface ResultRow {
  personId: number;
  extId: string;
  attrs: Record<string, string>;
  lat: number;
  lon: number;
  /** Door-to-door minutes; null when the mode is not available or over its limit. */
  ptMin: number | null;
  ptChanges: number | null;
  /** Departures arriving in the window on the best public transport route. */
  ptDepartures: number | null;
  /** Yearly cost of the cheapest ticket on the cheapest public transport route, CHF. */
  ptCost: number | null;
  ptProduct: string | null;
  /** Stop where the best public transport trip is boarded. */
  boardStop: string | null;
  carMin: number | null;
  carKm: number | null;
  carCost: number | null;
  bikeMin: number | null;
  ebikeMin: number | null;
  walkMin: number | null;
  /** kg CO₂ per year. */
  co2Pt: number | null;
  co2Car: number | null;
  ratioClass: RatioClass;
  error: string | null;
}

export type AnalysisStatus = 'queued' | 'running' | 'done' | 'failed';

export interface AnalysisSettings {
  /** Option kinds computed per person. */
  kinds: string[];
  weeksOff: number;
  carCostPerKm: number;
  parkingAtWorkPerMonth: number;
}

/** Assumptions behind the car figures of one analysis; stated once, not per person. */
export interface CarStamp {
  /** Rush-hour factor applied to the car's driving time. */
  peakFactor: number;
  /** True when the factor is worked out per route from how built-up it is. */
  peakAuto?: boolean;
  /** Minutes added at the destination to park and walk to the door. */
  parkingMin: number;
  /** False when the parking time was set by hand. */
  parkingAuto: boolean;
}

export interface AnalysisStamp {
  car: CarStamp | null;
  /** Data versions used (timetable, streets, tariffs, parking). */
  data: Record<string, string> | null;
}

export interface Analysis {
  id: string;
  listId: string;
  name: string;
  site: { label: string; lat: number; lon: number };
  arrival: { from: string; to: string };
  weekdays: string[];
  settings: AnalysisSettings;
  status: AnalysisStatus;
  /** The list changed after this analysis ran. */
  outdated: boolean;
  progress: number;
  total: number;
  error: string | null;
  stamp: AnalysisStamp | null;
  createdAt: string;
  finishedAt: string | null;
}

/** Key figures of one analysis (suite requirements AN-20 to AN-23). */
export interface Indicators {
  people: number;
  /** People with a usable position and a result. */
  analysed: number;
  /** Shares 0–1 of analysed people. */
  ptWithin: { min30: number; min45: number; min60: number };
  bikeWithin20: number;
  ebikeWithin30: number;
  walkWithin20: number;
  ratio: Record<RatioClass, number>;
  median: { pt: number | null; car: number | null; bike: number | null; ebike: number | null };
  /** Stops people would board at, most used first. */
  boardStops: { name: string; people: number }[];
  /** People per potential segment (thresholds in the indicators module). */
  segments: { goodPt: number; cycling: number; noAlternative: number };
  /** Breakdown of the same figures by one uploaded attribute, when asked for. */
  by?: { attribute: string; groups: { value: string; indicators: Omit<Indicators, 'by'> }[] };
}
