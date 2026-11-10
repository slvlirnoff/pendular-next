import type { TimeWindow } from './types.js';

/** Offset of `timezone` from UTC at the given instant, in minutes (e.g. +60 for CET). */
export function tzOffsetMin(instant: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** The instant of a local wall-clock time ("YYYY-MM-DD", "HH:MM") in `timezone`. */
export function localToUtc(date: string, time: string, timezone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const offset = tzOffsetMin(guess, timezone);
  return new Date(guess.getTime() - offset * 60000);
}

/** A window on `date`; when `to` is not after `from` the window ends on the next day. */
export function windowToUtc(date: string, w: TimeWindow, timezone: string): { start: Date; end: Date } {
  const start = localToUtc(date, w.from, timezone);
  let end = localToUtc(date, w.to, timezone);
  if (end.getTime() <= start.getTime()) end = new Date(end.getTime() + 24 * 3600 * 1000);
  return { start, end };
}

/** "HH:MM" of an instant in `timezone`. */
export function localHHMM(iso: string | Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).format(typeof iso === 'string' ? new Date(iso) : iso);
}

export function minutesBetween(a: string | Date, b: string | Date): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 60000;
}
