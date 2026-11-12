import { parkingByDensity, trafficFactorAlong, type DensityIndex, type LatLon } from '@pendular/engine';
import type { CarParts } from '../src/api.js';

/**
 * Car times as Pendular counts them: the street network gives the time on empty roads, so a
 * rush-hour factor by how built-up the surroundings of the road are (×1.1 in open country to ×3 in
 * a city centre: TRAFFIC_CLASSES of packages/engine, fitted on weekday 08:00 drives around
 * Lausanne) and the time to park and walk to the door by how dense the destination is (5, 10 or
 * 15 minutes) are added.
 *
 * Pendular's factors are for the morning commute. Trajestaurant searches at any hour: the share
 * of the rush-hour slow-down below applies (ASSUMPTIONS, not measurements): all of it at the
 * morning and evening peaks of a working day, part of it during the day, little at night and on
 * Sundays.
 */
const WEEKDAY: [fromMin: number, share: number][] = [
  [0, 0.1],
  [6 * 60, 0.5],
  [7 * 60, 1],
  [8 * 60 + 45, 0.6],
  [11 * 60 + 30, 0.7],
  [13 * 60 + 30, 0.6],
  [16 * 60 + 30, 1],
  [18 * 60 + 45, 0.5],
  [20 * 60, 0.2],
];
const SATURDAY: [number, number][] = [
  [0, 0.1],
  [9 * 60, 0.5],
  [18 * 60, 0.3],
  [20 * 60, 0.1],
];
const SUNDAY: [number, number][] = [
  [0, 0.1],
  [9 * 60, 0.25],
  [19 * 60, 0.1],
];

/** The share of the rush-hour slow-down at a local time: weekday 0 is Sunday, minutes after midnight. */
export function rushShare(weekday: number, minutes: number): number {
  const table = weekday === 0 ? SUNDAY : weekday === 6 ? SATURDAY : WEEKDAY;
  let share = table[0]![1];
  for (const [from, s] of table) if (minutes >= from) share = s;
  return share;
}

/** Weekday (0 = Sunday) and minutes after midnight of a local date and time ("YYYY-MM-DD", "HH:MM"). */
export function clockOf(date: string, time: string): { weekday: number; minutes: number } {
  const weekday = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10))).getUTCDay();
  return { weekday, minutes: +time.slice(0, 2) * 60 + +time.slice(3, 5) };
}

export interface Traffic {
  /** Door-to-door car time from the time on empty roads: slowed by the traffic of this hour, plus parking. */
  car(freeMin: number, route: [number, number][], to: LatLon): CarParts;
}

export function createTraffic(density: DensityIndex, weekday: number, minutes: number): Traffic {
  const share = rushShare(weekday, minutes);
  return {
    car(freeMin, route, to) {
      const peak = trafficFactorAlong(density, route);
      const factor = Math.round((1 + (peak - 1) * share) * 100) / 100;
      const parkingMin = parkingByDensity(density.around(to)).minutes;
      return {
        drivingMin: Math.max(1, Math.round(freeMin * factor)),
        freeMin: Math.round(freeMin * 10) / 10,
        factor,
        parkingMin,
        totalMin: Math.max(1, Math.round(freeMin * factor)) + parkingMin,
      };
    },
  };
}
