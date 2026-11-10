import { describe, expect, it } from 'vitest';
import { mobilisPass } from '../src/fares/mobilis.js';
import { loadNova, stopNumber } from '../src/fares/nova.js';

// Runs against the committed snapshot in data/nova (tools/nova-import).
const nova = loadNova();

const LUCENS = '8504121';
const MOUDON = '8504120';
const LAUSANNE = '8501120';
const ROMONT = '8504023';
const FRIBOURG = '8504100';
const BERN = '8507000';
const YVERDON = '8504200';
const PASS = 'mobilis-abo-abo';

/** Zones of a trip made of several vehicle legs. */
function tripZones(legs: string[][]): number[] {
  const all = new Set<number>();
  for (const leg of legs) {
    const r = nova.zonesForStops('mobilis', PASS, leg);
    expect(r.missingEdges).toEqual([]);
    for (const z of r.zones) all.add(z);
  }
  return [...all].sort((a, b) => a - b);
}

/** Annual adult 2nd class pass on our own grid (valid from 13.12.2026) for a zone list. */
const yearPass = (zones: number[]) => mobilisPass('year', nova.zoneCount('mobilis', PASS, zones), { category: 'adult', travelClass: 2 });

describe('snapshot', () => {
  it('covers Switzerland and says where it comes from', () => {
    expect(nova.manifest.endpoint).toBe('https://lindas.admin.ch/query');
    expect(Object.keys(nova.manifest.alliances)).toHaveLength(35);
    expect(nova.manifest.counts.relationsSource).toBeGreaterThan(500_000);
    expect(nova.manifest.counts.edges).toBeGreaterThan(40_000);
    const bytes = Object.values(nova.manifest.files).reduce((s, f) => s + f.bytes, 0);
    expect(bytes).toBeLessThan(30e6);
    for (const f of Object.values(nova.manifest.files)) expect(f.bytes).toBeLessThan(10e6);
  });

  it('has the three Mobilis plans, flagged by type', () => {
    const mobilis = nova.alliances().find((a) => a.id === 'mobilis')!;
    expect(mobilis.plans.map((p) => [p.id, p.type])).toEqual([
      ['mobilis-abo-abo', 'pass'],
      ['mobilis-billett-anschlussbillett', 'connecting'],
      ['mobilis-billett-billett', 'ticket'],
    ]);
    expect(nova.plan('mobilis', 'pass')!.zones).toHaveLength(155);
    expect(nova.plan('mobilis', 'pass')!.edgeCount).toBeGreaterThan(4000);
    // 'pass' also finds a plan that serves passes and tickets alike.
    expect(nova.plan('zvv', 'pass')!.type).toBe('pass+ticket');
  });

  it('names the stops', () => {
    expect(nova.stopName(LUCENS)).toBe('Lucens');
    expect(nova.stopName('8504694')).toBe('Lovatens, village');
  });
});

describe('stop ids', () => {
  it('accepts the forms the engine uses', () => {
    expect(stopNumber('8504121')).toBe(8504121);
    expect(stopNumber('8504121:0:1')).toBe(8504121);
    expect(stopNumber('Parent8504121')).toBe(8504121);
    expect(stopNumber('ch:1:sloid:4121')).toBe(-1);
    expect(nova.zonesOnEdge('mobilis', PASS, 'Parent8504121', '8504120:0:2')).toEqual([60, 103]);
  });
});

