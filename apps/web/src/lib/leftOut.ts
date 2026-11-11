import type { LeftOut } from '@pendular/engine/types';
import type { T } from '../i18n/index.js';
import { chf, duration, num } from './format.js';

/** Why an option is not in the list, in one phrase: "too long: 1 h 50", "worse than …: 12 min longer". */
export function leftOutReason(l: LeftOut, t: T, lang: string): string {
  const d = l.delta;
  const delta = [
    d?.minutes && d.minutes > 0 ? t('delta.minutes', { n: Math.round(d.minutes) }) : null,
    d?.chfPerYear && d.chfPerYear > 0 ? t('delta.chf', { chf: chf(d.chfPerYear, lang) }) : null,
    d?.co2KgPerYear && d.co2KgPerYear > 0 ? t('delta.co2', { kg: num(d.co2KgPerYear, lang) }) : null,
  ]
    .filter(Boolean)
    .join(', ');
  return t(l.code === 'tooLong' && !l.durationMin ? 'left.tooFar' : `left.${l.code}`, { against: l.against ?? '', delta, min: l.durationMin ? duration(l.durationMin) : '' });
}
