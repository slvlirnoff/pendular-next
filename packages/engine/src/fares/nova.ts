import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stationKey } from './zones.js';

/**
 * Reader for the NOVA snapshot in data/nova (built by tools/nova-import from the linked-data
 * pilot on lindas.admin.ch): fare-network zones per stop-to-stop edge, tariff kilometres of the
 * national "direct service" per line area, and the few price tables the pilot publishes.
 *
 * Files are JSON Lines: a header object, then one record per line. Sections are read on first
 * use and indexed once.
 */

const DEFAULT_DIR = fileURLToPath(new URL('../../data/nova/', import.meta.url));

/** NOVA's means of transport on an edge. */
export type NovaMode = 'BAHN' | 'BUS' | 'SCHIFF';
/**
 * Family of price tables an area belongs to: the first word of the table name. 'T601' are single
 * tickets, 'T650' route passes; others (LEX, TILO ...) are cross-border offers.
 */
export type NovaTariff = 'T601' | 'T650' | (string & {});
/** What a zoning plan is for, read from its name. */
export type NovaPlanType = 'pass' | 'ticket' | 'connecting' | 'pass+ticket' | 'daypass' | 'city-ticket' | 'modular-pass' | 'short-trip' | 'other';

export interface NovaManifest {
  version: number;
  endpoint: string;
  graphs: string[];
  /** Day of the last import of each section (ISO date). */
  fetched: Record<string, string>;
  files: Record<string, { bytes: number; records: number }>;
  counts: Record<string, number>;
  alliances: Record<string, { label: string; plans: number; zones: number; edges: number; stops: number; fetched: string }>;
  relationFiles: string[];
  warnings: string[];
  /** The import behind the files: requests and network seconds since its page cache was started. */
  lastRun?: { started: string; seconds: number; requests: number; cachedPages: number; retries: number; megabytes: number; sections: string[] };
}

export interface NovaZone {
  code: number;
  label: string;
  /** How many zones this one counts for in the price (2 for a few large zones). */
  factor: number;
  provider: number;
  /** Pay levels tied to this very zone (city zones, modular passes), as "tarif/level". */
  payLevels: string[];
}

export interface NovaPlan {
  alliance: string;
  id: string;
  label: string;
  type: NovaPlanType;
  /** Tarif ids (products) sold on this plan. */
  tarifs: string[];
  zones: NovaZone[];
  edgeCount: number;
}

export interface NovaAlliance {
  id: string;
  label: string;
  plans: NovaPlan[];
}

export interface ZonesForStops {
  /** Zone codes used by the leg, ascending. */
  zones: number[];
  /** Consecutive stops with no edge and no chain of edges between them. */
  missingEdges: [string, string][];
  /** Consecutive stops joined through other stops of the plan (a train that skips stops). */
  bridged: { from: string; to: string; via: string[] }[];
}

export interface TariffKmPart {
  from: string;
  to: string;
  /** Id of the line area (Relationsgebiet) the distance comes from. */
  area: string;
  label: string;
  km: number;
  effectiveKm: number;
  /** KILOMETER: `km` are tariff kilometres to add up; PREIS: `km` is a price step of the operator's own table. */
  unit: 'KILOMETER' | 'PREIS' | (string & {});
  /** Price tables of the area, e.g. "T601 011.00 SBB KILOMETER". */
  tables: string[];
  /** True when the area does not list every stop the vehicle calls at in between. */
  loose?: boolean;
}

export interface TariffKm {
  /** Sum of the tariff values; kilometres only when every part has unit KILOMETER. */
  km: number;
  effectiveKm: number;
  parts: TariffKmPart[];
}

export interface NovaRelation {
  area: string;
  label: string;
  provider: number;
  tables: { id: string; label: string; unit: 'KILOMETER' | 'PREIS' | string }[];
  /** Tariff value: tariff kilometres, or a price step when the table's unit is PREIS. */
  km: number;
  effectiveKm: number;
  priority: number;
}

export interface NovaTarif {
  id: string;
  identifier: string;
  label: string;
  provider: number;
}

export interface NovaPayLevel {
  /** "tarif/level", e.g. "450-zt-72484/stufe-9". */
  id: string;
  tarif: string;
  level: string;
  /** ZONENWERT (by number of zones), ZONENNUMMER (named zones) or STRECKENTYP (short / long / local network). */
  type: string;
  validity?: number;
  validityUnit?: string;
  from?: number;
  to?: number;
  routeType?: string;
  label: string;
  labelFr?: string;
  localNetworks: string[];
}

export interface NovaDistancePrice {
  table: string;
  from: number;
  to: number;
  travelClass: 1 | 2 | 0;
  fahrart?: string;
  duration?: { value: number; unit: string };
  segments: string[];
  price: number;
  currency: string;
}

