import { describe, expect, it } from 'vitest';
import { classify, FOODS, matchFoods } from '../src/foods.js';
import { fold } from '../src/text.js';
import { transitToPlaces, usefulTransit } from '../server/estimate.js';
import { referenceMonday, routingDate } from '../server/timetable.js';
import { atpPlace, bankAtm, extraOf, pictureUrl, brandFromName, carSharingPlace, centre, Grid, keepOverture, kindFromName, osmObject, osmPlace, overtureCuisines, overtureKind, overturePlace, overtureTrust, sameName, type Brands, type OvertureRow, type Place } from '../import/build.js';
import { KIND_SEARCHES, kindGroup, kindInfo, mainKind, matchKinds } from '../src/kinds.js';
import { searchKey } from '../src/text.js';
import { maxMinutes, onePlace, Ttl } from '../server/search.js';
import { bestMode, leadMode, sortResults } from '../web/src/lib.js';
import type { SearchResult } from '../src/api.js';
import { valhallaCar, withFallback, type CarRouter } from '../server/car.js';
import { clockOf, createTraffic, rushShare } from '../server/traffic.js';
import { createCarSharing } from '../server/sharing.js';
import { weekHours } from '../server/open.js';
import { loadDensity } from '@pendular/engine';

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

  it('names a place without a name after its operator, or its kind when that is what one looks for', () => {
    const post = osmPlace({ id: 'n14138811681', geometry: { type: 'Point', coordinates: [6.8406, 46.7094] }, properties: { amenity: 'post_office', operator: 'Die Post', 'operator:fr': 'La Poste' } });
    expect(post).toMatchObject({ name: 'La Poste', kind: 'post_office', unnamed: true });
    expect(osmPlace({ id: 'n5', geometry: { type: 'Point', coordinates: [6.84, 46.71] }, properties: { amenity: 'pharmacy' } })).toMatchObject({ name: 'Pharmacie', unnamed: true });
    // Not an unnamed restaurant, nor a garden pool.
    expect(osmPlace({ id: 'n6', geometry: { type: 'Point', coordinates: [6.84, 46.71] }, properties: { amenity: 'restaurant' } })).toBeNull();
    expect(osmPlace({ id: 'n7', geometry: { type: 'Point', coordinates: [6.84, 46.71] }, properties: { leisure: 'swimming_pool' } })).toBeNull();
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
        expect(mainKind({ [key]: value, ...(kv === 'amenity=recycling' ? { recycling_type: 'centre' } : {}) }), kv).not.toBeNull();
      }
    }
  });

  it('shows a shop two sources place a few metres apart once, two shops of a mall twice', () => {
    const row = (id: string, name: string, lat: number, sources: string[]) =>
      ({ id, name, kind_key: 'shop', kind: 'hairdresser', brand: null, brand_key: null, sources, source: 'osm', source_id: `n${id}`, town: 'Lucens', lat, lon: 6.84, opening_hours: null, foods: [], dist: lat * 1000 }) as Parameters<typeof onePlace>[0][number];
    const out = onePlace([row('1', 'Coiffure Sandra', 46.7, ['osm']), row('2', 'Sandra Coiffure', 46.7002, ['overture']), row('3', 'Bea coiffure', 46.7001, ['osm'])]);
    expect(out.map((r) => r.name).sort()).toEqual(['Bea coiffure', 'Coiffure Sandra']);
  });
});

