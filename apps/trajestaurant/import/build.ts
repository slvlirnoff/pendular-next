/**
 * Builds the Trajestaurant database from four sources:
 *
 *  1. OpenStreetMap (import/osm.sh): places to eat, shops and other places one goes to, towns.
 *  2. All The Places (import/fetch.sh atp): the branches of chains, from their own store finders,
 *     with opening hours. A branch OSM already has (same brand within 200 m) gives it its hours,
 *     phone and website; one OSM lacks is added.
 *  3. Overture Maps (import/fetch.sh overture): places to eat, shops and services. One OSM or All
 *     The Places already has (a similar name within 120 m) adds what it knows; one they lack is
 *     added when Overture is confident enough. Overture's own duplicates (same name within 100 m)
 *     are merged first. Its categories of shops and services come from several datasets, some of
 *     which classify poorly (garages as "home goods stores"): a name that says what a place is
 *     wins over the category, and a place nobody else has is kept only when its dataset and
 *     category mostly agree with OSM on the places both know (overtureTrust).
 *  4. Name Suggestion Index (import/fetch.sh nsi): the brands present in Switzerland. It names the
 *     brand of a place tagged with the name only ("Migros Lucens" → Migros), gives chains their
 *     cuisine (McDonald's → burger) and brands their proper names.
 *
 * Places keep their id from one import to the next (matched on the record they were built from);
 * places gone from every source are removed.
 *
 *   tsx import/build.ts <osm.geojsonseq> [--src data/build/trajestaurant/src]
 */
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { classify } from '../src/foods.js';
import { FOOD_KINDS, KIND_KEYS, KIND_SEARCHES, kindGroup, kindInfo, mainKind } from '../src/kinds.js';
import { fold, nameTokens, sameName, searchKey } from '../src/text.js';
import { distanceM } from '../server/estimate.js';
import { createPool, DEFAULT_DATABASE_URL, ensureDatabase, SCHEMA } from '../server/db.js';

type Tags = Record<string, string | undefined>;
type Source = 'osm' | 'atp' | 'overture' | 'gbfs';

export interface Place {
  source: Source;
  sourceId: string;
  sources: Set<Source>;
  name: string;
  kindKey: string;
  kind: string;
  lat: number;
  lon: number;
  /** OSM-style tags, filled from every source that contributed. */
  tags: Tags;
  /** Food types from Overture's categories (OSM's come from the tags). */
  extraFoods: Set<string>;
  confidence?: number;
  matchedAtp?: boolean;
  /** No name in the source: named after its operator or its kind ("La Poste", "Pharmacie"). */
  unnamed?: boolean;
  /** Overture's dataset and category; byName: the kind comes from the name, not the category. */
  overture?: { dataset: string; category: string; byName?: boolean };
}

interface Feature {
  id?: string;
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, string>;
}

// ---------------------------------------------------------------------------------------------
// Reading the sources
// ---------------------------------------------------------------------------------------------

/** The centre of a point, polygon or multipolygon (area-weighted over the outer rings). */
export function centre(g: Feature['geometry']): { lat: number; lon: number } | null {
  if (g.type === 'Point') {
    const [lon, lat] = g.coordinates as [number, number];
    return { lat, lon };
  }
  const polygons = g.type === 'Polygon' ? [g.coordinates as number[][][]] : g.type === 'MultiPolygon' ? (g.coordinates as number[][][][]) : [];
  let a = 0;
  let cx = 0;
  let cy = 0;
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (const poly of polygons) {
    const ring = poly[0] ?? [];
    for (let i = 0; i + 1 < ring.length; i++) {
      const [x0, y0] = ring[i] as [number, number];
      const [x1, y1] = ring[i + 1] as [number, number];
      const cross = x0 * y1 - x1 * y0;
      a += cross;
      cx += (x0 + x1) * cross;
      cy += (y0 + y1) * cross;
      sx += x0;
      sy += y0;
      n++;
    }
  }
  if (n === 0) return null;
  if (Math.abs(a) < 1e-12) return { lat: sy / n, lon: sx / n };
  return { lat: cy / (3 * a), lon: cx / (3 * a) };
}

/** The OSM object behind an exported id: n…, w…, r…, or a… for an area (way id × 2, relation id × 2 + 1). */
export function osmObject(id: string): string {
  if (id[0] !== 'a') return id;
  const n = Number(id.slice(1));
  return n % 2 === 0 ? `w${n / 2}` : `r${(n - 1) / 2}`;
}

const clean = (v: string | undefined | null) => (v && String(v).trim() ? String(v).trim() : undefined);

const KEPT_TAGS = [
  'name', 'brand', 'brand:wikidata', 'cuisine', 'opening_hours', 'phone', 'website',
  'addr:street', 'addr:housenumber', 'addr:postcode', 'addr:city', 'addr:place',
  'takeaway', 'delivery', 'outdoor_seating', 'wheelchair', 'diet:vegetarian', 'diet:vegan',
  'email', 'image', 'logo', 'wikidata', 'wikimedia_commons', 'healthcare:speciality', 'description',
  ...KIND_KEYS,
];

function pickTags(p: Record<string, string>): Tags {
  const t: Tags = {};
  for (const k of KEPT_TAGS) {
    const v = clean(p[k]);
    if (v) t[k] = v;
  }
  t.phone ??= clean(p['contact:phone']);
  t.website ??= clean(p['contact:website']) ?? clean(p.url);
  t.email ??= clean(p['contact:email']);
  const instagram = clean(p['contact:instagram']);
  const facebook = clean(p['contact:facebook']);
  if (instagram) t.instagram = instagram;
  if (facebook) t.facebook = facebook;
  return t;
}

/** A place from an OSM feature, or null when it is not one Trajestaurant keeps (or has no name). */
/**
 * Kinds worth showing without a name: what they are is what one looks for (a pharmacy, a post
 * office, a bakery). Not places to eat (an unnamed "Restaurant" helps nobody), not unknown shops,
 * not swimming pools (mostly private garden pools).
 */
