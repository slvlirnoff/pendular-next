import opening_hours from 'opening_hours';
import type { DayHours, OpenState, WeekHours } from '../src/api.js';

/**
 * Open or closed at an instant, from an OSM `opening_hours` value. The library reads dates in the
 * process's local time, so the server runs with TZ=Europe/Zurich (server/tz.ts). Public holidays
 * are those of the canton of Vaud; a value the library cannot read gives null.
 */
const cache = new Map<string, opening_hours | null>();

function parse(value: string, lat: number, lon: number): opening_hours | null {
  const hit = cache.get(value);
  if (hit !== undefined) return hit;
  let oh: opening_hours | null = null;
  try {
    oh = new opening_hours(value, { lat, lon, address: { country_code: 'ch', state: 'Vaud' } });
  } catch {
    oh = null;
  }
  if (cache.size > 20_000) cache.clear();
  cache.set(value, oh);
  return oh;
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export function openState(value: string | null | undefined, lat: number, lon: number, at: Date): OpenState | null {
  if (!value) return null;
  const oh = parse(value, lat, lon);
  if (!oh) return null;
  try {
    const unknown = oh.getUnknown(at);
    const open = unknown ? null : oh.getState(at);
    const next = oh.getNextChange(at, new Date(at.getTime() + 7 * 86_400_000));
    const state: OpenState = { open };
    if (next) {
      const sameDay = next.toDateString() === at.toDateString() || next.getTime() - at.getTime() < 6 * 3_600_000;
      if (sameDay) state.changesAt = hhmm(next);
      else {
        state.changesAt = hhmm(next);
        state.changesDay = next.getDay();
      }
    }
    return state;
  } catch {
    return null;
  }
}

/**
 * The opening hours of the coming seven days, one entry per day from today, for the card's table:
 * each day's opening times ("08:00"–"12:00"; one that goes past midnight ends on its own day's line:
 * "18:00"–"02:00"), with the comment the value gives ("sur rendez-vous"). Null when the value
 * cannot be read: the card then shows it as written.
 */
export function weekHours(value: string | null | undefined, lat: number, lon: number, now: Date): WeekHours | null {
  if (!value) return null;
  const oh = parse(value, lat, lon);
  if (!oh) return null;
  try {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const dayStart = (i: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      return d;
    };
    const days: DayHours[] = [];
    for (let i = 0; i < 7; i++) {
      const d = dayStart(i);
      days.push({ weekday: d.getDay() === 0 ? 7 : d.getDay(), date: ymd(d), intervals: [] });
    }
    // From yesterday to the day after the week, so that nights at either end are seen whole.
    const raw = oh.getOpenIntervals(dayStart(-1), dayStart(8));
    for (const [start, end, unknown, comment] of raw) {
      for (let i = 0; i < 7; i++) {
        const from = dayStart(i);
        const to = dayStart(i + 1);
        if (end <= from || start >= to) continue;
        // The early hours of a night begun the day before belong to that day's line.
        if (start < from && end.getTime() - from.getTime() <= NIGHT_MS && to.getTime() - start.getTime() < 2 * DAY_MS) continue;
        const pieceStart = start > from ? start : from;
        // A night that ends early the next day is shown whole on its first day.
        const endsNextNight = end > to && end.getTime() - to.getTime() <= NIGHT_MS && start >= from;
        const pieceEnd = endsNextNight ? end : end < to ? end : to;
        days[i]!.intervals.push({
          from: hhmm(pieceStart),
          to: pieceEnd.getTime() === to.getTime() ? '24:00' : hhmm(pieceEnd),
          ...(unknown ? { unknown: true } : {}),
          ...(comment ? { comment: commentFr(comment) } : {}),
        });
      }
    }
    return { days, stable: oh.isWeekStable() };
  } catch {
    return null;
  }
}

const DAY_MS = 86_400_000;
/** How far into the next day a night's opening may run and still count as the evening before. */
const NIGHT_MS = 6 * 3_600_000;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The usual comments in French; others as written. */
function commentFr(c: string): string {
  if (/appointment|vereinbarung|rendez|appuntamento|termin/i.test(c)) return 'sur rendez-vous';
  return c;
}
