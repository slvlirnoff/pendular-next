import { describe, expect, it } from 'vitest';
import { createNetwork, loadNetworks, tripResolver, type NetworkGrid } from '../src/fares/networks.js';
import { loadNova } from '../src/fares/nova.js';
import { passMonths, priceTransit } from '../src/fares/price.js';
import { zoneGraph } from '../src/fares/zonePaths.js';
import { stationId } from '../src/routing/motis.js';
import { PENDULAR_RULES } from '../src/rules.js';
import type { CommuteRequest, Leg, PricedProduct, StopPoint } from '../src/types.js';

/**
 * Léman Pass "Multizones" on the real snapshot and the real price files. Prices: SBB shop, passes
 * from 04.01.2027 (data/zones/sbb-checks-leman-pass/RESULTS.md). Stop sequences are consecutive
 * stops of the snapshot's edges (plan leman-pass-abo-amp-billett).
 */
const nova = loadNova();
const networks = loadNetworks();

// Annemasse – Lancy-Bachet – Genève (Léman Express)
const ANNEMASSE_GENEVE = ['8774549', '8517142', '8501008'];
// Saint-Julien, gare – centre – douane – Plan-les-Ouates, Galaise – Lancy-Bachet, gare – Lancy-Pont-Rouge – Genève, gare Cornavin
const STJULIEN_CORNAVIN = ['1401852', '1401233', '1401004', '8593059', '8587075', '8592679', '8587057'];
// Ferney, mairie – centre – Poterie (F) – Genève, OMS-BIT – Genève-Aéroport, gare routière – Genève, gare Cornavin
const FERNEY_CORNAVIN = ['1400679', '1401732', '1401736', '8587904', '8502056', '8587057'];
// Veigy, douane (F) – Anières, douane – Corsier – Vésenaz – Genève, Rive – Mont-Blanc – gare Cornavin
const VEIGY_CORNAVIN = ['1401326', '8592624', '8592762', '8587071', '8587097', '8587061', '8592864', '8587057'];
const GENEVE_AEROPORT = ['8501008', '8501026'];
const COPPET_GENEVE = ['8501023', '8501008'];
const back = (ids: string[]) => [...ids].reverse();

const at = (id: string): StopPoint => ({ name: nova.stopName(id) ?? id, stopId: id, lat: 46.2, lon: 6.14 });
function leg(ids: string[], mode: Leg['mode'] = 'rail', km = 10): Leg {
  return {
    mode,
    from: at(ids[0]!),
    to: at(ids[ids.length - 1]!),
    departure: '2027-01-19T07:00:00+01:00',
    arrival: '2027-01-19T07:20:00+01:00',
    durationMin: 20,
    distanceM: km * 1000,
    line: { name: 'L' },
    intermediateStops: ids.slice(1, -1).map(at),
  };
}
const ctx = (over: Partial<CommuteRequest['traveller']> = {}, weeksWorked = 47) => ({
  traveller: { ageGroup: 'adult' as const, travelClass: 2 as const, halfFare: false, vaudResident: false, ...over },
  tripsPerYear: 470,
  workingDaysPerYear: 235,
  weeksWorked,
  rules: PENDULAR_RULES,
});
const price = (legs: Leg[], over: Partial<CommuteRequest['traveller']> = {}, weeksWorked = 47) => priceTransit(legs, ctx(over, weeksWorked), { nova, networks });
const kind = (ps: PricedProduct[], k: PricedProduct['kind']) => ps.find((p) => p.kind === k);
const yearly = (ps: PricedProduct[]) => kind(ps, 'zonePassYearly');
const monthly = (ps: PricedProduct[]) => kind(ps, 'zonePassMonthly');
const unit = (p: PricedProduct | undefined) => p?.components[0]?.params?.unit;

describe('Léman Pass: which network', () => {
  const resolve = tripResolver(nova, networks);
  it('is a normal network whose own zones are the French ring zones, not zone 10', () => {
    expect(networks.isUmbrella('leman-pass')).toBe(false);
    expect(networks.isUmbrella('z-pass-a-welle-zvv')).toBe(true);
    const own = networks.ownZones!.alliances!['leman-pass']!['leman-pass-abo-amp-billett']!;
    expect(Object.keys(own).filter((z) => own[z]!.own).map(Number)).toEqual([200, 210, 230, 240, 250]);
    expect(networks.ownZones!.alliances!.unireso!['unireso-abo-amp-billett-zone-10']!['10']!.own).toBe(true);
  });
  it('a trip inside zone 10 stays unireso', () => {
    const t = resolve([GENEVE_AEROPORT]);
    expect(t.candidates.map((c) => c.alliance).sort()).toEqual(['leman-pass', 'unireso']);
    expect(t.eligible.map((c) => c.alliance)).toEqual(['unireso']);
  });
  it('a trip using a ring zone is Léman Pass, with zone 10 always added', () => {
    expect(resolve([ANNEMASSE_GENEVE]).eligible.map((c) => [c.alliance, c.zones])).toEqual([['leman-pass', [10, 210]]]);
    expect(resolve([FERNEY_CORNAVIN]).eligible.map((c) => [c.alliance, c.zones])).toEqual([['leman-pass', [10, 250]]]);
    // Inside Saint-Julien only: still a pass with zone 10 (the shop sells no French-only pass).
    expect(resolve([STJULIEN_CORNAVIN.slice(0, 3)]).eligible.map((c) => [c.alliance, c.zones])).toEqual([['leman-pass', [10, 230]]]);
  });
  it('the zone graph adds zone 10 to every set searched', () => {
    const net = networks.get('leman-pass')!;
    expect(zoneGraph(nova, 'leman-pass', net.passPlan!, net).complete([210])).toEqual([10, 210]);
  });
});

