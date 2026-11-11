/**
 * Two files derived from the NOVA snapshot, written next to it:
 *
 *  - packages/engine/data/nova/price-ladders/<alliance>.json: "number of zones → price" for the
 *    commuter products of a fare network (annual and monthly pass, single ticket, day pass), in
 *    the format of packages/engine/data/tariffs/networks/*.json, for networks without a grid
 *    transcribed from the tariff. How a zone price is tied to a product: price-ladders/README.md.
 *  - packages/engine/data/nova/network-zones.json: per zone of every pass plan, how many of its
 *    stops a neighbouring network serves too, and whether the zone is the network's own.
 *
 * Runs at the end of import.ts, or alone on the snapshot in the repository:
 *
 *   pnpm tsx tools/nova-import/derive.ts [--only=ladders,network-zones] [--dry-run]
 *
 * Alone it needs the endpoint for two small queries (3 + 2 pages) unless the importer's page
 * cache is still fresh; it must run on the day of the import (the zone price entries are
 * matched with the pay levels of the snapshot by counting them).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadNova, type NovaData } from '../../packages/engine/src/fares/nova.js';
import { BASE, DIDOK_GRAPH, ENDPOINT, NOVA_GRAPH, createSparql, type Sparql } from './sparql.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_NOVA_DIR = join(here, '../../packages/engine/data/nova');
const DEFAULT_TARIFF_DIR = join(here, '../../packages/engine/data/tariffs/networks');

/**
 * Every zone price entry, with or without a price. The importer's `prices` section sends the
 * same text, so the pages come from its cache. Entries without a price matter here: nine pay
 * levels have nothing else, and the entries are matched with the pay levels by counting.
 */
export const ZONE_PRICE_QUERY = `SELECT (STRAFTER(STR(?p), "${BASE}zoningpricecharacteristic/") AS ?id) ?price ?cur ?class ?freq (GROUP_CONCAT(DISTINCT STRAFTER(STR(?seg), "${BASE}customersegment/"); separator="|") AS ?segs) FROM <${NOVA_GRAPH}>
WHERE { ?p a otd:ZoningPriceCharacteristic OPTIONAL { ?p schema:price ?price } OPTIONAL { ?p schema:currency ?cur } OPTIONAL { ?p otd:class ?class } OPTIONAL { ?p otd:frequencyCode ?freq } OPTIONAL { ?p otd:customerSegment ?seg } }
GROUP BY ?p ?price ?cur ?class ?freq ORDER BY ?p`;
export const ZONE_PRICE_PAGE = 10000;

const CANTON_QUERY = `SELECT (STRAFTER(STR(?s), "${BASE}didok/") AS ?id) (STRAFTER(STR(?c), "https://ld.admin.ch/canton/") AS ?canton) WHERE { GRAPH <${DIDOK_GRAPH}> { ?s <https://schema.ld.admin.ch/canton> ?c } } ORDER BY ?s ?c`;
const CANTONS = ['', 'ZH', 'BE', 'LU', 'UR', 'SZ', 'OW', 'NW', 'GL', 'ZG', 'FR', 'SO', 'BS', 'BL', 'SH', 'AR', 'AI', 'SG', 'GR', 'AG', 'TG', 'TI', 'VD', 'VS', 'NE', 'GE', 'JU'];

export interface DeriveOptions {
  novaDir?: string;
  tariffDir?: string;
  sparql: Sparql;
  today: string;
  log?: (s: string) => void;
  dryRun?: boolean;
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const round2 = (n: number) => Math.round(n * 100) / 100;
const writeJson = (file: string, value: unknown) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 1) + '\n');
};

// =====================================================================================
// Price ladders
// =====================================================================================

interface Entry {
  id: number;
  price: number | null;
  cls: 0 | 1 | 2;
  /** Tokens of the frequency code: "(2.)(ABO)(140)" → ["2.", "ABO", "140"]. */
  tokens: string[];
  code: string;
  segs: string[];
}
interface PayLevel {
  tarif: string;
  level: string;
  type: string;
  validity: number | null;
  unit: string | null;
  from: number | null;
  to: number | null;
}
interface Tarif {
  id: string;
  identifier: string;
  label: string;
  levels: PayLevel[];
  /** One block of entries per pay level, in the order of the source ids (NOT the order of `levels`). */
  blocks: Entry[][];
}

type Row = Record<string, number>;
type ByClass = Record<string, Row>;
type Product = 'year' | 'month' | 'single' | 'dayPass';

/** Ids inside one block are 13 to 17 apart, blocks 41 or more (snapshot of 10.11.2026). */
const BLOCK_GAP = 30;

function readMeta(novaDir: string): { tarifs: Tarif[]; alliances: Map<string, string> } {
  const tarifs = new Map<string, Tarif>();
  const alliances = new Map<string, string>();
  const levels: PayLevel[] = [];
  for (const line of readFileSync(join(novaDir, 'meta.jsonl'), 'utf8').split('\n')) {
    if (!line.startsWith('[')) continue;
    const r = JSON.parse(line) as unknown[];
    if (r[0] === 'tarif') tarifs.set(r[1] as string, { id: r[1] as string, identifier: r[2] as string, label: r[3] as string, levels: [], blocks: [] });
    else if (r[0] === 'alliance') alliances.set(r[1] as string, r[2] as string);
    else if (r[0] === 'paylevel') levels.push({ tarif: r[1] as string, level: r[2] as string, type: r[3] as string, validity: r[4] as number | null, unit: r[5] as string | null, from: r[6] as number | null, to: r[7] as number | null });
  }
  for (const l of levels) tarifs.get(l.tarif)?.levels.push(l);
  return { tarifs: [...tarifs.values()], alliances };
}

/**
 * Ties the zone price entries to pay levels.
 *
 * The source has no link (no property in either direction, nothing in the IRI). Two regularities
 * of the ids give one all the same, and both are checked on every run:
 *  1. the entries of one pay level have ids close together, with a wide gap to the next pay
 *     level: there are exactly as many such blocks as pay levels;
 *  2. the blocks follow the tarifs (products) in the order of their identifier (plain character
 *     order), each tarif taking as many blocks as it has pay levels.
 * Inside a tarif the order of the blocks is not that of the pay levels; see `ladderOf`.
 */