describe('zones', () => {
  it('Lucens – Moudon uses zones 60 and 103, in either order', () => {
    expect(nova.zonesOnEdge('mobilis', PASS, LUCENS, MOUDON)).toEqual([60, 103]);
    expect(nova.zonesOnEdge('mobilis', 'pass', MOUDON, LUCENS, 'BAHN')).toEqual([60, 103]);
    expect(nova.zonesOnEdge('mobilis', PASS, LUCENS, BERN)).toBeNull();
  });

  it('Lovatens, village lies in zone 103, like Lucens', () => {
    expect(nova.stopZones('mobilis', PASS, '8504694')).toEqual({ zones: [103], own: [103] });
    expect(nova.stopZones('mobilis', PASS, LUCENS)!.own).toEqual([103]);
    expect(nova.stopZones('mobilis', PASS, ROMONT)).toBeNull();
  });

  it('Lucens → Lausanne by train: the 9 zones SBB sells (CHF 2376 on the grid from 13.12.2026)', () => {
    // Rail edges of the plan: Lucens – Moudon – Ecublens-Rue – Châtillens – Palézieux – Lausanne.
    const local = nova.zonesForStops('mobilis', PASS, [LUCENS, MOUDON, '8504018', '8504017', '8504014', LAUSANNE]);
    expect(local).toEqual({ zones: [11, 12, 19, 60, 61, 62, 63, 64, 103], missingEdges: [], bridged: [] });
    expect(yearPass(local.zones)).toBe(2376);
    // Only the ends given: the chain of rail edges is found, and reported.
    const ends = nova.zonesForStops('mobilis', PASS, [LUCENS, LAUSANNE]);
    expect(ends.zones).toEqual(local.zones);
    expect(ends.bridged).toEqual([{ from: LUCENS, to: LAUSANNE, via: [MOUDON, '8504018', '8504017', '8504014'] }]);
  });

  it('Lucens → Lausanne by bus 361 and m2: 7 zones (CHF 2052)', () => {
    const zones = tripZones([
      [LUCENS, MOUDON],
      // Moudon, gare – Lausanne, Vert-Bois/EHL – Epalinges, Croisettes
      ['8570393', '8592130', '8579239'],
      // m2 Croisettes – Lausanne, gare: stops in between are found along the edges
      ['8579239', '8592050'],
    ]);
    expect(zones).toEqual([11, 12, 18, 60, 61, 65, 103]);
    expect(yearPass(zones)).toBe(2052);
  });

  it('Echallens → Lausanne-Flon by LEB: 4 zones (CHF 1305)', () => {
    const r = nova.zonesForStops('mobilis', PASS, ['8501173', '8501181'], { mode: 'BAHN' });
    expect(r.zones).toEqual([11, 12, 16, 50]);
    expect(r.bridged).toHaveLength(1);
    expect(yearPass(r.zones)).toBe(1305);
  });

  it('Chapelle-sur-Moudon → Lausanne by bus 435 and m2: 5 zones (CHF 1575)', () => {
    // Bus stops from the plan's edges through Villars-Mendraz, Peney-le-Jorat and Chalet-à-Gobet.
    const bus = ['8507661', '8570349', '8570347', '8570175', '8570174', '8570173', '8570172', '8583395', '8511209', '8592006', '8587929', '8592130', '8579239'];
    const zones = tripZones([bus, ['8579239', '8591818']]);
    expect(zones).toEqual([11, 12, 18, 57, 58]);
    expect(yearPass(zones)).toBe(1575);
    // With the two ends only, the fewest-edges chain runs through Moudon instead: stops matter.
    expect(nova.zonesForStops('mobilis', PASS, ['8507661', '8579239']).zones).toEqual([12, 18, 58, 60, 61, 65]);
  });

  it('Estavayer-le-Lac → Yverdon-les-Bains: 6 zones, two of them crossed without a stop (CHF 1827)', () => {
    const r = nova.zonesForStops('mobilis', PASS, ['8504132', '8504131', '8504130', YVERDON]);
    expect(r).toEqual({ zones: [40, 54, 106, 107, 108, 109], missingEdges: [], bridged: [] });
    expect(yearPass(r.zones)).toBe(1827);
  });

  it('Romont FR is not in Mobilis', () => {
    expect(nova.alliancesAt(ROMONT)).toEqual(['frimobil']);
    expect(nova.alliancesAt(LUCENS)).toEqual(['frimobil', 'mobilis']);
    expect(nova.alliancesAt('Parent' + LAUSANNE)).toContain('mobilis');
    expect(nova.alliancesAt(BERN)).toContain('libero');
    const r = nova.zonesForStops('mobilis', PASS, [LUCENS, ROMONT]);
    expect(r.zones).toEqual([]);
    expect(r.missingEdges).toEqual([[LUCENS, ROMONT]]);
  });

  it('counts a double zone twice', () => {
    const plan = nova.alliances().flatMap((a) => a.plans).find((p) => p.zones.some((z) => z.factor === 2))!;
    const double = plan.zones.find((z) => z.factor === 2)!;
    expect(nova.zoneCount(plan.alliance, plan.id, [double.code])).toBe(2);
    expect(nova.zoneCount('mobilis', PASS, [11, 12, 103])).toBe(3);
  });
});