export interface NovaZonePrice {
  id: number;
  price: number;
  currency: string;
  travelClass: 1 | 2 | 0;
  frequencyCode?: string;
  segments: string[];
}

export interface NovaEdgeInfo {
  mode: NovaMode | string;
  operator: string;
  /** Anwendungsbereich ids: the tariffs that apply on the edge (T601, T650, GA, network tickets ...). */
  applications: string[];
  localNetworks: string[];
}

export interface NovaData {
  dir: string;
  manifest: NovaManifest;
  alliances(): NovaAlliance[];
  /** A plan by id, or the alliance's first plan of a type ('pass', 'ticket', 'connecting' ...). */
  plan(alliance: string, plan: string): NovaPlan | null;
  /** Alliances with an edge at the stop, in any plan. */
  alliancesAt(stop: string): string[];
  /** Zones of the edge between two stops (either order); null when the plan has no such edge. */
  zonesOnEdge(alliance: string, plan: string, a: string, b: string, mode?: NovaMode): number[] | null;
  /** Zones of one vehicle leg, from its ordered stops (board, stops in between, alight). */
  zonesForStops(alliance: string, plan: string, stopSequence: string[], opts?: { mode?: NovaMode; maxHops?: number }): ZonesForStops;
  /** Zones of all edges at the stop; `own` are those every edge at the stop shares. */
  stopZones(alliance: string, plan: string, stop: string): { zones: number[]; own: number[] } | null;
  /** Price-relevant number of zones (a few zones count double). */
  zoneCount(alliance: string, plan: string, zones: number[]): number;
  /** Every relation between two stops, one per line area. */
  relationsBetween(a: string, b: string, tariff?: NovaTariff): NovaRelation[];
  /**
   * Tariff kilometres along a stop sequence: the sequence is cut into the fewest consecutive
   * stretches each covered by one line area, then the smallest sum. Null when a stretch has none.
   * An area that lists every stop in between is preferred over one that does not (another way
   * round); a part from such an area is marked `loose`.
   * Single tickets (T601) and route passes (T650) have their own areas and do not always agree
   * (airport and mountain surcharges count for tickets only): say which one is meant.
   */
  tariffKm(stopSequence: string[], tariff?: NovaTariff): TariffKm | null;
  /** The same between two stops only, chaining areas through shared stations (the route is not known, so this is a lower bound). */
  tariffKmBetween(a: string, b: string, opts?: { tariff?: NovaTariff; maxParts?: number }): TariffKm | null;
  tarif(id: string): NovaTarif | null;
  tarifs(): NovaTarif[];
  payLevels(tarif: string): NovaPayLevel[];
  /** The pay level of a product for a number of zones (levels of type ZONENWERT). */
  payLevelFor(tarif: string, zoneCount: number): NovaPayLevel | null;
  /** Prices of a precalculated distance table. Only a few tables carry prices (see COMPARISON.md). */
  distancePrice(q: { table: string; km: number; travelClass?: 1 | 2; segment?: string; fahrart?: string; durationValue?: number; durationUnit?: string }): NovaDistancePrice[];
  /** Zone price entries. The source does not say which product or zone count an entry belongs to. */
  zonePriceEntries(q?: { travelClass?: 1 | 2; frequencyCode?: string; segment?: string; price?: number }): NovaZonePrice[];
  priceTables(): { id: string; label: string; unit: string; precalculated: boolean; prices: number }[];
  /** Tariffs applying on the edge between two stops, and its local networks. */
  edgeInfo(a: string, b: string): NovaEdgeInfo[];
  /** Short-trip / long-trip / local-network pay levels valid from a to b (directed). */
  shortRoutes(from: string, to: string): { type: string; payLevels: string[] }[];
  stopName(stop: string): string | undefined;
  label(kind: 'awb' | 'localnetwork' | 'segment' | 'provider', id: string | number): string | undefined;
  /** Every stop number used by zones, relations or short routes. */
  usedStops(): Set<number>;
  /** Internal views for the importer's diff. */
  raw: {
    planEdges(alliance: string, plan: string): Map<string, number[]>;
    areas(): { id: string; ids: string[]; label: string; stops: number[]; pairs(): Generator<[number, number, number, number, number]> }[];
    priceCounts(): { distance: number; zone: number };
  };
}

/** Station number of an engine stop id ("8504121:0:1", "Parent8504121"); -1 when it has none. */
export function stopNumber(id: string | number): number {
  if (typeof id === 'number') return id;
  const n = Number(stationKey(id.trim()));
  return Number.isInteger(n) && n > 0 ? n : -1;
}

