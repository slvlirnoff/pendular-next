/** What the Trajestaurant API answers: shared by the server and the site. */

export type Mode = 'walk' | 'bike' | 'transit' | 'car';
/** The ways shown for one place: also car sharing. */
export type DetailMode = Mode | 'sharing';

/** Open or closed at a given time, from the OSM opening hours. */
export interface OpenState {
  /** null: the opening hours do not say (e.g. "on appointment"). */
  open: boolean | null;
  /** When it changes next, local "HH:MM", if within a day. */
  changesAt?: string;
  /** The next change is another day: its weekday (0 = Sunday). */
  changesDay?: number;
}

export interface PlaceSummary {
  id: number;
  name: string;
  /** Main OSM key and value: amenity=restaurant, shop=supermarket… */
  kindKey: string;
  kind: string;
  /** The chain it belongs to, if any. */
  brand: string | null;
  town: string | null;
  lat: number;
  lon: number;
  foods: string[];
  /** Straight-line distance from the searcher, metres. */
  distanceM: number;
  /** Now; null without opening hours. */
  open: OpenState | null;
}

export interface SearchResult extends PlaceSummary {
  /** A car-sharing station: the cars its provider reports there now (null: unknown). */
  cars?: number | null;
  /** A bike-sharing station: the bikes there now (null: unknown). */
  bikes?: number | null;
  walkMin: number | null;
  /** By bike (MOTIS's bike network), for places within 25 km. */
  bikeMin?: number | null;
  /** Door to door: traffic of the hour and parking included. */
  carMin: number | null;
  /** Leaving now with public transport, waiting included; null when walking is as fast or nothing goes. */
  transitMin: number | null;
}

/** What is searched for: a food type, a kind of shop or place, a chain (by its folded name), or places by name. */
export type Target =
  | { type: 'food'; key: string }
  | { type: 'kind'; key: string }
  | { type: 'brand'; key: string }
  | { type: 'name'; key: string };

/** A chain as suggested: its name, the kind of its places and how many there are in Switzerland. */
export interface BrandHit {
  /** Folded name: the search key. */
  key: string;
  name: string;
  kindKey: string;
  kind: string;
  count: number;
}

export interface SearchResponse {
  target: Target;
  /** The chain's name, or the name searched for. */
  label: string;
  results: SearchResult[];
  /** The search used the same weekday of another week (the timetable does not cover today). */
  typicalTimetable: boolean;
}

export interface Suggestion {
  foods: string[];
  /** Kinds of shops and places (src/kinds.ts KIND_SEARCHES keys). */
  kinds: string[];
  brands: BrandHit[];
  /** Places whose name contains the text, when there are several: searching them all by name. */
  named: { key: string; count: number } | null;
  places: PlaceSummary[];
}

/** One day of a place's week: its opening times, local ("08:00"–"12:00", "18:00"–"02:00"). */
export interface DayHours {
  /** 1 Monday … 7 Sunday. */
  weekday: number;
  /** YYYY-MM-DD. */
  date: string;
  intervals: { from: string; to: string; unknown?: boolean; comment?: string }[];
}

/** The opening hours of the coming seven days, today first; stable: every week is the same. */
export interface WeekHours {
  days: DayHours[];
  stable: boolean;
}

/** What the card shows besides the address (all optional). */
export interface PlaceExtra {
  /** A picture of the place (Wikimedia Commons thumbnail or a direct image link). */
  image?: string;
  /** Its logo, else its brand's (Wikimedia Commons thumbnail). */
  logo?: string;
  email?: string;
  instagram?: string;
  facebook?: string;
  /** Medical speciality (OSM healthcare:speciality). */
  speciality?: string;
  description?: string;
  wikidata?: string;
}

export interface PlaceDetail extends PlaceSummary {
  address: string | null;
  /** The opening hours read and laid out by day; null when they could not be read (openingHours as written). */
  hours: WeekHours | null;
  extra: PlaceExtra | null;
  cuisine: string | null;
  brand: string | null;
  openingHours: string | null;
  phone: string | null;
  website: string | null;
  takeaway: string | null;
  delivery: string | null;
  outdoorSeating: string | null;
  wheelchair: string | null;
  vegetarian: string | null;
  vegan: string | null;
  /** Link to the object on openstreetmap.org. */
  osmUrl: string | null;
  /** Where its data comes from: osm, atp (All The Places), overture. */
  sources: string[];
}

