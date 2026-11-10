import type { CostComponent, Leg, PricedProduct, ProductKind, Provenance, Traveller } from '../types.js';
import type { FareContext } from '../planner/compare.js';
import type { ZoneIndex } from './zones.js';
import type { NovaData } from './nova.js';
import { MOBILIS, TARIFF_YEAR, builtInNetworks, passCategory, tripResolver, type Network, type Networks, type TripNetworks } from './networks.js';
import {
  DISTANCE_TABLE_SOURCE,
  NATIONAL_SOURCE,
  ROUTE_PASS_TABLE_SOURCE,
  dayCardHalfFare,
  distanceSingle,
  gaYearly,
  halfFareCardYearly,
  halfFareCardYearlyPrevious,
  routePass,
} from './national.js';

export interface PriceDeps {
  zones?: ZoneIndex;
  /**
   * The official fare data (NOVA): zones of every hop between two stops, and tariff kilometres
   * between stations. Used first; the zone table and the travelled distance are the fallbacks.
   */
  nova?: NovaData;
  /**
   * Price grids of the zone networks and which zones are each network's own (`loadNetworks`).
   * Mobilis alone when omitted.
   */
  networks?: Networks;
  /**
   * A quoted single for the trip when one is available (OJP Fare).
   * Used for the singles of trips outside the zone table and to confirm zone counts.
   */
  quote?: (legs: Leg[]) => { single: number; travelClass: 1 | 2; half: boolean } | null;
}

const worst = (ps: Provenance[]): Provenance =>
  ps.includes('estimated') ? 'estimated' : ps.includes('tariff') ? 'tariff' : 'quoted';

function product(kind: ProductKind, components: CostComponent[], range?: PricedProduct['range']): PricedProduct {
  return {
    kind,
    yearly: Math.round(components.reduce((s, c) => s + c.yearly, 0)),
    components,
    provenance: worst(components.map((c) => c.provenance)),
    range,
  };
}

/** Children travel at half fare without a card; everyone else needs the Half Fare Travelcard. */
function halfFareCard(t: Traveller): CostComponent | null | 'none-needed' {
  if (t.ageGroup === 'child' || t.halfFare) return 'none-needed';
  const now = halfFareCardYearly(t.ageGroup);
  if (now != null) return { key: 'halfFare.card', yearly: now, provenance: 'tariff', source: NATIONAL_SOURCE };
  const prev = halfFareCardYearlyPrevious(t.ageGroup);
  // No price published yet for the new timetable year: last year's, marked as an estimate.
  return prev != null ? { key: 'halfFare.card', yearly: prev, provenance: 'estimated', source: NATIONAL_SOURCE } : null;
}

/** Months of pass needed when some weeks are without commuting. */
export function passMonths(ctx: FareContext): number {
  return Math.min(12, Math.ceil(ctx.weeksWorked / (52 / 12)));
}

function gaProduct(ctx: FareContext): PricedProduct | null {
  if (ctx.traveller.ga) return product('ga', [{ key: 'ga.owned', yearly: 0, provenance: 'tariff' }]);
  const p = gaYearly(ctx.traveller.ageGroup, ctx.traveller.travelClass);
  return p == null ? null : product('ga', [{ key: 'ga.year', yearly: p, provenance: 'tariff', source: NATIONAL_SOURCE }]);
}

function withCard(
  kind: ProductKind,
  fare: CostComponent,
  ctx: FareContext,
): PricedProduct | null {
  const card = halfFareCard(ctx.traveller);
  if (card === null) return null;
  return product(kind, card === 'none-needed' ? [fare] : [fare, card]);
}

// ---------------------------------------------------------------------------------------------
// Zone networks (Mobilis, Frimobil ...)
// ---------------------------------------------------------------------------------------------

/** Discounts the grid lists for this part of the tariff and this traveller: named, never applied here. */
function discountNote(net: Network, section: string, t: Traveller): string | undefined {
  const labels = net.discounts
    .filter((d) => !d.appliesTo || d.appliesTo.some((a) => section === a || section.startsWith(`${a}.`)))
    .filter((d) => !d.ageGroups || d.ageGroups.includes(t.ageGroup))
    .map((d) => d.label);
  return labels.length ? labels.join('; ') : undefined;
}

/**
 * The products of one zone network for a number of zones. `counts` are the price-relevant zone
 * counts of the trip on the pass plan and on the ticket plan (the same for most networks).
 */
