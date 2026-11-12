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

export interface RestaurantSummary {
  id: number;
  name: string;
  /** OSM amenity: restaurant, fast_food, cafe, ice_cream, food_court, biergarten. */
  kind: string;
  town: string | null;
  lat: number;
  lon: number;
  foods: string[];
  /** Straight-line distance from the searcher, metres. */
  distanceM: number;
  /** Now; null without opening hours. */
  open: OpenState | null;
}

export interface SearchResult extends RestaurantSummary {
  walkMin: number | null;
  carMin: number | null;
  /** Leaving now with public transport, waiting included; null when walking is as fast or nothing goes. */
  transitMin: number | null;
}

export interface SearchResponse {
  food: string;
  results: SearchResult[];
  /** The search used the same weekday of another week (the timetable does not cover today). */
  typicalTimetable: boolean;
}

export interface Suggestion {
  foods: string[];
  restaurants: (RestaurantSummary & { foods: string[] })[];
}

export interface RestaurantDetail extends RestaurantSummary {
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
  restaurant: RestaurantDetail;
  walk: StreetOption | null;
  car: StreetOption | null;
  /** The next departures, earliest first. */
  transit: TransitOption[];
  typicalTimetable: boolean;
}

export interface PlaceHit {
  label: string;
  lat: number;
  lon: number;
}
