import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mobilisPass, mobilisSingle } from '../src/fares/mobilis.js';
import { createNetwork, createNetworks, createTripResolver, loadNetworks, type NetworkGrid } from '../src/fares/networks.js';
import { loadNova } from '../src/fares/nova.js';
import { coveredByZones, priceTransit } from '../src/fares/price.js';
import { PENDULAR_RULES } from '../src/rules.js';
import type { CommuteRequest, Leg, PricedProduct, StopPoint } from '../src/types.js';

// The real fare data snapshot; the price grids and the own-zones files are fixtures with invented prices.
const nova = loadNova();
const FIX = resolve(import.meta.dirname, 'fixtures/networks');
const tariffDir = resolve(FIX, 'tariffs');
const ladderDir = resolve(FIX, 'ladders');
const ownZonesPath = resolve(FIX, 'network-zones.json');
const NO_FILE = resolve(FIX, 'absent.json');
const NO_DIR = resolve(FIX, 'absent');

const all = loadNetworks({ tariffDir, ladderDir, ownZonesPath });
const laddersOnly = loadNetworks({ tariffDir: NO_DIR, ladderDir, ownZonesPath });
const noOwnZones = loadNetworks({ tariffDir, ladderDir, ownZonesPath: NO_FILE });
const bothOwn = loadNetworks({ tariffDir, ladderDir, ownZonesPath: resolve(FIX, 'network-zones-both.json') });
const mobilisOnly = loadNetworks({ tariffDir: NO_DIR, ladderDir: NO_DIR, ownZonesPath: NO_FILE });

const LUCENS = '8504121';
const MOUDON = '8504120';
const ROMONT = '8504023';
const FRIBOURG = '8504100';
const LAUSANNE = '8501120';
const RENENS = '8501118';
// Neuchâtel – Chambrelien – Les Geneveys-sur-Coffrane – Les Hauts-Geneveys – La Chaux-de-Fonds
const NEUCHATEL_CHAUX = ['8504221', '8504234', '8504236', '8504237', '8504314'];

const at = (id: string): StopPoint => ({ name: nova.stopName(id) ?? id, stopId: id, lat: 46.7, lon: 6.8 });
/** One train calling at these stops (consecutive stops of the snapshot's edges). */
function rail(ids: string[], km = 10): Leg {
  return {
    mode: 'rail',
    from: at(ids[0]!),
    to: at(ids[ids.length - 1]!),
    departure: '2027-01-19T07:00:00+01:00',
    arrival: '2027-01-19T07:20:00+01:00',
    durationMin: 20,
    distanceM: km * 1000,
    line: { name: 'S1' },
    intermediateStops: ids.slice(1, -1).map(at),
  };
}
const ctx = (over: Partial<CommuteRequest['traveller']> = {}) => ({
  traveller: { ageGroup: 'adult' as const, travelClass: 2 as const, halfFare: false, vaudResident: true, ...over },
  tripsPerYear: 470,
  workingDaysPerYear: 235,
  weeksWorked: 47,
  rules: PENDULAR_RULES,
});
const byKind = (ps: PricedProduct[]) => Object.fromEntries(ps.map((p) => [p.kind, p])) as Partial<Record<PricedProduct['kind'], PricedProduct>>;
const grid = JSON.parse(readFileSync(resolve(tariffDir, 'frimobil.json'), 'utf8')) as NetworkGrid;

