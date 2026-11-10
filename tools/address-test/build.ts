/**
 * Acceptance set builder (suite requirement AN-A1).
 *
 * Source: the official building address register ("Amtliches Gebäudeadressverzeichnis der
 * Schweiz", swisstopo, open data on data.geo.admin.ch): one CSV with every address and its
 * LV95 coordinates. No search requests are needed to draw the sample.
 *
 *   pnpm tsx tools/address-test/build.ts          (downloads ~140 MB once into tools/address-test/data/)
 *
 * Draws ~1,000 addresses (35 % Vaud, the rest spread over all cantons, weighted by the square root
 * of each canton's address count), writes them as input rows in varied formats, injects errors
 * into 7 % of them and writes set/acceptance-set.json with the truth for every row.
 * Seeded: the same register file gives the same set.
 */
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, 'data');
const ZIP = join(DATA, 'ch.csv.zip');
const CSV = join(DATA, 'amtliches-gebaeudeadressverzeichnis_ch_2056.csv');
const URL_ZIP =
  'https://data.geo.admin.ch/ch.swisstopo.amtliches-gebaeudeadressverzeichnis/amtliches-gebaeudeadressverzeichnis_ch/amtliches-gebaeudeadressverzeichnis_ch_2056.csv.zip';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
/** --seed=7 --total=400 --out=holdout draws another, independent set (set/<out>.json). */
export const SET_FILE = join(HERE, 'set', `${arg('out') ?? 'acceptance-set'}.json`);
const TOTAL = parseInt(arg('total') ?? '1000', 10);
const VD_SHARE = 0.35;
const ERROR_SHARE = 0.07;
const SEED = parseInt(arg('seed') ?? '20261110', 10);

export type RowKind =
  | 'clean'
  | 'typo'
  | 'noPostcode'
  | 'numberMissingInRegister'
  | 'numberOtherBuilding'
  | 'postcodeSwapped'
  | 'garbage';

export interface SetRow {
  id: string;
  kind: RowKind;
  input: { address?: string; postcode?: string; city?: string };
  /** Register position the row should end up at (WGS 84); absent for garbage. */
  truth?: { lat: number; lon: number };
  /** The address as the register writes it. */
  register?: string;
  canton?: string;
  /** Another building with the very same street, number and postcode lies > 100 m away: "ambiguous" is right. */
  twin?: boolean;
  /** What a correct check does with this row. */
  expect: { status: ('exact' | 'check' | 'notfound')[]; reasons?: string[] };
  note?: string;
}

// ───────── helpers ─────────
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const pick = <T>(a: T[]): T => a[Math.floor(rand() * a.length)]!;
const chance = (p: number) => rand() < p;

/** Swiss approximate formulas (swisstopo), LV95 -> WGS 84, accurate to about 1 m. */
export function lv95ToWgs84(e: number, n: number): { lat: number; lon: number } {
  const y = (e - 2600000) / 1e6;
  const x = (n - 1200000) / 1e6;
  const lon = 2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y ** 3;
  const lat = 16.9023892 + 3.238272 * x - 0.270978 * y * y - 0.002528 * x * x - 0.0447 * y * y * x - 0.014 * x ** 3;
  return { lat: (lat * 100) / 36, lon: (lon * 100) / 36 };
}

interface Reg {
  egaid: string;
  street: string;
  number: string;
  zip: string;
  locality: string;
  commune: string;
  canton: string;
  lat: number;
  lon: number;
}

async function forEachLine(file: string, fn: (f: string[]) => void) {
  const rl = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  let first = true;
  for await (const line of rl) {
    if (first) {
      first = false;
      continue;
    }
    const f = line.split(';');
    if (f.length === 17) fn(f);
  }
}

function toReg(f: string[]): Reg | null {
  // ADR_EGAID;STR_ESID;BDG_EGID;ADR_EDID;STN_LABEL;ADR_NUMBER;BDG_CATEGORY;BDG_NAME;ZIP_LABEL;COM_FOSNR;COM_NAME;COM_CANTON;ADR_STATUS;ADR_OFFICIAL;ADR_MODIFIED;ADR_EASTING;ADR_NORTHING
  const [egaid, , , , street, number, , , zipLabel, , commune, canton, status, , , e, n] = f as [string, ...string[]];
  if (status !== 'real' || !street || !/^\d{1,3}[a-z]?$/.test(number!)) return null;
  const zm = zipLabel!.match(/^(\d{4}) (.+)$/);
  if (!zm) return null;
  const { lat, lon } = lv95ToWgs84(parseFloat(e!), parseFloat(n!));
  if (!isFinite(lat) || !isFinite(lon)) return null;
  return { egaid, street, number: number!, zip: zm[1]!, locality: zm[2]!, commune: commune!, canton: canton!, lat, lon };
}

