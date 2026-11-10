import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { httpGet } from '../../apps/api/src/httpGet.js';

export const CACHE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'cache');

export interface CacheStats {
  hits: number;
  /** Requests that really left the machine (swisstopo ones are the ones to ration). */
  live: number;
  liveMs: number;
  inFlight: number;
  maxInFlight: number;
}

/**
 * A fetch that answers from disk when it has seen the URL before, and otherwise calls the real
 * service and stores the answer (status, body, duration). Only the address text is in the URL.
 */
export function createCachedFetch(dir = CACHE_DIR): { fetch: typeof fetch; stats: CacheStats } {
  mkdirSync(dir, { recursive: true });
  const stats: CacheStats = { hits: 0, live: 0, liveMs: 0, inFlight: 0, maxInFlight: 0 };
  const f: typeof fetch = async (input) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const file = join(dir, createHash('sha1').update(url).digest('hex') + '.json');
    if (existsSync(file)) {
      stats.hits++;
      const c = JSON.parse(readFileSync(file, 'utf8')) as { status: number; body: string };
      return { ok: c.status >= 200 && c.status < 300, status: c.status, text: async () => c.body, json: async () => JSON.parse(c.body) as unknown } as Response;
    }
    stats.live++;
    stats.inFlight++;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    const t0 = performance.now();
    try {
      const res = await httpGet(url);
      const body = await res.text();
      const ms = Math.round(performance.now() - t0);
      stats.liveMs += ms;
      if (res.status === 200) writeFileSync(file, JSON.stringify({ url, status: res.status, ms, body }));
      return { ok: res.ok, status: res.status, text: async () => body, json: async () => JSON.parse(body) as unknown } as Response;
    } finally {
      stats.inFlight--;
    }
  };
  return { fetch: f, stats };
}
