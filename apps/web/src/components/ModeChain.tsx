import type { Leg } from '@pendular/engine/types';
import { linePictogram, modeIcon } from '../lib/pictograms.js';
import { useI18n } from '../i18n/index.js';

const STREET = new Set(['walk', 'bike', 'ebike', 'sharedBike', 'car']);

/** One leg as an SBB pictogram: the line badge where SBB has one, else a text badge in the same shape. */
export function LegBadge({ leg }: { leg: Leg }) {
  const { t } = useI18n();
  if (STREET.has(leg.mode)) {
    const label = t(`mode.${leg.mode as 'walk' | 'bike' | 'ebike' | 'sharedBike' | 'car'}`);
    return <img className="mode-icon" src={`/icons/sbb/${modeIcon(leg.mode)}.svg`} alt={label} title={label} width={24} height={24} />;
  }
  const name = leg.line?.name ?? '';
  const pic = leg.mode === 'rail' ? linePictogram({ name, category: leg.line?.category }) : null;
  if (pic) return <img className="line-pic" src={`/icons/sbb/${pic}.svg`} alt={name} title={name} height={20} />;
  return (
    <span className="line-badge" title={leg.line?.operator}>
      <img src={`/icons/sbb/${modeIcon(leg.mode)}.svg`} alt="" width={16} height={16} />
      {name || leg.mode}
    </span>
  );
}

/** The chain of modes of a trip; short walks between vehicles are left out. */
export function ModeChain({ legs }: { legs: Leg[] }) {
  const shown = legs.filter((l, i) => l.mode !== 'walk' || legs.length === 1 || ((i === 0 || i === legs.length - 1) && l.durationMin >= 4));
  return (
    <span className="mode-chain">
      {shown.map((l, i) => (
        <span key={i} className="mode-chain-item">
          {i > 0 && <span className="mode-chain-sep" aria-hidden="true">›</span>}
          <LegBadge leg={l} />
        </span>
      ))}
    </span>
  );
}
