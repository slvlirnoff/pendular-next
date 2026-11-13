import { forwardRef, useEffect, useId, useRef, useState } from 'react';
import type { BrandHit, PlaceHit, PlaceSummary, SearchResponse, SearchResult, Suggestion } from '../../../src/api';
import { REGION } from '../region';
import { FOODS, FOOD_BY_KEY, foodIn } from '../../../src/foods';
import { KIND_SEARCHES, KIND_SEARCH_BY_KEY, kindInfo } from '../../../src/kinds';
import { searchKey } from '../../../src/text';
import { count, foodLabel, kindName, searchLabel, t } from '../i18n';
import { LangPicker } from './Welcome';
import { api, brandSearch, distance, distanceTo, foodSearch, kindLabel, kindSearch, leadMode, MODE, minutes, nameSearch, openLabel, placeEmoji, sortResults, stopEmoji, timeOf, type Here, type Searched, type Sort, UNIT, placeName } from '../lib';
import { Logo } from './Welcome';

const PAGE = 5;
/** Shortcut rows show this many chips folded (a phone scrolls them sideways); the title opens the whole list. */
/** Chips shown on a phone's row before its "+N" (the row scrolls sideways). */
const FOLDED = 6;

type ChipItem = { key: string; emoji: string; label: string; pick: () => void };

