import { forwardRef, useEffect, useId, useRef, useState } from 'react';
import type { RestaurantSummary, SearchResponse, SearchResult, Suggestion } from '../../../src/api';
import { FOODS, FOOD_BY_KEY } from '../../../src/foods';
import { api, bestMode, foodEmoji, distance, MODE, minutes, openLabel, sortResults, timeOf, type Here, type Sort } from '../lib';
import { Logo } from './Welcome';

const PAGE = 5;
const CHIPS = FOODS.filter((f) => !f.generic).slice(0, 16);

export interface SearchState {
  food: string | null;
  response: SearchResponse | null;
  loading: boolean;
  error: string | null;
}

export const SearchPanel = forwardRef<
  HTMLElement,
  {
    here: Here | null;
    search: SearchState;
    onFood: (key: string | null) => void;
    onPick: (r: RestaurantSummary) => void;
    onHover: (id: number | null) => void;
    onChangePlace: () => void;
    onVisible: (list: SearchResult[]) => void;
  }
>(function SearchPanel(props, ref) {
  const id = useId();
  const food = props.search.food ? FOOD_BY_KEY.get(props.search.food) : undefined;
  const [text, setText] = useState(food?.label ?? '');
  const [focused, setFocused] = useState(false);
  const [hits, setHits] = useState<Suggestion | null>(null);
  const [active, setActive] = useState(0);
  const [sort, setSort] = useState<Sort>('best');
  const [shown, setShown] = useState(PAGE);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => setText(food?.label ?? ''), [food?.key]);
  useEffect(() => setShown(PAGE), [props.search.response]);

  const typing = focused && text.trim().length > 0 && text !== food?.label;
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

  const options: ({ type: 'food'; key: string } | { type: 'restaurant'; r: RestaurantSummary })[] = typing && hits
    ? [...hits.foods.map((key) => ({ type: 'food' as const, key })), ...hits.restaurants.map((r) => ({ type: 'restaurant' as const, r }))]
    : [];

  const choose = (o: (typeof options)[number]) => {
    if (o.type === 'food') {
      props.onFood(o.key);
      setText(FOOD_BY_KEY.get(o.key)?.label ?? '');
    } else {
      props.onPick(o.r);
    }
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
          aria-label="Que veux-tu manger ?"
          placeholder="Pizza, burger, sushi…"
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
              props.onFood(null);
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
              key={o.type === 'food' ? `f-${o.key}` : `r-${o.r.id}`}
              id={`${id}-o${i}`}
              role="option"
              aria-selected={i === active}
              className={`suggestion${i === active ? ' is-active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o)}
              onMouseEnter={() => setActive(i)}
            >
              {o.type === 'food' ? (
                <>
                  <span className="emoji-dot">{FOOD_BY_KEY.get(o.key)?.emoji}</span>
                  <span className="suggestion-text">
                    <strong>{FOOD_BY_KEY.get(o.key)?.label}</strong>
                    <small>Type de nourriture</small>
                  </span>
                </>
              ) : (
                <>
                  <span className="emoji-dot">{FOOD_BY_KEY.get(o.r.foods[0] ?? 'restaurant')?.emoji}</span>
                  <span className="suggestion-text">
                    <strong>{o.r.name}</strong>
                    <small>
                      {o.r.town ?? ''}
                      {props.here ? ` · ${distance(o.r.distanceM)}` : ''}
                    </small>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : props.search.food ? (
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
        <div className="chips" role="list" aria-label="Idées">
          {CHIPS.map((f) => (
            <button key={f.key} type="button" role="listitem" className="chip" onClick={() => props.onFood(f.key)}>
              <span aria-hidden="true">{f.emoji}</span> {f.label}
            </button>
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
  onPick: (r: RestaurantSummary) => void;
  onHover: (id: number | null) => void;
}) {
  const food = FOOD_BY_KEY.get(props.search.food ?? '');
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
          <span aria-hidden="true">{food?.emoji}</span> {food?.label}
          {props.here ? <small> près de {props.here.label}</small> : null}
        </h2>
        <div className="segmented" role="radiogroup" aria-label="Trier par">
          {sorts.map((s) => (
            <button
              key={s.key}
              type="button"
              role="radio"
              aria-checked={props.sort === s.key}
              aria-label={s.key === 'best' ? undefined : `Trier : ${MODE[s.key].label}`}
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
          Aucun restaurant de ce type à moins de 40 km. Il en manque un ? Tu peux l'ajouter sur{' '}
          <a href="https://www.openstreetmap.org" target="_blank" rel="noreferrer">
            OpenStreetMap
          </a>
          .
        </p>
      ) : (
        <div className="results-body">
          <ul className="result-list">
            {props.list.map((r) => (
              <ResultRow key={r.id} r={r} food={props.search.food} sort={props.sort} onPick={props.onPick} onHover={props.onHover} />
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
        </div>
      )}
    </div>
  );
}

function ResultRow(props: { r: SearchResult; food: string | null; sort: Sort; onPick: (r: RestaurantSummary) => void; onHover: (id: number | null) => void }) {
  const { r } = props;
  const best = bestMode(r);
  const lead = props.sort === 'best' ? best : props.sort;
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
          {foodEmoji(r, props.food)}
        </span>
        <span className="result-main">
          <span className="result-name">{r.name}</span>
          <span className="result-meta">
            {r.town ? `${r.town} · ` : ''}
            {distance(r.distanceM)}
            {open ? <span className={`open open-${open.tone}`}>{open.text}</span> : null}
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