function networkProducts(
  net: Network,
  counts: { pass: number; ticket: number },
  exact: boolean,
  ctx: FareContext,
  notes: string[],
): PricedProduct[] {
  const t = ctx.traveller;
  const cls = t.travelClass;
  const mobilis = net.alliance === MOBILIS;
  // Prices of another year (NOVA only has the current one) are an estimate of the coming year's.
  const thisYear = net.origin === 'tariff' && net.year === TARIFF_YEAR;
  const prov: Provenance = exact && thisYear ? 'tariff' : 'estimated';
  const src = net.source;
  // Mobilis keeps the keys and parameters it always had; the other networks share generic ones.
  const prefix = mobilis ? 'mobilis' : 'network';
  const note: Record<string, string> = notes.length ? { note: notes.join('; ') } : {};
  const paramsFor = (zones: number, section: string): Record<string, string | number> => {
    if (mobilis) return { zones, ...note };
    const discounts = discountNote(net, section, t);
    return { network: net.label, zones, ...(thisYear ? {} : { priceYear: net.year }), ...note, ...(discounts ? { discounts } : {}) };
  };
  const tag = (p: PricedProduct): PricedProduct => {
    p.network = net.label;
    if (!thisYear) p.priceYear = net.year;
    return p;
  };
  const out: PricedProduct[] = [];
  const reduced = t.ageGroup === 'child' || t.halfFare;

  const one = (
    kind: ProductKind,
    key: string,
    section: string,
    family: 'pass' | 'ticket',
    price: (zones: number) => number | null,
    times: number,
    card: boolean,
  ) => {
    const n = counts[family];
    const p = price(n);
    if (p == null) return;
    const comp: CostComponent = {
      key: `${prefix}.${key}`,
      params: { ...paramsFor(net.paidZones(n, family), section), unit: p, times },
      yearly: p * times,
      provenance: prov,
      source: src,
    };
    const made = card ? withCard(kind, comp, ctx) : product(kind, [comp]);
    if (!made) return;
    if (!exact) {
      const lo = price(Math.max(1, n - 1));
      const hi = price(n + 1);
      const extra = made.yearly - comp.yearly;
      if (lo != null && hi != null) made.range = { low: Math.round(lo * times + extra), high: Math.round(hi * times + extra) };
    }
    out.push(tag(made));
  };

  const trips = ctx.tripsPerYear;
  const days = ctx.workingDaysPerYear;
  // Without a reduction: full-fare singles and day passes.
  if (!reduced) {
    one('singles', 'single', 'tickets.single', 'ticket', (zz) => net.single(zz, { travelClass: cls, half: false }), trips, false);
    one('dayPasses', 'dayPass', 'dayPass', 'ticket', (zz) => net.dayPass(zz, { travelClass: cls, half: false }), days, false);
  }
  one('halfFareSingles', 'single.half', 'tickets.single', 'ticket', (zz) => net.single(zz, { travelClass: cls, half: true }), trips, true);
  one('halfFareDayPasses', 'dayPass.half', 'dayPass', 'ticket', (zz) => net.dayPass(zz, { travelClass: cls, half: true }), days, true);

  const category = passCategory(t.ageGroup);
  // FlexiAbo: 100 travel days within a year.
  one('flexiPass', 'flexi', 'passes.flexi', 'pass', (zz) => net.pass('flexi', zz, { category, travelClass: cls }), Math.max(1, Math.ceil(days / 100)), false);
  one('zonePassMonthly', 'month', 'passes.month', 'pass', (zz) => net.pass('month', zz, { category, travelClass: cls }), passMonths(ctx), false);

  // Canton of Vaud: 50 % off annual Mobilis passes for residents up to 25 and from 65.
  // The only discount applied: those a grid file lists are named in the parameters, no more.
  const discount = mobilis && t.vaudResident && t.ageGroup !== 'adult' ? 0.5 : 1;
  one(
    'zonePassYearly',
    discount < 1 ? 'year.vaudDiscount' : 'year',
    'passes.year',
    'pass',
    (zz) => {
      const p = net.pass('year', zz, { category, travelClass: cls });
      return p == null ? null : p * discount;
    },
    1,
    false,
  );
  // The pass for the whole network: rarely the cheapest for one commute, but it shows what
  // unlimited travel in the network costs next to the pass for this trip.
  const all = net.pass('year', 'all', { category, travelClass: cls });
  const own = net.pass('year', counts.pass, { category, travelClass: cls });
  if (all != null && own != null && all > own) {
    const discounts = mobilis ? undefined : discountNote(net, 'passes.year', t);
    out.push(
      tag(
        product('zonePassAllYearly', [
          {
            key: `${prefix}.${discount < 1 ? 'year.all.vaudDiscount' : 'year.all'}`,
            ...(mobilis ? {} : { params: { network: net.label, ...(thisYear ? {} : { priceYear: net.year }), ...(discounts ? { discounts } : {}) } }),
            yearly: all * discount,
            provenance: thisYear ? 'tariff' : 'estimated',
            source: src,
          },
        ]),
      ),
    );
  }
  return out;
}

