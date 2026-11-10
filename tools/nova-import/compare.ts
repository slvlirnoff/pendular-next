/**
 * Compares the NOVA snapshot with the data the engine uses today and prints the tables of
 * packages/engine/data/nova/COMPARISON.md (the prose there is written by hand).
 *
 *   pnpm tsx tools/nova-import/compare.ts > tools/nova-import/cache/comparison-tables.md
 *
 * Reads the snapshot and the engine's own files; one cached query fetches stop coordinates
 * (needed to ask the engine's zone index about stops that are not in its table).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZoneIndex, stationKey, type ZoneTable } from '../../packages/engine/src/fares/zones.js';
import { loadNova } from '../../packages/engine/src/fares/nova.js';
import { DIDOK_GRAPH, createSparql } from './sparql.js';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = join(here, '../../packages/engine/data');
const nova = loadNova();
const out: string[] = [];
const p = (s = '') => out.push(s);
const name = (s: string | number) => nova.stopName(String(s)) ?? '?';
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)} %` : '–');

// ------------------------------------------------------------------ (a) stop zones

const table = JSON.parse(readFileSync(join(DATA, 'zones/mobilis-stops.json'), 'utf8')) as ZoneTable;
const vaud = new Set((JSON.parse(readFileSync(join(DATA, 'zones/vaud-stops.json'), 'utf8')) as { stops: string[] }).stops);
const index = createZoneIndex(table, { inNetwork: (id) => vaud.has(id) });
const PLAN = 'mobilis-abo-abo';

const novaStops = new Set<string>();
for (const k of nova.raw.planEdges('mobilis', PLAN).keys()) for (const s of k.split(' ')[0]!.split('-')) novaStops.add(s);
const tableStops = new Map<string, string>();
for (const s of table.stops) if (s.zones?.length) for (const g of s.gtfs ?? []) tableStops.set(stationKey(g.stopId), g.name ?? s.label);

type Verdict = 'same' | 'border' | 'different';
/** same: equal to NOVA's own zones; border: not equal but sharing a zone with them (one side sees a border stop); different: nothing in common. */
function verdict(ours: number[], own: number[], all: number[]): Verdict {
  const a = [...ours].sort((x, y) => x - y).join();
  if (a === own.join()) return 'same';
  // A stop whose edges share no zone has no zone of its own in NOVA: compare with all its zones.
  const ref = own.length ? own : all;
  return ours.some((z) => ref.includes(z)) ? 'border' : 'different';
}
/** Lausanne's zones 11 and 12 are always sold together; a mix-up between them costs nothing. */
const grandLausanne = (ours: number[], own: number[]) => [...ours, ...own].every((z) => z === 11 || z === 12);

const sparql = createSparql(join(here, 'cache/compare-pages'));
const coordRows = (await sparql.paged(
  'didok-coords',
  `SELECT (STRAFTER(STR(?s), "didok/") AS ?id) ?lat ?lon WHERE { GRAPH <${DIDOK_GRAPH}> { ?s a gtfs:Station ; <http://www.w3.org/2003/01/geo/wgs84_pos#lat> ?lat ; <http://www.w3.org/2003/01/geo/wgs84_pos#long> ?lon } } ORDER BY ?s`,
  20000,
)) as [string, string, string][];
const coords = new Map(coordRows.map((r) => [r[0], { lat: Number(r[1]), lon: Number(r[2]) }]));

const both = [...tableStops.keys()].filter((s) => novaStops.has(s)).sort();
const onlyOurs = [...tableStops.keys()].filter((s) => !novaStops.has(s)).sort();
const onlyNova = [...novaStops].filter((s) => !tableStops.has(s)).sort();

const tally = { same: 0, border: 0, different: 0 };
const tallyConfident = { same: 0, border: 0, different: 0, total: 0 };
let harmless = 0;
const rows: { stop: string; ours: number[]; confident: boolean; own: number[]; all: number[]; v: Verdict; harmless: boolean }[] = [];
for (const s of both) {
  const ours = index.zonesOfStop({ stopId: s, name: '', lat: 0, lon: 0 })!;
  const z = nova.stopZones('mobilis', PLAN, s)!;
  const v = verdict(ours.zones, z.own, z.zones);
  tally[v]++;
  if (ours.confident) {
    tallyConfident[v]++;
    tallyConfident.total++;
  }
  const h = v !== 'same' && grandLausanne(ours.zones, z.own);
  if (h) harmless++;
  if (v !== 'same') rows.push({ stop: s, ours: ours.zones, confident: ours.confident, own: z.own, all: z.zones, v, harmless: h });
}

