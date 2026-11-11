import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CompareResult } from '@pendular/engine/types';
import { I18n, LANGS, langFromPath, translator, type Lang } from './i18n/index.js';
import { compareCommute } from './lib/api.js';
import { ticketGroups } from './lib/groups.js';
import { fromQuery, toQuery, toRequest, type SearchState } from './lib/state.js';
import { SearchForm } from './components/SearchForm.js';
import { Overview } from './components/Overview.js';
import { TradeoffChart } from './components/TradeoffChart.js';
import { OptionList, type SortKey, type PickedTrip } from './components/OptionList.js';
import { LeftOutList } from './components/LeftOutList.js';
import { MapPanel } from './components/MapPanel.js';
import { MethodPage } from './components/MethodPage.js';

const EXAMPLES = [
  { label: 'Lucens → Lausanne', query: 'h=46.70777,6.84215,Lucens&w=46.51679,6.62909,Lausanne%2C%20gare&a=0700-0900&d=12345' },
  { label: 'Echallens → Lausanne-Flon', query: 'h=46.64120,6.63390,Echallens&w=46.52080,6.63030,Lausanne%2C%20Flon&a=0700-0900&d=12345' },
  { label: 'Lovatens → EPFL', query: 'h=46.69181,6.86419,Lovatens&w=46.52034,6.56847,EPFL%2C%20Ecublens&a=0700-0900&d=12345' },
];

type Status = 'idle' | 'loading' | 'done' | 'error';
type Page = 'search' | 'method';

/** The page is the second path segment: /fr/ is the search, /fr/method the method page. */
const pageFromPath = (path: string): Page => (path.split('/')[2] === 'method' ? 'method' : 'search');

