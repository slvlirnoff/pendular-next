/** What the Trajestaurant API answers: shared by the server and the site. */

export type Mode = 'walk' | 'transit' | 'car';

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
  walkMin: number | null;
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

export interface PlaceDetail extends PlaceSummary {
  address: string | null;
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
  durationMin: number;
  distanceM: number;
  geometry: [number, number][];
}

export interface TransitOption {
  departure: string;
  arrival: string;
  durationMin: number;
  changes: number;
  legs: RouteLeg[];
}

export interface RoutesResponse {
  place: PlaceDetail;
  walk: StreetOption | null;
  car: StreetOption | null;
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
}