describe('grid lookups', () => {
  const net = createNetwork(grid);
  it('reads singles, day passes and passes by zone count, class and category', () => {
    expect(net.single(3, { travelClass: 2, half: false })).toBe(6);
    expect(net.single(3, { travelClass: 2, half: true })).toBe(3.8);
    expect(net.single(3, { travelClass: 1, half: false })).toBe(10.2);
    expect(net.dayPass(2, { travelClass: 2, half: false })).toBe(9);
    expect(net.pass('year', 5, { category: 'adult', travelClass: 2 })).toBe(1440);
    expect(net.pass('year', 5, { category: 'junior', travelClass: 2 })).toBe(1085);
    expect(net.pass('month', 5, { category: 'adult', travelClass: 1 })).toBe(272);
  });
  it('applies the minimum, the all-zones threshold and the missing sections', () => {
    // Passes are sold from two zones on; tickets from one.
    expect(net.pass('year', 1, { category: 'adult', travelClass: 2 })).toBe(net.pass('year', 2, { category: 'adult', travelClass: 2 }));
    expect(net.paidZones(1, 'pass')).toBe(2);
    expect(net.single(1, { travelClass: 2, half: false })).toBe(3);
    // The grid has a column for 8 zones, but the tariff says "all zones from 9"; and beyond the last column.
    expect(net.pass('year', 8, { category: 'adult', travelClass: 2 })).toBe(2115);
    expect(net.pass('year', 9, { category: 'adult', travelClass: 2 })).toBe(2340);
    expect(net.pass('year', 30, { category: 'adult', travelClass: 2 })).toBe(2340);
    expect(net.pass('year', 'all', { category: 'adult', travelClass: 2 })).toBe(2340);
    // No senior price: the adult pass. No junior 1st class row: nothing. No FlexiAbo at all.
    expect(net.pass('year', 3, { category: 'senior', travelClass: 2 })).toBe(net.pass('year', 3, { category: 'adult', travelClass: 2 }));
    expect(net.pass('year', 3, { category: 'junior', travelClass: 1 })).toBeNull();
    expect(net.pass('flexi', 3, { category: 'adult', travelClass: 2 })).toBeNull();
    expect(net.single(0, { travelClass: 2, half: false })).toBeNull();
    expect(net.zonesFromSinglePrice(6, { travelClass: 2, half: false })).toBe(3);
  });
});

describe('loading', () => {
  it('always has Mobilis, with the prices of its own grid', () => {
    const m = mobilisOnly.get('mobilis')!;
    expect(mobilisOnly.list().map((n) => n.alliance)).toEqual(['mobilis']);
    expect(m.origin).toBe('tariff');
    expect(m.pass('year', 9, { category: 'adult', travelClass: 2 })).toBe(2376);
    expect(m.pass('year', 12, { category: 'adult', travelClass: 2 })).toBe(2583);
    expect(m.single(15, { travelClass: 2, half: false })).toBe(30);
    expect(m.rules.together).toEqual([[11, 12]]);
  });
  it('a tariff grid beats a NOVA ladder of the same network', () => {
    expect(all.get('frimobil')).toMatchObject({ label: 'Frimobil', origin: 'tariff', year: 2027 });
    expect(all.get('frimobil')!.pass('year', 5, { category: 'adult', travelClass: 2 })).toBe(1440);
    // Without the tariff grid, the ladder is what there is.
    expect(laddersOnly.get('frimobil')).toMatchObject({ label: 'Frimobil (NOVA)', origin: 'nova', year: 2026 });
    expect(all.get('onde-verte')!.origin).toBe('nova');
    // The same whichever is given first.
    const reversed = createNetworks([{ ...grid, origin: 'nova', network: 'ladder' }, grid]);
    expect(reversed.get('frimobil')!.label).toBe('Frimobil');
  });
  it('knows the joint passes, from the file or built in', () => {
    expect(all.isUmbrella('leman-pass')).toBe(true);
    expect(mobilisOnly.isUmbrella('z-pass-ostwind-zvv')).toBe(true);
    expect(mobilisOnly.isUmbrella('frimobil')).toBe(false);
  });
});

