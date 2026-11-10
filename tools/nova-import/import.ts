/**
 * Periodic import of Swiss fare data from the NOVA linked-data pilot (lindas.admin.ch) into
 * packages/engine/data/nova. Re-runnable; pages are cached under tools/nova-import/cache so an
 * interrupted run resumes. Prints what changed against the snapshot already in the repository.
 *
 *   pnpm tsx tools/nova-import/import.ts [--only=zones,relations,prices] [--alliance=mobilis,frimobil] [--fresh] [--dry-run]
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadNova, type NovaData, type NovaManifest, type NovaPlanType } from '../../packages/engine/src/fares/nova.js';
import { BASE, DIDOK_GRAPH, ENDPOINT, NOVA_GRAPH, createSparql } from './sparql.js';

const here = dirname(fileURLToPath(import.meta.url));
const CACHE = join(here, 'cache');
const PAGES = join(CACHE, 'pages');
const NEXT = join(CACHE, 'next');
const OUT = join(here, '../../packages/engine/data/nova');

const args = process.argv.slice(2);
const arg = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const SECTIONS = ['zones', 'relations', 'prices'] as const;
type Section = (typeof SECTIONS)[number];
const only = (arg('only')?.split(',') ?? [...SECTIONS]) as Section[];
for (const s of only) if (!SECTIONS.includes(s)) throw new Error(`unknown section "${s}" (zones, relations, prices)`);
const onlyAlliances = arg('alliance')?.split(',');
const FRESH = args.includes('--fresh');
const DRY = args.includes('--dry-run');

const log = (s: string) => console.log(s);
const started = new Date();
const today = started.toISOString().slice(0, 10);
const sparql = createSparql(PAGES, { fresh: FRESH, log });
const warnings: string[] = [];
const warn = (s: string) => {
  warnings.push(s);
  log(`  ! ${s}`);
};

const FROM = `FROM <${NOVA_GRAPH}>`;
/** SELECT expression: the part of an IRI after a path segment, e.g. tail('?s', 'didok/'). */
const tail = (v: string, seg: string, as: string) => `(STRAFTER(STR(${v}), "${BASE}${seg}") AS ?${as})`;
const text = (s: string) => s.replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const num = (s: string | undefined) => (s === undefined || s === '' ? null : Number(s));
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const MODE_CODE: Record<string, string> = { BAHN: 'R', BUS: 'B', SCHIFF: 'S' };

/** A JSON Lines file: a header object, then one record per line. */
function writeLines(file: string, header: Record<string, unknown>, records: unknown[]) {
  mkdirSync(dirname(file), { recursive: true });
  const parts = [JSON.stringify(header)];
  for (const r of records) parts.push(JSON.stringify(r));
  writeFileSync(file, parts.join('\n') + '\n');
}

function planType(id: string, label: string): NovaPlanType {
  const s = `${id} ${label}`.toLowerCase();
  if (s.includes('anschluss')) return 'connecting';
  if (s.includes('city-ticket')) return 'city-ticket';
  if (s.includes('modul')) return 'modular-pass';
  if (s.includes('kurzstrecke')) return 'short-trip';
  if (s.includes('tageskarte')) return 'daypass';
  const pass = /\babo\b/.test(s.replace(/-/g, ' '));
  const ticket = /\bbillett?\b/.test(s.replace(/-/g, ' '));
  if (pass && ticket) return 'pass+ticket';
  if (pass) return 'pass';
  if (ticket) return 'ticket';
  return 'other';
}

// ---------------------------------------------------------------------------------- meta

interface PlanMeta {
  alliance: string;
  id: string;
  iri: string;
  label: string;
  tarifs: string[];
  zones: { code: number; label: string; factor: number; provider: number; payLevels: string[] }[];
}

async function labelsByLang(name: string, cls: string, seg: string, prop = 'rdfs:label'): Promise<Map<string, { de?: string; fr?: string; any?: string }>> {
  const rows = await sparql.paged(name, `SELECT ${tail('?s', seg, 'id')} ?l (LANG(?l) AS ?lang) ${FROM} WHERE { ?s a ${cls} ; ${prop} ?l } ORDER BY ?s ?l`, 20000);
  const out = new Map<string, { de?: string; fr?: string; any?: string }>();
  for (const [id, l, lang] of rows as [string, string, string][]) {
    let e = out.get(id);
    if (!e) out.set(id, (e = {}));
    if (lang === 'de') e.de = text(l);
    else if (lang === 'fr') e.fr = text(l);
    else if (lang === '' || !e.any) e.any = text(l);
  }
  return out;
}

