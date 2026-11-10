import { describe, expect, it } from 'vitest';
import table from '../data/tariffs/mobilis-2027.json' with { type: 'json' };
import {
  MOBILIS_SOURCE,
  MOBILIS_VALID_FROM,
  mobilisDayPass,
  mobilisPass,
  mobilisPassCategory,
  mobilisSingle,
  zonesFromSinglePrice,
} from '../src/fares/mobilis.js';

const TICKET_KEYS = [...Array.from({ length: 14 }, (_, i) => String(i + 1)), 'all'];
const PASS_KEYS = [...Array.from({ length: 11 }, (_, i) => String(i + 1)), 'all'];

describe('constants', () => {
  it('exposes validity and source', () => {
    expect(MOBILIS_VALID_FROM).toBe('2026-12-13');
    expect(MOBILIS_SOURCE).toBe(
      'https://www.mobilis-vaud.ch/wp-content/uploads/2021/08/Grille-tarifaire-H27-13-decembre-2026.pdf',
    );
  });
});

describe('spot checks from the grid', () => {
  it('single tickets', () => {
    expect(mobilisSingle(1, { travelClass: 2, half: false })).toBe(3.4);
    expect(mobilisSingle(2, { travelClass: 2, half: false })).toBe(4.1);
    expect(mobilisSingle(5, { travelClass: 2, half: false })).toBe(10);
    expect(mobilisSingle(14, { travelClass: 2, half: false })).toBe(28);
    expect(mobilisSingle('all', { travelClass: 2, half: false })).toBe(30);
    expect(mobilisSingle(1, { travelClass: 1, half: false })).toBe(5.8);
    expect(mobilisSingle(3, { travelClass: 1, half: false })).toBe(10.2);
    expect(mobilisSingle('all', { travelClass: 1, half: false })).toBe(51);
    expect(mobilisSingle(1, { travelClass: 2, half: true })).toBe(2.5);
    expect(mobilisSingle(2, { travelClass: 2, half: true })).toBe(2.7);
    expect(mobilisSingle(7, { travelClass: 2, half: true })).toBe(7);
    expect(mobilisSingle(2, { travelClass: 1, half: true })).toBe(3.5);
    expect(mobilisSingle('all', { travelClass: 1, half: true })).toBe(25.5);
  });

  it('day passes', () => {
    expect(mobilisDayPass(1, { travelClass: 2, half: false })).toBe(8.5);
    expect(mobilisDayPass(4, { travelClass: 2, half: false })).toBe(16);
    expect(mobilisDayPass('all', { travelClass: 1, half: false })).toBe(102);
    expect(mobilisDayPass(2, { travelClass: 1, half: false })).toBe(16.2);
    expect(mobilisDayPass(2, { travelClass: 2, half: true })).toBe(6.3);
    expect(mobilisDayPass(3, { travelClass: 1, half: true })).toBe(11.8);
  });

  it('weekly, monthly, annual and flexi passes', () => {
    expect(mobilisPass('week', 1, { category: 'junior', travelClass: 2 })).toBe(26);
    expect(mobilisPass('week', 'all', { category: 'adult', travelClass: 1 })).toBe(244);
    expect(mobilisPass('week', 3, { category: 'senior', travelClass: 2 })).toBe(51);
    expect(mobilisPass('month', 2, { category: 'adult', travelClass: 2 })).toBe(81);
    expect(mobilisPass('month', 11, { category: 'senior', travelClass: 1 })).toBe(434);
    expect(mobilisPass('month', 5, { category: 'junior', travelClass: 2 })).toBe(123);
    expect(mobilisPass('year', 1, { category: 'adult', travelClass: 2 })).toBe(666);
    expect(mobilisPass('year', 5, { category: 'adult', travelClass: 2 })).toBe(1575);
    expect(mobilisPass('year', 'all', { category: 'adult', travelClass: 1 })).toBe(4392);
    expect(mobilisPass('year', 6, { category: 'senior', travelClass: 2 })).toBe(1647);
    expect(mobilisPass('year', 4, { category: 'junior', travelClass: 2 })).toBe(918);
    expect(mobilisPass('flexi', 1, { category: 'adult', travelClass: 2 })).toBe(370);
    expect(mobilisPass('flexi', 'all', { category: 'senior', travelClass: 1 })).toBe(2205);
    expect(mobilisPass('flexi', 7, { category: 'junior', travelClass: 2 })).toBe(800);
  });

  it('short trip ticket', () => {
    expect(table.tickets.shortTrip.price).toBe(2.4);
  });
});