describe('sorting', () => {
  const r = (name: string, walkMin: number | null, transitMin: number | null, carMin: number | null, distanceM: number) =>
    ({ name, walkMin, transitMin, carMin, distanceM }) as unknown as SearchResult;

  it('counts walking as going without a car in the public transport sort', () => {
    const list = [r('Poste Moudon', null, 31, 6, 5335), r('La Poste Lucens', 2, null, 1, 105), r('Poste Romont', null, 92, 11, 6164)];
    expect(sortResults(list, 'transit').map((x) => x.name)).toEqual(['La Poste Lucens', 'Poste Moudon', 'Poste Romont']);
    expect(leadMode(list[1]!, 'transit')).toBe('walk');
  });

  it('falls back on public transport in the walking sort when a place is too far to walk', () => {
    const list = [r('Moudon', null, 31, 6, 5335), r('Lucens', 9, null, 1, 480), r('Romont', null, 92, 11, 6164)];
    expect(sortResults(list, 'walk').map((x) => x.name)).toEqual(['Lucens', 'Moudon', 'Romont']);
    expect(leadMode(list[0]!, 'walk')).toBe('transit');
  });

  it('shows a short walk first; car times already hold parking', () => {
    // Car times as the server gives them: a minute or two of driving and 5 minutes to park.
    const list = [r('Midi 480 m', 9, null, 6, 480), r('Bea 70 m', 2, null, 6, 70), r('Imaginatifs 830 m', 16, null, 7, 830), r('Moudon', null, 40, 11, 5500)];
    expect(sortResults(list, 'best').map((x) => x.name)).toEqual(['Bea 70 m', 'Imaginatifs 830 m', 'Midi 480 m', 'Moudon']);
    expect(bestMode(list[0]!)).toBe('walk');
  });

  it('sorts by bike, falling back on public transport beyond cycling distance; the quickest leaves the bike out', () => {
    const withBike = (x: SearchResult, bikeMin: number | null) => ({ ...x, bikeMin }) as SearchResult;
    const list = [withBike(r('Moudon', null, 31, 11, 5400), 22), withBike(r('Lucens', 9, null, 6, 480), 3), withBike(r('Lausanne', null, 45, 38, 26000), null)];
    expect(sortResults(list, 'bike').map((x) => x.name)).toEqual(['Lucens', 'Moudon', 'Lausanne']);
    expect(leadMode(list[2]!, 'bike')).toBe('transit');
    expect(leadMode(list[0]!, 'bike')).toBe('bike');
    // Not everyone has a bike at hand: "le plus rapide" stays with walking, public transport and the car.
    expect(bestMode(withBike(r('Moudon', null, 31, 25, 5400), 22))).toBe('car');
  });
});

describe('car times with traffic and parking', () => {
  it('applies all of the rush-hour slow-down at the peaks, less at other times', () => {
    // Thursday 12 November 2026.
    expect(clockOf('2026-11-12', '17:30')).toEqual({ weekday: 4, minutes: 1050 });
    expect(rushShare(4, 7 * 60 + 30)).toBe(1);
    expect(rushShare(4, 17 * 60 + 30)).toBe(1);
    expect(rushShare(4, 14 * 60)).toBe(0.6);
    expect(rushShare(4, 23 * 60)).toBe(0.2);
    expect(rushShare(6, 14 * 60)).toBe(0.5);
    expect(rushShare(0, 14 * 60)).toBe(0.25);
  });

  it('slows a city drive more than a country one, and parks longer in a city centre', () => {
    const density = loadDensity();
    const peak = createTraffic(density, 4, 8 * 60);
    const night = createTraffic(density, 4, 2 * 60);
    // Lausanne, Flon → Ouchy: city centre all the way.
    const city = peak.car(10, [[6.6295, 46.5206], [6.627, 46.507]], { lat: 46.507, lon: 6.627 });
    // Lucens → Moudon: open country.
    const country = peak.car(10, [[6.8405, 46.7085], [6.797, 46.668]], { lat: 46.668, lon: 6.797 });
    expect(city.factor).toBeGreaterThan(country.factor);
    expect(city.parkingMin).toBeGreaterThan(country.parkingMin);
    expect(city.totalMin).toBe(city.drivingMin + city.parkingMin);
    const cityNight = night.car(10, [[6.6295, 46.5206], [6.627, 46.507]], { lat: 46.507, lon: 6.627 });
    expect(cityNight.factor).toBeLessThan(city.factor);
    expect(cityNight.factor).toBeGreaterThan(1);
  });
});

