import type { CommuteOption } from '@pendular/engine/types';
import type { T } from '../i18n/index.js';

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/** Median gap between consecutive departures, in minutes (at least 1). */
export function medianGap(departures: string[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < departures.length; i++) {
    const g = minutes(departures[i]!) - minutes(departures[i - 1]!);
    gaps.push(g < 0 ? g + 24 * 60 : g);
  }
  if (gaps.length === 0) return 0;
  gaps.sort((a, b) => a - b);
  const mid = gaps.length >> 1;
  const median = gaps.length % 2 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
  return Math.max(1, Math.round(median));
}

/** When to leave home: the times themselves for a few connections, a rhythm for many. Null without data. */
export function departuresSummary(o: CommuteOption, t: T): string | null {
  const conns = o.connections;
  if (!conns || conns.length === 0) return null;
  const deps = conns.map((c) => c.departure);
  if (deps.length === 1) return t('opt.depOne', { time: deps[0]! });
  if (deps.length <= 4) return t('opt.depList', { times: deps.join(', ') });
  return t('opt.depEvery', { first: deps[0]!, last: deps[deps.length - 1]!, n: medianGap(deps) });
}