/** The annual pass of a network for the trip, to compare networks; the cheapest product when it sells none. */
const yearlyPassCost = (products: PricedProduct[]): number =>
  products.find((p) => p.kind === 'zonePassYearly')?.yearly ?? Math.min(Infinity, ...products.map((p) => p.yearly));

// ---------------------------------------------------------------------------------------------
// National distance tariff
// ---------------------------------------------------------------------------------------------

/** Without official tariff kilometres, the travelled distance stands in for them. */
export function estimatedTariffKm(legs: Leg[]): number {
  return Math.max(1, Math.ceil(legs.reduce((s, l) => s + l.distanceM, 0) / 1000));
}

const stopsOf = (l: Leg): string[] | null => {
  const ids = [l.from, ...(l.intermediateStops ?? []), l.to].map((x) => x.stopId);
  return ids.every((x): x is string => !!x) ? ids : null;
};

/**
 * Tariff kilometres of the trip: official values leg by leg where the fare data has them
 * (distances of the direct service add up), the travelled distance for the other legs.
 */
export function tariffKm(legs: Leg[], nova: NovaData | undefined, tariff: 'T601' | 'T650'): { km: number; official: boolean } {
  let km = 0;
  let official = !!nova;
  for (const l of legs) {
    const seq = stopsOf(l);
    const t = seq && nova ? nova.tariffKm(seq, tariff) : null;
    if (t && t.parts.every((p) => p.unit === 'KILOMETER')) km += t.km;
    else {
      km += l.distanceM / 1000;
      official = false;
    }
  }
  return { km: Math.max(1, Math.ceil(km)), official };
}

function nationalProducts(legs: Leg[], ctx: FareContext, deps: PriceDeps, note?: string): PricedProduct[] {
  const t = ctx.traveller;
  const cls = t.travelClass;
  // Single tickets and route passes have their own distance tables.
  const single601 = tariffKm(legs, deps.nova, 'T601');
  const pass650 = tariffKm(legs, deps.nova, 'T650');
  const km = pass650.km;
  const out: (PricedProduct | null)[] = [];
  const reduced = t.ageGroup === 'child' || t.halfFare;
  const quoted = deps.quote?.(legs) ?? null;
  // Why a trip inside a zone network is priced by distance all the same.
  const why: Record<string, string> = note ? { note } : {};
  const params = { km, ...why };

  const single = (half: boolean): CostComponent | null => {
    if (quoted && quoted.travelClass === cls && quoted.half === half) {
      return { key: half ? 'national.single.half' : 'national.single', params: { ...why, unit: quoted.single, times: ctx.tripsPerYear }, yearly: quoted.single * ctx.tripsPerYear, provenance: 'quoted', source: 'OJP Fare' };
    }
    const p = distanceSingle(single601.km, { travelClass: cls, half });
    return p == null
      ? null
      : { key: half ? 'national.single.half' : 'national.single', params: { km: single601.km, ...why, unit: p, times: ctx.tripsPerYear }, yearly: p * ctx.tripsPerYear, provenance: single601.official ? 'tariff' : 'estimated', source: DISTANCE_TABLE_SOURCE };
  };
  if (!reduced) {
    const s = single(false);
    if (s) out.push(product('singles', [s]));
  }
  const h = single(true);
  if (h) out.push(withCard('halfFareSingles', h, ctx));

  // Day card for Half Fare holders: valid all day on the whole network.
  const dc = dayCardHalfFare(cls);
  if (dc != null) {
    out.push(withCard('halfFareDayPasses', { key: 'national.dayCard.half', params: { ...why, unit: dc, times: ctx.workingDaysPerYear }, yearly: dc * ctx.workingDaysPerYear, provenance: 'tariff', source: NATIONAL_SOURCE }, ctx));
  }

  const category = t.ageGroup === 'child' || t.ageGroup === 'youth' ? 'junior' : 'adult';
  const month = routePass('month', km, { travelClass: cls, category });
  if (month != null) {
    const m = passMonths(ctx);
    out.push(product('routePassMonthly', [{ key: 'national.routePass.month', params: { ...params, unit: month, times: m }, yearly: month * m, provenance: pass650.official ? 'tariff' : 'estimated', source: ROUTE_PASS_TABLE_SOURCE }]));
  }
  const year = routePass('year', km, { travelClass: cls, category });
  if (year != null) {
    out.push(product('routePassYearly', [{ key: 'national.routePass.year', params, yearly: year, provenance: pass650.official ? 'tariff' : 'estimated', source: ROUTE_PASS_TABLE_SOURCE }]));
  }
  return out.filter((p): p is PricedProduct => p !== null);
}

