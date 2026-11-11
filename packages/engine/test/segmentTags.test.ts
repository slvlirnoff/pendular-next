import { describe, expect, it } from 'vitest';
import { loadNetworks } from '../src/fares/networks.js';
import { loadNova } from '../src/fares/nova.js';
import { priceTransit } from '../src/fares/price.js';
import { formatSectionTags, gtfsStationNumber, sectionTags, segmentTagsOfZones, zonalPassPlans } from '../src/fares/segmentTags.js';
import { MotisRouting } from '../src/routing/motis.js';
import { PENDULAR_RULES } from '../src/rules.js';
import type { Leg, StopPoint } from '../src/types.js';

// The real fare data snapshot and the real price grids.
const nova = loadNova();
const networks = loadNetworks();
const plans = zonalPassPlans(nova, networks);

const LUCENS = 8504121;
const MOUDON = 8504120;
const PUIDOUX = 8504012;
const PALEZIEUX = 8504014;
const LAUSANNE = 8501120;
const CHAVORNAY = 8501112;
const COSSONAY = 8501115;

describe('segment tags of a section', () => {
  it('names the stops as the snapshot does', () => {
    expect(nova.stopName(String(PUIDOUX))).toMatch(/^Puidoux/);
    expect(nova.stopName(String(CHAVORNAY))).toBe('Chavornay');
    expect(nova.stopName(String(MOUDON))).toBe('Moudon');
  });

  it('covers every zonal network with a pass plan, joint passes left out', () => {
    expect(plans.get('mobilis')).toBe('mobilis-abo-abo');
    expect(plans.has('frimobil')).toBe(true);
    expect(plans.has('zvv')).toBe(true);
    expect(plans.has('leman-pass')).toBe(false);
    expect([...plans.keys()].some((a) => a.startsWith('z-pass'))).toBe(false);
  });

  it('takes the zones of the edge between neighbouring stops', () => {
    const t = sectionTags(nova, plans, LUCENS, MOUDON);
    const mobilis = t.networks.find((n) => n.alliance === 'mobilis')!;
    expect(mobilis).toEqual({ alliance: 'mobilis', zones: [60, 103], how: 'hop' });
    expect(segmentTagsOfZones('mobilis', mobilis.zones)).toEqual(['mobilis:60', 'mobilis:103']);
    // The same section is in Frimobil too: its own group, so that a pass of one network is enough.
    expect(formatSectionTags(t.networks)).toMatch(/^frimobil:[\d|:a-z]+;mobilis:60\|mobilis:103$/);
    expect(sectionTags(nova, plans, MOUDON, LUCENS).networks).toEqual(t.networks);
  });

  it('bridges a section whose stops are not neighbours in the fare data (a train that skips stops)', () => {
    // A fast train Chavornay – Cossonay-Penthalaz passes Bavois and Eclépens: no edge joins the two.
    expect(nova.zonesOnEdge('mobilis', 'mobilis-abo-abo', String(CHAVORNAY), String(COSSONAY))).toBeNull();
    const t = sectionTags(nova, plans, CHAVORNAY, COSSONAY);
    expect(t.unresolved).toEqual([]);
    const mobilis = t.networks.find((n) => n.alliance === 'mobilis')!;
    expect(mobilis).toEqual({ alliance: 'mobilis', zones: [43, 44, 45, 53], how: 'bridged' });
    // What the trip resolver finds for the same leg.
    expect(mobilis.zones).toEqual(nova.zonesForStops('mobilis', 'mobilis-abo-abo', [String(CHAVORNAY), String(COSSONAY)]).zones);
  });

  it('tags the sections of the R9 into Lausanne, which skips the stops of the lakeside line', () => {
    expect(formatSectionTags(sectionTags(nova, plans, PUIDOUX, LAUSANNE).networks)).toBe('mobilis:11|mobilis:12|mobilis:19|mobilis:64');
    expect(formatSectionTags(sectionTags(nova, plans, PALEZIEUX, LAUSANNE).networks)).toBe('mobilis:11|mobilis:12|mobilis:19|mobilis:63|mobilis:64');
  });

  it('has nothing for a section that leaves every network', () => {
    const t = sectionTags(nova, plans, LAUSANNE, 8507000); // Bern
    expect(t.networks).toEqual([]);
    expect(formatSectionTags(t.networks)).toBe('');
  });

  it('maps the stop ids of the timetable feed to station numbers', () => {
    expect(gtfsStationNumber('ch:1:sloid:4121:0:1', 'Parentch:1:sloid:4121')).toBe(8504121);
    expect(gtfsStationNumber('ch:1:sloid:4121', '')).toBe(8504121);
    expect(gtfsStationNumber('ch:1:sloid:88776:1:3')).toBe(8588776);
    expect(gtfsStationNumber('ch:1:sloid:120_gen:missingSLOID_pf:A', 'Parentch:1:sloid:120')).toBe(8500120);
    expect(gtfsStationNumber('8002140', 'Parent8002140')).toBe(8002140);
    expect(gtfsStationNumber('8014474_gen:missingSLOID_pf:5')).toBe(8014474);
    expect(gtfsStationNumber('ch:1:sloid:1100043', 'Parentch:1:sloid:1100043')).toBeNull();
    expect(gtfsStationNumber('x')).toBeNull();
  });
});

