import type { Itinerary, LatLon } from '@pendular/engine';
import type { PlaceDetail, RouteLeg, RoutesResponse, SharingOption, StreetOption, TransitOption } from '../src/api.js';
import type { Traffic } from './traffic.js';
import { distanceM } from './estimate.js';
import { openState } from './open.js';
import { sortFoods, type SearchDeps } from './search.js';
import { localNow, routingDate } from './timetable.js';
import { clockOf, createTraffic } from './traffic.js';

/** Walking is not offered beyond this straight-line distance, metres (about an hour and a half). */
const MAX_WALK_M = 7_000;
/** Departures looked for after now, minutes (a far branch may be reached on the next train only). */
const TRANSIT_WINDOW_MIN = 120;
const MAX_DEPARTURES = 4;

interface DetailRow {
  id: string;
  source: string;
  source_id: string;
  sources: string[];
  name: string;
  kind_key: string;
  kind: string;
  cuisine: string | null;
  brand: string | null;
  lat: number;
  lon: number;
  street: string | null;
  housenumber: string | null;
  postcode: string | null;
  town: string | null;
  opening_hours: string | null;
  phone: string | null;
  website: string | null;
  takeaway: string | null;
  delivery: string | null;
  outdoor_seating: string | null;
  wheelchair: string | null;
  vegetarian: string | null;
  vegan: string | null;
  foods: string[];
}

const OSM_TYPES: Record<string, string> = { n: 'node', w: 'way', r: 'relation' };

export async function placeDetail(deps: SearchDeps, id: number, from: LatLon | null, now = new Date()): Promise<PlaceDetail | null> {
  const res = await deps.db.query<DetailRow>(
    `select p.*, st_y(p.geom::geometry) as lat, st_x(p.geom::geometry) as lon,
       array(select food from place_food f where f.place_id = p.id) as foods
     from place p where p.id = $1`,
    [id],
  );
  const r = res.rows[0];
  if (!r) return null;
  const line1 = [r.street, r.housenumber].filter(Boolean).join(' ');
  const line2 = [r.postcode, r.town].filter(Boolean).join(' ');
  const osmType = r.source === 'osm' ? OSM_TYPES[r.source_id[0] ?? ''] : undefined;
  return {
    id: Number(r.id),
    name: r.name,
    kindKey: r.kind_key,
    kind: r.kind,
    town: r.town,
    lat: r.lat,
    lon: r.lon,
    foods: sortFoods(r.foods),
    distanceM: from ? Math.round(distanceM(from, r)) : 0,
    open: openState(r.opening_hours, r.lat, r.lon, now),
    address: line1 ? [line1, line2].filter(Boolean).join(', ') : null,
    cuisine: r.cuisine,
    brand: r.brand,
    openingHours: r.opening_hours,
    phone: r.phone,
    website: r.website,
    takeaway: r.takeaway,
    delivery: r.delivery,
    outdoorSeating: r.outdoor_seating,
    wheelchair: r.wheelchair,
    vegetarian: r.vegetarian,
    vegan: r.vegan,
    osmUrl: osmType ? `https://www.openstreetmap.org/${osmType}/${r.source_id.slice(1)}` : null,
    sources: r.sources,
  };
}

function toLegs(it: Itinerary): RouteLeg[] {
  return it.legs.map((l) => ({
    mode: l.mode,
    from: l.from.name,
    to: l.to.name,
    departure: l.departure,
    arrival: l.arrival,
    durationMin: l.durationMin,
    distanceM: l.distanceM,
    ...(l.line ? { line: { name: l.line.name, category: l.line.category, headsign: l.line.headsign } } : {}),
    geometry:
      l.geometry && l.geometry.length > 1
        ? l.geometry
        : [l.from, ...(l.intermediateStops ?? []), l.to].map((s) => [s.lon, s.lat] as [number, number]),
  }));
}

const STREET = new Set(['walk', 'bike', 'ebike', 'car', 'sharedBike']);