const distM = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const k = Math.PI / 180;
  const dx = (b.lon - a.lon) * k * Math.cos(a.lat * k) * 6371008.8;
  const dy = (b.lat - a.lat) * k * 6371008.8;
  return Math.hypot(dx, dy);
};

// ───────── formats ─────────
const ABBR: [RegExp, string][] = [
  [/^Avenue /, 'Av. '], [/^Chemin /, 'Ch. '], [/^Route /, 'Rte '], [/^Boulevard /, 'Bd '], [/^Place /, 'Pl. '],
  [/strasse\b/, 'str.'], [/^Saint-/, 'St-'], [/^Sainte-/, 'Ste-'], [/^Rue /, 'Rue '],
];
const abbreviate = (s: string) => {
  for (const [re, to] of ABBR) if (re.test(s)) return s.replace(re, to);
  return s;
};
const stripAccents = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '');
const FRENCH_TYPE = /^(Rue|Route|Chemin|Avenue|Boulevard|Place|Impasse|Allée|Quai|Passage|Sentier|Ruelle)\b/;

function formatClean(r: Reg): { address?: string; postcode?: string; city?: string } {
  const town = chance(0.8) ? r.locality : r.commune;
  const f = rand();
  const street = r.street;
  const n = r.number;
  const spaced = chance(0.1) ? n.replace(/^(\d+)([a-z])$/, '$1 $2').toUpperCase() : n;
  if (f < 0.25) return { address: `${street} ${n}, ${r.zip} ${town}` };
  if (f < 0.5) return { address: `${street} ${spaced}`, postcode: r.zip, city: town };
  if (f < 0.6) {
    if (FRENCH_TYPE.test(street) && chance(0.9)) return { address: `${n} ${street.replace(/^(\S)/, (c) => c.toLowerCase())}`, postcode: r.zip, city: town };
    return { address: `${street} ${n}`, postcode: r.zip, city: town };
  }
  if (f < 0.7) return { address: `${street} ${n} ${r.zip} ${town}` };
  if (f < 0.8) return chance(0.5) ? { address: `${abbreviate(street)} ${n}, ${r.zip} ${town}` } : { address: `${abbreviate(street)} ${n}`, postcode: r.zip, city: town };
  if (f < 0.88) return { address: `${street} ${n}, ${r.zip} ${town}`.toUpperCase() };
  if (f < 0.94) return { address: `${street} ${n}`.toLowerCase(), postcode: `CH-${r.zip}`, city: town.toLowerCase() };
  return { address: `${stripAccents(street)} ${n}`, postcode: r.zip, city: stripAccents(town) };
}

// ───────── error injection ─────────
const LETTERS = 'abcdefghilmnoprstuv';
function typo(street: string): string {
  // Edit one letter inside a word of at least 5 letters (not the first letter).
  const ws = street.split(' ');
  const idxs = ws.map((w, i) => (/^\p{L}{5,}$/u.test(w) ? i : -1)).filter((i) => i >= 0);
  if (!idxs.length) return street + 'x';
  const wi = pick(idxs);
  const w = ws[wi]!;
  const pos = 1 + Math.floor(rand() * (w.length - 2));
  const kind = pick(['sub', 'del', 'swap', 'ins']);
  let out = w;
  if (kind === 'sub') out = w.slice(0, pos) + pick([...LETTERS].filter((c) => c !== w[pos]!.toLowerCase())) + w.slice(pos + 1);
  else if (kind === 'del') out = w.slice(0, pos) + w.slice(pos + 1);
  else if (kind === 'swap' && w[pos] !== w[pos + 1]) out = w.slice(0, pos) + w[pos + 1] + w[pos] + w.slice(pos + 2);
  else out = w.slice(0, pos) + w[pos] + w.slice(pos);
  ws[wi] = out === w ? w + w.slice(-1) : out;
  return ws.join(' ');
}
function swapDigits(zip: string): string {
  const idx: number[] = [];
  for (let i = 0; i < 3; i++) if (zip[i] !== zip[i + 1] && !(i === 0 && zip[1] === '0')) idx.push(i);
  if (!idx.length) return zip;
  const i = pick(idx);
  return zip.slice(0, i) + zip[i + 1] + zip[i] + zip.slice(i + 2);
}
function garbage(): { address?: string; postcode?: string; city?: string } {
  const junk = () => Array.from({ length: 5 + Math.floor(rand() * 7) }, () => pick([...'bcdfghjklmnpqrstvwxzy'])).join('');
  const f = rand();
  if (f < 0.3) return { address: `${junk()} ${1 + Math.floor(rand() * 90)}` };
  if (f < 0.55) return { address: `${junk()} ${junk()}`, postcode: String(1000 + Math.floor(rand() * 8000)), city: junk() };
  if (f < 0.7) return { address: '???', postcode: '0000' };
  if (f < 0.85) return { address: '12345 67890', city: 'n/a' };
  return { address: 'Homeoffice' };
}