export function worthWithoutName(kindKey: string, kind: string): boolean {
  if (kindKey === 'shop') return kind !== 'yes';
  if (kindKey === 'amenity') return !FOOD_KINDS.has(kind) && kind !== 'bar' && kind !== 'pub';
  if (kindKey === 'leisure') return kind !== 'swimming_pool';
  if (kindKey === 'tourism') return kind !== 'hotel' && kind !== 'motel' && kind !== 'hostel' && kind !== 'attraction';
  return false;
}

/**
 * The name to show for an OSM place: its name, else its brand, else its operator (in French when
 * given: the Lucens post office has only operator=Die Post, operator:fr=La Poste), else its kind
 * for the kinds worth showing without a name. Null when none applies.
 */
export function osmName(p: Record<string, string>, kindKey: string, kind: string): { name: string; unnamed: boolean } | null {
  const own = clean(p.name) ?? clean(p.brand);
  if (own) return { name: own, unnamed: false };
  const operator = clean(p['operator:fr']) ?? clean(p.operator);
  if (operator) return { name: operator, unnamed: true };
  if (worthWithoutName(kindKey, kind)) return { name: kindInfo(kindKey, kind).label, unnamed: true };
  return null;
}

export function osmPlace(f: Feature): Place | null {
  const p = f.properties;
  const k = mainKind(p);
  if (!k || !f.id) return null;
  const named = osmName(p, k.kindKey, k.kind);
  if (!named) return null;
  const c = centre(f.geometry);
  if (!c) return null;
  return {
    source: 'osm',
    sourceId: osmObject(f.id),
    sources: new Set(['osm']),
    name: named.name,
    ...k,
    ...c,
    tags: pickTags(p),
    extraFoods: new Set(),
    ...(named.unnamed ? { unnamed: true } : {}),
  };
}

/** The cash machine of an OSM bank tagged atm=yes, as a place of its own (named after the bank). */
export function bankAtm(bank: Place, p: Record<string, string>): Place | null {
  if (bank.kindKey !== 'amenity' || bank.kind !== 'bank' || p.atm !== 'yes') return null;
  const tags: Tags = { ...bank.tags, amenity: 'atm' };
  delete tags.opening_hours;
  return { ...bank, kind: 'atm', sourceId: `${bank.sourceId}#atm`, sources: new Set(bank.sources), tags, extraFoods: new Set() };
}

/** A place from an All The Places feature (OSM-style tags; the street and number come as one). */
export function atpPlace(f: Feature): Place | null {
  const p = f.properties;
  const k = mainKind(p);
  if (!k || f.geometry.type !== 'Point') return null;
  const name = clean(p.name) ?? clean(p.brand);
  if (!name) return null;
  const [lon, lat] = f.geometry.coordinates as [number, number];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const tags = pickTags(p);
  tags['addr:street'] ??= clean(p['addr:street_address']);
  const spider = clean(p['@spider']) ?? 'atp';
  return { source: 'atp', sourceId: `${spider}:${clean(p.ref) ?? f.id ?? `${lat},${lon}`}`, sources: new Set(['atp']), name, ...k, lat, lon, tags, extraFoods: new Set() };
}

export interface OvertureRow {
  id: string;
  name: string | null;
  /** First level of Overture's taxonomy: food_and_drink, shopping, lifestyle_services… */
  section?: string | null;
  category: string | null;
  basic_category: string | null;
  alternates: string[] | null;
  confidence: number | null;
  brand: string | null;
  brand_wikidata: string | null;
  website: string | null;
  phone: string | null;
  street: string | null;
  postcode: string | null;
  locality: string | null;
  /** Where Overture has the place from: meta, Microsoft, BrightQuery, AllThePlaces… */
  dataset?: string | null;
  lat: number;
  lon: number;
}

/** A car-sharing station of the national shared-mobility feed (import/carsharing.py). */
export interface CarSharingRow {
  provider: string;
  provider_name: string;
  provider_url: string | null;
  station_id: string;
  name: string;
  address: string | null;
  lat: number;
  lon: number;
  rental_uri: string | null;
}

/** Short names of the car-sharing providers, as people say them. */
const SHARING_NAMES: Record<string, string> = {
  mobility: 'Mobility',
  '2em_cars': '2EM',
  edrivecarsharing: 'eDrive',
  quickrent: 'Quickrent',
  sponti: 'Sponti-Car',
  share_birrer_ch: 'Birrer Share',
  carvelo2go: 'carvelo2go',
};

/**
 * A car-sharing station: named "Mobility · Lucens Gare". 2EM stations (private cars) are named
 * after the car ("velo 1995"): their street stands for them instead.
 */
export function carSharingPlace(r: CarSharingRow): Place | null {
  if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) return null;
  const brand = SHARING_NAMES[r.provider] ?? r.provider_name;
  const street = r.address?.split(',')[0]?.trim();
  const where = r.provider === '2em_cars' ? street || r.name : r.name || street;
  return {
    source: 'gbfs',
    sourceId: `${r.provider}:${r.station_id}`,
    sources: new Set(['gbfs']),
    name: where ? `${brand} · ${where}` : brand,
    kindKey: 'amenity',
    kind: 'car_sharing',
    lat: r.lat,
    lon: r.lon,
    tags: {
      amenity: 'car_sharing',
      brand,
      operator: r.provider_name,
      website: clean(r.rental_uri) ?? clean(r.provider_url),
      'addr:street': clean(street),
    },
    extraFoods: new Set(),
  };
}