export interface RouteLeg {
  /** walk, car, bike, rail, bus, tram, metro, boat, funicular, cableway… */
  mode: string;
  from: string;
  to: string;
  departure: string;
  arrival: string;
  durationMin: number;
  distanceM: number;
  line?: { name: string; category?: string; headsign?: string };
  /** [lon, lat] pairs. */
  geometry: [number, number][];
}

export interface StreetOption {
  /** Door to door; by car, traffic and parking included (see `car`). */
  durationMin: number;
  distanceM: number;
  geometry: [number, number][];
  /** By car: how the time is made up. */
  car?: CarParts;
}

/** A car time as Pendular counts it: driving slowed by the traffic of the hour, then parking. */
export interface CarParts {
  /** On empty roads, as the street network gives it. */
  freeMin: number;
  /** Slow-down of the traffic at this hour along the way (1 = none). */
  factor: number;
  drivingMin: number;
  /** Finding a space and walking to the door, by how dense the destination is. */
  parkingMin: number;
  totalMin: number;
}

export interface TransitOption {
  departure: string;
  arrival: string;
  durationMin: number;
  changes: number;
  legs: RouteLeg[];
}

/**
 * Car sharing there: walk to the nearest station with cars, drive (traffic and parking in), and
 * bring the car back to its station afterwards (Mobility and the others are round trips).
 */
export interface SharingOption {
  station: { id: number; name: string; brand: string | null; lat: number; lon: number; cars: number | null; website: string | null };
  walk: StreetOption;
  drive: StreetOption;
  /** Walk, drive and parking. */
  durationMin: number;
}

export interface RoutesResponse {
  place: PlaceDetail;
  walk: StreetOption | null;
  bike: StreetOption | null;
  car: StreetOption | null;
  /** By car sharing, when a station with cars is within a short walk. */
  sharing: SharingOption | null;
  /** The next departures, earliest first. */
  transit: TransitOption[];
  typicalTimetable: boolean;
}

/** Places shown on the map when nothing is searched: what a map marker needs. */
export interface MapPlaces {
  places: Pick<PlaceSummary, 'id' | 'name' | 'kindKey' | 'kind' | 'brand' | 'town' | 'lat' | 'lon' | 'foods'>[];
  /** More places lie in the area than were sent (the nearest to its centre were). */
  truncated: boolean;
}

export interface PlaceHit {
  label: string;
  lat: number;
  lon: number;
  /** What the geocoder found: a street address, a public transport stop, a named place. */
  type?: 'address' | 'stop' | 'place';
  /** A stop's id in the timetable (its departure board). */
  stopId?: string;
  /** A stop's modes, main first. */
  modes?: Departure['mode'][];
}

/** A shared vehicle parked anywhere (free floating), live. */
export interface FreeVehicle {
  id: string;
  /** Lime, Voi, Bird, Velospot… */
  provider: string;
  kind: 'scooter' | 'bike' | 'ebike' | 'cargo' | 'moped' | 'car' | 'other';
  lat: number;
  lon: number;
  /** What its battery has left, when it says. */
  rangeKm?: number;
}

/** A public transport stop on the map: one per station or stop, its platforms together. */
export interface MapStop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  modes: Departure['mode'][];
}

/** One departure on a stop's board. */
export interface Departure {
  /** Scheduled, local "HH:MM". */
  time: string;
  /** From now (or from now on the typical timetable's day). */
  minutes: number;
  delayMin?: number;
  mode: 'rail' | 'tram' | 'metro' | 'bus' | 'boat' | 'cableway' | 'funicular' | 'other';
  /** Line or train: "R8", "475", "IC 1". */
  line: string;
  direction: string;
  track?: string;
  operator?: string;
  cancelled?: boolean;
}

export interface DeparturesResponse {
  stopId: string;
  name: string | null;
  departures: Departure[];
  typicalTimetable: boolean;
}