function alignEntries(rows: string[][], tarifs: Tarif[], log: (s: string) => void): { ok: boolean; evidence: Record<string, unknown> } {
  const entries: Entry[] = rows
    .map(([id, price, , cls, freq, segs]) => ({
      id: Number(id),
      price: price === '' || price === undefined ? null : Number(price),
      cls: (cls === 'KLASSE_1' ? 1 : cls === 'KLASSE_2' ? 2 : 0) as 0 | 1 | 2,
      code: freq ?? '',
      tokens: [...(freq ?? '').matchAll(/\(([^)]*)\)/g)].map((m) => m[1]!.trim()),
      segs: segs ? segs.split('|') : [],
    }))
    .sort((a, b) => a.id - b.id);
  const blocks: Entry[][] = [];
  let widestInside = 0;
  let narrowestBetween = Infinity;
  for (let i = 0; i < entries.length; i++) {
    const gap = i ? entries[i]!.id - entries[i - 1]!.id : Infinity;
    if (gap >= BLOCK_GAP) {
      blocks.push([]);
      if (i) narrowestBetween = Math.min(narrowestBetween, gap);
    } else widestInside = Math.max(widestInside, gap);
    blocks[blocks.length - 1]!.push(entries[i]!);
  }
  const ordered = [...tarifs].sort((a, b) => byText(a.identifier, b.identifier));
  const payLevels = ordered.reduce((n, t) => n + t.levels.length, 0);
  const evidence: Record<string, unknown> = { entries: entries.length, entriesWithoutPrice: entries.filter((e) => e.price === null).length, blocks: blocks.length, payLevels, tarifs: tarifs.length, widestGapInsideBlock: widestInside, narrowestGapBetweenBlocks: narrowestBetween };
  if (blocks.length !== payLevels) {
    log(`  ! ladders: ${blocks.length} blocks of zone price entries for ${payLevels} pay levels: they cannot be matched by counting; no ladder written`);
    return { ok: false, evidence };
  }
  let at = 0;
  for (const t of ordered) {
    t.blocks = blocks.slice(at, at + t.levels.length);
    at += t.levels.length;
  }
  // Does every tarif get entries of its own kind? A pass (valid for weeks, months, years) must
  // carry ABO codes and no ticket codes; a ticket or day pass (minutes, hours, days) no ABO code.
  // One tarif too many or too few before it would shift everything behind.
  let tested = 0;
  const wrong: string[] = [];
  for (const t of ordered) {
    const codes = t.blocks.flat().filter((e) => e.price && e.tokens.length);
    if (!codes.length) continue;
    const units = new Set(t.levels.map((l) => l.unit));
    const isPass = [...units].every((u) => u === 'JAHRE' || u === 'MONATE' || u === 'WOCHEN');
    const isTicket = [...units].every((u) => u === 'MINUTEN' || u === 'STUNDEN' || u === 'TAGE');
    if (!isPass && !isTicket) continue;
    tested++;
    // (GA codes are class changes; they exist for tickets and for passes.)
    const abo = codes.filter((e) => e.tokens.includes('ABO')).length;
    const classChange = codes.filter((e) => e.tokens.includes('GA')).length;
    if (isPass ? abo + classChange !== codes.length : abo > 0) wrong.push(t.identifier);
  }
  evidence.tarifsTested = tested;
  evidence.tarifsOfWrongKind = wrong;
  if (wrong.length > tested * 0.02) {
    log(`  ! ladders: ${wrong.length} of ${tested} tarifs received entries of the wrong kind (${wrong.slice(0, 8).join(', ')}): the order of the tarifs no longer explains the entries; no ladder written`);
    return { ok: false, evidence };
  }
  return { ok: true, evidence };
}

/** Category digit of a pass price: first digit of the last number of the code ("(2.)(ABO)(240)" → 2). */
function passDigit(e: Entry): number | null {
  for (let i = e.tokens.length - 1; i >= 0; i--) if (/^\d{2,}$/.test(e.tokens[i]!)) return Number(e.tokens[i]![0]);
  return null;
}

interface BlockPrices {
  /** "adult.2", "junior.2", "senior.1", "full.2", "half.1" → CHF. */
  cells: Map<string, number>;
  inferred: Set<string>;
}

/**
 * Prices of one pay level of a pass, by category and class.
 * Code digit 1 is the adult price, 3 a senior price where the network uses it (Mobilis). Digit 2
 * is "reduced" and stands for juniors and seniors alike. Read as: one entry for juniors and two
 * for seniors (women, men). That reading gives the published prices of Frimobil (junior and
 * senior differ), unireso (1st class: seniors only), Onde Verte and Mobilis.
 */
function passPrices(block: Entry[]): BlockPrices | null {
  const cells = new Map<string, number>();
  const inferred = new Set<string>();
  for (const cls of [2, 1] as const) {
    const es = block.filter((e) => e.cls === cls && e.price !== null && e.price > 0 && !e.segs.includes('hund-abo'));
    if (!es.length) continue;
    if (es.some((e) => !e.tokens.includes('ABO') || passDigit(e) === null || passDigit(e)! > 3 || passDigit(e)! < 1)) return null;
    const of = (d: number) => es.filter((e) => passDigit(e) === d).map((e) => e.price!);
    const adult = [...new Set(of(1))];
    if (adult.length > 1) return null;
    if (adult.length === 1) cells.set(`adult.${cls}`, adult[0]!);
    const reduced = of(2);
    const senior = [...new Set(of(3))];
    const distinct = [...new Set(reduced)].sort((a, b) => a - b);
    if (senior.length === 1) {
      cells.set(`senior.${cls}`, senior[0]!);
      if (distinct.length === 1) cells.set(`junior.${cls}`, distinct[0]!);
    } else if (senior.length === 0 && distinct.length === 1) {
      // One price for every reduced entry: a single entry is the junior price; two are the two
      // senior entries (no junior pass in this class); three or more are junior and senior.
      if (reduced.length !== 2) cells.set(`junior.${cls}`, distinct[0]!);
      if (reduced.length >= 2) cells.set(`senior.${cls}`, distinct[0]!);
      if (reduced.length >= 2) inferred.add(`senior.${cls}`);
    } else if (senior.length === 0 && distinct.length === 2) {
      // Two prices: the one carried by two entries is the senior price.
      const twice = distinct.filter((p) => reduced.filter((x) => x === p).length >= 2);
      const s = twice.length === 1 ? twice[0]! : distinct[1]!;
      cells.set(`senior.${cls}`, s);
      cells.set(`junior.${cls}`, distinct.find((p) => p !== s)!);
      inferred.add(`senior.${cls}`);
      inferred.add(`junior.${cls}`);
    }
  }
  return cells.size ? { cells, inferred } : null;
}

