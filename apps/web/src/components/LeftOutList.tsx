import type { LeftOut, OptionKind } from '@pendular/engine/types';
import { useI18n } from '../i18n/index.js';
import { chf, duration, num } from '../lib/format.js';

export function LeftOutList({ items }: { items: LeftOut[] }) {
  const { t, lang } = useI18n();
  if (items.length === 0) return null;
  const delta = (d: LeftOut['delta']) =>
    [
      d?.minutes && d.minutes > 0 ? t('delta.minutes', { n: Math.round(d.minutes) }) : null,
      d?.chfPerYear && d.chfPerYear > 0 ? t('delta.chf', { chf: chf(d.chfPerYear, lang) }) : null,
      d?.co2KgPerYear && d.co2KgPerYear > 0 ? t('delta.co2', { kg: num(d.co2KgPerYear, lang) }) : null,
    ]
      .filter(Boolean)
      .join(', ');
  return (
    <details className="leftout card">
      <summary>
        {t('left.title')} ({items.length})
      </summary>
      <ul>
        {items.map((l, i) => {
          const title = ['walk', 'bike', 'ebike', 'car'].includes(l.title) ? t(`kind.${l.kind}` as `kind.${OptionKind}`) : l.title;
          return (
            <li key={i}>
              <strong>{title}</strong>
              <span>
                {t(l.code === 'tooLong' && !l.durationMin ? 'left.tooFar' : `left.${l.code}`, { against: l.against ?? '', delta: delta(l.delta), min: l.durationMin ? duration(l.durationMin) : '' })}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
