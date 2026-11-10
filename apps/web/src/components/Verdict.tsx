import type { CommuteOption, CompareResult } from '@pendular/engine/types';
import { useI18n } from '../i18n/index.js';
import { chf, duration, num } from '../lib/format.js';
import { optionName } from '../lib/names.js';

export function Verdict(props: { result: CompareResult; onSelect: (id: string) => void }) {
  const { t, lang } = useI18n();
  const { options, verdict } = props.result;
  const byId = (id?: string) => options.find((o) => o.id === id);
  const cheapest = byId(verdict.cheapest);
  const fastest = byId(verdict.fastest);
  const greenest = byId(verdict.greenest);
  if (!cheapest || !fastest || !greenest) return null;

  const tile = (label: string, o: CommuteOption, figure: string, unit: string) => (
    <button type="button" className="verdict-tile" onClick={() => props.onSelect(o.id)}>
      <span className="eyebrow">{label}</span>
      <span className="figure">
        {figure} <small>{unit}</small>
      </span>
      <span className="verdict-name">{optionName(o, t)}</span>
    </button>
  );

  const rate = verdict.costPerHourSaved[fastest.id];
  return (
    <section className="verdict" aria-label={t('verdict.cheapest')}>
      <div className="verdict-tiles">
        {tile(t('verdict.cheapest'), cheapest, chf(cheapest.cost.yearly, lang), t('verdict.perYear'))}
        {tile(t('verdict.fastest'), fastest, duration(fastest.durationMin), t('verdict.perTrip'))}
        {tile(t('verdict.greenest'), greenest, `${num(greenest.co2KgPerYear, lang)} kg CO₂`, t('verdict.perYear'))}
      </div>
      <p className="verdict-line">
        {fastest.id === cheapest.id || rate === undefined
          ? fastest.id === cheapest.id
            ? t('verdict.same')
            : null
          : t('verdict.tradeoff', {
              fast: optionName(fastest, t),
              cheap: optionName(cheapest, t),
              hours: num(cheapest.hoursPerYear - fastest.hoursPerYear, lang),
              chf: chf(fastest.cost.yearly - cheapest.cost.yearly, lang),
              rate: chf(rate, lang),
            })}
      </p>
    </section>
  );
}
