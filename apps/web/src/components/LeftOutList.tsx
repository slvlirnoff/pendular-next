import type { LeftOut, OptionKind } from '@pendular/engine/types';
import { useI18n } from '../i18n/index.js';
import { leftOutReason } from '../lib/leftOut.js';

export function LeftOutList({ items }: { items: LeftOut[] }) {
  const { t, lang } = useI18n();
  if (items.length === 0) return null;
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
              <span>{leftOutReason(l, t, lang)}</span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
