import type { BrandHit, Departure, DeparturesResponse, DetailMode, Mode, OpenState, PlaceHit, PlaceSummary, RoutesResponse, SearchResponse, SearchResult, Suggestion, Target } from '../../src/api';
import { REGION } from './region';
import { FOOD_BY_KEY } from '../../src/foods';
import { KIND_SEARCH_BY_KEY, kindInfo } from '../../src/kinds';
import { foodLabel, kindName, LANG, LOCALE, searchLabel, t } from './i18n';

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
  geocode: (q: string, signal?: AbortSignal, near?: Here | null, type?: 'stop') =>
    get<PlaceHit[]>(`/api/geocode?q=${encodeURIComponent(q)}${at(near ?? null)}${type ? `&type=${type}` : ''}&lang=${LANG}`, signal),
  /** A stop's next departures. */
  departures: (stopId: string, signal?: AbortSignal) => get<DeparturesResponse>(`/api/stops/departures?id=${encodeURIComponent(stopId)}`, signal),
  /** The way to an address the geocoder found. */
  route: (to: PlaceHit, here: Here, signal?: AbortSignal) =>
    get<RoutesResponse>(`/api/route?toLat=${to.lat}&toLon=${to.lon}&label=${encodeURIComponent(to.label)}${at(here)}`, signal),
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
  return { target: { type: 'food', key }, label: f ? foodLabel(key) : key, emoji: f?.emoji ?? '🍽️' };
}

export function kindSearch(key: string): Searched {
  const k = KIND_SEARCH_BY_KEY.get(key);
  return { target: { type: 'kind', key }, label: k ? searchLabel(key) : key, emoji: k?.emoji ?? '📍' };
}

export function brandSearch(b: Pick<BrandHit, 'key' | 'name' | 'kindKey' | 'kind'>): Searched {
  return { target: { type: 'brand', key: b.key }, label: b.name, emoji: kindInfo(b.kindKey, b.kind).emoji };
}

export function nameSearch(key: string): Searched {
  return { target: { type: 'name', key }, label: LANG === 'en' ? `“${key}”` : LANG === 'fr' ? `« ${key} »` : `«${key}»`, emoji: '🔎' };
}