async function fetchMeta() {
  log('meta: alliances, plans, zones, products, pay levels, labels');
  const alliances = (await sparql.select('meta-alliances', `SELECT ${tail('?s', 'alliance/', 'id')} ?label ${FROM} WHERE { ?s a otd:Alliance ; rdfs:label ?label } ORDER BY ?s`)) as [string, string][];

  const plans = new Map<string, PlanMeta>();
  for (const [iri, alliance, label] of (await sparql.select(
    'meta-plans',
    `SELECT ${tail('?s', 'zoningplan/', 'id')} ${tail('?a', 'alliance/', 'alliance')} ?label ${FROM} WHERE { ?s a otd:ZoningPlan ; rdfs:label ?label ; otd:alliance ?a } ORDER BY ?s`,
  )) as [string, string, string][]) {
    const [pathAlliance, id] = iri.split('/') as [string, string];
    if (pathAlliance !== alliance) warn(`plan ${iri}: otd:alliance says ${alliance}; filed under ${alliance}`);
    plans.set(iri, { alliance, id: pathAlliance === alliance ? id : iri.replace('/', '--'), iri, label: text(label), tarifs: [], zones: [] });
  }
  for (const [plan, tarif] of (await sparql.select('meta-plan-tarifs', `SELECT ${tail('?s', 'zoningplan/', 'plan')} ${tail('?t', 'tarif/', 'tarif')} ${FROM} WHERE { ?s a otd:ZoningPlan ; otd:tarif ?t } ORDER BY ?s ?t`)) as [string, string][])
    plans.get(plan)?.tarifs.push(tarif);

  const zonePayLevels = new Map<string, string[]>();
  for (const [z, pl] of (await sparql.select('meta-zone-paylevels', `SELECT ${tail('?z', 'zone/', 'zone')} ${tail('?p', 'paylevel/', 'pl')} ${FROM} WHERE { ?z a otd:Zone ; otd:payLevel ?p } ORDER BY ?z ?p`)) as [string, string][]) {
    const l = zonePayLevels.get(z);
    if (l) l.push(pl);
    else zonePayLevels.set(z, [pl]);
  }
  const zoneRows = (await sparql.select(
    'meta-zones',
    `SELECT ${tail('?z', 'zone/', 'zone')} ${tail('?p', 'zoningplan/', 'plan')} ?code ?label ?factor ${tail('?prov', 'provider/', 'provider')} ${FROM}
WHERE { ?z a otd:Zone ; otd:zoningPlan ?p ; schema:identifier ?code ; otd:zoningPriceFactor ?factor ; schema:provider ?prov OPTIONAL { ?z rdfs:label ?label } } ORDER BY ?z`,
  )) as [string, string, string, string, string, string][];
  for (const [z, plan, code, label, factor, provider] of zoneRows) {
    if (!/^\d+$/.test(code)) throw new Error(`zone ${z}: code "${code}" is not a number; the snapshot format assumes numeric zone codes`);
    const p = plans.get(plan);
    if (!p) {
      warn(`zone ${z} belongs to unknown plan ${plan}`);
      continue;
    }
    if (p.zones.some((x) => x.code === Number(code))) warn(`zone code ${code} twice in plan ${plan}`);
    else p.zones.push({ code: Number(code), label: text(label), factor: Number(factor), provider: Number(provider), payLevels: zonePayLevels.get(z) ?? [] });
  }
  for (const p of plans.values()) p.zones.sort((a, b) => a.code - b.code);

  const tarifs = (await sparql.select(
    'meta-tarifs',
    `SELECT ${tail('?t', 'tarif/', 'id')} ?identifier ?label ${tail('?prov', 'provider/', 'provider')} ${FROM} WHERE { ?t a otd:Tarif ; schema:identifier ?identifier ; rdfs:label ?label ; schema:provider ?prov } ORDER BY ?t`,
  )) as [string, string, string, string][];

  const plLabels = await labelsByLang('meta-paylevel-labels', 'otd:PayLevel', 'paylevel/');
  const plNetworks = new Map<string, string[]>();
  for (const [pl, ln] of (await sparql.select('meta-paylevel-networks', `SELECT ${tail('?p', 'paylevel/', 'pl')} ${tail('?n', 'localnetwork/', 'ln')} ${FROM} WHERE { ?p a otd:PayLevel ; otd:localNetwork ?n } ORDER BY ?p ?n`)) as [string, string][]) {
    const l = plNetworks.get(pl);
    if (l) l.push(ln);
    else plNetworks.set(pl, [ln]);
  }
  const payLevels = (await sparql.select(
    'meta-paylevels',
    `SELECT ${tail('?p', 'paylevel/', 'id')} ${tail('?t', 'tarif/', 'tarif')} ?level ?type ?pov ?povUnit ?from ?to ?routeType ${FROM}
WHERE { ?p a otd:PayLevel ; otd:tarif ?t ; otd:payLevel ?level ; otd:payLevelType ?type
  OPTIONAL { ?p otd:periodOfValidity ?pov } OPTIONAL { ?p otd:periodOfValidityUnit ?povUnit }
  OPTIONAL { ?p otd:levelFrom ?from } OPTIONAL { ?p otd:levelTo ?to } OPTIONAL { ?p otd:routeType ?routeType } } ORDER BY ?p`,
  )) as string[][];

  const networks = (await sparql.select(
    'meta-localnetworks',
    `SELECT ${tail('?n', 'localnetwork/', 'id')} ?label ?alliance ${tail('?p', 'zoningplan/', 'plan')} ${FROM} WHERE { ?n a otd:LocalNetwork ; rdfs:label ?label OPTIONAL { ?n otd:alliance ?alliance } OPTIONAL { ?n otd:zoningPlan ?p } } ORDER BY ?n`,
  )) as string[][];
  const awbs = (await sparql.select(
    'meta-awb',
    `SELECT ${tail('?a', 'anwendungsbereich/', 'id')} ?label ?strecke ?tu ${FROM} WHERE { ?a a otd:Anwendungsbereich ; rdfs:label ?label OPTIONAL { ?a otd:streckenAnwendbarkeitsbedingung ?strecke } OPTIONAL { ?a otd:tuAnwendbarkeitsbedingung ?tu } } ORDER BY ?a`,
  )) as string[][];
  const segLabels = await labelsByLang('meta-segment-labels', 'otd:CustomerSegment', 'customersegment/');
  const segments = (await sparql.select(
    'meta-segments',
    `SELECT ${tail('?s', 'customersegment/', 'id')} ?identifier ?minAge ?maxAge ?type ${FROM} WHERE { ?s a otd:CustomerSegment ; schema:identifier ?identifier OPTIONAL { ?s otd:minAge ?minAge } OPTIONAL { ?s otd:maxAge ?maxAge } OPTIONAL { ?s otd:travellerType ?type } } ORDER BY ?s`,
  )) as string[][];
  // Organisations are described in either graph; only those the fare data points at are kept.
  const provRows = (await sparql.paged(
    'meta-providers',
    `SELECT ${tail('?s', 'provider/', 'id')} ?kind ?v (LANG(?v) AS ?lang) WHERE { ?s a schema:Organization . FILTER(STRSTARTS(STR(?s), "${BASE}provider/")) { ?s rdfs:label ?v BIND("label" AS ?kind) } UNION { ?s schema:alternateName ?v BIND("short" AS ?kind) } } ORDER BY ?s ?kind ?v`,
    20000,
  )) as [string, string, string, string][];
  const providers = new Map<string, { label?: string; short?: string }>();
  for (const [id, kind, v, lang] of provRows) {
    let e = providers.get(id);
    if (!e) providers.set(id, (e = {}));
    const k = kind as 'label' | 'short';
    if (lang === 'de' || lang === '' || e[k] === undefined) e[k] = text(v);
  }
  const tables = (await sparql.select(
    'meta-tables',
    `SELECT ${tail('?t', 'preistabelle/', 'id')} ?label ?unit (COUNT(?p) AS ?prices) ${FROM} WHERE { ?t a otd:Preistabelle ; rdfs:label ?label ; otd:anstossTyp ?unit OPTIONAL { ?t otd:preisauspraegung ?p } } GROUP BY ?t ?label ?unit ORDER BY ?t`,
  )) as [string, string, string, string][];
  const precalculated = new Set(((await sparql.select('meta-tables-precalculated', `SELECT ${tail('?t', 'preistabelle/', 'id')} ${FROM} WHERE { ?t a otd:VorberechnetePreistabelle } ORDER BY ?t`)) as [string][]).map((r) => r[0]));

  const usedProviders = new Set<string>();
  const records: unknown[] = [];
  for (const [id, label] of alliances) records.push(['alliance', id, text(label)]);
  for (const [id, identifier, label, provider] of tarifs) {
    records.push(['tarif', id, identifier, text(label), Number(provider)]);
    usedProviders.add(provider);
  }
  for (const [id, tarif, level, type, pov, povUnit, from, to, routeType] of payLevels as [string, string, string, string, string, string, string, string, string][]) {
    const lab = plLabels.get(id) ?? {};
    const levelId = id.startsWith(tarif + '/') ? id.slice(tarif.length + 1) : id;
    const de = lab.de ?? lab.any ?? level;
    records.push(['paylevel', tarif, levelId, type, num(pov), povUnit || null, num(from), num(to), routeType || null, de, lab.fr && lab.fr !== de ? lab.fr : null, plNetworks.get(id) ?? []]);
  }
  for (const [id, label, alliance, plan] of networks) records.push(['localnetwork', id, text(label!), alliance || null, plan || null]);
  for (const [id, label, strecke, tu] of awbs) records.push(['awb', id, text(label!), strecke || null, tu || null]);
  for (const [id, identifier, minAge, maxAge, type] of segments) {
    const lab = segLabels.get(id!) ?? {};
    records.push(['segment', id, lab.de ?? lab.any ?? identifier, identifier, lab.fr ?? null, num(minAge), num(maxAge), type || null]);
  }
  for (const [id, label, unit, prices] of tables) records.push(['table', id, text(label), unit, precalculated.has(id) ? 1 : 0, Number(prices)]);
  for (const p of plans.values()) for (const z of p.zones) usedProviders.add(String(z.provider));
  return { alliances, plans, records, providers, usedProviders, tarifCount: tarifs.length, payLevelCount: payLevels.length };
}

