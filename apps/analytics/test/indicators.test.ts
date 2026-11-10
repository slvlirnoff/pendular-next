import { describe, expect, it } from 'vitest';
import { computeIndicators, ratioClass } from '../src/indicators.js';
import type { RatioClass, ResultRow } from '../src/types.js';

let seq = 0;
function row(p: Partial<ResultRow> = {}): ResultRow {
  seq++;
  return {
    personId: seq, extId: `p${seq}`, attrs: {}, lat: 47, lon: 8,
    ptMin: null, ptChanges: null, ptDepartures: null, ptCost: null, ptProduct: null, boardStop: null,
    carMin: null, carKm: null, carCost: null, bikeMin: null, ebikeMin: null, walkMin: null,
    co2Pt: null, co2Car: null, ratioClass: 'noPt', error: null, ...p,
  };
}
const rc = (c: RatioClass): Partial<ResultRow> => ({ ratioClass: c });

describe('ratioClass', () => {
  it('boundaries at 1.0, 1.5 and 2.0', () => {
    expect(ratioClass(20, 20)).toBe('ptFaster');
    expect(ratioClass(19, 20)).toBe('ptFaster');
    expect(ratioClass(21, 20)).toBe('upTo1_5');
    expect(ratioClass(30, 20)).toBe('upTo1_5');
    expect(ratioClass(31, 20)).toBe('upTo2');
    expect(ratioClass(40, 20)).toBe('upTo2');
    expect(ratioClass(41, 20)).toBe('over2');
  });
  it('is exact for non-representable products', () => {
    expect(ratioClass(0.3 * 1.5, 0.3)).toBe('upTo1_5');
  });
  it('PT at 90 and 91 minutes', () => {
    expect(ratioClass(90, 60)).toBe('upTo1_5');
    expect(ratioClass(91, 60)).toBe('noPt');
    expect(ratioClass(90, 10)).toBe('over2');
  });
  it('null PT is noPt, null car is ptFaster', () => {
    expect(ratioClass(null, 20)).toBe('noPt');
    expect(ratioClass(null, null)).toBe('noPt');
    expect(ratioClass(80, null)).toBe('ptFaster');
    expect(ratioClass(91, null)).toBe('noPt');
  });
});