/** OSM key and value for an Overture category; null for places that are not to eat (wineries…). */
export function overtureKind(category: string, basic: string): { kindKey: string; kind: string } | null {
  const c = category || basic;
  if (/^(winery|distillery|food_and_drink)$/.test(c)) return null;
  if (/ice_cream|gelato|frozen_yogurt/.test(c)) return { kindKey: 'amenity', kind: 'ice_cream' };
  if (/^(fast_food_restaurant|doner_kebab_restaurant|food_truck_stand|sandwich_shop|hot_dog|kiosk)/.test(c)) return { kindKey: 'amenity', kind: 'fast_food' };
  if (/restaurant$|^(diner|bistro|gastropub|steakhouse|tapas_bar|sushi_bar|cafeteria|pancake_house|food_court|canteen)$/.test(c)) return { kindKey: 'amenity', kind: 'restaurant' };
  if (/^(cafe|coffee_shop|tea_room|bubble_tea_shop|smoothie_juice_bar|internet_cafe)$/.test(c)) return { kindKey: 'amenity', kind: 'cafe' };
  if (/^pub$/.test(c)) return { kindKey: 'amenity', kind: 'pub' };
  if (/(^|_)(bar|pub|lounge|brewery|beer_garden|nightclub)$/.test(c)) return { kindKey: 'amenity', kind: 'bar' };
  if (/^bakery$/.test(c)) return { kindKey: 'shop', kind: 'bakery' };
  if (/^(dessert_shop|cupcake_shop|patisserie|pastry_shop)$/.test(c)) return { kindKey: 'shop', kind: 'pastry' };
  if (/^(chocolatier|candy_store|confectionery)$/.test(c)) return { kindKey: 'shop', kind: 'confectionery' };
  if (/^delicatessen$/.test(c)) return { kindKey: 'shop', kind: 'deli' };
  if (basic === 'restaurant' || basic === 'casual_eatery') return { kindKey: 'amenity', kind: 'restaurant' };
  if (basic === 'cafe' || basic === 'coffee_shop') return { kindKey: 'amenity', kind: 'cafe' };
  if (basic === 'bar') return { kindKey: 'amenity', kind: 'bar' };
  return null;
}

/**
 * Overture categories of shops and services → OSM key and value (shared with import/overture.py,
 * which fetches them).
 */
export const OVERTURE_CATEGORIES: Record<string, [string, string]> = JSON.parse(
  readFileSync(new URL('./overture-categories.json', import.meta.url), 'utf8'),
).categories;

/** OSM key and value for an Overture place that is not to eat: a known category, else shop=<category without "_store">, else null. */
export function overtureShopKind(category: string, section: string): { kindKey: string; kind: string } | null {
  const known = OVERTURE_CATEGORIES[category];
  if (known) return { kindKey: known[0], kind: known[1] };
  if (section !== 'shopping' || !category || category === 'shopping') return section === 'shopping' ? { kindKey: 'shop', kind: 'yes' } : null;
  return { kindKey: 'shop', kind: category.replace(/_(store|shop|dealer)$/, '') };
}

const CAR_KINDS = new Set(['car', 'car_repair', 'car_parts', 'tyres', 'motorcycle', 'truck', 'truck_repair', 'fuel', 'car_rental', 'car_wash', 'vehicle_inspection', 'driving_school']);

/**
 * What a name says a place is, against its category: Overture's datasets call garages "home goods
 * stores", employment agencies "kitchen supply stores". Each rule: words of the name (folded), the
 * kind they mean (null: not a place Trajestaurant shows, as a taxi company or an architect), and
 * the kinds for which the category stands (an appliance shop named "Elektro …" stays one).
 */
const NAME_RULES: { re: RegExp; kind: [string, string] | null; keep?: (kind: string) => boolean }[] = [
  { re: /\b(auto ecole|autoecole|fahrschule|scuola guida)\b/, kind: ['amenity', 'driving_school'] },
  { re: /\b(police|gendarmerie|polizei|polizeiposten|polizia)\b/, kind: ['amenity', 'police'] },
  { re: /\b(restaurant|ristorante|pizzeria|gasthof|gasthaus|hotel|trattoria)\b/, kind: null },
  {
    re: /\b(taxi|taxis|transport|transports|transporte|umzug|umzuge|zugeln|demenagement|demenagements|logistik|logistics|spedition|architekt\w*|architecte\w*|architettura|ingenieur\w*|engineering|consulting|informatik|software|schule|ecole|scuola|verein|association|stiftung|fondation|kirche|eglise)\b/,
    kind: null,
  },
  { re: /\b(arztpraxis|zahnarzt\w*|physiotherap\w*|clinique|klinik|cabinet medical|cabinet dentaire)\b/, kind: null },
  { re: /\b(adecco|manpower|randstad|interim|placement|temporaire|stellenvermittlung|personalvermittlung|personalberatung|personaldienst\w*|rav|orp|job|jobs)\b/, kind: ['office', 'employment_agency'] },
  { re: /\b(pneu|pneus|pneuhaus|reifen)\b/, kind: ['shop', 'tyres'], keep: (k) => CAR_KINDS.has(k) },
  { re: /\b(garage|garages|autogarage|carrosserie|carrozzeria|autocenter|auto|autos|automobile|automobiles)\b/, kind: ['shop', 'car_repair'], keep: (k) => CAR_KINDS.has(k) },
  { re: /\b(elektro|electricite|electricien|elettricita|elektriker|elektroinstallation\w*)\b/, kind: ['craft', 'electrician'], keep: (k) => ['electronics', 'appliance', 'electrical', 'lighting', 'computer'].includes(k) },
  { re: /\b(sanitar|sanitaire|sanitari|heizung|heizungen|chauffage|chauffages|spenglerei|ferblanterie|haustechnik)\b/, kind: ['craft', 'plumber'], keep: (k) => ['hvac', 'plumber', 'roofer', 'tinsmith', 'kitchen', 'bathroom_furnishing'].includes(k) },
  { re: /\b(maler|malerei|malergeschaft|gipser|gipserei|platrerie|gypserie|peinture)\b/, kind: ['craft', 'painter'], keep: (k) => k === 'paint' || k === 'plasterer' },
  { re: /\b(schreinerei|schreiner|menuiserie|menuisier|zimmerei|charpente|charpentier|ebenisterie|holzbau)\b/, kind: ['craft', 'carpenter'], keep: (k) => ['furniture', 'kitchen', 'joiner', 'cabinet_maker', 'window_construction'].includes(k) },
  { re: /\b(bau|bauunternehmung|bauunternehmen|maconnerie|costruzioni)\b/, kind: ['craft', 'builder'], keep: (k) => ['doityourself', 'hardware', 'tiler', 'plasterer', 'stonemason', 'roofer', 'floorer'].includes(k) },
  { re: /\b(treuhand|fiduciaire|fiduciaria)\b/, kind: ['office', 'accountant'], keep: (k) => k === 'tax_advisor' },
  { re: /\b(immobilien|immobilier|immobiliere|immobiliare|regie)\b/, kind: ['office', 'estate_agent'] },
  { re: /\b(versicherung\w*|assurance|assurances|assicurazion\w*)\b/, kind: ['office', 'insurance'] },
];