// ---------------------------------------------------------------------------------- zones

async function fetchAlliance(id: string, label: string, plans: PlanMeta[]) {
  // edge key ("a/b/operator/mode/kind" from the IRI) → stops, mode, zones per plan
  const edges = new Map<string, { a: number; b: number; mode: string; op: string; zones: (number[] | null)[] }>();
  for (let p = 0; p < plans.length; p++) {
    const plan = plans[p]!;
    const iri = `<${BASE}zoningplan/${plan.iri}>`;
    const rows = (await sparql.paged(
      `zones-${id}-${plan.id}`,
      `SELECT ${tail('?e', 'transportedge/', 'edge')} ${tail('?sa', 'didok/', 'a')} ${tail('?sb', 'didok/', 'b')} ?mode (GROUP_CONCAT(DISTINCT ?code; separator=" ") AS ?zones) ${FROM}
WHERE { ?e otd:zoningPlan ${iri} ; gtfs:stop ?sa ; gtfs:stop ?sb . FILTER(STR(?sa) < STR(?sb))
  OPTIONAL { ?e otd:meanOfTransport ?mode }
  OPTIONAL { ?e otd:zone ?z . ?z otd:zoningPlan ${iri} ; schema:identifier ?code } }
GROUP BY ?e ?sa ?sb ?mode ORDER BY ?e`,
      10000,
    )) as [string, string, string, string, string][];
    const known = new Set(plan.zones.map((z) => z.code));
    for (const [key, a, b, mode, zs] of rows) {
      let e = edges.get(key);
      if (!e) {
        // The operator is only in the IRI: transportedge/<stop>/<stop>/<operator>/<mode>/<kind>.
        const op = key.split('/')[2] ?? '';
        edges.set(key, (e = { a: Number(a), b: Number(b), mode: MODE_CODE[mode] ?? mode, op, zones: plans.map(() => null) }));
      }
      const zones = zs
        ? zs
            .split(' ')
            .map(Number)
            .sort((x, y) => x - y)
        : [];
      for (const z of zones) if (!known.has(z)) warn(`${id}/${plan.id}: edge ${key} uses zone ${z} that the plan does not list`);
      e.zones[p] = zones;
    }
    log(`  ${id}/${plan.id}: ${rows.length} edges, ${plan.zones.length} zones`);
  }
  const sorted = [...edges.values()].sort((x, y) => x.a - y.a || x.b - y.b || byText(x.mode, y.mode) || byText(x.op, y.op));
  const records: unknown[] = [];
  plans.forEach((p) => records.push(['plan', p.id, p.label, planType(p.id, p.label), p.tarifs]));
  plans.forEach((p, i) => p.zones.forEach((z) => records.push(z.payLevels.length ? ['zone', i, z.code, z.label, z.factor, z.provider, z.payLevels] : ['zone', i, z.code, z.label, z.factor, z.provider])));
  for (const e of sorted) {
    const rec: unknown[] = [e.a, e.b, e.mode, e.op];
    const seen: string[] = [];
    for (const z of e.zones) {
      // Plans of one alliance mostly agree: an identical zone list is written as the index of the plan it repeats.
      const s = z ? z.join() : '\0';
      const same = z ? seen.indexOf(s) : -1;
      rec.push(z === null ? null : same >= 0 ? same : z);
      seen.push(s);
    }
    while (rec[rec.length - 1] === null) rec.pop();
    records.push(rec);
  }
  writeLines(join(NEXT, 'zones', `${id}.jsonl`), { kind: 'nova-zones', alliance: id, label, modes: { R: 'BAHN', B: 'BUS', S: 'SCHIFF' }, edge: '[stopA, stopB, mode, operator, zones per plan: [codes] | index of an earlier plan with the same zones | null (not in plan)]' }, records);
}

