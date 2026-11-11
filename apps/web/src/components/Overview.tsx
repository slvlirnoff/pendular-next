import type { CommuteOption, CompareResult, FlexibleWork, FlexibleWorkRow, OptionKind } from '@pendular/engine/types';
import { useI18n, type Key, type T } from '../i18n/index.js';
import { chf, duration, num } from '../lib/format.js';
import { changeStops, optionName } from '../lib/names.js';
import { carNote } from '../lib/carNote.js';
import { modeIcon } from '../lib/pictograms.js';
import { ModeChain } from './ModeChain.js';
import { PriceYear, productName } from './OptionList.js';

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
  if (o.access) return t('overview.via', { via: o.access.name });
  const dist = t('overview.km', { km: num(km(o), lang, km(o) < 10 ? 1 : 0) });
  return o.kind === 'car' ? dist : `${t(`kind.${o.kind}` as Key)}, ${dist}`;
}

function ModeCard(props: { category: (typeof CATEGORIES)[number]; result: CompareResult; selected: string | null; onSelect: (id: string) => void }) {
  const { t, lang } = useI18n();
  const { category, result } = props;
  // Cheapest of the card's kinds; the faster one when two cost the same.
  const mine = result.options.filter((o) => category.kinds.includes(o.kind)).sort((a, b) => a.cost.yearly - b.cost.yearly || a.durationMin - b.durationMin);
  const best = mine[0];
  const label = t(`cat.${category.id}`);
  const icons = (names: string[]) => (
    <span className="mode-icons" aria-hidden="true">
      {names.map((n) => (
        <img key={n} src={`/icons/sbb/${n}.svg`} alt="" width={24} height={24} />
      ))}
    </span>
  );

  // A way of commuting this search does not offer has no card; the list below says why.
  if (!best) return null;

  const v = result.verdict;
  const tags = [v.cheapest === best.id && t('verdict.cheapest'), v.fastest === best.id && t('verdict.fastest'), v.greenest === best.id && t('verdict.greenest')].filter(Boolean) as string[];
  const note = best.kind === 'car' ? carNote(result.stamp.car, t) : null;
  const others = mine.slice(1, 3);
  return (
    <li className={`mode-card card${best.id === props.selected ? ' is-selected' : ''}`}>
      <button type="button" className="mode-main" aria-pressed={best.id === props.selected} onClick={() => props.onSelect(best.id)}>
        <span className="mode-label">
          {icons(category.id === 'active' ? [modeIcon(best.kind)] : category.icons)}
          <span className="eyebrow">{label}</span>
        </span>
        <span className="mode-figures">
          <span className="figure">{duration(best.durationMin)}</span>
          <span className="mode-cost">
            {chf(best.cost.yearly, lang)} <small>{t('verdict.perYear')}</small>
          </span>
        </span>
        <span className="mode-via">{viaLabel(best, t, lang)}</span>
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
          {others.map((o) => (
            <li key={o.id}>
              <button type="button" aria-pressed={o.id === props.selected} title={optionName(o, t)} onClick={() => props.onSelect(o.id)}>
                <span>{viaLabel(o, t, lang)}</span>
                <span>
                  {duration(o.durationMin)} · {chf(o.cost.yearly, lang)}
                </span>
              </button>
            </li>
          ))}
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

export function Overview(props: { result: CompareResult; daysSearched: number; selected: string | null; onSelect: (id: string) => void }) {
  const { t } = useI18n();
  const { result } = props;
  const flex = result.flexibleWork;
  const flexOption = flex && result.options.find((o) => o.id === flex.optionId);
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
      {flex && flexOption && <FlexibleWorkCard flex={flex} option={flexOption} daysSearched={props.daysSearched} />}
    </section>
  );
}
