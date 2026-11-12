import pg from 'pg';

export const DEFAULT_DATABASE_URL = 'postgres://pendular@127.0.0.1:5433/trajestaurant';

/**
 * Restaurants and the food types they serve. A restaurant comes from one source (OSM today) and
 * keeps its id across imports: the import updates rows in place by (source, source_id).
 */
export const SCHEMA = `
create extension if not exists postgis;
create extension if not exists pg_trgm;

create table if not exists restaurant (
  id bigserial primary key,
  source text not null,
  source_id text not null,
  name text not null,
  -- Lower case without accents, for the name search.
  name_folded text not null,
  -- OSM amenity: restaurant, fast_food, cafe, ice_cream, food_court, biergarten.
  kind text not null,
  cuisine text,
  brand text,
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
  imported_at timestamptz not null default now(),
  unique (source, source_id)
);
create index if not exists restaurant_geom on restaurant using gist (geom);
create index if not exists restaurant_name on restaurant using gin (name_folded gin_trgm_ops);

create table if not exists restaurant_food (
  restaurant_id bigint not null references restaurant(id) on delete cascade,
  food text not null,
  primary key (restaurant_id, food)
);
create index if not exists restaurant_food_food on restaurant_food (food, restaurant_id);

-- Towns and villages: to name where a restaurant is when its address has no town.
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
