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

  return (
    <section className="verdict" aria-labelledby="verdict-h">
      <h2 id="verdict-h" className="sr-only">
        {t('verdict.title')}
      </h2>
      <p className="answer">
        {t('answer.cheapest', {
          name: optionName(cheapest, t),
          chf: chf(cheapest.cost.yearly, lang),
          month: chf(cheapest.cost.yearly / 12, lang),
          time: duration(cheapest.durationMin),
        })}
      </p>
      <div className="verdict-tiles">
        {tile(t('verdict.cheapest'), cheapest, chf(cheapest.cost.yearly, lang), t('verdict.perYear'))}
        {tile(t('verdict.fastest'), fastest, duration(fastest.durationMin), t('verdict.perTrip'))}
        {tile(t('verdict.greenest'), greenest, `${num(greenest.co2KgPerYear, lang)} kg CO₂`, t('verdict.perYear'))}
      </div>
    </section>
  );
}
