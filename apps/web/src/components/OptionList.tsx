import type { CommuteOption, CostComponent, Leg, PricedProduct, Provenance } from '@pendular/engine/types';
import { useI18n, type Key } from '../i18n/index.js';
import { chf, chf2, duration, hhmm, num } from '../lib/format.js';
import { optionName } from '../lib/names.js';
import { LegBadge, ModeChain } from './ModeChain.js';

function ProvenanceTag({ p }: { p: Provenance }) {
  const { t } = useI18n();
  return (
    <span className={`prov prov-${p}`} title={t(`prov.${p}.help`)}>
      {t(`prov.${p}`)}
    </span>
  );
}

function componentLabel(c: CostComponent, t: ReturnType<typeof useI18n>['t'], lang: string): string {
  const p = c.params ?? {};
  const known = `cost.${c.key}` as Key;
  const unit = typeof p.unit === 'number' && typeof p.times === 'number' ? `${p.times} × ${chf2(p.unit, lang)}` : '';
  const where = typeof p.zones === 'number' ? t('product.zones', { n: p.zones }) : typeof p.km === 'number' && !c.key.startsWith('car') ? t('product.km', { km: p.km }) : '';
  if (c.key.startsWith('mobilis.') || c.key.startsWith('national.') || c.key.startsWith('ga.')) {
    return [where, unit, c.key.endsWith('vaudDiscount') ? t('cost.vaudDiscount') : ''].filter(Boolean).join(' · ');
  }
  const text = t(known, p as Record<string, string | number>);
  return text === known ? c.key : text;
}

function Products({ products }: { products: PricedProduct[] }) {
  const { t, lang } = useI18n();
  if (products.length === 0) return null;
  return (
    <div className="detail-block">
      <h4>{t('opt.tickets')}</h4>
      <table className="products">
        <tbody>
          {products.map((p, i) => (
            <tr key={p.kind} className={i === 0 ? 'is-best' : undefined}>
              <th scope="row">
                {t(`product.${p.kind}`)}
                {i === 0 && <span className="best-tag">{t('product.cheapest')}</span>}
                <span className="sub">
                  {p.components.map((c) => componentLabel(c, t, lang)).filter(Boolean).join(' + ')}
                  {p.range && ` · ${t('opt.range', { low: chf(p.range.low, lang), high: chf(p.range.high, lang) })}`}
                </span>
              </th>
              <td>
                <ProvenanceTag p={p.provenance} />
              </td>
              <td className="amount">{chf(p.yearly, lang)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Timeline({ legs }: { legs: Leg[] }) {
  const { t } = useI18n();
  return (
    <div className="detail-block">
      <h4>{t('opt.trip')}</h4>
      <ol className="timeline">
        {legs.map((l, i) => (
          <li key={i}>
            <span className="tl-time">{hhmm(l.departure)}</span>
            <span className="tl-node" aria-hidden="true" />
            <span className="tl-body">
              <strong>{l.from.name}</strong>
              <span className="tl-leg">
                <LegBadge leg={l} />
                <span>
                  {duration(l.durationMin)}
                  {l.line?.headsign ? ` · ${l.line.headsign}` : ''}
                  {l.distanceM > 0 && !l.line ? ` · ${(l.distanceM / 1000).toFixed(1)} km` : ''}
                </span>
              </span>
            </span>
          </li>
        ))}
        {legs.length > 0 && (
          <li className="tl-end">
            <span className="tl-time">{hhmm(legs[legs.length - 1]!.arrival)}</span>
            <span className="tl-node" aria-hidden="true" />
            <span className="tl-body">
              <strong>{legs[legs.length - 1]!.to.name}</strong>
            </span>
          </li>
        )}
      </ol>
    </div>
  );
}

function OptionRow(props: { o: CommuteOption; selected: boolean; onSelect: () => void; hasCar: boolean }) {
  const { t, lang } = useI18n();
  const { o } = props;
  const saved = o.co2SavedKgPerYear;
  return (
    <li className={`option card${props.selected ? ' is-selected' : ''}`}>
      <button type="button" className="option-head" aria-expanded={props.selected} onClick={props.onSelect}>
        <span className="option-main">
          <span className="option-title">{optionName(o, t)}</span>
          <ModeChain legs={o.itinerary.legs} />
        </span>
        <span className="option-figures">
          <span className="option-cost">
            {chf(o.cost.yearly, lang)}
            <small>{t('verdict.perYear')}</small>
          </span>
          <ProvenanceTag p={o.cost.provenance} />
        </span>
        <span className="option-meta">
          <span>
            <strong>{duration(o.durationMin)}</strong> · {o.changes === 0 ? t('opt.direct') : t('opt.changes', { n: o.changes })}
          </span>
          {o.departuresInWindow !== undefined && <span>{t('opt.departures', { n: o.departuresInWindow })}</span>}
          <span>
            {t('opt.co2', { kg: num(o.co2KgPerYear, lang) })}
            {props.hasCar && saved !== undefined && saved !== 0 && (
              <em className={saved > 0 ? 'good' : 'warn'}> · {saved > 0 ? t('opt.saved', { kg: num(saved, lang) }) : t('opt.more', { kg: num(-saved, lang) })}</em>
            )}
          </span>
        </span>
      </button>
      {props.selected && (
        <div className="option-detail">
          <p className="detail-facts">
            {t('opt.hours', { h: num(o.hoursPerYear, lang) })}
            {o.firstArrival && o.lastArrival && ` · ${t('opt.arrivals', { first: o.firstArrival, last: o.lastArrival })}`}
            {o.returnTrips && ` · ${t('opt.return', { first: o.returnTrips.first, last: o.returnTrips.last })}`}
            {o.returnTrips === null && <span className="warn"> · {t('opt.noReturn')}</span>}
          </p>
          <Products products={o.cost.products} />
          {o.cost.extras.length > 0 && (
            <div className="detail-block">
              <h4>{t('opt.extras')}</h4>
              <table className="products">
                <tbody>
                  {o.cost.extras.map((c, i) => (
                    <tr key={i}>
                      <th scope="row">{componentLabel(c, t, lang)}</th>
                      <td>
                        <ProvenanceTag p={c.provenance} />
                      </td>
                      <td className="amount">{chf(c.yearly, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Timeline legs={o.itinerary.legs} />
        </div>
      )}
    </li>
  );
}

export type SortKey = 'cost' | 'time' | 'co2';

export function OptionList(props: { options: CommuteOption[]; selected: string | null; onSelect: (id: string | null) => void; sort: SortKey; onSort: (s: SortKey) => void }) {
  const { t } = useI18n();
  const f = { cost: (o: CommuteOption) => o.cost.yearly, time: (o: CommuteOption) => o.durationMin, co2: (o: CommuteOption) => o.co2KgPerYear }[props.sort];
  const sorted = [...props.options].sort((a, b) => f(a) - f(b));
  const hasCar = props.options.some((o) => o.kind === 'car');
  return (
    <section className="options">
      <header className="options-head">
        <h2>{t('list.title')}</h2>
        <div className="segmented" role="group" aria-label={t('list.sort')}>
          {(['cost', 'time', 'co2'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={props.sort === k} className={props.sort === k ? 'is-on' : undefined} onClick={() => props.onSort(k)}>
              {t(`sort.${k}`)}
            </button>
          ))}
        </div>
      </header>
      <ul>
        {sorted.map((o) => (
          <OptionRow key={o.id} o={o} hasCar={hasCar} selected={o.id === props.selected} onSelect={() => props.onSelect(o.id === props.selected ? null : o.id)} />
        ))}
      </ul>
    </section>
  );
}
