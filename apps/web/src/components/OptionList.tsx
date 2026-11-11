import { useId, useState } from 'react';
import type { CarAssumptions, CommuteOption, CostComponent, Leg, PricedProduct } from '@pendular/engine/types';
import { useI18n, type Key } from '../i18n/index.js';
import { chf, chf2, duration, durationRange, hhmm, num } from '../lib/format.js';
import { changeStops, changeStopsOf, optionName } from '../lib/names.js';
import { departuresSummary, medianGap } from '../lib/schedule.js';
import { groupBest, groupDepartures, groupRoute, isEarlyReturn, lastReturn, ticketGroups, type TicketGroup } from '../lib/groups.js';
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

function Timeline({ legs: allLegs, note }: { legs: Leg[]; note?: string }) {
  const { t } = useI18n();
  // A one- or two-minute walk to, from or between vehicles is not a step worth a line.
  const legs = allLegs.filter((l, i) => !(l.mode === 'walk' && l.durationMin <= 2 && allLegs.length > 1));
  return (
    <div className="detail-block">
      <h4>
        {t('opt.trip')}
        {note && <span className="h4-note"> · {note}</span>}
      </h4>
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

/** The ticket in one line for the head of a card: its name and, where zones make the price, how many. */
function headTicket(p: PricedProduct, t: ReturnType<typeof useI18n>['t']): string {
  const only = p.components.length === 1 ? p.components[0]! : undefined;
  if (only?.key.startsWith('network.') && !only.key.startsWith('network.year.all')) {
    const zones = typeof only.params?.zones === 'number' ? only.params.zones : 0;
    return t(only.key as Key, { network: only.params?.network ?? '', zones, n: zones });
  }
  const zoned = p.components.find((c) => c.key.startsWith('mobilis.') && typeof c.params?.zones === 'number');
  return zoned ? `${productName(p, t)} · ${t('product.zones', { n: zoned.params!.zones as number })}` : productName(p, t);
}

function Extras({ o }: { o: CommuteOption }) {
  const { t, lang } = useI18n();
  if (o.cost.extras.length === 0) return null;
  return (
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
  );
}

/** What tells a route from the others on the same ticket: where one changes. */
function routeVia(o: CommuteOption, t: ReturnType<typeof useI18n>['t']): string {
  const via = changeStops(o);
  return via.length ? t('overview.via', { via: via.join(', ') }) : t('opt.direct');
}

/** The vehicles of a trip, and the car or bike that leads to them; walks are left out. */
const lineLegs = (all: Leg[]) => {
  const legs = all.filter((l) => l.mode !== 'walk');
  return legs.length ? legs : all;
};

/** Up to this many departures are listed at once; more wait behind their summary. */
const DEPARTURES_OPEN = 6;

/** A departure chosen in a card: which route it belongs to and the trip itself. */
export interface PickedTrip {
  id: string;
  departure: string;
  legs: Leg[];
}

/**
 * When to leave home, all routes of the ticket together. Every row says the same things: the
 * times, the lines, where one changes, how long it takes. Choosing a row shows that trip below.
 */
function Departures(props: { group: TicketGroup; shown: CommuteOption; picked: PickedTrip | null; onPick: (p: PickedTrip) => void }) {
  const { t } = useI18n();
  const { group, shown, picked } = props;
  const rows = groupDepartures(group);
  if (rows.length === 0) return null;
  // Without a choice, the trip shown below is the typical one of the route on screen.
  const current = picked ? { id: picked.id, departure: picked.departure } : { id: shown.id, departure: hhmm(shown.itinerary.departure) };
  const list = (
    <ul className="departures">
      {rows.map((c) => {
        const legs = c.legs ?? c.route.itinerary.legs;
        const via = changeStopsOf(legs);
        const on = c.route.id === current.id && c.departure === current.departure;
        return (
          <li key={`${c.route.id}-${c.departure}-${c.arrival}`}>
            <button type="button" aria-pressed={on} onClick={() => props.onPick({ id: c.route.id, departure: c.departure, legs })}>
              <span className="dep-times">
                <strong>{c.departure}</strong> → {c.arrival}
              </span>
              <span className="dep-route">
                <ModeChain legs={lineLegs(legs)} />
                {via.length > 0 && <span className="dep-via">{t('overview.via', { via: via.join(', ') })}</span>}
              </span>
              <span className="dep-duration">
                {duration(c.durationMin)}
                <span className="dep-changes"> · {c.changes === 0 ? t('opt.direct') : t('opt.changes', { n: c.changes })}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
  if (rows.length <= DEPARTURES_OPEN) {
    return (
      <div className="detail-block">
        <h4>{t('group.depTitle')}</h4>
        {list}
      </div>
    );
  }
  const times = rows.map((c) => c.departure);
  return (
    <details className="detail-fold">
      <summary>{t('group.depSummary', { count: rows.length, first: times[0]!, last: times[times.length - 1]!, n: medianGap(times) })}</summary>
      {list}
    </details>
  );
}

/** The routes the ticket covers; choosing one shows it below and on the map. */
function Routes(props: { group: TicketGroup; shown: CommuteOption; onSelect: (id: string) => void }) {
  const { t } = useI18n();
  const { group, shown } = props;
  // Closed unless the route on screen is not the one the card opens with.
  const [open, setOpen] = useState(shown !== group.routes[0]);
  return (
    <details className="detail-fold" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t('group.routesTitle', { n: group.routes.length })}</summary>
      <ul className="routes">
        {group.routes.map((o) => {
          const times = departuresSummary(o, t);
          const back = o.returnTrips;
          return (
            <li key={o.id}>
              <button type="button" aria-pressed={o === shown} onClick={() => props.onSelect(o.id)}>
                <span className="route-top">
                  <ModeChain legs={lineLegs(o.itinerary.legs)} />
                  {o === shown && <span className="mode-tag">{t('group.routeShown')}</span>}
                </span>
                <span className="route-facts">
                  <span>
                    <strong>{duration(o.durationMin)}</strong> · {routeVia(o, t)}
                    {o.changes > 0 && <> · {t('opt.changes', { n: o.changes })}</>}
                  </span>
                  {times && <span>{times}</span>}
                  {back && <span className={isEarlyReturn(back) ? 'warn' : undefined}>{t('opt.lastHomeShort', { last: back.last, arrival: back.lastArrival })}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** One card per ticket: what it costs and what it allows; the routes inside. */
function GroupCard(props: { group: TicketGroup; selected: string | null; onSelect: (id: string | null) => void; hasCar: boolean; picked: PickedTrip | null; onPick: (p: PickedTrip | null) => void }) {
  const { t, lang } = useI18n();
  const { group } = props;
  const open = group.routes.some((o) => o.id === props.selected);
  const shown = groupRoute(group, props.selected);
  const detailId = useId();
  const n = group.routes.length;
  const cheapest = group.routes.find((o) => o.cost.yearly === group.yearly) ?? shown;
  const ticket = cheapest.cost.products[0];
  const title = shown.kind === 'transit' ? t('kind.transit') : optionName(shown, t);
  const changes =
    group.minChanges === group.maxChanges
      ? group.maxChanges === 0
        ? t('opt.direct')
        : t('opt.changes', { n: group.maxChanges })
      : group.minChanges === 0
        ? t('group.changesUpTo', { n: group.maxChanges })
        : t('group.changesRange', { min: group.minChanges, n: group.maxChanges });
  const co2 = group.routes.map((o) => o.co2KgPerYear);
  const co2Low = num(Math.min(...co2), lang);
  const co2High = num(Math.max(...co2), lang);
  const back = lastReturn(group);
  // Which search gave the last trip home: any line the pass covers, or the route of the morning trip.
  const within = back?.within === 'pass' ? t('opt.lastHomePass') : back?.within === 'route' ? t('opt.lastHomeRoute') : null;
  const saved = shown.co2SavedKgPerYear;
  // A departure chosen in this card, as long as its route is the one on screen.
  const picked = props.picked && props.picked.id === shown.id && shown.connections?.some((c) => c.departure === props.picked!.departure) ? props.picked : null;
  const pick = (p: PickedTrip) => {
    props.onPick(p);
    if (p.id !== shown.id) props.onSelect(p.id);
  };
  return (
    <li className={`option card${open ? ' is-selected' : ''}`}>
      <h3>
        <button type="button" className="option-head" aria-expanded={open} aria-controls={open ? detailId : undefined} onClick={() => props.onSelect(open ? null : shown.id)}>
          <span className="option-main">
            <span className="option-title">{title}</span>
            {n === 1 && <ModeChain legs={shown.itinerary.legs} />}
          </span>
          <span className="option-figures">
            <span className="option-cost">
              {chf(group.yearly, lang)}
              <small>{t('verdict.perYear')}</small>
            </span>
          </span>
          {ticket && (
            <span className="option-ticket">
              {headTicket(ticket, t)}
              {ticket.yearly > 0 && <span className="option-month"> · {t('ticket.perMonth', { chf: chf(ticket.yearly / 12, lang) })}</span>}
            </span>
          )}
          <span className="option-meta">
            <span>
              <strong>{durationRange(group.minDuration, group.maxDuration)}</strong> · {changes}
            </span>
            {group.departures > 0 && (
              <span>
                {t('group.departures', { n: group.departures })}
                {n > 1 && `, ${t('group.routes', { n })}`}
              </span>
            )}
            <span>{t('opt.co2short', { kg: co2Low === co2High ? co2Low : `${co2Low}–${co2High}` })}</span>
            {back && (
              <span className={isEarlyReturn(back) ? 'warn' : undefined}>
                {t('opt.lastHomeShort', { last: back.last, arrival: back.lastArrival })}
                {within && <span className="qualifier"> · {within}</span>}
              </span>
            )}
          </span>
        </button>
      </h3>
      {open && (
        <div className="option-detail" id={detailId}>
          {!back && group.routes.some((o) => o.returnTrips === null) && <p className="detail-facts warn">{t('opt.noReturn')}</p>}
          <Departures group={group} shown={shown} picked={picked} onPick={pick} />
          {n > 1 && <Routes group={group} shown={shown} onSelect={props.onSelect} />}
          <Products products={shown.cost.products} />
          <Extras o={shown} />
          <Timeline legs={picked?.legs ?? shown.itinerary.legs} note={t('group.tripAt', { time: picked?.departure ?? hhmm(shown.itinerary.departure) })} />
          <p className="detail-facts">
            {t('opt.hours', { h: num(shown.hoursPerYear, lang) })}
            {saved !== undefined && saved > 0 && props.hasCar && <> · <span className="good">{t('opt.saved', { kg: num(saved, lang) })}</span></>}
          </p>
        </div>
      )}
    </li>
  );
}

/** A way without a ticket (car, walk, bike): one route, one card. */
function OptionRow(props: { o: CommuteOption; selected: boolean; onSelect: () => void; hasCar: boolean; car?: CarAssumptions }) {
  const { t, lang } = useI18n();
  const { o } = props;
  const saved = o.co2SavedKgPerYear;
  const detailId = useId();
  const frequency = departuresSummary(o, t);
  const assumptions = o.kind === 'car' ? carNote(props.car, t) : null;
  const early = o.returnTrips ? isEarlyReturn(o.returnTrips) : false;
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
          {o.returnTrips && !early && <p className="detail-facts">{t('opt.lastHome', { last: o.returnTrips.last, arrival: o.returnTrips.lastArrival })}</p>}
          <Products products={o.cost.products} />
          <Extras o={o} />
          <Timeline legs={o.itinerary.legs} />
        </div>
      )}
    </li>
  );
}

export type SortKey = 'cost' | 'time' | 'co2';

export function OptionList(props: { options: CommuteOption[]; selected: string | null; onSelect: (id: string | null) => void; sort: SortKey; onSort: (s: SortKey) => void; car?: CarAssumptions; picked: PickedTrip | null; onPick: (p: PickedTrip | null) => void }) {
  const { t } = useI18n();
  const f = { cost: (o: CommuteOption) => o.cost.yearly, time: (o: CommuteOption) => o.durationMin, co2: (o: CommuteOption) => o.co2KgPerYear }[props.sort];
  // One card per ticket; a card sorts by its best route.
  const sorted = ticketGroups(props.options).sort((a, b) => groupBest(a, f) - groupBest(b, f));
  const hasCar = props.options.some((o) => o.kind === 'car');
  const [all, setAll] = useState(false);
  // Five cards answer the question; the rest, and the selected one, stay within reach.
  const LIMIT = 5;
  const shown = all ? sorted : sorted.filter((g, i) => i < LIMIT || g.routes.some((o) => o.id === props.selected));
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
        {shown.map((g) => {
          const o = g.routes[0]!;
          return g.ticketed ? (
            <GroupCard key={g.key} group={g} hasCar={hasCar} selected={props.selected} onSelect={props.onSelect} picked={props.picked} onPick={props.onPick} />
          ) : (
            <OptionRow key={g.key} o={o} hasCar={hasCar} car={props.car} selected={o.id === props.selected} onSelect={() => props.onSelect(o.id === props.selected ? null : o.id)} />
          );
        })}
      </ul>
      {hidden > 0 && (
        <button type="button" className="link-button more-options" onClick={() => setAll(true)}>
          {t('list.more', { n: hidden })}
        </button>
      )}
    </section>
  );
}