describe('edge cases', () => {
  it('maps zone counts above the last numbered column to all', () => {
    expect(mobilisSingle(15, { travelClass: 2, half: false })).toBe(30);
    expect(mobilisSingle(40, { travelClass: 1, half: true })).toBe(25.5);
    expect(mobilisPass('year', 12, { category: 'adult', travelClass: 2 })).toBe(2583);
    expect(mobilisPass('month', 14, { category: 'adult', travelClass: 2 })).toBe(287);
    expect(mobilisSingle(12, { travelClass: 2, half: false })).toBe(24);
  });

  it('returns null for invalid zones or missing products', () => {
    expect(mobilisSingle(0, { travelClass: 2, half: false })).toBeNull();
    expect(mobilisSingle(1.5, { travelClass: 2, half: false })).toBeNull();
    expect(mobilisDayPass(-1, { travelClass: 2, half: false })).toBeNull();
    expect(mobilisPass('year', 3, { category: 'junior', travelClass: 1 })).toBeNull();
    expect(mobilisPass('flexi', 0, { category: 'adult', travelClass: 2 })).toBeNull();
  });
});

describe('zonesFromSinglePrice', () => {
  it('inverts every zone count in 2nd class full fare', () => {
    for (const key of TICKET_KEYS) {
      const zones = key === 'all' ? 'all' : Number(key);
      const p = mobilisSingle(zones, { travelClass: 2, half: false });
      expect(p).not.toBeNull();
      expect(zonesFromSinglePrice(p!, { travelClass: 2, half: false })).toBe(zones);
    }
  });

  it('returns null for unknown prices', () => {
    expect(zonesFromSinglePrice(3.41, { travelClass: 2, half: false })).toBeNull();
    expect(zonesFromSinglePrice(0, { travelClass: 2, half: false })).toBeNull();
  });

  it('returns null for ambiguous prices', () => {
    // find a duplicated price in any single table, if one exists, and check it yields null
    for (const half of [false, true]) {
      for (const travelClass of [1, 2] as const) {
        const row = table.tickets.single[half ? 'half' : 'full'][travelClass === 1 ? '1' : '2'];
        const prices = Object.values(row);
        for (const p of prices) {
          const count = prices.filter((q) => q === p).length;
          const res = zonesFromSinglePrice(p, { travelClass, half });
          if (count > 1) expect(res).toBeNull();
          else expect(res).not.toBeNull();
        }
      }
    }
  });
});

describe('mobilisPassCategory', () => {
  it('maps age groups', () => {
    expect(mobilisPassCategory('child')).toBe('junior');
    expect(mobilisPassCategory('youth')).toBe('junior');
    expect(mobilisPassCategory('adult')).toBe('adult');
    expect(mobilisPassCategory('senior')).toBe('senior');
  });
});

function nonDecreasing(values: number[]): boolean {
  return values.every((v, i) => i === 0 || v >= values[i - 1]!);
}

describe('structure', () => {
  it('ticket and day pass rows have 15 columns, non-decreasing with zones', () => {
    for (const fam of [table.tickets.single, table.dayPass]) {
      for (const fare of ['full', 'half'] as const) {
        for (const cls of ['1', '2'] as const) {
          const row = fam[fare][cls] as Record<string, number>;
          expect(Object.keys(row)).toEqual(TICKET_KEYS);
          expect(nonDecreasing(TICKET_KEYS.map((k) => row[k]!))).toBe(true);
        }
      }
    }
    expect(Object.keys(table.tickets.validityHours)).toEqual(TICKET_KEYS);
  });

  it('pass rows have 12 columns, non-decreasing with zones', () => {
    for (const [period, cats] of Object.entries(table.passes)) {
      for (const [cat, classes] of Object.entries(cats as Record<string, Record<string, Record<string, number>>>)) {
        expect(Object.keys(classes).length, `${period}/${cat}`).toBeGreaterThan(0);
        for (const [cls, row] of Object.entries(classes)) {
          expect(Object.keys(row), `${period}/${cat}/${cls}`).toEqual(PASS_KEYS);
          expect(nonDecreasing(PASS_KEYS.map((k) => row[k]!))).toBe(true);
        }
      }
    }
  });

  it('junior has only 2nd class', () => {
    for (const period of Object.values(table.passes)) {
      expect(Object.keys(period.junior)).toEqual(['2']);
    }
  });

  it('1st class costs at least 2nd class', () => {
    for (const fare of ['full', 'half'] as const) {
      for (const k of TICKET_KEYS) {
        const t = table.tickets.single[fare];
        expect(t['1'][k as keyof typeof t['1']]).toBeGreaterThanOrEqual(t['2'][k as keyof typeof t['2']]);
      }
    }
  });
});