describe('car sharing', () => {
  it('names a station after its provider and place, a 2EM car after its street', () => {
    const base = { provider_url: 'https://www.mobility.ch', rental_uri: null, lat: 46.708, lon: 6.842 };
    const mobility = carSharingPlace({ ...base, provider: 'mobility', provider_name: 'Mobility', station_id: '70844', name: 'Lucens Gare', address: null });
    expect(mobility).toMatchObject({ source: 'gbfs', sourceId: 'mobility:70844', name: 'Mobility · Lucens Gare', kind: 'car_sharing' });
    expect(mobility!.tags.brand).toBe('Mobility');
    const twoEm = carSharingPlace({ ...base, provider: '2em_cars', provider_name: '2EM Car Sharing', station_id: '70', name: ' velo 1995', address: 'Rue de la Serre 11, 2000 Neuchâtel, Suisse' });
    expect(twoEm!.name).toBe('2EM · Rue de la Serre 11');
  });

  it('counts the cars at a station from the feed, and nothing without a contact address', async () => {
    const feed = (async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.endsWith('vehicle_types')
          ? { data: { vehicle_types: [{ vehicle_type_id: 'c', form_factor: 'car' }, { vehicle_type_id: 'b', form_factor: 'cargo_bicycle' }] } }
          : { data: { stations: [{ station_id: '1', vehicle_types_available: [{ vehicle_type_id: 'c', count: 2 }, { vehicle_type_id: 'b', count: 3 }] }] } },
      text: async () => '',
    })) as unknown as typeof fetch;
    expect(await createCarSharing('someone@example.org', feed).cars('carvelo2go:1')).toBe(2);
    expect(await createCarSharing(undefined, feed).cars('carvelo2go:1')).toBeNull();
  });
});

describe('services', () => {
  it('reads the kinds tagged in more than one way as the one searched', () => {
    expect(mainKind({ healthcare: 'doctor' })).toEqual({ kindKey: 'amenity', kind: 'doctors' });
    expect(mainKind({ amenity: 'doctors', healthcare: 'doctor' })).toEqual({ kindKey: 'amenity', kind: 'doctors' });
    expect(mainKind({ office: 'physician' })).toEqual({ kindKey: 'amenity', kind: 'doctors' });
    expect(mainKind({ healthcare: 'physiotherapist' })).toEqual({ kindKey: 'healthcare', kind: 'physiotherapist' });
    expect(mainKind({ craft: 'shoemaker' })).toEqual({ kindKey: 'craft', kind: 'shoemaker' });
    // A shop that is also a craft is the shop.
    expect(mainKind({ shop: 'bakery', craft: 'bakery' })).toEqual({ kindKey: 'shop', kind: 'bakery' });
    expect(mainKind({ office: 'company' })).toBeNull();
  });

  it('keeps recycling centres, not the street containers', () => {
    expect(mainKind({ amenity: 'recycling', recycling_type: 'centre' })).toEqual({ kindKey: 'amenity', kind: 'recycling' });
    expect(mainKind({ amenity: 'recycling', recycling_type: 'container' })).toBeNull();
  });

  it('finds them by what one types', () => {
    expect(matchKinds('vétérinaire')[0]).toBe('veterinaire');
    expect(matchKinds('Tierarzt')[0]).toBe('veterinaire');
    expect(matchKinds('urgences')[0]).toBe('hopital');
    expect(matchKinds('ostéopathe')[0]).toBe('medecines-douces');
    expect(matchKinds('bancomat')[0]).toBe('bancomat');
    expect(matchKinds('déchetterie')[0]).toBe('dechetterie');
    expect(matchKinds('plombier')[0]).toBe('sanitaire');
    expect(matchKinds('cordonnier')[0]).toBe('cordonnier');
    expect(KIND_SEARCHES.find((k) => k.key === 'medecin')?.group).toBe('health');
    expect(KIND_SEARCHES.find((k) => k.key === 'commune')?.group).toBe('service');
  });

  it('groups kinds by their search', () => {
    expect(kindGroup('shop', 'lighting')).toBe('meubles');
    expect(kindGroup('shop', 'car')).toBe('garage');
    expect(kindGroup('shop', 'car_repair')).toBe('garage');
    expect(kindGroup('shop', 'yes')).toBe('shop=yes');
  });

  it("lists a bank's cash machine as a Bancomat", () => {
    const bank = osmPlace({ id: 'n7', geometry: { type: 'Point', coordinates: [6.84, 46.71] }, properties: { amenity: 'bank', name: 'BCV', atm: 'yes', opening_hours: 'Mo-Fr 08:30-12:00' } })!;
    const atm = bankAtm(bank, { amenity: 'bank', atm: 'yes' })!;
    expect(atm).toMatchObject({ kindKey: 'amenity', kind: 'atm', name: 'BCV', sourceId: 'n7#atm' });
    expect(atm.tags.opening_hours).toBeUndefined();
    expect(bankAtm(bank, { amenity: 'bank' })).toBeNull();
  });
});

