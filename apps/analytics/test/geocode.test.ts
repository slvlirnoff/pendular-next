import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  compareStreet,
  createGeocoder,
  damerauLevenshtein,
  decide,
  distanceM,
  houseNumberKey,
  normaliseStreet,
  parseAddress,
  parseMotisItem,
  parseSwisstopoResult,
  scoreCandidate,
  splitStreetNumber,
  townMatches,
  type AddressInput,
  type RawCandidate,
} from '../src/geocode.js';

// ───────── recorded answers (tools/address-test/record-fixtures.ts), no network ─────────

interface Fixture {
  input: AddressInput;
  responses: Record<string, { status: number; body: string }>;
}
const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'geocode');
const fixtures = new Map<string, Fixture>();
for (const f of readdirSync(FIXTURE_DIR)) {
  if (f.endsWith('.json')) fixtures.set(f.slice(0, -5), JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf8')) as Fixture);
}

/** A fetch that answers only from one fixture; asking for anything else is a test failure. */
function fixtureFetch(name: string) {
  const fx = fixtures.get(name);
  if (!fx) throw new Error(`no fixture ${name}`);
  const asked: string[] = [];
  const fetchFn: typeof fetch = async (input) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    asked.push(url);
    const r = fx.responses[url];
    if (!r) throw new Error(`unrecorded request: ${url}`);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body, json: async () => JSON.parse(r.body) as unknown } as Response;
  };
  return { fetch: fetchFn, asked, input: fx.input };
}

async function run(name: string) {
  const f = fixtureFetch(name);
  const result = await createGeocoder({ fetch: f.fetch }).check(f.input);
  return { result, asked: f.asked };
}

// ───────── parser ─────────

describe('parseAddress', () => {
  it('French one line: street, number, postcode, town', () => {
    const p = parseAddress({ address: 'Rue de Bourg 27, 1003 Lausanne' });
    expect(p).toMatchObject({ street: 'Rue de Bourg', number: '27', postcode: '1003', town: 'Lausanne' });
    expect(p.streetKey.type).toBe('rue');
  });

  it('French, number first, split into columns', () => {
    const p = parseAddress({ address: '27 rue de Bourg', postcode: '1003', city: 'Lausanne' });
    expect(p).toMatchObject({ street: 'rue de Bourg', number: '27', postcode: '1003', town: 'Lausanne' });
    expect(parseAddress({ address: '5, rue de la Gare, Fribourg' })).toMatchObject({ street: 'rue de la Gare', number: '5', town: 'Fribourg' });
  });

  it('French abbreviations and number suffixes (5 bis = 5b)', () => {
    expect(parseAddress({ address: 'Av. de la Gare 5 bis, 1003 Lausanne' })).toMatchObject({ street: 'Avenue de la Gare', number: '5b' });
    expect(parseAddress({ address: 'Ch. des Vignes 3', postcode: 'CH-1260' })).toMatchObject({ street: 'Chemin des Vignes', number: '3', postcode: '1260' });
    expect(parseAddress({ address: 'Rte de Berne 12 A, 1010 Lausanne' })).toMatchObject({ street: 'Route de Berne', number: '12a' });
    expect(parseAddress({ address: 'Bd de Grancy 8' }).streetKey.type).toBe('boulevard');
    expect(parseAddress({ address: 'Rue St-Martin 3' }).streetKey.key).toBe(normaliseStreet('Rue Saint-Martin').key);
  });

  it('German: number after the name, -str. abbreviation, ranges, "Sankt"', () => {
    expect(parseAddress({ address: 'Bahnhofstr. 12a, 8001 Zürich' })).toMatchObject({ street: 'Bahnhofstrasse', number: '12a', postcode: '8001', town: 'Zürich' });
    expect(parseAddress({ address: 'Hauptstrasse 5-7, 4052 Basel, Schweiz' })).toMatchObject({ number: '5', postcode: '4052', town: 'Basel' });
    expect(parseAddress({ address: 'Sankt Alban-Vorstadt 20' }).streetKey.key).toBe(normaliseStreet('St. Alban-Vorstadt').key);
    expect(parseAddress({ address: 'Bahnhofstrasse 5 8001 Zürich' })).toMatchObject({ street: 'Bahnhofstrasse', number: '5', postcode: '8001' });
    expect(parseAddress({ address: 'Bahnhofstrasse' }).streetKey.type).toBe('strasse');
  });

  it('Italian: via, piazza, number suffix', () => {
    expect(parseAddress({ address: 'Via San Gottardo 12, 6900 Lugano' })).toMatchObject({ street: 'Via San Gottardo', number: '12', postcode: '6900', town: 'Lugano' });
    expect(parseAddress({ address: 'Via Nassa 5 a', postcode: '6900', city: 'Lugano' })).toMatchObject({ street: 'Via Nassa', number: '5a' });
    expect(parseAddress({ address: 'Piazza della Riforma 1, 6900 Lugano' }).streetKey.type).toBe('piazza');
  });

  it('postcode first, town with a number, postcode and town in the columns', () => {
    expect(parseAddress({ address: '1003 Lausanne, Rue de Bourg 27' })).toMatchObject({ street: 'Rue de Bourg', number: '27', postcode: '1003', town: 'Lausanne' });
    expect(parseAddress({ address: 'Route du Jorat 146 1000 Lausanne 26' })).toMatchObject({ number: '146', postcode: '1000', town: 'Lausanne 26' });
    expect(parseAddress({ address: 'Rue de Bourg 27 (2e étage)', postcode: '1003 Lausanne' })).toMatchObject({ number: '27', postcode: '1003', town: 'Lausanne' });
    expect(parseAddress({ address: 'Rue de Bourg 27', postcode: '1003', city: 'Mex (VD)' }).town).toBe('Mex');
  });

  it('no number, no postcode, nothing', () => {
    expect(parseAddress({ address: 'Rue de la Gare, 1003 Lausanne' })).toMatchObject({ street: 'Rue de la Gare', number: null, postcode: '1003' });
    expect(parseAddress({ address: 'Rue de la Gare 5' }).postcode).toBeNull();
    expect(parseAddress({ address: '' }).street).toBe('');
    expect(parseAddress({}).street).toBe('');
    expect(parseAddress({ address: '12345 67890' }).street).toBe('');
    expect(parseAddress({ postcode: '1003', city: 'Lausanne' }).street).toBe('');
  });

  it('house numbers', () => {
    expect(houseNumberKey('12')).toBe('12');
    expect(houseNumberKey('12 A')).toBe('12a');
    expect(houseNumberKey('12 bis')).toBe('12b');
    expect(houseNumberKey('007')).toBe('7');
    expect(houseNumberKey('abc')).toBeNull();
    expect(splitStreetNumber('Rue du 24 Janvier 14 b')).toEqual({ street: 'Rue du 24 Janvier', number: '14b' });
    expect(splitStreetNumber('Rue du 24 Janvier').number).toBeNull();
    expect(splitStreetNumber('Chemin du 1er-Août 12').number).toBe('12');
  });
});

