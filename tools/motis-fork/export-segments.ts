/**
 * Writes the "segment tags" file read by the MOTIS fork (MOTIS_SEGMENT_TAGS):
 *
 *   from_station,to_station,tags      e.g.  8504121,8504122,frimobil:50;mobilis:60|mobilis:103
 *
 * One row per pair of CONSECUTIVE stops of any trip of the timetable (GTFS, station level, each
 * direction that runs), for every zonal fare network of the NOVA snapshot that has the zones
 * between the two: one tag group per network (";" between groups, "|" between the tags
 * `<alliance>:<zone code>` of a group). The fork allows a section when one group lies entirely
 * in the request's `allowedSegmentTags`.
 *
 * Zones: those of the NOVA edge when there is one, else those along the chain of edges joining
 * the two stops (a train that skips stops) - `sectionTags()` in the engine, the same logic that
 * gives a commute its zones. Networks and plans: every alliance with a pass plan, as the trip
 * resolver chooses it (`networkPlans`).
 *
 * Stops the fare data does not list (a new stop of the timetable year, a new platform group:
 * "Fribourg, Route-Neuve/gare" beside the bus station) stand for the nearest stop it knows
 * within 300 m, as in the engine (`fareSequences`): a section from or to such a stop takes the
 * zones of the section of its stand-in, and a section between a stop and its own stand-in takes
 * the zone the stand-in lies in. Without this the restricted search would never use that stop.
 *
 *   pnpm tsx tools/motis-fork/export-segments.ts [out.csv] [gtfs.zip]
 *
 * Without `out.csv`: tools/motis-fork/segments.csv when the file is under 5 MB (tracked in
 * git), else data/build/segments.csv (ignored). Needs `unzip`; takes about a minute.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { loadNova } from '../../packages/engine/src/fares/nova';
import { loadNetworks } from '../../packages/engine/src/fares/networks';
import { formatSectionTags, gtfsStationNumber, sectionTags, zonalPassPlans, type SectionZones } from '../../packages/engine/src/fares/segmentTags';
import { haversineKm } from '../../packages/engine/src/places/parking';

const ROOT = resolve(import.meta.dirname, '../..');
const TRACKED = resolve(ROOT, 'tools/motis-fork/segments.csv');
const IGNORED = resolve(ROOT, 'data/build/segments.csv');
const MAX_TRACKED_BYTES = 5_000_000;
const gtfs = resolve(process.argv[3] ?? resolve(ROOT, 'data/raw/gtfs.zip'));

/** Lines of one file of the zip, without unpacking it to disk. */
function lines(file: string): AsyncIterable<string> {
  const child = spawn('unzip', ['-p', gtfs, file], { stdio: ['ignore', 'pipe', 'inherit'] });
  return createInterface({ input: child.stdout, crlfDelay: Infinity });
}

/** Fields of a line of this feed: values are all quoted and hold no quote; the header is bare. */
function fields(raw: string): string[] {
  const line = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return line.startsWith('"') ? line.slice(1, line.endsWith('"') ? -1 : undefined).split('","') : line.split(',');
}

