import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { compare, type CommuteRequest } from '@pendular/engine';
import { buildDeps, readConfig } from './deps.js';
import { parseRequest } from './validate.js';

const cfg = readConfig();
const deps = buildDeps(cfg);
const app = new Hono();

app.get('/api/health', (c) =>
  c.json({ ok: true, parkRail: deps.parkRail.length, bikeParking: deps.bikeParking.length, cityParkRide: deps.cityParkRide.length }),
);

/** Place search: stops, addresses and places from the routing engine's own geocoder. */
app.get('/api/places', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (q.length < 2) return c.json([]);
  const url = new URL('/api/v1/geocode', cfg.motisUrl);
  url.searchParams.set('text', q);
  url.searchParams.set('language', c.req.query('lang') ?? 'fr');
  const res = await fetch(url);
  if (!res.ok) return c.json({ error: 'geocoder unavailable' }, 502);
  const matches = (await res.json()) as {
    type: string; name: string; id: string; lat: number; lon: number; street?: string; houseNumber?: string; zip?: string;
    areas?: { name: string; adminLevel: number; default?: boolean }[];
  }[];
  return c.json(
    matches.slice(0, 8).map((m) => {
      const town = m.areas?.find((a) => a.default)?.name ?? m.areas?.[0]?.name;
      const street = m.type === 'ADDRESS' ? [m.street ?? m.name, m.houseNumber].filter(Boolean).join(' ') : m.name;
      return {
        label: [street, m.type !== 'STOP' && town && town !== street ? [m.zip, town].filter(Boolean).join(' ') : null].filter(Boolean).join(', '),
        type: m.type === 'STOP' ? 'stop' : m.type === 'ADDRESS' ? 'address' : 'place',
        lat: m.lat,
        lon: m.lon,
        stopId: m.type === 'STOP' ? m.id : undefined,
      };
    }),
  );
});

app.post('/api/compare', async (c) => {
  let req: CommuteRequest;
  try {
    req = parseRequest(await c.req.json());
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
  try {
    return c.json(await compare(req, deps));
  } catch (e) {
    console.error(e);
    return c.json({ error: 'comparison failed' }, 500);
  }
});

// The built site, when present (production).
app.use('/*', serveStatic({ root: '../web/dist' }));

serve({ fetch: app.fetch, port: cfg.port }, (info) => console.log(`pendular api on :${info.port}, motis ${cfg.motisUrl}`));