export function App() {
  const [lang, setLang] = useState<Lang>(() => langFromPath(location.pathname));
  const t = useMemo(() => translator(lang), [lang]);
  const [state, setState] = useState<SearchState>(() => fromQuery(location.search));
  const [result, setResult] = useState<CompareResult | null>(null);
  const [searched, setSearched] = useState<SearchState | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [selected, setSelected] = useState<string | null>(null);
  // A departure chosen in a card: its trip replaces the typical one of its route, in the card and on the map.
  const [picked, setPicked] = useState<PickedTrip | null>(null);
  const [sort, setSort] = useState<SortKey>('cost');
  const [page, setPage] = useState<Page>(() => pageFromPath(location.pathname));
  const [tab, setTab] = useState<'list' | 'map'>('list');
  const [editing, setEditing] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const lastQuery = useRef('');
  const firstPage = useRef(true);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = page === 'method' ? `${t('method.title')} · Pendular` : 'Pendular';
  }, [lang, page, t]);

  // After a move between pages, focus goes to the new page's heading (not on first load).
  useEffect(() => {
    if (firstPage.current) {
      firstPage.current = false;
      return;
    }
    document.querySelector<HTMLElement>('main h1')?.focus();
  }, [page]);

  const run = useCallback(
    (s: SearchState, push: boolean) => {
      const req = toRequest(s);
      if (!req) return;
      if (push) history.pushState(null, '', `/${lang}/?${toQuery(s)}`);
      lastQuery.current = toQuery(s);
      abort.current?.abort();
      const ctl = (abort.current = new AbortController());
      setStatus('loading');
      compareCommute(req, ctl.signal)
        .then((r) => {
          setResult(r);
          setSearched(s);
          // The cheapest ticket opens on its best route (fewest changes, then fastest).
          const cheapest = ticketGroups(r.options).find((g) => g.routes.some((o) => o.id === r.verdict.cheapest));
          setSelected(cheapest?.routes[0]?.id ?? r.verdict.cheapest ?? null);
          setStatus('done');
        })
        .catch((e: unknown) => {
          if ((e as Error).name !== 'AbortError') setStatus('error');
        });
    },
    [lang],
  );

  // A shared or bookmarked link runs its search on load; back/forward restores a search.
  useEffect(() => {
    const initial = pageFromPath(location.pathname) === 'search' ? fromQuery(location.search) : null;
    if (initial?.home && initial.work) run(initial, false);
    const onPop = () => {
      const p = pageFromPath(location.pathname);
      setLang(langFromPath(location.pathname));
      setPage(p);
      if (p !== 'search') return;
      const s = fromQuery(location.search);
      setState(s);
      // The results on screen already match this address when coming back from the method page.
      if (s.home && s.work && toQuery(s) !== lastQuery.current) run(s, false);
    };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchLang = (l: Lang) => {
    setLang(l);
    history.replaceState(null, '', page === 'method' ? `/${l}/method` : `/${l}/${location.search}`);
  };

  const searchHref = `/${lang}/${searched ? `?${toQuery(searched)}` : ''}`;
  const go = (to: Page) => {
    if (to === page) return;
    history.pushState(null, '', to === 'method' ? `/${lang}/method` : searchHref);
    setPage(to);
  };
  const link = (to: Page) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    go(to);
  };

  const stamp = result?.stamp;
  return (
    <I18n.Provider value={{ lang, t }}>
      <a className="skip-link" href="#main">
        {t('a11y.skip')}
      </a>
      <header className="site-head">
        <a className="wordmark" href={searchHref} onClick={link('search')}>
          Pendular
        </a>
        <nav aria-label={t('nav.lang')} className="langs">
          {LANGS.map((l) => (
            <button key={l} type="button" lang={l} aria-pressed={l === lang} className={l === lang ? 'is-on' : undefined} onClick={() => switchLang(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </nav>
      </header>

      <main id="main" tabIndex={-1}>
        {page === 'method' ? (
          <MethodPage searchHref={searchHref} onBack={() => go('search')} />
        ) : (
          <>
        <h1 tabIndex={-1}>{t('app.tagline')}</h1>
        {result && searched?.home && searched.work && !editing && (
          <div className="search-summary card">
            <span>{t('form.summary', { home: searched.home.label, work: searched.work.label })}</span>
            <button type="button" className="link-button" onClick={() => setEditing(true)}>
              {t('form.edit')}
            </button>
          </div>
        )}
        <div className={result && !editing ? 'search-wrap is-collapsed' : 'search-wrap'}>
          <SearchForm
            state={state}
            onChange={setState}
            onSubmit={() => {
              setEditing(false);
              run(state, true);
            }}
            busy={status === 'loading'}
          />
        </div>

        <div role="status" aria-live="polite" aria-atomic="true">
          {status === 'idle' && (
            <div className="hint">
              <p>{t('state.empty')}</p>
              <p className="examples">
                <span>{t('empty.title')} :</span>
                {EXAMPLES.map((e) => (
                  <a key={e.label} href={`/${lang}/?${e.query}`}>
                    {e.label}
                  </a>
                ))}
              </p>
            </div>
          )}
          {status === 'loading' && <p className="hint is-busy">{t('state.loading')}</p>}
          {status === 'error' && (
            <p className="hint is-error" role="alert">
              {t('state.error')}
            </p>
          )}
          {status === 'done' && result && result.options.length === 0 && <p className="hint">{t('state.none')}</p>}
          {status === 'done' && result && result.options.length > 0 && <p className="sr-only">{t('state.found', { n: result.options.length })}</p>}
        </div>

        {status !== 'error' && result && searched?.home && searched.work && result.options.length > 0 && (
          <div className={status === 'loading' ? 'results is-stale' : 'results'} aria-busy={status === 'loading'}>
            <Overview
              result={result}
              daysSearched={searched.weekdays.length}
              selected={selected}
              onSelect={setSelected}
              onShowOnMap={(id) => {
                setSelected(id);
                setTab('map');
                requestAnimationFrame(() => document.querySelector('.split-map')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
              }}
            />
            <TradeoffChart options={result.options} selected={selected} onSelect={setSelected} />
            <div className="tabs" role="group" aria-label={t('view.label')}>
              <button type="button" aria-pressed={tab === 'list'} onClick={() => setTab('list')}>
                {t('list.tab')}
              </button>
              <button type="button" aria-pressed={tab === 'map'} onClick={() => setTab('map')}>
                {t('map.tab')}
              </button>
            </div>
            <div className={`split show-${tab}`}>
              <div className="split-list">
                <OptionList options={result.options} selected={selected} onSelect={setSelected} sort={sort} onSort={setSort} car={stamp?.car} picked={picked} onPick={setPicked} />
                <LeftOutList items={result.leftOut} />
              </div>
              <div className="split-map">
                {/* The shared-bike suggestion is drawn only while it is the selection. */}
                <MapPanel
                  home={searched.home}
                  work={searched.work}
                  options={(selected === result.sharedBike?.id && result.sharedBike ? [...result.options, result.sharedBike] : result.options).map((o) =>
                    // The chosen departure is drawn when it goes another way than the route's typical trip.
                    picked && o.id === picked.id && picked.legs.some((l) => l.geometry) ? { id: o.id, itinerary: { ...o.itinerary, legs: picked.legs } } : o,
                  )}
                  selected={selected}
                />
              </div>
            </div>
            {stamp && (
              <p className="method">
                {t('method.trips', { trips: stamp.tripsPerYear, days: stamp.workingDaysPerYear })}{' '}
                <a href={`/${lang}/method`} onClick={link('method')}>
                  {t('method.link')}
                </a>
              </p>
            )}
          </div>
        )}
          </>
        )}
      </main>

      <footer className="site-foot">
        <p>{t('app.estimate')}</p>
        <p>
          <a href={`/${lang}/method`} onClick={link('method')} aria-current={page === 'method' ? 'page' : undefined}>
            {t('method.title')}
          </a>
        </p>
        <p>{t('credits')}</p>
        <p>{t('privacy')}</p>
      </footer>
    </I18n.Provider>
  );
}
