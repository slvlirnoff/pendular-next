import { describe, expect, it } from 'vitest';
import { co2Factor, co2KgPerYear } from '../src/environment/co2.js';
import data from '../data/factors/co2.json' with { type: 'json' };

const F = data.factors as unknown as Record<string, { value: number | null }>;
const v = (k: string): number => F[k]?.value as number;

describe('co2Factor mapping', () => {
  it('maps rail by category', () => {
    for (const c of ['IC', 'IR', 'EC', 'ICE', 'TGV', 'ir']) expect(co2Factor('rail', { category: c })?.key).toBe('rail_long');
    expect(co2Factor('rail', { category: 'S' })?.key).toBe('rail_regional');
    expect(co2Factor('rail', { category: 'RE' })?.key).toBe('rail_regional');
    expect(co2Factor('rail')?.key).toBe('rail_regional');
    expect(co2Factor('rail', { category: 'IR' })?.gPerKm).toBe(v('rail_long'));
  });
  it('defaults bus to a real factor and uses vkm only for car', () => {
    expect(co2Factor('bus')?.gPerKm).toBeGreaterThan(0);
    expect(co2Factor('car')?.basis).toBe('vkm');
    expect(co2Factor('tram')?.basis).toBe('pkm');
  });
  it('follows fallbacks for modes absent from the source', () => {
    expect(F.metro?.value).toBeNull();
    expect(co2Factor('metro')?.key).toBe('tram');
    expect(co2Factor('funicular')?.key).toBe('cableway');
    expect(co2Factor('bus')?.key).toBe('bus_city');
  });
  it('walk is zero', () => {
    expect(co2Factor('walk')?.gPerKm).toBe(0);
  });
  it('spot checks against mobitool v3.1 (2025-04-08)', () => {
    expect(co2Factor('rail', { category: 'IC' })?.gPerKm).toBeCloseTo(6.8154, 3);
    expect(co2Factor('tram')?.gPerKm).toBeCloseTo(42.793, 2);
    expect(co2Factor('bike')?.gPerKm).toBeCloseTo(5.58, 2);
  });
});

describe('co2KgPerYear', () => {
  it('sums km x factor x trips / 1000', () => {
    const expected = ((10 * v('rail_regional') + 2 * v('tram') + 1 * v('walk')) * 400) / 1000;
    expect(co2KgPerYear({ rail: 10, tram: 2, walk: 1 }, 400)).toBeCloseTo(expected, 9);
  });
  it('uses the hint for rail', () => {
    expect(co2KgPerYear({ rail: 50 }, 100, { category: 'IC' })).toBeCloseTo((50 * v('rail_long') * 100) / 1000, 9);
  });
  it('is zero for empty input or zero trips', () => {
    expect(co2KgPerYear({}, 500)).toBe(0);
    expect(co2KgPerYear({ car: 20 }, 0)).toBe(0);
  });
  it('car counts per vehicle-km', () => {
    expect(co2KgPerYear({ car: 20 }, 10)).toBeCloseTo((20 * v('car') * 10) / 1000, 9);
  });
});
