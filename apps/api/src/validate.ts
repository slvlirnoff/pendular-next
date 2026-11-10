import type { AgeGroup, CommuteRequest, OptionKind, Place, TimeWindow, Weekday } from '@pendular/engine';

const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const AGES: AgeGroup[] = ['child', 'youth', 'adult', 'senior'];
const KINDS: OptionKind[] = ['transit', 'parkRail', 'cityParkRide', 'bikeRide', 'walk', 'bike', 'ebike', 'car'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function fail(msg: string): never {
  throw new Error(msg);
}
const num = (v: unknown, name: string, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fail(`${name} must be a number between ${min} and ${max}`);

function place(v: unknown, name: string): Place {
  const p = (v ?? {}) as Record<string, unknown>;
  return {
    label: typeof p.label === 'string' ? p.label.slice(0, 200) : name,
    lat: num(p.lat, `${name}.lat`, 45, 48.5),
    lon: num(p.lon, `${name}.lon`, 5, 11.5),
    stopId: typeof p.stopId === 'string' ? p.stopId.slice(0, 80) : undefined,
  };
}

function window(v: unknown, name: string): TimeWindow {
  const w = (v ?? {}) as Record<string, unknown>;
  if (typeof w.from !== 'string' || typeof w.to !== 'string' || !HHMM.test(w.from) || !HHMM.test(w.to)) fail(`${name} needs from and to as HH:MM`);
  const [fh, fm] = (w.from as string).split(':').map(Number) as [number, number];
  const [th, tm] = (w.to as string).split(':').map(Number) as [number, number];
  let len = th * 60 + tm - (fh * 60 + fm);
  if (len <= 0) len += 24 * 60;
  if (len > 240) fail(`${name} may span at most 4 hours`);
  return { from: w.from as string, to: w.to as string };
}

/** Validates the public request body. Rule overrides are not accepted from the public API. */
export function parseRequest(body: unknown): CommuteRequest {
  const b = (body ?? {}) as Record<string, any>;
  const weekdays = Array.isArray(b.pattern?.weekdays) ? (b.pattern.weekdays as unknown[]).filter((d): d is Weekday => WEEKDAYS.includes(d as Weekday)) : [];
  if (weekdays.length === 0) fail('pattern.weekdays needs at least one day');
  const t = b.traveller ?? {};
  if (!AGES.includes(t.ageGroup)) fail('traveller.ageGroup is invalid');
  const kinds = Array.isArray(b.kinds) ? (b.kinds as unknown[]).filter((k): k is OptionKind => KINDS.includes(k as OptionKind)) : undefined;
  return {
    home: place(b.home, 'home'),
    work: place(b.work, 'work'),
    arrival: window(b.arrival, 'arrival'),
    pattern: { weekdays: [...new Set(weekdays)], weeksOff: num(b.pattern?.weeksOff ?? 5, 'pattern.weeksOff', 0, 51) },
    traveller: {
      ageGroup: t.ageGroup,
      travelClass: t.travelClass === 1 ? 1 : 2,
      halfFare: t.halfFare === true,
      ga: t.ga === true,
      vaudResident: t.vaudResident === true,
    },
    car: {
      costPerKm: num(b.car?.costPerKm ?? 0.74, 'car.costPerKm', 0, 5),
      parkingAtWorkPerMonth: num(b.car?.parkingAtWorkPerMonth ?? 260, 'car.parkingAtWorkPerMonth', 0, 2000),
    },
    bike:
      b.bike && typeof b.bike === 'object'
        ? {
            costPerKm: b.bike.costPerKm === undefined ? undefined : num(b.bike.costPerKm, 'bike.costPerKm', 0, 2),
            ebikeCostPerKm: b.bike.ebikeCostPerKm === undefined ? undefined : num(b.bike.ebikeCostPerKm, 'bike.ebikeCostPerKm', 0, 2),
          }
        : undefined,
    kinds: kinds?.length ? kinds : undefined,
  };
}