// ───────── main ─────────
async function main() {
  if (!existsSync(CSV)) {
    mkdirSync(DATA, { recursive: true });
    console.log('downloading the register …');
    execFileSync('curl', ['-sS', '-A', 'Mozilla/5.0', '-o', ZIP, URL_ZIP], { stdio: 'inherit' });
    execFileSync('unzip', ['-o', '-q', ZIP, '-d', DATA], { stdio: 'inherit' });
  }

  // Pass 1: one reservoir per canton.
  const RES = 90;
  const VD_RES = 500;
  const reservoirs = new Map<string, Reg[]>();
  const counts = new Map<string, number>();
  await forEachLine(CSV, (f) => {
    const r = toReg(f);
    if (!r) return;
    const c = r.canton;
    const n = (counts.get(c) ?? 0) + 1;
    counts.set(c, n);
    const cap = c === 'VD' ? VD_RES : RES;
    const res = reservoirs.get(c) ?? [];
    reservoirs.set(c, res);
    if (res.length < cap) res.push(r);
    else {
      const j = Math.floor(rand() * n);
      if (j < cap) res[j] = r;
    }
  });
  const nVd = Math.round(TOTAL * VD_SHARE);
  const others = [...counts.keys()].filter((c) => c !== 'VD');
  const wsum = others.reduce((s, c) => s + Math.sqrt(counts.get(c)!), 0);
  const chosen: Reg[] = [];
  const shuffle = <T>(a: T[]) => a.map((x) => [rand(), x] as const).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
  chosen.push(...shuffle(reservoirs.get('VD')!).slice(0, nVd));
  for (const c of others) {
    const quota = Math.round(((TOTAL - nVd) * Math.sqrt(counts.get(c)!)) / wsum);
    chosen.push(...shuffle(reservoirs.get(c)!).slice(0, quota));
  }
  const seen = new Set<string>();
  const sample = shuffle(chosen).filter((r) => (seen.has(r.egaid) ? false : (seen.add(r.egaid), true))).slice(0, TOTAL);

  // Pass 2: every register entry on the sampled streets (to find twins and unused/other numbers).
  const streetKey = (street: string, zip: string) => `${street}|${zip}`;
  const wanted = new Set(sample.map((r) => streetKey(r.street, r.zip)));
  const onStreet = new Map<string, Reg[]>();
  await forEachLine(CSV, (f) => {
    const k = streetKey(f[4]!, f[8]!.slice(0, 4));
    if (!wanted.has(k)) return;
    const r = toReg(f);
    if (!r) return;
    const l = onStreet.get(k) ?? [];
    onStreet.set(k, l);
    l.push(r);
  });

  // Rows: 7 % get an error, spread over the error kinds.
  const nErr = Math.round(TOTAL * ERROR_SHARE);
  const plan: RowKind[] = [];
  const sc = TOTAL / 1000;
  const quotas: [RowKind, number][] = ([['typo', 14], ['noPostcode', 14], ['numberMissingInRegister', 14], ['numberOtherBuilding', 7], ['postcodeSwapped', 14], ['garbage', 7]] as [RowKind, number][]).map(([k, n]) => [k, Math.max(2, Math.round(n * sc))]);
  for (const [k, n] of quotas) for (let i = 0; i < n; i++) plan.push(k);
  while (plan.length < nErr) plan.push('typo');
  const errIdx = new Set(shuffle(sample.map((_, i) => i)).slice(0, nErr));
  const kinds = shuffle(plan);

  const rows: SetRow[] = [];
  let ki = 0;
  sample.forEach((r, i) => {
    const same = onStreet.get(streetKey(r.street, r.zip)) ?? [];
    const twin = same.some((o) => o.egaid !== r.egaid && o.number === r.number && distM(o, r) > 100);
    const base = {
      truth: { lat: r.lat, lon: r.lon },
      register: `${r.street} ${r.number}, ${r.zip} ${r.locality}`,
      canton: r.canton,
      twin,
    };
    const id = `a${String(i + 1).padStart(4, '0')}`;
    if (!errIdx.has(i)) {
      rows.push({ id, kind: 'clean', input: formatClean(r), ...base, expect: { status: twin ? ['check'] : ['exact'] } });
      return;
    }
    let kind = kinds[ki++]!;
    const clean = formatClean(r);
    if (kind === 'typo') {
      const bad = typo(r.street);
      rows.push({
        id, kind, ...base,
        input: { address: `${bad} ${r.number}`, postcode: r.zip, city: r.locality },
        expect: { status: ['exact', 'check'] },
        note: `street "${r.street}" -> "${bad}"`,
      });
    } else if (kind === 'noPostcode') {
      rows.push({ id, kind, ...base, input: { address: `${r.street} ${r.number}`, city: r.locality }, expect: { status: ['check'], reasons: ['postcode'] } });
    } else if (kind === 'postcodeSwapped') {
      const z = swapDigits(r.zip);
      const exists = (onStreet.get(streetKey(r.street, z)) ?? []).length > 0;
      rows.push({ id, kind, ...base, input: { address: `${r.street} ${r.number}`, postcode: z, city: r.locality }, expect: { status: exists ? ['exact', 'check'] : ['check'], reasons: ['postcode'] }, note: `postcode ${r.zip} -> ${z}` });
    } else if (kind === 'garbage') {
      rows.push({ id, kind, input: garbage(), expect: { status: ['notfound'] } });
    } else {
      const numbers = new Set(same.map((o) => o.number));
      const numDigits = parseInt(r.number, 10);
      if (kind === 'numberOtherBuilding') {
        const others = same.filter((o) => o.number !== r.number && !same.some((x) => x.number === o.number && x.egaid !== o.egaid && distM(x, o) > 100));
        const o = others.length ? pick(others) : undefined;
        if (o) {
          rows.push({
            id, kind, ...base,
            truth: { lat: o.lat, lon: o.lon },
            input: { address: `${r.street} ${o.number}`, postcode: r.zip, city: r.locality },
            expect: { status: ['exact'] },
            note: `number ${r.number} -> ${o.number}, which is another real building (undetectable by design: the address exists)`,
          });
          return;
        }
        kind = 'numberMissingInRegister';
      }
      let wrong = '';
      for (let t = 0; t < 200 && !wrong; t++) {
        const cand = String(Math.max(1, numDigits + 2 + Math.floor(rand() * 40) * (chance(0.5) ? 1 : -1)));
        if (!numbers.has(cand) && ![...numbers].some((x) => parseInt(x, 10) === parseInt(cand, 10))) wrong = cand;
      }
      rows.push({ id, kind: 'numberMissingInRegister', ...base, input: { address: `${r.street} ${wrong || '999'}`, postcode: r.zip, city: r.locality }, expect: { status: ['check'], reasons: ['houseNumber'] }, note: `number ${r.number} -> ${wrong || '999'}, not in the register` });
    }
    void clean;
  });

  mkdirSync(dirname(SET_FILE), { recursive: true });
  writeFileSync(SET_FILE, JSON.stringify({ source: 'swisstopo amtliches-gebaeudeadressverzeichnis_ch (CSV, LV95)', seed: SEED, rows }, null, 1));
  const byKind: Record<string, number> = {};
  for (const r of rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
  const byCanton: Record<string, number> = {};
  for (const r of rows) byCanton[r.canton ?? '-'] = (byCanton[r.canton ?? '-'] ?? 0) + 1;
  console.log(`wrote ${rows.length} rows to ${SET_FILE}`);
  console.log('by kind', byKind);
  console.log('by canton', byCanton);
  console.log('twins among clean rows:', rows.filter((r) => r.kind === 'clean' && r.twin).length);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