const TICKET_TOKENS = /^(1\.|2\.|L|V|EF|TK|HA|1\/2|1\/2-ABO|BIGT|\d+)$/;

/** Prices of one pay level of a ticket or day pass: full and half price by class. */
function ticketPrices(block: Entry[]): BlockPrices | null {
  const cells = new Map<string, number>();
  for (const cls of [2, 1] as const) {
    const es = block.filter((e) => e.cls === cls && e.price !== null && e.price > 0);
    if (!es.length) continue;
    if (es.some((e) => !e.tokens.length || e.tokens.some((t) => !TICKET_TOKENS.test(t)))) return null;
    const full = [...new Set(es.filter((e) => !e.tokens.some((t) => t === 'HA' || t === '1/2' || t === '1/2-ABO')).map((e) => e.price!))];
    if (full.length > 1) return null;
    if (full.length === 1) cells.set(`full.${cls}`, full[0]!);
    // Half-fare card first; where the network has no such code, the child price.
    for (const mark of ['HA', '1/2-ABO', '1/2']) {
      const half = [...new Set(es.filter((e) => e.tokens.includes(mark)).map((e) => e.price!))];
      if (half.length === 1) {
        cells.set(`half.${cls}`, half[0]!);
        break;
      }
    }
  }
  return cells.size ? { cells, inferred: new Set() } : null;
}

interface Ladder {
  tarif: Tarif;
  /** "adult.2" → zone key → CHF. */
  rows: Map<string, Row>;
  minZones: number;
  allFrom: number | null;
  /** How pay levels that are not "n zones" were set aside; empty when the tarif has none. */
  assumptions: string[];
  inferred: Set<string>;
}

/**
 * The ladder of one tarif: its blocks ranked by price and laid on its pay levels ranked by
 * number of zones (the source does not say which block is which level, but a price for more
 * zones is never lower). Pay levels that are not a number of zones (a named city zone, a short
 * trip) have a block too and must be set aside first; how that was done is in `assumptions`.
 * Null with a reason when the ladder cannot be built without guessing more than that.
 */
function ladderOf(t: Tarif, kind: 'pass' | 'ticket'): Ladder | string {
  const read = kind === 'pass' ? passPrices : ticketPrices;
  const mainKey = kind === 'pass' ? 'adult' : 'full';
  const parsed: BlockPrices[] = [];
  for (const b of t.blocks) {
    const p = read(b);
    if (!p) return 'entries with a code that is not understood';
    parsed.push(p);
  }
  const key = (p: BlockPrices) => p.cells.get(`${mainKey}.2`) ?? p.cells.get(`${mainKey}.1`);
  if (parsed.some((p) => key(p) === undefined)) return `a pay level without ${mainKey} price`;
  let zonal = t.levels.filter((l) => l.type === 'ZONENWERT' && l.from !== null && l.to !== null).sort((a, b) => a.from! - b.from!);
  const assumptions: string[] = [];
  let flat = false;
  if (!zonal.length) {
    // A network of one zone: its single named zone is the whole ladder.
    const named = t.levels.filter((l) => l.type === 'ZONENNUMMER');
    if (named.length !== 1) return 'no pay level by number of zones';
    zonal = named;
    flat = true;
    assumptions.push(`the tarif has one named zone (${named[0]!.level}) and no levels by number of zones: taken as the price of the whole network`);
  }
  let blocks = [...parsed].sort((a, b) => key(a)! - key(b)!);
  let extra = blocks.length - zonal.length;
  if (extra > 0) {
    const others = t.levels.filter((l) => !zonal.includes(l)).map((l) => l.level);
    // 1. Blocks without the classes the others have (a short-trip ticket is 2nd class only).
    const classes = (p: BlockPrices) => [...p.cells.keys()].filter((k) => k.startsWith(mainKey)).length;
    const most = Math.max(...blocks.map(classes));
    const fewer = blocks.filter((p) => classes(p) < most);
    if (fewer.length && fewer.length <= extra) {
      blocks = blocks.filter((p) => !fewer.includes(p));
      extra -= fewer.length;
      assumptions.push(`${fewer.length} level(s) sold in one class only set aside`);
    }
    // 2. A block equal in every price to another one (a city zone sold at the price of n zones).
    const same = (a: BlockPrices, b: BlockPrices) => a.cells.size === b.cells.size && [...a.cells].every(([k, v]) => b.cells.get(k) === v);
    for (let i = blocks.length - 1; i > 0 && extra > 0; i--)
      if (same(blocks[i]!, blocks[i - 1]!)) {
        blocks.splice(i, 1);
        extra--;
        assumptions.push('one level with the same prices as another set aside');
      }
    // 3. What is left over is taken from the cheap end (city zones and short trips cost less
    //    than the first zone step); only when that end is clearly apart.
    if (extra > 0) {
      if (key(blocks[extra - 1]!)! >= key(blocks[extra]!)!) return `${extra} level(s) not by number of zones (${others.join(', ')}) cannot be told from the others`;
      blocks.splice(0, extra);
      assumptions.push(`${extra} cheapest level(s) set aside`);
      extra = 0;
    }
    assumptions.unshift(`the tarif has ${others.length} level(s) that are not a number of zones (${others.join(', ')})`);
  }
  if (extra < 0) return 'fewer price blocks than pay levels';
  const rows = new Map<string, Row>();
  const inferred = new Set<string>();
  let allFrom: number | null = null;
  zonal.forEach((level, i) => {
    const b = blocks[i]!;
    const keys: string[] = [];
    if (flat) keys.push('1', 'all');
    else if (zonal.length === 1) {
      // One price whatever the number of zones (a network-wide pass).
      for (let z = level.from!; z <= Math.min(level.to!, level.from!); z++) keys.push(String(z));
      keys.push('all');
      allFrom = level.from!;
    } else if (level.to! >= 900) {
      keys.push('all');
      allFrom = level.from!;
    } else for (let z = level.from!; z <= level.to!; z++) keys.push(String(z));
    for (const [cell, price] of b.cells) {
      let row = rows.get(cell);
      if (!row) rows.set(cell, (row = {}));
      for (const k of keys) row[k] = price;
    }
    for (const c of b.inferred) inferred.add(c);
  });
  if (flat) allFrom = 1;
  // Complete and never falling, for every category and class.
  const zoneKeys = Object.keys(rows.get(`${mainKey}.2`) ?? rows.get(`${mainKey}.1`)!);
  for (const [cell, row] of [...rows]) {
    const values = zoneKeys.map((k) => row[k]);
    if (values.some((v) => v === undefined)) {
      // A category missing on some levels (no junior price for one zone count): dropped, not guessed.
      if (cell.startsWith(mainKey)) return `${cell} missing on some levels`;
      rows.delete(cell);
      continue;
    }
    for (let i = 1; i < values.length; i++) if (values[i]! < values[i - 1]!) return `${cell} falls between ${zoneKeys[i - 1]} and ${zoneKeys[i]} zones`;
  }
  return { tarif: t, rows, minZones: flat ? 1 : zonal[0]!.from!, allFrom, assumptions, inferred };
}