describe('stop ids of the timetable', () => {
  it('French bus stops keep their whole number, the one the fare data uses', () => {
    expect(stationId({ stopId: 'ch_ch:1:sloid:1400679:0:1800', parentId: 'ch_Parentch:1:sloid:1400679' })).toBe('1400679');
    expect(nova.alliancesAt(stationId({ stopId: 'ch_Parentch:1:sloid:1400679' })!)).toContain('leman-pass');
    expect(stationId({ stopId: 'ch_Parentch:1:sloid:4121' })).toBe('8504121');
    expect(stationId({ stopId: 'ch_Parent8774549' })).toBe('8774549');
  });
});

describe('Léman Pass: prices per zone set', () => {
  it('Annemasse → Genève: zones 10 + 210, CHF 914 a year, 111.40 a month', () => {
    const ps = price([leg(ANNEMASSE_GENEVE)]);
    const y = yearly(ps)!;
    expect(y).toMatchObject({ network: 'Léman Pass', alliance: 'leman-pass', zones: [10, 210], yearly: 914, provenance: 'tariff' });
    expect(y.components[0]).toMatchObject({ key: 'network.year', params: { zones: 2, zoneSet: '10+210', unit: 914 } });
    const m = monthly(ps)!;
    expect(unit(m)).toBe(111.4);
    expect(m.components[0]!.params!.times).toBe(passMonths(ctx()));
    expect(m.yearly).toBe(Math.round(111.4 * passMonths(ctx())));
    expect(m.provenance).toBe('tariff');
    // Part-time: fewer months of the monthly pass.
    expect(monthly(price([leg(ANNEMASSE_GENEVE)], {}, 20))!.components[0]!.params!.times).toBe(5);
  });
  it('no single tickets or day passes: only the passes (and the GA), with a note', () => {
    const ps = price([leg(ANNEMASSE_GENEVE)]);
    expect(ps.map((p) => p.kind).sort()).toEqual(['ga', 'zonePassMonthly', 'zonePassYearly']);
    expect(String(yearly(ps)!.components[0]!.params!.note)).toContain('single tickets and day passes are not in the price data');
  });
  it('Saint-Julien, gare → Genève: zones 10 + 230, CHF 781.60', () => {
    const ps = price([leg(STJULIEN_CORNAVIN, 'bus')]);
    expect(yearly(ps)).toMatchObject({ alliance: 'leman-pass', zones: [10, 230], provenance: 'tariff' });
    expect(unit(yearly(ps))).toBe(781.6);
    expect(unit(monthly(ps))).toBe(101.3);
  });
  it('the other ring zones cost the same as 230 (Ferney 250, Veigy 200)', () => {
    for (const [seq, zone] of [[FERNEY_CORNAVIN, 250], [VEIGY_CORNAVIN, 200]] as const) {
      const y = yearly(price([leg(seq, 'bus')]))!;
      expect(y.zones).toEqual([10, zone]);
      expect(unit(y)).toBe(781.6);
    }
  });
  it('Annemasse → Saint-Julien or Ferney: three zones, CHF 1195.60', () => {
    const sj = price([leg(ANNEMASSE_GENEVE.slice(0, 2)), leg(back(STJULIEN_CORNAVIN.slice(0, 5)), 'bus')]);
    expect(yearly(sj)).toMatchObject({ alliance: 'leman-pass', zones: [10, 210, 230], provenance: 'tariff' });
    expect(unit(yearly(sj))).toBe(1195.6);
    expect(unit(monthly(sj))).toBe(142.7);
    const fe = price([leg(ANNEMASSE_GENEVE), leg(back(FERNEY_CORNAVIN), 'bus')]);
    expect(yearly(fe)!.zones).toEqual([10, 210, 250]);
    expect(unit(yearly(fe))).toBe(1195.6);
  });
  it('Genève → Genève-Aéroport stays unireso, CHF 500', () => {
    const y = yearly(price([leg(GENEVE_AEROPORT)]))!;
    expect(y).toMatchObject({ alliance: 'unireso', zones: [10], yearly: 500 });
  });
  it('youth and 1st class, zones 10 + 210 and 10 + 230', () => {
    // Children and the young (engine: up to 24) pay the youth price; seniors the adult price.
    expect(unit(yearly(price([leg(ANNEMASSE_GENEVE)], { ageGroup: 'youth' })))).toBe(722);
    expect(unit(monthly(price([leg(ANNEMASSE_GENEVE)], { ageGroup: 'youth' })))).toBe(77.2);
    expect(unit(yearly(price([leg(ANNEMASSE_GENEVE)], { ageGroup: 'child' })))).toBe(722);
    expect(unit(yearly(price([leg(ANNEMASSE_GENEVE)], { ageGroup: 'senior' })))).toBe(914);
    expect(unit(yearly(price([leg(ANNEMASSE_GENEVE)], { travelClass: 1 })))).toBe(1553.8);
    expect(unit(monthly(price([leg(ANNEMASSE_GENEVE)], { travelClass: 1 })))).toBe(189.4);
    expect(unit(yearly(price([leg(STJULIEN_CORNAVIN, 'bus')], { ageGroup: 'youth' })))).toBe(623.6);
    expect(unit(monthly(price([leg(STJULIEN_CORNAVIN, 'bus')], { ageGroup: 'youth' })))).toBe(69.9);
    expect(unit(yearly(price([leg(STJULIEN_CORNAVIN, 'bus')], { travelClass: 1 })))).toBe(1277.9);
    expect(yearly(price([leg(STJULIEN_CORNAVIN, 'bus')], { travelClass: 1 }))!.provenance).toBe('tariff');
  });
  it('cells not read in the shop are estimates', () => {
    const three = [leg(ANNEMASSE_GENEVE), leg(back(FERNEY_CORNAVIN), 'bus')];
    const first = yearly(price(three, { travelClass: 1 }))!;
    expect(unit(first)).toBe(2032.5);
    expect(first.provenance).toBe('estimated');
    expect(yearly(price(three, { ageGroup: 'youth' }))!.provenance).toBe('estimated');
    // Youth 1st class was not read: the adult 1st class price, as an estimate.
    const youthFirst = yearly(price([leg(ANNEMASSE_GENEVE)], { ageGroup: 'youth', travelClass: 1 }))!;
    expect(unit(youthFirst)).toBe(1553.8);
    expect(youthFirst.provenance).toBe('estimated');
  });
  it('a zone set without a price falls back to distance pricing, with a note', () => {
    // Saint-Julien → Cornavin → Ferney: zones 10 + 230 + 250, not seen in the shop.
    const ps = price([leg(STJULIEN_CORNAVIN, 'bus'), leg(back(FERNEY_CORNAVIN), 'bus')]);
    expect(ps.some((p) => p.alliance === 'leman-pass' || p.kind === 'zonePassYearly')).toBe(false);
    const route = kind(ps, 'routePassYearly')!;
    expect(route).toBeDefined();
    expect(String(route.components[0]!.params!.note)).toContain('inside Léman Pass: no price for this zone combination (10+230+250)');
  });
  it('Coppet → Genève is not Léman Pass', () => {
    const ps = price([leg(COPPET_GENEVE, 'rail', 13)]);
    expect(ps.some((p) => p.alliance === 'leman-pass' || p.network === 'Léman Pass')).toBe(false);
    expect(kind(ps, 'routePassYearly')).toBeDefined();
    expect(kind(ps, 'routePassYearly')!.components[0]!.params!.note).toBeUndefined();
  });
});

