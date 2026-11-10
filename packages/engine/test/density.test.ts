import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARKING_THRESHOLDS,
  loadDensity,
  parkingAt,
  wgs84ToLv95,
  type ParkingThresholds,
} from '../src/density.js';

const density = loadDensity();
const at = (lat: number, lon: number) => density.around({ lat, lon });

describe('wgs84ToLv95', () => {
  it('puts the old Bern observatory at the LV95 origin', () => {
    const { e, n } = wgs84ToLv95(46.95108, 7.43864);
    expect(Math.abs(e - 2_600_000)).toBeLessThan(2);
    expect(Math.abs(n - 1_200_000)).toBeLessThan(2);
  });
});

describe('around (1 km sums)', () => {
  it('counts residents and jobs for a dense centre', () => {
    const lausanne = at(46.5167, 6.6291);
    expect(lausanne.residents).toBeGreaterThan(30_000);
    expect(lausanne.residents).toBeLessThan(40_000);
    expect(lausanne.jobs).toBeGreaterThan(40_000);
  });
  it('is small in a village', () => {
    const r = at(46.693, 6.862);
    expect(r.residents).toBeLessThan(1_000);
    expect(r.jobs).not.toBeNull();
  });
  it('is zero outside the country data', () => {
    expect(at(45.0, 7.0)).toEqual({ residents: 0, jobs: 0 });
  });
  it('is fast', () => {
    const t = performance.now();
    for (let i = 0; i < 2000; i++) at(46.5167 + i * 1e-5, 6.6291);
    expect((performance.now() - t) / 2000).toBeLessThan(1);
  });
});

describe('parkingAt with the residents rule', () => {
  it('gives 15 min in Lausanne centre', () => {
    expect(parkingAt(at(46.5167, 6.6291))).toEqual({ minutes: 15, kind: 'cityCentre' });
  });
  it('gives 10 min in Morges centre', () => {
    expect(parkingAt(at(46.5112, 6.4985))).toEqual({ minutes: 10, kind: 'townCentre' });
  });
  it('gives 5 min in a village', () => {
    expect(parkingAt(at(46.693, 6.862))).toEqual({ minutes: 5, kind: 'elsewhere' });
  });
  it('gives 5 min at EPFL by residents alone, but many jobs', () => {
    const epfl = at(46.5191, 6.5668);
    expect(parkingAt(epfl).kind).toBe('elsewhere');
    expect(epfl.jobs!).toBeGreaterThan(epfl.residents);
  });
  it('uses the limits as inclusive lower bounds', () => {
    const t = DEFAULT_PARKING_THRESHOLDS;
    expect(parkingAt({ residents: 20_000, jobs: null }, t).kind).toBe('cityCentre');
    expect(parkingAt({ residents: 19_999, jobs: null }, t).kind).toBe('townCentre');
    expect(parkingAt({ residents: 8_000, jobs: null }, t).kind).toBe('townCentre');
    expect(parkingAt({ residents: 7_999, jobs: null }, t).minutes).toBe(5);
  });
  it('can add jobs when asked, and falls back to residents without jobs data', () => {
    const combined: ParkingThresholds = { ...DEFAULT_PARKING_THRESHOLDS, measure: 'residentsAndJobs' };
    expect(parkingAt({ residents: 7_000, jobs: 11_000 }, combined).kind).toBe('townCentre');
    expect(parkingAt({ residents: 7_000, jobs: null }, combined).kind).toBe('elsewhere');
  });
});
