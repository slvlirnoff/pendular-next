/**
 * Builds data/build/parking.json from the opentransportdata.swiss dataset "bike-and-car-parking"
 * (data/raw/bike-and-car-parking.json, GeoJSON).
 *
 * Dataset structure (verified on the real file):
 *  - geometry is a GeometryCollection: first member is the Point; P+Rail records may add a MultiPolygon.
 *  - properties.parkingFacilityType: PARK_AND_RAIL, PARKING, BIKE_PARKING, BIKE_PARKING_COVERED,
 *    BIKE_PARKING_SPACES, BIKE_PARKING_SPACES_COVERED, BIKE_STATION.
 *  - properties.uic: UIC/didok number (8500309…) or null; didokId is the same as a 5-digit string.
 *    There is no SLOID. Several car parks and bike facilities share one uic (one station).
 *  - properties.pricingModel (car parks; null for most bike facilities), amounts in RAPPEN (cents):
 *      maximumDayPrice, monthlyTicketPrice, yearlyTicketPrice, plus *WithPublicTransportSeasonTicketDiscount
 *      variants and priceSegments (hourly tariff steps).
 *  - properties.capacities: [{categoryType: STANDARD | DISABLED_PARKING_SPACE | RESERVABLE_PARKING_SPACE |
 *    WITH_CHARGING_STATION, total}].
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ParkingSite {
  id: string;
  kind: 'parkRail' | 'bikeParking';
  name: string;
  stationName: string | null;
  stationId: string | null;
  stationIdType: 'uic' | 'sloid' | null;
  lat: number;
  lon: number;
  capacity: number | null;
  /** CHF; null when the dataset has no such price. */
  prices: { day: number | null; month: number | null; year: number | null };
  covered?: boolean;
  free?: boolean;
}

