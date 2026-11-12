import type { CommuteOption, CompareResult, FlexibleWork, FlexibleWorkRow, Leg, OptionKind, SharedBikeSuggestion } from '@pendular/engine/types';
import { useI18n, type Key, type T } from '../i18n/index.js';
import { chf, chf2, duration, durationRange, num } from '../lib/format.js';
import { changeStops, optionName } from '../lib/names.js';
import { groupRoute, ticketGroups, type TicketGroup } from '../lib/groups.js';
import { carNote } from '../lib/carNote.js';
import { modeIcon } from '../lib/pictograms.js';
import { ModeChain } from './ModeChain.js';
import { headTicket, PriceYear, productName } from './OptionList.js';

/** The five ways people think of a commute; each card shows the best option of its kinds. */
const CATEGORIES: { id: 'transit' | 'car' | 'active' | 'parkRail' | 'bikeRide'; kinds: OptionKind[]; icons: string[] }[] = [
  { id: 'transit', kinds: ['transit'], icons: ['train-small'] },
  { id: 'car', kinds: ['car'], icons: ['car-small'] },
  { id: 'active', kinds: ['walk', 'bike', 'ebike'], icons: ['walk-small', 'bicycle-small'] },
  { id: 'parkRail', kinds: ['parkRail', 'cityParkRide'], icons: ['park-and-rail-small'] },
  { id: 'bikeRide', kinds: ['bikeRide'], icons: ['bicycle-small', 'train-small'] },
];

const km = (o: CommuteOption) => Object.values(o.kmByMode).reduce((s, x) => s + (x ?? 0), 0);

/** What tells this option from the others of its card: where it changes, where one parks, or the mode. */
function viaLabel(o: CommuteOption, t: T, lang: string): string {
  if (o.kind === 'transit') {
    const via = changeStops(o);
    return via.length ? t('overview.via', { via: via.join(', ') }) : t('opt.direct');
  }
  // A car park is named as one: "P+R Lucens". A city park and ride already carries it ("P+R Vennes").
  if (o.kind === 'parkRail' && o.access) return `P+R ${o.access.name}`;
  if (o.kind === 'cityParkRide' && o.access) return o.access.name;
  if (o.access) return t('overview.via', { via: o.access.name });
  const dist = t('overview.km', { km: num(km(o), lang, km(o) < 10 ? 1 : 0) });
  return o.kind === 'car' ? dist : `${t(`kind.${o.kind}` as Key)}, ${dist}`;
}

