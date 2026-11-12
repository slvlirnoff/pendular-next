import pg from 'pg';

/**
 * Storage for Pendular Plural. Everything derived from a list hangs off it with
 * ON DELETE CASCADE: deleting a list removes its people, analyses and results.
 */
const SCHEMA = `
create table if not exists lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Raised on every change to the people of the list; an analysis remembers the version it ran on.
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists people (
  id bigserial primary key,
  list_id uuid not null references lists(id) on delete cascade,
  -- The client's own pseudonymous identifier. No names, no e-mail addresses.
  ext_id text not null,
  address text,
  postcode text,
  city text,
  attrs jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'exact', 'check', 'notfound', 'manual')),
  lat double precision,
  lon double precision,
  matched text,
  candidates jsonb not null default '[]',
  reasons jsonb not null default '[]',
  checked_at timestamptz,
  unique (list_id, ext_id)
);
create index if not exists people_list_status on people (list_id, status);

create table if not exists analyses (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references lists(id) on delete cascade,
  name text not null,
  site_label text not null,
  site_lat double precision not null,
  site_lon double precision not null,
  arrival_from text not null,
  arrival_to text not null,
  weekdays jsonb not null,
  settings jsonb not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  list_version integer,
  progress integer not null default 0,
  total integer not null default 0,
  -- Data versions and rules used, so a result can be reproduced.
  stamp jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists analyses_status on analyses (status, created_at);

create table if not exists results (
  analysis_id uuid not null references analyses(id) on delete cascade,
  person_id bigint not null references people(id) on delete cascade,
  -- The figures the indicators are computed from (ResultRow without the person's own columns).
  row jsonb not null,
  -- The full comparison, as the planner returns it, for the per-person view.
  detail jsonb,
  primary key (analysis_id, person_id)
);
`;

export type Db = pg.Pool;

export async function openDb(url = process.env.DATABASE_URL ?? 'postgres://pendular@127.0.0.1:5433/pendular'): Promise<Db> {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  await pool.query(SCHEMA);
  return pool;
}
