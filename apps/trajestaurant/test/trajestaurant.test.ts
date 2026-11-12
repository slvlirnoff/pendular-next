import { describe, expect, it } from 'vitest';
import { classify, FOODS, matchFoods } from '../src/foods.js';
import { fold } from '../src/text.js';
import { transitToPlaces, usefulTransit } from '../server/estimate.js';
import { referenceMonday, routingDate } from '../server/timetable.js';
import { centre, osmObject, toRow } from '../import/load.js';

describe('food types', () => {
  it('reads the OSM cuisine, several values included', () => {
    expect(classify({ amenity: 'restaurant', name: 'La Forge', cuisine: 'pizza;burger;kebab' })).toEqual(['pizza', 'burger', 'kebab', 'restaurant']);
  });

  it('reads the name when there is no cuisine', () => {
    expect(classify({ amenity: 'restaurant', name: 'Pizzeria Vesuvio' })).toContain('pizza');
    expect(classify({ amenity: 'fast_food', name: 'Sherlock Kebab' })).toContain('kebab');
    expect(classify({ amenity: 'restaurant', name: 'Thai Garden' })).toEqual(['asiatique', 'thai', 'restaurant']);
  });

  it('knows the chains', () => {
    expect(classify({ amenity: 'fast_food', name: "McDonald's", brand: "McDonald's" })).toEqual(['burger', 'fastfood']);
    expect(classify({ amenity: 'fast_food', name: 'Brezelkönig' })).toContain('sandwich');
    expect(classify({ amenity: 'fast_food', name: 'KFC' })).toContain('poulet');
  });

  it('does not take a citizens’ hall for a burger place', () => {
    expect(classify({ amenity: 'restaurant', name: 'Restaurant Burgerstube' })).not.toContain('burger');
    expect(classify({ amenity: 'restaurant', name: 'Zum Fischer' })).not.toContain('poisson');
  });

  it('sends a Turkish fast food to kebab and a Turkish restaurant to the oriental ones', () => {
    expect(classify({ amenity: 'fast_food', name: 'Anatolia', cuisine: 'turkish' })).toContain('kebab');
    expect(classify({ amenity: 'restaurant', name: 'Anatolia', cuisine: 'turkish' })).toContain('oriental');
  });

  it('gives every place its kind', () => {
    expect(classify({ amenity: 'cafe', name: 'Café du Commerce' })).toEqual(['cafe']);
    expect(classify({ amenity: 'ice_cream', name: 'Da Mario' })).toEqual(['glace']);
  });

  it('has one emoji, a label and a unique key per type', () => {
    expect(new Set(FOODS.map((f) => f.key)).size).toBe(FOODS.length);
    for (const f of FOODS) {
      expect(f.emoji).not.toBe('');
      expect(f.label).not.toBe('');
      for (const s of f.synonyms) expect(fold(s)).toBe(s);
    }
  });

  it('finds types from what is typed, in several languages', () => {
    expect(matchFoods('piz')[0]).toBe('pizza');
    expect(matchFoods('Burger')[0]).toBe('burger');
    expect(matchFoods('döner')[0]).toBe('kebab');
    expect(matchFoods('glaces')[0]).toBe('glace');
    expect(matchFoods('Fondue')[0]).toBe('fondue');
    expect(matchFoods('chinesisch')).toEqual(['chinois']);
    expect(matchFoods('')).toEqual([]);
  });
});

describe('timetable day', () => {
  const range = { firstDay: '2026-12-13', days: 364 };

  it('keeps a day the timetable covers', () => {
    expect(routingDate('2027-03-04', range)).toEqual({ date: '2027-03-04', typical: false });
  });

  it('uses the same weekday of the reference week otherwise', () => {
    expect(referenceMonday(range)).toBe('2027-01-18');
    // Thursday 12 November 2026 → Thursday 21 January 2027.
    expect(routingDate('2026-11-12', range)).toEqual({ date: '2027-01-21', typical: true });
    // Sunday → Sunday.
    expect(routingDate('2026-11-15', range)).toEqual({ date: '2027-01-24', typical: true });
  });
});

describe('public transport estimate', () => {
  it('takes the best stop near each place and adds the walk', () => {
    const stops = [
      { lat: 46.82, lon: 6.94, minutes: 20 },
      { lat: 46.821, lon: 6.94, minutes: 35 },
      { lat: 46.9, lon: 7.0, minutes: 5 },
    ];
    const [near, none] = transitToPlaces(stops, [
      { lat: 46.8225, lon: 6.94 },
      { lat: 46.5, lon: 6.6 },
    ]);
    // 278 m from the first stop: 20 min + about 5 min on foot.
    expect(near).toBe(25);
    expect(none).toBeNull();
  });

  it('drops public transport when walking is as fast', () => {
    expect(usefulTransit(12, 10)).toBeNull();
    expect(usefulTransit(12, null)).toBe(12);
    expect(usefulTransit(8, 30)).toBe(8);
  });
});

describe('OSM import', () => {
  it('names the OSM object behind an area id', () => {
    expect(osmObject('n42')).toBe('n42');
    expect(osmObject('a84')).toBe('w42');
    expect(osmObject('a85')).toBe('r42');
  });

  it('takes the centre of a building', () => {
    const c = centre({ type: 'Polygon', coordinates: [[[6, 46], [6.002, 46], [6.002, 46.002], [6, 46.002], [6, 46]]] });
    expect(c!.lat).toBeCloseTo(46.001, 6);
    expect(c!.lon).toBeCloseTo(6.001, 6);
  });

  it('keeps named food places only, with their address and types', () => {
    const row = toRow({
      id: 'n1',
      geometry: { type: 'Point', coordinates: [6.84, 46.71] },
      properties: { amenity: 'restaurant', name: 'Pizzeria du Pont', 'addr:street': 'Rue du Pont', 'addr:housenumber': '2', 'addr:city': 'Lucens', opening_hours: 'Mo-Su 11:00-22:00' },
    });
    expect(row).toMatchObject({ source_id: 'n1', name: 'Pizzeria du Pont', town: 'Lucens', street: 'Rue du Pont', foods: ['pizza', 'restaurant'] });
    expect(toRow({ id: 'n2', geometry: { type: 'Point', coordinates: [6.84, 46.71] }, properties: { amenity: 'restaurant' } })).toBeNull();
    expect(toRow({ id: 'n3', geometry: { type: 'Point', coordinates: [6.84, 46.71] }, properties: { amenity: 'bench', name: 'Banc' } })).toBeNull();
  });
});
