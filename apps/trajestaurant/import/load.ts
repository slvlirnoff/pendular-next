/**
 * Loads the food places extracted by import/osm.sh (GeoJSON, one feature per line) into
 * PostgreSQL: one row per named place, its food types, and the towns that name where it is.
 * Rows keep their id from one import to the next (matched on the OSM object); places no longer
 * in OSM are removed.
 *
 *   tsx import/load.ts data/build/trajestaurant/food.geojsonseq
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { classify } from '../src/foods.js';
import { fold } from '../src/text.js';
import { createPool, DEFAULT_DATABASE_URL, ensureDatabase, SCHEMA } from '../server/db.js';

const KINDS = new Set(['restaurant', 'fast_food', 'cafe', 'ice_cream', 'food_court', 'biergarten']);
const TOWN_KINDS = new Set(['city', 'town', 'village']);

interface Feature {
  id: string;
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, string>;
}

export interface Row {
  source_id: string;
  name: string;
  name_folded: string;
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

const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

export function toRow(f: Feature): Row | null {
  const p = f.properties;
  if (!KINDS.has(p.amenity ?? '')) return null;
  const name = clean(p.name) ?? clean(p.brand);
  if (!name) return null;
  const c = centre(f.geometry);
  if (!c) return null;
  return {
    source_id: osmObject(f.id),
    name,
    name_folded: fold(name),
    kind: p.amenity!,
    cuisine: clean(p.cuisine),
    brand: clean(p.brand),
    lat: c.lat,
    lon: c.lon,
    street: clean(p['addr:street']) ?? clean(p['addr:place']),
    housenumber: clean(p['addr:housenumber']),
    postcode: clean(p['addr:postcode']),
    town: clean(p['addr:city']),
    opening_hours: clean(p.opening_hours),
    phone: clean(p.phone) ?? clean(p['contact:phone']),
    website: clean(p.website) ?? clean(p['contact:website']) ?? clean(p.url),
    takeaway: clean(p.takeaway),
    delivery: clean(p.delivery),
    outdoor_seating: clean(p.outdoor_seating),
    wheelchair: clean(p.wheelchair),
    vegetarian: clean(p['diet:vegetarian']),
    vegan: clean(p['diet:vegan']),
    foods: classify({ ...p, name }),
  };
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('usage: tsx import/load.ts <food.geojsonseq>');
  const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  await ensureDatabase(url);

  const rows: Row[] = [];
  const towns: { name: string; kind: string; lat: number; lon: number }[] = [];
  const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const raw of lines) {
    const line = raw.replace(/^\x1e/, '').trim();
    if (!line) continue;
    const f = JSON.parse(line) as Feature;
    const p = f.properties;
    if (TOWN_KINDS.has(p.place ?? '') && p.name && f.geometry.type === 'Point') {
      const [lon, lat] = f.geometry.coordinates as [number, number];
      towns.push({ name: p.name, kind: p.place!, lat, lon });
      continue;
    }
    const row = toRow(f);
    if (row) rows.push(row);
  }

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
        [JSON.stringify(towns.slice(i, i + 2000).map((t) => ({ ...t, folded: fold(t.name) })))],
      );
    }

    for (let i = 0; i < rows.length; i += 2000) {
      const batch = rows.slice(i, i + 2000);
      await client.query(
        `with input as (
           select * from jsonb_to_recordset($1::jsonb) as t(
             source_id text, name text, name_folded text, kind text, cuisine text, brand text, lat float8, lon float8,
             street text, housenumber text, postcode text, town text, opening_hours text, phone text, website text,
             takeaway text, delivery text, outdoor_seating text, wheelchair text, vegetarian text, vegan text, foods text[])
         ), upserted as (
           insert into restaurant (source, source_id, name, name_folded, kind, cuisine, brand, geom, street, housenumber,
             postcode, town, opening_hours, phone, website, takeaway, delivery, outdoor_seating, wheelchair, vegetarian, vegan, imported_at)
           select 'osm', source_id, name, name_folded, kind, cuisine, brand, st_setsrid(st_makepoint(lon, lat), 4326)::geography,
             street, housenumber, postcode, town, opening_hours, phone, website, takeaway, delivery, outdoor_seating, wheelchair,
             vegetarian, vegan, now()
           from input
           on conflict (source, source_id) do update set
             name = excluded.name, name_folded = excluded.name_folded, kind = excluded.kind, cuisine = excluded.cuisine,
             brand = excluded.brand, geom = excluded.geom, street = excluded.street, housenumber = excluded.housenumber,
             postcode = excluded.postcode, town = excluded.town, opening_hours = excluded.opening_hours, phone = excluded.phone,
             website = excluded.website, takeaway = excluded.takeaway, delivery = excluded.delivery,
             outdoor_seating = excluded.outdoor_seating, wheelchair = excluded.wheelchair, vegetarian = excluded.vegetarian,
             vegan = excluded.vegan, imported_at = excluded.imported_at
           returning id, source_id
         ), cleared as (
           delete from restaurant_food where restaurant_id in (select id from upserted)
         )
         insert into restaurant_food (restaurant_id, food)
         select u.id, unnest(i.foods) from upserted u join input i using (source_id)`,
        [JSON.stringify(batch.map((r) => ({ ...r, foods: r.foods })))],
      );
    }

    // Gone from OSM since the last import.
    const gone = await client.query(`delete from restaurant where source = 'osm' and imported_at < $1`, [started]);
    // No town in the address: the nearest town or village.
    await client.query(`
      update restaurant r set town = (select t.name from town t order by t.geom <-> r.geom limit 1)
      where r.source = 'osm' and (r.town is null or r.town = '')`);
    await client.query('commit');

    const count = await client.query<{ food: string; n: string }>(
      'select food, count(*) as n from restaurant_food group by food order by count(*) desc',
    );
    console.log(`${rows.length} restaurants, ${towns.length} towns; ${gone.rowCount ?? 0} removed`);
    console.log(count.rows.map((r) => `${r.food} ${r.n}`).join(', '));
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