describe('prices per zone set: the generic lookup', () => {
  const grid: NetworkGrid = {
    network: 'Sets',
    alliance: 'sets',
    rules: { always: [1] },
    passes: { year: { adult: { '2': { '1': 100, all: 300 } } } },
    passesBySet: [
      { zones: [1, 2], like: [[1, 3]], year: { adult: { '2': 200, '1': 340 }, junior: { '2': 150 } } },
      { zones: [1, 2, 3], derived: ['adult.2'], year: { adult: { '2': 290 } } },
    ],
  };
  const net = createNetwork(grid);
  const adult2 = { category: 'adult' as const, travelClass: 2 as const };
  it('looks a set up in any order, with the zones always included and the equivalent sets', () => {
    expect(net.bySet).toBe(true);
    expect(net.setPass('year', [2, 1], adult2)).toEqual({ price: 200, derived: false });
    expect(net.setPass('year', [2], adult2)).toEqual({ price: 200, derived: false });
    expect(net.setPass('year', [3], adult2)).toEqual({ price: 200, derived: false });
    expect(net.setPass('year', [3, 2], adult2)).toEqual({ price: 290, derived: true });
    expect(net.setPass('year', [4], adult2)).toBeNull();
    expect(net.setPass('month', [2], adult2)).toBeNull();
  });
  it('falls back to the adult price of the class for a missing category cell', () => {
    expect(net.setPass('year', [2], { category: 'junior', travelClass: 2 })).toEqual({ price: 150, derived: false });
    expect(net.setPass('year', [2], { category: 'junior', travelClass: 1 })).toEqual({ price: 340, derived: true });
    expect(net.setPass('year', [2], { category: 'senior', travelClass: 1 })).toEqual({ price: 340, derived: false });
  });
  it('a grid without sets keeps pricing by zone count', () => {
    const plain = createNetwork({ ...grid, passesBySet: undefined });
    expect(plain.bySet).toBe(false);
    expect(plain.pass('year', 1, adult2)).toBe(100);
  });
});
