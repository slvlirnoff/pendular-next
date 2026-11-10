/**
 * Records real answers of the swisstopo search service (and of the local MOTIS geocoder) for the
 * cases of apps/analytics/test/geocode.test.ts, so that the tests run offline.
 *
 *   pnpm tsx tools/address-test/record-fixtures.ts
 *
 * Each fixture file holds the input and every response the geocoder asked for, by URL. Answers
 * come from the disk cache when possible, so rerunning costs no request.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGeocoder } from '../../apps/analytics/src/geocode.js';
import { createCachedFetch } from './cachedFetch.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../apps/analytics/test/fixtures/geocode');

interface Case {
  name: string;
  input: { address?: string; postcode?: string; city?: string };
  /** Simulate an outage of the swisstopo service (HTTP 503): the MOTIS fallback answers. */
  swisstopoDown?: boolean;
}

export const CASES: Case[] = [
  { name: 'exact-fr-oneline', input: { address: 'Rue de Bourg 27, 1003 Lausanne' } },
  { name: 'exact-fr-number-first', input: { address: '27 rue de Bourg', postcode: '1003', city: 'Lausanne' } },
  { name: 'exact-de-abbreviation', input: { address: 'Buchhofstr. 10a, 3308 Grafenried' } },
  { name: 'exact-de-split', input: { address: 'Loogartenstrasse 52', postcode: '8048', city: 'Zürich' } },
  { name: 'exact-it-suffix', input: { address: 'Via Barchee 22c 6616 Losone' } },
  { name: 'exact-bilingual', input: { address: 'COLLÈGEGASSE / RUE DU COLLÈGE 23A, 2502 BIEL/BIENNE' } },
  { name: 'exact-typo', input: { address: 'Rue de Burg 27, 1003 Lausanne' } },
  { name: 'number-missing', input: { address: 'Rue de Bourg 99', postcode: '1003', city: 'Lausanne' } },
  { name: 'number-suffix-differs', input: { address: 'Rue de Bourg 27a, 1003 Lausanne' } },
  { name: 'no-number', input: { address: 'Rue de Bourg', postcode: '1003', city: 'Lausanne' } },
  { name: 'no-postcode', input: { address: 'Rue de Bourg 27', city: 'Lausanne' } },
  { name: 'postcode-swapped', input: { address: 'Rue de Bourg 27', postcode: '1030', city: 'Lausanne' } },
  { name: 'town-conflict', input: { address: 'Rue de Bourg 27', postcode: '1003', city: 'Fribourg' } },
  { name: 'street-type-differs', input: { address: 'Route de Bourg 27, 1003 Lausanne' } },
  { name: 'ambiguous', input: { address: 'Bahnhofstrasse 5' } },
  { name: 'street-unknown', input: { address: 'Xyzzy 5, 1003 Lausanne' } },
  { name: 'garbage', input: { address: 'Qwxzkt 99' } },
  { name: 'typo-stem', input: { address: 'Milchtsrasse 1', postcode: '6028', city: 'Herlisberg' } },
  { name: 'fallback-motis', input: { address: 'Rue de Bourg 27, 1003 Lausanne' }, swisstopoDown: true },
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const { fetch: cached, stats } = createCachedFetch();
  for (const c of CASES) {
    const responses: Record<string, { status: number; body: string }> = {};
    const recording: typeof fetch = async (input) => {
      const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      if (c.swisstopoDown && url.includes('geo.admin.ch')) {
        responses[url] = { status: 503, body: '' };
        return { ok: false, status: 503, text: async () => '', json: async () => ({}) } as Response;
      }
      const res = await cached(url);
      const body = await res.text();
      responses[url] = { status: res.status, body };
      return res;
    };
    const result = await createGeocoder({ fetch: recording }).check(c.input);
    writeFileSync(join(OUT, `${c.name}.json`), JSON.stringify({ input: c.input, swisstopoDown: c.swisstopoDown ?? false, responses }, null, 1));
    console.log(c.name.padEnd(24), result.status.padEnd(8), result.reasons.join(',').padEnd(24), result.matched ?? '', `[${Object.keys(responses).length} req]`);
  }
  console.log(stats);
}

await main();
