import type { CostComponent, Leg, PricedProduct, ProductKind, Provenance, Traveller } from '../types.js';
import type { FareContext } from '../planner/compare.js';
import type { ZoneIndex } from './zones.js';
import {
  MOBILIS_SOURCE,
  mobilisDayPass,
  mobilisPass,
  mobilisPassCategory,
  mobilisSingle,
  zonesFromSinglePrice,
  type MobilisZones,
} from './mobilis.js';
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
// Mobilis (zones)
// ---------------------------------------------------------------------------------------------

function mobilisProducts(n: number, exact: boolean, ctx: FareContext, notes: string[]): PricedProduct[] {
  const t = ctx.traveller;
  const cls = t.travelClass;
  const prov: Provenance = exact ? 'tariff' : 'estimated';
  const z: MobilisZones = n;
  const src = MOBILIS_SOURCE;
  const params = { zones: n, ...(notes.length ? { note: notes.join('; ') } : {}) };
  const out: (PricedProduct | null)[] = [];
  const reduced = t.ageGroup === 'child' || t.halfFare;

  const one = (
    kind: ProductKind,
    key: string,
    price: (zones: MobilisZones) => number | null,
    times: number,
    card: boolean,
  ) => {
    const p = price(z);
    if (p == null) return;
    const comp: CostComponent = { key, params: { ...params, unit: p, times }, yearly: p * times, provenance: prov, source: src };
    const made = card ? withCard(kind, comp, ctx) : product(kind, [comp]);
    if (!made) return;
    if (!exact) {
      const lo = price(Math.max(1, n - 1));
      const hi = price(n + 1);
      const extra = made.yearly - comp.yearly;
      if (lo != null && hi != null) made.range = { low: Math.round(lo * times + extra), high: Math.round(hi * times + extra) };
    }
    out.push(made);
  };

  const trips = ctx.tripsPerYear;
  const days = ctx.workingDaysPerYear;
  // Without a reduction: full-fare singles and day passes.
  if (!reduced) {
    one('singles', 'mobilis.single', (zz) => mobilisSingle(zz, { travelClass: cls, half: false }), trips, false);
    one('dayPasses', 'mobilis.dayPass', (zz) => mobilisDayPass(zz, { travelClass: cls, half: false }), days, false);
  }
  one('halfFareSingles', 'mobilis.single.half', (zz) => mobilisSingle(zz, { travelClass: cls, half: true }), trips, true);
  one('halfFareDayPasses', 'mobilis.dayPass.half', (zz) => mobilisDayPass(zz, { travelClass: cls, half: true }), days, true);

  const category = mobilisPassCategory(t.ageGroup);
  // FlexiAbo: 100 travel days within a year.
  one('flexiPass', 'mobilis.flexi', (zz) => mobilisPass('flexi', zz, { category, travelClass: cls }), Math.max(1, Math.ceil(days / 100)), false);
  one('zonePassMonthly', 'mobilis.month', (zz) => mobilisPass('month', zz, { category, travelClass: cls }), passMonths(ctx), false);

  // Canton of Vaud: 50 % off annual Mobilis passes for residents up to 25 and from 65.
  const discount = t.vaudResident && t.ageGroup !== 'adult' ? 0.5 : 1;
  one(
    'zonePassYearly',
    discount < 1 ? 'mobilis.year.vaudDiscount' : 'mobilis.year',
    (zz) => {
      const p = mobilisPass('year', zz, { category, travelClass: cls });
      return p == null ? null : p * discount;
    },
    1,
    false,
  );
  // The pass for the whole network: rarely the cheapest for one commute, but it shows what
  // unlimited travel in the canton costs next to the pass for this trip.
  const all = mobilisPass('year', 'all', { category, travelClass: cls });
  const own = mobilisPass('year', z, { category, travelClass: cls });
  if (all != null && own != null && all > own) {
    out.push(
      product('zonePassAllYearly', [
        { key: discount < 1 ? 'mobilis.year.all.vaudDiscount' : 'mobilis.year.all', yearly: all * discount, provenance: 'tariff', source: src },
      ]),
    );
  }
  return out.filter((p): p is PricedProduct => p !== null);
}