describe('tariff kilometres', () => {
  it('Romont FR – Lausanne: 41 km, for tickets and for passes', () => {
    for (const tariff of ['T601', 'T650'] as const) {
      const r = nova.tariffKm([ROMONT, LAUSANNE], tariff)!;
      expect(r.km).toBe(41);
      expect(r.effectiveKm).toBe(41);
      expect(r.parts).toHaveLength(1);
      expect(r.parts[0]!.unit).toBe('KILOMETER');
    }
    expect(nova.relationsBetween(ROMONT, LAUSANNE).map((r) => r.tables.map((t) => t.label)).flat().sort()).toEqual(['T601 011.00 SBB KILOMETER', 'T650 Standard KILOMETER']);
  });

  it('Lausanne – Bern has no relation of its own; chained at Fribourg it is 105 tariff km (97 effective)', () => {
    expect(nova.relationsBetween(LAUSANNE, BERN)).toEqual([]);
    // IC: Lausanne – Fribourg – Bern; a regional train's extra stops do not change the result.
    const ic = nova.tariffKm([LAUSANNE, FRIBOURG, BERN], 'T650')!;
    expect(ic.parts.map((p) => [p.from, p.to, p.km, p.effectiveKm])).toEqual([
      [LAUSANNE, FRIBOURG, 69, 66],
      [FRIBOURG, BERN, 36, 31],
    ]);
    expect(ic.km).toBe(105);
    expect(ic.effectiveKm).toBe(97);
    expect(nova.tariffKm([LAUSANNE, '8504014', ROMONT, FRIBOURG, BERN], 'T601')!.km).toBe(105);
    expect(nova.tariffKmBetween(LAUSANNE, BERN)!.km).toBe(105);
  });

  it('Yverdon-les-Bains – Bern: 86 km via Payerne and Fribourg, 91 km via Neuchâtel', () => {
    const viaFribourg = nova.tariffKm([YVERDON, '8504134', FRIBOURG, BERN], 'T650')!;
    expect(viaFribourg.parts.map((p) => p.km)).toEqual([50, 36]);
    expect(viaFribourg.km).toBe(86);
    const viaNeuchatel = nova.tariffKm([YVERDON, '8504221', BERN], 'T650')!;
    expect(viaNeuchatel.parts.map((p) => p.km)).toEqual([37, 54]);
    expect(viaNeuchatel.km).toBe(91);
    // Without the route, the search returns the shorter one.
    expect(nova.tariffKmBetween(YVERDON, BERN, { tariff: 'T650' })!.km).toBe(86);
  });

  it('follows the stops given: Lucens – Bern via Palézieux is not the shorter way via Payerne', () => {
    const viaPalezieux = nova.tariffKm([LUCENS, MOUDON, '8504018', '8504017', '8504014', ROMONT, FRIBOURG, BERN], 'T601')!;
    expect(viaPalezieux.parts.map((p) => [p.from, p.to, p.km])).toEqual([
      [LUCENS, '8504014', 23],
      ['8504014', FRIBOURG, 45],
      [FRIBOURG, BERN, 36],
    ]);
    expect(viaPalezieux.parts.every((p) => !p.loose)).toBe(true);
    // With the ends only, the search finds the shorter way round (Lucens – Payerne – Fribourg).
    expect(nova.tariffKmBetween(LUCENS, BERN, { tariff: 'T601' })!.km).toBe(73);
  });

  it('is null where the direct service has nothing', () => {
    expect(nova.tariffKm([LAUSANNE, '8504694'])).toBeNull();
    expect(nova.tariffKm([LAUSANNE])).toBeNull();
  });

  it('single tickets and passes do not always agree: the airport surcharge is in T601 only', () => {
    const geneva = '8501008';
    const airport = '8501026';
    expect(nova.tariffKm([geneva, airport], 'T601')!.km).toBe(16);
    expect(nova.tariffKm([geneva, airport], 'T650')!.km).toBe(6);
    expect(nova.tariffKm([geneva, airport], 'T601')!.effectiveKm).toBe(6);
  });
});

describe('products and prices', () => {
  it('maps a zone count to the pay level of a product', () => {
    expect(nova.tarif('450-zt-72484')!.label).toBe('Mobilis Jahresabo SwissPass');
    expect(nova.payLevelFor('450-zt-72484', 9)).toMatchObject({ level: 'stufe-9', validity: 1, validityUnit: 'JAHRE', from: 9, to: 9 });
    expect(nova.payLevelFor('450-zt-72484', 14)!.level).toBe('alle-zonen');
    expect(nova.plan('mobilis', 'pass')!.tarifs).toContain('450-zt-72484');
  });

  it('has prices only for the precalculated tables; the SBB distance tables are empty', () => {
    const tables = nova.priceTables();
    const sbb = tables.find((t) => t.label === 'T601 011.00 SBB KILOMETER')!;
    expect(sbb.prices).toBe(0);
    expect(nova.distancePrice({ table: sbb.id, km: 41 })).toEqual([]);
    expect(tables.find((t) => t.label === 'T650 Standard KILOMETER')!.prices).toBe(0);
    const lex = tables.find((t) => t.label === 'LEX Preistabelle DV Abo')!;
    const month = nova.distancePrice({ table: lex.id, km: 41, travelClass: 2, durationUnit: 'MONATE', durationValue: 1 });
    expect(month.length).toBeGreaterThan(0);
    for (const p of month) expect(p.from <= 41 && 41 <= p.to && p.price > 0).toBe(true);
  });

  it('keeps the zone price entries, which the source ties to no product', () => {
    expect(nova.zonePriceEntries().length).toBeGreaterThan(20_000);
    expect(nova.zonePriceEntries({ travelClass: 2, frequencyCode: '(2.)(ABO)(240)' }).length).toBeGreaterThan(100);
  });

  it('knows which tariffs apply on an edge and where short trips are sold', () => {
    const apps = nova.edgeInfo(LUCENS, MOUDON)[0]!.applications;
    expect(apps).toContain('t650-streckenabonnemente-iv-dv');
    expect(apps).toContain('t651-22-mobilis-einzelbillette');
    expect(nova.label('awb', 't651-22-mobilis-einzelbillette')).toBe('T651.22 Mobilis Einzelbillette');
    // Lausanne, Flon → Lausanne, gare is a Mobilis short trip.
    expect(nova.shortRoutes('8591818', '8592050').some((r) => r.type === 'KURZ' && r.payLevels.includes('449-eb/kurzstrecke'))).toBe(true);
  });
});