describe('zone products say which network and zones they are for', () => {
  const at = (id: number): StopPoint => ({ name: nova.stopName(String(id)) ?? '', stopId: String(id), lat: 46.7, lon: 6.8 });
  const leg: Leg = { mode: 'rail', from: at(LUCENS), to: at(MOUDON), departure: '2027-01-19T07:00:00+01:00', arrival: '2027-01-19T07:05:00+01:00', durationMin: 5, distanceM: 6000, line: { name: 'R9' }, intermediateStops: [] };
  const ctx = { traveller: { ageGroup: 'adult' as const, travelClass: 2 as const, halfFare: false, vaudResident: true }, tripsPerYear: 470, workingDaysPerYear: 235, weeksWorked: 47, rules: PENDULAR_RULES };

  it('fills alliance and zones, and the pass allows the section it was priced for', () => {
    const products = priceTransit([leg], ctx, { nova, networks });
    const pass = products.find((p) => p.kind === 'zonePassYearly')!;
    expect(pass.alliance).toBe('mobilis');
    expect(pass.zones).toEqual([60, 103]);
    const allowed = new Set(segmentTagsOfZones(pass.alliance!, pass.zones!));
    const section = sectionTags(nova, plans, LUCENS, MOUDON).networks.find((n) => n.alliance === 'mobilis')!;
    expect(segmentTagsOfZones('mobilis', section.zones).every((t) => allowed.has(t))).toBe(true);
    // The pass for the whole network lists every zone of the plan.
    const all = products.find((p) => p.kind === 'zonePassAllYearly')!;
    expect(all.alliance).toBe('mobilis');
    expect(all.zones!.length).toBeGreaterThan(50);
    expect(products.find((p) => p.kind === 'ga')!.alliance).toBeUndefined();
  });
});

describe('MotisRouting.lastTrip with the segment filter', () => {
  const it0 = (start: string, end: string) => ({
    duration: 3600,
    startTime: start,
    endTime: end,
    transfers: 0,
    legs: [{ mode: 'BUS', from: { name: 'A', lat: 46.5, lon: 6.6 }, to: { name: 'B', lat: 46.7, lon: 6.8 }, duration: 3600, startTime: start, endTime: end }],
  });
  const answer = {
    itineraries: [
      it0('2027-01-19T18:11:00Z', '2027-01-19T19:20:00Z'),
      it0('2027-01-19T21:58:00Z', '2027-01-19T23:46:00Z'),
      // Four days earlier, with fewer changes: the filtered search returns it too.
      it0('2027-01-16T02:35:00Z', '2027-01-16T03:30:00Z'),
    ],
  };
  const make = (segmentFilter: boolean, urls: URL[]) =>
    new MotisRouting({
      baseUrl: 'http://motis.test',
      timezone: 'Europe/Zurich',
      referenceTime: '2027-01-19T11:00:00Z',
      segmentFilter,
      fetch: (async (u: URL) => {
        urls.push(u);
        return new Response(JSON.stringify(answer));
      }) as unknown as typeof fetch,
    });
  const q = { from: { lat: 46.5167, lon: 6.6291 }, to: { lat: 46.7085, lon: 6.8393 }, date: '2027-01-20', time: '02:00', allowedSegmentTags: ['mobilis:11', 'mobilis:12'] };

  it('sends the tags and a travel time limit, and takes the latest departure of that evening', async () => {
    const urls: URL[] = [];
    const r = make(true, urls);
    expect(r.segmentFilter).toBe(true);
    const back = await r.lastTrip(q);
    expect(urls[0]!.searchParams.get('allowedSegmentTags')).toBe('mobilis:11,mobilis:12');
    expect(urls[0]!.searchParams.get('maxTravelTime')).toBe('720');
    expect(urls[0]!.searchParams.has('via')).toBe(false);
    expect(back!.departure).toBe('2027-01-19T21:58:00Z');
  });

  it('ignores itineraries that leave more than twelve hours before the arrive-by time', async () => {
    const urls: URL[] = [];
    const r = new MotisRouting({
      baseUrl: 'http://motis.test',
      timezone: 'Europe/Zurich',
      referenceTime: '2027-01-19T11:00:00Z',
      segmentFilter: true,
      fetch: (async (u: URL) => {
        urls.push(u);
        return new Response(JSON.stringify({ itineraries: [answer.itineraries[2]] }));
      }) as unknown as typeof fetch,
    });
    expect(await r.lastTrip(q)).toBeNull();
  });

  it('does not send the parameter to a server that does not know it', async () => {
    const urls: URL[] = [];
    const r = make(false, urls);
    expect(r.segmentFilter).toBe(false);
    await r.lastTrip(q);
    expect(urls[0]!.searchParams.has('allowedSegmentTags')).toBe(false);
    expect(urls[0]!.searchParams.has('maxTravelTime')).toBe(false);
  });
});
