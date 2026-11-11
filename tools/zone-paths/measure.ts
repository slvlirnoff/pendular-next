/**
 * Measures the planner on the zone-path test trips, calling the engine directly (same
 * dependencies as the API) and counting the MOTIS calls of each search.
 *
 *   MOTIS_SEGMENT_FILTER=1 pnpm tsx tools/zone-paths/measure.ts [--runs=7] [--only=name,name] [--json=out.json] [--calls]
 */
import { writeFileSync } from 'node:fs';
import { compare, type CommuteOption, type CommuteRequest } from '../../packages/engine/src/index.js';
import { buildDeps, readConfig } from '../../apps/api/src/deps.js';

const args = process.argv.slice(2);
const arg = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const RUNS = Number(arg('runs') ?? 7);
const ONLY = arg('only')?.split(',');

const CASES: [string, string, number, number, string, number, number][] = [
  ['lovatens-epfl', 'Lovatens', 46.6918052, 6.8641889, 'Ecublens VD, EPFL', 46.52219562, 6.56613675],
  ['lucens-lausanne', 'Lucens', 46.7085, 6.8393, 'Lausanne, gare', 46.5167, 6.6291],
  ['lelocle-neuchatel', 'Le Locle', 47.0577, 6.747, 'Neuchâtel', 46.9905, 6.929],
  ['marin-neuchatel', 'Marin-Epagnier', 47.003, 7.018, 'Neuchâtel', 46.9905, 6.929],
  ['chapelle-lausanne', 'Chapelle-sur-Moudon', 46.6693, 6.735, 'Lausanne, gare', 46.5167, 6.6291],
  ['aigle-lausanne', 'Aigle', 46.317, 6.964, 'Lausanne, gare', 46.5167, 6.6291],
  ['morges-epfl', 'Morges', 46.5112, 6.4985, 'EPFL', 46.5191, 6.5668],
  ['bulle-fribourg', 'Bulle', 46.6183, 7.057, 'Fribourg', 46.8031, 7.1513],
  ['zurich-uster', 'Zürich HB', 47.3779, 8.5403, 'Uster', 47.351, 8.7185],
  ['geneve-plo', 'Genève Cornavin', 46.2102, 6.1424, 'Plan-les-Ouates', 46.1667, 6.105],
  // Homes between two zones (see ZONE-PATHS.md).
  ['border-echandens', 'Echandens / Ecublens', 46.536, 6.55, 'Lausanne, Flon', 46.5208, 6.6303],
  ['border-penthereaz', 'Corcelles-sur-Chavornay', 46.696, 6.6196, 'Lausanne, Flon', 46.5208, 6.6303],
];

