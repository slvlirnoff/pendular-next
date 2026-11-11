import { useId, useState } from 'react';
import type { CarAssumptions, CommuteOption, CostComponent, Leg, PricedProduct } from '@pendular/engine/types';
import { useI18n, type Key } from '../i18n/index.js';
import { chf, chf2, duration, hhmm, num } from '../lib/format.js';
import { optionName } from '../lib/names.js';
import { departuresSummary } from '../lib/schedule.js';
import { carNote } from '../lib/carNote.js';
import { LegBadge, ModeChain } from './ModeChain.js';

function componentLabel(c: CostComponent, t: ReturnType<typeof useI18n>['t'], lang: string): string {
  const p = c.params ?? {};
  const known = `cost.${c.key}` as Key;
  const unit = typeof p.unit === 'number' && typeof p.times === 'number' && p.times > 1 ? `${p.times} × ${chf2(p.unit, lang)}` : '';
  const where = typeof p.zones === 'number' ? t('product.zones', { n: p.zones }) : typeof p.km === 'number' && !c.key.startsWith('car') ? t('product.km', { km: p.km }) : '';
  if (c.key.startsWith('mobilis.') || c.key.startsWith('national.') || c.key.startsWith('ga.')) {
    return [where, unit, c.key.endsWith('vaudDiscount') ? t('cost.vaudDiscount') : ''].filter(Boolean).join(' · ');
  }
  // A zone network other than Mobilis: one sentence naming the network and its zones.
  if (c.key.startsWith('network.')) {
    const zones = typeof p.zones === 'number' ? p.zones : 0;
    return [t(c.key as Key, { network: p.network ?? '', zones, n: zones }), unit].filter(Boolean).join(' · ');
  }
  const text = t(known, p as Record<string, string | number>);
  return text === known ? c.key : text;
}

/** The all-zones pass of a network other than Mobilis is named after that network. */
export function productName(p: PricedProduct, t: ReturnType<typeof useI18n>['t']): string {
  if (p.kind === 'zonePassAllYearly' && p.network && p.components[0]?.key.startsWith('network.')) return t('network.year.all', { network: p.network });
  return t(`product.${p.kind}`);
}

function ticketDetail(p: PricedProduct, t: ReturnType<typeof useI18n>['t'], lang: string): string {
  return p.components
    // Already said by the product's name.
    .filter((c) => !c.key.startsWith('network.year.all'))
    .map((c) => componentLabel(c, t, lang))
    .filter(Boolean)
    .join(' + ');
}

/** Prices of another year than the coming timetable year: said next to the product, in few words. */
export function PriceYear({ product }: { product: PricedProduct }) {
  const { t } = useI18n();
  return product.priceYear ? <small className="price-year"> · {t('network.priceYear', { year: product.priceYear })}</small> : null;
}

