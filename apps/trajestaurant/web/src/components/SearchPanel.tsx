import { forwardRef, useEffect, useId, useRef, useState } from 'react';
import type { BrandHit, PlaceSummary, SearchResponse, SearchResult, Suggestion } from '../../../src/api';
import { FOODS, FOOD_BY_KEY } from '../../../src/foods';
import { KIND_SEARCHES, KIND_SEARCH_BY_KEY, kindInfo } from '../../../src/kinds';
import {
  api,
  brandSearch,
  distance,
  foodSearch,
  kindLabel,
  kindSearch,
  leadMode,
  MODE,
  minutes,
  nameSearch,
  openLabel,
  placeEmoji,
  sortResults,
  timeOf,
  type Here,
  type Searched,
  type Sort,
} from '../lib';
import { Logo } from './Welcome';

const PAGE = 5;
/** Shortcut rows show this many chips folded (a phone scrolls them sideways); the title opens the whole list. */
const FOLDED = { wide: 3, narrow: 6 };

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
        aria-label={props.open ? `${props.title} : replier` : `${props.title} : voir les ${props.items.length}`}
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
        {!props.open && hidden ? (
          <button type="button" className="chip chip-more" onClick={props.onToggle} aria-label={`Voir les ${hidden} autres : ${props.title}`}>
            +{hidden}
          </button>
        ) : null}
      </div>
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
  | { type: 'brand'; b: BrandHit }
  | { type: 'named'; key: string; count: number }
  | { type: 'place'; r: PlaceSummary };

const count = (n: number) => n.toLocaleString('fr-CH');
const SORT_HINT: Record<'walk' | 'transit' | 'car', string> = {
  walk: 'À pied, ou en transports publics quand c’est trop loin',
  transit: 'Sans voiture : transports publics ou à pied',
  car: 'En voiture',
};
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
    onVisible: (list: SearchResult[]) => void;
  }