describe('comparing names', () => {
  it('Damerau-Levenshtein counts a transposition as one edit', () => {
    expect(damerauLevenshtein('gare', 'gaer')).toBe(1);
    expect(damerauLevenshtein('gare', 'garde')).toBe(1);
    expect(damerauLevenshtein('kitten', 'sitting')).toBe(3);
  });

  const cmp = (a: string, b: string) => compareStreet(normaliseStreet(a), normaliseStreet(b));

  it('the same street after normalisation', () => {
    expect(cmp('av. de la gare', 'Avenue de la Gare').exactish).toBe(true);
    expect(cmp('BAHNHOFSTR.', 'Bahnhofstrasse').exactish).toBe(true);
    expect(cmp('Zuercherstrasse', 'Zürcherstrasse').exactish).toBe(true);
    expect(cmp('Rue Louis-Favre', 'rue louis favre').exactish).toBe(true);
  });

  it('typo tolerance: 1 for short names, 2 for long ones, never across digits', () => {
    expect(cmp('Rue de Burg', 'Rue de Bourg').exactish).toBe(true); // short, 1 edit
    expect(cmp('Rue du Lc', 'Rue du Lac').exactish).toBe(true);
    expect(cmp('Rue Gare', 'Rue Gar').exactish).toBe(true);
    expect(cmp('Chemin des Vignolles', 'Chemin des Vignoles').exactish).toBe(true); // long, 1
    expect(cmp('Chemin des Vignoles', 'Chemin des Vignobles').exactish).toBe(true);
    expect(cmp('Rue de Bg', 'Rue de Bourg').exactish).toBe(false); // short, 2 edits
    expect(cmp('Chemin des Vignes', 'Chemin des Vi').exactish).toBe(false);
    expect(cmp('Rue du 24 Janvier', 'Rue du 14 Janvier').exactish).toBe(false);
  });

  it('the street type must be the same: rue is not route, strasse is not weg or gasse', () => {
    for (const [a, b] of [
      ['Rue de Bourg', 'Route de Bourg'],
      ['Rue du Lac', 'Chemin du Lac'],
      ['Bahnhofstrasse', 'Bahnhofweg'],
      ['Dorfstrasse', 'Dorfgasse'],
      ['Via Roma', 'Viale Roma'],
    ] as const) {
      const m = cmp(a, b);
      expect(m.exactish, `${a} / ${b}`).toBe(false);
      expect(m.similar, `${a} / ${b}`).toBe(true); // still worth a human look
    }
  });

  it('unrelated names are neither exact nor similar', () => {
    expect(cmp('Rue de la Gare', 'Rue du Collège').similar).toBe(false);
    expect(cmp('Bahnhofstrasse', 'Seestrasse').similar).toBe(false);
  });

  it('towns in several languages', () => {
    expect(townMatches('Biel', ['Biel/Bienne'])).toBe(true);
    expect(townMatches('Bienne', ['Biel/Bienne'])).toBe(true);
    expect(townMatches('Freiburg', ['Fribourg'])).toBe(true);
    expect(townMatches('Genf', ['Genève'])).toBe(true);
    expect(townMatches('Zurich', ['Zürich'])).toBe(true);
    expect(townMatches('Lausanne', ['Lausanne 26'])).toBe(true);
    expect(townMatches('Mex', ['Mex VD'])).toBe(true);
    expect(townMatches('Fribourg', ['Lausanne'])).toBe(false);
    expect(townMatches('Bussigny', ['Lausanne'])).toBe(false);
  });
});