/**
 * The kind an Overture place's name says it is, when it is not its category's: a kind, 'drop'
 * (not a place Trajestaurant shows), or null (the category stands). Health places (doctors…) are
 * left to their category.
 */
export function kindFromName(name: string, k: { kindKey: string; kind: string }): { kindKey: string; kind: string } | 'drop' | null {
  const words = ` ${searchKey(name)} `;
  // A practice listed as a hospital ("Cabinet médical de pédiatrie").
  if (k.kindKey === 'amenity' && k.kind === 'hospital' && /\b(cabinet|praxis|arztpraxis|dr|dre|studio)\b/.test(words)) return { kindKey: 'amenity', kind: 'doctors' };
  if (k.kindKey === 'healthcare' || (k.kindKey === 'amenity' && ['doctors', 'dentist', 'clinic', 'hospital', 'veterinary', 'pharmacy'].includes(k.kind))) return null;
  for (const rule of NAME_RULES) {
    if (!rule.re.test(words)) continue;
    if (!rule.kind) return 'drop';
    if (rule.kind[0] === k.kindKey && rule.kind[1] === k.kind) return null;
    if (rule.keep?.(k.kind)) return null;
    return { kindKey: rule.kind[0], kind: rule.kind[1] };
  }
  return null;
}

/** OSM-style cuisine values for Overture categories ("pizza_restaurant" → "pizza"). */
export function overtureCuisines(categories: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const c of categories) {
    if (!c) continue;
    out.add(c);
    out.add(c.replace(/_(restaurant|shop|house|bar|stand|place|joint|truck_stand)$/, ''));
  }
  return [...out];
}

export function overturePlace(r: OvertureRow): Place | null {
  const name = clean(r.name);
  if (!name || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) return null;
  const food = (r.section ?? 'food_and_drink') === 'food_and_drink';
  let k = food ? overtureKind(r.category ?? '', r.basic_category ?? '') : overtureShopKind(r.category ?? '', r.section ?? '');
  if (!k) return null;
  let byName = false;
  if (!food) {
    const said = kindFromName(name, k);
    if (said === 'drop') return null;
    if (said) {
      k = said;
      byName = true;
    }
  }
  const tags: Tags = {
    name,
    [k.kindKey]: k.kind,
    brand: clean(r.brand),
    'brand:wikidata': clean(r.brand_wikidata),
    website: clean(r.website),
    phone: clean(r.phone),
    'addr:street': clean(r.street),
    'addr:postcode': clean(r.postcode),
    'addr:city': clean(r.locality),
  };
  const cuisine = overtureCuisines([r.category, ...(r.alternates ?? [])]).join(';');
  const foods = FOOD_KINDS.has(k.kind) && k.kindKey === 'amenity' ? classify({ amenity: k.kind, name, cuisine }) : [];
  return {
    source: 'overture', sourceId: r.id, sources: new Set(['overture']), name, ...k, lat: r.lat, lon: r.lon, tags,
    extraFoods: new Set(foods), confidence: r.confidence ?? 0,
    overture: { dataset: r.dataset ?? '?', category: r.category ?? '', ...(byName ? { byName } : {}) },
  };
}

async function* lines(file: string): AsyncGenerator<string> {
  const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const raw of rl) {
    const line = raw.replace(/^\x1e/, '').trim();
    if (line) yield line;
  }
}

// ---------------------------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------------------------

/** Places in cells of about 330 m: a search within 300 m looks at nine cells. */
export class Grid {
  private cells = new Map<string, Place[]>();
  private static key(lat: number, lon: number, di = 0, dj = 0) {
    return `${Math.floor(lat / 0.003) + di}:${Math.floor(lon / 0.0045) + dj}`;
  }
  add(p: Place) {
    const k = Grid.key(p.lat, p.lon);
    const list = this.cells.get(k);
    if (list) list.push(p);
    else this.cells.set(k, [p]);
  }
  near(lat: number, lon: number, radiusM: number): { p: Place; d: number }[] {
    const out: { p: Place; d: number }[] = [];
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (const p of this.cells.get(Grid.key(lat, lon, di, dj)) ?? []) {
          const d = distanceM({ lat, lon }, p);
          if (d <= radiusM) out.push({ p, d });
        }
      }
    }
    return out.sort((a, b) => a.d - b.d);
  }
}

export { nameTokens, sameName } from '../src/text.js';

/** Fills tags the place lacks; `prefer` tags replace what it has (opening hours from a store finder). */
function absorb(into: Place, from: Place, prefer: string[] = []) {
  // A place OSM knows without a name takes the name the other source gives it.
  if (into.unnamed && !from.unnamed) {
    into.name = from.name;
    into.unnamed = false;
  }
  for (const [k, v] of Object.entries(from.tags)) {
    if (!v || k === 'name' || KIND_KEYS.includes(k)) continue;
    if (!into.tags[k] || prefer.includes(k)) into.tags[k] = v;
  }
  for (const f of from.extraFoods) into.extraFoods.add(f);
  into.sources.add(from.source);
}

/**
 * Words of the names of towns and villages (folded): they say where a place is, not which one it
 * is. Filled from OSM's towns before the other sources are matched.
 */
export const townWords = new Set<string>();
export function setTownWords(names: string[]) {
  townWords.clear();
  for (const n of names) for (const w of nameTokens(n)) if (w.length >= 3) townWords.add(w);
}
const same = (a: string, b: string) => sameName(a, b, townWords);

const isFood = (p: Place) => p.kindKey === 'amenity' && (FOOD_KINDS.has(p.kind) || p.kind === 'bar' || p.kind === 'pub');
/** Places an Overture place to eat may be the same as: places to eat, bakeries and the like. */
const FOOD_SHOPS = new Set(['bakery', 'pastry', 'confectionery', 'chocolate', 'deli', 'coffee', 'ice_cream']);
const isFoodish = (p: Place) => isFood(p) || (p.kindKey === 'shop' && FOOD_SHOPS.has(p.kind));

/**
 * All The Places branch → the OSM place of the same brand nearby, if any: one of the same kind
 * first (a chain's spider lists its supermarket, its restaurant and its take-away at one address).
 */
