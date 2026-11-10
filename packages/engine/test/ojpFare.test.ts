import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildFareRequest,
  createOjpFareClient,
  parseFareResponse,
  totalForClass,
} from '../src/fares/ojpFare.js';
import type { Leg } from '../src/types.js';

const fx = (n: string): string => new URL(`./fixtures/ojpfare/${n}`, import.meta.url).pathname;
const read = (n: string): string => readFileSync(fx(n), 'utf8');
/** Snapshot helper: compares with the fixture; UPDATE_FIXTURES=1 (or a missing file) writes it. */
function snapshot(name: string, actual: string): string {
  if (process.env['UPDATE_FIXTURES'] === '1' || !existsSync(fx(name))) writeFileSync(fx(name), actual);
  return read(name);
}

const NOW = new Date('2026-11-10T09:00:00.000Z');

const stop = (name: string, stopId: string) => ({ name, stopId, lat: 46.5, lon: 6.6 });
const lausanneBern: Leg[] = [
  {
    mode: 'rail',
    from: stop('Lausanne', '8501120'),
    to: stop('Bern', '8507000'),
    departure: '2026-11-18T08:08:00+01:00',
    arrival: '2026-11-18T09:04:00+01:00',
    durationMin: 56,
    distanceM: 98000,
    line: { name: 'IC 1', category: 'IC', operator: 'SBB' },
    intermediateStops: [stop('Fribourg/Freiburg', '8504100')],
  },
];
const lucensLausanne: Leg[] = [
  {
    mode: 'walk',
    from: { name: 'Home', lat: 46.7, lon: 6.8 },
    to: stop('Lucens', '8504121'),
    departure: '2026-11-18T06:50:00+01:00',
    arrival: '2026-11-18T06:58:00+01:00',
    durationMin: 8,
    distanceM: 600,
  },
  {
    mode: 'rail',
    from: stop('Lucens', '8504121'),
    to: stop('Palézieux', '8504100'),
    departure: '2026-11-18T07:02:00+01:00',
    arrival: '2026-11-18T07:25:00+01:00',
    durationMin: 23,
    distanceM: 20000,
    line: { name: 'S8', category: 'S', operator: 'SBB' },
  },
  {
    mode: 'rail',
    from: stop('Palézieux', '8504100'),
    to: stop('Lausanne', '8501120'),
    departure: '2026-11-18T07:31:00+01:00',
    arrival: '2026-11-18T07:48:00+01:00',
    durationMin: 17,
    distanceM: 18000,
    line: { name: 'RE', category: 'RE', operator: 'SBB' },
  },
];

describe('buildFareRequest', () => {
  it('matches the stored request for a direct trip, second class', () => {
    const xml = buildFareRequest(lausanneBern, { travelClass: 2, halfFare: false, now: NOW });
    expect(xml).toBe(snapshot('request-lausanne-bern-2nd.xml', xml));
  });
  it('matches the stored request for a two-leg trip, first class, half fare', () => {
    const xml = buildFareRequest(lucensLausanne, { travelClass: 1, halfFare: true, now: NOW });
    expect(xml).toBe(snapshot('request-lucens-lausanne-1st-hta.xml', xml));
  });
  it('has the documented OJP 1.0 structure', () => {
    const xml = buildFareRequest(lucensLausanne, { travelClass: 1, halfFare: true, now: NOW });
    expect(xml).toContain('version="1.0"');
    expect(xml).toContain('<ojp:OJPFareRequest>');
    expect(xml).toContain('<ojp:TravelClass>first</ojp:TravelClass>');
    expect(xml).toContain('<ojp:EntitlementProduct>HTA</ojp:EntitlementProduct>');
    expect(xml.match(/<ojp:TimedLeg>/g)).toHaveLength(2);
    expect(xml.match(/<ojp:TransferLeg>/g)).toHaveLength(1);
    // times are converted to UTC, the walk leg is dropped
    expect(xml).toContain('<ojp:StartTime>2026-11-18T06:02:00Z</ojp:StartTime>');
    expect(xml).not.toContain('Home');
    expect(xml).toContain('<ojp:OperatingDayRef>2026-11-18</ojp:OperatingDayRef>');
  });
  it('omits the entitlement without half fare and escapes names', () => {
    const legs: Leg[] = [
      { ...lausanneBern[0]!, to: stop('A & B <x>', '8507000'), intermediateStops: [] },
    ];
    const xml = buildFareRequest(legs, { travelClass: 2, halfFare: false, now: NOW });
    expect(xml).not.toContain('EntitlementProduct');
    expect(xml).toContain('A &amp; B &lt;x&gt;');
  });
  it('rejects trips it cannot price', () => {
    expect(() => buildFareRequest([lucensLausanne[0]!], { travelClass: 2, halfFare: false })).toThrow();
    const noId: Leg = { ...lausanneBern[0]!, from: { name: 'X', lat: 0, lon: 0 } };
    expect(() => buildFareRequest([noId], { travelClass: 2, halfFare: false })).toThrow();
  });
});

