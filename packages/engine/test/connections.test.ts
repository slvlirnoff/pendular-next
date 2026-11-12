import { describe, expect, it } from 'vitest';
import { connections } from '../src/planner/connections.js';
import { PENDULAR_RULES } from '../src/rules.js';
import type { Itinerary, RoutingProvider } from '../src/types.js';

const home = { lat: 46.69, lon: 6.86, name: 'Home' };
const work = { lat: 46.52, lon: 6.63, name: 'Work' };
const trip = (dep: string, arr: string): Itinerary => ({
  departure: dep,
  arrival: arr,
  durationMin: 60,
  changes: 0,
  legs: [{ mode: 'rail', from: { name: 'START', lat: 0, lon: 0 }, to: { name: 'END', lat: 0, lon: 0 }, departure: dep, arrival: arr, durationMin: 60, distanceM: 1000, line: { name: 'R1' } }],
});

function fake(segmentFilter: boolean) {
  const calls: Parameters<RoutingProvider['transit']>[0][] = [];
  const routing = {
    segmentFilter,
    transit: async (q: Parameters<RoutingProvider['transit']>[0]) => {
      calls.push(q);
      return [trip('2027-01-19T07:00:00Z', '2027-01-19T08:00:00Z'), trip('2027-01-19T06:00:00Z', '2027-01-19T07:00:00Z')];
    },
  } as unknown as RoutingProvider;
  return { routing, calls };
}

describe('connections of one ticket', () => {
  it('searches inside the zones of a pass, to work on arrival', async () => {
    const { routing, calls } = fake(true);
    const r = await connections({ from: home, to: work, direction: 'out', window: { from: '06:00', to: '09:00' }, zones: { alliance: 'mobilis', zones: [11, 12] }, via: ['a', 'b'] }, { routing, rules: PENDULAR_RULES });
    expect(r.within).toBe('zones');
    expect(calls[0]).toMatchObject({ from: home, to: work, by: 'arrive', allowedSegmentTags: ['mobilis:11', 'mobilis:12'] });
    expect(calls[0]!.via).toBeUndefined();
    // In time order, with the places' own names.
    expect(r.itineraries.map((x) => x.departure.slice(11, 16))).toEqual(['06:00', '07:00']);
    expect(r.itineraries[0]!.legs[0]!.from.name).toBe('Home');
    expect(r.itineraries[0]!.legs[0]!.to.name).toBe('Work');
  });

  it('goes back through the stops of the route in reverse, on departure', async () => {
    const { routing, calls } = fake(true);
    const r = await connections({ from: home, to: work, direction: 'back', window: { from: '16:00', to: '19:00' }, via: ['a', 'b'] }, { routing, rules: PENDULAR_RULES });
    expect(r.within).toBe('route');
    expect(calls[0]).toMatchObject({ from: work, to: home, by: 'depart', via: ['b', 'a'] });
  });

  it('falls back on the route, then on every connection, without a server that restricts to zones', async () => {
    const { routing, calls } = fake(false);
    const zones = { alliance: 'mobilis', zones: [11] };
    expect((await connections({ from: home, to: work, direction: 'out', window: { from: '06:00', to: '09:00' }, zones, via: ['a', 'b'] }, { routing, rules: PENDULAR_RULES })).within).toBe('route');
    expect(calls[0]!.allowedSegmentTags).toBeUndefined();
    expect((await connections({ from: home, to: work, direction: 'out', window: { from: '06:00', to: '09:00' }, zones }, { routing, rules: PENDULAR_RULES })).within).toBe('none');
  });
});

describe('stops the fare data does not know', () => {
  it('stand for a known stop of the trip nearby, and a leg left with one stop is dropped', async () => {
    const { fareSequences } = await import('../src/fares/price.js');
    const known = new Set(['8504023', '8504100', '8504881']);
    const nova = { stopName: (s: string) => (known.has(s) ? 'x' : undefined), alliancesAt: () => [] } as never;
    const at = (stopId: string, lat: number, lon: number) => ({ name: stopId, stopId, lat, lon });
    const leg = (from: ReturnType<typeof at>, to: ReturnType<typeof at>) => ({ mode: 'bus', from, to, departure: '', arrival: '', durationMin: 1, distanceM: 100 }) as never;
    const romont = at('8504023', 46.693, 6.912);
    const fribourg = at('8504100', 46.8032, 7.1511);
    const routeNeuve = at('8512790', 46.8026, 7.1513); // not in the fare data, 70 m from the station
    const busStation = at('8504881', 46.8035, 7.1502);
    expect(fareSequences([leg(romont, fribourg), leg(routeNeuve, busStation)], nova)).toEqual([['8504023', '8504100'], ['8504100', '8504881']]);
    // Nothing known nearby: the stop stays, and the trip is priced as before.
    const far = at('8599999', 46.9, 7.3);
    expect(fareSequences([leg(romont, far)], nova)).toEqual([['8504023', '8599999']]);
  });
});