export function matchAtp(grid: Grid, a: Place): Place | null {
  const wd = a.tags['brand:wikidata'];
  const brand = fold(a.tags.brand ?? a.name);
  const same = grid.near(a.lat, a.lon, 200).filter(({ p }) => {
    if (p.source !== 'osm' || p.matchedAtp) return false;
    if (isFood(p) !== isFood(a) && p.kindKey !== a.kindKey) return false;
    // An unnamed station of the same kind a few metres away is that branch (operator-only fuel stations).
    if (p.unnamed && p.kindKey === a.kindKey && p.kind === a.kind && distanceM(p, a) <= 60) return true;
    return Boolean((wd && p.tags['brand:wikidata'] === wd) || (brand.length >= 3 && fold(`${p.tags.brand ?? ''} ${p.name}`).includes(brand)));
  });
  return (same.find(({ p }) => p.kindKey === a.kindKey && p.kind === a.kind) ?? same.find(({ p }) => p.kindKey === a.kindKey) ?? same[0])?.p ?? null;
}

/** Overture place → a place to eat already known with a similar name nearby, if any (a museum of the same name is not it). */
export function matchOverture(grid: Grid, o: Place): Place | null {
  for (const { p } of grid.near(o.lat, o.lon, 120)) {
    if (p === o || !isFoodish(p)) continue;
    if (same(p.name, o.name)) return p;
  }
  return null;
}

/** Overture shop → a shop (or other place not to eat) already known with a similar name nearby, if any. */
export function matchOvertureShop(grid: Grid, o: Place): Place | null {
  for (const { p, d } of grid.near(o.lat, o.lon, 120)) {
    // A shop is matched with a shop, a doctor with a doctor: not with the car-sharing station, the
    // bank or the pharmacy next door that shares a word of its name ("… Bahnhof", "… Muster").
    if (p === o || isFoodish(p) || p.kind === 'car_sharing' || !alike(p, o)) continue;
    if (same(p.name, o.name)) return p;
    // OSM knows a pharmacy here but not its name: Overture's pharmacy within 60 m is that one.
    if (p.unnamed && d <= 60 && p.kindKey === o.kindKey && p.kind === o.kind) return p;
  }
  return null;
}

/** Two kinds one place may be listed under: two shops, or two kinds of one search (a garage that sells cars). */
const alike = (a: Place, b: Place) => (a.kindKey === 'shop' && b.kindKey === 'shop') || kindGroup(a.kindKey, a.kind) === kindGroup(b.kindKey, b.kind);

/**
 * How far Overture's shops and services can be trusted, per dataset and category: of its places
 * that OSM or All The Places know under a similar name within 120 m, the share they list as the
 * same sort of place (the same search: a garage that sells cars is still a garage). Measured on
 * the 2026-10 release: Microsoft's "home_goods_store" agreed for 1 % (garages, taxi companies),
 * meta's "furniture_store" for 70 %, Microsoft's "hair_salon" for 88 %. Categories with fewer than
 * 8 such places are judged by their dataset as a whole.
 */
export function overtureTrust(known: Grid, candidates: Place[]): (o: Place) => boolean {
  const tally = new Map<string, { matched: number; agree: number }>();
  const bump = (key: string, agree: boolean) => {
    const t = tally.get(key) ?? { matched: 0, agree: 0 };
    t.matched++;
    if (agree) t.agree++;
    tally.set(key, t);
  };
  for (const o of candidates) {
    if (!o.overture || o.overture.byName || isFoodish(o)) continue;
    const p = known.near(o.lat, o.lon, 120).find(({ p }) => p.source !== 'overture' && !isFoodish(p) && p.kind !== 'car_sharing' && same(p.name, o.name))?.p;
    if (!p) continue;
    const agree = kindGroup(p.kindKey, p.kind) === kindGroup(o.kindKey, o.kind);
    bump(`${o.overture.dataset}|${o.overture.category}`, agree);
    bump(o.overture.dataset, agree);
  }
  const rate = (key: string) => {
    const t = tally.get(key);
    return t && t.matched >= MIN_MEASURED ? t.agree / t.matched : null;
  };
  return (o) => {
    if (!o.overture || o.overture.byName) return true;
    const category = rate(`${o.overture.dataset}|${o.overture.category}`);
    if (category !== null) return category >= (HEALTH.has(kindGroup(o.kindKey, o.kind)) ? HEALTH_TRUST : CATEGORY_TRUST);
    return (rate(o.overture.dataset) ?? 0) >= DATASET_TRUST;
  };
}

/** The agreement measured per dataset and category, for the import's report. */
export function trustReport(known: Grid, candidates: Place[]): Map<string, { matched: number; agree: number }> {
  const tally = new Map<string, { matched: number; agree: number }>();
  for (const o of candidates) {
    if (!o.overture || o.overture.byName || isFoodish(o)) continue;
    const p = known.near(o.lat, o.lon, 120).find(({ p }) => p.source !== 'overture' && !isFoodish(p) && p.kind !== 'car_sharing' && same(p.name, o.name))?.p;
    if (!p) continue;
    const key = `${o.overture.dataset}|${o.overture.category}`;
    const t = tally.get(key) ?? { matched: 0, agree: 0 };
    t.matched++;
    if (kindGroup(p.kindKey, p.kind) === kindGroup(o.kindKey, o.kind)) t.agree++;
    tally.set(key, t);
  }
  return tally;
}
const MIN_MEASURED = 8;
const CATEGORY_TRUST = 0.65;
const DATASET_TRUST = 0.6;
/**
 * Health categories are specific (a "podiatry" is not a garage) and OSM tags them unevenly
 * (podiatrists as beauty salons, physiotherapists inside a medical centre's doctors): their
 * agreement understates them, so a lower bar only drops the categories that are plainly off.
 */
const HEALTH_TRUST = 0.3;
const HEALTH = new Set(KIND_SEARCHES.filter((k) => k.group === 'health').map((k) => k.key));

/**
 * Whether an Overture place nobody else has is kept: confident enough, or less so with a phone or
 * a website (a business that answers), or both (Grill House in Lucens: 0.3, with both).
 */