interface PricingModel {
  maximumDayPrice: number | null;
  monthlyTicketPrice: number | null;
  yearlyTicketPrice: number | null;
  priceSegments?: { price: number; startingFrom: number }[];
}
interface Props {
  displayName: string | null;
  address: { city?: string | null } | null;
  capacities: { categoryType: string; total: number }[];
  parkingFacilityType: string;
  pricingModel: PricingModel | null;
  uic: number | null;
}
interface Feature {
  id: string;
  geometry: { geometries?: { type: string; coordinates: unknown }[] } | null;
  properties: Props;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const inPath = resolve(root, 'data/raw/bike-and-car-parking.json');
const outPath = resolve(root, 'data/build/parking.json');

const chf = (rappen: number | null | undefined): number | null =>
  typeof rappen === 'number' ? Math.round(rappen) / 100 : null;

function point(f: Feature): { lat: number; lon: number } | null {
  const p = f.geometry?.geometries?.find((g) => g.type === 'Point');
  const c = p?.coordinates as number[] | undefined;
  if (!c || c.length < 2 || typeof c[0] !== 'number' || typeof c[1] !== 'number') return null;
  return { lon: c[0], lat: c[1] };
}

/** Standard + disabled + reservable spaces. WITH_CHARGING_STATION is not added: it is assumed to overlap. */
function capacity(p: Props): number | null {
  let n = 0;
  for (const c of p.capacities) {
    if (['STANDARD', 'DISABLED_PARKING_SPACE', 'RESERVABLE_PARKING_SPACE'].includes(c.categoryType)) n += c.total;
  }
  return n > 0 ? n : null;
}

/**
 * Price rule for P+Rail:
 *  - day   = maximumDayPrice (the daily cap). When absent and the only tariff segment is 0 Rp the car park
 *            is free: day = 0. Otherwise null (hourly tariff only, no daily cap -> not comparable).
 *  - month = monthlyTicketPrice, year = yearlyTicketPrice: the STANDARD ticket. The
 *            "...WithPublicTransportSeasonTicketDiscount" variants (28 sites) are ignored.
 */
function parkRailPrices(pm: PricingModel | null): ParkingSite['prices'] {
  if (!pm) return { day: null, month: null, year: null };
  let day = chf(pm.maximumDayPrice);
  const seg = pm.priceSegments ?? [];
  if (day === null && seg.length === 1 && seg[0]?.price === 0) day = 0;
  return { day, month: chf(pm.monthlyTicketPrice), year: chf(pm.yearlyTicketPrice) };
}

function stripBikePrefix(name: string): string {
  return name
    .replace(/^(v[ée]loparking|veloparking|parking [àa] v[ée]los|parcheggio (per )?(bici|biciclette)|bike ?& ?ride|velostation|v[ée]lobox|velomietbox)\s*/i, '')
    .replace(/^(de la gare|de l'|der|du|dello|della)\s*/i, '')
    .replace(/^(gare|bahnhof|stazione)\s+/i, '')
    .trim();
}

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

const raw = JSON.parse(readFileSync(inPath, 'utf8')) as { features: Feature[] };
const features = raw.features;

const sites: ParkingSite[] = [];
let skippedPlain = 0;
let skippedNoGeom = 0;
const parkRailByUic = new Map<number, Feature>();

for (const f of features) {
  if (f.properties.parkingFacilityType !== 'PARK_AND_RAIL') continue;
  const pt = point(f);
  if (!pt) {
    skippedNoGeom++;
    continue;
  }
  const p = f.properties;
  if (p.uic !== null && !parkRailByUic.has(p.uic)) parkRailByUic.set(p.uic, f);
  const stationName = p.displayName?.trim() || p.address?.city || null;
  sites.push({
    id: f.id,
    kind: 'parkRail',
    name: `P+Rail ${stationName ?? ''}`.trim(),
    stationName,
    stationId: p.uic === null ? null : String(p.uic),
    stationIdType: p.uic === null ? null : 'uic',
    ...pt,
    capacity: capacity(p),
    prices: parkRailPrices(p.pricingModel),
  });
}

// Plain PARKING (short-term and town car parks): not commuter parking -> skipped.
for (const f of features) if (f.properties.parkingFacilityType === 'PARKING') skippedPlain++;

// Bike parking: one site per station (uic); facilities without uic are grouped by display name.
const groups = new Map<string, Feature[]>();
for (const f of features) {
  if (!f.properties.parkingFacilityType.startsWith('BIKE_')) continue;
  if (!point(f)) {
    skippedNoGeom++;
    continue;
  }
  const p = f.properties;
  const key = p.uic !== null ? `uic:${p.uic}` : `name:${(p.displayName ?? f.id).trim().toLowerCase()}`;
  const g = groups.get(key);
  if (g) g.push(f);
  else groups.set(key, [f]);
}

for (const [key, fs] of groups) {
  const first = fs[0] as Feature;
  const uic = first.properties.uic;
  const ref = uic !== null ? parkRailByUic.get(uic) : undefined;
  const refPt = ref ? point(ref) : null;
  let best = first;
  if (refPt) {
    let bd = Infinity;
    for (const f of fs) {
      const d = haversineKm(refPt, point(f) as { lat: number; lon: number });
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
  }
  const stationName =
    ref?.properties.displayName?.trim() ||
    (uic !== null ? first.properties.address?.city || null : null) ||
    stripBikePrefix(first.properties.displayName ?? '') ||
    null;
  let cap = 0;
  let any = false;
  for (const f of fs) {
    const c = capacity(f.properties);
    if (c !== null) {
      cap += c;
      any = true;
    }
  }
  // covered: only from the facility type (…COVERED); BIKE_STATION / plain BIKE_PARKING are not claimed covered.
  const covered = fs.some((f) => f.properties.parkingFacilityType.includes('COVERED'));
  // free: only when EVERY facility states a tariff of 0 Rp and no tickets; most bike records have no pricingModel -> unknown.
  const free = fs.every((f) => {
    const pm = f.properties.pricingModel;
    const seg = pm?.priceSegments ?? [];
    return !!pm && seg.length === 1 && seg[0]?.price === 0 && pm.monthlyTicketPrice === null && pm.yearlyTicketPrice === null;
  });
  const bp = point(best) as { lat: number; lon: number };
  const site: ParkingSite = {
    id: uic !== null ? `bike-${uic}` : `bike-${first.id}`,
    kind: 'bikeParking',
    name: `Bike parking ${stationName ?? ''}`.trim(),
    stationName,
    stationId: uic === null ? null : String(uic),
    stationIdType: uic === null ? null : 'uic',
    ...bp,
    capacity: any ? cap : null,
    prices: { day: null, month: null, year: null },
    covered,
  };
  if (free) site.free = true;
  void key;
  sites.push(site);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(
  outPath,
  JSON.stringify({ generatedFrom: 'data/raw/bike-and-car-parking.json (opentransportdata.swiss, bike-and-car-parking)', generatedAt: new Date().toISOString(), sites }) + '\n',
);

const pr = sites.filter((s) => s.kind === 'parkRail');
const bk = sites.filter((s) => s.kind === 'bikeParking');
const n = (xs: ParkingSite[], f: (s: ParkingSite) => boolean) => xs.filter(f).length;
console.log(`features in: ${features.length}`);
console.log(`parkRail: ${pr.length}  (with uic ${n(pr, (s) => s.stationId !== null)}, capacity ${n(pr, (s) => s.capacity !== null)})`);
console.log(`  day price ${n(pr, (s) => s.prices.day !== null)} (of which free/0: ${n(pr, (s) => s.prices.day === 0)}), month ${n(pr, (s) => s.prices.month !== null)}, year ${n(pr, (s) => s.prices.year !== null)}, no price at all ${n(pr, (s) => s.prices.day === null && s.prices.month === null && s.prices.year === null)}`);
console.log(`bikeParking: ${bk.length} stations (with uic ${n(bk, (s) => s.stationId !== null)}, covered ${n(bk, (s) => s.covered === true)}, free ${n(bk, (s) => s.free === true)}, capacity ${n(bk, (s) => s.capacity !== null)})`);
console.log(`skipped plain PARKING: ${skippedPlain}; skipped without Point: ${skippedNoGeom}`);
console.log(`wrote ${outPath}`);
