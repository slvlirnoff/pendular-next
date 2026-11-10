import { describe, expect, it } from 'vitest';
import type { CompareResult } from '@pendular/engine';
import { summarise } from '../src/analyze.js';
import { resultsToCsv } from '../src/exportCsv.js';
import type { ResultRow } from '../src/types.js';

const car = { kind: 'car', durationMin: 18, itinerary: { legs: [] }, kmByMode: { car: 1.6 }, cost: { yearly: 3675, products: [] }, co2KgPerYear: 224 };

describe('summarise', () => {
  it('keeps the time of public transport that the planner left out as slower than walking', () => {
    const r = { options: [car], leftOut: [{ kind: 'transit', code: 'dominated', title: '', durationMin: 19, yearly: 729 }], verdict: {}, stamp: {} } as unknown as CompareResult;
    const f = summarise(r);
    expect(f.ptMin).toBe(19);
    expect(f.ptCost).toBe(729);
    expect(f.carMin).toBe(18);
    expect(f.ratioClass).toBe('upTo1_5');
  });
});

describe('resultsToCsv notes and coordinates', () => {
  const row = { personId: 1, extId: 'a', attrs: {}, lat: 46.5170783996582, lon: 6.6357245445251465, ptMin: null, ptChanges: null, ptDepartures: null, ptCost: null, ptProduct: null, boardStop: null, carMin: null, carKm: null, carCost: null, bikeMin: null, ebikeMin: null, walkMin: null, co2Pt: null, co2Car: null, ratioClass: 'noPt', error: null } as ResultRow;
  it('rounds coordinates and states the assumptions once under the table', () => {
    const l = resultsToCsv([row, { ...row, personId: 2, extId: 'b' }], { notes: ['Car minutes include x1.3'] }).slice(1).split('\r\n');
    expect(l[1]).toMatch(/^a,46\.517078,6\.635725,/);
    expect(l.filter((x) => x.startsWith('# '))).toEqual(['# Car minutes include x1.3']);
  });
});