const request = (c: (typeof CASES)[number]): CommuteRequest =>
  ({
    arrival: { from: '07:30', to: '08:30' },
    pattern: { weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'], weeksOff: 5 },
    traveller: { ageGroup: 'adult', travelClass: 2, halfFare: false, vaudResident: true },
    car: { costPerKm: 0.74, parkingAtWorkPerMonth: 260 },
    home: { label: c[1], lat: c[2], lon: c[3] },
    work: { label: c[4], lat: c[5], lon: c[6] },
    ...(process.env.RULES ? { rules: JSON.parse(process.env.RULES) } : {}),
  }) as CommuteRequest;

const deps = buildDeps(readConfig());
// Count and time the HTTP calls of the routing provider.
const routing = deps.routing as unknown as { f: typeof fetch };
const inner = routing.f;
let calls: { path: string; ms: number; tags: boolean }[] = [];
let T0 = 0;
routing.f = (async (url: URL | string) => {
  const t = performance.now();
  try {
    return await inner(url as URL);
  } finally {
    const u = new URL(String(url));
    if (process.env.TRACE) console.log(`   ${Math.round(t - T0)} +${Math.round(performance.now() - t)} ms ${u.pathname} ${u.searchParams.get('mode') ?? u.searchParams.get('directModes') ?? ''} ${u.searchParams.get('max') ?? ''} ${(u.searchParams.get('many') ?? '').split(',').length} ${u.searchParams.get('fromPlace') ?? ''} ${u.searchParams.get('algorithm') ?? ''} ${(u.searchParams.get('allowedSegmentTags') ?? '').length ? 'zones' : ''}`);
    calls.push({ path: u.pathname.replace('/api/', '') + (u.searchParams.get('directModes') && u.searchParams.get('transitModes') === '' ? `:${u.searchParams.get('directModes')}` : ''), ms: performance.now() - t, tags: u.searchParams.has('allowedSegmentTags') });
  }
}) as typeof fetch;

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const range = (xs: number[]) => (Math.min(...xs) === Math.max(...xs) ? String(xs[0]) : `${Math.min(...xs)}–${Math.max(...xs)}`);

function groups(options: CommuteOption[]) {
  const by = new Map<string, CommuteOption[]>();
  for (const o of options) {
    if (!o.itinerary.legs.some((l) => l.line)) continue;
    const list = by.get(o.ticketGroup);
    if (list) list.push(o);
    else by.set(o.ticketGroup, [o]);
  }
  return [...by.values()].map((os) => {
    const p = os[0]!.cost.products[0];
    const conns = os.flatMap((o) => o.connections ?? []);
    return {
      kind: os[0]!.kind,
      site: os[0]!.access?.name ?? '',
      ticket: p ? `${p.alliance ?? p.kind}${p.allZones ? ' all' : p.zones?.length ? ` ${p.zones.length}z [${p.zones.join(' ')}]` : ''}` : '-',
      chf: os[0]!.cost.yearly,
      min: range(conns.length ? conns.map((c) => c.durationMin) : os.map((o) => o.durationMin)),
      changes: range(conns.length ? conns.map((c) => c.changes) : os.map((o) => o.changes)),
      departures: [...new Set(conns.map((c) => `${c.departure}→${c.arrival}`))].sort().join(' '),
      routes: os.map((o) => `${o.title} (${o.durationMin}′, ${o.changes}ch, ${o.departuresInWindow ?? '?'} dep)`),
    };
  });
}

const out: Record<string, unknown> = {};
for (const c of CASES) {
  if (ONLY && !ONLY.includes(c[0])) continue;
  if (!c[2]) continue;
  const times: number[] = [];
  let last: Awaited<ReturnType<typeof compare>> | undefined;
  let lastCalls = calls;
  for (let i = 0; i < RUNS; i++) {
    calls = [];
    const t = performance.now();
    T0 = t;
    last = await compare(request(c), deps);
    times.push(performance.now() - t);
    lastCalls = calls;
  }
  const g = groups(last!.options);
  const byPath = new Map<string, { n: number; ms: number; max: number }>();
  for (const k of lastCalls) {
    const key = k.tags ? `${k.path}+zones` : k.path;
    const e = byPath.get(key) ?? { n: 0, ms: 0, max: 0 };
    e.n++;
    e.ms += k.ms;
    e.max = Math.max(e.max, k.ms);
    byPath.set(key, e);
  }
  const callSummary = [...byPath.entries()].map(([p, e]) => `${p}×${e.n} (max ${Math.round(e.max)} ms)`).join(', ');
  console.log(`\n## ${c[0]}: ${c[1]} → ${c[4]}  median ${(median(times) / 1000).toFixed(2)} s (${times.map((t) => (t / 1000).toFixed(2)).join(' ')}), ${lastCalls.length} MOTIS calls, ${lastCalls.filter((k) => k.tags).length} zone-restricted`);
  if (args.includes('--calls')) console.log(`   calls: ${callSummary}`);
  for (const x of g) {
    console.log(` - ${x.kind}${x.site ? ` @ ${x.site}` : ''} | ${x.ticket} | CHF ${x.chf} | ${x.min} min | ${x.changes} ch | ${x.departures}`);
    for (const r of x.routes) console.log(`      ${r}`);
  }
  out[c[0]] = { medianS: Math.round(median(times) / 10) / 100, calls: lastCalls.length, zoneCalls: lastCalls.filter((k) => k.tags).length, callSummary, groups: g };
}
if (arg('json')) writeFileSync(arg('json')!, JSON.stringify(out, null, 1));