export function keepOverture(o: Pick<Place, 'confidence' | 'tags'>): boolean {
  const c = o.confidence ?? 0;
  const phone = Boolean(o.tags.phone);
  const web = Boolean(o.tags.website);
  return c >= 0.6 || (c >= 0.4 && (phone || web)) || (c >= 0.25 && phone && web);
}

// ---------------------------------------------------------------------------------------------
// Name Suggestion Index
// ---------------------------------------------------------------------------------------------

interface NsiItem {
  displayName: string;
  locationSet?: { include?: string[]; exclude?: string[] };
  matchNames?: string[];
  tags: Record<string, string>;
}

export interface NsiBrand {
  name: string;
  cuisine?: string;
  kindKey: string;
  kind: string;
  aliases: string[];
}

export interface Brands {
  /**
   * By Wikidata id, then by "key=value": one company has several entries ("Coop" supermarket,
   * "Coop Restaurant", "McDonald's" and "McDonald's PlayPlace" share their Wikidata id).
   */
  byWikidata: Map<string, Map<string, NsiBrand>>;
  /** By "key=value|folded name": the brand's Wikidata id. */
  byName: Map<string, string>;
}

/** The NSI entry of a brand for a kind of place: that kind's entry, else the shortest name (the company itself). */
export function nsiBrand(b: Brands, wikidata: string, kindKey?: string, kind?: string): NsiBrand | undefined {
  const all = b.byWikidata.get(wikidata);
  if (!all) return undefined;
  const exact = kindKey && kind ? all.get(`${kindKey}=${kind}`) : undefined;
  if (exact) return exact;
  return [...all.values()].sort((x, y) => x.name.length - y.name.length)[0];
}

const properName = (displayName: string) => displayName.replace(/\s*\([^)]*\)\s*$/, '').trim();

/** The brands of the Name Suggestion Index that are present in Switzerland. */
export function loadNsi(file: string): Brands {
  const nsi = JSON.parse(readFileSync(file, 'utf8')) as { nsi: Record<string, { items: NsiItem[] }> };
  const byWikidata: Brands['byWikidata'] = new Map();
  const byName: Brands['byName'] = new Map();
  for (const [path, { items }] of Object.entries(nsi.nsi)) {
    const [kind0, key, value] = path.split('/');
    if (kind0 !== 'brands' || !key || !value) continue;
    for (const it of items) {
      const inc = it.locationSet?.include ?? [];
      const exc = it.locationSet?.exclude ?? [];
      if (!(inc.includes('ch') || inc.includes('001')) || exc.includes('ch')) continue;
      const wd = it.tags['brand:wikidata'];
      if (!wd) continue;
      const names = [properName(it.displayName), it.tags.brand, it.tags.name, ...(it.matchNames ?? [])].filter((x): x is string => Boolean(x));
      let kinds = byWikidata.get(wd);
      if (!kinds) byWikidata.set(wd, (kinds = new Map()));
      const k = `${key}=${value}`;
      const known = kinds.get(k);
      // An entry for Switzerland itself wins over a worldwide one.
      if (!known || inc.includes('ch')) {
        kinds.set(k, { name: properName(it.displayName), cuisine: it.tags.cuisine ?? known?.cuisine, kindKey: key, kind: value, aliases: [...new Set([...(known?.aliases ?? []), ...names.map(fold)])] });
      }
      for (const n of names) byName.set(`${k}|${fold(n)}`, wd);
    }
  }
  return { byWikidata, byName };
}

