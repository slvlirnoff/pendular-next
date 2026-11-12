import type { BrandHit, Mode, OpenState, PlaceHit, PlaceSummary, RoutesResponse, SearchResponse, SearchResult, Suggestion, Target } from '../../src/api';
import { FOOD_BY_KEY } from '../../src/foods';
import { KIND_SEARCH_BY_KEY, kindInfo } from '../../src/kinds';

export interface Here {
  lat: number;
  lon: number;
  label: string;
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(path, { signal });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return (await r.json()) as T;
}

const at = (h: Here | null) => (h ? `&lat=${h.lat.toFixed(5)}&lon=${h.lon.toFixed(5)}` : '');

export const api = {
  suggest: (q: string, here: Here | null, signal?: AbortSignal) => get<Suggestion>(`/api/suggest?q=${encodeURIComponent(q)}${at(here)}`, signal),
  search: (t: Target, here: Here, signal?: AbortSignal) => get<SearchResponse>(`/api/search?${t.type}=${encodeURIComponent(t.key)}${at(here)}`, signal),
  place: (id: number, here: Here, signal?: AbortSignal) => get<RoutesResponse>(`/api/places/${id}?x=1${at(here)}`, signal),
  where: (lat: number, lon: number) => get<{ town: string | null }>(`/api/where?lat=${lat}&lon=${lon}`),
  geocode: (q: string, signal?: AbortSignal) => get<PlaceHit[]>(`/api/geocode?q=${encodeURIComponent(q)}`, signal),
  popularBrands: () => get<BrandHit[]>('/api/brands/popular'),
};

/** A search as shown: what it is for, its title and its pictogram. */
export interface Searched {
  target: Target;
  label: string;
  emoji: string;
}

export function foodSearch(key: string): Searched {
  const f = FOOD_BY_KEY.get(key);
  return { target: { type: 'food', key }, label: f?.label ?? key, emoji: f?.emoji ?? '🍽️' };
}

export function kindSearch(key: string): Searched {
  const k = KIND_SEARCH_BY_KEY.get(key);
  return { target: { type: 'kind', key }, label: k?.label ?? key, emoji: k?.emoji ?? '📍' };
}

export function brandSearch(b: Pick<BrandHit, 'key' | 'name' | 'kindKey' | 'kind'>): Searched {
  return { target: { type: 'brand', key: b.key }, label: b.name, emoji: kindInfo(b.kindKey, b.kind).emoji };
}

export function nameSearch(key: string): Searched {
  return { target: { type: 'name', key }, label: `« ${key} »`, emoji: '🔎' };
}

export function minutes(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
}

export function distance(m: number): string {
  if (m < 950) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toLocaleString('fr-CH', { maximumFractionDigits: m < 9500 ? 1 : 0 })} km`;
}

export function clock(iso: string): string {
  return new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

export function openLabel(o: OpenState | null): { text: string; tone: 'open' | 'closed' | 'unknown' } | null {
  if (!o) return null;
  const when = o.changesAt ? `${o.changesDay !== undefined ? `${DAYS[o.changesDay]} ` : ''}à ${o.changesAt}` : '';
  if (o.open === true) return { text: when ? `Ouvert · ferme ${when}` : 'Ouvert', tone: 'open' };
  if (o.open === false) return { text: when ? `Fermé · ouvre ${when}` : 'Fermé', tone: 'closed' };
  return { text: 'Horaires à vérifier', tone: 'unknown' };
}


export const MODE: Record<Mode, { emoji: string; label: string }> = {
  walk: { emoji: '🚶', label: 'À pied' },
  transit: { emoji: '🚆', label: 'Transports publics' },
  car: { emoji: '🚗', label: 'Voiture' },
};

export type Sort = 'best' | Mode;

export function timeOf(r: SearchResult, mode: Mode): number | null {
  return mode === 'walk' ? r.walkMin : mode === 'car' ? r.carMin : r.transitMin;
}

/** A walk this short is the way to go: the car would still need parking (minutes). */
export const SHORT_WALK_MIN = 12;
/** Parking and walking to the door, which car times leave out, when car and other ways are compared (minutes). */
export const CAR_PARKING_MIN = 5;

/**
 * The way shown first for a place: walking when it is short, else the quickest of walking, public
 * transport and the car, the car counted with its parking.
 */
export function bestMode(r: Pick<SearchResult, 'walkMin' | 'carMin' | 'transitMin'>): Mode | null {
  if (r.walkMin !== null && r.walkMin <= SHORT_WALK_MIN && (r.transitMin === null || r.walkMin <= r.transitMin)) return 'walk';
  const ways = (
    [
      ['walk', r.walkMin],
      ['transit', r.transitMin],
      ['car', r.carMin === null ? null : r.carMin + CAR_PARKING_MIN],
    ] as [Mode, number | null][]
  ).filter((x): x is [Mode, number] => x[1] !== null);
  return ways.sort((a, b) => a[1] - b[1])[0]?.[0] ?? null;
}

/** Sorted by the way shown first (car with its parking), or by one way of going. */
export function sortResults(list: SearchResult[], sort: Sort): SearchResult[] {
  const key = (r: SearchResult) => {
    const m = sort === 'best' ? bestMode(r) : sort;
    const t = m ? timeOf(r, m) : null;
    if (t === null) return Infinity;
    return sort === 'best' && m === 'car' ? t + CAR_PARKING_MIN : t;
  };
  return [...list].sort((a, b) => key(a) - key(b) || a.distanceM - b.distanceM);
}

/** Leg mode → pictogram. */
export function legEmoji(mode: string): string {
  switch (mode) {
    case 'walk':
      return '🚶';
    case 'car':
      return '🚗';
    case 'bike':
    case 'ebike':
    case 'sharedBike':
      return '🚲';
    case 'bus':
      return '🚌';
    case 'tram':
      return '🚋';
    case 'metro':
      return '🚇';
    case 'boat':
      return '⛴️';
    case 'funicular':
    case 'cableway':
      return '🚡';
    default:
      return '🚆';
  }
}

/**
 * The pictogram of a place: the food searched for when it serves it, else its most specific food,
 * else its kind (🛒 supermarket, 👟 shoes…).
 */
export function placeEmoji(r: Pick<PlaceSummary, 'foods' | 'kindKey' | 'kind'>, target: Target | null): string {
  if (target?.type === 'food' && r.foods.includes(target.key)) return FOOD_BY_KEY.get(target.key)?.emoji ?? '🍽️';
  const specific = r.foods.find((f) => !FOOD_BY_KEY.get(f)?.generic);
  if (specific) return FOOD_BY_KEY.get(specific)!.emoji;
  return kindInfo(r.kindKey, r.kind).emoji;
}

export function kindLabel(r: Pick<PlaceSummary, 'kindKey' | 'kind'>): string {
  return kindInfo(r.kindKey, r.kind).label;
}
