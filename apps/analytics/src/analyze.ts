import { compare, type CommuteOption, type CommuteRequest, type CompareResult, type EngineDeps, type OptionKind, type Weekday } from '@pendular/engine';
import { ratioClass } from './indicators.js';
import type { Analysis, Person, ResultRow } from './types.js';

type RowFigures = Omit<ResultRow, 'personId' | 'extId' | 'attrs' | 'lat' | 'lon'>;

const TRANSIT_LEG = new Set(['rail', 'bus', 'tram', 'metro', 'boat', 'funicular', 'cableway']);

/** The request the planner would get for this person: same engine, same answer. */
export function requestFor(person: Person, a: Analysis): CommuteRequest {
  return {
    // No identifier and no address travel to the engine: a position is all it needs.
    home: { label: 'Home', lat: person.lat!, lon: person.lon! },
    work: a.site,
    arrival: a.arrival,
    pattern: { weekdays: a.weekdays as Weekday[], weeksOff: a.settings.weeksOff },
    traveller: { ageGroup: 'adult', travelClass: 2, halfFare: false, vaudResident: true },
    car: { costPerKm: a.settings.carCostPerKm, parkingAtWorkPerMonth: a.settings.parkingAtWorkPerMonth },
    kinds: a.settings.kinds as OptionKind[],
  };
}

/** The figures kept per person, from one comparison. */
export function summarise(r: CompareResult): RowFigures {
  const of = (kind: OptionKind) => r.options.filter((o) => o.kind === kind);
  const min = <T,>(list: T[], f: (x: T) => number) => list.reduce<T | null>((a, b) => (a === null || f(b) < f(a) ? b : a), null);
  /** Door-to-door minutes of a mode, also when the planner left it out as slower or dearer. */
  const minutes = (kind: OptionKind): number | null => {
    const shown = min(of(kind), (o) => o.durationMin);
    if (shown) return shown.durationMin;
    const left = r.leftOut.filter((l) => l.kind === kind && typeof l.durationMin === 'number');
    return left.length ? Math.min(...left.map((l) => l.durationMin!)) : null;
  };
  const pt = of('transit');
  const fastest = min(pt, (o) => o.durationMin);
  const cheapest = min(pt, (o) => o.cost.yearly);
  const car = of('car')[0] as CommuteOption | undefined;
  const board = fastest?.itinerary.legs.find((l) => TRANSIT_LEG.has(l.mode));
  const ptMin = fastest?.durationMin ?? null;
  const carMin = car?.durationMin ?? null;
  return {
    ptMin,
    ptChanges: fastest?.changes ?? null,
    ptDepartures: fastest?.departuresInWindow ?? null,
    ptCost: cheapest?.cost.yearly ?? null,
    ptProduct: cheapest?.cost.products[0]?.kind ?? null,
    boardStop: board?.from.name ?? null,
    carMin,
    carKm: car?.kmByMode.car ?? null,
    carCost: car?.cost.yearly ?? null,
    bikeMin: minutes('bike'),
    ebikeMin: minutes('ebike'),
    walkMin: minutes('walk'),
    co2Pt: fastest?.co2KgPerYear ?? null,
    co2Car: car?.co2KgPerYear ?? null,
    ratioClass: ratioClass(ptMin, carMin),
    error: null,
  };
}

/** The comparison without route shapes: enough for the per-person view, a tenth of the size. */
export function compact(r: CompareResult): unknown {
  return {
    ...r,
    options: r.options.map((o) => ({
      ...o,
      itinerary: { ...o.itinerary, legs: o.itinerary.legs.map(({ geometry: _g, intermediateStops: _s, ...leg }) => leg) },
    })),
  };
}

const EMPTY: RowFigures = {
  ptMin: null, ptChanges: null, ptDepartures: null, ptCost: null, ptProduct: null, boardStop: null,
  carMin: null, carKm: null, carCost: null, bikeMin: null, ebikeMin: null, walkMin: null,
  co2Pt: null, co2Car: null, ratioClass: 'noPt', error: null,
};

export async function analysePerson(person: Person, a: Analysis, engine: EngineDeps): Promise<{ row: RowFigures; detail: unknown; stamp: CompareResult['stamp'] | null }> {
  try {
    const result = await compare(requestFor(person, a), engine);
    return { row: summarise(result), detail: compact(result), stamp: result.stamp };
  } catch (e) {
    return { row: { ...EMPTY, error: (e as Error).message.slice(0, 300) }, detail: null, stamp: null };
  }
}