/** The brand of a place tagged with a name only: its name, or its first words, is a Swiss brand of its kind. */
export function brandFromName(b: Brands, p: Pick<Place, 'kindKey' | 'kind' | 'name' | 'tags'>): string | null {
  const kind = `${p.kindKey}=${p.kind}`;
  if (p.tags.brand) {
    const wd = b.byName.get(`${kind}|${fold(p.tags.brand)}`);
    if (wd) return wd;
  }
  const words = fold(p.name).split(' ');
  for (let n = Math.min(3, words.length); n >= 1; n--) {
    const prefix = words.slice(0, n).join(' ');
    if (prefix.length < 3) continue;
    const wd = b.byName.get(`${kind}|${prefix}`);
    if (wd) return wd;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------------------------

export interface Built {
  places: Place[];
  towns: { name: string; kind: string; lat: number; lon: number }[];
  counts: Record<string, number>;
  nsi: Brands | null;
}

/** Reads and merges the sources (those present). */
export async function build(osmFile: string, srcDir: string): Promise<Built> {
  const grid = new Grid();
  const places: Place[] = [];
  const towns: Built['towns'] = [];
  const counts: Record<string, number> = {
    carSharing: 0, bankAtms: 0,
    osm: 0, atpMatched: 0, atpAdded: 0, overtureMatched: 0, overtureAdded: 0, overtureDropped: 0, overtureShopsMatched: 0, overtureShopsAdded: 0, overtureShopsUntrusted: 0, nsiBrands: 0,
  };

  // Car-sharing stations from the national feed replace OSM's (it knows every station of each provider).
  const sharingFile = resolve(srcDir, 'carsharing.jsonl');
  const haveSharing = existsSync(sharingFile);
  for await (const line of lines(osmFile)) {
    const f = JSON.parse(line) as Feature;
    const p = f.properties;
    if ((p.place === 'city' || p.place === 'town' || p.place === 'village') && p.name && f.geometry.type === 'Point' && !p.amenity && !p.shop) {
      const [lon, lat] = f.geometry.coordinates as [number, number];
      towns.push({ name: p.name, kind: p.place, lat, lon });
      continue;
    }
    const place = osmPlace(f);
    if (!place || (haveSharing && place.kind === 'car_sharing')) continue;
    places.push(place);
    grid.add(place);
    counts.osm!++;
    // A bank with a cash machine (atm=yes) is also where to find a Bancomat.
    const atm = bankAtm(place, p);
    if (atm) {
      places.push(atm);
      grid.add(atm);
      counts.bankAtms!++;
    }
  }

  setTownWords(towns.map((t) => t.name));

  if (haveSharing) {
    for await (const line of lines(sharingFile)) {
      const p = carSharingPlace(JSON.parse(line) as CarSharingRow);
      if (!p) continue;
      places.push(p);
      grid.add(p);
      counts.carSharing!++;
    }
  }

  const atpFile = resolve(srcDir, 'atp.geojsonseq');
  if (existsSync(atpFile)) {
    for await (const line of lines(atpFile)) {
      const a = atpPlace(JSON.parse(line) as Feature);
      if (!a) continue;
      const m = matchAtp(grid, a);
      if (m) {
        // The chain's own store finder knows its opening hours best.
        absorb(m, a, ['opening_hours']);
        m.matchedAtp = true;
        counts.atpMatched!++;
      } else {
        places.push(a);
        grid.add(a);
        counts.atpAdded!++;
      }
    }
  }

  const overtureFile = resolve(srcDir, 'overture.jsonl');
  if (existsSync(overtureFile)) {
    const rows: Place[] = [];
    for await (const line of lines(overtureFile)) {
      const o = overturePlace(JSON.parse(line) as OvertureRow);
      if (o) rows.push(o);
    }
    // Overture's own duplicates first: the most confident record of a name in 100 m is kept.
    rows.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    const own = new Grid();
    const unique: Place[] = [];
    for (const o of rows) {
      // A restaurant and a shop of one name at one address are two places (Migros, Migros Restaurant).
      const twin = own.near(o.lat, o.lon, 100).find(({ p }) => isFoodish(p) === isFoodish(o) && (isFoodish(o) || alike(p, o)) && same(p.name, o.name));
      if (twin) {
        for (const f of o.extraFoods) twin.p.extraFoods.add(f);
        continue;
      }
      own.add(o);
      unique.push(o);
    }
    const trusted = overtureTrust(grid, unique);
    for (const o of unique) {
      if (!isFoodish(o)) {
        // Shops and services come with a confidence of 0.8 or more (import/overture.py).
        const m = matchOvertureShop(grid, o);
        if (m) {
          absorb(m, o);
          counts.overtureShopsMatched!++;
        } else if (trusted(o)) {
          places.push(o);
          grid.add(o);
          counts.overtureShopsAdded!++;
        } else {
          counts.overtureShopsUntrusted!++;
        }
        continue;
      }
      const m = matchOverture(grid, o);
      if (m) {
        absorb(m, o);
        counts.overtureMatched!++;
      } else if (keepOverture(o)) {
        places.push(o);
        grid.add(o);
        counts.overtureAdded!++;
      } else {
        counts.overtureDropped!++;
      }
    }
  }

  const nsiFile = resolve(srcDir, 'nsi.json');
  const brands = existsSync(nsiFile) ? loadNsi(nsiFile) : null;
  if (brands) {
    for (const p of places) {
      // A place named after its kind ("Station-service") has no name to tell its brand.
      if (!p.tags['brand:wikidata'] && !(p.unnamed && p.name === kindInfo(p.kindKey, p.kind).label)) {
        const wd = brandFromName(brands, p);
        if (wd) {
          p.tags['brand:wikidata'] = wd;
          counts.nsiBrands!++;
        }
      }
      const nsi = p.tags['brand:wikidata'] ? nsiBrand(brands, p.tags['brand:wikidata'], p.kindKey, p.kind) : undefined;
      if (nsi?.cuisine && !p.tags.cuisine) p.tags.cuisine = nsi.cuisine;
      if (nsi) p.tags.brand = nsi.name;
    }
  }
  return { places, towns, counts, nsi: brands };
}

export interface BrandRow {
  key: string;
  name: string;
  name_folded: string;
  aliases: string[];
  kind_key: string;
  kind: string;
  count: number;
}

const mostCommon = <T,>(m: Map<T, number>): T => [...m.entries()].sort((a, b) => b[1] - a[1])[0]![0];

/** Chains: every brand with at least two places. Its name is the NSI one, else its most common brand tag. */
export function brandsOf(places: Place[], nsi: Brands | null): BrandRow[] {
  const groups = new Map<string, { count: number; names: Map<string, number>; kinds: Map<string, number>; aliases: Set<string> }>();
  for (const p of places) {
    const key = brandKey(p);
    if (!key) continue;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { count: 0, names: new Map(), kinds: new Map(), aliases: new Set() }));
    g.count++;
    const name = p.tags.brand ?? p.name;
    g.names.set(name, (g.names.get(name) ?? 0) + 1);
    const kind = `${p.kindKey}=${p.kind}`;
    g.kinds.set(kind, (g.kinds.get(kind) ?? 0) + 1);
    g.aliases.add(searchKey(name));
  }
  const out: BrandRow[] = [];
  for (const [key, g] of groups) {
    if (g.count < 2) continue;
    const [kindKey, kind] = mostCommon(g.kinds).split('=') as [string, string];
    const n = nsi ? nsiBrand(nsi, key, kindKey, kind) : undefined;
    const name = n?.name ?? mostCommon(g.names);
    for (const a of n?.aliases ?? []) g.aliases.add(searchKey(a));
    g.aliases.add(searchKey(name));
    out.push({ key, name, name_folded: searchKey(name), aliases: [...g.aliases].filter((a) => a.length >= 2).slice(0, 20), kind_key: kindKey, kind, count: g.count });
  }
  return out.sort((a, b) => b.count - a.count);
}

/** What the place card shows besides the address: pictures, e-mail, social pages, speciality. */
const EXTRA_TAGS: Record<string, string> = {
  image: 'image', logo: 'logo', wikidata: 'wikidata', wikimedia_commons: 'commons', email: 'email',
  instagram: 'instagram', facebook: 'facebook', 'healthcare:speciality': 'speciality', description: 'description',
};
export function extraOf(t: Tags): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const [tag, key] of Object.entries(EXTRA_TAGS)) if (t[tag]) out[key] = t[tag]!;
  return Object.keys(out).length ? out : null;
}

export function foodsOf(p: Place): string[] {
  if (!isFood(p)) return [...p.extraFoods];
  const tags: Tags = { ...p.tags, amenity: p.kindKey === 'amenity' ? p.kind : p.tags.amenity, name: p.name };
  return [...new Set([...classify(tags), ...p.extraFoods])];
}