describe('which network sells a trip', () => {
  it('Lucens – Moudon lies in both networks, on Mobilis ground: Mobilis only', () => {
    const r = createTripResolver(nova, all)([[LUCENS, MOUDON]]);
    expect(r.candidates.map((c) => c.alliance).sort()).toEqual(['frimobil', 'mobilis']);
    expect(r.rule).toBe('own-zone');
    expect(r.eligible.map((c) => c.alliance)).toEqual(['mobilis']);
    expect(r.eligible[0]!.zones).toEqual([60, 103]);
  });
  it('without the own-zones file: the network at home at the origin', () => {
    const r = createTripResolver(nova, noOwnZones)([[LUCENS, MOUDON]]);
    // Every stop is in both networks, so no stop decides.
    expect(r.rule).toBe('origin-territory');
    expect(r.eligible.map((c) => c.alliance)).toEqual(['mobilis']);
    // A stop in one network only decides at once.
    const f = createTripResolver(nova, noOwnZones)([[LUCENS, ROMONT]]);
    expect(f.rule).toBe('exclusive-stop');
    expect(f.eligible.map((c) => c.alliance)).toEqual(['frimobil']);
  });
  it('never takes a joint pass for the network of a trip', () => {
    // Zürich HB – Winterthur: ZVV, and the Z-Pass plans laid over it.
    const zurich = ['8503000', '8506000'];
    expect(nova.alliancesAt(zurich[0]!).filter((a) => a.startsWith('z-pass')).length).toBeGreaterThan(0);
    for (const nets of [all, mobilisOnly]) expect(createTripResolver(nova, nets)([zurich]).candidates.map((c) => c.alliance)).toEqual(['zvv']);
    // Two of the four zones count double.
    expect(createTripResolver(nova, all)([zurich]).candidates[0]).toMatchObject({ passPlan: 'zvv-abo-amp-billett', zones: [110, 120, 121, 122], passCount: 6 });
    // Lausanne's two zones go together.
    expect(createTripResolver(nova, all)([[LAUSANNE, RENENS]]).candidates.map((c) => [c.alliance, c.zones])).toEqual([['mobilis', [11, 12]]]);
  });
  it('is empty for a trip across a network border', () => {
    expect(createTripResolver(nova, all)([[LAUSANNE, FRIBOURG]]).candidates).toEqual([]);
  });
});

