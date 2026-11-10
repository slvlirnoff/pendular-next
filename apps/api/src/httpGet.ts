import http from 'node:http';
import https from 'node:https';

/**
 * A minimal `fetch` for GET requests on Node's classic HTTP client.
 *
 * Node's built-in fetch (undici) aborts the whole process with a parser assertion on the large
 * one-to-all answers of the routing engine; the classic client reads them without trouble.
 * Connections are kept alive: one comparison makes a few dozen calls to the same host.
 */
const agents = { 'http:': new http.Agent({ keepAlive: true, maxSockets: 32 }), 'https:': new https.Agent({ keepAlive: true, maxSockets: 32 }) };

/** PENDULAR_TIMING=1 logs every call to the routing engine with its duration. */
const TIMING = process.env.PENDULAR_TIMING === '1';
const timingLabel = (u: URL) =>
  ['directModes', 'transitModes', 'arriveBy', 'searchWindow', 'algorithm', 'pageCursor', 'mode']
    .filter((k) => u.searchParams.has(k))
    .map((k) => `${k}=${(u.searchParams.get(k) ?? '').slice(0, 12)}`)
    .join(' ');

export const httpGet: typeof fetch = (input) =>
  new Promise<Response>((resolve, reject) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const started = TIMING ? performance.now() : 0;
    const client = url.protocol === 'https:' ? https : http;
    const req = client.get(url, { agent: agents[url.protocol as 'http:' | 'https:'], timeout: 60_000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const status = res.statusCode ?? 0;
        if (TIMING) console.log(`${Math.round(performance.now() - started)} ms  ${url.pathname}  ${timingLabel(url)}`);
        resolve({
          ok: status >= 200 && status < 300,
          status,
          text: async () => body,
          json: async () => JSON.parse(body) as unknown,
        } as Response);
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout: ${url.pathname}`)));
    req.on('error', reject);
  });
