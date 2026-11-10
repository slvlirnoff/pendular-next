// Builds packages/engine/data/zones/vaud-stops.json: station numbers of public transport stops in canton Vaud.
// Run from repo root: pnpm tsx data/scripts/build-vaud-stops.ts
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const ZIP = 'data/raw/gtfs.zip';
const CACHE = 'data/build/vaud-stops-cache.json';
const OUT = 'packages/engine/data/zones/vaud-stops.json';
const MOTIS = 'http://127.0.0.1:8080';
const BOX = { latMin: 46.15, latMax: 47.02, lonMin: 6.05, lonMax: 7.3 };
const CONCURRENCY = 8;
const MAX_MATCH_DIST_M = 250; // only trust geocoder matches this close to the stop

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', q = false;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function dist(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

interface Station { id: string; name: string; lat: number; lon: number; isParent: boolean }
interface Result { canton: string | null; country: string | null; via?: string; d?: number }

function loadStations(): Station[] {
  const txt = execFileSync('unzip', ['-p', ZIP, 'stops.txt'], { maxBuffer: 1 << 29 }).toString('utf8');
  const rows = parseCsv(txt);
  const h = rows[0].map((x) => x.trim());
  const ix = (n: string) => h.indexOf(n);
  const [iId, iName, iLat, iLon, iDidok] = ['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'didok'].map(ix);
  const byKey = new Map<string, Station & { n: number; sLat: number; sLon: number }>();
  for (const r of rows.slice(1)) {
    const id = r[iId];
    // real feed uses sloid stop ids; the didok column carries the station number
    const m = (iDidok >= 0 ? /^(\d{7})/.exec(r[iDidok] ?? '') : null) ?? /^(?:Parent)?(\d{7})(?::|$)/.exec(id);
    if (!m) continue;
    const lat = parseFloat(r[iLat]), lon = parseFloat(r[iLon]);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    if (lat < BOX.latMin || lat > BOX.latMax || lon < BOX.lonMin || lon > BOX.lonMax) continue;
    const key = m[1], isParent = id.startsWith('Parent');
    const s = byKey.get(key);
    if (!s) byKey.set(key, { id: key, name: r[iName], lat, lon, isParent, n: 1, sLat: lat, sLon: lon });
    else if (isParent && !s.isParent) { s.lat = lat; s.lon = lon; s.name = r[iName]; s.isParent = true; }
    else if (!s.isParent) { s.n++; s.sLat += lat; s.sLon += lon; s.lat = s.sLat / s.n; s.lon = s.sLon / s.n; }
  }
  return [...byKey.values()].map(({ id, name, lat, lon, isParent }) => ({ id, name, lat, lon, isParent }));
}

async function lookup(s: Station): Promise<Result> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${MOTIS}/api/v1/reverse-geocode?place=${s.lat},${s.lon}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const matches: any[] = await res.json();
      let best: { d: number; m: any } | null = null;
      let nearest: { d: number; m: any } | null = null;
      for (const m of matches) {
        const d = dist(s.lat, s.lon, m.lat, m.lon);
        if (!nearest || d < nearest.d) nearest = { d, m };
        if (!Array.isArray(m.areas) || !m.areas.some((a: any) => a.adminLevel === 4)) continue;
        if (!best || d < best.d) best = { d, m };
      }
      if (best && best.d <= MAX_MATCH_DIST_M) {
        const a4 = best.m.areas.find((a: any) => a.adminLevel === 4);
        return { canton: a4.name, country: best.m.country ?? null, via: best.m.name, d: Math.round(best.d) };
      }
      // French places come back without country and without a level-4 area (no canton there)
      if (nearest && nearest.d <= MAX_MATCH_DIST_M && !nearest.m.country) return { canton: null, country: 'FR', via: nearest.m.name, d: Math.round(nearest.d) };
      return { canton: null, country: null };
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

async function main() {
  const t0 = Date.now();
  const stations = loadStations();
  const cache: Record<string, Result> = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};
  const todo = stations.filter((s) => !(s.id in cache));
  console.log(`stations in box: ${stations.length}, to geocode: ${todo.length}`);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < todo.length) {
      const s = todo[next++];
      cache[s.id] = await lookup(s);
      if (++done % 500 === 0) console.log(`  ${done}/${todo.length}`);
    }
  }));
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(cache));

  // classify; undetermined -> nearest stop with a canton
  const known = stations.filter((s) => cache[s.id].canton);
  const final = new Map<string, { canton: string; country: string | null }>();
  let inferred = 0;
  for (const s of stations) {
    const r = cache[s.id];
    if (r.canton) { final.set(s.id, { canton: r.canton, country: r.country }); continue; }
    if (r.country === 'FR') { final.set(s.id, { canton: '', country: 'FR' }); continue; }
    let best: Station | null = null, bd = Infinity;
    for (const k of known) { const d = dist(s.lat, s.lon, k.lat, k.lon); if (d < bd) { bd = d; best = k; } }
    if (best) { final.set(s.id, { ...cache[best.id] } as any); inferred++; }
  }
  const isVaud = (id: string) => final.get(id)?.canton === 'Vaud';
  const stops = stations.map((s) => s.id).filter(isVaud).sort();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    source: 'GTFS 2027 stops; canton from OpenStreetMap admin boundaries via the MOTIS reverse geocoder',
    generatedAt: new Date().toISOString(),
    canton: 'Vaud',
    count: stops.length,
    inferred: [...final.keys()].filter((id) => !cache[id].canton && isVaud(id)).length,
    stops,
  }, null, 1) + '\n');

  const perCanton = new Map<string, number>();
  let france = 0;
  for (const [, v] of final) {
    if (v.country === 'FR') { france++; continue; }
    perCanton.set(v.canton, (perCanton.get(v.canton) ?? 0) + 1);
  }
  console.log(`\nstops in box: ${stations.length}\nin Vaud: ${stops.length}`);
  console.log(`inferred (nearest-stop, all cantons): ${inferred}`);
  console.log(`in France: ${france}`);
  console.log('other cantons:');
  for (const [c, n] of [...perCanton].sort((a, b) => b[1] - a[1])) if (c !== 'Vaud') console.log(`  ${c}: ${n}`);
  console.log(`undetermined: ${stations.length - final.size}`);
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
main().catch((e) => { console.error(e); process.exit(1); });
