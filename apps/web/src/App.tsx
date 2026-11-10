import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CompareResult } from '@pendular/engine/types';
import { I18n, LANGS, langFromPath, translator, type Lang } from './i18n/index.js';
import { compareCommute } from './lib/api.js';
import { fromQuery, toQuery, toRequest, type SearchState } from './lib/state.js';
import { SearchForm } from './components/SearchForm.js';
import { Verdict } from './components/Verdict.js';
import { TradeoffChart } from './components/TradeoffChart.js';
import { OptionList, type SortKey } from './components/OptionList.js';
import { LeftOutList } from './components/LeftOutList.js';
import { MapPanel } from './components/MapPanel.js';
import { MethodPage } from './components/MethodPage.js';

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
  const [sort, setSort] = useState<SortKey>('cost');
  const [page, setPage] = useState<Page>(() => pageFromPath(location.pathname));
  const [tab, setTab] = useState<'list' | 'map'>('list');
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
          setSelected(r.verdict.cheapest ?? null);
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
        <SearchForm state={state} onChange={setState} onSubmit={() => run(state, true)} busy={status === 'loading'} />

        <div role="status" aria-live="polite" aria-atomic="true">
          {status === 'idle' && <p className="hint">{t('state.empty')}</p>}
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
            <Verdict result={result} onSelect={setSelected} />
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
                <OptionList options={result.options} selected={selected} onSelect={setSelected} sort={sort} onSort={setSort} />
                <LeftOutList items={result.leftOut} />
              </div>
              <div className="split-map">
                <MapPanel home={searched.home} work={searched.work} options={result.options} selected={selected} />
              </div>
            </div>
            {stamp && (
              <section className="method" aria-labelledby="method-note">
                <h2 id="method-note">
                  <a href={`/${lang}/method`} onClick={link('method')}>
                    {t('method.title')}
                  </a>
                </h2>
                <p>
                  {t('method.trips', { trips: stamp.tripsPerYear, days: stamp.workingDaysPerYear })}{' '}
                  {t('method.data', { timetable: stamp.data.timetable ?? '–', streets: stamp.data.streets ?? '–', tariffs: stamp.data.tariffs ?? '–' })}
                </p>
                <p>
                  {t('method.zoneNote')} {t('method.parkingNote')} {t('method.bikeNote')}
                </p>
              </section>
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
