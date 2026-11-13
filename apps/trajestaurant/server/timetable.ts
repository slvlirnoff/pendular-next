import { existsSync, readFileSync } from 'node:fs';
import { REGION } from './region.js';

/**
 * The routing engine holds one timetable year (data/motis/config.yml: `first_day`, `num_days`).
 * A search for a day outside it (today, before the new timetable starts) is made on the same
 * weekday and at the same time of a reference week inside it: timetables change little from one
 * year to the next, and the answer is shown as a typical timetable.
 */
export interface TimetableRange {
  firstDay: string;
  days: number;
}

export const TIMEZONE = REGION.timezone;

const DAY_MS = 86_400_000;
const toDay = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function readTimetableRange(configPath: string): TimetableRange {
  const fallback: TimetableRange = { firstDay: '2026-12-13', days: 364 };
  if (!existsSync(configPath)) return fallback;
  const text = readFileSync(configPath, 'utf8');
  const first = /^\s*first_day:\s*(\d{4}-\d{2}-\d{2})/m.exec(text)?.[1];
  const days = /^\s*num_days:\s*(\d+)/m.exec(text)?.[1];
  return { firstDay: first ?? fallback.firstDay, days: days ? Number(days) : fallback.days };
}

/**
 * The reference week: the first Monday at least five weeks after the start of the timetable,
 * past the Christmas and New Year days that a December start runs into.
 */
export function referenceMonday(r: TimetableRange): string {
  let d = toDay(r.firstDay) + 35 * DAY_MS;
  while (new Date(d).getUTCDay() !== 1) d += DAY_MS;
  return toIso(d);
}

/** The day to search on for a local date: itself when the timetable covers it, else the same weekday of the reference week. */
export function routingDate(localDate: string, r: TimetableRange): { date: string; typical: boolean } {
  const day = toDay(localDate);
  const first = toDay(r.firstDay);
  if (day >= first && day < first + r.days * DAY_MS) return { date: localDate, typical: false };
  const monday = toDay(referenceMonday(r));
  const offset = (new Date(day).getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
  return { date: toIso(monday + offset * DAY_MS), typical: true };
}

/** Local date ("YYYY-MM-DD") and time ("HH:MM") of an instant in the region. */
export function localNow(at = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}
