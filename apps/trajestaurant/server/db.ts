import pg from 'pg';

export const DEFAULT_DATABASE_URL = 'postgres://pendular@127.0.0.1:5433/trajestaurant';

/**
 * Places (to eat, shops, and other places one goes to), the food types of those that serve food,
 * the brands, and the towns. A place is keyed by the record it was first built from (OSM when OSM
 * has it) and keeps its id across imports; `sources` lists every source that contributed to it.
 */
export const SCHEMA = `
create extension if not exists postgis;
create extension if not exists pg_trgm;

-- The first version held restaurants only.
drop table if exists restaurant_food;
drop table if exists restaurant;

create table if not exists place (
  id bigserial primary key,
  -- osm | atp (All The Places) | overture
  source text not null,
  source_id text not null,
  sources text[] not null,
  name text not null,
  -- Lower case without accents, punctuation as spaces: what the name search compares.
  name_folded text not null,
  -- Main OSM key and value: amenity=restaurant, shop=supermarket, leisure=fitness_centre…
  kind_key text not null,
  kind text not null,
  cuisine text,
  brand text,
  -- Wikidata id of the brand, or 'b:' and the folded brand name when it has none.
  brand_key text,
  geom geography(Point, 4326) not null,
  street text,
  housenumber text,
  postcode text,
  -- Town from the address, or the nearest town or village.
  town text,
  opening_hours text,
  phone text,
  website text,
  takeaway text,
  delivery text,
  outdoor_seating text,
  wheelchair text,
  vegetarian text,
  vegan text,
  -- What the card shows besides: image, logo, wikidata, commons, email, instagram, facebook, speciality.
  extra jsonb,
  imported_at timestamptz not null default now(),
  unique (source, source_id)
);
alter table place add column if not exists extra jsonb;
create index if not exists place_geom on place using gist (geom);
create index if not exists place_name on place using gin (name_folded gin_trgm_ops);
create index if not exists place_brand on place (brand_key);
create index if not exists place_kind on place (kind_key, kind);

create table if not exists place_food (
  place_id bigint not null references place(id) on delete cascade,
  food text not null,
  primary key (place_id, food)
);
create index if not exists place_food_food on place_food (food, place_id);

-- Chains: every brand with at least two places in Switzerland.
create table if not exists brand (
  key text primary key,
  name text not null,
  name_folded text not null,
  -- Folded names to search by (brand tags, names, NSI match names).
  aliases text[] not null,
  kind_key text not null,
  kind text not null,
  count integer not null
);
create index if not exists brand_name on brand (name_folded);

create table if not exists town (
  id bigserial primary key,
  name text not null,
  name_folded text not null,
  kind text not null,
  geom geography(Point, 4326) not null
);
create index if not exists town_geom on town using gist (geom);
`;

/** Creates the database named in the URL when it does not exist yet (needs the right to create databases). */
export async function ensureDatabase(url: string): Promise<void> {
  const u = new URL(url);
  const name = decodeURIComponent(u.pathname.slice(1));
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const c = new pg.Client({ connectionString: admin.toString() });
  await c.connect();
  try {
    const r = await c.query('select 1 from pg_database where datname = $1', [name]);
    if (r.rowCount === 0) await c.query(`create database "${name.replace(/"/g, '""')}"`);
  } finally {
    await c.end();
  }
}

export function createPool(url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL): pg.Pool {
  return new pg.Pool({ connectionString: url, max: 8 });
}
