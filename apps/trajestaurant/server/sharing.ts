import type { FreeVehicle } from '../src/api.js';

/**
 * Shared vehicles, live from the national shared-mobility feed (GBFS v2, sharedmobility.ch): the
 * cars and bikes at the sharing stations, and the scooters, bikes and mopeds parked anywhere
 * (free floating). The feed asks for a contact e-mail address in the Authorization header
 * (SHAREDMOBILITY_CONTACT); without it, stations are shown without their vehicles and there are
 * no free vehicles.
 *
 * A station's count is the vehicles the provider reports there now: whether one is free at a
 * given time depends on bookings, which the feed does not tell (Mobility, 2EM are booked in their
 * apps).
 */
const BASE = 'https://gbfs.prod.sharedmobility.ch/v2/gbfs';
/** The providers of car-sharing stations (import/carsharing.py keeps their stations). */
export const SHARING_PROVIDERS = ['mobility', '2em_cars', 'edrivecarsharing', 'quickrent', 'sponti', 'share_birrer_ch', 'carvelo2go'];
/** Station-based bike sharing: a provider id starting with one of these (as import/carsharing.py). */
export const BIKE_PROVIDERS = ['velospot', 'donkey_', 'nextbike_', 'carvelo2go', 'pickebike_', 'publibike', 'liemobil_', 'epfl_'];
/** The feed refreshes its counts every minute; asking again within that is pointless. */
const STATUS_TTL_MS = 2 * 60_000;
const FREE_TTL_MS = 60_000;
/** One asking of the feed gives up after this. */
const FETCH_TIMEOUT_MS = 20_000;
/** After a failed asking, the next one this much later. */
const RETRY_MS = 30_000;
/** Before anything is known (just after the start), how long an answer waits for the feed. */
const FIRST_WAIT_MS = 1_500;
/** What vehicle types are and the list of providers change rarely: asked again after a day. */
const SLOW_TTL_MS = 24 * 3_600_000;

interface StationStatus {
  station_id: string;
  num_bikes_available?: number;
  num_vehicles_available?: number;
  vehicle_types_available?: { vehicle_type_id: string; count: number }[];
  is_renting?: boolean;
}

interface FreeBike {
  bike_id: string;
  lat: number;
  lon: number;
  vehicle_type_id?: string;
  is_reserved?: boolean;
  is_disabled?: boolean;
  current_range_meters?: number;
  station_id?: string;
}

interface VehicleType {
  vehicle_type_id: string;
  form_factor: string;
  propulsion_type?: string;
}

export interface CarSharing {
  /** Cars at a station ("mobility:70844"), null when unknown (no feed, or a station it does not list). */
  cars(stationKey: string): Promise<number | null>;
  /** Bikes at a bike-sharing station ("velospot:123#bike"), null when unknown. */
  bikes(stationKey: string): Promise<number | null>;
  /** Free-floating vehicles in a box (min and max as [lat, lon]), not those parked at a station. */
  vehicles(min: [number, number], max: [number, number]): Promise<FreeVehicle[]>;
  readonly live: boolean;
}

/** What a vehicle is, for the map: a form factor and its motor. */
export function vehicleKind(t: Pick<VehicleType, 'form_factor' | 'propulsion_type'> | undefined): FreeVehicle['kind'] {
  if (!t) return 'bike';
  if (t.form_factor === 'car') return 'car';
  if (t.form_factor === 'moped') return 'moped';
  if (t.form_factor === 'cargo_bicycle') return 'cargo';
  if (t.form_factor.startsWith('scooter')) return 'scooter';
  if (t.form_factor === 'bicycle' || t.form_factor === 'bike') return /electric/.test(t.propulsion_type ?? '') ? 'ebike' : 'bike';
  return 'other';
}