async function fetchEdgeAttributes() {
  log('edges: tariffs applying on each edge (Anwendungsbereich), local networks');
  const rows = (await sparql.paged(
    'edges-awb',
    `SELECT ${tail('?e', 'transportedge/', 'edge')} ${tail('?sa', 'didok/', 'a')} ${tail('?sb', 'didok/', 'b')} ?mode (GROUP_CONCAT(DISTINCT STRAFTER(STR(?w), "${BASE}anwendungsbereich/"); separator="|") AS ?awbs) ${FROM}
WHERE { ?e a otd:TransportEdge ; otd:meanOfTransport ?mode ; gtfs:stop ?sa ; gtfs:stop ?sb . FILTER(STR(?sa) < STR(?sb))
  OPTIONAL { ?e otd:anwendungsbereich ?w } }
GROUP BY ?e ?sa ?sb ?mode ORDER BY ?e`,
    10000,
  )) as [string, string, string, string, string][];
  const networks = new Map<string, string[]>();
  for (const [key, ln] of (await sparql.select('edges-localnetworks', `SELECT ${tail('?e', 'transportedge/', 'edge')} ${tail('?n', 'localnetwork/', 'ln')} ${FROM} WHERE { ?e a otd:TransportEdge ; otd:localNetwork ?n } ORDER BY ?e ?n`)) as [string, string][]) {
    const l = networks.get(key);
    if (l) l.push(ln);
    else networks.set(key, [ln]);
  }
  // Edges share a few hundred combinations of tariffs; each combination is stored once under a
  // short hash of its content (stable from run to run, unlike a running number).
  const sets = new Map<string, string[]>();
  const edges: [number, number, string, string, string | 0, ...string[]][] = [];
  for (const [key, a, b, mode, awbs] of rows) {
    let hash: string | 0 = 0;
    if (awbs) {
      const list = awbs.split('|').sort();
      hash = createHash('sha1').update(list.join('|')).digest('hex').slice(0, 7);
      const prev = sets.get(hash);
      if (prev && prev.join('|') !== list.join('|')) throw new Error(`hash collision between Anwendungsbereich sets (${hash})`);
      sets.set(hash, list);
    }
    edges.push([Number(a), Number(b), MODE_CODE[mode] ?? mode, key.split('/')[2] ?? '', hash, ...(networks.get(key) ?? [])]);
  }
  edges.sort((x, y) => x[0] - y[0] || x[1] - y[1] || byText(x[2], y[2]) || byText(x[3], y[3]));
  const records: unknown[] = [...sets.entries()].sort((x, y) => byText(x[0], y[0])).map(([h, list]) => ['awbSet', h, list]);
  for (const e of edges) records.push(e);
  writeLines(join(NEXT, 'edges.jsonl'), { kind: 'nova-edges', edge: '[stopA, stopB, mode, operator, awbSet hash | 0, ...local network ids]' }, records);

  log('short routes: stop pairs sold as short trip / long trip / local network');
  const short = (await sparql.paged(
    'short-routes',
    `SELECT ${tail('?d', 'didok/', 'from')} ${tail('?a', 'didok/', 'to')} ?type (GROUP_CONCAT(DISTINCT STRAFTER(STR(?p), "${BASE}paylevel/"); separator="|") AS ?levels) ${FROM}
WHERE { ?e a otd:TransportEdge ; otd:routeType ?type ; schema:departureStation ?d ; schema:arrivalStation ?a OPTIONAL { ?e otd:payLevel ?p } }
GROUP BY ?e ?d ?a ?type ORDER BY ?e`,
    10000,
  )) as [string, string, string, string][];
  const shortSets = new Map<string, [string, string[]]>();
  const bySetFrom = new Map<string, number[]>();
  for (const [from, to, type, levels] of short) {
    const list = levels ? levels.split('|').sort() : [];
    const hash = createHash('sha1')
      .update(type + '|' + list.join('|'))
      .digest('hex')
      .slice(0, 7);
    shortSets.set(hash, [type, list]);
    const k = `${hash} ${from}`;
    const l = bySetFrom.get(k);
    if (l) l.push(Number(to));
    else bySetFrom.set(k, [Number(to)]);
  }
  const shortRecords: unknown[] = [...shortSets.entries()].sort((x, y) => byText(x[0], y[0])).map(([h, [type, list]]) => ['set', h, type, list]);
  const groups = [...bySetFrom.entries()].map(([k, to]) => {
    const [hash, from] = k.split(' ') as [string, string];
    return [hash, Number(from), ...to.sort((x, y) => x - y)] as [string, number, ...number[]];
  });
  groups.sort((x, y) => x[1] - y[1] || byText(x[0], y[0]));
  for (const g of groups) shortRecords.push(g);
  writeLines(join(NEXT, 'short-routes.jsonl'), { kind: 'nova-short-routes', route: '[set hash, from stop, ...to stops] (directed)' }, shortRecords);
  return { edges: edges.length, shortRoutes: short.length };
}

// ---------------------------------------------------------------------------------- relations

const RELATION_BATCH_ROWS = 20000;
const RELATION_BATCH_AREAS = 120;
const RELATION_FILE_BYTES = 6_000_000;

