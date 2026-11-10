import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const ENDPOINT = 'https://lindas.admin.ch/query';
export const NOVA_GRAPH = 'https://lindas.admin.ch/sbb/nova';
export const DIDOK_GRAPH = 'https://lindas.admin.ch/sbb/didok';
export const BASE = 'https://lod.opentransportdata.swiss/';

export const PREFIXES = `PREFIX gtfs: <http://vocab.gtfs.org/terms#>
PREFIX otd: <${BASE}vocab/>
PREFIX schema: <http://schema.org/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX dcterms: <http://purl.org/dc/terms/>
`;

/** The source is converted once a day; a cache older than this belongs to another snapshot. */
const CACHE_MAX_AGE_H = 20;
const PAUSE_MS = 400;
const TIMEOUT_MS = 180_000;
const RETRY_WAIT_S = [5, 20, 60, 120];

export interface FetchStats {
  /** Requests that reached the endpoint. */
  live: number;
  /** Pages answered from the cache directory. */
  cached: number;
  retries: number;
  liveMs: number;
  bytes: number;
  /** Totals since the cache was started: an import resumed or repeated the same day adds to them. */
  run: { startedAt: string; requests: number; bytes: number; fetchMs: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** RFC 4180 reader (the endpoint's text/csv answer); returns the rows without the header. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    let field = '';
    if (text[i] === '"') {
      i++;
      for (;;) {
        const q = text.indexOf('"', i);
        if (q < 0) throw new Error('csv: unterminated quote');
        field += text.slice(i, q);
        if (text[q + 1] === '"') {
          field += '"';
          i = q + 2;
        } else {
          i = q + 1;
          break;
        }
      }
    } else {
      let j = i;
      while (j < n && text[j] !== ',' && text[j] !== '\n' && text[j] !== '\r') j++;
      field = text.slice(i, j);
      i = j;
    }
    row.push(field);
    if (text[i] === ',') {
      i++;
      // A comma at the very end of a line means one more, empty, field.
      if (i >= n || text[i] === '\n' || text[i] === '\r') row.push('');
      else continue;
    }
    if (text[i] === '\r') i++;
    if (text[i] === '\n') i++;
    rows.push(row);
    row = [];
  }
  rows.shift();
  return rows;
}

export interface Sparql {
  /** One query, one answer. */
  select(name: string, query: string): Promise<string[][]>;
  /** A query ending in ORDER BY, fetched page by page until a short page. */
  paged(name: string, query: string, pageSize: number): Promise<string[][]>;
  stats: FetchStats;
}

/**
 * SPARQL client with a page cache on disk, so that an interrupted import resumes where it
 * stopped. One request at a time, a pause after each, a few patient retries.
 */
export function createSparql(cacheDir: string, opts: { fresh?: boolean; log?: (s: string) => void } = {}): Sparql {
  const log = opts.log ?? (() => {});
  const runFile = join(cacheDir, 'run.json');
  let stale = !!opts.fresh;
  if (!stale && existsSync(runFile)) {
    const run = JSON.parse(readFileSync(runFile, 'utf8')) as { startedAt: string };
    stale = Date.now() - Date.parse(run.startedAt) > CACHE_MAX_AGE_H * 3600_000;
  }
  if (stale && existsSync(cacheDir)) {
    log(`cache: starting a new run (old pages removed)`);
    rmSync(cacheDir, { recursive: true, force: true });
  }
  mkdirSync(cacheDir, { recursive: true });
  // Requests made so far for this snapshot, over every invocation that shares the cache.
  let run = { startedAt: new Date().toISOString(), requests: 0, bytes: 0, fetchMs: 0 };
  if (existsSync(runFile)) {
    run = { ...run, ...(JSON.parse(readFileSync(runFile, 'utf8')) as Partial<typeof run>) };
    log(`cache: resuming the run started ${run.startedAt} (${run.requests} requests so far)`);
  } else writeFileSync(runFile, JSON.stringify(run));

  const stats: FetchStats = { live: 0, cached: 0, retries: 0, liveMs: 0, bytes: 0, run };

  async function post(query: string): Promise<string> {
    for (let attempt = 0; ; attempt++) {
      const t0 = performance.now();
      try {
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            accept: 'text/csv',
            'user-agent': 'nova-fare-import/0.1 (scheduled snapshot script, sequential requests)',
          },
          body: 'query=' + encodeURIComponent(PREFIXES + query),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const body = await res.text();
        if (!res.ok) {
          // A refusal is not retried; an overloaded or failing server is.
          if (res.status < 500 && res.status !== 429 && res.status !== 408) throw Object.assign(new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`), { fatal: true });
          throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
        }
        stats.live++;
        stats.liveMs += performance.now() - t0;
        stats.bytes += body.length;
        run.requests++;
        run.bytes += body.length;
        run.fetchMs += Math.round(performance.now() - t0);
        writeFileSync(runFile, JSON.stringify(run));
        await sleep(PAUSE_MS);
        return body;
      } catch (e) {
        const wait = RETRY_WAIT_S[attempt];
        if ((e as { fatal?: boolean }).fatal || wait === undefined) throw e;
        stats.retries++;
        log(`  retry in ${wait}s: ${(e as Error).message.slice(0, 120)}`);
        await sleep(wait * 1000);
      }
    }
  }

  async function select(name: string, query: string): Promise<string[][]> {
    const hash = createHash('sha1').update(query).digest('hex').slice(0, 10);
    const file = join(cacheDir, `${name.replace(/[^a-zA-Z0-9._-]+/g, '_')}.${hash}.csv`);
    if (existsSync(file)) {
      stats.cached++;
      return parseCsv(readFileSync(file, 'utf8'));
    }
    const body = await post(query);
    const rows = parseCsv(body);
    // Written under another name first: a page is either complete or absent.
    writeFileSync(file + '.part', body);
    renameSync(file + '.part', file);
    return rows;
  }

  async function paged(name: string, query: string, pageSize: number): Promise<string[][]> {
    const all: string[][] = [];
    for (let page = 0; ; page++) {
      const rows = await select(`${name}.p${page}`, `${query}\nLIMIT ${pageSize} OFFSET ${page * pageSize}`);
      for (const r of rows) all.push(r);
      if (rows.length < pageSize) return all;
    }
  }

  return { select, paged, stats };
}