describe("Overture's categories of shops and services", () => {
  const row = (name: string, category: string, section = 'shopping', dataset = 'Microsoft'): OvertureRow => ({
    id: `${name}-${category}`, name, section, category, basic_category: null, alternates: null, confidence: 0.95, brand: null, brand_wikidata: null,
    website: null, phone: null, street: null, postcode: null, locality: null, dataset, lat: 46.7, lon: 6.8,
  });

  it('takes the kind from the name when it says otherwise', () => {
    const home = { kindKey: 'shop', kind: 'houseware' };
    expect(kindFromName('Garage Du Gros-de-vaud', home)).toEqual({ kindKey: 'shop', kind: 'car_repair' });
    expect(kindFromName('Pneus échappements T. Maillard Sàrl', home)).toEqual({ kindKey: 'shop', kind: 'tyres' });
    expect(kindFromName('Adecco Payerne', home)).toEqual({ kindKey: 'office', kind: 'employment_agency' });
    expect(kindFromName('Taxi Gare Sàrl', home)).toBe('drop');
    expect(kindFromName('Migros-Restaurant', { kindKey: 'shop', kind: 'supermarket' })).toBe('drop');
    expect(kindFromName('Police cantonale vaudoise Gendarmerie', { kindKey: 'office', kind: 'government' })).toEqual({ kindKey: 'amenity', kind: 'police' });
    expect(kindFromName('Cabinet Médical de Pédiatrie', { kindKey: 'amenity', kind: 'hospital' })).toEqual({ kindKey: 'amenity', kind: 'doctors' });
  });

  it('keeps the category when it agrees with the name', () => {
    expect(kindFromName('Garage Volta', { kindKey: 'shop', kind: 'car' })).toBeNull();
    expect(kindFromName('Elektro Ackermann GmbH', { kindKey: 'shop', kind: 'appliance' })).toBeNull();
    expect(kindFromName('Coop Bau+Hobby', { kindKey: 'shop', kind: 'doityourself' })).toBeNull();
    expect(kindFromName('Physiothérapie du Lac', { kindKey: 'healthcare', kind: 'physiotherapist' })).toBeNull();
    expect(overturePlace(row('Garage Du Gros-de-vaud', 'home_goods_store'))).toMatchObject({ kind: 'car_repair', overture: { byName: true } });
    expect(overturePlace(row('Taxi Gare Sàrl', 'home_goods_store'))).toBeNull();
  });

  it('maps service categories to OSM kinds', () => {
    expect(overturePlace(row('Cabinet vétérinaire Argos', 'veterinarian', 'lifestyle_services'))).toMatchObject({ kindKey: 'amenity', kind: 'veterinary' });
    expect(overturePlace(row('Physio Romont', 'physical_therapy', 'health_care'))).toMatchObject({ kindKey: 'healthcare', kind: 'physiotherapist' });
    expect(overturePlace(row('Notariat Muster', 'notary_public', 'services_and_business'))).toMatchObject({ kindKey: 'office', kind: 'notary' });
    expect(overturePlace(row('Some Consultants', 'b2b_service', 'services_and_business'))).toBeNull();
  });

  it('keeps a place nobody else has when its dataset and category agree with OSM', () => {
    const grid = new Grid();
    const candidates: Place[] = [];
    // Ten places both know: Microsoft's "home goods stores" are garages in OSM, its florists florists.
    for (let i = 0; i < 10; i++) {
      const lat = 46.5 + i * 0.01;
      grid.add(osmPlace({ id: `n${i}`, geometry: { type: 'Point', coordinates: [6.6, lat] }, properties: { shop: 'car_repair', name: `Muster${i} AG` } })!);
      grid.add(osmPlace({ id: `n${i + 100}`, geometry: { type: 'Point', coordinates: [6.7, lat] }, properties: { shop: 'florist', name: `Blumen Rosa${i}` } })!);
      candidates.push({ ...overturePlace(row(`Muster${i} AG`, 'home_goods_store'))!, lat, lon: 6.6 });
      candidates.push({ ...overturePlace(row(`Blumen Rosa${i}`, 'florist'))!, lat, lon: 6.7 });
    }
    const trusted = overtureTrust(grid, candidates);
    expect(trusted(overturePlace(row('Tagmann Nadège', 'home_goods_store'))!)).toBe(false);
    expect(trusted(overturePlace(row('Fleurs Jean-Jacques', 'florist'))!)).toBe(true);
    // The name says it: kept whatever the category.
    expect(trusted(overturePlace(row('Garage Rouge', 'home_goods_store'))!)).toBe(true);
    // A category too small to measure: its dataset as a whole (here half right, half wrong: not kept).
    expect(trusted(overturePlace(row('Luminaires Lux', 'lighting_store'))!)).toBe(false);
    expect(trusted(overturePlace(row('Luminaires Lux', 'lighting_store', 'shopping', 'meta'))!)).toBe(false);
  });

  it('does not take a town for a name', () => {
    const towns = new Set(['langenthal', 'lucens']);
    expect(sameName('Physio Langenthal', 'Zum Turm Thai Time Langenthal', towns)).toBe(false);
    expect(sameName('Pharmacie de Lucens', 'Pharmacie Lucens', towns)).toBe(true);
    expect(sameName('Migros Lucens', 'Migros', towns)).toBe(true);
    expect(sameName('Dr. med. Anna Muster', 'Dr. med. Peter Keller')).toBe(false);
    expect(sameName('Dr méd. Anna Muster', 'Dr. med. Anna Muster')).toBe(true);
  });
});