describe('parseFareResponse (documented example, not recorded)', () => {
  const quotes = parseFareResponse(read('doc-response-success.xml'));
  it('returns one entry per product and class', () => {
    expect(quotes).toHaveLength(2);
    expect(quotes[0]).toMatchObject({ single: 2.8, currency: 'CHF', travelClass: 2, half: false, fareAuthority: 'NOVA' });
    expect(quotes[1]).toMatchObject({ single: 4.8, travelClass: 1, productName: '10972' });
  });
  it('takes half from the hint', () => {
    expect(parseFareResponse(read('doc-response-success.xml'), { half: true })[0]?.half).toBe(true);
  });
  it('picks the class total, dropping day passes and keeping the cheapest alternative', () => {
    expect(totalForClass(quotes, 1)?.single).toBe(4.8);
    const mixed = [
      { single: 20, currency: 'CHF', travelClass: 2 as const, half: false, productId: '125', fromLeg: '1', toLeg: '1' },
      { single: 12, currency: 'CHF', travelClass: 2 as const, half: false, productId: '84004', fromLeg: '1', toLeg: '1' },
      { single: 5, currency: 'CHF', travelClass: 2 as const, half: false, productId: '2361', fromLeg: '3', toLeg: '3' },
      { single: 3.2, currency: 'CHF', travelClass: 2 as const, half: false, productId: '125', fromLeg: '3', toLeg: '3' },
    ];
    expect(totalForClass(mixed, 2)?.single).toBe(15.2);
    expect(totalForClass([], 2)).toBeNull();
  });
});

describe('parseFareResponse errors', () => {
  it('returns [] for an error delivery', () => {
    expect(parseFareResponse(read('synthetic-response-error.xml'))).toEqual([]);
  });
  it('returns [] for empty, garbage and priceless input', () => {
    expect(parseFareResponse('')).toEqual([]);
    expect(parseFareResponse('Internal Server Error')).toEqual([]);
    expect(parseFareResponse('<ojp:OJPFareDelivery><Status>true</Status></ojp:OJPFareDelivery>')).toEqual([]);
  });
});

describe('createOjpFareClient', () => {
  const okFetch = (calls: { url: string; init: RequestInit | undefined }[]): typeof fetch =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(read('doc-response-success.xml'), { status: 200 });
    }) as typeof fetch;

  it('quotes, sends the right request and caches', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const c = createOjpFareClient({ token: 't', fetch: okFetch(calls), minIntervalMs: 0 });
    const a = await c.quote(lausanneBern, { travelClass: 2, halfFare: false, now: NOW });
    const b = await c.quote(lausanneBern, { travelClass: 2, halfFare: false, now: NOW });
    expect(a).toMatchObject({ single: 2.8, travelClass: 2 });
    expect(b).toEqual(a);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.opentransportdata.swiss/ojpfare');
    const h = calls[0]?.init?.headers as Record<string, string>;
    expect(h['Content-Type']).toBe('application/xml');
    expect(h['Authorization']).toBe('Bearer t');
    await c.quote(lausanneBern, { travelClass: 1, halfFare: false, now: NOW });
    expect(calls).toHaveLength(2);
  });
  it('spaces requests', async () => {
    const stamps: number[] = [];
    const f = (async () => {
      stamps.push(Date.now());
      return new Response(read('doc-response-success.xml'));
    }) as unknown as typeof fetch;
    const c = createOjpFareClient({ token: 't', fetch: f, minIntervalMs: 80 });
    await Promise.all([
      c.quote(lausanneBern, { travelClass: 2, halfFare: false }),
      c.quote(lucensLausanne, { travelClass: 2, halfFare: false }),
    ]);
    expect(stamps).toHaveLength(2);
    expect((stamps[1] ?? 0) - (stamps[0] ?? 0)).toBeGreaterThanOrEqual(70);
  });
  it('returns null on HTTP errors, thrown fetches, error bodies, missing token and untranslatable trips', async () => {
    const opts = { travelClass: 2 as const, halfFare: false };
    const mk = (f: typeof fetch, token: string | undefined = 't') =>
      createOjpFareClient({ token, fetch: f, minIntervalMs: 0 });
    expect(await mk((async () => new Response('Internal Server Error', { status: 500 })) as typeof fetch).quote(lausanneBern, opts)).toBeNull();
    expect(await mk((async () => { throw new Error('net'); }) as typeof fetch).quote(lausanneBern, opts)).toBeNull();
    expect(await mk((async () => new Response(read('synthetic-response-error.xml'))) as typeof fetch).quote(lausanneBern, opts)).toBeNull();
    expect(await mk(okFetch([]), '').quote(lausanneBern, opts)).toBeNull();
    expect(await mk(okFetch([])).quote([lucensLausanne[0]!], opts)).toBeNull();
  });
  it('aborts after the timeout', async () => {
    const f = ((_u: string, init?: RequestInit) =>
      new Promise((_r, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new Error('aborted')));
      })) as unknown as typeof fetch;
    const c = createOjpFareClient({ token: 't', fetch: f, minIntervalMs: 0 });
    const t0 = Date.now();
    expect(await c.quote(lausanneBern, { travelClass: 2, halfFare: false })).toBeNull();
    expect(Date.now() - t0).toBeLessThan(8000);
  }, 10000);
});
