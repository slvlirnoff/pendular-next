import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AgeGroup, TravelClass } from '../types.js';
import type { NovaData } from './nova.js';
import mobilisGrid from '../../data/tariffs/mobilis-2027.json' with { type: 'json' };

/**
 * Fare networks priced by zones. One price grid per network, all in the same format, so that a
 * new network is a data file and no code:
 *  - data/tariffs/networks/<alliance>.json: grids transcribed from the published tariff;
 *  - data/nova/price-ladders/<alliance>.json: price ladders read from NOVA (prices of the
 *    current year), used only for networks without a tariff grid;
 *  - data/tariffs/mobilis-2027.json: the Mobilis grid, built in.
 * Which network prices a trip is decided here too (see `createTripResolver`).
 */

/** Timetable year of the tariff grids; a grid of another year is shown as an estimate. */
export const TARIFF_YEAR = 2027;

export type ZoneCount = number | 'all';
export type PassPeriod = 'week' | 'month' | 'year' | 'flexi';
export type PassCategory = 'junior' | 'adult' | 'senior';

/** Prices by zone count: "1", "2" ... and "all". */
type ZoneRow = Readonly<Record<string, number>>;
/** Rows by travel class: "1" and "2". */
type ByClass = Readonly<Record<string, ZoneRow>>;

export interface NetworkDiscount {
  id: string;
  label: string;
  factor?: number;
  /** Sections of the grid the discount is for: "passes.year", "tickets.single", "dayPass" ... */
  appliesTo?: string[];
  ageGroups?: string[];
  condition?: string;
  source?: string;
}

export interface NetworkRules {
  /** Zones always sold together: using one means paying for all of the group. */
  together?: number[][];
  /** Smallest number of zones sold, for passes and for tickets. */
  minZones?: { pass?: number; ticket?: number };
  /** From this count on, the all-zones price applies. */
  allZonesFrom?: number;
  /** 'factor': a few large zones count double (NOVA's factor); 'zones': every zone counts once. */
  countBy?: 'factor' | 'zones';
  text?: string[];
}

/** A grid file, as written by hand from a tariff or by tools/nova-import. Any section may be missing. */
export interface NetworkGrid {
  network: string;
  alliance: string;
  origin?: 'tariff' | 'nova';
  year?: number;
  validFrom?: string | null;
  source?: string;
  currency?: string;
  notes?: string[];
  confidence?: 'validated' | 'consistent' | 'partial';
  passPlan?: string;
  ticketPlan?: string;
  rules?: NetworkRules;
  tickets?: { single?: { full?: ByClass; half?: ByClass } };
  dayPass?: { full?: ByClass; half?: ByClass };
  passes?: Partial<Record<string, Readonly<Record<string, ByClass>>>>;
  ages?: unknown;
  discounts?: NetworkDiscount[];
}

export interface Network {
  alliance: string;
  /** Name shown to people: "Frimobil". */
  label: string;
  /** 'tariff': the published grid; 'nova': prices read from NOVA, of the year in `year`. */
  origin: 'tariff' | 'nova';
  year: number;
  validFrom: string | null;
  source: string;
  /** NOVA zoning plans the zones of passes and of tickets are read from. */
  passPlan?: string;
  ticketPlan?: string;
  rules: { together: number[][]; minZones: { pass: number; ticket: number }; allZonesFrom?: number; countBy: 'factor' | 'zones' };
  discounts: NetworkDiscount[];
  /** Zone count actually paid for: the network's minimum applies. */
  paidZones(zones: number, family: 'pass' | 'ticket'): number;
  /** Single ticket in CHF; null when the grid has none or the zone count is invalid. */
  single(zones: ZoneCount, opts: { travelClass: TravelClass; half: boolean }): number | null;
  dayPass(zones: ZoneCount, opts: { travelClass: TravelClass; half: boolean }): number | null;
  pass(period: PassPeriod, zones: ZoneCount, opts: { category: PassCategory; travelClass: TravelClass }): number | null;
  /** The zone count whose single ticket costs exactly this; null when none or several do. */
  zonesFromSinglePrice(price: number, opts: { travelClass: TravelClass; half: boolean }): ZoneCount | null;
}

/**
 * Pass category for an age group.
 * TODO: the exact age limits differ by network (junior upper bound, senior start); this maps
 * child and youth to junior everywhere, as the Mobilis code always did.
 */