const pairKey = (a: number, b: number) => (a < b ? a * 1e8 + b : b * 1e8 + a);
const MODES: Record<string, string> = { R: 'BAHN', B: 'BUS', S: 'SCHIFF' };

function readLines(file: string): unknown[] {
  const text = readFileSync(file, 'utf8');
  const out: unknown[] = [];
  let i = 0;
  while (i < text.length) {
    let j = text.indexOf('\n', i);
    if (j < 0) j = text.length;
    if (j > i) out.push(JSON.parse(text.slice(i, j)));
    i = j + 1;
  }
  return out;
}

interface AllianceIndex {
  id: string;
  label: string;
  plans: NovaPlan[];
  ea: number[];
  eb: number[];
  emode: string[];
  eop: string[];
  /** Per plan, per edge: zone codes, or null when the edge is not in the plan. */
  ezones: (number[] | null)[][];
  byPair: Map<number, number[]>;
  /** Per plan: stop → edges of the plan at that stop. */
  byStop: (Map<number, number[]> | undefined)[];
  stops: Set<number>;
}

interface Area {
  id: string;
  ids: string[];
  label: string;
  provider: number;
  tables: string[];
  families: string[];
  units: string[];
  stops: number[];
  tw: number[];
  eff?: number[];
  k?: number[];
  prio: number;
  prioEx?: number[];
  pos?: Map<number, number>;
  kpos?: Map<number, number>;
}

