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

type Status = 'idle' | 'loading' | 'done' | 'error';

export function App() {
  const [lang, setLang] = useState<Lang>(() => langFromPath(location.pathname));
  const t = useMemo(() => translator(lang), [lang]);
  const [state, setState] = useState<SearchState>(() => fromQuery(location.search));
  const [result, setResult] = useState<CompareResult | null>(null);
  const [searched, setSearched] = useState<SearchState | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [selected, setSelected] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('cost');
  const [tab, setTab] = useState<'list' | 'map'>('list');
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const run = useCallback(
    (s: SearchState, push: boolean) => {
      const req = toRequest(s);
      if (!req) return;
      if (push) history.pushState(null, '', `/${lang}/?${toQuery(s)}`);
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
    const initial = fromQuery(location.search);
    if (initial.home && initial.work) run(initial, false);
    const onPop = () => {
      const s = fromQuery(location.search);
      setState(s);
      setLang(langFromPath(location.pathname));
      if (s.home && s.work) run(s, false);
    };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchLang = (l: Lang) => {
    setLang(l);
    history.replaceState(null, '', `/${l}/${location.search}`);
  };

  const stamp = result?.stamp;
  return (
    <I18n.Provider value={{ lang, t }}>
      <header className="site-head">
        <a className="wordmark" href={`/${lang}/`}>
          Pendular
        </a>
        <nav aria-label="Language" className="langs">
          {LANGS.map((l) => (
            <button key={l} type="button" lang={l} aria-pressed={l === lang} className={l === lang ? 'is-on' : undefined} onClick={() => switchLang(l)}>
              {l.toUpperCase()}
            </button>
          ))}
        </nav>
      </header>

      <main>
        <h1>{t('app.tagline')}</h1>
        <SearchForm state={state} onChange={setState} onSubmit={() => run(state, true)} busy={status === 'loading'} />

        <div aria-live="polite">
          {status === 'idle' && <p className="hint">{t('state.empty')}</p>}
          {status === 'loading' && <p className="hint is-busy">{t('state.loading')}</p>}
          {status === 'error' && <p className="hint is-error">{t('state.error')}</p>}
          {status === 'done' && result && result.options.length === 0 && <p className="hint">{t('state.none')}</p>}
        </div>

        {status !== 'error' && result && searched?.home && searched.work && result.options.length > 0 && (
          <div className={status === 'loading' ? 'results is-stale' : 'results'}>
            <Verdict result={result} onSelect={setSelected} />
            <TradeoffChart options={result.options} selected={selected} onSelect={setSelected} />
            <div className="tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'list'} onClick={() => setTab('list')}>
                {t('list.tab')}
              </button>
              <button type="button" role="tab" aria-selected={tab === 'map'} onClick={() => setTab('map')}>
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
              <section className="method">
                <h2>{t('method.title')}</h2>
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
      </main>

      <footer className="site-foot">
        <p>{t('app.estimate')}</p>
        <p>{t('credits')}</p>
        <p>{t('privacy')}</p>
      </footer>
    </I18n.Provider>
  );
}