export function passCategory(ageGroup: AgeGroup): PassCategory {
  return ageGroup === 'child' || ageGroup === 'youth' ? 'junior' : ageGroup === 'senior' ? 'senior' : 'adult';
}

const classKey = (c: TravelClass): '1' | '2' => (c === 1 ? '1' : '2');

export function createNetwork(grid: NetworkGrid): Network {
  const min = { pass: Math.max(1, grid.rules?.minZones?.pass ?? 1), ticket: Math.max(1, grid.rules?.minZones?.ticket ?? 1) };
  const allFrom = grid.rules?.allZonesFrom;
  const paidZones = (zones: number, family: 'pass' | 'ticket') => Math.max(zones, min[family]);

  function lookup(row: ZoneRow | undefined, zones: ZoneCount, family: 'pass' | 'ticket'): number | null {
    if (!row) return null;
    if (zones === 'all') return row.all ?? null;
    if (!Number.isInteger(zones) || zones < 1) return null;
    const n = paidZones(zones, family);
    // Beyond the last numbered column (or the count the tariff names), the all-zones price.
    const lastNumbered = Math.max(0, ...Object.keys(row).map(Number).filter((k) => Number.isInteger(k)));
    const key = (allFrom !== undefined && n >= allFrom) || n > lastNumbered ? 'all' : String(n);
    return row[key] ?? null;
  }
  const ticketRow = (family: { full?: ByClass; half?: ByClass } | undefined, opts: { travelClass: TravelClass; half: boolean }) =>
    family?.[opts.half ? 'half' : 'full']?.[classKey(opts.travelClass)];

  return {
    alliance: grid.alliance,
    label: grid.network,
    origin: grid.origin ?? 'tariff',
    year: grid.year ?? TARIFF_YEAR,
    validFrom: grid.validFrom ?? null,
    source: grid.source ?? '',
    passPlan: grid.passPlan,
    ticketPlan: grid.ticketPlan,
    rules: { together: grid.rules?.together ?? [], minZones: min, allZonesFrom: allFrom, countBy: grid.rules?.countBy ?? 'factor' },
    discounts: grid.discounts ?? [],
    paidZones,
    single: (zones, opts) => lookup(ticketRow(grid.tickets?.single, opts), zones, 'ticket'),
    dayPass: (zones, opts) => lookup(ticketRow(grid.dayPass, opts), zones, 'ticket'),
    pass(period, zones, opts) {
      const byCategory = grid.passes?.[period];
      // A network without a price of its own for the young or for seniors sells them the adult pass.
      const classes = byCategory?.[opts.category] ?? byCategory?.adult;
      return lookup(classes?.[classKey(opts.travelClass)], zones, 'pass');
    },
    zonesFromSinglePrice(price, opts) {
      const cents = Math.round(price * 100);
      const matches = Object.entries(ticketRow(grid.tickets?.single, opts) ?? {}).filter(([, p]) => Math.round(p * 100) === cents);
      if (matches.length !== 1) return null;
      const key = matches[0]![0];
      return key === 'all' ? 'all' : Number(key);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The set of networks
// ---------------------------------------------------------------------------------------------

export const MOBILIS = 'mobilis';

/**
 * The Mobilis grid predates the common format: what it does not say is added here.
 * Tickets use the zones of the pass plan too, as they always have.
 */
export const MOBILIS_GRID: NetworkGrid = {
  ...(mobilisGrid as unknown as NetworkGrid),
  alliance: MOBILIS,
  origin: 'tariff',
  year: TARIFF_YEAR,
  passPlan: 'mobilis-abo-abo',
  // Lausanne's zones 11 and 12 ("Grand Lausanne") are always sold together.
  rules: { together: [[11, 12]], countBy: 'factor' },
};

/** Share of a network's stops in each zone that another network also serves (data/nova/network-zones.json). */
export interface OwnZonesFile {
  umbrellas?: string[];
  alliances?: Record<string, Record<string, Record<string, { stops?: number; sharedShare?: number; own?: boolean }>>>;
}

/** Alliances laid over other networks (joint passes): never the network of a trip in this version. */
const isBuiltInUmbrella = (alliance: string) => alliance === 'leman-pass' || alliance.startsWith('z-pass');

export interface Networks {
  /** The network with a price grid for this alliance, if any. */
  get(alliance: string): Network | undefined;
  list(): Network[];
  isUmbrella(alliance: string): boolean;
  ownZones: OwnZonesFile | null;
}

/**
 * Grids in any order: a tariff grid always wins over a NOVA ladder for the same alliance, and
 * the built-in Mobilis grid over any other grid for Mobilis.
 */
export function createNetworks(grids: NetworkGrid[] = [], ownZones: OwnZonesFile | null = null): Networks {
  const byAlliance = new Map<string, Network>([[MOBILIS, createNetwork(MOBILIS_GRID)]]);
  const tariffFirst = [...grids].sort((a, b) => Number((a.origin ?? 'tariff') === 'nova') - Number((b.origin ?? 'tariff') === 'nova'));
  for (const g of tariffFirst) if (g.alliance && !byAlliance.has(g.alliance)) byAlliance.set(g.alliance, createNetwork(g));
  const umbrellas = ownZones?.umbrellas ? new Set(ownZones.umbrellas) : null;
  return {
    get: (alliance) => byAlliance.get(alliance),
    list: () => [...byAlliance.values()],
    isUmbrella: (alliance) => (umbrellas ? umbrellas.has(alliance) : isBuiltInUmbrella(alliance)),
    ownZones,
  };
}

const DATA = resolve(import.meta.dirname, '../../data');

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (e) {
    // A broken data file must not stop the service: the network is then priced as before it had one.
    console.warn(`networks: ${path} skipped (${(e as Error).message})`);
    return null;
  }
}

function readGrids(dir: string, origin: 'tariff' | 'nova'): NetworkGrid[] {
  if (!existsSync(dir)) return [];
  const out: NetworkGrid[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const g = readJson<NetworkGrid>(resolve(dir, f));
    if (!g || typeof g.alliance !== 'string' || typeof g.network !== 'string') continue;
    // The directory says what the file is: a ladder never counts as a tariff grid.
    out.push({ ...g, origin: origin === 'nova' ? 'nova' : (g.origin ?? 'tariff') });
  }
  return out;
}

export interface LoadNetworksOptions {
  tariffDir?: string;
  ladderDir?: string;
  ownZonesPath?: string;
}

/** Reads every grid on disk. Either directory and the own-zones file may be missing. */
export function loadNetworks(opts: LoadNetworksOptions = {}): Networks {
  const ownPath = opts.ownZonesPath ?? resolve(DATA, 'nova/network-zones.json');
  return createNetworks(
    [...readGrids(opts.tariffDir ?? resolve(DATA, 'tariffs/networks'), 'tariff'), ...readGrids(opts.ladderDir ?? resolve(DATA, 'nova/price-ladders'), 'nova')],
    existsSync(ownPath) ? readJson<OwnZonesFile>(ownPath) : null,
  );
}

// ---------------------------------------------------------------------------------------------
// Which network prices a trip
// ---------------------------------------------------------------------------------------------

/** One network that contains the whole trip. */
export interface TripNetwork {
  alliance: string;
  label: string;
  /** The price grid; undefined for a network we have no prices for. */
  network?: Network;
  passPlan: string;
  /** Zones used on the pass plan, with the zones always sold together. */
  zones: number[];
  /** Price-relevant zone counts, before the network's minimum. */
  passCount: number;
  ticketCount: number;
  /** False when a hop had to be joined through stops the vehicle does not call at. */
  exact: boolean;
  notes: string[];
}

export interface TripNetworks {
  /** Every zonal network whose zones cover all legs. */
  candidates: TripNetwork[];
  /** Those that may sell the trip (see `rule`). Not empty when `candidates` is not. */
  eligible: TripNetwork[];
  /**
   * How `eligible` was decided: 'own-zone' (the trip uses a zone that is the network's own),
   * 'exclusive-stop' (no own-zones data: a stop of the trip is in no other network),
   * 'origin-territory' (neither: the network whose zone at the origin is least shared).
   */
  rule: 'own-zone' | 'exclusive-stop' | 'origin-territory' | 'none';
}

export type TripResolver = (stopSequences: string[][]) => TripNetworks;

/**
 * The plan a network's passes (or tickets) are zoned on, when no grid names it: the largest
 * plan of that type, leaving out joint plans with a neighbour and plans of former networks.
 */
function defaultPlan(nova: NovaData, alliance: string, kind: 'pass' | 'ticket'): string | undefined {
  const plans = (nova.alliances().find((a) => a.id === alliance)?.plans ?? [])
    .filter((p) => p.type === kind || p.type === 'pass+ticket')
    .filter((p) => !/kombi|fiktiv|transfrontalier|\bEx[A-Z]/.test(p.label) && (alliance.startsWith('z-pass') || !p.id.startsWith('z-pass')))
    .sort((a, b) => b.edgeCount - a.edgeCount);
  return plans[0]?.id;
}

/**
 * The zoning plans a network's passes and tickets are read from; null for joint passes
 * ("umbrellas") and alliances without a pass plan. The one place that decides it: the trip
 * resolver and the segment exporter (tools/motis-fork) must agree.
 */
export function networkPlans(nova: NovaData, networks: Networks, alliance: string): { pass: string; ticket: string } | null {
  const net = networks.get(alliance);
  const pass = networks.isUmbrella(alliance) ? undefined : (net?.passPlan ?? defaultPlan(nova, alliance, 'pass'));
  // With a grid, tickets are zoned as the grid says (the pass plan when it names no other).
  const ticket = net ? (net.ticketPlan ?? pass) : (defaultPlan(nova, alliance, 'ticket') ?? pass);
  return pass && nova.plan(alliance, pass)?.id === pass ? { pass, ticket: ticket ?? pass } : null;
}

/**
 * Decides which fare network(s) can sell a trip, from the official zone data.
 *
 * Candidates: networks with a pass plan, joint passes ("umbrellas") left out, in which every
 * boarding and alighting stop lies and whose plan has the zones of every hop of every leg.
 *
 * Where networks overlap, a network sells a trip only if the trip uses at least one zone that is
 * its own. The product owner's rule: "Lucens and Moudon you have to take Mobilis and can only
 * take this zone Frimobil in combination with a real Frimobil zone."
 * Which zones are a network's own is in data/nova/network-zones.json. Without that file (or for
 * a network it does not list), a network is eligible when one stop of the trip is in no other
 * zonal network. When that leaves no network, the one whose territory holds the origin is taken:
 * the candidate whose zone at the first stop has the smallest share of stops served by another
 * network too (from the file when it has the zone, else counted on the plan's edges).
 */
export function createTripResolver(nova: NovaData, networks: Networks): TripResolver {
  const plans = new Map<string, { pass: string; ticket: string } | null>();
  /** Pass and ticket plan of a zonal network; null for umbrellas and alliances without a pass plan. */
  function plansOf(alliance: string): { pass: string; ticket: string } | null {
    let hit = plans.get(alliance);
    if (hit === undefined) plans.set(alliance, (hit = networkPlans(nova, networks, alliance)));
    return hit;
  }
  const zonalAt = (stop: string) => nova.alliancesAt(stop).filter((a) => plansOf(a) !== null);

  // Share of the stops of each zone that another zonal network serves too, counted on the edges
  // of the plan. A stop on a border counts in every zone its edges use.
  const shares = new Map<string, Map<number, number>>();
  function countedShares(alliance: string, plan: string): Map<number, number> {
    const key = `${alliance}|${plan}`;
    let hit = shares.get(key);
    if (!hit) {
      const stopsOfZone = new Map<number, Set<string>>();
      for (const [edge, zones] of nova.raw.planEdges(alliance, plan)) {
        const [a, b] = edge.split(' ')[0]!.split('-');
        for (const z of zones) {
          let s = stopsOfZone.get(z);
          if (!s) stopsOfZone.set(z, (s = new Set()));
          s.add(a!).add(b!);
        }
      }
      hit = new Map();
      for (const [z, stops] of stopsOfZone) {
        let shared = 0;
        for (const s of stops) if (zonalAt(s).some((a) => a !== alliance)) shared++;
        hit.set(z, shared / stops.size);
      }
      shares.set(key, hit);
    }
    return hit;
  }
  const sharedShare = (alliance: string, plan: string, zone: number): number =>
    networks.ownZones?.alliances?.[alliance]?.[plan]?.[String(zone)]?.sharedShare ?? countedShares(alliance, plan).get(zone) ?? 1;

  /** Zones of all legs on one plan; null when a hop is not in the plan. */
  function zonesOn(alliance: string, plan: string, seqs: string[][]): { zones: Set<number>; bridged: number } | null {
    const used = new Set<number>();
    let bridged = 0;
    for (const seq of seqs) {
      const z = nova.zonesForStops(alliance, plan, seq);
      if (z.missingEdges.length > 0 || z.zones.length === 0) return null;
      bridged += z.bridged.length;
      for (const x of z.zones) used.add(x);
    }
    return { zones: used, bridged };
  }

  return (seqs) => {
    const none: TripNetworks = { candidates: [], eligible: [], rule: 'none' };
    if (seqs.length === 0 || seqs.some((s) => s.length < 2)) return none;
    const ends = seqs.flatMap((s) => [s[0]!, s[s.length - 1]!]);
    let common = zonalAt(ends[0]!);
    for (const s of ends.slice(1)) {
      const here = nova.alliancesAt(s);
      common = common.filter((a) => here.includes(a));
    }

    const candidates: TripNetwork[] = [];
    const rawZones = new Map<string, number[]>();
    for (const alliance of common) {
      const p = plansOf(alliance)!;
      const onPass = zonesOn(alliance, p.pass, seqs);
      if (!onPass) continue;
      const net = networks.get(alliance);
      const together = net?.rules.together ?? [];
      const count = (plan: string, used: Set<number>): number => {
        for (const group of together) if (group.some((z) => used.has(z))) for (const z of group) used.add(z);
        const zones = [...used].sort((a, b) => a - b);
        return net?.rules.countBy === 'zones' ? zones.length : nova.zoneCount(alliance, plan, zones);
      };
      rawZones.set(alliance, [...onPass.zones]);
      const passCount = count(p.pass, onPass.zones);
      // Tickets on their own plan where the network has one; the pass plan's zones when that plan lacks a hop.
      const onTicket = p.ticket !== p.pass ? zonesOn(alliance, p.ticket, seqs) : null;
      const bridged = onPass.bridged + (onTicket?.bridged ?? 0);
      candidates.push({
        alliance,
        label: net?.label ?? nova.alliances().find((a) => a.id === alliance)?.label ?? alliance,
        network: net,
        passPlan: p.pass,
        zones: [...onPass.zones].sort((a, b) => a - b),
        passCount,
        ticketCount: onTicket ? count(p.ticket, onTicket.zones) : passCount,
        exact: bridged === 0,
        notes: bridged ? [`${bridged} hop(s) between stops not listed as such in the fare data, joined through the network`] : [],
      });
    }
    if (candidates.length === 0) return none;

    const own = networks.ownZones?.alliances;
    const stops = [...new Set(seqs.flat())];
    let usedFile = false;
    let eligible = candidates.filter((c) => {
      const listed = own?.[c.alliance]?.[c.passPlan];
      if (listed) {
        usedFile = true;
        return rawZones.get(c.alliance)!.some((z) => listed[String(z)]?.own === true);
      }
      return stops.some((s) => {
        const at = zonalAt(s);
        return at.length === 1 && at[0] === c.alliance;
      });
    });
    if (eligible.length > 0) return { candidates, eligible, rule: usedFile ? 'own-zone' : 'exclusive-stop' };

    // Only shared ground: the network at home at the origin.
    const origin = seqs[0]![0]!;
    const score = (c: TripNetwork): number => {
      const at = nova.stopZones(c.alliance, c.passPlan, origin);
      const zones = at ? (at.own.length ? at.own : at.zones) : [];
      return zones.length ? Math.min(...zones.map((z) => sharedShare(c.alliance, c.passPlan, z))) : 1;
    };
    eligible = [
      [...candidates]
        .map((c) => ({ c, s: score(c) }))
        .sort((a, b) => a.s - b.s || Number(!a.c.network) - Number(!b.c.network) || a.c.alliance.localeCompare(b.c.alliance))[0]!.c,
    ];
    return { candidates, eligible, rule: 'origin-territory' };
  };
}

const resolvers = new WeakMap<Networks, WeakMap<NovaData, TripResolver>>();

/** One resolver per pair of data sets: it keeps what it has worked out. */
export function tripResolver(nova: NovaData, networks: Networks): TripResolver {
  let byNova = resolvers.get(networks);
  if (!byNova) resolvers.set(networks, (byNova = new WeakMap()));
  let r = byNova.get(nova);
  if (!r) byNova.set(nova, (r = createTripResolver(nova, networks)));
  return r;
}

let builtIn: Networks | undefined;
/** Mobilis alone: what the engine prices without any data file. */
export function builtInNetworks(): Networks {
  return (builtIn ??= createNetworks());
}