export function loadNova(dir: string = DEFAULT_DIR): NovaData {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as NovaManifest;

  // ---- labels and products (small, read at once)
  const tarifById = new Map<string, NovaTarif>();
  const payLevelsByTarif = new Map<string, NovaPayLevel[]>();
  const labels = { awb: new Map<string, string>(), localnetwork: new Map<string, string>(), segment: new Map<string, string>(), provider: new Map<string, string>() };
  const tables = new Map<string, { id: string; label: string; unit: string; precalculated: boolean; prices: number }>();
  const allianceLabels = new Map<string, string>();
  for (const rec of readLines(join(dir, 'meta.jsonl')).slice(1) as unknown[][]) {
    switch (rec[0]) {
      case 'alliance':
        allianceLabels.set(rec[1] as string, rec[2] as string);
        break;
      case 'tarif':
        tarifById.set(rec[1] as string, { id: rec[1] as string, identifier: rec[2] as string, label: rec[3] as string, provider: rec[4] as number });
        break;
      case 'paylevel': {
        const [, tarif, level, type, validity, validityUnit, from, to, routeType, label, labelFr, lns] = rec as [string, string, string, string, number | null, string | null, number | null, number | null, string | null, string, string | null, string[]];
        const pl: NovaPayLevel = { id: `${tarif}/${level}`, tarif, level, type, label, localNetworks: lns ?? [] };
        if (validity != null) pl.validity = validity;
        if (validityUnit) pl.validityUnit = validityUnit;
        if (from != null) pl.from = from;
        if (to != null) pl.to = to;
        if (routeType) pl.routeType = routeType;
        if (labelFr) pl.labelFr = labelFr;
        let list = payLevelsByTarif.get(tarif);
        if (!list) payLevelsByTarif.set(tarif, (list = []));
        list.push(pl);
        break;
      }
      case 'awb':
      case 'localnetwork':
      case 'segment':
      case 'provider':
        labels[rec[0]].set(String(rec[1]), rec[2] as string);
        break;
      case 'table':
        tables.set(rec[1] as string, { id: rec[1] as string, label: rec[2] as string, unit: rec[3] as string, precalculated: rec[4] === 1, prices: rec[5] as number });
        break;
    }
  }

  // ---- zones, one file per alliance
  const zoneDir = join(dir, 'zones');
  const allianceIds = existsSync(zoneDir)
    ? readdirSync(zoneDir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => f.slice(0, -6))
        .sort()
    : [];
  const allianceCache = new Map<string, AllianceIndex | null>();

  function alliance(id: string): AllianceIndex | null {
    const hit = allianceCache.get(id);
    if (hit !== undefined) return hit;
    if (!allianceIds.includes(id)) {
      allianceCache.set(id, null);
      return null;
    }
    const lines = readLines(join(zoneDir, id + '.jsonl'));
    const head = lines[0] as { label: string };
    const ix: AllianceIndex = { id, label: head.label, plans: [], ea: [], eb: [], emode: [], eop: [], ezones: [], byPair: new Map(), byStop: [], stops: new Set() };
    for (let li = 1; li < lines.length; li++) {
      const rec = lines[li] as unknown[];
      if (rec[0] === 'plan') {
        ix.plans.push({ alliance: id, id: rec[1] as string, label: rec[2] as string, type: rec[3] as NovaPlanType, tarifs: rec[4] as string[], zones: [], edgeCount: 0 });
        ix.ezones.push([]);
      } else if (rec[0] === 'zone') {
        ix.plans[rec[1] as number]!.zones.push({ code: rec[2] as number, label: rec[3] as string, factor: rec[4] as number, provider: rec[5] as number, payLevels: (rec[6] as string[] | undefined) ?? [] });
      } else {
        const e = ix.ea.length;
        const a = rec[0] as number;
        const b = rec[1] as number;
        ix.ea.push(a);
        ix.eb.push(b);
        ix.emode.push(MODES[rec[2] as string] ?? (rec[2] as string));
        ix.eop.push(rec[3] as string);
        const slots: (number[] | null)[] = [];
        for (let p = 0; p < ix.plans.length; p++) {
          const v = rec[4 + p] as number[] | number | null | undefined;
          // A number points at an earlier plan with the same zones.
          const zones = v == null ? null : typeof v === 'number' ? slots[v]! : v;
          slots.push(zones);
          ix.ezones[p]!.push(zones);
          if (zones) ix.plans[p]!.edgeCount++;
        }
        const k = pairKey(a, b);
        const list = ix.byPair.get(k);
        if (list) list.push(e);
        else ix.byPair.set(k, [e]);
        ix.stops.add(a);
        ix.stops.add(b);
      }
    }
    allianceCache.set(id, ix);
    return ix;
  }

  function planIndex(ix: AllianceIndex, plan: string): number {
    let p = ix.plans.findIndex((x) => x.id === plan);
    if (p < 0) p = ix.plans.findIndex((x) => x.type === plan);
    // 'pass' and 'ticket' also match a plan that serves both.
    if (p < 0 && (plan === 'pass' || plan === 'ticket')) p = ix.plans.findIndex((x) => x.type === 'pass+ticket');
    return p;
  }

  function stopEdges(ix: AllianceIndex, p: number): Map<number, number[]> {
    let m = ix.byStop[p];
    if (m) return m;
    m = new Map();
    const ez = ix.ezones[p]!;
    for (let e = 0; e < ez.length; e++) {
      if (!ez[e]) continue;
      for (const s of [ix.ea[e]!, ix.eb[e]!]) {
        const l = m.get(s);
        if (l) l.push(e);
        else m.set(s, [e]);
      }
    }
    ix.byStop[p] = m;
    return m;
  }

  /** The plan's edge between two stops: of the wanted mode if given, else the one with fewest zones. */
  function edgeZones(ix: AllianceIndex, p: number, a: number, b: number, mode?: string): number[] | null {
    const list = ix.byPair.get(pairKey(a, b));
    if (!list) return null;
    let best: number[] | null = null;
    for (const pass of mode ? [mode, undefined] : [undefined]) {
      for (const e of list) {
        const z = ix.ezones[p]![e];
        if (!z || (pass && ix.emode[e] !== pass)) continue;
        if (!best || z.length < best.length) best = z;
      }
      if (best) break;
    }
    return best;
  }

  /** Fewest-edges chain from a to b in the plan (breadth first, bounded); the stops on the way. */
  function chain(ix: AllianceIndex, p: number, a: number, b: number, maxHops: number, mode?: string): number[] | null {
    const adj = stopEdges(ix, p);
    if (!adj.has(a) || !adj.has(b)) return null;
    const prev = new Map<number, number>([[a, -1]]);
    let frontier = [a];
    for (let hop = 0; hop < maxHops && frontier.length; hop++) {
      const next: number[] = [];
      for (const s of frontier) {
        for (const e of adj.get(s) ?? []) {
          if (mode && ix.emode[e] !== mode) continue;
          const t = ix.ea[e] === s ? ix.eb[e]! : ix.ea[e]!;
          if (prev.has(t)) continue;
          prev.set(t, s);
          if (t === b) {
            const path = [b];
            for (let c = s; c !== -1; c = prev.get(c)!) path.push(c);
            return path.reverse();
          }
          next.push(t);
        }
      }
      frontier = next;
    }
    return null;
  }

  const sortedZones = (set: Set<number>) => [...set].sort((x, y) => x - y);

  function zonesForStops(allianceId: string, plan: string, stopSequence: string[], opts: { mode?: NovaMode; maxHops?: number } = {}): ZonesForStops {
    const out: ZonesForStops = { zones: [], missingEdges: [], bridged: [] };
    const ix = alliance(allianceId);
    const p = ix ? planIndex(ix, plan) : -1;
    const seq = stopSequence.map(stopNumber);
    const zones = new Set<number>();
    for (let i = 0; i + 1 < seq.length; i++) {
      const a = seq[i]!;
      const b = seq[i + 1]!;
      if (a === b) continue;
      const direct = ix && p >= 0 ? edgeZones(ix, p, a, b, opts.mode) : null;
      if (direct) {
        for (const z of direct) zones.add(z);
        continue;
      }
      // No edge: the vehicle skips stops that the edges go through. Rail first, when the caller
      // did not say, so that a train is not sent along a bus line.
      let path: number[] | null = null;
      if (ix && p >= 0) {
        const hops = opts.maxHops ?? 30;
        for (const m of opts.mode ? [opts.mode] : ['BAHN', undefined]) {
          path = chain(ix, p, a, b, hops, m);
          if (path) {
            for (let k = 0; k + 1 < path.length; k++) for (const z of edgeZones(ix, p, path[k]!, path[k + 1]!, m) ?? []) zones.add(z);
            break;
          }
        }
      }
      if (path) out.bridged.push({ from: String(a), to: String(b), via: path.slice(1, -1).map(String) });
      else out.missingEdges.push([stopSequence[i]!, stopSequence[i + 1]!]);
    }
    out.zones = sortedZones(zones);
    return out;
  }

  let stopAlliances: Map<number, string[]> | undefined;
  function alliancesAt(stop: string): string[] {
    if (!stopAlliances) {
      stopAlliances = new Map();
      for (const id of allianceIds) {
        for (const s of alliance(id)!.stops) {
          const l = stopAlliances.get(s);
          if (l) l.push(id);
          else stopAlliances.set(s, [id]);
        }
      }
    }
    return stopAlliances.get(stopNumber(stop)) ?? [];
  }

  // ---- relations (tariff kilometres)
  let areas: Area[] | undefined;
  let areasByStop: Map<number, number[]> | undefined;
  function loadAreas(): Area[] {
    if (areas) return areas;
    areas = [];
    areasByStop = new Map();
    for (const f of manifest.relationFiles ?? []) {
      for (const rec of readLines(join(dir, f)).slice(1) as (Omit<Area, 'id' | 'tables'> & { variants: [string, string][] })[]) {
        const tabs = [...new Set(rec.variants.map((v) => v[1]))];
        const a: Area = { ...rec, id: rec.ids[0]!, tables: tabs, families: [...new Set(tabs.map((t) => (tables.get(t)?.label ?? '').split(' ')[0]!))], units: [...new Set(tabs.map((t) => tables.get(t)?.unit ?? ''))] };
        const idx = areas.length;
        areas.push(a);
        for (const s of a.stops) {
          const l = areasByStop.get(s);
          if (l) l.push(idx);
          else areasByStop.set(s, [idx]);
        }
      }
    }
    return areas;
  }

  /** Position of the pair in the area's triangle (stops ascending, rows i < j). */
  const triIndex = (n: number, i: number, j: number) => i * n - (i * (i + 1)) / 2 + (j - i - 1);

  function relIndex(a: Area, s: number, t: number): number {
    if (!a.pos) {
      a.pos = new Map(a.stops.map((x, i) => [x, i]));
      if (a.k) a.kpos = new Map(a.k.map((k, i) => [k, i]));
    }
    const i = a.pos.get(s);
    const j = a.pos.get(t);
    if (i === undefined || j === undefined || i === j) return -1;
    const k = i < j ? triIndex(a.stops.length, i, j) : triIndex(a.stops.length, j, i);
    return a.kpos ? (a.kpos.get(k) ?? -1) : k;
  }

  function prioOf(a: Area, r: number): number {
    if (a.prioEx) for (let i = 0; i < a.prioEx.length; i += 2) if (a.prioEx[i] === r) return a.prioEx[i + 1]!;
    return a.prio;
  }

  const tableInfo = (id: string) => {
    const t = tables.get(id);
    return { id, label: t?.label ?? id, unit: t?.unit ?? '' };
  };

  function relationsBetween(sa: string, sb: string, tariff?: NovaTariff): NovaRelation[] {
    const all = loadAreas();
    const a = stopNumber(sa);
    const b = stopNumber(sb);
    const out: NovaRelation[] = [];
    const other = new Set(areasByStop!.get(b) ?? []);
    for (const ai of areasByStop!.get(a) ?? []) {
      if (!other.has(ai)) continue;
      const area = all[ai]!;
      if (tariff && !area.families.includes(tariff)) continue;
      const r = relIndex(area, a, b);
      if (r < 0) continue;
      out.push({ area: area.id, label: area.label, provider: area.provider, tables: area.tables.map(tableInfo), km: area.tw[r]!, effectiveKm: (area.eff ?? area.tw)[r]!, priority: prioOf(area, r) });
    }
    return out.sort((x, y) => x.km - y.km);
  }

  /** Best single-area relation for a stretch; areas listing every stop in between come first. */
  function stretch(seq: number[], i: number, j: number, tariff?: NovaTariff): { ai: number; r: number; loose: boolean } | null {
    const all = loadAreas();
    const other = new Set(areasByStop!.get(seq[j]!) ?? []);
    let best: { ai: number; r: number; loose: boolean } | null = null;
    for (const ai of areasByStop!.get(seq[i]!) ?? []) {
      if (!other.has(ai)) continue;
      const area = all[ai]!;
      if (tariff && !area.families.includes(tariff)) continue;
      const r = relIndex(area, seq[i]!, seq[j]!);
      if (r < 0) continue;
      let loose = false;
      for (let m = i + 1; m < j && !loose; m++) loose = !area.pos!.has(seq[m]!);
      if (!best || (best.loose && !loose) || (best.loose === loose && area.tw[r]! < all[best.ai]!.tw[best.r]!)) best = { ai, r, loose };
    }
    return best;
  }

  function partOf(from: number, to: number, c: { ai: number; r: number; loose?: boolean }): TariffKmPart {
    const area = areas![c.ai]!;
    const part: TariffKmPart = { from: String(from), to: String(to), area: area.id, label: area.label, km: area.tw[c.r]!, effectiveKm: (area.eff ?? area.tw)[c.r]!, unit: area.units.length === 1 ? area.units[0]! : 'MIXED', tables: area.tables.map((t) => tableInfo(t).label) };
    if (c.loose) part.loose = true;
    return part;
  }

  const total = (parts: TariffKmPart[]): TariffKm => ({ km: parts.reduce((s, x) => s + x.km, 0), effectiveKm: parts.reduce((s, x) => s + x.effectiveKm, 0), parts });

  function tariffKm(stopSequence: string[], tariff?: NovaTariff): TariffKm | null {
    loadAreas();
    const seq: number[] = [];
    for (const s of stopSequence.map(stopNumber)) if (seq[seq.length - 1] !== s) seq.push(s);
    const n = seq.length;
    if (n < 2) return null;
    // best[j], to reach stop j: fewest stretches whose area does not follow the stops given (the
    // distance must be read along the way travelled), then fewest parts, then fewest kilometres.
    const best: ({ loose: number; parts: number; km: number; from: number; c: { ai: number; r: number; loose: boolean } } | null)[] = new Array(n).fill(null);
    for (let j = 1; j < n; j++) {
      for (let i = 0; i < j; i++) {
        const before = i === 0 ? { loose: 0, parts: 0, km: 0 } : best[i];
        if (!before) continue;
        const c = stretch(seq, i, j, tariff);
        if (!c) continue;
        const loose = before.loose + (c.loose ? 1 : 0);
        const parts = before.parts + 1;
        const km = before.km + areas![c.ai]!.tw[c.r]!;
        const cur = best[j];
        if (!cur || loose < cur.loose || (loose === cur.loose && (parts < cur.parts || (parts === cur.parts && km < cur.km)))) best[j] = { loose, parts, km, from: i, c };
      }
    }
    if (!best[n - 1]) return null;
    const parts: TariffKmPart[] = [];
    for (let j = n - 1; j > 0; j = best[j]!.from) parts.push(partOf(seq[best[j]!.from]!, seq[j]!, best[j]!.c));
    return total(parts.reverse());
  }

  function tariffKmBetween(sa: string, sb: string, opts: { tariff?: NovaTariff; maxParts?: number } = {}): TariffKm | null {
    const all = loadAreas();
    const maxParts = opts.maxParts ?? 3;
    const a = stopNumber(sa);
    const b = stopNumber(sb);
    if (a === b || !areasByStop!.has(a) || !areasByStop!.has(b)) return null;
    const best = new Map<number, { parts: number; km: number; prev: number; ai: number; r: number }>([[a, { parts: 0, km: 0, prev: -1, ai: -1, r: -1 }]]);
    let frontier = [a];
    for (let round = 1; round <= maxParts && frontier.length; round++) {
      const next = new Set<number>();
      for (const u of frontier) {
        const base = best.get(u)!;
        for (const ai of areasByStop!.get(u) ?? []) {
          const area = all[ai]!;
          if (opts.tariff && !area.families.includes(opts.tariff)) continue;
          for (const v of area.stops) {
            if (v === u) continue;
            const r = relIndex(area, u, v);
            if (r < 0) continue;
            const km = base.km + area.tw[r]!;
            const cur = best.get(v);
            if (!cur || (cur.parts === round && km < cur.km)) {
              best.set(v, { parts: round, km, prev: u, ai, r });
              next.add(v);
            }
          }
        }
      }
      if (best.has(b)) break;
      frontier = [...next];
    }
    if (!best.has(b)) return null;
    const parts: TariffKmPart[] = [];
    for (let v = b; v !== a; v = best.get(v)!.prev) parts.push(partOf(best.get(v)!.prev, v, best.get(v)!));
    return total(parts.reverse());
  }

  // ---- prices
  let distancePrices: Map<string, NovaDistancePrice[]> | undefined;
  let zonePrices: NovaZonePrice[] | undefined;
  function loadPrices() {
    if (distancePrices) return;
    distancePrices = new Map();
    zonePrices = [];
    const cls = (c: unknown) => (c === 1 || c === 2 ? c : 0);
    for (const rec of readLines(join(dir, 'prices.jsonl')).slice(1) as unknown[][]) {
      if (rec[0] === 'tw') {
        const [, table, from, to, c, fahrart, dv, du, price, currency, ...segs] = rec as [string, string, number, number, number, string | 0, number, string | 0, number, string, ...string[]];
        const e: NovaDistancePrice = { table, from, to, travelClass: cls(c), segments: segs, price, currency };
        if (fahrart) e.fahrart = fahrart;
        if (du) e.duration = { value: dv, unit: du };
        const l = distancePrices.get(table);
        if (l) l.push(e);
        else distancePrices.set(table, [e]);
      } else if (rec[0] === 'zone') {
        const [, id, price, currency, c, freq, ...segs] = rec as [string, number, number, string, number, string | 0, ...string[]];
        const e: NovaZonePrice = { id, price, currency, travelClass: cls(c), segments: segs };
        if (freq) e.frequencyCode = freq;
        zonePrices.push(e);
      }
    }
  }

  // ---- edge attributes and short routes
  let edgeAttrs: Map<number, NovaEdgeInfo[]> | undefined;
  function loadEdges() {
    if (edgeAttrs) return edgeAttrs;
    edgeAttrs = new Map();
    const sets = new Map<string, string[]>();
    for (const rec of readLines(join(dir, 'edges.jsonl')).slice(1) as unknown[][]) {
      if (rec[0] === 'awbSet') {
        sets.set(rec[1] as string, rec[2] as string[]);
        continue;
      }
      const [a, b, m, op, set, ...lns] = rec as [number, number, string, string, string | 0, ...string[]];
      const info: NovaEdgeInfo = { mode: MODES[m] ?? m, operator: op, applications: set ? (sets.get(set) ?? []) : [], localNetworks: lns };
      const k = pairKey(a, b);
      const l = edgeAttrs.get(k);
      if (l) l.push(info);
      else edgeAttrs.set(k, [info]);
    }
    return edgeAttrs;
  }

  let shortByFrom: Map<number, { set: string; to: Set<number> }[]> | undefined;
  const shortSets = new Map<string, { type: string; payLevels: string[] }>();
  function loadShort() {
    if (shortByFrom) return shortByFrom;
    shortByFrom = new Map();
    for (const rec of readLines(join(dir, 'short-routes.jsonl')).slice(1) as unknown[][]) {
      if (rec[0] === 'set') {
        shortSets.set(rec[1] as string, { type: rec[2] as string, payLevels: rec[3] as string[] });
        continue;
      }
      const [set, from, ...to] = rec as [string, number, ...number[]];
      const l = shortByFrom.get(from);
      const e = { set, to: new Set(to) };
      if (l) l.push(e);
      else shortByFrom.set(from, [e]);
    }
    return shortByFrom;
  }

  let stopNames: Map<number, string> | undefined;
  function names() {
    if (!stopNames) stopNames = new Map((readLines(join(dir, 'stops.jsonl')).slice(1) as [number, string][]).map((r) => [r[0], r[1]]));
    return stopNames;
  }

  return {
    dir,
    manifest,
    alliances: () => allianceIds.map((id) => ({ id, label: alliance(id)!.label, plans: alliance(id)!.plans })),
    plan(allianceId, plan) {
      const ix = alliance(allianceId);
      return ix ? (ix.plans[planIndex(ix, plan)] ?? null) : null;
    },
    alliancesAt,
    zonesOnEdge(allianceId, plan, a, b, mode) {
      const ix = alliance(allianceId);
      const p = ix ? planIndex(ix, plan) : -1;
      const z = ix && p >= 0 ? edgeZones(ix, p, stopNumber(a), stopNumber(b), mode) : null;
      return z ? [...z].sort((x, y) => x - y) : null;
    },
    zonesForStops,
    stopZones(allianceId, plan, stop) {
      const ix = alliance(allianceId);
      const p = ix ? planIndex(ix, plan) : -1;
      if (!ix || p < 0) return null;
      const edges = stopEdges(ix, p).get(stopNumber(stop));
      if (!edges?.length) return null;
      const all = new Set<number>();
      let own: Set<number> | null = null;
      for (const e of edges) {
        const z = ix.ezones[p]![e]!;
        if (!z.length) continue;
        for (const x of z) all.add(x);
        own = own ? new Set(z.filter((x) => own!.has(x))) : new Set(z);
      }
      return { zones: sortedZones(all), own: sortedZones(own ?? new Set()) };
    },
    zoneCount(allianceId, plan, zones) {
      const pl = this.plan(allianceId, plan);
      const factor = new Map(pl?.zones.map((z) => [z.code, z.factor]));
      return zones.reduce((s, z) => s + (factor.get(z) ?? 1), 0);
    },
    relationsBetween,
    tariffKm,
    tariffKmBetween,
    tarif: (id) => tarifById.get(id) ?? null,
    tarifs: () => [...tarifById.values()],
    payLevels: (tarif) => payLevelsByTarif.get(tarif) ?? [],
    payLevelFor(tarif, zoneCount) {
      return (payLevelsByTarif.get(tarif) ?? []).find((l) => l.type === 'ZONENWERT' && l.from !== undefined && l.to !== undefined && l.from <= zoneCount && zoneCount <= l.to) ?? null;
    },
    distancePrice(q) {
      loadPrices();
      return (distancePrices!.get(q.table) ?? []).filter(
        (e) =>
          e.from <= q.km &&
          q.km <= e.to &&
          (q.travelClass === undefined || e.travelClass === q.travelClass) &&
          (q.segment === undefined || e.segments.includes(q.segment)) &&
          (q.fahrart === undefined || e.fahrart === q.fahrart) &&
          (q.durationValue === undefined || e.duration?.value === q.durationValue) &&
          (q.durationUnit === undefined || e.duration?.unit === q.durationUnit),
      );
    },
    zonePriceEntries(q = {}) {
      loadPrices();
      return zonePrices!.filter(
        (e) =>
          (q.travelClass === undefined || e.travelClass === q.travelClass) &&
          (q.frequencyCode === undefined || e.frequencyCode === q.frequencyCode) &&
          (q.segment === undefined || e.segments.includes(q.segment)) &&
          (q.price === undefined || e.price === q.price),
      );
    },
    priceTables: () => [...tables.values()],
    edgeInfo: (a, b) => loadEdges().get(pairKey(stopNumber(a), stopNumber(b))) ?? [],
    shortRoutes(from, to) {
      const t = stopNumber(to);
      return (loadShort().get(stopNumber(from)) ?? []).filter((e) => e.to.has(t)).map((e) => shortSets.get(e.set)!);
    },
    stopName: (stop) => names().get(stopNumber(stop)),
    label: (kind, id) => labels[kind].get(String(id)),
    usedStops() {
      const used = new Set<number>();
      for (const id of allianceIds) for (const s of alliance(id)!.stops) used.add(s);
      for (const a of loadAreas()) for (const s of a.stops) used.add(s);
      for (const k of loadEdges().keys()) {
        used.add(Math.floor(k / 1e8));
        used.add(k % 1e8);
      }
      for (const [from, l] of loadShort()) {
        used.add(from);
        for (const e of l) for (const t of e.to) used.add(t);
      }
      return used;
    },
    raw: {
      planEdges(allianceId, plan) {
        const out = new Map<string, number[]>();
        const ix = alliance(allianceId);
        const p = ix ? ix.plans.findIndex((x) => x.id === plan) : -1;
        if (!ix || p < 0) return out;
        const ez = ix.ezones[p]!;
        for (let e = 0; e < ez.length; e++) if (ez[e]) out.set(`${ix.ea[e]}-${ix.eb[e]} ${ix.emode[e]} ${ix.eop[e]}`, ez[e]!);
        return out;
      },
      areas: () =>
        loadAreas().map((a) => ({
          id: a.id,
          ids: a.ids,
          label: a.label,
          stops: a.stops,
          *pairs() {
            const n = a.stops.length;
            if (a.k) {
              // k back to (i, j): walk the rows of the triangle.
              for (let x = 0; x < a.k.length; x++) {
                let k = a.k[x]!;
                let i = 0;
                while (k >= n - i - 1) {
                  k -= n - i - 1;
                  i++;
                }
                yield [a.stops[i]!, a.stops[i + 1 + k]!, a.tw[x]!, (a.eff ?? a.tw)[x]!, prioOf(a, x)];
              }
            } else {
              let r = 0;
              for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++, r++) yield [a.stops[i]!, a.stops[j]!, a.tw[r]!, (a.eff ?? a.tw)[r]!, prioOf(a, r)];
            }
          },
        })),
      priceCounts() {
        loadPrices();
        let d = 0;
        for (const l of distancePrices!.values()) d += l.length;
        return { distance: d, zone: zonePrices!.length };
      },
    },
  };
}
