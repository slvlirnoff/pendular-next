import { useId, useState } from 'react';
import type { CommuteOption, CostComponent, Leg, PricedProduct } from '@pendular/engine/types';
import { useI18n, type Key } from '../i18n/index.js';
import { chf, chf2, duration, hhmm, num } from '../lib/format.js';
import { optionName } from '../lib/names.js';
import { LegBadge, ModeChain } from './ModeChain.js';

function componentLabel(c: CostComponent, t: ReturnType<typeof useI18n>['t'], lang: string): string {
  const p = c.params ?? {};
  const known = `cost.${c.key}` as Key;
  const unit = typeof p.unit === 'number' && typeof p.times === 'number' && p.times > 1 ? `${p.times} × ${chf2(p.unit, lang)}` : '';
  const where = typeof p.zones === 'number' ? t('product.zones', { n: p.zones }) : typeof p.km === 'number' && !c.key.startsWith('car') ? t('product.km', { km: p.km }) : '';
  if (c.key.startsWith('mobilis.') || c.key.startsWith('national.') || c.key.startsWith('ga.')) {
    return [where, unit, c.key.endsWith('vaudDiscount') ? t('cost.vaudDiscount') : ''].filter(Boolean).join(' · ');
  }
  const text = t(known, p as Record<string, string | number>);
  return text === known ? c.key : text;
}

function ticketDetail(p: PricedProduct, t: ReturnType<typeof useI18n>['t'], lang: string): string {
  return p.components.map((c) => componentLabel(c, t, lang)).filter(Boolean).join(' + ');
}

