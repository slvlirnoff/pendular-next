import opening_hours from 'opening_hours';
import type { OpenState } from '../src/api.js';

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