p('## (a) Stop zones: our table against NOVA');
p();
p(`Plan compared: \`mobilis/${PLAN}\` (the pass plan; the ticket and connecting-ticket plans carry the same zones on every edge in this snapshot: ${(() => {
  const a = nova.raw.planEdges('mobilis', PLAN);
  let diff = 0;
  for (const other of ['mobilis-billett-billett', 'mobilis-billett-anschlussbillett']) {
    const b = nova.raw.planEdges('mobilis', other);
    for (const [k, z] of a) if (b.get(k)?.join() !== z.join()) diff++;
    for (const k of b.keys()) if (!a.has(k)) diff++;
  }
  return diff === 0 ? 'checked, 0 differences' : `${diff} differences`;
})()}).`);
p();
p('| | Stops |');
p('| --- | ---: |');
p(`| Station numbers in our table (with a zone) | ${tableStops.size} |`);
p(`| Stops on Mobilis edges in NOVA | ${novaStops.size} |`);
p(`| In both | ${both.length} |`);
p(`| Only in our table | ${onlyOurs.length} |`);
p(`| Only in NOVA | ${onlyNova.length} |`);
p();
p('| Verdict for the stops in both | Stops | Share |');
p('| --- | ---: | ---: |');
p(`| same zones as NOVA's own zones of the stop | ${tally.same} | ${pct(tally.same, both.length)} |`);
p(`| overlap (one side lists more zones: a border stop) | ${tally.border} | ${pct(tally.border, both.length)} |`);
p(`| different (no zone in common) | ${tally.different} | ${pct(tally.different, both.length)} |`);
p(`| of the non-identical ones, mix-ups inside Lausanne's zones 11/12 (no effect on the price) | ${harmless} | |`);
p(`| stops our table marks as confident: same / overlap / different | ${tallyConfident.same} / ${tallyConfident.border} / ${tallyConfident.different} of ${tallyConfident.total} | ${pct(tallyConfident.same, tallyConfident.total)} same |`);
p();

