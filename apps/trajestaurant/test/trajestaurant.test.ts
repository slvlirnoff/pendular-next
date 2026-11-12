import { describe, expect, it } from 'vitest';
import { classify, FOODS, matchFoods } from '../src/foods.js';
import { fold } from '../src/text.js';
import { transitToPlaces, usefulTransit } from '../server/estimate.js';
import { referenceMonday, routingDate } from '../server/timetable.js';
import { atpPlace, brandFromName, centre, keepOverture, osmObject, osmPlace, overtureCuisines, overtureKind, overturePlace, sameName, type Brands } from '../import/build.js';
import { KIND_SEARCHES, kindInfo, mainKind, matchKinds } from '../src/kinds.js';
import { searchKey } from '../src/text.js';
import { maxMinutes, onePlace, Ttl } from '../server/search.js';
import { valhallaCar, withFallback, type CarRouter } from '../server/car.js';

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

  it('keeps named places of the kinds it shows, with their address', () => {
    const place = osmPlace({
      id: 'n1',
      geometry: { type: 'Point', coordinates: [6.84, 46.71] },
      properties: { amenity: 'restaurant', name: 'Pizzeria du Pont', 'addr:street': 'Rue du Pont', 'addr:housenumber': '2', 'addr:city': 'Lucens', opening_hours: 'Mo-Su 11:00-22:00' },
    });
    expect(place).toMatchObject({ sourceId: 'n1', name: 'Pizzeria du Pont', kindKey: 'amenity', kind: 'restaurant' });
    expect(place!.tags['addr:city']).toBe('Lucens');
    const shop = osmPlace({ id: 'w2', geometry: { type: 'Point', coordinates: [6.84, 46.71] }, properties: { shop: 'shoes', brand: 'Dosenbach' } });
    expect(shop).toMatchObject({ name: 'Dosenbach', kindKey: 'shop', kind: 'shoes' });
    expect(osmPlace({ id: 'n3', geometry: { type: 'Point', coordinates: [6.84, 46.71] }, properties: { amenity: 'restaurant' } })).toBeNull();
    expect(osmPlace({ id: 'n4', geometry: { type: 'Point', coordinates: [6.84, 46.71] }, properties: { amenity: 'vending_machine', name: 'Robidog' } })).toBeNull();
  });

  it('reads All The Places branches, street and number in one', () => {
    const a = atpPlace({
      id: 'x',
      geometry: { type: 'Point', coordinates: [6.94, 46.82] },
      properties: { '@spider': 'migros_ch', ref: '42', shop: 'supermarket', name: 'Migros', brand: 'Migros', 'brand:wikidata': 'Q680727', 'addr:street_address': 'Rue de Lausanne 6', opening_hours: 'Mo-Sa 08:00-19:00' },
    });
    expect(a).toMatchObject({ source: 'atp', sourceId: 'migros_ch:42', kindKey: 'shop', kind: 'supermarket' });
    expect(a!.tags['addr:street']).toBe('Rue de Lausanne 6');
  });
});

describe('Overture', () => {
  it('maps categories to OSM kinds, leaving out wineries', () => {
    expect(overtureKind('pizza_restaurant', 'restaurant')).toEqual({ kindKey: 'amenity', kind: 'restaurant' });
    expect(overtureKind('doner_kebab_restaurant', 'restaurant')).toEqual({ kindKey: 'amenity', kind: 'fast_food' });
    expect(overtureKind('sushi_bar', 'restaurant')).toEqual({ kindKey: 'amenity', kind: 'restaurant' });
    expect(overtureKind('coffee_shop', 'coffee_shop')).toEqual({ kindKey: 'amenity', kind: 'cafe' });
    expect(overtureKind('wine_bar', 'bar')).toEqual({ kindKey: 'amenity', kind: 'bar' });
    expect(overtureKind('bakery', 'casual_eatery')).toEqual({ kindKey: 'shop', kind: 'bakery' });
    expect(overtureKind('winery', 'winery')).toBeNull();
  });

  it('turns categories into cuisines and food types', () => {
    expect(overtureCuisines(['pizza_restaurant'])).toContain('pizza');
    const o = overturePlace({
      id: 'ov1', name: 'Sherlock Pizza Kebab Burger', category: 'pizza_restaurant', basic_category: 'restaurant', alternates: ['burger_restaurant'],
      confidence: 0.75, brand: null, brand_wikidata: null, website: null, phone: '+41 77 955 34 99', street: null, postcode: '1522', locality: 'Lucens', lat: 46.71, lon: 6.839,
    });
    expect([...o!.extraFoods]).toEqual(expect.arrayContaining(['pizza', 'burger', 'kebab']));
  });

  it('keeps an unknown place when confident, or less so with a way to reach it', () => {
    expect(keepOverture({ confidence: 0.7, tags: {} })).toBe(true);
    expect(keepOverture({ confidence: 0.5, tags: {} })).toBe(false);
    expect(keepOverture({ confidence: 0.5, tags: { phone: '+41' } })).toBe(true);
    // Grill House, Lucens.
    expect(keepOverture({ confidence: 0.3, tags: { phone: '+41', website: 'https://grillhouselucens.com/' } })).toBe(true);
    expect(keepOverture({ confidence: 0.2, tags: { phone: '+41', website: 'x' } })).toBe(false);
  });

  it('knows two names of one place, not two places of one street', () => {
    expect(sameName('Café du Poids', 'Cafe du Poids')).toBe(true);
    expect(sameName('Sherlock Pizza Kebab Burger', 'Sherlock')).toBe(true);
    expect(sameName('Restaurant du Pont', 'Pont')).toBe(true);
    expect(sameName('Vesuvio Pizza Lucens', 'De la Gare - La Table des Suter')).toBe(false);
    expect(sameName('Restaurant', 'Restaurant')).toBe(true);
    expect(sameName('Pizzeria', 'Restaurant')).toBe(false);
  });
});

