import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { cheapestParkingPerYear, loadCityParkRide, loadParking, sitesNear } from '../src/places/parking.js';

const fixture = fileURLToPath(new URL('./fixtures/parking-sample.json', import.meta.url));
const sites = loadParking(fixture);
const byId = (id: string) => {
  const s = sites.find((x) => x.id === id);
  if (!s) throw new Error(`missing ${id}`);
  return s;
};

describe('loadParking', () => {
  it('loads the sample with both kinds', () => {
    expect(sites.length).toBe(13);
    expect(sites.some((s) => s.kind === 'parkRail')).toBe(true);
    expect(sites.some((s) => s.kind === 'bikeParking')).toBe(true);
  });
});

describe('cheapestParkingPerYear', () => {
  it('prefers the yearly price when cheapest (Lucens: 4/day, 40/month, 400/year)', () => {
    const lucens = byId('bdaccb51-66a7-42ef-b877-df5fff4a069a');
    expect(cheapestParkingPerYear(lucens, 220)).toEqual({ yearly: 400, basis: 'year' });
  });
  it('prefers the daily price with few working days', () => {
    const lucens = byId('bdaccb51-66a7-42ef-b877-df5fff4a069a');
    expect(cheapestParkingPerYear(lucens, 50)).toEqual({ yearly: 200, basis: 'day' });
  });
  it('ignores null prices', () => {
    expect(cheapestParkingPerYear({ prices: { day: null, month: 70, year: null } }, 220)).toEqual({ yearly: 840, basis: 'month' });
    expect(cheapestParkingPerYear({ prices: { day: null, month: null, year: null } }, 220)).toBeNull();
  });
  it('free car park costs 0 per year', () => {
    expect(cheapestParkingPerYear(byId('56a6f8f4-2fe9-4edf-8cb7-c7641fce5688'), 220)).toEqual({ yearly: 0, basis: 'day' });
  });
});

describe('sitesNear', () => {
  const lucens = { lat: 46.70806, lon: 6.84226 };
  it('filters by kind and radius, nearest first', () => {
    const r = sitesNear(sites, lucens, 15, 'parkRail');
    expect(r.map((x) => x.site.stationName)).toEqual(['Lucens', 'Moudon']);
    expect(r[0]?.distanceKm).toBeLessThan(0.05);
    expect(r[1]?.distanceKm).toBeGreaterThan(r[0]?.distanceKm ?? 0);
  });
  it('returns bike parking only for kind bikeParking', () => {
    const r = sitesNear(sites, lucens, 5, 'bikeParking');
    expect(r.map((x) => x.site.id)).toEqual(['bike-8504121']);
  });
  it('returns nothing when the radius is too small', () => {
    expect(sitesNear(sites, { lat: 47, lon: 8 }, 1, 'parkRail')).toEqual([]);
  });
});

describe('loadCityParkRide', () => {
  it('holds the five Lausanne sites as transcribed from lausanne.ch', () => {
    const c = loadCityParkRide();
    expect(c).toHaveLength(5);
    const vennes = c.find((s) => s.name === 'P+R Vennes')!;
    // Vennes is parking only, sold by the year.
    expect(vennes.prices).toEqual({ day: null, month: null, year: 990 });
    expect(vennes.includesTransit.month).toBe(false);
    for (const s of c.filter((x) => x !== vennes)) {
      expect(s.prices).toEqual({ day: null, month: 130, year: null });
      expect(s.includesTransit.month).toBe(true);
      expect(s.zones).toEqual([11, 12]);
    }
  });
});