function ModeCard(props: { category: (typeof CATEGORIES)[number]; result: CompareResult; selected: string | null; onSelect: (id: string) => void }) {
  const { t, lang } = useI18n();
  const { category, result } = props;
  // One entry per ticket: the cheapest of the card's kinds first; the faster one when two cost the same.
  const mine = ticketGroups(result.options.filter((o) => category.kinds.includes(o.kind))).sort((a, b) => a.yearly - b.yearly || a.minDuration - b.minDuration);
  const group = mine[0];
  const icons = (names: string[]) => (
    <span className="mode-icons" aria-hidden="true">
      {names.map((n) => (
        <img key={n} src={`/icons/sbb/${n}.svg`} alt="" width={24} height={24} />
      ))}
    </span>
  );

  // A way of commuting this search does not offer has no card; the list below says why.
  if (!group) return null;
  // The route the card draws: the selected one when it is on this ticket, else the best one.
  const best = groupRoute(group, props.selected);
  const has = (g: TicketGroup, id: string | null | undefined) => g.routes.some((o) => o.id === id);
  // What tells a ticket from the others of the card: where one parks, else where one changes;
  // several routes without a car park are counted, the list below tells them apart.
  const place = (g: TicketGroup) => (g.routes[0]!.access || g.routes.length === 1 ? viaLabel(g.routes[0]!, t, lang) : t('group.routes', { n: g.routes.length }));
  // The same place twice (two tickets from one car park): the ticket says which is which.
  const ticketOf = (g: TicketGroup) => {
    const p = (g.routes.find((o) => o.cost.yearly === g.yearly) ?? g.routes[0]!).cost.products[0];
    if (!p) return '';
    const zoned = p.components.find((c) => c.key.startsWith('mobilis.') && typeof c.params?.zones === 'number');
    return zoned ? t('product.zones', { n: zoned.params!.zones as number }) : headTicket(p, t);
  };
  const shownGroups = mine.slice(0, 3);
  const label = (g: TicketGroup) => {
    const twice = shownGroups.some((x) => x !== g && place(x) === place(g));
    const ticket = twice ? ticketOf(g) : '';
    return ticket ? `${place(g)} · ${ticket}` : place(g);
  };
  // A city park and ride is not a P+Rail: the card takes the name of what it shows.
  const name = best.kind === 'cityParkRide' ? t('kind.cityParkRide') : t(`cat.${category.id}`);

  const v = result.verdict;
  const tags = [has(group, v.cheapest) && t('verdict.cheapest'), has(group, v.fastest) && t('verdict.fastest'), has(group, v.greenest) && t('verdict.greenest')].filter(Boolean) as string[];
  const note = best.kind === 'car' ? carNote(result.stamp.car, t) : null;
  const others = mine.slice(1, 3);
  const active = has(group, props.selected);
  return (
    <li className={`mode-card card${active ? ' is-selected' : ''}`}>
      <button type="button" className="mode-main" aria-pressed={active} onClick={() => props.onSelect(best.id)}>
        <span className="mode-label">
          {icons(category.id === 'active' ? [modeIcon(best.kind)] : category.icons)}
          <span className="eyebrow">{name}</span>
        </span>
        <span className="mode-figures">
          <span className="figure">{durationRange(group.minDuration, group.maxDuration)}</span>
          <span className="mode-cost">
            {chf(group.yearly, lang)} <small>{t('verdict.perYear')}</small>
          </span>
        </span>
        <span className="mode-via">{label(group)}</span>
        {best.itinerary.legs.some((l) => l.line) && <ModeChain legs={best.itinerary.legs} />}
        {note && <span className="mode-note">{note}</span>}
        {tags.length > 0 && (
          <span className="mode-tags">
            {tags.map((x) => (
              <span key={x} className="mode-tag">
                {x}
              </span>
            ))}
          </span>
        )}
      </button>
      {others.length > 0 && (
        <ul className="mode-also" aria-label={t('overview.also')}>
          {others.map((g) => {
            const o = groupRoute(g, props.selected);
            return (
              <li key={g.key}>
                <button type="button" aria-pressed={has(g, props.selected)} title={optionName(o, t)} onClick={() => props.onSelect(o.id)}>
                  <span>{label(g)}</span>
                  <span>
                    {durationRange(g.minDuration, g.maxDuration)} · {chf(g.yearly, lang)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

/** Consecutive numbers of days that need the same ticket at the same price are one line. */
function flexGroups(rows: FlexibleWorkRow[]): { from: number; to: number; row: FlexibleWorkRow }[] {
  const out: { from: number; to: number; row: FlexibleWorkRow }[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last && last.to === row.daysPerWeek - 1 && last.row.product.kind === row.product.kind && last.row.product.yearly === row.product.yearly) last.to = row.daysPerWeek;
    else out.push({ from: row.daysPerWeek, to: row.daysPerWeek, row });
  }
  return out;
}

function FlexibleWorkCard(props: { flex: FlexibleWork; option: CommuteOption; daysSearched: number }) {
  const { t, lang } = useI18n();
  const groups = flexGroups(props.flex.rows);
  return (
    <section className="flex card" aria-labelledby="flex-h">
      <div className="flex-head">
        <img src="/icons/sbb/house-small.svg" alt="" width={24} height={24} />
        <div>
          <h2 id="flex-h">{t('flex.title')}</h2>
          <p>{t('flex.intro', { name: optionName(props.option, t) })}</p>
        </div>
      </div>
      <table className="flex-rows">
        <tbody>
          {groups.map((g) => {
            const yours = props.daysSearched >= g.from && props.daysSearched <= g.to;
            return (
              <tr key={g.from} className={yours ? 'is-yours' : undefined}>
                <th scope="row">
                  {g.from === g.to ? t('flex.days', { n: g.from }) : t('flex.daysRange', { from: g.from, to: g.to })}
                  {yours && <span className="mode-tag">{t('flex.yours')}</span>}
                </th>
                <td className="flex-product">
                  {productName(g.row.product, t)}
                  <PriceYear product={g.row.product} />
                </td>
                <td className="flex-price">
                  {chf(g.row.product.yearly, lang)} <small>{t('verdict.perYear')}</small>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** The all-zones pass is worth a line when it costs at most this much more than the pass for the trip. */
const ALL_ZONES_MAX_EXTRA = 0.3;

/** Shown when the trip calls for an annual zone pass and the whole network costs little more. */
function AllZonesCard({ option }: { option: CommuteOption }) {
  const { t, lang } = useI18n();
  const own = option.cost.products[0];
  const all = option.cost.products.find((p) => p.kind === 'zonePassAllYearly');
  if (!own || own.kind !== 'zonePassYearly' || !all) return null;
  const extra = all.yearly - own.yearly;
  if (extra <= 0 || extra > own.yearly * ALL_ZONES_MAX_EXTRA) return null;
  return (
    <section className="allzones card" aria-labelledby="allzones-h">
      <img src="/icons/sbb/train-station-small.svg" alt="" width={24} height={24} />
      <div>
        <h2 id="allzones-h">{t('allzones.title', { chf: chf(extra, lang) })}</h2>
        <p>{t('allzones.text', { network: all.network ?? 'Mobilis', month: chf(extra / 12, lang), own: chf(own.yearly, lang) })}</p>
      </div>
      <p className="allzones-price">
        <span>
          {productName(all, t)}
          <PriceYear product={all} />
        </span>
        <strong>
          {chf(all.yearly, lang)} <small>{t('verdict.perYear')}</small>
        </strong>
      </p>
    </section>
  );
}

const PUBLIC_TRANSPORT = new Set(['rail', 'bus', 'tram', 'metro', 'boat', 'funicular', 'cableway']);
const VEHICLES = new Set(['rail', 'bus', 'tram', 'metro', 'boat']);

/**
 * One box for the one shared-bike idea worth a look: what it saves, how it goes, what it costs
 * next to the public transport option it is compared with, and what cannot be promised.
 */
function SharedBikeCard(props: { bike: SharedBikeSuggestion; against?: CommuteOption; selected: boolean; onShowOnMap: () => void }) {
  const { t, lang } = useI18n();
  const { bike: b, against } = props;
  const saved = b.against?.minutesSaved ?? 0;
  const title =
    saved > 0
      ? t(`sbike.title.${b.kind}`, { min: duration(saved) })
      : b.kind !== 'whole' && (b.against?.changesSaved ?? 0) > 0
        ? t('sbike.title.change')
        : t('sbike.title.plain', { min: duration(b.durationMin) });

  // How it goes, in one sentence.
  const transit = b.itinerary.legs.filter((l: Leg) => PUBLIC_TRANSPORT.has(l.mode));
  const vehicle = t(`sbike.vehicle.${transit.length === 1 && VEHICLES.has(transit[0]!.mode) ? (transit[0]!.mode as 'rail' | 'bus' | 'tram' | 'metro' | 'boat') : 'other'}`);
  const walk = (min: number, key: 'sbike.walk' | 'sbike.walkWork' | 'sbike.walkHome') => (min > 0 ? t(key, { min: duration(min) }) : '');
  const ride = duration(b.rideMin);
  const { from, to } = b.stations;
  const how =
    b.kind === 'lastLeg'
      ? t('sbike.how.lastLeg', { vehicle, stop: transit[transit.length - 1]?.to.name ?? '', operator: b.operator, station: from.name, walk: walk(from.walkMin, 'sbike.walk'), ride })
      : b.kind === 'firstLeg'
        ? t('sbike.how.firstLeg', { operator: b.operator, station: from.name, walk: walk(from.walkMin, 'sbike.walkHome'), ride, stop: transit[0]?.from.name ?? '' })
        : t('sbike.how.whole', { operator: b.operator, from: from.name, walk: walk(from.walkMin, 'sbike.walkHome'), to: to.name, walkTo: walk(to.walkMin, 'sbike.walkWork'), ride, km: num(b.rideKm, lang, 1) });
  const total = against && saved > 0 ? t('sbike.totalVs', { min: duration(b.durationMin), other: duration(against.durationMin) }) : saved > 0 || b.kind !== 'whole' ? t('sbike.total', { min: duration(b.durationMin) }) : '';

  // What it costs: against the public transport option where there is one.
  const m = b.cost.membership;
  const delta = b.against?.chfPerYear;
  const price = m.unknown
    ? t('sbike.cost.unknown')
    : delta === undefined || delta === null
      ? t('sbike.cost.total', { chf: chf(b.cost.yearly ?? 0, lang) })
      : delta > 0
        ? t('sbike.cost.more', { chf: chf(delta, lang) })
        : delta < 0
          ? t('sbike.cost.less', { chf: chf(-delta, lang) })
          : t('sbike.cost.same');
  const perRide = chf2(m.perRide ?? 0, lang);
  const detail = m.unknown
    ? b.cost.ticket
      ? t('sbike.cost.ticket', { chf: chf(b.cost.ticket.yearly, lang) })
      : ''
    : m.key === 'bikeShare.annual'
      ? t('sbike.cost.annual', { operator: b.operator, chf: chf(m.yearly, lang) })
      : b.caveats.includes('membershipPriceUnknown')
        ? t('sbike.cost.perRideUnknown', { price: perRide, operator: b.operator })
        : t('sbike.cost.perRide', { price: perRide });
  return (
    <section className={`sbike card${props.selected ? ' is-selected' : ''}`} aria-labelledby="sbike-h">
      <img src="/icons/sbb/bicycle-medium.svg" alt="" width={36} height={36} />
      <div className="sbike-text">
        <p className="eyebrow">{t('sbike.eyebrow')}</p>
        <h2 id="sbike-h">{title}</h2>
        <p>
          {how} {total}
        </p>
        <ModeChain legs={b.itinerary.legs} />
      </div>
      <p className="sbike-price">
        <strong>{price}</strong>
        {detail && (
          <span>
            {detail}
            {m.priceYear && !m.unknown ? <small className="price-year"> · {t('network.priceYear', { year: m.priceYear })}</small> : null}
          </span>
        )}
      </p>
      <p className="sbike-foot">
        <span>
          {t('sbike.caveat.availability')}
          {m.ebikeExtraPerRide ? ` ${t('sbike.caveat.electric', { price: chf2(m.ebikeExtraPerRide, lang) })}` : ''}
        </span>
        <button type="button" className="link-button" aria-pressed={props.selected} onClick={props.onShowOnMap}>
          {t('sbike.map')}
        </button>
      </p>
    </section>
  );
}

export function Overview(props: { result: CompareResult; daysSearched: number; selected: string | null; onSelect: (id: string) => void; onShowOnMap?: (id: string) => void }) {
  const { t } = useI18n();
  const { result } = props;
  const flex = result.flexibleWork;
  const flexOption = flex && result.options.find((o) => o.id === flex.optionId);
  const bike = result.sharedBike;
  // Up to three cards leave room for the working-from-home box on the same line.
  const cards = CATEGORIES.filter((c) => result.options.some((o) => c.kinds.includes(o.kind))).length;
  const inline = !!flexOption && cards <= 3;
  return (
    <section className={inline ? 'overview is-inline' : 'overview'} style={{ '--cards': cards } as React.CSSProperties} aria-labelledby="overview-h">
      <h2 id="overview-h">{t('overview.title')}</h2>
      <ul className="mode-cards">
        {CATEGORIES.map((c) => (
          <ModeCard key={c.id} category={c} result={result} selected={props.selected} onSelect={props.onSelect} />
        ))}
      </ul>
      {bike && (
        <SharedBikeCard
          bike={bike}
          against={result.options.find((o) => o.id === bike.against?.optionId)}
          selected={props.selected === bike.id}
          onShowOnMap={() => (props.onShowOnMap ?? props.onSelect)(bike.id)}
        />
      )}
      {flex && flexOption && <FlexibleWorkCard flex={flex} option={flexOption} daysSearched={props.daysSearched} />}
      {flexOption && <AllZonesCard option={flexOption} />}
    </section>
  );
}