async function main() {
  // stops.txt: stop id -> station number.
  const station = new Map<string, number>();
  const where = new Map<number, { lat: number; lon: number }>();
  let col: Record<string, number> | undefined;
  let noNumber = 0;
  for await (const line of lines('stops.txt')) {
    const f = fields(line);
    if (!col) {
      col = Object.fromEntries(f.map((name, i) => [name, i]));
      continue;
    }
    const n = gtfsStationNumber(f[col.stop_id!]!, f[col.parent_station!]);
    if (n === null) noNumber++;
    else {
      station.set(f[col.stop_id!]!, n);
      const lat = Number(f[col.stop_lat!]);
      const lon = Number(f[col.stop_lon!]);
      if (!where.has(n) && Number.isFinite(lat) && Number.isFinite(lon)) where.set(n, { lat, lon });
    }
  }

  // stop_times.txt: consecutive stops of every trip. Rows of a trip are together and in order.
  const KEY = 1e8;
  const pairs = new Set<number>();
  let rows = 0;
  let trips = 0;
  let outOfOrder = 0;
  let prevTrip = '';
  let prevSeq = -1;
  let prevStation: number | null = null;
  col = undefined;
  for await (const line of lines('stop_times.txt')) {
    const f = fields(line);
    if (!col) {
      col = Object.fromEntries(f.map((name, i) => [name, i]));
      continue;
    }
    rows++;
    const trip = f[col.trip_id!]!;
    const seq = Number(f[col.stop_sequence!]);
    const here = station.get(f[col.stop_id!]!) ?? null;
    if (trip !== prevTrip) trips++;
    else if (seq <= prevSeq) outOfOrder++;
    else if (here !== null && prevStation !== null && here !== prevStation) pairs.add(prevStation * KEY + here);
    prevTrip = trip;
    prevSeq = seq;
    prevStation = here;
  }
  if (outOfOrder) throw new Error(`${outOfOrder} rows of stop_times.txt are not in stop_sequence order: sort the file first`);

  const nova = loadNova();
  const plans = zonalPassPlans(nova, loadNetworks());
  const stat = new Map<string, { hop: number; bridged: number; unresolved: number }>();
  const of = (alliance: string) => {
    let s = stat.get(alliance);
    if (!s) stat.set(alliance, (s = { hop: 0, bridged: 0, unresolved: 0 }));
    return s;
  };
  // Stops of the timetable that the fare data does not list, and the known stop each stands for.
  const REACH_M = 300;
  const CELL = 0.005; // about 400 m of latitude: a stop within reach is in a neighbouring cell
  const isKnown = (n: number) => nova.stopName(String(n)) !== undefined || nova.alliancesAt(String(n)).length > 0;
  const used = new Set<number>();
  for (const key of pairs) used.add(Math.floor(key / KEY)).add(key % KEY);
  const grid = new Map<string, number[]>();
  const cell = (lat: number, lon: number) => `${Math.floor(lat / CELL)},${Math.floor(lon / CELL)}`;
  for (const [n, p] of where) {
    if (!isKnown(n)) continue;
    const c = cell(p.lat, p.lon);
    const l = grid.get(c);
    if (l) l.push(n);
    else grid.set(c, [n]);
  }
  const standIn = new Map<number, number>();
  let unknown = 0;
  for (const n of used) {
    if (isKnown(n)) continue;
    unknown++;
    const p = where.get(n);
    if (!p) continue;
    let best: { n: number; m: number } | undefined;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        for (const k of grid.get(cell(p.lat + dy * CELL, p.lon + dx * CELL)) ?? []) {
          const m = haversineKm(p, where.get(k)!) * 1000;
          if (m <= REACH_M && (!best || m < best.m)) best = { n: k, m };
        }
      }
    }
    if (best) standIn.set(n, best.n);
  }
  // The zone a stop lies in, per network: the zones every edge at the stop shares; where they
  // share none (a stop on a border), the zones of its shortest edge.
  const zonesAt = new Map<string, Map<number, number[]>>();
  const stopZones = (alliance: string, plan: string, stop: number): number[] => {
    let ix = zonesAt.get(alliance);
    if (!ix) {
      const all = new Map<number, number[][]>();
      for (const [edge, zones] of nova.raw.planEdges(alliance, plan)) {
        for (const end of edge.split(' ')[0]!.split('-').map(Number)) {
          const l = all.get(end);
          if (l) l.push(zones);
          else all.set(end, [zones]);
        }
      }
      ix = new Map();
      for (const [end, sets] of all) {
        const shared = sets.reduce((acc, z) => acc.filter((x) => z.includes(x)));
        ix.set(end, shared.length ? shared : sets.reduce((x, y) => (y.length < x.length ? y : x)));
      }
      zonesAt.set(alliance, ix);
    }
    return ix.get(stop) ?? [];
  };
  const atStop = (stop: number): SectionZones[] =>
    nova
      .alliancesAt(String(stop))
      .flatMap((alliance): SectionZones[] => {
        const plan = plans.get(alliance);
        const zones = plan ? stopZones(alliance, plan, stop) : [];
        return zones.length ? [{ alliance, zones, how: 'bridged' }] : [];
      })
      .sort((x, y) => x.alliance.localeCompare(y.alliance));

  const total = { tagged: 0, hop: 0, bridged: 0, unresolved: 0, outside: 0, several: 0, stoodIn: 0 };
  const out = ['from_station,to_station,tags'];
  for (const key of [...pairs].sort((x, y) => x - y)) {
    const a = Math.floor(key / KEY);
    const b = key % KEY;
    const sa = standIn.get(a) ?? a;
    const sb = standIn.get(b) ?? b;
    const t = sa === sb ? { networks: atStop(sa), unresolved: [] } : sectionTags(nova, plans, sa, sb);
    if ((sa !== a || sb !== b) && t.networks.length > 0) total.stoodIn++;
    for (const n of t.networks) of(n.alliance)[n.how]++;
    for (const u of t.unresolved) of(u).unresolved++;
    if (t.networks.length === 0) {
      if (t.unresolved.length) total.unresolved++;
      else total.outside++;
      continue;
    }
    total.tagged++;
    if (t.networks.length > 1) total.several++;
    if (t.networks.some((n) => n.how === 'hop')) total.hop++;
    else total.bridged++;
    out.push(`${a},${b},${formatSectionTags(t.networks)}`);
  }

  const text = out.join('\n') + '\n';
  const target = process.argv[2] ? resolve(process.argv[2]) : Buffer.byteLength(text) < MAX_TRACKED_BYTES ? TRACKED : IGNORED;
  // Never two default files: the server must not be started with a stale one.
  if (!process.argv[2]) for (const other of [TRACKED, IGNORED]) if (other !== target && existsSync(other)) rmSync(other);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);

  console.log(`GTFS: ${rows} stop times, ${trips} trips, ${station.size} stops with a station number (${noNumber} without)`);
  console.log(`station pairs (consecutive stops, directed): ${pairs.size}`);
  console.log(`  tagged: ${total.tagged} (an edge of the fare data in a network: ${total.hop}; bridged only: ${total.bridged}; in several networks: ${total.several})`);
  console.log(`  stops the fare data does not list: ${unknown}, of which ${standIn.size} stand for a known stop within ${REACH_M} m; sections tagged that way: ${total.stoodIn}`);
  console.log(`  both stops in a zonal network, zones not found: ${total.unresolved}`);
  console.log(`  not both in one zonal network: ${total.outside}`);
  console.log(`networks: ${plans.size} with a pass plan`);
  console.log('alliance,plan,tagged,hop,bridged,unresolved');
  for (const [alliance, plan] of [...plans].sort()) {
    const s = of(alliance);
    console.log(`${alliance},${plan},${s.hop + s.bridged},${s.hop},${s.bridged},${s.unresolved}`);
  }
  console.log(`${out.length - 1} rows, ${(Buffer.byteLength(text) / 1e6).toFixed(2)} MB -> ${target}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