describe('priceTransit with several networks', () => {
  it('(a) Lucens → Moudon stays a Mobilis trip with the Frimobil grid present', () => {
    const legs = [rail([LUCENS, MOUDON])];
    const withFrimobil = priceTransit(legs, ctx(), { nova, networks: all });
    const year = byKind(withFrimobil).zonePassYearly!;
    expect(year.components[0]).toMatchObject({ key: 'mobilis.year', params: { zones: 2, unit: 729, times: 1 }, provenance: 'tariff' });
    expect(year.yearly).toBe(mobilisPass('year', 2, { category: 'adult', travelClass: 2 }));
    expect(year.network).toBe('Mobilis');
    expect(year.priceYear).toBeUndefined();
    expect(byKind(withFrimobil).singles!.yearly).toBe(Math.round(mobilisSingle(2, { travelClass: 2, half: false })! * 470));
    // Exactly what Mobilis alone gives: no note, no other key.
    expect(withFrimobil).toEqual(priceTransit(legs, ctx(), { nova, networks: mobilisOnly }));
    expect(withFrimobil).toEqual(priceTransit(legs, ctx(), { nova }));
    expect(withFrimobil).toEqual(priceTransit(legs, ctx(), { nova, networks: noOwnZones }));
  });

  it('(b) Romont → Fribourg is priced on the Frimobil grid, zones counted from the fare data', () => {
    const products = priceTransit([rail([ROMONT, FRIBOURG], 26)], ctx(), { nova, networks: all });
    expect(nova.zonesForStops('frimobil', 'frimobil-billett-amp-abo', [ROMONT, FRIBOURG]).zones).toEqual([10, 11, 35, 36, 44]);
    const k = byKind(products);
    expect(k.zonePassYearly).toMatchObject({ yearly: 1440, provenance: 'tariff', network: 'Frimobil' });
    expect(k.zonePassYearly!.priceYear).toBeUndefined();
    expect(k.zonePassYearly!.components).toEqual([
      { key: 'network.year', params: { network: 'Frimobil', zones: 5, unit: 1440, times: 1 }, yearly: 1440, provenance: 'tariff', source: 'test://frimobil-tariff' },
    ]);
    expect(k.zonePassMonthly!.components[0]).toMatchObject({ key: 'network.month', params: { network: 'Frimobil', zones: 5, unit: 160, times: 11 } });
    expect(k.singles!.components[0]).toMatchObject({ key: 'network.single', params: { zones: 5, unit: 9, times: 470 } });
    expect(k.dayPasses!.components[0]!.key).toBe('network.dayPass');
    expect(k.halfFareSingles!.components.map((c) => c.key)).toEqual(['network.single.half', 'halfFare.card']);
    expect(k.halfFareDayPasses!.components[0]!.key).toBe('network.dayPass.half');
    expect(k.zonePassAllYearly!.components[0]).toMatchObject({ key: 'network.year.all', params: { network: 'Frimobil' }, yearly: 2340 });
    // The fixture grid has no FlexiAbo; route passes belong to the national tariff.
    expect(k.flexiPass).toBeUndefined();
    expect(k.routePassYearly).toBeUndefined();
    expect(k.ga).toBeDefined();
    expect(products.map((p) => p.yearly)).toEqual([...products.map((p) => p.yearly)].sort((a, b) => a - b));
  });

  it('names the discounts of a grid without applying them; the Vaud discount is for Mobilis only', () => {
    const youth = byKind(priceTransit([rail([ROMONT, FRIBOURG])], ctx({ ageGroup: 'youth' }), { nova, networks: all }));
    expect(youth.zonePassYearly!.yearly).toBe(1085);
    expect(youth.zonePassYearly!.components[0]).toMatchObject({ key: 'network.year', params: { discounts: 'Fixture youth discount' } });
    expect(youth.zonePassMonthly!.components[0]!.params!.discounts).toBeUndefined();
    const adult = byKind(priceTransit([rail([ROMONT, FRIBOURG])], ctx(), { nova, networks: all }));
    expect(adult.zonePassYearly!.components[0]!.params!.discounts).toBeUndefined();
  });

  it('(c) a network known from NOVA only gives estimates at the prices of 2026', () => {
    const products = priceTransit([rail(NEUCHATEL_CHAUX, 30)], ctx(), { nova, networks: all });
    const k = byKind(products);
    expect(k.zonePassYearly).toMatchObject({ yearly: 1350, provenance: 'estimated', network: 'Onde Verte', priceYear: 2026 });
    expect(k.zonePassYearly!.components[0]).toMatchObject({ key: 'network.year', params: { network: 'Onde Verte', zones: 5, priceYear: 2026 }, provenance: 'estimated' });
    // The zones are certain, only the year of the prices is not: no "one zone more or less" range.
    expect(k.zonePassYearly!.range).toBeUndefined();
    expect(k.zonePassMonthly).toMatchObject({ provenance: 'estimated', priceYear: 2026 });
    expect(k.zonePassAllYearly).toMatchObject({ yearly: 1800, provenance: 'estimated', priceYear: 2026 });
    // The ladder has no tickets: none are invented.
    expect(k.singles).toBeUndefined();
    expect(k.halfFareSingles).toBeUndefined();
    expect(products.filter((p) => p.kind !== 'ga').every((p) => p.priceYear === 2026)).toBe(true);
  });

  it('(d) the tariff grid is used when both exist, the ladder when it is alone', () => {
    const legs = [rail([ROMONT, FRIBOURG])];
    expect(byKind(priceTransit(legs, ctx(), { nova, networks: all })).zonePassYearly).toMatchObject({ yearly: 1440, provenance: 'tariff' });
    expect(byKind(priceTransit(legs, ctx(), { nova, networks: laddersOnly })).zonePassYearly).toMatchObject({ yearly: 1003, provenance: 'estimated', priceYear: 2026, network: 'Frimobil (NOVA)' });
  });

  it('(e) inside a network without a grid: the national distance tariff, with a note', () => {
    const legs = [rail([ROMONT, FRIBOURG], 26)];
    const products = priceTransit(legs, ctx(), { nova, networks: mobilisOnly });
    const k = byKind(products);
    expect(k.zonePassYearly).toBeUndefined();
    expect(k.routePassYearly!.components[0]!.key).toBe('national.routePass.year');
    expect(k.routePassYearly!.components[0]!.params!.note).toMatch(/Frimobil/);
    expect(k.singles!.components[0]!.params!.note).toMatch(/Frimobil/);
    expect(typeof k.routePassYearly!.components[0]!.params!.km).toBe('number');
    expect(k.routePassYearly!.network).toBeUndefined();
    // The tariff kilometres are the official ones, so these are tariff prices.
    expect(k.routePassYearly!.provenance).toBe('tariff');
    // A trip in no network at all carries no note.
    const cross = priceTransit([rail([LAUSANNE, FRIBOURG], 66)], ctx(), { nova, networks: all });
    expect(cross.every((p) => p.components.every((c) => c.params?.note === undefined))).toBe(true);
    expect(byKind(cross).routePassYearly).toBeDefined();
  });

  it('two networks may sell the trip: the cheaper annual pass, the other in a note', () => {
    const products = priceTransit([rail([LUCENS, MOUDON])], ctx(), { nova, networks: bothOwn });
    const year = byKind(products).zonePassYearly!;
    // Mobilis 2 zones: 729; the fixture Frimobil pass for 2 zones: 765.
    expect(year.network).toBe('Mobilis');
    expect(year.components[0]!.params!.note).toBe('also inside Frimobil: annual pass CHF 765');
    expect(products.filter((p) => p.kind !== 'ga').every((p) => p.network === 'Mobilis')).toBe(true);
    // The same for a young traveller, each network at its junior price.
    const junior = byKind(priceTransit([rail([LUCENS, MOUDON])], ctx({ ageGroup: 'youth', vaudResident: false }), { nova, networks: bothOwn })).zonePassYearly!;
    expect(junior.network).toBe('Mobilis');
    expect(junior.yearly).toBe(513);
    expect(junior.components[0]!.params!.note).toBe('also inside Frimobil: annual pass CHF 575');
  });

  it('keeps the Mobilis zone table for trips the fare data cannot place', () => {
    // Stop ids unknown to the snapshot: the hand-made table decides, as before.
    const table = { zonesForLegs: () => ({ zones: [1, 2, 3], exact: true, notes: [] }), zonesOfStop: () => null, neighbours: () => [] };
    const legs = [{ ...rail(['100', '300']) }];
    const year = byKind(priceTransit(legs, ctx(), { nova, networks: all, zones: table })).zonePassYearly!;
    expect(year.components[0]).toMatchObject({ key: 'mobilis.year', params: { zones: 3 } });
    // A quoted single still corrects the count.
    const q = byKind(priceTransit(legs, ctx(), { nova, networks: all, zones: table, quote: () => ({ single: 8, travelClass: 2, half: false }) })).zonePassYearly!;
    expect(q.components[0]!.params).toMatchObject({ zones: 4, note: 'zone count 3 corrected to 4 from the quoted price' });
  });
});

describe('coveredByZones', () => {
  it('uses the fare data: Lausanne – Renens lies in zones 11 and 12, Lucens – Moudon does not', () => {
    expect(coveredByZones([rail([LAUSANNE, RENENS])], [11, 12], undefined, nova, all)).toBe(true);
    expect(coveredByZones([rail([LAUSANNE, RENENS])], [11, 12], undefined, nova)).toBe(true);
    expect(coveredByZones([rail([LUCENS, MOUDON])], [11, 12], undefined, nova, all)).toBe(false);
    expect(coveredByZones([rail([ROMONT, FRIBOURG])], [10, 11, 12], undefined, nova, all)).toBe(false);
  });
  it('falls back on the zone table', () => {
    const table = { zonesForLegs: () => ({ zones: [11, 12], exact: true, notes: [] }), zonesOfStop: () => null, neighbours: () => [] };
    expect(coveredByZones([rail(['100', '300'])], [11, 12], table, nova, all)).toBe(true);
    expect(coveredByZones([rail(['100', '300'])], [11, 12], table)).toBe(true);
    expect(coveredByZones([rail(['100', '300'])], [11, 12])).toBe(false);
  });
});