describe('brands', () => {
  const nsi: Brands = {
    byWikidata: new Map([['Q680727', new Map([['shop=supermarket', { name: 'Migros', kindKey: 'shop', kind: 'supermarket', aliases: ['migros'] }]])]]),
    byName: new Map([['shop=supermarket|migros', 'Q680727']]),
  };

  it('names the brand of a place tagged with its name only', () => {
    expect(brandFromName(nsi, { kindKey: 'shop', kind: 'supermarket', name: 'Migros Lucens', tags: {} })).toBe('Q680727');
    expect(brandFromName(nsi, { kindKey: 'shop', kind: 'supermarket', name: 'MIGROS', tags: {} })).toBe('Q680727');
    // Same name, another kind: not the supermarket chain.
    expect(brandFromName(nsi, { kindKey: 'amenity', kind: 'restaurant', name: 'Migros', tags: {} })).toBeNull();
    expect(brandFromName(nsi, { kindKey: 'shop', kind: 'supermarket', name: 'Épicerie du village', tags: {} })).toBeNull();
  });

  it('gives shops a pictogram and a label', () => {
    expect(kindInfo('shop', 'shoes')).toEqual({ emoji: '👟', label: 'Chaussures' });
    expect(kindInfo('shop', 'something_new').label).toBe('Magasin');
    expect(mainKind({ amenity: 'vending_machine', shop: 'kiosk' })).toEqual({ kindKey: 'shop', kind: 'kiosk' });
    expect(mainKind({ amenity: 'parking' })).toBeNull();
  });

  it('searches names without punctuation', () => {
    expect(searchKey('Mix-Image')).toBe('mix image');
    expect(searchKey("McDonald's")).toBe('mcdonald s');
  });

  it('looks far enough for a far branch, no further', () => {
    expect(maxMinutes(400, 9_000)).toEqual({ walk: 60, car: 30, transit: 90 });
    // The nearest IKEA from Lucens: 43 km.
    expect(maxMinutes(43_000, 120_000)).toEqual({ walk: 60, car: 171, transit: 148 });
  });
});

describe('car times', () => {
  const fakeFetch = (body: unknown, ok = true) =>
    (async () => ({ ok, status: ok ? 200 : 500, json: async () => body, text: async () => JSON.stringify(body) })) as unknown as typeof fetch;

  it('reads a Valhalla matrix in minutes, null for places out of reach', async () => {
    const car = valhallaCar('http://valhalla', fakeFetch({ sources_to_targets: [[{ time: 600 }, { time: null }]] }));
    expect(await car.matrix({ lat: 46.7, lon: 6.8 }, [{ lat: 46.8, lon: 6.9 }, { lat: 47, lon: 7 }], 60)).toEqual([10, null]);
  });

  it('falls back on MOTIS when Valhalla fails', async () => {
    const broken = valhallaCar('http://valhalla', fakeFetch({ error: 'down' }, false));
    const backup: CarRouter = { name: 'motis', matrix: async (_f, pts) => pts.map(() => 7), route: async () => null };
    const car = withFallback(broken, backup);
    expect(await car.matrix({ lat: 46.7, lon: 6.8 }, [{ lat: 46.8, lon: 6.9 }], 60)).toEqual([7]);
  });

  it('forgets cached values after their time', () => {
    const c = new Ttl<number>(1000, 2);
    c.set('a', 1);
    expect(c.get('a')).toBe(1);
    c.set('b', 2);
    c.set('c', 3);
    // Beyond its size the oldest goes.
    expect(c.get('a')).toBeUndefined();
    expect(c.get('c')).toBe(3);
  });
});

describe('kinds of shops and places', () => {
  it('finds kinds from what is typed, in several languages', () => {
    expect(matchKinds('pharm')[0]).toBe('pharmacie');
    expect(matchKinds('Apotheke')[0]).toBe('pharmacie');
    expect(matchKinds('coiff')[0]).toBe('coiffeur');
    expect(matchKinds('essence')[0]).toBe('station');
    expect(matchKinds('Tankstelle')[0]).toBe('station');
    expect(matchKinds('poste')[0]).toBe('poste');
    expect(matchKinds('Schuhe')[0]).toBe('chaussures');
    expect(matchKinds('migros')).toEqual([]);
  });

  it('has unique keys, folded synonyms and OSM kinds that are kept', () => {
    expect(new Set(KIND_SEARCHES.map((k) => k.key)).size).toBe(KIND_SEARCHES.length);
    for (const k of KIND_SEARCHES) {
      for (const s of k.synonyms) expect(fold(s)).toBe(s);
      for (const kv of k.kinds) {
        const [key, value] = kv.split('=') as [string, string];
        expect(mainKind({ [key]: value }), kv).not.toBeNull();
      }
    }
  });

  it('shows a shop two sources place a few metres apart once, two shops of a mall twice', () => {
    const row = (id: string, name: string, lat: number, sources: string[]) =>
      ({ id, name, kind_key: 'shop', kind: 'hairdresser', brand: null, brand_key: null, sources, town: 'Lucens', lat, lon: 6.84, opening_hours: null, foods: [], dist: lat * 1000 }) as Parameters<typeof onePlace>[0][number];
    const out = onePlace([row('1', 'Coiffure Sandra', 46.7, ['osm']), row('2', 'Sandra Coiffure', 46.7002, ['overture']), row('3', 'Bea coiffure', 46.7001, ['osm'])]);
    expect(out.map((r) => r.name).sort()).toEqual(['Bea coiffure', 'Coiffure Sandra']);
  });
});