function useWide(): boolean {
  const [wide, setWide] = useState(() => matchMedia('(min-width: 900px)').matches);
  useEffect(() => {
    const mq = matchMedia('(min-width: 900px)');
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

/**
 * One row of shortcuts: a few chips, and its title as the button that unfolds all of them in a
 * card ("Manger +26"). One row is open at a time.
 */
function ChipRow(props: { id: string; title: string; items: ChipItem[]; open: boolean; onToggle: () => void; folded: number }) {
  const hidden = Math.max(0, props.items.length - props.folded);
  const shown = props.open ? props.items : props.items.slice(0, props.folded);
  return (
    <div className={`chips${props.open ? ' is-open' : ''}`} role="group" aria-label={props.title}>
      <button
        type="button"
        className="chips-title"
        aria-expanded={props.open}
        aria-controls={`chips-${props.id}`}
        aria-label={props.open ? t('chips.fold', { title: props.title }) : t('chips.all', { title: props.title, n: props.items.length })}
        onClick={props.onToggle}
        disabled={!props.open && hidden === 0}
      >
        {props.title}
        {props.open ? <span className="chips-count">✕</span> : hidden ? <span className="chips-count">+{hidden}</span> : null}
      </button>
      <div className="chips-list" id={`chips-${props.id}`} role="list">
        {shown.map((c) => (
          <button key={c.key} type="button" role="listitem" className="chip" onClick={c.pick}>
            <span aria-hidden="true">{c.emoji}</span> {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * On a wide screen, the shortcuts as one card: a line per category, its first shortcuts as plain
 * text fading out at the end of the line, and its count opening all of them in columns in the
 * same card (one category at a time; the back button or ← closes it).
 */
function Categories(props: { rows: { id: string; title: string; items: ChipItem[] }[]; open: string | null; onToggle: (id: string) => void }) {
  const open = props.rows.find((r) => r.id === props.open);
  if (open) {
    return (
      <div className="card cats is-open" role="group" aria-label={open.title}>
        <button type="button" className="cats-back" onClick={() => props.onToggle(open.id)} aria-label={t('chips.fold', { title: open.title })}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          {open.title}
          <span className="cats-count">{open.items.length}</span>
        </button>
        <ul className="cats-grid">
          {open.items.map((c) => (
            <li key={c.key}>
              <button type="button" className="cats-item" onClick={c.pick}>
                <span aria-hidden="true">{c.emoji}</span>
                <span>{c.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="card cats">
      {props.rows.map((r) => (
        <div key={r.id} className="cats-row" role="group" aria-label={r.title}>
          <button type="button" className="cats-name" onClick={() => props.onToggle(r.id)} aria-label={t('chips.all', { title: r.title, n: r.items.length })}>
            {r.title}
          </button>
          <div className="cats-line">
            {r.items.slice(0, 10).map((c) => (
              <button key={c.key} type="button" className="cats-link" onClick={c.pick}>
                <span aria-hidden="true">{c.emoji}</span> {c.label}
              </button>
            ))}
          </div>
          <button type="button" className="cats-all" onClick={() => props.onToggle(r.id)} aria-label={t('chips.all', { title: r.title, n: r.items.length })}>
            {r.items.length}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

export interface SearchState {
  searched: Searched | null;
  response: SearchResponse | null;
  loading: boolean;
  error: string | null;
}

type Option =
  | { type: 'food'; key: string }
  | { type: 'kind'; key: string }
  | { type: 'address'; hit: PlaceHit }
  | { type: 'brand'; b: BrandHit }
  | { type: 'named'; key: string; count: number }
  | { type: 'place'; r: PlaceSummary };

const SORT_HINT: Record<'walk' | 'bike' | 'transit' | 'car', string> = {
  walk: t('sort.walk'),
  bike: t('sort.bike'),
  transit: t('sort.transit'),
  car: t('sort.car'),
};
/** Whether a stop's name holds every word typed, as the start of one of its words ("luc gare" → "Lucens, gare"). */
export function namesStop(text: string, name: string): boolean {
  const words = searchKey(name).split(' ');
  return searchKey(text)
    .split(' ')
    .filter((w) => w.length >= 2)
    .every((w) => words.some((n) => n.startsWith(w)));
}

/** The shortcut rows of kinds of places, by their group (src/kinds.ts). */
const KIND_ROWS: { id: 'shop' | 'health' | 'service'; title: string }[] = [
  { id: 'shop', title: t('row.shop') },
  { id: 'health', title: t('row.health') },
  { id: 'service', title: t('row.service') },
];

/** Searches for one sort of place (a food, a kind): rows show the town rather than the kind. */
const byType = (s: Searched) => s.target.type === 'food' || s.target.type === 'kind';

export const SearchPanel = forwardRef<
  HTMLElement,
  {
    here: Here | null;
    search: SearchState;
    onSearch: (s: Searched | null) => void;
    onPick: (r: PlaceSummary) => void;
    onHover: (id: number | null) => void;
    onChangePlace: () => void;
    /** An address from the geocoder: the map goes there, with its card and the way from here. */
    onAddress: (hit: PlaceHit) => void;
    onVisible: (list: SearchResult[]) => void;
    /** The list's order changed: a place opened next shows that way first (🚲 → the bike). */
    onSort?: (s: Sort) => void;
  }
>(function SearchPanel(props, ref) {
  const id = useId();
  const searched = props.search.searched;
  const shownText = searched?.target.type === 'name' ? searched.target.key : (searched?.label ?? '');
  const [text, setText] = useState(shownText);
  const [focused, setFocused] = useState(false);
  const [hits, setHits] = useState<Suggestion | null>(null);
  const [addresses, setAddresses] = useState<PlaceHit[]>([]);
  const [stops, setStops] = useState<PlaceHit[]>([]);
  const [active, setActive] = useState(0);
  const [sort, setSort] = useState<Sort>('best');
  const [shown, setShown] = useState(PAGE);
  const input = useRef<HTMLInputElement>(null);
  const [popular, setPopular] = useState<BrandHit[]>([]);
  const [openRow, setOpenRow] = useState<string | null>(null);
  // An unfolded row of shortcuts is a step in the history: the back button folds it.
  useEffect(() => {
    const onPop = (e: PopStateEvent) => setOpenRow((e.state as { chips?: string } | null)?.chips ?? null);
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  const toggleRow = (rowId: string) => {
    const state = history.state as { chips?: string } | null;
    if (openRow === rowId) {
      if (state?.chips === rowId) history.back();
      else setOpenRow(null);
      return;
    }
    if (state?.chips) history.replaceState({ ...state, chips: rowId }, '');
    else history.pushState({ chips: rowId }, '', location.href);
    setOpenRow(rowId);
  };
  const wide = useWide();
  const rows: { id: string; title: string; items: ChipItem[] }[] = [
    { id: 'food', title: t('row.food'), items: FOODS.filter((f) => foodIn(f, REGION.country)).map((f) => ({ key: f.key, emoji: f.emoji, label: foodLabel(f.key), pick: () => props.onSearch(foodSearch(f.key)) })) },
    ...KIND_ROWS.map((row) => ({
      id: row.id,
      title: row.title,
      items: KIND_SEARCHES.filter((k) => (k.group ?? 'shop') === row.id).map((k) => ({ key: k.key, emoji: k.emoji, label: searchLabel(k.key), pick: () => props.onSearch(kindSearch(k.key)) })),
    })),
    { id: 'brand', title: t('row.brand'), items: popular.map((b) => ({ key: b.key, emoji: kindInfo(b.kindKey, b.kind).emoji, label: b.name, pick: () => props.onSearch(brandSearch(b)) })) },
  ];

  useEffect(() => setText(shownText), [shownText]);
  useEffect(() => setShown(PAGE), [props.search.response]);
  useEffect(() => {
    api.popularBrands().then(setPopular).catch(() => undefined);
  }, []);

  const typing = focused && text.trim().length > 0 && text !== shownText;
  useEffect(() => {
    if (!typing) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      api
        .suggest(text, props.here, ctl.signal)
        .then((s) => {
          setHits(s);
          setActive(0);
        })
        .catch(() => undefined);
      // Addresses and named places from the routing engine's geocoder, and its stops, nearest first.
      if (text.trim().length >= 3) {
        api
          .geocode(text, ctl.signal, props.here)
          .then((a) => setAddresses(Array.isArray(a) ? a.filter((h) => h.type !== 'stop') : []))
          .catch(() => undefined);
        api
          .geocode(text, ctl.signal, props.here, 'stop')
          .then((a) => setStops(Array.isArray(a) ? a.filter((h) => namesStop(text, h.label)) : []))
          .catch(() => undefined);
      } else {
        setAddresses([]);
        setStops([]);
      }
    }, 120);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [text, typing, props.here]);

  const options: Option[] =
    typing && hits
      ? [
          ...hits.foods.map((key): Option => ({ type: 'food', key })),
          ...hits.kinds.map((key): Option => ({ type: 'kind', key })),
          // A food or a kind matched: a few chains only (Pharmacie Populaire…).
          ...hits.brands.slice(0, hits.foods.length || hits.kinds.length ? 2 : 5).map((b): Option => ({ type: 'brand', b })),
          ...(hits.named ? [{ type: 'named' as const, ...hits.named }] : []),
          // Chains first; a few single places after them.
          ...hits.places.slice(0, hits.brands.length ? 3 : 6).map((r): Option => ({ type: 'place', r })),
          // Stops whose name holds what was typed ("lucens gare", "moudon").
          ...stops.slice(0, 3).map((hit): Option => ({ type: 'address', hit })),
          // Addresses when the text is not a food or a kind of place: all of them when nothing else matched.
          ...(hits.foods.length || hits.kinds.length
            ? []
            : addresses.slice(0, hits.brands.length || hits.places.length || hits.named ? 3 : 6).map((hit): Option => ({ type: 'address', hit }))),
        ]
      : [];

  const choose = (o: Option) => {
    if (o.type === 'food') props.onSearch(foodSearch(o.key));
    else if (o.type === 'kind') props.onSearch(kindSearch(o.key));
    else if (o.type === 'brand') props.onSearch(brandSearch(o.b));
    else if (o.type === 'named') props.onSearch(nameSearch(o.key));
    else if (o.type === 'address') props.onAddress(o.hit);
    else props.onPick(o.r);
    setFocused(false);
    input.current?.blur();
  };

  const sorted = props.search.response ? sortResults(props.search.response.results, sort) : [];
  const visible = sorted.slice(0, shown);
  useEffect(() => props.onVisible(visible), [props.search.response, sort, shown]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section ref={ref} className="panel panel-search" aria-label={t('search.region')}>
      <div className="searchbar" role="search">
        <span className="searchbar-logo">
          <Logo size={26} />
        </span>
        <input
          ref={input}
          id={id}
          type="search"
          role="combobox"
          aria-expanded={options.length > 0}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={options.length ? `${id}-o${active}` : undefined}
          aria-label={t('search.aria')}
          placeholder={t('search.placeholder')}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, options.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && options[active]) {
              e.preventDefault();
              choose(options[active]!);
            } else if (e.key === 'Escape') {
              setFocused(false);
            }
          }}
        />
        {text ? (
          <button
            type="button"
            className="searchbar-clear"
            aria-label={t('clear')}
            onClick={() => {
              setText('');
              props.onSearch(null);
              input.current?.focus();
            }}
          >
            ×
          </button>
        ) : (
          <span className="searchbar-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="M15.5 15.5 20 20" />
            </svg>
          </span>
        )}
      </div>

      <div className="here-row">
        <button type="button" className="here-chip" onClick={props.onChangePlace}>
          <span aria-hidden="true">📍</span> {props.here ? props.here.label : t('picker.title')} <span className="here-change">{t('here.change')}</span>
        </button>
        <LangPicker className="langs-inline" />
      </div>

      {options.length > 0 ? (
        <ul className="card suggestions" id={`${id}-list`} role="listbox" aria-label={t('suggestions')}>
          {options.map((o, i) => (
            <li
              key={o.type === 'food' ? `f-${o.key}` : o.type === 'kind' ? `k-${o.key}` : o.type === 'brand' ? `b-${o.b.key}` : o.type === 'named' ? 'n' : o.type === 'address' ? `a-${o.hit.lat},${o.hit.lon}` : `p-${o.r.id}`}
              id={`${id}-o${i}`}
              role="option"
              aria-selected={i === active}
              className={`suggestion${i === active ? ' is-active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o)}
              onMouseEnter={() => setActive(i)}
            >
              <span className="emoji-dot">
                {o.type === 'food'
                  ? FOOD_BY_KEY.get(o.key)?.emoji
                  : o.type === 'kind'
                    ? KIND_SEARCH_BY_KEY.get(o.key)?.emoji
                    : o.type === 'brand'
                    ? kindInfo(o.b.kindKey, o.b.kind).emoji
                    : o.type === 'named'
                      ? '🔎'
                      : o.type === 'address'
                        ? o.hit.type === 'stop'
                          ? stopEmoji(o.hit.modes)
                          : '📍'
                        : placeEmoji(o.r, null)}
              </span>
              <span className="suggestion-text">
                {o.type === 'food' ? (
                  <>
                    <strong>{foodLabel(o.key)}</strong>
                    <small>{t('sugg.food')}</small>
                  </>
                ) : o.type === 'kind' ? (
                  <>
                    <strong>{searchLabel(o.key)}</strong>
                    <small>{t('sugg.kind')}</small>
                  </>
                ) : o.type === 'brand' ? (
                  <>
                    <strong>{o.b.name}</strong>
                    <small>{t('sugg.brand', { kind: kindName(o.b.kindKey, o.b.kind), count: count(o.b.count) })}</small>
                  </>
                ) : o.type === 'named' ? (
                  <>
                    <strong>{t('sugg.named', { name: o.key })}</strong>
                    <small>{t('sugg.namedCount', { count: count(o.count) })}</small>
                  </>
                ) : o.type === 'address' ? (
                  <>
                    <strong>{o.hit.label}</strong>
                    <small>
                      {o.hit.type === 'stop'
                        ? `${o.hit.modes?.[0] === 'rail' ? t('sugg.station') : t('sugg.stop')} · ${t('sugg.departures')}`
                        : t(o.hit.type === 'place' ? 'sugg.place' : 'sugg.address')}
                      {props.here ? ` · ${distance(distanceTo(props.here, o.hit))}` : ''}
                    </small>
                  </>
                ) : (
                  <>
                    <strong>{placeName(o.r)}</strong>
                    <small>
                      {kindLabel(o.r)}
                      {o.r.town ? ` · ${o.r.town}` : ''}
                      {props.here ? ` · ${distance(o.r.distanceM)}` : ''}
                    </small>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : props.search.searched ? (
        <Results
          here={props.here}
          search={props.search}
          list={visible}
          total={sorted.length}
          sort={sort}
          onSort={(s) => {
            setSort(s);
            props.onSort?.(s);
          }}
          onMore={() => setShown((s) => s + PAGE)}
          onPick={props.onPick}
          onHover={props.onHover}
        />
      ) : wide ? (
        <Categories rows={rows.filter((r) => r.items.length > 0)} open={openRow} onToggle={toggleRow} />
      ) : (
        <div className={`chip-rows${openRow ? ' has-open' : ''}`}>
          {rows
            .filter((r) => r.items.length > 0 && (!openRow || openRow === r.id))
            .map((r) => (
              <ChipRow key={r.id} {...r} folded={FOLDED} open={openRow === r.id} onToggle={() => toggleRow(r.id)} />
            ))}
        </div>
      )}
    </section>
  );
});

function Results(props: {
  here: Here | null;
  search: SearchState;
  list: SearchResult[];
  total: number;
  sort: Sort;
  onSort: (s: Sort) => void;
  onMore: () => void;
  onPick: (r: PlaceSummary) => void;
  onHover: (id: number | null) => void;
}) {
  const searched = props.search.searched!;
  const label = props.search.response && searched.target.type === 'brand' ? props.search.response.label : searched.label;
  const isFood = searched.target.type === 'food';
  // A chain opened from a link knows its kind once its places are there.
  const first = props.search.response?.results[0];
  const emoji = searched.target.type === 'brand' && first ? placeEmoji(first, searched.target) : searched.emoji;
  const sorts: { key: Sort; label: string }[] = [
    { key: 'best', label: t('sort.best') },
    { key: 'walk', label: MODE.walk.emoji },
    { key: 'bike', label: MODE.bike.emoji },
    { key: 'transit', label: MODE.transit.emoji },
    { key: 'car', label: MODE.car.emoji },
  ];
  return (
    <div className="card results" aria-busy={props.search.loading}>
      <div className="results-head">
        <h2>
          <span aria-hidden="true">{emoji}</span> {label}
          {props.here ? <small> {t('results.near', { place: props.here.label })}</small> : null}
        </h2>
        <div className="segmented" role="radiogroup" aria-label={t('sort.by')}>
          {sorts.map((s) => (
            <button
              key={s.key}
              type="button"
              role="radio"
              aria-checked={props.sort === s.key}
              aria-label={s.key === 'best' ? undefined : SORT_HINT[s.key]}
              title={s.key === 'best' ? undefined : SORT_HINT[s.key]}
              className={props.sort === s.key ? 'is-on' : ''}
              onClick={() => props.onSort(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {!props.here ? (
        <p className="results-empty">{t('results.noHere')}</p>
      ) : props.search.loading && !props.search.response ? (
        <ul className="result-list" aria-label={t('loading')}>
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="result skeleton">
              <span className="emoji-dot" />
              <span className="skeleton-lines">
                <span />
                <span />
              </span>
            </li>
          ))}
        </ul>
      ) : props.search.error ? (
        <p className="results-empty">{t('results.error')}</p>
      ) : props.list.length === 0 ? (
        <p className="results-empty">
          {isFood ? t('results.noneFood') : t('results.none')} {t('results.missing')}{' '}
          <a href="https://www.openstreetmap.org" target="_blank" rel="noreferrer">
            OpenStreetMap
          </a>
          .
        </p>
      ) : (
        <div className="results-body">
          <ul className="result-list">
            {props.list.map((r) => (
              <ResultRow key={r.id} r={r} searched={searched} sort={props.sort} onPick={props.onPick} onHover={props.onHover} />
            ))}
          </ul>
          {props.list.length < props.total ? (
            <button type="button" className="btn btn-more" onClick={props.onMore}>
              {t('more')}
            </button>
          ) : null}
          {props.search.response?.typicalTimetable ? (
            <p className="results-note">🚆 {t('note.typical')}</p>
          ) : null}
          {props.list.some((r) => r.carMin !== null) ? <p className="results-note">🚗 {t('note.car')}</p> : null}
        </div>
      )}
    </div>
  );
}

function ResultRow(props: { r: SearchResult; searched: Searched; sort: Sort; onPick: (r: PlaceSummary) => void; onHover: (id: number | null) => void }) {
  const { r } = props;
  const lead = leadMode(r, props.sort);
  const leadMin = lead ? timeOf(r, lead) : null;
  const open = openLabel(r.open);
  // The bike's time when sorting by bike (four times on a line would crowd it).
  const modes = (props.sort === 'bike' ? (['bike', 'walk', 'transit', 'car'] as const) : (['walk', 'transit', 'car'] as const)).filter((m) => timeOf(r, m) !== null);
  return (
    <li>
      <button
        type="button"
        className="result"
        onClick={() => props.onPick(r)}
        onMouseEnter={() => props.onHover(r.id)}
        onMouseLeave={() => props.onHover(null)}
        onFocus={() => props.onHover(r.id)}
        onBlur={() => props.onHover(null)}
      >
        <span className="emoji-dot" aria-hidden="true">
          {placeEmoji(r, props.searched.target)}
        </span>
        <span className="result-main">
          <span className="result-name">
            {placeName(r)}
            {!byType(props.searched) && r.town && !r.name.includes(r.town) ? <span className="result-town"> {r.town}</span> : null}
          </span>
          <span className="result-meta">
            {byType(props.searched) ? (r.town ? `${r.town} · ` : '') : `${kindLabel(r)} · `}
            {distance(r.distanceM)}
            {open ? <span className={`open open-${open.tone}`}>{open.text}</span> : null}
            {r.kind === 'car_sharing' && r.cars !== undefined && r.cars !== null ? (
              <span className={`cars${r.cars > 0 ? '' : ' cars-none'}`}>🔑 {r.cars > 0 ? t(r.cars > 1 ? 'cars.many' : 'cars.one', { n: r.cars }) : t('cars.none')}</span>
            ) : null}
            {r.kind === 'bicycle_rental' && r.bikes !== undefined && r.bikes !== null ? (
              <span className={`cars${r.bikes > 0 ? '' : ' cars-none'}`}>🚲 {r.bikes > 0 ? t(r.bikes > 1 ? 'bikes.many' : 'bikes.one', { n: r.bikes }) : t('bikes.none')}</span>
            ) : null}
          </span>
          <span className="result-modes">
            {modes.length === 0 ? <span className="mode-time is-none">{t('tooFar')}</span> : null}
            {modes.map((m) => (
              <span key={m} className={`mode-time mode-${m}${m === lead ? ' is-lead' : ''}`}>
                <span aria-hidden="true">{MODE[m].emoji}</span>
                <span className="sr-only">{MODE[m].label}</span> {minutes(timeOf(r, m)!)}
              </span>
            ))}
          </span>
        </span>
        <span className="result-time" aria-hidden="true">
          {leadMin !== null ? (
            <>
              <strong>{leadMin}</strong>
              <small>{UNIT.min}</small>
            </>
          ) : (
            <small>—</small>
          )}
        </span>
      </button>
    </li>
  );
}
