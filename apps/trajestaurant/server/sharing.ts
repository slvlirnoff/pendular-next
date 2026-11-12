/**
 * Cars at the car-sharing stations, from the national shared-mobility feed (GBFS v2,
 * sharedmobility.ch). The feed asks for a contact e-mail address in the Authorization header
 * (SHAREDMOBILITY_CONTACT); without it, stations are shown without their cars.
 *
 * The count is the cars the provider reports at the station: whether one is free at a given time
 * depends on bookings, which the feed does not tell (Mobility, 2EM are booked in their apps).
 */
const BASE = 'https://gbfs.prod.sharedmobility.ch/v2/gbfs';
/** The providers of car-sharing stations (import/carsharing.py keeps their stations). */
export const SHARING_PROVIDERS = ['mobility', '2em_cars', 'edrivecarsharing', 'quickrent', 'sponti', 'share_birrer_ch', 'carvelo2go'];
/** The feed refreshes its counts every minute; asking again within two is pointless. */
const TTL_MS = 2 * 60_000;

interface StationStatus {
  station_id: string;
  num_bikes_available?: number;
  num_vehicles_available?: number;
  vehicle_types_available?: { vehicle_type_id: string; count: number }[];
  is_renting?: boolean;
}

export interface CarSharing {
  /** Cars at a station ("mobility:70844"), null when unknown (no feed, or a station it does not list). */
  cars(stationKey: string): Promise<number | null>;
  readonly live: boolean;
}

export function createCarSharing(contact: string | undefined, get: typeof fetch): CarSharing {
  if (!contact || !contact.includes('@')) return { live: false, cars: async () => null };
  const headers = { Authorization: contact };
  const call = async <T>(path: string): Promise<T> => {
    const r = await get(`${BASE}/${path}`, { headers });
    if (!r.ok) throw new Error(`sharedmobility ${path} ${r.status}`);
    return (await r.json()) as T;
  };
  /** Car vehicle types per provider: they do not change within a day. */
  const carTypes = new Map<string, Promise<Set<string>>>();
  const typesOf = (provider: string) => {
    let t = carTypes.get(provider);
    if (!t) {
      t = call<{ data: { vehicle_types: { vehicle_type_id: string; form_factor: string }[] } }>(`${provider}/vehicle_types`)
        .then((d) => new Set(d.data.vehicle_types.filter((v) => v.form_factor === 'car').map((v) => v.vehicle_type_id)))
        .catch(() => {
          carTypes.delete(provider);
          return new Set<string>();
        });
      carTypes.set(provider, t);
    }
    return t;
  };
  const status = new Map<string, { at: number; counts: Promise<Map<string, number>> }>();
  const countsOf = (provider: string) => {
    const hit = status.get(provider);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.counts;
    const counts = Promise.all([typesOf(provider), call<{ data: { stations: StationStatus[] } }>(`${provider}/station_status`)])
      .then(([cars, d]) => {
        const m = new Map<string, number>();
        for (const s of d.data.stations) {
          const byType = s.vehicle_types_available;
          const n = byType?.length ? byType.filter((t) => cars.has(t.vehicle_type_id)).reduce((a, t) => a + t.count, 0) : (s.num_vehicles_available ?? s.num_bikes_available ?? 0);
          m.set(s.station_id, s.is_renting === false ? 0 : n);
        }
        return m;
      })
      .catch((e: unknown) => {
        console.error('car sharing status', provider, (e as Error).message);
        status.delete(provider);
        return new Map<string, number>();
      });
    status.set(provider, { at: Date.now(), counts });
    return counts;
  };
  return {
    live: true,
    async cars(stationKey) {
      const i = stationKey.indexOf(':');
      const provider = stationKey.slice(0, i);
      if (!SHARING_PROVIDERS.includes(provider)) return null;
      const counts = await countsOf(provider);
      return counts.get(stationKey.slice(i + 1)) ?? null;
    },
  };
}
