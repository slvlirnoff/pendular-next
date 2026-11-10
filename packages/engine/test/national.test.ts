import { describe, expect, it } from 'vitest';
import data from '../data/tariffs/national-2027.json' with { type: 'json' };
import {
  NATIONAL_VALID_FROM,
  distanceSingle,
  dayCardHalfFare,
  gaMonthly,
  gaYearly,
  gaYearly25,
  gaYearlyPrevious,
  halfFareCardYearly,
  halfFareCardYearlyPrevious,
  routePass,
} from '../src/fares/national.js';

describe('national tariffs valid from 13.12.2026 (Tarifmassnahmen page)', () => {
  it('has the right validity', () => expect(NATIONAL_VALID_FROM).toBe('2026-12-13'));
  it('GA yearly', () => {
    expect(gaYearly('adult', 2)).toBe(4095);
    expect(gaYearly('adult', 1)).toBe(6770);
    expect(gaYearly('youth', 2)).toBe(2875);
    expect(gaYearly('youth', 1)).toBe(4610);
    expect(gaYearly('senior', 2)).toBe(3260);
    expect(gaYearly('senior', 1)).toBe(5260);
    expect(gaYearly('child', 2)).toBe(1780);
    expect(gaYearly('child', 1)).toBe(2955);
    expect(gaYearly25(2)).toBe(3535);
    expect(gaYearly25(1)).toBe(5730);
  });
  it('GA monthly and day card', () => {
    expect(gaMonthly('adult', 2)).toBe(365);
    expect(gaMonthly('adult', 1)).toBe(585);
    expect(dayCardHalfFare(2)).toBe(81);
    expect(dayCardHalfFare(1)).toBe(134);
  });
  it('Half Fare card', () => {
    expect(halfFareCardYearly('adult')).toBe(195);
    expect(halfFareCardYearly('senior', { renewal: true })).toBe(175);
    expect(halfFareCardYearly('youth')).toBeNull();
    expect(halfFareCardYearly('child')).toBeNull();
  });
});

describe('previous (01.06.2026 edition) values', () => {
  it('GA / Half Fare', () => {
    expect(gaYearlyPrevious('adult', 2)).toBe(3995);
    expect(gaYearlyPrevious('adult', 1)).toBe(6520);
    expect(halfFareCardYearlyPrevious('youth')).toBe(120);
    expect(halfFareCardYearlyPrevious('youth', { renewal: true })).toBe(100);
  });
});

describe('T601 distance table (edition 01.06.2026)', () => {
  it('spot checks', () => {
    expect(distanceSingle(1, { travelClass: 2, half: false })).toBe(3);
    expect(distanceSingle(4, { travelClass: 1, half: false })).toBe(5.2);
    expect(distanceSingle(31, { travelClass: 2, half: false })).toBe(13.6);
    expect(distanceSingle(100, { travelClass: 2, half: false })).toBe(34);
    expect(distanceSingle(100, { travelClass: 1, half: false })).toBe(58);
    expect(distanceSingle(1000, { travelClass: 2, half: false })).toBe(229);
    expect(distanceSingle(100, { travelClass: 2, half: true })).toBe(17);
    expect(distanceSingle(1, { travelClass: 2, half: true })).toBe(2.2);
  });
  it('out of range is null', () => {
    expect(distanceSingle(0, { travelClass: 2, half: false })).toBeNull();
    expect(distanceSingle(1001, { travelClass: 2, half: false })).toBeNull();
  });
  it('bands contiguous, prices non-decreasing', () => {
    const rows = data.previous.distanceSingle.rows as number[][];
    expect(rows.length).toBe(93);
    expect(rows[0]?.[0]).toBe(1);
    expect(rows.at(-1)?.[1]).toBe(1000);
    rows.forEach((r, i) => {
      if (i === 0) return;
      const p = rows[i - 1] as number[];
      expect(r[0]).toBe((p[1] as number) + 1);
      expect(r[2]).toBeGreaterThanOrEqual(p[2] as number);
      expect(r[3]).toBeGreaterThanOrEqual(p[3] as number);
    });
  });
});

describe('T650 route passes (table 10.12.2023 in edition 01.06.2026)', () => {
  it('spot checks', () => {
    expect(routePass('year', 1, { travelClass: 2, category: 'adult' })).toBe(621);
    expect(routePass('month', 1, { travelClass: 1, category: 'adult' })).toBe(114);
    expect(routePass('month', 35, { travelClass: 2, category: 'adult' })).toBe(241);
    expect(routePass('year', 100, { travelClass: 1, category: 'adult' })).toBe(5571);
    expect(routePass('month', 240, { travelClass: 2, category: 'adult' })).toBe(645);
    expect(routePass('year', 20, { travelClass: 2, category: 'junior' })).toBe(1170);
    expect(routePass('month', 20, { travelClass: 2, category: 'junior' })).toBe(130);
    expect(routePass('month', 20, { travelClass: 1, category: 'junior' })).toBeNull();
    expect(routePass('month', 241, { travelClass: 2, category: 'adult' })).toBeNull();
  });
  it('bands contiguous, non-decreasing, year = 9 x month', () => {
    const rows = data.previous.routePass.rows as number[][];
    expect(rows.length).toBe(53);
    rows.forEach((r, i) => {
      expect(r[2]).toBe((r[4] as number) * 9);
      expect(r[3]).toBe((r[5] as number) * 9);
      expect(r[6]).toBe((r[7] as number) * 9);
      if (i === 0) return;
      const p = rows[i - 1] as number[];
      expect(r[0]).toBe((p[1] as number) + 1);
      for (let k = 2; k < 8; k++) expect(r[k]).toBeGreaterThanOrEqual(p[k] as number);
    });
  });
});
