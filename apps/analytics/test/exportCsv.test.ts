import { describe, expect, it } from 'vitest';
import { resultsToCsv } from '../src/exportCsv.js';
import type { ResultRow } from '../src/types.js';

function row(p: Partial<ResultRow> = {}): ResultRow {
  return {
    personId: 1, extId: 'a1', attrs: {}, lat: 47.5, lon: 8.25,
    ptMin: null, ptChanges: null, ptDepartures: null, ptCost: null, ptProduct: null, boardStop: null,
    carMin: null, carKm: null, carCost: null, bikeMin: null, ebikeMin: null, walkMin: null,
    co2Pt: null, co2Car: null, ratioClass: 'noPt', error: null, ...p,
  };
}
const lines = (csv: string) => csv.slice(1).split('\r\n');

describe('resultsToCsv', () => {
  it('starts with a BOM and uses CRLF', () => {
    const csv = resultsToCsv([row()]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).not.toMatch(/[^\r]\n/);
    expect(lines(csv)).toHaveLength(3); // header, row, trailing empty
  });

  it('empty input gives only the header', () => {
    const l = lines(resultsToCsv([]));
    expect(l).toHaveLength(2);
    expect(l[0]).toBe(
      'id,latitude,longitude,pt_minutes,pt_changes,pt_departures_in_window,pt_yearly_cost_chf,pt_ticket,boarding_stop,car_minutes,car_km,car_yearly_cost_chf,bike_minutes,ebike_minutes,walk_minutes,co2_pt_kg_per_year,co2_car_kg_per_year,pt_vs_car,error',
    );
  });

  it('writes a full row with dot decimals and empty cells for null', () => {
    const csv = resultsToCsv([
      row({ ptMin: 42.5, ptChanges: 1, ptCost: 1234.5, boardStop: 'Zürich HB', carMin: 20, ratioClass: 'over2', co2Car: 1500 }),
    ]);
    expect(lines(csv)[1]).toBe('a1,47.5,8.25,42.5,1,,1234.5,,Zürich HB,20,,,,,,,1500,PT over 2x car,');
  });

  it('quotes fields with delimiter, quotes and line breaks, doubling quotes', () => {
    const csv = resultsToCsv([row({ extId: 'a,b', boardStop: 'say "hi"', error: 'l1\nl2' })]);
    const body = csv.slice(1);
    expect(body).toContain('"a,b",47.5');
    expect(body).toContain('"say ""hi"""');
    expect(body).toContain('"l1\nl2"');
  });

  it('guards against formula injection in text cells', () => {
    for (const bad of ['=SUM(A1)', '+1', '-1', '@x', '\tx', '\rx']) {
      const csv = resultsToCsv([row({ extId: bad })]);
      const cell = lines(csv)[1]!;
      expect(cell.startsWith("'") || cell.startsWith(`"'`)).toBe(true);
    }
    const csv = resultsToCsv([row({ extId: 'ok', attrs: { d: '=cmd' }, error: '-x' })], { attributeColumns: ['d'] });
    expect(lines(csv)[1]).toBe("ok,'=cmd,47.5,8.25" + ','.repeat(15) + "No PT,'-x");
  });

  it('does not touch numbers (negative values stay numeric)', () => {
    const csv = resultsToCsv([row({ lon: -1.5 })]);
    expect(lines(csv)[1]!.split(',')[2]).toBe('-1.5');
  });

  it('uses ; as delimiter and quotes accordingly', () => {
    const csv = resultsToCsv([row({ extId: 'a;b', boardStop: 'x,y', ratioClass: 'upTo1_5' })], { delimiter: ';', lang: 'de' });
    const [h, r] = lines(csv);
    expect(h!.split(';')[0]).toBe('id');
    expect(h!.split(';')[1]).toBe('breitengrad');
    expect(r).toBe('"a;b";47.5;8.25;;;;;;x,y;;;;;;;;;OeV bis 1,5x Auto;');
  });

  it('attribute columns: union in first-seen order, or the given list', () => {
    const rows = [row({ extId: 'a', attrs: { dep: 'X', shift: 'N' } }), row({ extId: 'b', attrs: { site: 'S', dep: 'Y' } })];
    const auto = lines(resultsToCsv(rows));
    expect(auto[0]!.startsWith('id,dep,shift,site,latitude')).toBe(true);
    expect(auto[1]!.startsWith('a,X,N,,47.5')).toBe(true);
    expect(auto[2]!.startsWith('b,Y,,S,47.5')).toBe(true);
    const given = lines(resultsToCsv(rows, { attributeColumns: ['site'] }));
    expect(given[0]!.startsWith('id,site,latitude')).toBe(true);
    expect(given[2]!.startsWith('b,S,47.5')).toBe(true);
  });

  it('translates headers and avoids the eszett', () => {
    for (const lang of ['en', 'fr', 'de', 'it'] as const) {
      const h = lines(resultsToCsv([], { lang }))[0]!;
      expect(h.split(',')).toHaveLength(19);
      expect(h).not.toContain('ß');
    }
    expect(lines(resultsToCsv([], { lang: 'fr' }))[0]!).toContain('erreur');
    expect(lines(resultsToCsv([], { lang: 'it' }))[0]!).toContain('errore');
    expect(lines(resultsToCsv([], { lang: 'de' }))[0]!).toContain('fehler');
  });
});