/** The way there from a place: on foot, by car and the next public transport departures. */
export async function routesTo(deps: SearchDeps, id: number, from: LatLon, now = new Date()): Promise<RoutesResponse | null> {
  const place = await placeDetail(deps, id, from, now);
  if (!place) return null;
  const to = { lat: place.lat, lon: place.lon };
  const local = localNow(now);
  const day = routingDate(local.date, deps.timetable);
  const end = new Date(Date.UTC(2000, 0, 1, +local.time.slice(0, 2), +local.time.slice(3, 5) + TRANSIT_WINDOW_MIN));
  const windowEnd = `${String(end.getUTCHours()).padStart(2, '0')}:${String(end.getUTCMinutes()).padStart(2, '0')}`;

  const clock = clockOf(local.date, local.time);
  const traffic = createTraffic(deps.density, clock.weekday, clock.minutes);
  const street = (profile: 'walk' | 'car'): Promise<StreetOption | null> =>
    (profile === 'car' ? deps.car.route(from, to) : deps.routing.street({ from, to, profile }))
      .then((r) => {
        if (!r || !r.geometry || r.geometry.length < 2) return null;
        const base = { distanceM: Math.round(r.distanceM), geometry: r.geometry };
        if (profile === 'walk') return { ...base, durationMin: Math.max(1, Math.round(r.durationMin)) };
        // By car: the traffic of this hour along the route, and parking at the place.
        const parts = traffic.car(r.durationMin, r.geometry, to);
        return { ...base, durationMin: parts.totalMin, car: parts };
      })
      .catch((e: unknown) => {
        console.error(`${profile} route`, e);
        return null;
      });

  const [walk, car, transit, sharing] = await Promise.all([
    place.distanceM <= MAX_WALK_M ? street('walk') : Promise.resolve(null),
    street('car'),
    deps.routing
      .transit({ from, to, date: day.date, window: { from: local.time, to: windowEnd }, by: 'depart' })
      .catch((e: unknown) => {
        console.error('transit route', e);
        return [] as Itinerary[];
      }),
    place.kind === 'car_sharing'
      ? Promise.resolve(null)
      : sharingOption(deps, from, to, traffic).catch((e: unknown) => {
          console.error('car sharing', e);
          return null;
        }),
  ]);

  // Only trips that use a vehicle, and only those that beat walking.
  const options: TransitOption[] = transit
    .filter((it) => it.legs.some((l) => !STREET.has(l.mode)))
    .filter((it) => !walk || it.durationMin < walk.durationMin)
    .sort((a, b) => a.departure.localeCompare(b.departure))
    .slice(0, MAX_DEPARTURES)
    .map((it) => ({ departure: it.departure, arrival: it.arrival, durationMin: it.durationMin, changes: it.changes, legs: toLegs(it) }));

  // Car sharing only where it helps: not when walking is as quick.
  const usefulSharing = sharing && (!walk || sharing.durationMin < walk.durationMin) ? sharing : null;
  return { place, walk, car, sharing: usefulSharing, transit: options, typicalTimetable: day.typical };
}

/** Car-sharing stations are looked for within this walk of the searcher, metres. */
const SHARING_RADIUS_M = 1_200;

/**
 * By car sharing: the nearest station with cars within a short walk, the walk there, the drive
 * from it (with the traffic of the hour and parking at the place). Null when none is near.
 */
async function sharingOption(deps: SearchDeps, from: LatLon, to: LatLon, traffic: Traffic): Promise<SharingOption | null> {
  const r = await deps.db.query<{ id: string; name: string; brand: string | null; website: string | null; source: string; source_id: string; lat: number; lon: number }>(
    `select p.id, p.name, p.brand, p.website, p.source, p.source_id, st_y(p.geom::geometry) as lat, st_x(p.geom::geometry) as lon
     from place p cross join (select st_setsrid(st_makepoint($2, $1), 4326)::geography as g) o
     where p.kind = 'car_sharing' and st_dwithin(p.geom, o.g, $3)
     order by p.geom <-> o.g limit 6`,
    [from.lat, from.lon, SHARING_RADIUS_M],
  );
  if (r.rows.length === 0) return null;
  const withCars = await Promise.all(r.rows.map(async (s) => ({ ...s, cars: s.source === 'gbfs' ? await deps.sharing.cars(s.source_id) : null })));
  // The nearest station with cars; one whose cars are unknown when the feed is not there.
  const station = withCars.find((s) => (s.cars ?? 1) > 0);
  if (!station) return null;
  const at = { lat: station.lat, lon: station.lon };
  const [walk, drive] = await Promise.all([deps.routing.street({ from, to: at, profile: 'walk' }), deps.car.route(at, to)]);
  if (!walk || !drive || !walk.geometry || drive.geometry.length < 2) return null;
  const parts = traffic.car(drive.durationMin, drive.geometry, to);
  const walkMin = Math.max(1, Math.round(walk.durationMin));
  return {
    station: { id: Number(station.id), name: station.name, brand: station.brand, lat: station.lat, lon: station.lon, cars: station.cars, website: station.website },
    walk: { durationMin: walkMin, distanceM: Math.round(walk.distanceM), geometry: walk.geometry },
    drive: { durationMin: parts.totalMin, distanceM: Math.round(drive.distanceM), geometry: drive.geometry, car: parts },
    durationMin: walkMin + parts.totalMin,
  };
}