/** Words that mark a product for a special public, a special area or a special use. */
const SPECIAL =
  /hund|velo|grupp|grubi|\bgr\b|railaway|\braw?\b|klassenwechsel|\bklw\b|modul|\bmod\b|sch(ü|ue)ler|schule|partner|job|unpers|übertragbar|uebertragbar|kombi|gratis|duo|abend|9 ?uhr|\bfam|evam|caritas|asyl|anschluss|\bab\b|p\+r|p r\b|\bai\b|\bhg\b|\biv\b|legi|mitfahr|weekend|week end|publibike|distripass|regiocard|fvp|invalid|einwohner|bonus|ermässigt|\berm\b|jugend|\bjug\b|awb|\bter\b|noct|interval|transval|paket|halbjahr|utpt|tilo|\(chfr\)|chfr|\(f\)|\bf\b|mensualis|monatlich|transalis|spezial|gemeinsam|komfort|weiter|multi|mehrfahrten|\bmfk\b|zentrum|gruy|einweihung|v21|saison|flexi|flabo|schnee|triregio|sncf|71 72|mini|albis|maximo|kurzstr|forfait|clip|saleve|witz|\b[2-9] ?tage|\b[2-9] ?tk\b|\b\d monate|event|ticino|\bsm\b|st\. moritz|velbo|\bsp\b \(|\(biel|\(thun/i;

function productOf(t: Tarif): Product | null {
  const codes = t.blocks.flat().filter((e) => e.price && e.tokens.length);
  if (!codes.length || !t.levels.length) return null;
  const all = (f: (e: Entry) => boolean) => codes.every(f);
  const levels = t.levels;
  if (all((e) => e.tokens.includes('ABO'))) {
    if (levels.every((l) => (l.unit === 'JAHRE' && l.validity === 1) || (l.unit === 'MONATE' && l.validity === 12))) return 'year';
    if (levels.every((l) => l.unit === 'MONATE' && l.validity === 1)) return 'month';
    return null;
  }
  if (all((e) => e.tokens.includes('TK') && !e.tokens.includes('ABO'))) return levels.every((l) => (l.unit === 'TAGE' && l.validity === 1) || (l.unit === 'STUNDEN' && l.validity === 24)) ? 'dayPass' : null;
  if (all((e) => (e.tokens.includes('V') || e.tokens.includes('EF')) && !e.tokens.includes('TK') && !e.tokens.includes('ABO'))) return levels.every((l) => l.unit === 'MINUTEN' || l.unit === 'STUNDEN') ? 'single' : null;
  return null;
}

type Leaf = Record<string, unknown>;
/** Compares "section → … → zone key → price" trees; cells present on both sides only. */
function compareTrees(mine: unknown, ref: unknown, path: string, out: { same: number; differ: string[] }) {
  if (typeof ref === 'number') {
    if (typeof mine !== 'number') return;
    if (Math.abs(mine - ref) < 0.005) out.same++;
    else out.differ.push(`${path}: NOVA ${mine}, reference ${ref}`);
    return;
  }
  if (!ref || typeof ref !== 'object' || !mine || typeof mine !== 'object') return;
  for (const k of Object.keys(ref as Leaf)) compareTrees((mine as Leaf)[k], (ref as Leaf)[k], path ? `${path}.${k}` : k, out);
}

/** Tariff year of prices in force on a day: the year changes with the timetable in mid December. */
const tariffYearOf = (day: string) => Number(day.slice(0, 4)) + (day.slice(5) >= '12-15' ? 1 : 0);

export async function deriveLadders(opts: DeriveOptions): Promise<void> {
  const log = opts.log ?? (() => {});
  const novaDir = opts.novaDir ?? DEFAULT_NOVA_DIR;
  const tariffDir = opts.tariffDir ?? DEFAULT_TARIFF_DIR;
  const outDir = join(novaDir, 'price-ladders');
  log('ladders: zone price entries, matched with the pay levels of the snapshot');
  const rows = await opts.sparql.paged('prices-zone', ZONE_PRICE_QUERY, ZONE_PRICE_PAGE);
  const { tarifs } = readMeta(novaDir);
  const { ok, evidence } = alignEntries(rows, tarifs, log);
  const nova = loadNova(novaDir);
  const year = tariffYearOf(opts.today);
  const byId = new Map(tarifs.map((t) => [t.id, t]));
  const references = JSON.parse(readFileSync(join(here, 'ladder-reference.json'), 'utf8')) as Record<string, { year?: number; source?: string } & Leaf>;
  const report: string[] = [
    '# Price ladders read from NOVA: report of the last run',
    '',
    `Written by \`tools/nova-import/derive.ts\` on ${opts.today}; do not edit. What the files are and how far to trust them: \`README.md\`.`,
    '',
    '## Matching zone price entries with pay levels',
    '',
    ...Object.entries(evidence).map(([k, v]) => `- ${k}: ${Array.isArray(v) ? (v.length ? v.join(', ') : 'none') : v}`),
    '',
  ];
  const written: string[] = [];
  const files = new Map<string, unknown>();
  if (ok) {
    report.push('## Alliances', '', '| Alliance | Confidence | Annual | Monthly | Single | Day pass | Checked against | Remarks |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const a of nova.alliances()) {
      const onPlans = [...new Set(a.plans.flatMap((p) => p.tarifs))].map((id) => byId.get(id)).filter((t): t is Tarif => !!t);
      const chosen: Partial<Record<Product, Ladder>> = {};
      const remarks: string[] = [];
      const notes: string[] = [];
      for (const product of ['year', 'month', 'single', 'dayPass'] as const) {
        const candidates = onPlans
          .filter((t) => productOf(t) === product && !SPECIAL.test(`${t.identifier.replace(/[_-]+/g, ' ')} ${t.label}`))
          .sort((x, y) => x.identifier.length - y.identifier.length || byText(x.identifier, y.identifier));
        if (!candidates.length) continue;
        const l = ladderOf(candidates[0]!, product === 'year' || product === 'month' ? 'pass' : 'ticket');
        if (typeof l === 'string') {
          remarks.push(`${product}: ${candidates[0]!.identifier} not usable (${l})`);
          continue;
        }
        chosen[product] = l;
        if (candidates.length > 1) notes.push(`${product}: read from ${l.tarif.identifier} "${l.tarif.label}"; other products of the same kind on the alliance's plans, not used: ${candidates.slice(1).map((t) => `${t.identifier} "${t.label}"`).join(', ')}.`);
        for (const s of l.assumptions) notes.push(`${product} (${l.tarif.identifier}): ${s}.`);
      }
      const products = Object.keys(chosen) as Product[];
      if (!chosen.year && !chosen.month) {
        report.push(`| ${a.id} | – | | | | | | no pass ladder: ${remarks.join('; ') || 'no standard annual or monthly pass with zone prices on its plans'} |`);
        continue;
      }
      const section = (l: Ladder | undefined, cats: string[]) => {
        if (!l) return undefined;
        const out: Record<string, ByClass> = {};
        for (const c of cats) for (const cls of ['2', '1']) if (l.rows.has(`${c}.${cls}`)) (out[c] ??= {})[cls] = l.rows.get(`${c}.${cls}`)!;
        return Object.keys(out).length ? out : undefined;
      };
      const grid: Record<string, unknown> = {};
      const single = section(chosen.single, ['full', 'half']);
      const day = section(chosen.dayPass, ['full', 'half']);
      const passes: Record<string, unknown> = {};
      for (const p of ['month', 'year'] as const) {
        const s = section(chosen[p], ['adult', 'junior', 'senior']);
        if (s) passes[p] = s;
      }
      if (single) grid.tickets = { single };
      if (day) grid.dayPass = day;
      grid.passes = passes;

      // Validation against a grid of the same tariff year.
      let checkedAgainst = '';
      let validated = false;
      let mismatch: string[] = [];
      const refs: { name: string; tree: unknown }[] = [];
      const tariffFile = join(tariffDir, `${a.id}.json`);
      if (existsSync(tariffFile)) {
        const g = JSON.parse(readFileSync(tariffFile, 'utf8')) as Leaf;
        if (g.year === year) refs.push({ name: `tariffs/networks/${a.id}.json`, tree: g });
        else if (g.previous) refs.push({ name: `tariffs/networks/${a.id}.json (previous)`, tree: g.previous });
      }
      if (references[a.id]?.year === year) refs.push({ name: 'tools/nova-import/ladder-reference.json', tree: references[a.id] });
      for (const r of refs) {
        const res = { same: 0, differ: [] as string[] };
        for (const k of ['tickets', 'dayPass', 'passes']) compareTrees(grid[k], (r.tree as Leaf)[k], k, res);
        checkedAgainst = `${r.name}: ${res.same} cells equal, ${res.differ.length} different`;
        mismatch = res.differ;
        validated = res.same >= 6 && !res.differ.length;
      }
      if (mismatch.length) {
        report.push(`| ${a.id} | – | | | | | ${checkedAgainst} | NOT WRITTEN: ${mismatch.slice(0, 6).join('; ')} |`);
        continue;
      }
      const assumed = products.some((p) => chosen[p]!.assumptions.length > 0);
      const complete = products.length === 4;
      const confidence = validated ? 'validated' : complete && !assumed ? 'consistent' : 'partial';
      const inferredCells = [...new Set(products.flatMap((p) => [...chosen[p]!.inferred].map((c) => c.split('.')[0]!)))];
      if (inferredCells.length) notes.push(`Junior and senior pass prices are told apart by counting entries (NOVA marks both "reduced"): one entry is read as the junior price, two as the senior price. Categories concerned here: ${inferredCells.join(', ')}.`);
      const missing = (['year', 'month', 'single', 'dayPass'] as const).filter((p) => !chosen[p]);
      if (missing.length) notes.push(`Not found or not usable: ${missing.join(', ')}${remarks.length ? ` (${remarks.join('; ')})` : ''}.`);
      const passLadder = chosen.year ?? chosen.month!;
      const ticketLadder = chosen.single ?? chosen.dayPass;
      const planFor = (l: Ladder | undefined, type: 'pass' | 'ticket') => {
        if (!l) return undefined;
        const withTarif = a.plans.filter((p) => p.tarifs.includes(l.tarif.id));
        return (withTarif.find((p) => p.type === type || p.type === 'pass+ticket') ?? withTarif[0])?.id;
      };
      const sameAll = !ticketLadder || ticketLadder.allFrom === passLadder.allFrom;
      const file = {
        network: a.label,
        alliance: a.id,
        origin: 'nova',
        year,
        validFrom: null,
        source: `${ENDPOINT} (graph ${NOVA_GRAPH}), published through opentransportdata.swiss`,
        currency: 'CHF',
        confidence,
        notes: [
          `Prices as held in NOVA on ${opts.today}, ${year} tariff year. NOVA carries no validity date: it shows the prices in force on the day of the import.`,
          'NOVA does not link a zone price to a product; the link is derived from the order of the entries (price-ladders/README.md) and, inside a product, from the rank of the prices: more zones never cost less.',
          confidence === 'validated' ? `Checked against ${checkedAgainst}.` : confidence === 'consistent' ? 'Not checked against a published tariff: all four products found, complete and never falling with the number of zones.' : 'Not checked against a published tariff, and incomplete or resting on an assumption (see the notes below).',
          'Senior prices are given only where NOVA shows them; without one, seniors may pay the adult price or the reduced one, NOVA does not say. Flexi and weekly passes are not read.',
          ...notes,
        ],
        passPlan: planFor(passLadder, 'pass'),
        ticketPlan: planFor(ticketLadder, 'ticket') ?? planFor(passLadder, 'pass'),
        rules: {
          together: [],
          minZones: { pass: passLadder.minZones, ticket: ticketLadder?.minZones ?? passLadder.minZones },
          ...(sameAll && passLadder.allFrom !== null ? { allZonesFrom: passLadder.allFrom } : {}),
          countBy: 'factor',
          text: [
            `Read from NOVA pay levels: passes from ${passLadder.minZones} zone(s)${passLadder.allFrom !== null ? `, all zones from ${passLadder.allFrom}` : ', no all-zones level'}${ticketLadder ? `; tickets from ${ticketLadder.minZones} zone(s)${ticketLadder.allFrom !== null ? `, all zones from ${ticketLadder.allFrom}` : ', no all-zones level'}` : ''}.`,
            'Zones sold together, city-zone and short-trip prices and overlap rules of the tariff are not in this file.',
          ],
        },
        ...grid,
        novaTarifs: Object.fromEntries(products.map((p) => [p, chosen[p]!.tarif.identifier])),
        // Products whose ladder rests on an assumption about levels that are not a number of zones.
        assumedProducts: products.filter((p) => chosen[p]!.assumptions.length > 0),
      };
      files.set(a.id, file);
      written.push(a.id);
      const cell = (p: Product) => (chosen[p] ? `${chosen[p]!.tarif.identifier} (${Object.keys(chosen[p]!.rows.values().next().value as Row).length})` : '–');
      report.push(`| ${a.id} | ${confidence} | ${cell('year')} | ${cell('month')} | ${cell('single')} | ${cell('dayPass')} | ${checkedAgainst || '–'} | ${[...remarks, assumed ? `assumption on levels that are not a number of zones: ${products.filter((p) => chosen[p]!.assumptions.length > 0).join(', ')}` : ''].filter(Boolean).join('; ')} |`);
    }
    report.push('', 'In the product columns: the NOVA tarif read, and the number of zone columns of its ladder.', '');
  } else report.push('The entries could not be matched with the pay levels (see above): **no ladder written**, earlier files removed.', '');

  log(`ladders: ${written.length} alliances (${['validated', 'consistent', 'partial'].map((c) => `${[...files.values()].filter((f) => (f as { confidence: string }).confidence === c).length} ${c}`).join(', ')})`);
  if (opts.dryRun) {
    log(report.join('\n'));
    return;
  }
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) if (f.endsWith('.json')) rmSync(join(outDir, f));
  for (const [id, file] of files) writeJson(join(outDir, `${id}.json`), file);
  writeFileSync(join(outDir, 'REPORT.md'), report.join('\n'));
}

// =====================================================================================
// Which zones are a network's own
// =====================================================================================

/**
 * Joint products laid over several zonal networks: never "the other network" of a zone.
 * Léman Pass is not one of them: its French ring zones (200, 210, 230, 240, 250) are its own and
 * it sells every trip that uses one; that Geneva's zone 10 is unireso's is written in
 * zone-primacy.json.
 */
export const UMBRELLAS: Record<string, string> = {
  'z-pass-a-welle-zvv': 'joint pass ZVV + A-Welle: every stop is also a ZVV or A-Welle stop',
  'z-pass-ostwind-zvv': 'joint pass ZVV + Ostwind: every stop is also a ZVV or Ostwind stop',
  'z-pass-tv-schwyz-zug-zvv': 'joint pass ZVV + Schwyz/Zug: every stop is also a ZVV, Schwyz or Zug stop',
  'bodensee-ticket-bahn-bus-fahre': 'tourist day ticket around Lake Constance over Ostwind, Vorarlberg, Liechtenstein and German networks; no pass plan',
};
/** A zone is examined as a possible duplicate when this share of its stops is also the partner's. */
export const OWN_THRESHOLD = 0.8;
/** Plans that are not the network's own area: joint plans with a neighbour, plans of former networks. */
const JOINT_PLAN = (alliance: string, p: { id: string; label: string }) => /kombi|fiktiv|transfrontalier|transalis|\bEx[A-Z]/.test(p.label) || /kombi|fiktiv|transfrontalier|transalis/.test(p.id) || (!alliance.startsWith('z-pass') && p.id.startsWith('z-pass'));

interface PrimacyEntry {
  alliance: string;
  zones: number[];
  partner: string;
  partnerZones?: number[];
  tariff: string;
  source: string;
}

export async function deriveNetworkZones(opts: DeriveOptions): Promise<void> {
  const log = opts.log ?? (() => {});
  const novaDir = opts.novaDir ?? DEFAULT_NOVA_DIR;
  log('network-zones: cantons of the stops, stops shared between networks');
  const canton = new Map<string, string>();
  for (const [id, c] of (await opts.sparql.paged('didok-cantons', CANTON_QUERY, 20000)) as [string, string][]) if (!canton.has(id)) canton.set(id, CANTONS[Number(c)] ?? c);
  const nova: NovaData = loadNova(novaDir);
  const primacyFile = JSON.parse(readFileSync(join(here, 'zone-primacy.json'), 'utf8')) as { entries: PrimacyEntry[]; open?: string[]; sources?: Record<string, string> };
  const primacy = primacyFile.entries;

  // Stops of every zone of every pass plan. NOVA gives zones per edge: a stop is put in the zones
  // all its edges share (an edge that crosses several zones lists them all), or, when they share
  // none, in every zone its edges use.
  interface PlanZones {
    alliance: string;
    plan: string;
    type: string;
    label: string;
    joint: boolean;
    edges: number;
    zones: Map<number, Set<string>>;
    stops: Set<string>;
  }
  const plans: PlanZones[] = [];
  for (const a of nova.alliances())
    for (const p of a.plans) {
      if (p.type !== 'pass' && p.type !== 'pass+ticket') continue;
      const zones = new Map<number, Set<string>>();
      const stops = new Set<string>();
      const common = new Map<string, Set<number>>();
      const any = new Map<string, Set<number>>();
      for (const [key, zs] of nova.raw.planEdges(a.id, p.id))
        for (const s of key.split(' ')[0]!.split('-')) {
          stops.add(s);
          const c = common.get(s);
          common.set(s, c ? new Set([...c].filter((z) => zs.includes(z))) : new Set(zs));
          let u = any.get(s);
          if (!u) any.set(s, (u = new Set()));
          for (const z of zs) u.add(z);
        }
      for (const s of stops)
        for (const z of common.get(s)!.size ? common.get(s)! : any.get(s)!) {
          let set = zones.get(z);
          if (!set) zones.set(z, (set = new Set()));
          set.add(s);
        }
      plans.push({ alliance: a.id, plan: p.id, type: p.type, label: p.label, joint: JOINT_PLAN(a.id, p), edges: p.edgeCount, zones, stops });
    }
  // The area of a zonal network: its largest pass plan that is not a joint one.
  const main = new Map<string, PlanZones>();
  for (const p of [...plans].sort((x, y) => y.edges - x.edges)) if (!p.joint && !(p.alliance in UMBRELLAS) && !main.has(p.alliance)) main.set(p.alliance, p);
  const zonal = [...main.keys()].sort();
  const local = nova
    .alliances()
    .map((a) => a.id)
    .filter((id) => !main.has(id) && !(id in UMBRELLAS));

  // Stops of a network that no other zonal network serves, by canton: where the network is at home.
  const exclusive = new Map<string, Map<string, number>>();
  for (const a of zonal) {
    const m = new Map<string, number>();
    for (const s of main.get(a)!.stops) if (!zonal.some((b) => b !== a && main.get(b)!.stops.has(s))) m.set(canton.get(s) ?? '?', (m.get(canton.get(s) ?? '?') ?? 0) + 1);
    exclusive.set(a, m);
  }

  type ZoneOut = Record<string, unknown> & { own: boolean; ownByRule: boolean; sharedShare: number; stops: number };
  const out: Record<string, Record<string, Record<string, ZoneOut>>> = {};
  const pairRows = new Map<string, string[]>();
  let documented = 0;
  let documentedAgree = 0;
  const disagreements: string[] = [];
  for (const p of plans) {
    const isUmbrella = p.alliance in UMBRELLAS;
    const zoneLabels = new Map((nova.plan(p.alliance, p.plan)?.zones ?? []).map((z) => [z.code, z.label]));
    const zonesOut: Record<string, ZoneOut> = {};
    for (const [code, stops] of [...p.zones].sort((x, y) => x[0] - y[0])) {
      const n = stops.size;
      const sharedWith: Record<string, { share: number; zones: Record<string, number> }> = {};
      let anyShared = 0;
      for (const s of stops) if (zonal.some((b) => b !== p.alliance && main.get(b)!.stops.has(s))) anyShared++;
      for (const b of zonal) {
        if (b === p.alliance) continue;
        const other = main.get(b)!;
        const common = [...stops].filter((s) => other.stops.has(s));
        if (!common.length) continue;
        const inZones: Record<string, number> = {};
        for (const [z, set] of other.zones) {
          const c = common.filter((s) => set.has(s)).length;
          if (c) inZones[String(z)] = c;
        }
        sharedWith[b] = { share: round2(common.length / n), zones: inZones };
      }
      const partner = Object.entries(sharedWith).sort((x, y) => y[1].share - x[1].share || byText(x[0], y[0]))[0];
      const cantons: Record<string, number> = {};
      for (const s of stops) cantons[canton.get(s) ?? '?'] = (cantons[canton.get(s) ?? '?'] ?? 0) + 1;
      const home = Object.entries(cantons).sort((x, y) => y[1] - x[1] || byText(x[0], y[0]))[0]![0];
      let ownByRule = true;
      let reason = partner ? `${Math.round(partner[1].share * 100)} % of the stops are also ${partner[0]} stops: below the threshold` : 'no stop shared with another zonal network';
      if (partner && partner[1].share >= OWN_THRESHOLD) {
        if (isUmbrella) {
          ownByRule = false;
          reason = `joint product: ${Math.round(partner[1].share * 100)} % of the stops are ${partner[0]} stops`;
        } else {
          const mine = exclusive.get(p.alliance)?.get(home) ?? 0;
          const theirs = exclusive.get(partner[0])?.get(home) ?? 0;
          ownByRule = mine > theirs;
          reason = `${Math.round(partner[1].share * 100)} % of the stops are also ${partner[0]} stops; most stops of the zone lie in ${home}, where ${p.alliance} has ${mine} stops of its own and ${partner[0]} ${theirs}`;
        }
      }
      const doc = primacy.find((e) => e.alliance === p.alliance && e.zones.includes(code));
      const own = doc ? doc.tariff === p.alliance : ownByRule;
      if (doc && main.get(p.alliance) === p) {
        documented++;
        if (ownByRule === own) documentedAgree++;
        else disagreements.push(`${p.alliance} ${code} (${zoneLabels.get(code) ?? ''}): tariff says ${doc.tariff}, rule says ${ownByRule ? 'own' : 'not own'}`);
      }
      zonesOut[String(code)] = {
        label: zoneLabels.get(code) ?? '',
        stops: n,
        sharedShare: round2(anyShared / n),
        ...(partner ? { partner: partner[0], partnerShare: partner[1].share } : {}),
        sharedWith,
        cantons,
        own,
        basis: doc ? 'tariff' : 'rule',
        ownByRule,
        rule: reason,
        ...(doc ? { documented: { tariff: doc.tariff, partner: doc.partner, source: doc.source } } : {}),
      };
    }
    ((out[p.alliance] ??= {})[p.plan] = zonesOut);
  }

  // Pairs a person should look at: every zone of one network with stops of the other.
  const PAIRS: [string, string[]][] = [
    ['Mobilis and Frimobil', ['mobilis', 'frimobil']],
    ['Mobilis and unireso / Léman Pass', ['mobilis', 'unireso', 'leman-pass']],
    ['Mobilis and Onde Verte', ['mobilis', 'onde-verte']],
    ['Frimobil and Libero', ['frimobil', 'libero']],
  ];
  const stopsOfAlliance = (id: string) => main.get(id)?.stops ?? new Set(plans.filter((p) => p.alliance === id).flatMap((p) => [...p.stops]));
  for (const [title, ids] of PAIRS) {
    const rows: string[] = [];
    for (const a of ids)
      for (const p of plans.filter((x) => x.alliance === a && (main.get(a) === x || a in UMBRELLAS))) {
        for (const [code, stops] of [...p.zones].sort((x, y) => x[0] - y[0])) {
          const z = out[a]![p.plan]![String(code)]!;
          const withOthers = ids.filter((b) => b !== a).map((b) => [b, [...stops].filter((s) => stopsOfAlliance(b).has(s)).length] as const).filter(([, c]) => c > 0);
          if (!withOthers.length) continue;
          const doc = z.documented as { tariff: string; source: string } | undefined;
          rows.push(`| ${a} | ${code} ${z.label} | ${z.stops} | ${withOthers.map(([b, c]) => `${b} ${Math.round((c / stops.size) * 100)} %`).join(', ')} | ${Object.entries(z.cantons as Record<string, number>).map(([c, k]) => `${c} ${k}`).join(', ')} | ${z.ownByRule ? 'own' : 'not own'} | ${doc ? `${doc.tariff} (${doc.source})` : '–'} | **${z.own ? 'own' : 'not own'}** |`);
        }
      }
    pairRows.set(title, rows);
  }

  const file = {
    _about: 'Which zones are a fare network\'s own. Written by tools/nova-import/derive.ts from the NOVA snapshot; do not edit (documented exceptions: tools/nova-import/zone-primacy.json). Explanation and the lists to check by hand: NETWORK-ZONES.md.',
    generated: opts.today,
    source: `${ENDPOINT} (graphs ${NOVA_GRAPH}, ${DIDOK_GRAPH}), published through opentransportdata.swiss`,
    rule: {
      threshold: OWN_THRESHOLD,
      text: [
        'NOVA gives zones per edge. A stop is put in the zones all its edges share, or in every zone its edges use when they share none. The area of a zonal network is its largest pass plan that is not a joint plan.',
        `partnerShare: share of the zone's stops that are also stops of one other zonal network (the one with most). Below ${OWN_THRESHOLD}: the zone is the network's own.`,
        `From ${OWN_THRESHOLD}: the zone and the partner's zone cover the same ground, and the stops cannot say whose it is. The rule then gives it to the network that has more stops of its own (served by no other zonal network) in the canton where most of the zone's stops lie.`,
        'Where the tariff of one of the two networks names the tariff that applies inside the shared zone (tools/nova-import/zone-primacy.json), that decides `own`; `ownByRule` keeps what the rule said.',
        'Zones of joint products (umbrellas) are own only where no zonal network covers them.',
      ],
      documentedZones: documented,
      ruleAgreesWithTariff: documentedAgree,
      ruleDisagrees: disagreements,
    },
    umbrellas: Object.keys(UMBRELLAS),
    umbrellaReasons: UMBRELLAS,
    zonal,
    withoutPassPlan: local,
    mainPassPlan: Object.fromEntries(zonal.map((a) => [a, main.get(a)!.plan])),
    alliances: out,
  };
  const md = [
    '# Which zones are a network\'s own',
    '',
    `Written by \`tools/nova-import/derive.ts\` on ${opts.today} with \`network-zones.json\`; do not edit.`,
    '',
    '## The question',
    '',
    'Where two fare networks overlap, both have a zone over the same stops (Lucens: Mobilis 103 and Frimobil 45). A trip inside such a zone belongs to one of them only; the other network\'s zone there merely lets its own trips reach across. `own: false` marks a zone a network may use only together with one of its own zones.',
    '',
    '## The rule, and how far it goes',
    '',
    ...file.rule.text.map((t) => `- ${t}`),
    '',
    `**The stops alone do not answer the question.** Overlap zones mirror each other: the two networks' zones hold the same stops, so the share is high on both sides. Who has primacy is a decision written in the tariffs. The canton rule is a guess for zones no tariff we read covers: on the ${documented} zones where a tariff names the answer it is right for ${documentedAgree} and wrong for ${documented - documentedAgree}:`,
    '',
    ...disagreements.map((d) => `- ${d}`),
    '',
    'A second guess was tried and not kept: counting the edges from the zone to stops only one of the two networks serves. It was right on about as many of the same zones, and wrong on other ones.',
    '',
    `Zones decided by a tariff have \`basis: "tariff"\`; all others \`basis: "rule"\` and deserve a look when a network pair matters (list the zones with \`partnerShare\` ≥ ${OWN_THRESHOLD}).`,
    '',
    '## Tariffs read, and open cases',
    '',
    ...Object.entries(primacyFile.sources ?? {}).map(([k, v]) => `- ${k}: ${v}`),
    '',
    ...(primacyFile.open ?? []).map((t) => `- Open: ${t}`),
    '',
    '## Networks',
    '',
    `- Zonal networks (they have a pass plan; the plan taken as their area): ${zonal.map((a) => `${a} (\`${main.get(a)!.plan}\`)`).join(', ')}.`,
    `- Joint products, never counted as "another network": ${Object.entries(UMBRELLAS).map(([k, v]) => `**${k}** (${v})`).join('; ')}.`,
    `- Alliances without a pass plan in the snapshot (local or foreign tariffs; listed in the file with no zones, not counted as neighbours): ${local.join(', ') || 'none'}.`,
    '- Joint plans inside a zonal network (a combined pass with a neighbour, the plan of a former network) are in the file with their zones but are not the network\'s area.',
    '- Passepartout, TNW, Ostwind, A-Welle and the like are zonal networks, not umbrellas: they have zones and prices of their own.',
    '',
    '## Zones to check by hand',
    '',
    'Every zone of one network of the pair that holds stops of the other. Columns: stops of the zone, share of them the other network serves, cantons of the stops, what the rule says, what a tariff says, the flag written.',
    '',
    ...PAIRS.flatMap(([title]) => [`### ${title}`, '', ...(pairRows.get(title)!.length ? ['| Network | Zone | Stops | Shared with | Cantons | Rule | Tariff | Flag |', '| --- | --- | ---: | --- | --- | --- | --- | --- |', ...pairRows.get(title)!] : ['No zone of one holds a stop of the other.']), '']),
  ];
  log(`network-zones: ${zonal.length} zonal networks, ${Object.values(out).reduce((n, pl) => n + Object.values(pl).reduce((m, z) => m + Object.keys(z).length, 0), 0)} zones; tariff-documented zones ${documented}, rule agrees on ${documentedAgree}`);
  if (opts.dryRun) return;
  writeJson(join(novaDir, 'network-zones.json'), file);
  writeFileSync(join(novaDir, 'NETWORK-ZONES.md'), md.join('\n'));
}

export async function runDerived(opts: DeriveOptions & { only?: string[] }): Promise<void> {
  const only = opts.only ?? ['ladders', 'network-zones'];
  if (only.includes('ladders')) await deriveLadders(opts);
  if (only.includes('network-zones')) await deriveNetworkZones(opts);
}

// Run alone.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');
  for (const s of only ?? []) if (s !== 'ladders' && s !== 'network-zones') throw new Error(`unknown step "${s}" (ladders, network-zones)`);
  const log = (s: string) => console.log(s);
  const sparql = createSparql(join(here, 'cache', 'pages'), { log });
  runDerived({ sparql, today: new Date().toISOString().slice(0, 10), log, only, dryRun: args.includes('--dry-run') }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