/** The ticket to buy, stated once; the alternatives stay one click away. */
function Products({ products, sameAs }: { products: PricedProduct[]; sameAs?: string }) {
  const { t, lang } = useI18n();
  const best = products[0];
  if (!best) return null;
  // Same pass as an option listed above: say so instead of repeating the block.
  if (sameAs) {
    return (
      <div className="detail-block">
        <h4>{t('ticket.buy')}</h4>
        <p>{t('ticket.sameDetail', { name: sameAs, product: productName(best, t), chf: chf(best.yearly, lang) })}</p>
      </div>
    );
  }
  // A day pass at the price of two singles adds nothing to read.
  const others = products.slice(1).filter((p, i, list) => !(p.kind.includes('DayPass') && list.some((q) => q !== p && q.yearly === p.yearly)));
  const estimated = best.provenance === 'estimated';
  const byKm = best.components.some((c) => typeof c.params?.km === 'number');
  return (
    <div className="detail-block">
      <h4>{t('ticket.buy')}</h4>
      <p className="ticket">
        <span className="ticket-name">
          {productName(best, t)}
          <PriceYear product={best} />
        </span>
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
          {best.priceYear ? t('ticket.estimateYear', { year: best.priceYear, network: best.network ?? '' }) : byKm ? t('ticket.estimateKm') : t('ticket.estimate')}
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
                    {productName(p, t)}
                    <PriceYear product={p} />
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
  // A one- or two-minute walk to, from or between vehicles is not a step worth a line.
  const legs = allLegs.filter((l, i) => !(l.mode === 'walk' && l.durationMin <= 2 && allLegs.length > 1));
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

function OptionRow(props: { o: CommuteOption; selected: boolean; onSelect: () => void; hasCar: boolean; car?: CarAssumptions; sameAs?: string }) {
  const { t, lang } = useI18n();
  const { o } = props;
  const saved = o.co2SavedKgPerYear;
  const detailId = useId();
  const frequency = departuresSummary(o, t);
  const assumptions = o.kind === 'car' ? carNote(props.car, t) : null;
  const conns = o.connections ?? [];
  // A departure after midnight (before 04:00) is a late one, not an early one.
  const early = o.returnTrips ? o.returnTrips.last >= '04:00' && o.returnTrips.last < '19:30' : false;
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
          {early && o.returnTrips && <span className="warn">{t('opt.lastHomeShort', { last: o.returnTrips.last, arrival: o.returnTrips.lastArrival })}</span>}
        </span>
        {props.sameAs && <span className="option-note">{t('ticket.same', { name: props.sameAs })}</span>}
        {assumptions && <span className="option-note">{assumptions}</span>}
      </button>
      </h3>
      {props.selected && (
        <div className="option-detail" id={detailId}>
          <p className="detail-facts">
            {t('opt.hours', { h: num(o.hoursPerYear, lang) })}
            {saved !== undefined && saved > 0 && props.hasCar && <> · <span className="good">{t('opt.saved', { kg: num(saved, lang) })}</span></>}
          </p>
          {o.returnTrips === null && <p className="detail-facts warn">{t('opt.noReturn')}</p>}
          {conns.length >= 2 && conns.length <= 4 && (
            <div className="detail-block">
              <h4>{t('opt.times')}</h4>
              <p className="conn-times">
                {conns.map((c) => (
                  <span key={c.departure}>
                    {c.departure} → {c.arrival}
                  </span>
                ))}
              </p>
            </div>
          )}
          <Products products={o.cost.products} sameAs={props.sameAs} />
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

export function OptionList(props: { options: CommuteOption[]; selected: string | null; onSelect: (id: string | null) => void; sort: SortKey; onSort: (s: SortKey) => void; car?: CarAssumptions }) {
  const { t } = useI18n();
  const f = { cost: (o: CommuteOption) => o.cost.yearly, time: (o: CommuteOption) => o.durationMin, co2: (o: CommuteOption) => o.co2KgPerYear }[props.sort];
  const sorted = [...props.options].sort((a, b) => f(a) - f(b));
  const hasCar = props.options.some((o) => o.kind === 'car');
  const [all, setAll] = useState(false);
  // Five options answer the question; the rest, and the selected one, stay within reach.
  const LIMIT = 5;
  const shown = all ? sorted : sorted.filter((o, i) => i < LIMIT || o.id === props.selected);
  const hidden = sorted.length - shown.length;
  // Options needing the same ticket at the same price: the first listed shows it, the others point to it.
  const ticketOwner = new Map<string, CommuteOption>();
  const sameAs = (o: CommuteOption): string | undefined => {
    const best = o.cost.products[0];
    if (!o.fareKey || !best) return undefined;
    const key = `${o.fareKey}|${best.kind}|${Math.round(best.yearly)}`;
    const owner = ticketOwner.get(key);
    if (!owner) ticketOwner.set(key, o);
    return owner && owner !== o ? optionName(owner, t) : undefined;
  };
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
          <OptionRow key={o.id} o={o} hasCar={hasCar} car={props.car} sameAs={sameAs(o)} selected={o.id === props.selected} onSelect={() => props.onSelect(o.id === props.selected ? null : o.id)} />
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