>(function SearchPanel(props, ref) {
  const id = useId();
  const searched = props.search.searched;
  const shownText = searched?.target.type === 'name' ? searched.target.key : (searched?.label ?? '');
  const [text, setText] = useState(shownText);
  const [focused, setFocused] = useState(false);
  const [hits, setHits] = useState<Suggestion | null>(null);
  const [active, setActive] = useState(0);
  const [sort, setSort] = useState<Sort>('best');
  const [shown, setShown] = useState(PAGE);
  const input = useRef<HTMLInputElement>(null);
  const [popular, setPopular] = useState<BrandHit[]>([]);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const wide = useWide();
  const folded = wide ? FOLDED.wide : FOLDED.narrow;
  const rows: { id: string; title: string; items: ChipItem[] }[] = [
    { id: 'food', title: 'Manger', items: FOODS.map((f) => ({ key: f.key, emoji: f.emoji, label: f.label, pick: () => props.onSearch(foodSearch(f.key)) })) },
    { id: 'kind', title: 'Commerces', items: KIND_SEARCHES.map((k) => ({ key: k.key, emoji: k.emoji, label: k.label, pick: () => props.onSearch(kindSearch(k.key)) })) },
    { id: 'brand', title: 'Enseignes', items: popular.map((b) => ({ key: b.key, emoji: kindInfo(b.kindKey, b.kind).emoji, label: b.name, pick: () => props.onSearch(brandSearch(b)) })) },
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
        ]
      : [];

  const choose = (o: Option) => {
    if (o.type === 'food') props.onSearch(foodSearch(o.key));
    else if (o.type === 'kind') props.onSearch(kindSearch(o.key));
    else if (o.type === 'brand') props.onSearch(brandSearch(o.b));
    else if (o.type === 'named') props.onSearch(nameSearch(o.key));
    else props.onPick(o.r);
    setFocused(false);
    input.current?.blur();
  };

  const sorted = props.search.response ? sortResults(props.search.response.results, sort) : [];
  const visible = sorted.slice(0, shown);
  useEffect(() => props.onVisible(visible), [props.search.response, sort, shown]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section ref={ref} className="panel panel-search" aria-label="Recherche">
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
          aria-label="Que cherches-tu ? Une nourriture, un commerce, une enseigne ou un nom"
          placeholder="Pizza, pharmacie, Migros…"
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
            aria-label="Effacer"
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

      <button type="button" className="here-chip" onClick={props.onChangePlace}>
        <span aria-hidden="true">📍</span> {props.here ? props.here.label : 'Où es-tu ?'} <span className="here-change">changer</span>
      </button>

      {options.length > 0 ? (
        <ul className="card suggestions" id={`${id}-list`} role="listbox" aria-label="Suggestions">
          {options.map((o, i) => (
            <li
              key={o.type === 'food' ? `f-${o.key}` : o.type === 'kind' ? `k-${o.key}` : o.type === 'brand' ? `b-${o.b.key}` : o.type === 'named' ? 'n' : `p-${o.r.id}`}
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
                      : placeEmoji(o.r, null)}
              </span>
              <span className="suggestion-text">
                {o.type === 'food' ? (
                  <>
                    <strong>{FOOD_BY_KEY.get(o.key)?.label}</strong>
                    <small>Type de nourriture</small>
                  </>
                ) : o.type === 'kind' ? (
                  <>
                    <strong>{KIND_SEARCH_BY_KEY.get(o.key)?.label}</strong>
                    <small>Type de commerce ou de lieu</small>
                  </>
                ) : o.type === 'brand' ? (
                  <>
                    <strong>{o.b.name}</strong>
                    <small>
                      Enseigne · {kindInfo(o.b.kindKey, o.b.kind).label} · {count(o.b.count)} en Suisse
                    </small>
                  </>
                ) : o.type === 'named' ? (
                  <>
                    <strong>Tous les « {o.key} »</strong>
                    <small>{count(o.count)} lieux portent ce nom</small>
                  </>
                ) : (
                  <>
                    <strong>{o.r.name}</strong>
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
          onSort={setSort}
          onMore={() => setShown((s) => s + PAGE)}
          onPick={props.onPick}
          onHover={props.onHover}
        />
      ) : (
        <div className={`chip-rows${openRow ? ' has-open' : ''}`}>
          {rows
            .filter((r) => r.items.length > 0 && (!openRow || openRow === r.id))
            .map((r) => (
              <ChipRow key={r.id} {...r} folded={folded} open={openRow === r.id} onToggle={() => setOpenRow((o) => (o === r.id ? null : r.id))} />
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
    { key: 'best', label: 'Le plus rapide' },
    { key: 'walk', label: MODE.walk.emoji },
    { key: 'transit', label: MODE.transit.emoji },
    { key: 'car', label: MODE.car.emoji },
  ];
  return (
    <div className="card results" aria-busy={props.search.loading}>
      <div className="results-head">
        <h2>
          <span aria-hidden="true">{emoji}</span> {label}
          {props.here ? <small> près de {props.here.label}</small> : null}
        </h2>
        <div className="segmented" role="radiogroup" aria-label="Trier par">
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
        <p className="results-empty">Dis-nous d'abord où tu es (📍 en haut).</p>
      ) : props.search.loading && !props.search.response ? (
        <ul className="result-list" aria-label="Chargement">
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
        <p className="results-empty">La recherche n'a pas marché. Réessaie dans un instant.</p>
      ) : props.list.length === 0 ? (
        <p className="results-empty">
          {isFood ? 'Aucun restaurant de ce type à moins de 40 km.' : 'Rien trouvé à moins de 250 km.'} Il en manque un ? Tu peux l'ajouter sur{' '}
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
              Voir plus
            </button>
          ) : null}
          {props.search.response?.typicalTimetable ? (
            <p className="results-note">🚆 Horaire type : même jour et même heure dans l'horaire 2027.</p>
          ) : null}
          {props.list.some((r) => r.carMin !== null) ? <p className="results-note">🚗 Voiture : trafic de l’heure et temps pour se garer compris.</p> : null}
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
  const modes = (['walk', 'transit', 'car'] as const).filter((m) => timeOf(r, m) !== null);
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
            {r.name}
            {!byType(props.searched) && r.town && !r.name.includes(r.town) ? <span className="result-town"> {r.town}</span> : null}
          </span>
          <span className="result-meta">
            {byType(props.searched) ? (r.town ? `${r.town} · ` : '') : `${kindLabel(r)} · `}
            {distance(r.distanceM)}
            {open ? <span className={`open open-${open.tone}`}>{open.text}</span> : null}
            {r.kind === 'car_sharing' && r.cars !== undefined && r.cars !== null ? (
              <span className={`cars${r.cars > 0 ? '' : ' cars-none'}`}>🔑 {r.cars > 0 ? `${r.cars} voiture${r.cars > 1 ? 's' : ''}` : 'aucune voiture'}</span>
            ) : null}
          </span>
          <span className="result-modes">
            {modes.length === 0 ? <span className="mode-time is-none">Trop loin pour aujourd'hui</span> : null}
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
              <small>min</small>
            </>
          ) : (
            <small>—</small>
          )}
        </span>
      </button>
    </li>
  );
}