describe('computeIndicators', () => {
  it('empty input', () => {
    const r = computeIndicators([], 0);
    expect(r.people).toBe(0);
    expect(r.analysed).toBe(0);
    expect(r.ptWithin).toEqual({ min30: 0, min45: 0, min60: 0 });
    expect(r.bikeWithin20).toBe(0);
    expect(Object.values(r.ratio)).toEqual([0, 0, 0, 0, 0]);
    expect(r.median).toEqual({ pt: null, car: null, bike: null, ebike: null });
    expect(r.boardStops).toEqual([]);
    expect(r.segments).toEqual({ goodPt: 0, cycling: 0, noAlternative: 0 });
    expect(r.by).toBeUndefined();
  });

  it('all-error input keeps people but analyses nobody', () => {
    const rows = [row({ error: 'x', ptMin: 10 }), row({ error: 'y', bikeMin: 5, boardStop: 'A' })];
    const r = computeIndicators(rows, 7);
    expect(r.people).toBe(7);
    expect(r.analysed).toBe(0);
    expect(r.ptWithin.min30).toBe(0);
    expect(r.median.pt).toBeNull();
    expect(r.boardStops).toEqual([]);
  });

  it('error rows are excluded from all figures', () => {
    const rows = [row({ ptMin: 10, ratioClass: 'ptFaster' }), row({ ptMin: 10, error: 'boom' })];
    const r = computeIndicators(rows, 2);
    expect(r.analysed).toBe(1);
    expect(r.ptWithin.min30).toBe(1);
    expect(r.ratio.ptFaster).toBe(1);
  });

  it('shares, thresholds inclusive, rounded to 4 decimals', () => {
    // 3 analysed: pt 30, 45, 61
    const rows = [row({ ptMin: 30 }), row({ ptMin: 45 }), row({ ptMin: 61 })];
    const r = computeIndicators(rows, 3);
    expect(r.ptWithin).toEqual({ min30: 0.3333, min45: 0.6667, min60: 0.6667 });
  });

  it('bike, ebike and walk shares', () => {
    const rows = [
      row({ bikeMin: 20, ebikeMin: 30, walkMin: 20 }),
      row({ bikeMin: 21, ebikeMin: 31, walkMin: 21 }),
      row({}),
      row({ bikeMin: 5, ebikeMin: 5, walkMin: 5 }),
    ];
    const r = computeIndicators(rows, 4);
    expect(r.bikeWithin20).toBe(0.5);
    expect(r.ebikeWithin30).toBe(0.5);
    expect(r.walkWithin20).toBe(0.5);
  });

  it('ratio uses each row own class', () => {
    const rows = [row(rc('ptFaster')), row(rc('ptFaster')), row(rc('over2')), row(rc('noPt'))];
    const r = computeIndicators(rows, 4);
    expect(r.ratio).toEqual({ ptFaster: 0.5, upTo1_5: 0, upTo2: 0, over2: 0.25, noPt: 0.25 });
  });

  it('median: odd count, even count, rounding, nulls skipped', () => {
    const odd = computeIndicators([row({ ptMin: 50 }), row({ ptMin: 10 }), row({ ptMin: 30 }), row({})], 4);
    expect(odd.median.pt).toBe(30);
    const even = computeIndicators([row({ carMin: 10 }), row({ carMin: 21 }), row({ carMin: 40 }), row({ carMin: 15 })], 4);
    expect(even.median.car).toBe(18); // (15+21)/2
    const frac = computeIndicators([row({ bikeMin: 10 }), row({ bikeMin: 11.3 })], 2);
    expect(frac.median.bike).toBe(10.7); // 10.65 -> 10.7
    expect(frac.median.ebike).toBeNull();
  });

  it('boardStops: counts, descending, ties by name, top 15', () => {
    const rows = [
      ...['B', 'B', 'A', 'C', 'C', 'C'].map((s) => row({ boardStop: s })),
      row({}),
    ];
    expect(computeIndicators(rows, 7).boardStops).toEqual([
      { name: 'C', people: 3 }, { name: 'B', people: 2 }, { name: 'A', people: 1 },
    ]);
    const many = Array.from({ length: 20 }, (_, i) => row({ boardStop: `S${String(i).padStart(2, '0')}` }));
    const top = computeIndicators(many, 20).boardStops;
    expect(top).toHaveLength(15);
    expect(top[0]?.name).toBe('S00');
    expect(top[14]?.name).toBe('S14');
  });

  it('segments (people counts)', () => {
    const rows = [
      row({ ptMin: 30, carMin: 20, ptChanges: 1 }), // goodPt (30 = 1.5*20)
      row({ ptMin: 31, carMin: 20, ptChanges: 0 }), // not good (ratio), not noAlt
      row({ ptMin: 20, carMin: 20, ptChanges: 2 }), // not good (changes)
      row({ ptMin: 70, carMin: 80, ptChanges: 0, bikeMin: 20 }), // cycling; PT>60 but cycling excluded from noAlt
      row({ ptMin: 70, carMin: 80, ptChanges: 0 }), // noAlt (PT>60)
      row({ ptMin: 41, carMin: 20, ptChanges: 0 }), // noAlt (PT>2x car)
      row({ ptMin: 40, carMin: 20, ptChanges: 0 }), // exactly 2x: not noAlt
      row({}), // no PT: noAlt
      row({ ebikeMin: 30 }), // cycling, no PT but cycling -> not noAlt
    ];
    expect(computeIndicators(rows, 9).segments).toEqual({ goodPt: 2 - 1 + 2, cycling: 2, noAlternative: 3 });
  });

  it('custom thresholds override defaults', () => {
    const rows = [row({ ptMin: 70, carMin: 80, ptChanges: 0 })];
    const r = computeIndicators(rows, 1, { thresholds: { noAlternativePtMin: 75 } });
    expect(r.segments.noAlternative).toBe(0);
  });

  describe('by', () => {
    const mk = (dep: string | undefined, n: number, extra: Partial<ResultRow> = {}) =>
      Array.from({ length: n }, () => row({ attrs: dep === undefined ? {} : { dep }, ...extra }));

    it('groups by attribute, sorted by size, missing -> en dash', () => {
      const rows = [...mk('A', 5), ...mk('B', 7), ...mk(undefined, 6)];
      const r = computeIndicators(rows, 18, { by: 'dep' });
      expect(r.by?.attribute).toBe('dep');
      expect(r.by?.groups.map((g) => [g.value, g.indicators.people])).toEqual([['B', 7], ['–', 6], ['A', 5]]);
    });

    it('group figures are computed on the group only', () => {
      const rows = [...mk('A', 5, { ptMin: 10 }), ...mk('B', 5, { ptMin: 100 })];
      const g = computeIndicators(rows, 10, { by: 'dep' }).by!.groups;
      const a = g.find((x) => x.value === 'A')!;
      const b = g.find((x) => x.value === 'B')!;
      expect(a.indicators.ptWithin.min30).toBe(1);
      expect(b.indicators.ptWithin.min30).toBe(0);
      expect(a.indicators.median.pt).toBe(10);
    });

    it('people is the row count including error rows', () => {
      const rows = [...mk('A', 4), row({ attrs: { dep: 'A' }, error: 'e' })];
      const a = computeIndicators(rows, 5, { by: 'dep' }).by!.groups[0]!;
      expect(a.indicators.people).toBe(5);
      expect(a.indicators.analysed).toBe(4);
    });

    it('merges small groups into one', () => {
      const rows = [...mk('A', 6), ...mk('B', 3), ...mk('C', 2), ...mk('D', 1)];
      const g = computeIndicators(rows, 12, { by: 'dep' }).by!.groups;
      expect(g.map((x) => [x.value, x.indicators.people])).toEqual([['A', 6], ['other (small groups)', 6]]);
    });

    it('drops a merged group that is itself too small', () => {
      const rows = [...mk('A', 6), ...mk('B', 2), ...mk('C', 2)];
      const g = computeIndicators(rows, 10, { by: 'dep' }).by!.groups;
      expect(g.map((x) => x.value)).toEqual(['A']);
    });

    it('respects minGroupSize', () => {
      const rows = [...mk('A', 3), ...mk('B', 2)];
      const g = computeIndicators(rows, 5, { by: 'dep', minGroupSize: 2 }).by!.groups;
      expect(g.map((x) => x.value)).toEqual(['A', 'B']);
    });
  });
});