/** Short names of the providers, as people say them (a provider id starts with the key). */
const NAMES: [string, string][] = [
  ['mobility', 'Mobility'], ['2em_cars', '2EM'], ['velospot', 'Velospot'], ['donkey_', 'Donkey Republic'], ['nextbike_', 'nextbike'],
  ['carvelo2go', 'carvelo2go'], ['pickebike_', 'PickeBike'], ['publibike', 'PubliBike'], ['liemobil_', 'LIEmobil'], ['epfl_', 'EPFL Bike'],
  ['bird', 'Bird'], ['lime_', 'Lime'], ['voiscooters', 'Voi'], ['dott_', 'Dott'], ['bolt_', 'Bolt'], ['sponti', 'Sponti-Car'],
];
export const providerName = (id: string) => NAMES.find(([k]) => id === k || (k.endsWith('_') && id.startsWith(k)) || (k === 'bird' && id.startsWith('bird')))?.[1] ?? id;

const BIKES = new Set(['bicycle', 'cargo_bicycle', 'bike']);

export function createCarSharing(contact: string | undefined, get: typeof fetch): CarSharing {
  if (!contact || !contact.includes('@')) return { live: false, cars: async () => null, bikes: async () => null, vehicles: async () => [] };
  const headers = { Authorization: contact };
  const call = async <T>(path: string): Promise<T> => {
    const r = await get(`${BASE}${path ? `/${path}` : ''}`, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!r.ok) throw new Error(`sharedmobility ${path} ${r.status}`);
    return (await r.json()) as T;
  };
  /**
   * A value kept and refreshed in the background: an answer never waits for the feed. Once a
   * value is known, it is given at once, and asked again behind the scenes when older than ttl;
   * a failed asking keeps the value and tries again RETRY_MS later. Before the first value, a
   * caller waits at most FIRST_WAIT_MS, then gets the fallback (the asking goes on).
   */
  const cached = <T>(ttl: number) => {
    const m = new Map<string, { at: number; value?: { v: T }; loading?: Promise<T> }>();
    return (key: string, load: () => Promise<T>, fallback: T): Promise<T> => {
      let e = m.get(key);
      if (!e) m.set(key, (e = { at: 0 }));
      const entry = e;
      if (Date.now() - entry.at >= ttl && !entry.loading) {
        entry.loading = load()
          .then((v) => {
            entry.value = { v };
            entry.at = Date.now();
            return v;
          })
          .catch((err: unknown) => {
            console.error('shared mobility', key, (err as Error).message);
            entry.at = Date.now() - ttl + RETRY_MS;
            return entry.value ? entry.value.v : fallback;
          })
          .finally(() => {
            entry.loading = undefined;
          });
      }
      if (entry.value) return Promise.resolve(entry.value.v);
      const loading = entry.loading ?? Promise.resolve(fallback);
      return Promise.race([loading, new Promise<T>((r) => setTimeout(() => r(fallback), FIRST_WAIT_MS).unref())]);
    };
  };
  const typesCache = cached<Map<string, VehicleType>>(SLOW_TTL_MS);
  const typesOf = (provider: string) =>
    typesCache(provider, () => call<{ data: { vehicle_types: VehicleType[] } }>(`${provider}/vehicle_types`).then((d) => new Map(d.data.vehicle_types.map((v) => [v.vehicle_type_id, v]))), new Map());

  const statusCache = cached<Map<string, { car: number; bike: number }>>(STATUS_TTL_MS);
  const countsOf = (provider: string) =>
    statusCache(
      provider,
      () =>
        Promise.all([typesOf(provider), call<{ data: { stations: StationStatus[] } }>(`${provider}/station_status`)]).then(([types, d]) => {
          const m = new Map<string, { car: number; bike: number }>();
          for (const s of d.data.stations) {
            const n = { car: 0, bike: 0 };
            if (s.vehicle_types_available?.length) {
              for (const t of s.vehicle_types_available) {
                const f = types.get(t.vehicle_type_id)?.form_factor ?? '';
                if (f === 'car') n.car += t.count;
                else if (BIKES.has(f)) n.bike += t.count;
              }
            } else {
              n.car = s.num_vehicles_available ?? s.num_bikes_available ?? 0;
              n.bike = s.num_bikes_available ?? s.num_vehicles_available ?? 0;
            }
            m.set(s.station_id, s.is_renting === false ? { car: 0, bike: 0 } : n);
          }
          return m;
        }),
      new Map(),
    );
  const count = async (stationKey: string, what: 'car' | 'bike') => {
    const key = stationKey.replace(/#bike$/, '');
    const i = key.indexOf(':');
    const provider = key.slice(0, i);
    const known = what === 'car' ? SHARING_PROVIDERS.includes(provider) : BIKE_PROVIDERS.some((p) => provider.startsWith(p));
    if (!known) return null;
    asked.add(provider);
    return (await countsOf(provider)).get(key.slice(i + 1))?.[what] ?? null;
  };
  // The counts of the car-sharing providers, and of any provider asked for since the start, are
  // kept fresh in the background: a place's card reads what is there.
  const asked = new Set<string>(SHARING_PROVIDERS);
  const refresh = () => {
    for (const p of asked) void countsOf(p);
  };
  refresh();
  setInterval(refresh, STATUS_TTL_MS).unref();

  // Free floating: the providers that list vehicles, their vehicles, and where each one operates.
  const systemsCache = cached<string[]>(SLOW_TTL_MS);
  const freeProviders = () =>
    systemsCache(
      'systems',
      async () => {
        const systems = (await call<{ systems: { id: string }[] }>('')).systems.map((s) => s.id).filter((id) => id !== 'mybuxi_ch');
        const withFree = await Promise.all(
          systems.map((id) =>
            call<{ data: { en: { feeds: { name: string }[] } } }>(`${id}/gbfs`)
              .then((d) => (d.data.en.feeds.some((f) => f.name === 'free_bike_status') ? id : null))
              .catch(() => null),
          ),
        );
        return withFree.filter((x): x is string => x !== null);
      },
      [],
    );
  const freeCache = cached<{ list: FreeVehicle[]; box: [number, number, number, number] | null }>(FREE_TTL_MS);
  const freeOf = (provider: string) =>
    freeCache(
      provider,
      async () => {
        const [types, d] = await Promise.all([typesOf(provider), call<{ data: { bikes: FreeBike[] } }>(`${provider}/free_bike_status`)]);
        const brand = providerName(provider);
        const list: FreeVehicle[] = [];
        let box: [number, number, number, number] | null = null;
        for (const b of d.data.bikes ?? []) {
          if (b.is_disabled || b.is_reserved || b.station_id || !Number.isFinite(b.lat) || !Number.isFinite(b.lon)) continue;
          box = box ? [Math.min(box[0], b.lat), Math.min(box[1], b.lon), Math.max(box[2], b.lat), Math.max(box[3], b.lon)] : [b.lat, b.lon, b.lat, b.lon];
          list.push({
            id: `${provider}:${b.bike_id}`,
            provider: brand,
            kind: vehicleKind(b.vehicle_type_id ? types.get(b.vehicle_type_id) : undefined),
            lat: b.lat,
            lon: b.lon,
            ...(typeof b.current_range_meters === 'number' ? { rangeKm: Math.round(b.current_range_meters / 1000) } : {}),
          });
        }
        return { list, box };
      },
      { list: [], box: null },
    );
  /** Where each provider's vehicles were last seen: only those around the box asked for are fetched again. */
  const areas = new Map<string, [number, number, number, number] | null>();

  return {
    live: true,
    cars: (k) => count(k, 'car'),
    bikes: (k) => count(k, 'bike'),
    async vehicles(min, max) {
      const providers = await freeProviders();
      const near = (a: [number, number, number, number] | null | undefined) =>
        a === undefined || (a !== null && a[0] - 0.05 <= max[0] && a[2] + 0.05 >= min[0] && a[1] - 0.05 <= max[1] && a[3] + 0.05 >= min[1]);
      const results = await Promise.all(
        providers.filter((p) => near(areas.get(p))).map(async (p) => {
          const r = await freeOf(p);
          areas.set(p, r.box);
          return r.list;
        }),
      );
      return results.flat().filter((v) => v.lat >= min[0] && v.lat <= max[0] && v.lon >= min[1] && v.lon <= max[1]);
    },
  };
}