/** Straight-line distance, metres. */
export function distanceTo(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** Units: min, h, m, km; in Ukrainian хв, год, м, км. */
export const UNIT = LANG === 'uk' ? { min: 'хв', h: 'год', m: 'м', km: 'км' } : { min: 'min', h: 'h', m: 'm', km: 'km' };

export function minutes(m: number): string {
  if (m < 60) return `${m} ${UNIT.min}`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} ${UNIT.h} ${String(r).padStart(2, '0')}` : `${h} ${UNIT.h}`;
}

export function distance(m: number): string {
  if (m < 950) return `${Math.max(10, Math.round(m / 10) * 10)} ${UNIT.m}`;
  return `${(m / 1000).toLocaleString(LOCALE, { maximumFractionDigits: m < 9500 ? 1 : 0 })} ${UNIT.km}`;
}

export function clock(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, { timeZone: REGION.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

/** A day's name, 0 Sunday … 6 Saturday (7 January 2024 was a Sunday). */
const dayName = (d: number) => new Intl.DateTimeFormat(LOCALE, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 7 + d)));

export function openLabel(o: OpenState | null): { text: string; tone: 'open' | 'closed' | 'unknown' } | null {
  if (!o) return null;
  const when = o.changesAt ? (o.changesDay !== undefined ? t('open.dayAt', { day: dayName(o.changesDay), time: o.changesAt }) : t('open.at', { time: o.changesAt })) : '';
  if (o.open === true) return { text: when ? t('open.closes', { when }) : t('open.open'), tone: 'open' };
  if (o.open === false) return { text: when ? t('open.opens', { when }) : t('open.closed'), tone: 'closed' };
  return { text: t('open.unknown'), tone: 'unknown' };
}


export const MODE: Record<DetailMode, { emoji: string; label: string }> = {
  sharing: { emoji: '🔑', label: t('mode.sharing') },
  walk: { emoji: '🚶', label: t('mode.walk') },
  bike: { emoji: '🚲', label: t('mode.bike') },
  transit: { emoji: '🚆', label: t('mode.transit') },
  car: { emoji: '🚗', label: t('mode.car') },
};

export type Sort = 'best' | Mode;

export function timeOf(r: SearchResult, mode: Mode): number | null {
  return mode === 'walk' ? r.walkMin : mode === 'bike' ? (r.bikeMin ?? null) : mode === 'car' ? r.carMin : r.transitMin;
}

/** A walk this short is the way to go, whatever the car says (minutes). */
export const SHORT_WALK_MIN = 12;

/** The way shown first for a place: walking when it is short, else the quickest of walking, public transport and the car. */
export function bestMode(r: Pick<SearchResult, 'walkMin' | 'carMin' | 'transitMin'>): Mode | null {
  if (r.walkMin !== null && r.walkMin <= SHORT_WALK_MIN && (r.transitMin === null || r.walkMin <= r.transitMin)) return 'walk';
  const ways = (
    [
      ['walk', r.walkMin],
      ['transit', r.transitMin],
      // Car times are door to door: the traffic of the hour and parking are in (server/traffic.ts).
      ['car', r.carMin],
    ] as [Mode, number | null][]
  ).filter((x): x is [Mode, number] => x[1] !== null);
  return ways.sort((a, b) => a[1] - b[1])[0]?.[0] ?? null;
}

/**
 * Without a car: public transport, or walking when it is as quick (public transport is only given
 * when it beats walking, so a place next door has a walking time only).
 */
export function noCarMode(r: Pick<SearchResult, 'walkMin' | 'transitMin'>): Mode | null {
  if (r.walkMin !== null && (r.transitMin === null || r.walkMin <= r.transitMin)) return 'walk';
  return r.transitMin !== null ? 'transit' : null;
}

/**
 * The way a sort puts forward for a place: "le plus rapide" (walking, public transport or the car:
 * not everyone has a bike at hand); without a car (🚆); on foot or by bike, or by public transport
 * when it is too far (🚶, 🚲); by car.
 */
export function leadMode(r: SearchResult, sort: Sort): Mode | null {
  if (sort === 'best') return bestMode(r);
  if (sort === 'transit') return noCarMode(r);
  if (sort === 'walk') return r.walkMin !== null ? 'walk' : r.transitMin !== null ? 'transit' : null;
  // By bike, or by public transport beyond 25 km.
  if (sort === 'bike') return r.bikeMin != null ? 'bike' : r.transitMin !== null ? 'transit' : null;
  return timeOf(r, sort) !== null ? sort : null;
}

/** Sorted by the way shown first, by the way without a car, or by one way of going. */
export function sortResults(list: SearchResult[], sort: Sort): SearchResult[] {
  const key = (r: SearchResult) => {
    const m = leadMode(r, sort);
    const t = m ? timeOf(r, m) : null;
    if (t === null) return Infinity;
    return t;
  };
  return [...list].sort((a, b) => key(a) - key(b) || a.distanceM - b.distanceM);
}

/** A departure's mode → pictogram. */
export const DEPARTURE_EMOJI: Record<Departure['mode'], string> = { rail: '🚆', tram: '🚊', metro: '🚇', trolleybus: '🚎', bus: '🚌', boat: '⛴️', cableway: '🚡', funicular: '🚞', other: '🚏' };

/** A stop's pictogram: its main mode's (a station with buses is a station). */
export function stopEmoji(modes: Departure['mode'][] | undefined): string {
  return modes?.length ? DEPARTURE_EMOJI[modes[0]!] : '🚏';
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
  return kindName(r.kindKey, r.kind);
}