// ---------------------------------------------------------------------------------------------
// National distance tariff
// ---------------------------------------------------------------------------------------------

/** Tariff kilometres are not open data: the travelled distance stands in for them. */
export function estimatedTariffKm(legs: Leg[]): number {
  return Math.max(1, Math.ceil(legs.reduce((s, l) => s + l.distanceM, 0) / 1000));
}

function nationalProducts(legs: Leg[], ctx: FareContext, deps: PriceDeps): PricedProduct[] {
  const t = ctx.traveller;
  const cls = t.travelClass;
  const km = estimatedTariffKm(legs);
  const out: (PricedProduct | null)[] = [];
  const reduced = t.ageGroup === 'child' || t.halfFare;
  const quoted = deps.quote?.(legs) ?? null;
  const params = { km };

  const single = (half: boolean): CostComponent | null => {
    if (quoted && quoted.travelClass === cls && quoted.half === half) {
      return { key: half ? 'national.single.half' : 'national.single', params: { unit: quoted.single, times: ctx.tripsPerYear }, yearly: quoted.single * ctx.tripsPerYear, provenance: 'quoted', source: 'OJP Fare' };
    }
    const p = distanceSingle(km, { travelClass: cls, half });
    return p == null
      ? null
      : { key: half ? 'national.single.half' : 'national.single', params: { ...params, unit: p, times: ctx.tripsPerYear }, yearly: p * ctx.tripsPerYear, provenance: 'estimated', source: DISTANCE_TABLE_SOURCE };
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
    out.push(withCard('halfFareDayPasses', { key: 'national.dayCard.half', params: { unit: dc, times: ctx.workingDaysPerYear }, yearly: dc * ctx.workingDaysPerYear, provenance: 'tariff', source: NATIONAL_SOURCE }, ctx));
  }

  const category = t.ageGroup === 'child' || t.ageGroup === 'youth' ? 'junior' : 'adult';
  const month = routePass('month', km, { travelClass: cls, category });
  if (month != null) {
    const m = passMonths(ctx);
    out.push(product('routePassMonthly', [{ key: 'national.routePass.month', params: { ...params, unit: month, times: m }, yearly: month * m, provenance: 'estimated', source: ROUTE_PASS_TABLE_SOURCE }]));
  }
  const year = routePass('year', km, { travelClass: cls, category });
  if (year != null) {
    out.push(product('routePassYearly', [{ key: 'national.routePass.year', params, yearly: year, provenance: 'estimated', source: ROUTE_PASS_TABLE_SOURCE }]));
  }
  return out.filter((p): p is PricedProduct => p !== null);
}

// ---------------------------------------------------------------------------------------------

/** All ticket products that can cover the public transport legs of one trip, cheapest first. */
export function priceTransit(legs: Leg[], ctx: FareContext, deps: PriceDeps = {}): PricedProduct[] {
  if (legs.length === 0) return [];
  const products: PricedProduct[] = [];
  const z = deps.zones?.zonesForLegs(legs) ?? null;
  if (z) {
    let n = z.zones.length;
    let exact = z.exact;
    const notes = [...z.notes];
    // A quoted single confirms (or corrects) the zone count: each count has its own price.
    const q = deps.quote?.(legs);
    if (q) {
      const fromQuote = zonesFromSinglePrice(q.single, { travelClass: q.travelClass, half: q.half });
      if (typeof fromQuote === 'number') {
        if (fromQuote !== n) notes.push(`zone count ${n} corrected to ${fromQuote} from the quoted price`);
        n = fromQuote;
        exact = true;
      }
    }
    products.push(...mobilisProducts(n, exact, ctx, notes));
  } else {
    products.push(...nationalProducts(legs, ctx, deps));
  }
  const ga = gaProduct(ctx);
  if (ga) products.push(ga);
  if (ctx.traveller.ga) return products.filter((p) => p.kind === 'ga');
  return products.sort((a, b) => a.yearly - b.yearly);
}

export function coveredByZones(legs: Leg[], zones: number[], index?: ZoneIndex): boolean {
  const z = index?.zonesForLegs(legs);
  return !!z && z.zones.every((x) => zones.includes(x));
}