// ───────── candidates, scoring, decisions (hand-made) ─────────

const cand = (over: Partial<RawCandidate> & { label: string; lat: number; lon: number }): RawCandidate => ({
  source: 'swisstopo', street: 'Rue de Bourg', number: '27', zip: '1003', towns: ['Lausanne'], rank: 0, ...over,
});
const P = (a: AddressInput) => parseAddress(a);

describe('decide', () => {
  const lausanne = { lat: 46.52, lon: 6.635 };

  it('exact needs postcode, number and street to agree', () => {
    const d = decide(P({ address: 'Rue de Bourg 27, 1003 Lausanne' }), [cand({ label: 'A', ...lausanne })], 'swisstopo');
    expect(d?.result).toMatchObject({ status: 'exact', reasons: [] });
  });

  it("does not trust the service's rank: the right candidate may come second", () => {
    const d = decide(
      P({ address: 'Rue de Bourg 27, 1003 Lausanne' }),
      [cand({ label: 'neighbour', number: '29', rank: 0, ...lausanne }), cand({ label: 'right', rank: 1, lat: 46.5201, lon: 6.6351 })],
      'swisstopo',
    );
    expect(d?.result.status).toBe('exact');
    expect(d?.result.matched).toBe('right');
  });

  it("reason 'houseNumber': the neighbour the service returns is only a check", () => {
    const d = decide(P({ address: 'Rue de Bourg 28, 1003 Lausanne' }), [cand({ label: 'n27', ...lausanne }), cand({ label: 'n30', number: '30', lat: 46.5203, lon: 6.636 })], 'swisstopo');
    expect(d?.result.status).toBe('check');
    expect(d?.result.reasons).toEqual(['houseNumber']);
    expect(d?.result.matched).toBe('n27'); // the nearest number
  });

  it('27 is not 27a', () => {
    const d = decide(P({ address: 'Rue de Bourg 27a, 1003 Lausanne' }), [cand({ label: 'n27', ...lausanne })], 'swisstopo');
    expect(d?.result.reasons).toEqual(['houseNumber']);
  });

  it("reason 'postcode': differs, or is missing", () => {
    expect(decide(P({ address: 'Rue de Bourg 27, 1030 Lausanne' }), [cand({ label: 'A', ...lausanne })], 'swisstopo')?.result.reasons).toEqual(['postcode']);
    expect(decide(P({ address: 'Rue de Bourg 27' }), [cand({ label: 'A', ...lausanne })], 'swisstopo')?.result.reasons).toEqual(['postcode']);
  });

  it('a postcode that belongs to another town than the one given is not exact (swapped digits)', () => {
    const bussigny = cand({ label: 'B', zip: '1030', towns: ['Bussigny'], ...lausanne });
    const d = decide(P({ address: 'Rue de Bourg 27', postcode: '1030', city: 'Lausanne' }), [bussigny], 'swisstopo');
    expect(d?.result).toMatchObject({ status: 'check', reasons: ['postcode'] });
  });

  it('the town name is ignored when the postcode agrees on the place (other language)', () => {
    const biel = cand({ label: 'Biel', zip: '2502', towns: ['Biel/Bienne', 'Biel/Bienne'], street: 'Rue du Collège', number: '23', ...lausanne });
    expect(decide(P({ address: 'Rue du Collège 23', postcode: '2502', city: 'Bienne' }), [biel], 'swisstopo')?.result.status).toBe('exact');
    expect(decide(P({ address: 'Rue du Collège 23', postcode: '2502', city: 'Biel' }), [biel], 'swisstopo')?.result.status).toBe('exact');
    expect(decide(P({ address: 'Rue du Collège 23', postcode: '2502' }), [biel], 'swisstopo')?.result.status).toBe('exact'); // postcode alone is enough
  });

  it("reason 'noNumber': the position is the street", () => {
    const d = decide(P({ address: 'Rue de Bourg, 1003 Lausanne' }), [cand({ label: 'A', ...lausanne })], 'swisstopo');
    expect(d?.result).toMatchObject({ status: 'check', reasons: ['noNumber'] });
  });

  it("reason 'street': name only similar (typo beyond tolerance, other type)", () => {
    const d = decide(P({ address: 'Route de Bourg 27, 1003 Lausanne' }), [cand({ label: 'A', ...lausanne })], 'swisstopo');
    expect(d?.result.reasons).toEqual(['street']);
    const e = decide(P({ address: 'Rue de Bg 27, 1003 Lausanne' }), [cand({ label: 'A', ...lausanne })], 'swisstopo');
    expect(e?.result.reasons).toEqual(['street']);
  });

  it("reason 'ambiguous': equally good candidates more than 100 m apart", () => {
    const far = cand({ label: 'far', lat: 46.53, lon: 6.64, rank: 1 });
    const d = decide(P({ address: 'Rue de Bourg 27, 1003 Lausanne' }), [cand({ label: 'A', ...lausanne }), far], 'swisstopo');
    expect(d?.result).toMatchObject({ status: 'check', reasons: ['ambiguous'] });
    expect(distanceM(far, lausanne)).toBeGreaterThan(100);
    // the same address twice within 100 m (two entrances) is no ambiguity
    const near = cand({ label: 'near', lat: 46.52005, lon: 6.63505, rank: 1 });
    expect(decide(P({ address: 'Rue de Bourg 27, 1003 Lausanne' }), [cand({ label: 'A', ...lausanne }), near], 'swisstopo')?.result.status).toBe('exact');
    // the town breaks the tie
    const other = cand({ label: 'other town', towns: ['Prilly'], zip: '1003', rank: 1, lat: 46.53, lon: 6.64 });
    expect(decide(P({ address: 'Rue de Bourg 27, 1003 Lausanne' }), [other, cand({ label: 'A', rank: 1, ...lausanne })], 'swisstopo')?.result.status).toBe('exact');
  });

  it("reason 'fallback': MOTIS is never better than check", () => {
    const d = decide(P({ address: 'Rue de Bourg 27, 1003 Lausanne' }), [cand({ label: 'A', source: 'motis', ...lausanne })], 'motis');
    expect(d?.result.status).toBe('check');
    expect(d?.result.reasons).toContain('fallback');
  });

  it('nothing in common: no decision', () => {
    expect(decide(P({ address: 'Rue de Bourg 27, 1003 Lausanne' }), [cand({ label: 'x', street: 'Chemin des Alpes', number: '5', zip: '1700', towns: ['Fribourg'], ...lausanne })], 'swisstopo')).toBeNull();
  });

  it('candidates carry a 0-1 score, best first, at most 5', () => {
    const cs = Array.from({ length: 8 }, (_, i) => cand({ label: `c${i}`, number: String(27 + 2 * i), rank: i, lat: 46.52 + i * 0.001, lon: 6.635 }));
    const r = decide(P({ address: 'Rue de Bourg 27, 1003 Lausanne' }), cs, 'swisstopo')!.result;
    expect(r.candidates.length).toBe(5);
    for (const c of r.candidates) expect(c.score).toBeGreaterThanOrEqual(0);
    for (const c of r.candidates) expect(c.score).toBeLessThanOrEqual(1);
    expect(r.candidates.map((c) => c.score)).toEqual([...r.candidates.map((c) => c.score)].sort((a, b) => b - a));
  });

  it('a wrong number scores lower than the right one', () => {
    const p = P({ address: 'Rue de Bourg 27, 1003 Lausanne' });
    expect(scoreCandidate(p, cand({ label: 'a', ...lausanne })).score).toBeGreaterThan(scoreCandidate(p, cand({ label: 'b', number: '29', ...lausanne })).score);
  });
});