async function fetchRelations() {
  log('relations: line areas and their tariff kilometres');
  const areaRows = (await sparql.select(
    'rel-areas',
    `SELECT ${tail('?g', 'relationsgebiet/', 'id')} ?label ${tail('?prov', 'provider/', 'provider')} ?klasse ?nummer ?linie ${tail('?t', 'preistabelle/', 'tabelle')} ${FROM}
WHERE { ?g a otd:Relationsgebiet ; rdfs:label ?label ; schema:provider ?prov ; otd:preistabelle ?t OPTIONAL { ?g otd:klassenTyp ?klasse } OPTIONAL { ?g otd:nummer ?nummer } OPTIONAL { ?g otd:linienCode ?linie } } ORDER BY ?g`,
  )) as [string, string, string, string, string, string, string][];
  const pattern = `?r otd:relationsgebiet ?g ; gtfs:stop ?sa ; gtfs:stop ?sb ; otd:tarifwert ?tw ; otd:effektiveKilometer ?ek ; otd:priority ?pr . FILTER(STR(?sa) < STR(?sb))`;
  const counts = (await sparql.select('rel-counts', `SELECT ${tail('?g', 'relationsgebiet/', 'id')} (COUNT(?r) AS ?n) ${FROM} WHERE { ${pattern} } GROUP BY ?g ORDER BY ?g`)) as [string, string][];
  // Areas are fetched a batch at a time: enough areas to fill a page, never part of an area.
  const batches: { ids: string[]; rows: number }[] = [];
  let cur = { ids: [] as string[], rows: 0 };
  for (const [id, n] of counts) {
    if (cur.ids.length && (cur.rows + Number(n) > RELATION_BATCH_ROWS || cur.ids.length >= RELATION_BATCH_AREAS)) {
      batches.push(cur);
      cur = { ids: [], rows: 0 };
    }
    cur.ids.push(id);
    cur.rows += Number(n);
  }
  if (cur.ids.length) batches.push(cur);
  const expected = counts.reduce((s, c) => s + Number(c[1]), 0);
  log(`  ${expected} relations in ${counts.length} areas, ${batches.length} requests`);

  const byArea = new Map<string, [number, number, number, number, number][]>();
  let got = 0;
  for (let i = 0; i < batches.length; i++) {
    const b = batches[i]!;
    const values = b.ids.map((id) => `<${BASE}relationsgebiet/${id}>`).join(' ');
    const rows = (await sparql.select(`rel-batch-${i}`, `SELECT ${tail('?g', 'relationsgebiet/', 'id')} ${tail('?sa', 'didok/', 'a')} ${tail('?sb', 'didok/', 'b')} ?tw ?ek ?pr ${FROM} WHERE { VALUES ?g { ${values} } ${pattern} }`)) as string[][];
    if (rows.length !== b.rows) throw new Error(`relations batch ${i}: expected ${b.rows} rows, got ${rows.length} (answer cut short?)`);
    got += rows.length;
    for (const [g, a, b2, tw, ek, pr] of rows as [string, string, string, string, string, string][]) {
      let l = byArea.get(g);
      if (!l) byArea.set(g, (l = []));
      const x = Number(a);
      const y = Number(b2);
      l.push([Math.min(x, y), Math.max(x, y), Number(tw), Number(ek), Number(pr)]);
    }
    if ((i + 1) % 10 === 0) log(`  ${i + 1}/${batches.length} requests, ${got} relations`);
  }

  // Pack each area: sorted stops, then the values in triangle order (all pairs) or with their
  // position in the triangle (some pairs only).
  interface Packed {
    label: string;
    provider: number;
    content: string;
    body: Record<string, unknown>;
    variants: [string, string, string | null, number | null, string | null][];
    pairs: number;
  }
  const packed = new Map<string, Packed>();
  let duplicatePairs = 0;
  let sourcePairs = 0;
  for (const [id, label, provider, klasse, nummer, linie, table] of areaRows) {
    const rels = byArea.get(id) ?? [];
    sourcePairs += rels.length;
    const stops = [...new Set(rels.flatMap((r) => [r[0], r[1]]))].sort((x, y) => x - y);
    const pos = new Map(stops.map((s, i) => [s, i]));
    const n = stops.length;
    const byK = new Map<number, [number, number, number]>();
    for (const [a, b, tw, ek, pr] of rels) {
      const i = pos.get(a)!;
      const j = pos.get(b)!;
      const k = i * n - (i * (i + 1)) / 2 + (j - i - 1);
      const prev = byK.get(k);
      // The same pair twice in one area: the lower priority number wins, then the lower value.
      if (prev) duplicatePairs++;
      if (!prev || pr < prev[2] || (pr === prev[2] && tw < prev[0])) byK.set(k, [tw, ek, pr]);
    }
    const ks = [...byK.keys()].sort((x, y) => x - y);
    const tw = ks.map((k) => byK.get(k)![0]);
    const eff = ks.map((k) => byK.get(k)![1]);
    const prios = ks.map((k) => byK.get(k)![2]);
    const prioCount = new Map<number, number>();
    for (const p of prios) prioCount.set(p, (prioCount.get(p) ?? 0) + 1);
    const prio = [...prioCount.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0]?.[0] ?? 6;
    const prioEx: number[] = [];
    prios.forEach((p, x) => {
      if (p !== prio) prioEx.push(x, p);
    });
    const body: Record<string, unknown> = { stops, tw };
    if (eff.some((v, x) => v !== tw[x])) body.eff = eff;
    if (ks.length !== (n * (n - 1)) / 2) body.k = ks;
    body.prio = prio;
    if (prioEx.length) body.prioEx = prioEx;
    const content = JSON.stringify([text(label), provider, body]);
    const variant: Packed['variants'][number] = [id, table, klasse || null, num(nummer), linie || null];
    // The same line area exists once per price table (T601 single tickets, T650 passes ...):
    // identical copies are stored once and list every table.
    const prev = packed.get(content);
    if (prev) prev.variants.push(variant);
    else packed.set(content, { label: text(label), provider: Number(provider), content, body, variants: [variant], pairs: ks.length });
  }
  if (duplicatePairs) warn(`relations: ${duplicatePairs} stop pairs appear twice inside one area (kept the one with the lower priority number, then the lower value)`);

  const list = [...packed.values()].sort((x, y) => byText(x.variants[0]![0], y.variants[0]![0]));
  for (const f of existsSync(NEXT) ? readdirSync(NEXT) : []) if (/^relations-\d+\.jsonl$/.test(f)) rmSync(join(NEXT, f));
  const files: string[] = [];
  let part: unknown[] = [];
  let bytes = 0;
  const flush = () => {
    if (!part.length) return;
    const name = `relations-${files.length}.jsonl`;
    writeLines(join(NEXT, name), { kind: 'nova-relations', part: files.length, area: 'stops ascending; tw/eff in triangle order (i<j), or at triangle positions k when only some pairs exist; variants: [area id, price table, class type, number, line code]' }, part);
    files.push(name);
    part = [];
    bytes = 0;
  };
  let keptPairs = 0;
  for (const a of list) {
    const rec = { ids: a.variants.map((v) => v[0]), label: a.label, provider: a.provider, variants: a.variants, ...a.body };
    const size = JSON.stringify(rec).length;
    if (bytes + size > RELATION_FILE_BYTES) flush();
    part.push(rec);
    bytes += size;
    keptPairs += a.pairs;
  }
  flush();
  return { files, sourceAreas: areaRows.length, sourceRelations: sourcePairs, areas: list.length, pairs: keptPairs };
}

// ---------------------------------------------------------------------------------- prices

async function fetchPrices() {
  log('prices: precalculated distance tables, zone price entries');
  const cls = (c: string) => (c === 'KLASSE_1' ? 1 : c === 'KLASSE_2' ? 2 : 0);
  const tw = (await sparql.paged(
    'prices-tarifwert',
    `SELECT ${tail('?t', 'preistabelle/', 'tabelle')} ?von ?bis ?class ?fahrart ?dv ?du ?price ?cur (GROUP_CONCAT(DISTINCT STRAFTER(STR(?seg), "${BASE}customersegment/"); separator="|") AS ?segs) ${FROM}
WHERE { ?t otd:preisauspraegung ?p . ?p schema:price ?price ; otd:tarifWertVon ?von ; otd:tarifWertBis ?bis
  OPTIONAL { ?p schema:priceCurrency ?cur } OPTIONAL { ?p otd:class ?class } OPTIONAL { ?p otd:fahrart ?fahrart }
  OPTIONAL { ?p schema:billingDuration ?d . ?d schema:value ?dv ; schema:unitText ?du } OPTIONAL { ?p otd:customerSegment ?seg } }
GROUP BY ?t ?p ?von ?bis ?class ?fahrart ?dv ?du ?price ?cur ORDER BY ?t ?p`,
    10000,
  )) as string[][];
  const records: unknown[] = [];
  const twRecs = (tw as [string, string, string, string, string, string, string, string, string, string][]).map(([table, von, bis, c, fahrart, dv, du, price, cur, segs]) => ['tw', table, Number(von), Number(bis), cls(c), fahrart || 0, num(dv) ?? 0, du || 0, Number(price), cur || 'CHF', ...(segs ? segs.split('|').sort() : [])]);
  twRecs.sort((x, y) => byText(x[1] as string, y[1] as string) || byText(JSON.stringify(x.slice(4, 8).concat(x.slice(9))), JSON.stringify(y.slice(4, 8).concat(y.slice(9)))) || (x[2] as number) - (y[2] as number));
  records.push(...twRecs);
  const zone = (await sparql.paged(
    'prices-zone',
    `SELECT ${tail('?p', 'zoningpricecharacteristic/', 'id')} ?price ?cur ?class ?freq (GROUP_CONCAT(DISTINCT STRAFTER(STR(?seg), "${BASE}customersegment/"); separator="|") AS ?segs) ${FROM}
WHERE { ?p a otd:ZoningPriceCharacteristic OPTIONAL { ?p schema:price ?price } OPTIONAL { ?p schema:currency ?cur } OPTIONAL { ?p otd:class ?class } OPTIONAL { ?p otd:frequencyCode ?freq } OPTIONAL { ?p otd:customerSegment ?seg } }
GROUP BY ?p ?price ?cur ?class ?freq ORDER BY ?p`,
    10000,
  )) as [string, string, string, string, string, string][];
  let unpriced = 0;
  const zoneRecs: unknown[][] = [];
  for (const [id, price, cur, c, freq, segs] of zone) {
    if (price === '') {
      unpriced++;
      continue;
    }
    zoneRecs.push(['zone', Number(id), Number(price), cur || 'CHF', cls(c), freq || 0, ...(segs ? segs.split('|').sort() : [])]);
  }
  zoneRecs.sort((x, y) => (x[1] as number) - (y[1] as number));
  records.push(...zoneRecs);
  if (unpriced) warn(`prices: ${unpriced} zone price entries without a price were left out`);
  writeLines(
    join(NEXT, 'prices.jsonl'),
    { kind: 'nova-prices', tw: '["tw", price table, value from, value to, class (0 = none), fahrart | 0, duration value, duration unit | 0, price, currency, ...customer segments]', zone: '["zone", source id, price, currency, class, frequency code | 0, ...customer segments]' },
    records,
  );
  return { distancePrices: twRecs.length, zonePrices: zoneRecs.length };
}