export function brandKey(p: Place): string | null {
  if (p.tags['brand:wikidata']) return p.tags['brand:wikidata']!;
  if (p.tags.brand) return `b:${fold(p.tags.brand)}`;
  return null;
}

async function main() {
  const osmFile = process.argv[2];
  if (!osmFile) throw new Error('usage: tsx import/build.ts <osm.geojsonseq> [--src <dir>]');
  const srcAt = process.argv.indexOf('--src');
  const srcDir = srcAt > 0 ? process.argv[srcAt + 1]! : resolve(dirname(osmFile), 'src');
  const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  await ensureDatabase(url);

  const { places, towns, counts, nsi } = await build(osmFile, srcDir);
  const brands = brandsOf(places, nsi);
  console.log('read', JSON.stringify(counts), `→ ${places.length} places`);

  const db = createPool(url);
  const client = await db.connect();
  try {
    await client.query(SCHEMA);
    await client.query('begin');
    const started = (await client.query<{ now: Date }>('select now()')).rows[0]!.now;

    await client.query('truncate town');
    for (let i = 0; i < towns.length; i += 2000) {
      await client.query(
        `insert into town (name, name_folded, kind, geom)
         select t.name, t.folded, t.kind, st_setsrid(st_makepoint(t.lon, t.lat), 4326)::geography
         from jsonb_to_recordset($1::jsonb) as t(name text, folded text, kind text, lat float8, lon float8)`,
        [JSON.stringify(towns.slice(i, i + 2000).map((t) => ({ ...t, folded: searchKey(t.name) })))],
      );
    }

    await client.query('truncate place_food');
    for (let i = 0; i < places.length; i += 2000) {
      const batch = places.slice(i, i + 2000).map((p) => {
        const t = p.tags;
        return {
          source: p.source,
          source_id: p.sourceId,
          sources: [...p.sources],
          name: p.name,
          name_folded: searchKey(p.name),
          kind_key: p.kindKey,
          kind: p.kind,
          cuisine: t.cuisine ?? null,
          brand: t.brand ?? null,
          brand_key: brandKey(p),
          lat: p.lat,
          lon: p.lon,
          street: t['addr:street'] ?? t['addr:place'] ?? null,
          housenumber: t['addr:housenumber'] ?? null,
          postcode: t['addr:postcode'] ?? null,
          town: t['addr:city'] ?? null,
          opening_hours: t.opening_hours ?? null,
          phone: t.phone ?? null,
          website: t.website ?? null,
          takeaway: t.takeaway ?? null,
          delivery: t.delivery ?? null,
          outdoor_seating: t.outdoor_seating ?? null,
          wheelchair: t.wheelchair ?? null,
          vegetarian: t['diet:vegetarian'] ?? null,
          vegan: t['diet:vegan'] ?? null,
          extra: extraOf(t),
          foods: foodsOf(p),
        };
      });
      await client.query(
        `with input as (
           select * from jsonb_to_recordset($1::jsonb) as t(
             source text, source_id text, sources text[], name text, name_folded text, kind_key text, kind text,
             cuisine text, brand text, brand_key text, lat float8, lon float8, street text, housenumber text,
             postcode text, town text, opening_hours text, phone text, website text, takeaway text, delivery text,
             outdoor_seating text, wheelchair text, vegetarian text, vegan text, extra jsonb, foods text[])
         ), upserted as (
           insert into place (source, source_id, sources, name, name_folded, kind_key, kind, cuisine, brand, brand_key, geom,
             street, housenumber, postcode, town, opening_hours, phone, website, takeaway, delivery, outdoor_seating,
             wheelchair, vegetarian, vegan, extra, imported_at)
           select source, source_id, sources, name, name_folded, kind_key, kind, cuisine, brand, brand_key,
             st_setsrid(st_makepoint(lon, lat), 4326)::geography, street, housenumber, postcode, town, opening_hours,
             phone, website, takeaway, delivery, outdoor_seating, wheelchair, vegetarian, vegan, extra, now()
           from input
           on conflict (source, source_id) do update set
             sources = excluded.sources, name = excluded.name, name_folded = excluded.name_folded,
             kind_key = excluded.kind_key, kind = excluded.kind, cuisine = excluded.cuisine, brand = excluded.brand,
             brand_key = excluded.brand_key, geom = excluded.geom, street = excluded.street,
             housenumber = excluded.housenumber, postcode = excluded.postcode, town = excluded.town,
             opening_hours = excluded.opening_hours, phone = excluded.phone, website = excluded.website,
             takeaway = excluded.takeaway, delivery = excluded.delivery, outdoor_seating = excluded.outdoor_seating,
             wheelchair = excluded.wheelchair, vegetarian = excluded.vegetarian, vegan = excluded.vegan,
             extra = excluded.extra, imported_at = excluded.imported_at
           returning id, source, source_id
         )
         insert into place_food (place_id, food)
         select u.id, unnest(i.foods) from upserted u join input i using (source, source_id)`,
        [JSON.stringify(batch)],
      );
    }

    const gone = await client.query('delete from place where imported_at < $1', [started]);
    // No town in the address: the nearest town or village.
    await client.query(`
      update place p set town = (select t.name from town t order by t.geom <-> p.geom limit 1)
      where p.town is null or p.town = ''`);
    await client.query('truncate brand');
    for (let i = 0; i < brands.length; i += 2000) {
      await client.query(
        `insert into brand (key, name, name_folded, aliases, kind_key, kind, count)
         select key, name, name_folded, aliases, kind_key, kind, count
         from jsonb_to_recordset($1::jsonb) as t(key text, name text, name_folded text, aliases text[], kind_key text, kind text, count int)`,
        [JSON.stringify(brands.slice(i, i + 2000))],
      );
    }
    await client.query('commit');

    const foods = await client.query<{ food: string; n: string }>('select food, count(*) as n from place_food group by food order by count(*) desc');
    console.log(`${places.length} places, ${towns.length} towns, ${brands.length} brands; ${gone.rowCount ?? 0} removed`);
    console.log('largest brands:', brands.slice(0, 25).map((b) => `${b.name} ${b.count}`).join(', '));
    console.log(foods.rows.map((r) => `${r.food} ${r.n}`).join(', '));
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    client.release();
    await db.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
