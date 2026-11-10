/**
 * Golden commutes: posts a fixed set of realistic commutes to the API, sanity-checks the results,
 * diffs them against expected.json and writes REPORT.md.
 *
 *   pnpm tsx tools/golden/run.ts [--update] [--only=name,name] [--api=http://127.0.0.1:8787]
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommuteOption, CommuteRequest, CompareResult, OptionKind, PricedProduct } from '../../packages/engine/src/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const UPDATE = args.includes('--update');
const ONLY = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const API = args.find((a) => a.startsWith('--api='))?.slice(6) ?? process.env.PENDULAR_API ?? 'http://127.0.0.1:8787';

type Meta = { name: string; variantOf?: string; variant?: string; expectTransit?: boolean };
type Commute = CommuteRequest & Meta;
const commutes: Commute[] = JSON.parse(readFileSync(join(here, 'commutes.json'), 'utf8'));

interface KindSnap {
  count: number;
  bestDurationMin: number;
  cheapestYearly: number;
  cheapestProduct: string | null;
  zones?: number;
  tariffKm?: number;
}
type Snapshot = Partial<Record<OptionKind, KindSnap>>;

type Level = 'PASS' | 'WARN' | 'FAIL';
const counts: Record<Level, number> = { PASS: 0, WARN: 0, FAIL: 0 };
const log = (lvl: Level, name: string, msg: string) => {
  counts[lvl]++;
  if (lvl !== 'PASS' || process.env.VERBOSE) console.log(`${lvl} ${name}: ${msg}`);
};
/** Records one named check: PASS when ok, otherwise `lvl` with the message. */
const check = (ok: boolean, name: string, msg: string, lvl: Level = 'FAIL') => log(ok ? 'PASS' : lvl, name, msg);

// ---------------------------------------------------------------------------------------------
const fmt = (n: number) => Math.round(n).toLocaleString('de-CH').replace(/’/g, "'");
const transitOf = (r: CompareResult) => r.options.filter((o) => o.kind === 'transit');
const cheapest = (os: CommuteOption[]) => os.reduce<CommuteOption | undefined>((b, o) => (!b || o.cost.yearly < b.cost.yearly ? o : b), undefined);
const fastest = (os: CommuteOption[]) => os.reduce<CommuteOption | undefined>((b, o) => (!b || o.durationMin < b.durationMin ? o : b), undefined);
const greenest = (os: CommuteOption[]) => os.reduce<CommuteOption | undefined>((b, o) => (!b || o.co2KgPerYear < b.co2KgPerYear ? o : b), undefined);
const minBy = <T,>(xs: T[], f: (x: T) => number) => (xs.length ? Math.min(...xs.map(f)) : undefined);

function snapshot(r: CompareResult): Snapshot {
  const s: Snapshot = {};
  for (const kind of new Set(r.options.map((o) => o.kind))) {
    const os = r.options.filter((o) => o.kind === kind);
    const c = cheapest(os)!;
    const comps = (c.cost.products[0]?.components ?? []).concat(c.cost.extras);
    const zones = comps.map((k) => k.params?.zones).find((z) => typeof z === 'number') as number | undefined;
    const km = comps.map((k) => (k.key.startsWith('car.') ? undefined : k.params?.km)).find((z) => typeof z === 'number') as number | undefined;
    s[kind] = {
      count: os.length,
      bestDurationMin: Math.min(...os.map((o) => o.durationMin)),
      cheapestYearly: Math.round(c.cost.yearly),
      cheapestProduct: c.cost.products[0]?.kind ?? null,
      ...(zones !== undefined ? { zones } : {}),
      ...(km !== undefined ? { tariffKm: km } : {}),
    };
  }
  return s;
}

