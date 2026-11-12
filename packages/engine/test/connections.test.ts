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
