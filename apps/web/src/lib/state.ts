import type { AgeGroup, CommuteRequest, Place, Weekday } from '@pendular/engine/types';

/** Everything the search form holds. It lives in the URL: no accounts, no storage. */
export interface SearchState {
  home: Place | null;
  work: Place | null;
  from: string;
  to: string;
  weekdays: Weekday[];
  weeksOff: number;
  ageGroup: AgeGroup;
  halfFare: boolean;
  firstClass: boolean;
  vaudResident: boolean;
  /** 'full' = TCS full cost, 'running' = running cost only (the car is owned anyway). */
  carCost: 'full' | 'running';
  parkingPerMonth: number;
}

export const CAR_COST = { full: 0.74, running: 0.276 } as const;
const DAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export const DEFAULT_STATE: SearchState = {
  home: null,
  work: null,
  from: '07:00',
  to: '09:00',
  weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
  weeksOff: 5,
  ageGroup: 'adult',
  halfFare: false,
  firstClass: false,
  vaudResident: true,
  carCost: 'full',
  parkingPerMonth: 260,
};

const encPlace = (p: Place) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)},${p.label}`;
function decPlace(v: string | null): Place | null {
  if (!v) return null;
  const [lat, lon, ...rest] = v.split(',');
  const la = Number(lat);
  const lo = Number(lon);
  return Number.isFinite(la) && Number.isFinite(lo) ? { lat: la, lon: lo, label: rest.join(',') || `${la}, ${lo}` } : null;
}

export function toQuery(s: SearchState): string {
  const q = new URLSearchParams();
  if (s.home) q.set('h', encPlace(s.home));
  if (s.work) q.set('w', encPlace(s.work));
  q.set('a', `${s.from.replace(':', '')}-${s.to.replace(':', '')}`);
  q.set('d', s.weekdays.map((d) => DAYS.indexOf(d) + 1).sort().join(''));
  if (s.weeksOff !== DEFAULT_STATE.weeksOff) q.set('off', String(s.weeksOff));
  if (s.ageGroup !== 'adult') q.set('age', s.ageGroup);
  if (s.halfFare) q.set('hf', '1');
  if (s.firstClass) q.set('cl', '1');
  if (!s.vaudResident) q.set('vd', '0');
  if (s.carCost !== 'full') q.set('car', s.carCost);
  if (s.parkingPerMonth !== DEFAULT_STATE.parkingPerMonth) q.set('pk', String(s.parkingPerMonth));
  return q.toString();
}

export function fromQuery(search: string): SearchState {
  const q = new URLSearchParams(search);
  const s: SearchState = { ...DEFAULT_STATE, home: decPlace(q.get('h')), work: decPlace(q.get('w')) };
  const a = /^(\d{2})(\d{2})-(\d{2})(\d{2})$/.exec(q.get('a') ?? '');
  if (a) {
    s.from = `${a[1]}:${a[2]}`;
    s.to = `${a[3]}:${a[4]}`;
  }
  const d = q.get('d');
  if (d) {
    const days = [...d].map((c) => DAYS[Number(c) - 1]).filter((x): x is Weekday => !!x);
    if (days.length) s.weekdays = days;
  }
  const off = Number(q.get('off'));
  if (q.has('off') && off >= 0 && off <= 51) s.weeksOff = off;
  const age = q.get('age');
  if (age === 'child' || age === 'youth' || age === 'senior') s.ageGroup = age;
  s.halfFare = q.get('hf') === '1';
  s.firstClass = q.get('cl') === '1';
  s.vaudResident = q.get('vd') !== '0';
  if (q.get('car') === 'running') s.carCost = 'running';
  const pk = Number(q.get('pk'));
  if (q.has('pk') && pk >= 0 && pk <= 2000) s.parkingPerMonth = pk;
  return s;
}

export function toRequest(s: SearchState): CommuteRequest | null {
  if (!s.home || !s.work) return null;
  return {
    home: s.home,
    work: s.work,
    arrival: { from: s.from, to: s.to },
    pattern: { weekdays: s.weekdays, weeksOff: s.weeksOff },
    traveller: {
      ageGroup: s.ageGroup,
      travelClass: s.firstClass ? 1 : 2,
      halfFare: s.halfFare,
      vaudResident: s.vaudResident,
    },
    car: { costPerKm: CAR_COST[s.carCost], parkingAtWorkPerMonth: s.parkingPerMonth },
  };
}