// The engine also answers for stops outside its table, from nearby drawn stops.
const eng = { same: 0, border: 0, different: 0, none: 0, noCoord: 0, total: 0 };
const engConf = { same: 0, border: 0, different: 0, total: 0 };
const engWrong: { stop: string; ours: number[]; own: number[]; confident: boolean }[] = [];
for (const s of onlyNova) {
  const c = coords.get(s);
  if (!c) {
    eng.noCoord++;
    continue;
  }
  eng.total++;
  const ours = index.zonesOfStop({ stopId: s, name: name(s), ...c });
  const z = nova.stopZones('mobilis', PLAN, s)!;
  if (!ours) {
    eng.none++;
    continue;
  }
  const v = verdict(ours.zones, z.own, z.zones);
  eng[v]++;
  if (ours.confident) {
    engConf[v]++;
    engConf.total++;
  }
  if (v === 'different' && !grandLausanne(ours.zones, z.own)) engWrong.push({ stop: s, ours: ours.zones, own: z.own.length ? z.own : z.zones, confident: ours.confident });
}
p(`For the ${onlyNova.length} NOVA stops that are not in our table, the engine answers from the stop name or from drawn stops nearby (\`zonesOfStop\`, coordinates from DiDok; ${eng.noCoord} stops have none):`);
p();
p('| Engine answer for stops outside the table | Stops | Share |');
p('| --- | ---: | ---: |');
p(`| same zone | ${eng.same} | ${pct(eng.same, eng.total)} |`);
p(`| overlap | ${eng.border} | ${pct(eng.border, eng.total)} |`);
p(`| different | ${eng.different} | ${pct(eng.different, eng.total)} |`);
p(`| no answer | ${eng.none} | ${pct(eng.none, eng.total)} |`);
p(`| answers the engine itself calls confident: same / overlap / different | ${engConf.same} / ${engConf.border} / ${engConf.different} of ${engConf.total} | ${pct(engConf.same, engConf.total)} same |`);
p();
p('### Disagreements, stops in both (ours ≠ NOVA)');
p();
p('| Stop | Number | Ours | Confident | NOVA own | NOVA all edges | Verdict |');
p('| --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows.sort((x, y) => (x.v === y.v ? name(x.stop).localeCompare(name(y.stop)) : x.v === 'different' ? -1 : 1)))
  p(`| ${name(r.stop)} | ${r.stop} | ${r.ours.join(', ')} | ${r.confident ? 'yes' : 'no'} | ${r.own.join(', ') || '–'} | ${r.all.join(', ')} | ${r.v}${r.harmless ? ' (11/12 only)' : ''} |`);
p();
p(`### Stops only in our table (${onlyOurs.length})`);
p();
p(onlyOurs.map((s) => `${tableStops.get(s)} (${s}${nova.alliancesAt(s).length ? `; NOVA: ${nova.alliancesAt(s).join(', ')}` : ''})`).join('; '));
p();
p(`### Engine guesses with no zone in common, stops outside the table (${engWrong.length}; first 60)`);
p();
p('| Stop | Number | Engine | Confident | NOVA |');
p('| --- | --- | --- | --- | --- |');
for (const r of engWrong.sort((x, y) => name(x.stop).localeCompare(name(y.stop))).slice(0, 60)) p(`| ${name(r.stop)} | ${r.stop} | ${r.ours.join(', ')} | ${r.confident ? 'yes' : 'no'} | ${r.own.join(', ')} |`);
p();

// ------------------------------------------------------------------ (b) Mobilis pass prices

interface Grid {
  validFrom: string;
  passes: Record<string, Record<string, Record<string, Record<string, number>>>>;
}
const grid = JSON.parse(readFileSync(join(DATA, 'tariffs/mobilis-2027.json'), 'utf8')) as Grid;
const entries = nova.zonePriceEntries().sort((a, b) => a.id - b.id);
// Entries of one pay level were created together: consecutive source ids, 15 apart.
const blocks: (typeof entries)[] = [];
for (const e of entries) {
  const last = blocks[blocks.length - 1];
  if (last && e.id - last[last.length - 1]!.id <= 20) last.push(e);
  else blocks.push([e]);
}
const price = (b: typeof entries, cls: number, code: string) => b.find((e) => e.travelClass === cls && e.frequencyCode === code)?.price;
/** Blocks around the three prices SBB quoted for 2026 (7, 9 and all zones: 1989, 2313, 2475). */
function ladder(codeAdult: string, anchors: number[]) {
  const hits = blocks.map((b, i) => (anchors.includes(price(b, 2, `(2.)(ABO)(${codeAdult})`) ?? -1) ? i : -1)).filter((i) => i >= 0);
  if (!hits.length) return [];
  let lo = Math.min(...hits);
  let hi = Math.max(...hits);
  const isFamily = (b: typeof entries) => price(b, 2, `(2.)(ABO)(${codeAdult})`) !== undefined;
  // Extend over neighbouring blocks, stepping over single blocks of other products.
  while (lo > 0 && (isFamily(blocks[lo - 1]!) || (lo > 1 && isFamily(blocks[lo - 2]!)))) lo--;
  while (hi < blocks.length - 1 && (isFamily(blocks[hi + 1]!) || (hi < blocks.length - 2 && isFamily(blocks[hi + 2]!)))) hi++;
  return blocks.slice(lo, hi + 1).filter(isFamily);
}
p('## (b) Mobilis pass prices');
p();
for (const [period, code, anchors, label] of [
  ['year', '40', [1989, 2313, 2475], 'Annual pass'],
  ['month', '41', [], 'Monthly pass'],
] as const) {
  let fam = ladder(`1${code}`, [...anchors]);
  if (period === 'month') {
    // Monthly: the blocks whose adult price is the annual price / 9 of a block found above (Mobilis: year = 9 × month).
    const annual = ladder('140', [1989, 2313, 2475]).map((b) => price(b, 2, '(2.)(ABO)(140)')!);
    const first = blocks.indexOf(ladder('140', [1989, 2313, 2475])[0]!);
    fam = blocks.slice(Math.max(0, first - 60), first + 60).filter((b) => annual.some((a) => price(b, 2, '(2.)(ABO)(141)') === a / 9));
  }
  const sorted = fam.sort((x, y) => price(x, 2, `(2.)(ABO)(1${code})`)! - price(y, 2, `(2.)(ABO)(1${code})`)!);
  const keys = ['3', '4', '5', '6', '7', '8', '9', '10', '11', 'all'];
  p(`### ${label}: NOVA (current tariff year) against our grid (valid from ${grid.validFrom})`);
  p();
  p(`${sorted.length} pay-level blocks found in NOVA${sorted.length === keys.length ? '; ranked by price they are taken to be 3, 4 … 11 zones and all zones' : ' (expected 10: ranking not attempted)'}.`);
  p();
  p('| Zones | Adult 2nd: NOVA | grid | Adult 1st: NOVA | grid | Junior 2nd: NOVA | grid | Senior 2nd: NOVA | grid | Senior 1st: NOVA | grid |');
  p('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  const g = grid.passes[period]!;
  let equal = 0;
  let cells = 0;
  sorted.forEach((b, i) => {
    const k = sorted.length === keys.length ? keys[i]! : '?';
    const cols: [number | undefined, number | undefined][] = [
      [price(b, 2, `(2.)(ABO)(1${code})`), g.adult?.['2']?.[k]],
      [price(b, 1, `(1.)(ABO)(1${code})`), g.adult?.['1']?.[k]],
      [price(b, 2, `(2.)(ABO)(2${code})`), g.junior?.['2']?.[k]],
      [price(b, 2, `(2.)(ABO)(3${code})`), g.senior?.['2']?.[k]],
      [price(b, 1, `(1.)(ABO)(3${code})`), g.senior?.['1']?.[k]],
    ];
    for (const [a, c] of cols) {
      cells++;
      if (a === c) equal++;
    }
    p(`| ${k} | ${cols.map(([a, c]) => `${a ?? '–'} | ${c ?? '–'}`).join(' | ')} |`);
  });
  p();
  p(`${equal} of ${cells} cells equal.`);
  p();
}
// Weak check that needs no ranking: is each value of our grid present at all in NOVA with a fitting code?
p('### Our grid values looked up one by one in NOVA');
p();
p('| Product | Class | Values in our grid | Found in NOVA with the same class and the fitting frequency code |');
p('| --- | --- | ---: | ---: |');
const CODE: Record<string, Record<string, string>> = { year: { adult: '140', junior: '240', senior: '340' }, month: { adult: '141', junior: '241', senior: '341' }, week: { adult: '147', junior: '247', senior: '347' } };
for (const period of ['year', 'month', 'week']) {
  for (const cat of ['adult', 'junior', 'senior']) {
    for (const cls of ['2', '1']) {
      const row = grid.passes[period]?.[cat]?.[cls];
      if (!row) continue;
      const code = `(${cls}.)(ABO)(${CODE[period]![cat]})`;
      const have = new Set(nova.zonePriceEntries({ travelClass: Number(cls) as 1 | 2, frequencyCode: code }).map((e) => e.price));
      const vals = Object.values(row);
      p(`| ${period} ${cat} | ${cls} | ${vals.length} | ${vals.filter((v) => have.has(v)).length} (code ${code}) |`);
    }
  }
}
p();

// ------------------------------------------------------------------ (c) national distance prices

interface National {
  previous: { distanceSingle: { rows: number[][] }; routePass: { rows: number[][]; columns: string[] } };
}
const nat = JSON.parse(readFileSync(join(DATA, 'tariffs/national-2027.json'), 'utf8')) as National;
const tables = nova.priceTables();
p('## (c) National distance prices');
p();
p('| Price table in NOVA | Unit | Prices in NOVA |');
p('| --- | --- | ---: |');
for (const t of tables.filter((t) => /^(T601 011|T650|LEX Preistabelle DV|LEX_DV)/.test(t.label)).sort((a, b) => a.label.localeCompare(b.label))) p(`| ${t.label} | ${t.unit} | ${t.prices} |`);
p(`| all ${tables.filter((t) => t.label.startsWith('T601')).length} tables named T601 … | | ${tables.filter((t) => t.label.startsWith('T601')).reduce((s, t) => s + t.prices, 0)} |`);
p();
const lex = tables.find((t) => t.label === 'LEX Preistabelle DV Abo')!;
const lexPrice = (km: number, cls: 1 | 2, months: number, seg: string) => nova.distancePrice({ table: lex.id, km, travelClass: cls, durationValue: months, durationUnit: 'MONATE', segment: seg })[0]?.price;
let rowsEqual = 0;
let cellsDiff = 0;
const differing: string[] = [];
const rp = nat.previous.routePass.rows;
for (const r of rp) {
  const km = r[1]!;
  const novaRow = [lexPrice(km, 2, 12, 'lex-abo-vollpreis'), lexPrice(km, 1, 12, 'lex-abo-vollpreis'), lexPrice(km, 2, 1, 'lex-abo-vollpreis'), lexPrice(km, 1, 1, 'lex-abo-vollpreis'), lexPrice(km, 2, 12, 'lex-abo-junior'), lexPrice(km, 2, 1, 'lex-abo-junior')];
  const d = novaRow.filter((v, i) => v !== r[2 + i]).length;
  cellsDiff += d;
  if (!d) rowsEqual++;
  else differing.push(`${r[0]}–${r[1]} km: ours ${r.slice(2).join(' / ')}; NOVA ${novaRow.join(' / ')}`);
}
const lexBands = new Set(nova.distancePrice({ table: lex.id, km: 1 }).length ? Array.from({ length: 400 }, (_, i) => nova.distancePrice({ table: lex.id, km: i + 1, travelClass: 2, durationValue: 1, durationUnit: 'MONATE', segment: 'lex-abo-vollpreis' })[0]).filter(Boolean).map((e) => `${e!.from}-${e!.to}`) : []);
const lexMax = Math.max(...[...lexBands].map((b) => Number(b.split('-')[1])));
p(`Route pass (T650): our table has ${rp.length} distance bands (to ${rp[rp.length - 1]![1]} km). "LEX Preistabelle DV Abo" has ${lexBands.size} bands (to ${lexMax} km). Compared on all six columns (adult year/month 2nd and 1st, junior year/month 2nd): **${rowsEqual} of ${rp.length} bands identical, ${cellsDiff} cells differ**.${differing.length ? ` Differing (columns ${nat.previous.routePass.columns.slice(2).join(' / ')}): ${differing.join('; ')}.` : ''}`);
p();
p('| Tariff km | Single 2nd full (ours, T601) | NOVA T601 | Route pass month adult 2nd (ours, T650) | NOVA LEX DV Abo | Route pass year adult 2nd (ours) | NOVA LEX DV Abo |');
p('| ---: | ---: | --- | ---: | ---: | ---: | ---: |');
for (const km of [10, 20, 41, 60, 97, 105]) {
  const s = nat.previous.distanceSingle.rows.find((r) => r[0]! <= km && km <= r[1]!);
  const r = rp.find((x) => x[0]! <= km && km <= x[1]!);
  p(`| ${km} | ${s?.[2]?.toFixed(2) ?? '–'} | no price | ${r?.[4] ?? '–'} | ${lexPrice(km, 2, 1, 'lex-abo-vollpreis') ?? '–'} | ${r?.[2] ?? '–'} | ${lexPrice(km, 2, 12, 'lex-abo-vollpreis') ?? '–'} |`);
}
p();
p('Bands of the LEX table beyond our table:');
p();
p('| km | Adult year 2nd | Adult year 1st | Adult month 2nd | Adult month 1st | Junior year 2nd | Junior month 2nd |');
p('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const b of [...lexBands].filter((b) => Number(b.split('-')[0]) > rp[rp.length - 1]![1]!)) {
  const km = Number(b.split('-')[0]);
  p(`| ${b} | ${lexPrice(km, 2, 12, 'lex-abo-vollpreis')} | ${lexPrice(km, 1, 12, 'lex-abo-vollpreis')} | ${lexPrice(km, 2, 1, 'lex-abo-vollpreis')} | ${lexPrice(km, 1, 1, 'lex-abo-vollpreis')} | ${lexPrice(km, 2, 12, 'lex-abo-junior')} | ${lexPrice(km, 2, 1, 'lex-abo-junior')} |`);
}
p();
p('Tariff kilometres of the test trips (NOVA relations):');
p();
p('| Trip | Stops given | T601 km | T650 km | Effective km | Parts |');
p('| --- | --- | ---: | ---: | ---: | --- |');
for (const [label, seq] of [
  ['Romont FR – Lausanne', ['8504023', '8501120']],
  ['Lausanne – Fribourg – Bern', ['8501120', '8504100', '8507000']],
  ['Yverdon – Payerne – Fribourg – Bern', ['8504200', '8504134', '8504100', '8507000']],
  ['Yverdon – Neuchâtel – Bern', ['8504200', '8504221', '8507000']],
  ['Genève – Genève-Aéroport', ['8501008', '8501026']],
] as [string, string[]][]) {
  const a = nova.tariffKm(seq, 'T601');
  const b = nova.tariffKm(seq, 'T650');
  p(`| ${label} | ${seq.map(name).join(' → ')} | ${a?.km ?? '–'} | ${b?.km ?? '–'} | ${b?.effectiveKm ?? '–'} | ${b?.parts.map((x) => `${name(x.from)}–${name(x.to)} ${x.km} [${x.label}]`).join('; ') ?? ''} |`);
}

console.log(out.join('\n'));