describe('parsing the services', () => {
  it('swisstopo: label, zip, locality and municipality', () => {
    const c = parseSwisstopoResult(
      { attrs: { label: 'Rue de Bourg 27 <b>1003 Lausanne</b>', detail: 'rue de bourg 27 1003 lausanne 5586 lausanne ch vd', lat: 46.52, lon: 6.63 } },
      0,
    );
    expect(c).toMatchObject({ street: 'Rue de Bourg', number: '27', zip: '1003', label: 'Rue de Bourg 27, 1003 Lausanne' });
    expect(c?.towns).toEqual(['Lausanne', 'lausanne']);
  });
  it('MOTIS: address items; other kinds without coordinates are dropped', () => {
    const c = parseMotisItem({ type: 'ADDRESS', name: 'Rue de Bourg 27', street: 'Rue de Bourg', houseNumber: '27', lat: 46.5, lon: 6.6, areas: [{ name: 'Vaud', adminLevel: 4 }, { name: 'Lausanne', adminLevel: 8 }] }, 0);
    expect(c).toMatchObject({ street: 'Rue de Bourg', number: '27', zip: null, towns: ['Lausanne'] });
    expect(parseMotisItem({ type: 'ADDRESS', name: 'x' }, 0)).toBeNull();
  });
});

// ───────── the geocoder on recorded answers ─────────