describe('the place card', () => {
  // A Thursday afternoon in Lucens (the server runs in Swiss time: server/tz.ts).
  const now = new Date('2026-11-12T15:00:00+01:00');
  const line = (v: string) =>
    weekHours(v, 46.7, 6.8, now)!.days.map((d) => `${d.weekday}:${d.intervals.map((i) => `${i.from}-${i.to}${i.comment ? ` (${i.comment})` : ''}`).join(',') || '-'}`).join(' ');

  it('lays the opening hours out by day, today first', () => {
    expect(line('Mo-Fr 08:00-12:00,13:30-18:30; Sa 08:00-16:00')).toBe('4:08:00-12:00,13:30-18:30 5:08:00-12:00,13:30-18:30 6:08:00-16:00 7:- 1:08:00-12:00,13:30-18:30 2:08:00-12:00,13:30-18:30 3:08:00-12:00,13:30-18:30');
    expect(line('24/7')).toBe('4:00:00-24:00 5:00:00-24:00 6:00:00-24:00 7:00:00-24:00 1:00:00-24:00 2:00:00-24:00 3:00:00-24:00');
  });

  it('keeps a night on the line of the evening it begins', () => {
    expect(line('Tu-Sa 18:00-02:00')).toBe('4:18:00-02:00 5:18:00-02:00 6:18:00-02:00 7:- 1:- 2:18:00-02:00 3:18:00-02:00');
  });

  it('says the usual comments in French and leaves unreadable hours alone', () => {
    expect(line('Mo 09:00-12:00 "by appointment"')).toContain('1:09:00-12:00 (sur rendez-vous)');
    expect(weekHours('selon la saison', 46.7, 6.8, now)).toBeNull();
  });

  it('turns picture tags into thumbnails', () => {
    expect(pictureUrl('File:Lucens château.jpg', 640)).toBe('https://commons.wikimedia.org/wiki/Special:FilePath/Lucens_ch%C3%A2teau.jpg?width=640');
    expect(pictureUrl('https://commons.wikimedia.org/wiki/File:Lucens_ch%C3%A2teau.jpg', 128)).toBe('https://commons.wikimedia.org/wiki/Special:FilePath/Lucens_ch%C3%A2teau.jpg?width=128');
    expect(pictureUrl('https://example.com/shop.jpg', 640)).toBe('https://example.com/shop.jpg');
    expect(pictureUrl('https://www.mapillary.com/app/?pKey=1', 640)).toBeNull();
    expect(pictureUrl('Category:Lucens', 640)).toBeNull();
  });

  it("shows a brand's logo when the place has none", () => {
    const logos = new Map([['Q680990', 'https://commons.wikimedia.org/wiki/Special:FilePath/Landi.svg?width=128']]);
    expect(extraOf({ 'brand:wikidata': 'Q680990', email: 'info@example.ch' }, logos)).toEqual({ logo: logos.get('Q680990'), email: 'info@example.ch' });
    expect(extraOf({ logo: 'File:Own.png', 'brand:wikidata': 'Q680990' }, logos)?.logo).toContain('Own.png');
    expect(extraOf({})).toBeNull();
  });
});