// ---------------------------------------------------------------------------------------------

/** The zone networks that contain the trip, from the official data; null without it or without stop ids. */
function networksOfTrip(legs: Leg[], deps: PriceDeps): TripNetworks | null {
  if (!deps.nova) return null;
  const seqs = legs.map(stopsOf);
  if (!seqs.every((s): s is string[] => s !== null)) return null;
  return tripResolver(deps.nova, deps.networks ?? builtInNetworks())(seqs);
}

/** All ticket products that can cover the public transport legs of one trip, cheapest first. */
export function priceTransit(legs: Leg[], ctx: FareContext, deps: PriceDeps = {}): PricedProduct[] {
  if (legs.length === 0) return [];
  const networks = deps.networks ?? builtInNetworks();
  const mobilis = networks.get(MOBILIS)!;
  const products: PricedProduct[] = [];
  const trip = networksOfTrip(legs, deps);

  /** Mobilis: a quoted single confirms (or corrects) the zone count, as each count has its own price. */
  const mobilisProducts = (count: number, exactZones: boolean, zoneNotes: string[]): PricedProduct[] => {
    let n = count;
    let exact = exactZones;
    const notes = [...zoneNotes];
    const q = deps.quote?.(legs);
    if (q) {
      const fromQuote = mobilis.zonesFromSinglePrice(q.single, { travelClass: q.travelClass, half: q.half });
      if (typeof fromQuote === 'number') {
        if (fromQuote !== n) notes.push(`zone count ${n} corrected to ${fromQuote} from the quoted price`);
        n = fromQuote;
        exact = true;
      }
    }
    return networkProducts(mobilis, { pass: n, ticket: n }, exact, ctx, notes);
  };

  // Networks that may sell the trip and that we have prices for: the cheapest annual pass decides.
  const priced = (trip?.eligible ?? [])
    .filter((c) => c.network)
    .map((c) => ({
      c,
      products: c.alliance === MOBILIS ? mobilisProducts(c.passCount, c.exact, c.notes) : networkProducts(c.network!, { pass: c.passCount, ticket: c.ticketCount }, c.exact, ctx, c.notes),
    }))
    .filter((x) => x.products.length > 0)
    .sort((a, b) => yearlyPassCost(a.products) - yearlyPassCost(b.products));
  const unpriced = (trip?.eligible ?? []).filter((c) => !priced.some((x) => x.c === c));
  // The older hand-made Mobilis table decides only when the official data cannot place the trip in Mobilis.
  const table = priced.length === 0 && !trip?.candidates.some((c) => c.alliance === MOBILIS) ? (deps.zones?.zonesForLegs(legs) ?? null) : null;

  if (priced.length > 0) {
    const best = priced[0]!;
    const others = [
      ...priced.slice(1).map((x) => `also inside ${x.c.label}: annual pass CHF ${Math.round(yearlyPassCost(x.products))}`),
      ...unpriced.map((c) => `also inside ${c.label}: no price grid`),
    ];
    if (others.length) {
      for (const p of best.products) {
        for (const comp of p.components) {
          if (comp.params && 'zones' in comp.params) comp.params.note = [comp.params.note, ...others].filter(Boolean).join('; ');
        }
      }
    }
    products.push(...best.products);
  } else if (table) {
    products.push(...mobilisProducts(table.zones.length, table.exact, table.notes));
  } else {
    // Inside a zone network we have no prices for: the national distance tariff stands in, and says so.
    const note = unpriced.length ? `inside ${unpriced.map((c) => c.label).join(', ')}: no price grid for this network, priced by distance` : undefined;
    products.push(...nationalProducts(legs, ctx, deps, note));
  }
  const ga = gaProduct(ctx);
  if (ga) products.push(ga);
  if (ctx.traveller.ga) return products.filter((p) => p.kind === 'ga');
  return products.sort((a, b) => a.yearly - b.yearly);
}

/**
 * True when the trip needs no Mobilis zone other than `zones` (passes of Lausanne's P+R include
 * zones 11 and 12). The official data decides; the zone table when it cannot place the trip.
 */
export function coveredByZones(legs: Leg[], zones: number[], index?: ZoneIndex, nova?: NovaData, networks?: Networks): boolean {
  if (legs.length === 0) return false;
  const official = networksOfTrip(legs, { nova, networks })?.candidates.find((c) => c.alliance === MOBILIS);
  if (official) return official.zones.every((x) => zones.includes(x));
  const z = index?.zonesForLegs(legs);
  return !!z && z.zones.every((x) => zones.includes(x));
}