describe('createGeocoder (recorded answers)', () => {
  it.each([
    ['exact-fr-oneline', 'Rue de Bourg 27, 1003 Lausanne'],
    ['exact-fr-number-first', 'Rue de Bourg 27, 1003 Lausanne'],
    ['exact-de-abbreviation', 'Buchhofstrasse 10a, 3308 Grafenried'],
    ['exact-de-split', 'Loogartenstrasse 52, 8048 Zürich'],
    ['exact-it-suffix', 'Via Barchee 22c, 6616 Losone'],
    ['exact-bilingual', 'Rue du Collège / Collègegasse 23a, 2502 Biel/Bienne'],
    ['exact-typo', 'Rue de Bourg 27, 1003 Lausanne'],
  ])('%s is exact', async (name, matched) => {
    const { result, asked } = await run(name);
    expect(result.status).toBe('exact');
    expect(result.reasons).toEqual([]);
    expect(result.matched).toBe(matched);
    expect(result.lat).toBeGreaterThan(45);
    expect(result.lon).toBeGreaterThan(5);
    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    expect(result.candidates.length).toBeLessThanOrEqual(5);
    expect(result.candidates[0]).toMatchObject({ lat: result.lat, lon: result.lon, source: 'swisstopo' });
    expect(asked.length).toBe(1);
  });

  it('fuzzy neighbour trap: the service returns Rue de Bourg 1 and 2 for a number that does not exist', async () => {
    const { result } = await run('number-missing');
    expect(result.status).toBe('check'); // never exact
    expect(result.reasons).toEqual(['houseNumber']);
    expect(result.matched).toMatch(/^Rue de Bourg [12],/);
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it('fuzzy neighbour trap: 27a is not 27', async () => {
    const { result } = await run('number-suffix-differs');
    expect(result.status).toBe('check');
    expect(result.reasons).toEqual(['houseNumber']);
  });

  it("reason 'noNumber'", async () => {
    const { result } = await run('no-number');
    expect(result).toMatchObject({ status: 'check', reasons: ['noNumber'] });
    expect(result.lat).toBeDefined();
  });

  it("reason 'postcode': missing", async () => {
    const { result } = await run('no-postcode');
    expect(result).toMatchObject({ status: 'check', reasons: ['postcode'] });
  });

  it("reason 'postcode': swapped digits (the service still returns the right house)", async () => {
    const { result } = await run('postcode-swapped');
    expect(result).toMatchObject({ status: 'check', reasons: ['postcode'] });
    expect(result.matched).toBe('Rue de Bourg 27, 1003 Lausanne');
  });

  it("reason 'postcode': the town does not belong to the postcode", async () => {
    const { result } = await run('town-conflict');
    expect(result).toMatchObject({ status: 'check', reasons: ['postcode'] });
  });

  it("reason 'street': route is not rue", async () => {
    const { result } = await run('street-type-differs');
    expect(result).toMatchObject({ status: 'check', reasons: ['street'] });
    expect(result.matched).toBe('Rue de Bourg 27, 1003 Lausanne');
  });

  it("reason 'street': a typo the service cannot digest is found by the shortened second search", async () => {
    const { result, asked } = await run('typo-stem');
    expect(result.status).toBe('check');
    expect(result.reasons).toEqual(['street']);
    expect(result.matched).toBe('Milchstrasse 1, 6028 Herlisberg');
    expect(asked.length).toBeGreaterThan(1);
  });

  it("reason 'ambiguous': the same address in several places (no postcode given)", async () => {
    const { result } = await run('ambiguous');
    expect(result.status).toBe('check');
    expect(result.reasons).toEqual(['postcode', 'ambiguous']);
    expect(new Set(result.candidates.map((c) => c.label)).size).toBeGreaterThan(1);
  });

  it('a street that does not exist in a real postcode and town is only a check', async () => {
    const { result } = await run('street-unknown');
    expect(result.status).toBe('check');
    expect(result.reasons).toContain('street');
    expect(Math.max(...result.candidates.map((c) => c.score))).toBeLessThan(0.7);
  });

  it('garbage is not found', async () => {
    const { result } = await run('garbage');
    expect(result).toEqual({ status: 'notfound', candidates: [], reasons: [] });
  });

  it('empty input and input without a street are not found, without any request', async () => {
    const f = fixtureFetch('garbage');
    const g = createGeocoder({ fetch: f.fetch });
    for (const input of [{}, { address: '' }, { address: '   ' }, { postcode: '1003', city: 'Lausanne' }, { address: '12345 67890' }, { address: '???' }]) {
      expect(await g.check(input)).toEqual({ status: 'notfound', candidates: [], reasons: [] });
    }
    expect(f.asked).toEqual([]);
  });

  it("fallback: MOTIS answers when swisstopo is down; never better than check, reason 'fallback'", async () => {
    const { result, asked } = await run('fallback-motis');
    expect(result.status).toBe('check');
    expect(result.reasons).toContain('fallback');
    expect(result.candidates[0]!.source).toBe('motis');
    expect(result.lat).toBeCloseTo(46.52, 1);
    expect(asked.some((u) => u.startsWith('http://127.0.0.1:8080/api/v1/geocode?text='))).toBe(true);
  });

  it('both services down: an error, not "not found"', async () => {
    const down: typeof fetch = async () => {
      throw new Error('connection refused');
    };
    await expect(createGeocoder({ fetch: down }).check({ address: 'Rue de Bourg 27, 1003 Lausanne' })).rejects.toThrow();
  });

  it('sends only the address text, to the configured services', async () => {
    const urls: string[] = [];
    const f: typeof fetch = async (input) => {
      urls.push(String(input));
      return { ok: true, status: 200, json: async () => ({ results: [] }) } as Response;
    };
    await createGeocoder({ fetch: f, swisstopoUrl: 'http://swiss.test', motisUrl: 'http://motis.test/' }).check({ address: 'Rue de Bourg 27', postcode: '1003', city: 'Lausanne' });
    expect(urls.length).toBeGreaterThan(1);
    const swiss = urls.filter((u) => u.startsWith('http://swiss.test/rest/services/api/SearchServer?'));
    expect(swiss.length).toBeGreaterThan(0);
    for (const u of swiss) expect([...new URL(u).searchParams.keys()].sort()).toEqual(['limit', 'origins', 'searchText', 'sr', 'type']);
    expect(new URL(swiss[0]!).searchParams.get('searchText')).toBe('Rue de Bourg 27 1003');
    expect(urls.some((u) => u.startsWith('http://motis.test/api/v1/geocode?text='))).toBe(true);
  });

  it('at most 4 requests to swisstopo in flight, however many checks run at once', async () => {
    let inFlight = 0;
    let max = 0;
    const f: typeof fetch = async (input) => {
      if (String(input).includes('SearchServer')) {
        inFlight++;
        max = Math.max(max, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
      }
      return { ok: true, status: 200, json: async () => ({ results: [] }) } as Response;
    };
    const g = createGeocoder({ fetch: f });
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => g.check({ address: `Rue de Bourg ${i + 1}`, postcode: '1003' })));
    expect(results.every((r) => r.status === 'notfound')).toBe(true);
    expect(max).toBeGreaterThan(1);
    expect(max).toBeLessThanOrEqual(4);
  });
});