// ---------------------------------------------------------------------------------- stops

async function fetchStops(used: Set<number>) {
  log('stops: names from the DiDok graph');
  const rows = (await sparql.paged('stops', `SELECT ${tail('?s', 'didok/', 'id')} ?name WHERE { GRAPH <${DIDOK_GRAPH}> { ?s a gtfs:Station ; schema:name ?name } } ORDER BY ?s ?name`, 20000)) as [string, string][];
  const names = new Map<number, string>();
  for (const [id, name] of rows) if (/^\d+$/.test(id) && !names.has(Number(id))) names.set(Number(id), text(name));
  const records = [...used]
    .sort((x, y) => x - y)
    .filter((s) => names.has(s))
    .map((s) => [s, names.get(s)!]);
  const unnamed = used.size - records.length;
  if (unnamed) warn(`stops: ${unnamed} of ${used.size} stop numbers used by the fare data have no name in the DiDok graph`);
  writeLines(join(NEXT, 'stops.jsonl'), { kind: 'nova-stops', stop: '[number, name]' }, records);
  return records.length;
}

// ---------------------------------------------------------------------------------- diff

function diffSnapshots(old: NovaData | null, next: NovaData): string[] {
  const out: string[] = [];
  if (!old) return ['No previous snapshot: everything is new.'];
  const name = (s: string | number) => `${next.stopName(String(s)) ?? old.stopName(String(s)) ?? '?'} (${s})`;
  const some = (list: string[], max = 8) => list.slice(0, max).join('; ') + (list.length > max ? `; … ${list.length - max} more` : '');

  const oa = new Map(old.alliances().map((a) => [a.id, a]));
  const na = new Map(next.alliances().map((a) => [a.id, a]));
  for (const id of na.keys()) if (!oa.has(id)) out.push(`+ alliance ${id}`);
  for (const id of oa.keys()) if (!na.has(id)) out.push(`- alliance ${id}`);
  for (const [id, a] of na) {
    const before = oa.get(id);
    if (!before) continue;
    const lines: string[] = [];
    const op = new Map(before.plans.map((p) => [p.id, p]));
    for (const p of a.plans) {
      const b = op.get(p.id);
      if (!b) {
        lines.push(`  + plan ${p.id} (${p.edgeCount} edges)`);
        continue;
      }
      const e1 = old.raw.planEdges(id, p.id);
      const e2 = next.raw.planEdges(id, p.id);
      const added: string[] = [];
      const removed: string[] = [];
      const changed: string[] = [];
      const stops1 = new Set<string>();
      const stops2 = new Set<string>();
      const edgeName = (k: string) => {
        const [pair, mode] = k.split(' ') as [string, string];
        const [x, y] = pair.split('-') as [string, string];
        return `${name(x)} – ${name(y)} ${mode}`;
      };
      for (const [k, z] of e2) {
        for (const s of k.split(' ')[0]!.split('-')) stops2.add(s);
        const z1 = e1.get(k);
        if (!z1) added.push(edgeName(k));
        else if (z1.join() !== z.join()) changed.push(`${edgeName(k)}: ${z1.join(',')} → ${z.join(',')}`);
      }
      for (const k of e1.keys()) {
        for (const s of k.split(' ')[0]!.split('-')) stops1.add(s);
        if (!e2.has(k)) removed.push(edgeName(k));
      }
      const z1 = new Set(b.zones.map((z) => z.code));
      const z2 = new Set(p.zones.map((z) => z.code));
      const zAdded = [...z2].filter((z) => !z1.has(z));
      const zRemoved = [...z1].filter((z) => !z2.has(z));
      const sAdded = [...stops2].filter((s) => !stops1.has(s)).map(name);
      const sRemoved = [...stops1].filter((s) => !stops2.has(s)).map(name);
      if (added.length + removed.length + changed.length + zAdded.length + zRemoved.length === 0) continue;
      lines.push(`  plan ${p.id}: edges +${added.length} −${removed.length}, zone changes on ${changed.length} edges, stops +${sAdded.length} −${sRemoved.length}${zAdded.length ? `, new zones ${zAdded.join(',')}` : ''}${zRemoved.length ? `, dropped zones ${zRemoved.join(',')}` : ''}`);
      if (sAdded.length) lines.push(`    stops added: ${some(sAdded)}`);
      if (sRemoved.length) lines.push(`    stops removed: ${some(sRemoved)}`);
      if (changed.length) lines.push(`    zones changed: ${some(changed)}`);
      if (added.length) lines.push(`    edges added: ${some(added, 5)}`);
      if (removed.length) lines.push(`    edges removed: ${some(removed, 5)}`);
    }
    for (const p of before.plans) if (!a.plans.some((x) => x.id === p.id)) lines.push(`  - plan ${p.id}`);
    if (lines.length) out.push(`alliance ${id}:`, ...lines);
  }

  // Relations: compare per area id (each stored area lists the ids of its identical copies).
  const pairMap = (d: NovaData) => {
    const m = new Map<string, { label: string; pairs: Map<string, number> }>();
    for (const a of d.raw.areas()) {
      const pairs = new Map<string, number>();
      for (const [x, y, tw] of a.pairs()) pairs.set(`${x}-${y}`, tw);
      for (const id of a.ids) m.set(id, { label: a.label, pairs });
    }
    return m;
  };
  const r1 = pairMap(old);
  const r2 = pairMap(next);
  const areaAdded = [...r2.keys()].filter((k) => !r1.has(k));
  const areaRemoved = [...r1.keys()].filter((k) => !r2.has(k));
  let pAdded = 0;
  let pRemoved = 0;
  let pChanged = 0;
  const examples: string[] = [];
  const seen = new Set<Map<string, number>>();
  for (const [id, a] of r2) {
    const b = r1.get(id);
    if (!b || seen.has(a.pairs)) continue;
    seen.add(a.pairs);
    for (const [k, tw] of a.pairs) {
      const t1 = b.pairs.get(k);
      if (t1 === undefined) pAdded++;
      else if (t1 !== tw) {
        pChanged++;
        const [x, y] = k.split('-') as [string, string];
        if (examples.length < 12) examples.push(`${name(x)} – ${name(y)} [${a.label}]: ${t1} → ${tw}`);
      }
    }
    for (const k of b.pairs.keys()) if (!a.pairs.has(k)) pRemoved++;
  }
  if (areaAdded.length + areaRemoved.length + pAdded + pRemoved + pChanged)
    out.push(`relations: areas +${areaAdded.length} −${areaRemoved.length}; in areas present before and after: pairs +${pAdded} −${pRemoved}, tariff value changed on ${pChanged}`);
  if (areaAdded.length) out.push(`  areas added: ${some(areaAdded.map((k) => `${r2.get(k)!.label} (${k})`))}`);
  if (areaRemoved.length) out.push(`  areas removed: ${some(areaRemoved.map((k) => `${r1.get(k)!.label} (${k})`))}`);
  if (examples.length) out.push(`  tariff values changed: ${examples.join('; ')}`);

  const t1 = new Set(old.tarifs().map((t) => t.id));
  const t2 = new Set(next.tarifs().map((t) => t.id));
  const tAdded = [...t2].filter((t) => !t1.has(t));
  const tRemoved = [...t1].filter((t) => !t2.has(t));
  if (tAdded.length + tRemoved.length) out.push(`products (tarifs): +${tAdded.length} −${tRemoved.length}${tAdded.length ? `; added: ${some(tAdded)}` : ''}${tRemoved.length ? `; removed: ${some(tRemoved)}` : ''}`);

  const c1 = old.raw.priceCounts();
  const c2 = next.raw.priceCounts();
  const sig = (d: NovaData) => {
    const m = new Map<string, number>();
    for (const e of d.zonePriceEntries()) {
      const k = `${e.travelClass}|${e.frequencyCode ?? ''}|${e.segments.join('+')}|${e.price}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const s1 = sig(old);
  const s2 = sig(next);
  let zpAdded = 0;
  let zpRemoved = 0;
  for (const [k, n] of s2) zpAdded += Math.max(0, n - (s1.get(k) ?? 0));
  for (const [k, n] of s1) zpRemoved += Math.max(0, n - (s2.get(k) ?? 0));
  if (c1.distance !== c2.distance || zpAdded + zpRemoved) out.push(`prices: distance-table entries ${c1.distance} → ${c2.distance}; zone price entries ${c1.zone} → ${c2.zone} (+${zpAdded} −${zpRemoved} by class/code/segment/price)`);
  const tb1 = new Map(old.priceTables().map((t) => [t.id, t]));
  for (const t of next.priceTables()) {
    const b = tb1.get(t.id);
    if (!b) out.push(`  + price table ${t.label} (${t.prices} prices)`);
    else if (b.prices !== t.prices) out.push(`  price table ${t.label}: ${b.prices} → ${t.prices} prices`);
  }

  const u1 = old.usedStops();
  const u2 = next.usedStops();
  const uAdded = [...u2].filter((s) => !u1.has(s));
  const uRemoved = [...u1].filter((s) => !u2.has(s));
  out.push(`stops used by any section: ${u1.size} → ${u2.size} (+${uAdded.length} −${uRemoved.length})`);
  if (out.length === 1) out.unshift('No change in zones, relations, products or prices.');
  return out;
}

// ---------------------------------------------------------------------------------- run

const DATA_FILE = /^(manifest\.json|[a-z0-9-]+\.jsonl)$/;

async function main() {
  const hadOld = existsSync(join(OUT, 'manifest.json'));
  const oldManifest = hadOld ? (JSON.parse(readFileSync(join(OUT, 'manifest.json'), 'utf8')) as NovaManifest) : null;
  if (!hadOld && only.length < SECTIONS.length) throw new Error('no snapshot yet: the first run must import every section');
  if (!hadOld && onlyAlliances) throw new Error('no snapshot yet: the first run must import every alliance');

  // The next snapshot starts as a copy of the current one; imported sections replace their files.
  rmSync(NEXT, { recursive: true, force: true });
  mkdirSync(join(NEXT, 'zones'), { recursive: true });
  if (hadOld) {
    for (const f of readdirSync(OUT)) if (DATA_FILE.test(f)) cpSync(join(OUT, f), join(NEXT, f));
    if (existsSync(join(OUT, 'zones'))) cpSync(join(OUT, 'zones'), join(NEXT, 'zones'), { recursive: true });
  }

  const meta = await fetchMeta();
  const fetched: Record<string, string> = { ...(oldManifest?.fetched ?? {}), meta: today, stops: today };
  const counts: Record<string, number> = { ...(oldManifest?.counts ?? {}), tarifs: meta.tarifCount, payLevels: meta.payLevelCount };
  const allianceFetched: Record<string, string> = Object.fromEntries(Object.entries(oldManifest?.alliances ?? {}).map(([k, v]) => [k, v.fetched]));
  let relationFiles = oldManifest?.relationFiles ?? [];

  if (only.includes('zones')) {
    const wanted = meta.alliances.filter(([id]) => !onlyAlliances || onlyAlliances.includes(id));
    for (const a of onlyAlliances ?? []) if (!meta.alliances.some(([id]) => id === a)) throw new Error(`unknown alliance "${a}"; known: ${meta.alliances.map((x) => x[0]).join(', ')}`);
    log(`zones: ${wanted.length} alliances`);
    for (const [id, label] of wanted) {
      await fetchAlliance(id, text(label), [...meta.plans.values()].filter((p) => p.alliance === id).sort((x, y) => byText(x.id, y.id)));
      allianceFetched[id] = today;
    }
    if (!onlyAlliances) {
      // A full run also drops alliances that no longer exist.
      for (const f of readdirSync(join(NEXT, 'zones'))) if (!meta.alliances.some(([id]) => `${id}.jsonl` === f)) rmSync(join(NEXT, 'zones', f));
    }
    const c = await fetchEdgeAttributes();
    counts.edges = c.edges;
    counts.shortRoutes = c.shortRoutes;
    fetched.zones = today;
  }
  if (only.includes('relations')) {
    const r = await fetchRelations();
    relationFiles = r.files;
    counts.relationAreasSource = r.sourceAreas;
    counts.relationsSource = r.sourceRelations;
    counts.relationAreas = r.areas;
    counts.relationPairs = r.pairs;
    fetched.relations = today;
  }
  if (only.includes('prices')) {
    const p = await fetchPrices();
    counts.distancePrices = p.distancePrices;
    counts.zonePrices = p.zonePrices;
    fetched.prices = today;
  }

  // Labels of organisations, kept only for those the data refers to.
  const draft: NovaManifest = { version: 1, endpoint: ENDPOINT, graphs: [NOVA_GRAPH, DIDOK_GRAPH], fetched, files: {}, counts, alliances: {}, relationFiles, warnings };
  writeFileSync(join(NEXT, 'manifest.json'), JSON.stringify(draft));
  writeLines(join(NEXT, 'meta.jsonl'), { kind: 'nova-meta' }, meta.records);
  if (!existsSync(join(NEXT, 'stops.jsonl'))) writeLines(join(NEXT, 'stops.jsonl'), { kind: 'nova-stops' }, []);
  const providerIds = new Set(meta.usedProviders);
  for (const f of relationFiles) for (const m of readFileSync(join(NEXT, f), 'utf8').matchAll(/"provider":(\d+)/g)) providerIds.add(m[1]!);
  const providerRecords = [...providerIds]
    .sort((x, y) => Number(x) - Number(y))
    .filter((id) => meta.providers.has(id))
    .map((id) => ['provider', Number(id), meta.providers.get(id)!.short ?? meta.providers.get(id)!.label ?? id, meta.providers.get(id)!.label ?? null]);
  writeLines(join(NEXT, 'meta.jsonl'), { kind: 'nova-meta', records: 'alliance, tarif, paylevel, localnetwork, awb, segment, table, provider — see README.md' }, [...meta.records, ...providerRecords]);

  counts.stops = await fetchStops(loadNova(NEXT).usedStops());

  // Manifest: sizes, counts per alliance, what this run did.
  let next = loadNova(NEXT);
  const files: NovaManifest['files'] = {};
  const walk = (dir: string, prefix: string) => {
    for (const f of readdirSync(dir).sort()) {
      const full = join(dir, f);
      if (statSync(full).isDirectory()) walk(full, `${prefix}${f}/`);
      else if (f !== 'manifest.json') files[prefix + f] = { bytes: statSync(full).size, records: readFileSync(full, 'utf8').split('\n').length - 2 };
    }
  };
  walk(NEXT, '');
  const alliances: NovaManifest['alliances'] = {};
  for (const a of next.alliances()) {
    const stops = new Set<string>();
    const edges = new Set<string>();
    for (const p of a.plans)
      for (const k of next.raw.planEdges(a.id, p.id).keys()) {
        edges.add(k);
        for (const s of k.split(' ')[0]!.split('-')) stops.add(s);
      }
    alliances[a.id] = { label: a.label, plans: a.plans.length, zones: Math.max(0, ...a.plans.map((p) => p.zones.length)), edges: edges.size, stops: stops.size, fetched: allianceFetched[a.id] ?? today };
  }
  const seconds = Math.round((Date.now() - started.getTime()) / 1000);
  const manifest: NovaManifest = {
    ...draft,
    files,
    alliances,
    lastRun: {
      started: sparql.stats.run.startedAt,
      // Network time of every request behind this snapshot, including earlier invocations on the same cache.
      seconds: Math.round(sparql.stats.run.fetchMs / 1000),
      requests: sparql.stats.run.requests,
      cachedPages: sparql.stats.cached,
      retries: sparql.stats.retries,
      megabytes: Math.round(sparql.stats.run.bytes / 1e5) / 10,
      // Sections imported on this cache, over all its invocations.
      sections: [...new Set([...(oldManifest?.lastRun?.started === sparql.stats.run.startedAt ? oldManifest.lastRun.sections : []), ...(onlyAlliances ? only.map((s) => (s === 'zones' ? `zones(${onlyAlliances.join(',')})` : s)) : only)])],
    },
  };
  writeFileSync(join(NEXT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');

  // What changed.
  const old = hadOld ? loadNova(OUT) : null;
  next = loadNova(NEXT);
  const diff = diffSnapshots(old, next);
  const totalBytes = Object.values(files).reduce((s, f) => s + f.bytes, 0);
  const summary = [
    `NOVA import ${today}: ${only.join(', ')}${onlyAlliances ? ` (alliances: ${onlyAlliances.join(', ')})` : ''}`,
    `this invocation: ${sparql.stats.live} requests, ${sparql.stats.cached} pages from cache, ${sparql.stats.retries} retries, ${seconds} s; since the cache was started: ${sparql.stats.run.requests} requests, ${manifest.lastRun!.megabytes} MB, ${manifest.lastRun!.seconds} s on the network`,
    `snapshot: ${Object.keys(files).length} files, ${(totalBytes / 1e6).toFixed(1)} MB; largest ${Object.entries(files).sort((x, y) => y[1].bytes - x[1].bytes)[0]?.[0]}`,
    `counts: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`,
    ...(warnings.length ? ['warnings:', ...warnings.slice(0, 30).map((w) => `  ${w}`), ...(warnings.length > 30 ? [`  … ${warnings.length - 30} more (manifest.json)`] : [])] : []),
    '',
    'Changes against the previous snapshot:',
    ...diff,
  ];
  log('\n' + summary.join('\n'));
  writeFileSync(join(CACHE, `diff-${today}.txt`), summary.join('\n') + '\n');

  if (DRY) {
    log(`\n--dry-run: snapshot left in ${NEXT}, repository untouched`);
    return;
  }
  mkdirSync(join(OUT, 'zones'), { recursive: true });
  for (const f of readdirSync(OUT)) if (DATA_FILE.test(f)) rmSync(join(OUT, f));
  rmSync(join(OUT, 'zones'), { recursive: true, force: true });
  for (const f of readdirSync(NEXT)) cpSync(join(NEXT, f), join(OUT, f), { recursive: true });
  log(`\nwritten to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