/** The ticket to buy, stated once; the alternatives stay one click away. */
function Products({ products }: { products: PricedProduct[] }) {
  const { t, lang } = useI18n();
  const best = products[0];
  if (!best) return null;
  // A day pass at the price of two singles adds nothing to read.
  const others = products.slice(1).filter((p, i, list) => !(p.kind.includes('DayPass') && list.some((q) => q !== p && q.yearly === p.yearly)));
  const estimated = best.provenance === 'estimated';
  const byKm = best.components.some((c) => typeof c.params?.km === 'number');
  return (
    <div className="detail-block">
      <h4>{t('ticket.buy')}</h4>
      <p className="ticket">
        <span className="ticket-name">{t(`product.${best.kind}`)}</span>
        <span className="ticket-price">
          {chf(best.yearly, lang)} <small>{t('verdict.perYear')}</small>
        </span>
        <span className="ticket-sub">
          {ticketDetail(best, t, lang)}
          {best.yearly > 0 && ` · ${t('ticket.perMonth', { chf: chf(best.yearly / 12, lang) })}`}
        </span>
      </p>
      {estimated && (
        <p className="ticket-note">
          {byKm ? t('ticket.estimateKm') : t('ticket.estimate')}
        </p>
      )}
      {others.length > 0 && (
        <details className="ticket-others">
          <summary>{t('ticket.others', { n: others.length })}</summary>
          <table className="products">
            <tbody>
              {others.map((p) => (
                <tr key={p.kind}>
                  <th scope="row">
                    {t(`product.${p.kind}`)}
                    <span className="sub">{ticketDetail(p, t, lang)}</span>
                  </th>
                  <td className="amount">{chf(p.yearly, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

function Timeline({ legs: allLegs }: { legs: Leg[] }) {
  const { t } = useI18n();
  // A one- or two-minute walk between two vehicles is part of the change, not a step.
  const legs = allLegs.filter((l, i) => !(l.mode === 'walk' && l.durationMin <= 2 && i > 0 && i < allLegs.length - 1));
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

function OptionRow(props: { o: CommuteOption; selected: boolean; onSelect: () => void; hasCar: boolean; windowMin: number }) {
  const { t, lang } = useI18n();
  const { o } = props;
  const saved = o.co2SavedKgPerYear;
  const detailId = useId();
  // "every 30 min" reads better than a count of departures in a window.
  const n = o.departuresInWindow;
  const frequency = n === undefined ? null : n <= 1 ? t('opt.once') : t('opt.every', { n: Math.round(props.windowMin / n / 5) * 5 || 5 });
  const early = o.returnTrips ? o.returnTrips.last < '19:30' : false;
  return (
    <li className={`option card${props.selected ? ' is-selected' : ''}`}>
      <h3>
      <button type="button" className="option-head" aria-expanded={props.selected} aria-controls={props.selected ? detailId : undefined} onClick={props.onSelect}>
        <span className="option-main">
          <span className="option-title">{optionName(o, t)}</span>
          <ModeChain legs={o.itinerary.legs} />
        </span>
        <span className="option-figures">
          <span className="option-cost">
            {chf(o.cost.yearly, lang)}
            <small>{t('verdict.perYear')}</small>
          </span>
        </span>
        <span className="option-meta">
          <span>
            <strong>{duration(o.durationMin)}</strong>
            {o.itinerary.legs.some((l) => l.line) && <> · {o.changes === 0 ? t('opt.direct') : t('opt.changes', { n: o.changes })}</>}
          </span>
          {frequency && <span>{frequency}</span>}
          <span>{t('opt.co2short', { kg: num(o.co2KgPerYear, lang) })}</span>
          {early && o.returnTrips && <span className="warn">{t('opt.lastHomeShort', { last: o.returnTrips.last })}</span>}
        </span>
      </button>
      </h3>
      {props.selected && (
        <div className="option-detail" id={detailId}>
          <p className="detail-facts">
            {t('opt.hours', { h: num(o.hoursPerYear, lang) })}
            {saved !== undefined && saved > 0 && props.hasCar && <> · <span className="good">{t('opt.saved', { kg: num(saved, lang) })}</span></>}
          </p>
          {o.returnTrips && early && <p className="detail-facts warn">{t('opt.lastHomeEarly', { last: o.returnTrips.last, arrival: o.returnTrips.lastArrival })}</p>}
          {o.returnTrips === null && <p className="detail-facts warn">{t('opt.noReturn')}</p>}
          <Products products={o.cost.products} />
          {o.cost.extras.length > 0 && (
            <div className="detail-block">
              <h4>{t('opt.extras')}</h4>
              <table className="products">
                <tbody>
                  {o.cost.extras.map((c, i) => (
                    <tr key={i}>
                      <th scope="row">{componentLabel(c, t, lang)}</th>
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

export function OptionList(props: { options: CommuteOption[]; selected: string | null; onSelect: (id: string | null) => void; sort: SortKey; onSort: (s: SortKey) => void; windowMin: number }) {
  const { t } = useI18n();
  const f = { cost: (o: CommuteOption) => o.cost.yearly, time: (o: CommuteOption) => o.durationMin, co2: (o: CommuteOption) => o.co2KgPerYear }[props.sort];
  const sorted = [...props.options].sort((a, b) => f(a) - f(b));
  const hasCar = props.options.some((o) => o.kind === 'car');
  const [all, setAll] = useState(false);
  // Five options answer the question; the rest, and the selected one, stay within reach.
  const LIMIT = 5;
  const shown = all ? sorted : sorted.filter((o, i) => i < LIMIT || o.id === props.selected);
  const hidden = sorted.length - shown.length;
  return (
    <section className="options" id="options" aria-labelledby="options-h">
      <header className="options-head">
        <h2 id="options-h">{t('list.title')}</h2>
        <div className="segmented" role="group" aria-label={t('list.sort')}>
          {(['cost', 'time', 'co2'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={props.sort === k} className={props.sort === k ? 'is-on' : undefined} onClick={() => props.onSort(k)}>
              {t(`sort.${k}`)}
            </button>
          ))}
        </div>
      </header>
      <ul>
        {shown.map((o) => (
          <OptionRow key={o.id} o={o} hasCar={hasCar} windowMin={props.windowMin} selected={o.id === props.selected} onSelect={() => props.onSelect(o.id === props.selected ? null : o.id)} />
        ))}
      </ul>
      {hidden > 0 && (
        <button type="button" className="link-button more-options" onClick={() => setAll(true)}>
          {t('list.more', { n: hidden })}
        </button>
      )}
    </section>
  );
}