// ---------------------------------------------------------------------------------------------
async function post(c: Commute): Promise<CompareResult> {
  const { name: _n, variantOf: _v, variant: _vv, expectTransit: _e, ...body } = c;
  const res = await fetch(`${API}/api/compare`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as CompareResult;
}

function sanity(c: Commute, r: CompareResult) {
  const n = c.name;
  const ids = new Set(r.options.map((o) => o.id));
  const car = r.options.find((o) => o.kind === 'car');
  check(!!car, n, 'a car option exists');
  const tr = transitOf(r);
  if (c.expectTransit) check(tr.length > 0, n, 'at least one transit option exists');

  for (const o of r.options) {
    const w = `${n} [${o.id}]`;
    check(o.durationMin >= 1 && o.durationMin <= 300, w, `duration ${o.durationMin} min within 1..300`);
    check(o.cost.yearly >= 0 && o.cost.yearly < 60000, w, `yearly cost ${fmt(o.cost.yearly)} within 0..60'000`);
    check(!/START|END/.test(o.title), w, `title "${o.title}" has no START/END placeholder`);
    const ps = o.cost.products;
    const sorted = ps.every((p, i) => i === 0 || ps[i - 1]!.yearly <= p.yearly);
    check(sorted, w, `products sorted cheapest first (${ps.map((p) => `${p.kind}:${Math.round(p.yearly)}`).join(', ')})`);
    const ga = ps.find((p) => p.kind === 'ga');
    if (ps.length && ga) check(ps[0]!.yearly <= ga.yearly * 1.05, w, `cheapest product ${Math.round(ps[0]!.yearly)} <= GA ${Math.round(ga.yearly)} x1.05`);
    else if (ps.length) log('WARN', w, 'product list has no GA alternative');
    if (o.kind === 'transit') check(o.cost.yearly <= (ga?.yearly ?? Infinity) * 1.05, w, `transit yearly ${Math.round(o.cost.yearly)} <= GA x1.05`);
  }
  if (car) {
    const best = greenest(tr);
    if (best) check(car.co2KgPerYear > best.co2KgPerYear, n, `car CO2 ${Math.round(car.co2KgPerYear)} > best transit ${Math.round(best.co2KgPerYear)} kg/yr`);
  }
  for (const k of ['cheapest', 'fastest', 'greenest'] as const) {
    const id = r.verdict[k];
    if (id !== undefined) check(ids.has(id), n, `verdict.${k} "${id}" is among the options`);
  }
  for (const id of Object.keys(r.verdict.costPerHourSaved)) check(ids.has(id), n, `verdict.costPerHourSaved id "${id}" is among the options`);
  const lo = r.leftOut.filter((l) => !l.code);
  check(lo.length === 0, n, `every left-out entry has a code (${lo.length} without)`);
  // verdict consistency (soft)
  const vc = r.verdict.cheapest && r.options.find((o) => o.id === r.verdict.cheapest);
  const tc = cheapest(r.options);
  if (vc && tc) check(vc.cost.yearly <= tc.cost.yearly + 1, n, `verdict.cheapest (${Math.round(vc.cost.yearly)}) is the cheapest option (${Math.round(tc.cost.yearly)})`, 'WARN');
  const vf = r.verdict.fastest && r.options.find((o) => o.id === r.verdict.fastest);
  const tf = fastest(r.options);
  if (vf && tf) check(vf.durationMin <= tf.durationMin, n, `verdict.fastest (${vf.durationMin}) is the fastest option (${tf.durationMin})`, 'WARN');
}

/** Cross-commute checks between a variant and its base commute. */
function relations(c: Commute, r: CompareResult, results: Map<string, CompareResult>) {
  if (!c.variantOf) return;
  const base = results.get(c.variantOf);
  if (!base) return;
  const n = c.name;
  const perKind = (res: CompareResult, k: OptionKind) => minBy(res.options.filter((o) => o.kind === k), (o) => o.cost.yearly);
  const kinds = [...new Set(base.options.map((o) => o.kind))].filter((k) => r.options.some((o) => o.kind === k));
  const prod = (o: CommuteOption, kind: PricedProduct['kind']) => o.cost.products.find((p) => p.kind === kind)?.yearly;

  if (c.variant === 'first-class') {
    for (const k of kinds.filter((k) => k !== 'car')) {
      const a = perKind(r, k)!, b = perKind(base, k)!;
      check(a >= b - 1, n, `1st class ${k} ${Math.round(a)} >= 2nd class ${Math.round(b)}`);
    }
  }
  if (c.variant === 'youth' || c.variant === 'senior') {
    let compared = 0;
    for (const o of transitOf(r)) {
      const bo = transitOf(base).find((x) => x.title === o.title);
      const a = prod(o, 'zonePassYearly'), b = bo && prod(bo, 'zonePassYearly');
      if (a !== undefined && b !== undefined) {
        compared++;
        check(a <= b + 1, `${n} [${o.title}]`, `${c.variant} annual Mobilis pass ${Math.round(a)} <= adult ${Math.round(b)}`);
      }
    }
    if (!compared) {
      const a = minBy(transitOf(r).flatMap((o) => o.cost.products.filter((p) => p.kind === 'zonePassYearly')), (p) => p.yearly);
      const b = minBy(transitOf(base).flatMap((o) => o.cost.products.filter((p) => p.kind === 'zonePassYearly')), (p) => p.yearly);
      if (a !== undefined && b !== undefined) check(a <= b + 1, n, `${c.variant} cheapest annual Mobilis pass ${Math.round(a)} <= adult ${Math.round(b)}`);
      else log('WARN', n, 'no annual Mobilis pass to compare with the adult one');
    }
  }
  if (c.variant === 'halffare') {
    for (const k of kinds) {
      const a = perKind(r, k)!, b = perKind(base, k)!;
      check(a <= b + 1, n, `Half Fare holder ${k} ${Math.round(a)} <= non-holder ${Math.round(b)}`);
    }
  }
  if (c.variant === 'part-time-2d') {
    for (const k of kinds) {
      const a = perKind(r, k)!, b = perKind(base, k)!;
      check(a <= b * 1.005 + 1, n, `part-timer ${k} ${Math.round(a)} <= full-timer ${Math.round(b)}`);
    }
  }
}

// ---------------------------------------------------------------------------------------------
function diff(name: string, cur: Snapshot, exp: Snapshot) {
  for (const k of Object.keys(exp) as OptionKind[]) {
    const e = exp[k]!, c = cur[k];
    if (!c) {
      log('FAIL', name, `option kind ${k} disappeared (was ${e.count})`);
      continue;
    }
    const w = `${name}/${k}`;
    if (c.count !== e.count) log('WARN', w, `count ${e.count} -> ${c.count}`);
    if (Math.abs(c.bestDurationMin - e.bestDurationMin) > 3) log('WARN', w, `best duration ${e.bestDurationMin} -> ${c.bestDurationMin} min`);
    if (Math.abs(c.cheapestYearly - e.cheapestYearly) > Math.max(1, e.cheapestYearly * 0.02)) log('WARN', w, `cheapest yearly ${e.cheapestYearly} -> ${c.cheapestYearly}`);
    if (c.cheapestProduct !== e.cheapestProduct) log('WARN', w, `cheapest product ${e.cheapestProduct} -> ${c.cheapestProduct}`);
    if (c.zones !== e.zones) log('WARN', w, `zones ${e.zones ?? '-'} -> ${c.zones ?? '-'}`);
    if (c.tariffKm !== e.tariffKm && Math.abs((c.tariffKm ?? 0) - (e.tariffKm ?? 0)) > 1) log('WARN', w, `tariff km ${e.tariffKm ?? '-'} -> ${c.tariffKm ?? '-'}`);
  }
  for (const k of Object.keys(cur) as OptionKind[]) if (!exp[k]) log('WARN', name, `new option kind ${k} (${cur[k]!.count})`);
}

// ---------------------------------------------------------------------------------------------
const row = (o: CommuteOption | undefined) => (o ? `${o.title} (${fmt(o.cost.yearly)} CHF, ${o.durationMin} min)` : '-');
const cell = (s: string) => s.replace(/\|/g, '/');

function autoFlags(c: Commute, r: CompareResult): string[] {
  const f: string[] = [];
  const hasKm = (o: CommuteOption) => Object.values(o.kmByMode).reduce((a, b) => a + (b ?? 0), 0);
  for (const o of r.options) {
    const km = hasKm(o);
    if (o.kind === 'ebike' && km > 20) f.push(`${o.kind} "${o.title}" offered for ${km.toFixed(0)} km (${o.durationMin} min)`);
    if (o.kind === 'bike' && km > 25) f.push(`${o.kind} "${o.title}" offered for ${km.toFixed(0)} km`);
    if (o.kind === 'walk' && km > 6) f.push(`walk offered for ${km.toFixed(0)} km`);
    if (o.cost.products.length && o.kind !== 'car') {
      for (const p of o.cost.products.slice(0, 1)) {
        const z = p.components.map((x) => x.params?.zones).find((x) => typeof x === 'number');
        if (typeof z === 'number' && (z >= 8 || z === 1) && c.work.lat < 46.7) f.push(`${o.id} "${o.title}": ${z} zone(s) (${p.kind}, ${fmt(p.yearly)} CHF)`);
      }
    }
    if (o.kind === 'parkRail' || o.kind === 'cityParkRide') {
      const tr = cheapest(transitOf(r));
      if (tr && o.cost.yearly > tr.cost.yearly * 2) f.push(`${o.kind} "${o.title}" costs ${fmt(o.cost.yearly)} vs transit ${fmt(tr.cost.yearly)}`);
    }
  }
  return f;
}

async function main() {
  mkdirSync(join(here, 'out'), { recursive: true });
  const expPath = join(here, 'expected.json');
  const expected: Record<string, Snapshot> = existsSync(expPath) ? JSON.parse(readFileSync(expPath, 'utf8')) : {};
  const list = ONLY ? commutes.filter((c) => ONLY.includes(c.name)) : commutes;
  const results = new Map<string, CompareResult>();
  const snaps: Record<string, Snapshot> = UPDATE && ONLY ? { ...expected } : {};

  for (const c of list) {
    process.stdout.write(`... ${c.name}\r`);
    let r: CompareResult;
    try {
      r = await post(c);
    } catch (e) {
      log('FAIL', c.name, `request failed: ${(e as Error).message}`);
      continue;
    }
    results.set(c.name, r);
    writeFileSync(join(here, 'out', `${c.name}.json`), JSON.stringify(r, null, 1));
    sanity(c, r);
    snaps[c.name] = snapshot(r);
    if (!UPDATE) {
      if (expected[c.name]) diff(c.name, snaps[c.name]!, expected[c.name]!);
      else log('WARN', c.name, 'no expected snapshot (run with --update)');
    }
  }
  for (const c of list) {
    const r = results.get(c.name);
    if (r) relations(c, r, results);
  }

  if (UPDATE) {
    writeFileSync(expPath, JSON.stringify(snaps, null, 1) + '\n');
    console.log(`wrote expected.json (${Object.keys(snaps).length} commutes)`);
  }

  // REPORT.md --------------------------------------------------------------------------------
  const L: string[] = [];
  const stamp = [...results.values()][0]?.stamp;
  L.push('# Golden commutes report', '', `Generated ${new Date().toISOString()} against ${API}.`);
  if (stamp) L.push(`Timetable ${stamp.data.timetable ?? '?'}, tariffs ${stamp.data.tariffs ?? '?'}, engine ${stamp.data.engine ?? '?'}, reference day ${stamp.rules.referenceDate}.`);
  L.push('', `Checks: ${counts.PASS} PASS, ${counts.WARN} WARN, ${counts.FAIL} FAIL.`, '');
  L.push('| Commute | Cheapest | Fastest | Greenest | Options | Left out |', '|---|---|---|---|---|---|');
  for (const c of list) {
    const r = results.get(c.name);
    if (!r) {
      L.push(`| ${c.name} | request failed | | | | |`);
      continue;
    }
    const by = (id?: string) => r.options.find((o) => o.id === id);
    const g = by(r.verdict.greenest);
    L.push(`| ${c.name} | ${cell(row(by(r.verdict.cheapest)))} | ${cell(row(by(r.verdict.fastest)))} | ${cell(row(g) + (g ? `, ${fmt(g.co2KgPerYear)} kg CO2` : ''))} | ${r.options.length} (${[...new Set(r.options.map((o) => o.kind))].join(', ')}) | ${r.leftOut.length} |`);
  }
  L.push('', '## Automatic flags (heuristics, may be noise)', '');
  let any = false;
  for (const c of list) {
    const r = results.get(c.name);
    if (!r) continue;
    for (const f of autoFlags(c, r)) {
      L.push(`- **${c.name}**: ${f}`);
      any = true;
    }
  }
  if (!any) L.push('- none');
  const judgement = join(here, 'judgement.md');
  L.push('', existsSync(judgement) ? readFileSync(judgement, 'utf8').trim() : '## Human review\n\n(write tools/golden/judgement.md; it is copied here on every run)');
  L.push('');
  writeFileSync(join(here, 'REPORT.md'), L.join('\n'));

  console.log(`\n${counts.PASS} PASS, ${counts.WARN} WARN, ${counts.FAIL} FAIL`);
  process.exit(counts.FAIL > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
