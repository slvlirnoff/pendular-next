import { useCallback, useEffect, useRef, useState } from 'react';
import type { DetailMode, PlaceSummary, RoutesResponse, SearchResult } from '../../src/api';
import { FOOD_BY_KEY } from '../../src/foods';
import { Detail } from './components/Detail';
import { MapView, type Padding } from './components/MapView';
import { PlacePicker } from './components/PlacePicker';
import { SearchPanel, type SearchState } from './components/SearchPanel';
import { Welcome } from './components/Welcome';
import { api, bestMode, brandSearch, foodSearch, kindSearch, nameSearch, type Here, type Searched, type Sort } from './lib';
import { KIND_SEARCH_BY_KEY } from '../../src/kinds';

const HERE_KEY = 'trajestaurant.here';

function storedHere(): Here | null {
  try {
    const v = JSON.parse(localStorage.getItem(HERE_KEY) ?? 'null') as Here | null;
    return v && typeof v.lat === 'number' && typeof v.lon === 'number' ? v : null;
  } catch {
    return null;
  }
}

/** What the address bar holds: ?ici=lat,lon,label, then food=pizza, kind=pharmacie, brand=migros or name=mix image, and r=123 (a place). */
function readUrl(): { here: Here | null; searched: Searched | null; place: number | null } {
  const p = new URLSearchParams(location.search);
  const [lat, lon, ...label] = (p.get('ici') ?? '').split(',');
  const here = lat && lon && Number.isFinite(+lat) && Number.isFinite(+lon) ? { lat: +lat, lon: +lon, label: label.join(',') || 'Ma position' } : null;
  const food = p.get('food');
  const kind = p.get('kind');
  const brand = p.get('brand');
  const name = p.get('name');
  const searched =
    food && FOOD_BY_KEY.has(food)
      ? foodSearch(food)
      : kind && KIND_SEARCH_BY_KEY.has(kind)
        ? kindSearch(kind)
        : brand
        ? brandSearch({ key: brand, name: brand, kindKey: 'shop', kind: '' })
        : name
          ? nameSearch(name)
          : null;
  const r = Number(p.get('r'));
  return { here, searched, place: Number.isInteger(r) && r > 0 ? r : null };
}

function writeUrl(s: { here: Here | null; searched: Searched | null; place: number | null }, push: boolean) {
  const p = new URLSearchParams();
  if (s.here) p.set('ici', `${s.here.lat.toFixed(5)},${s.here.lon.toFixed(5)},${s.here.label}`);
  if (s.searched) p.set(s.searched.target.type, s.searched.target.key);
  if (s.place) p.set('r', String(s.place));
  const url = `${location.pathname}${p.size ? `?${p.toString()}` : ''}`;
  if (url === `${location.pathname}${location.search}`) return;
  if (push) history.pushState(null, '', url);
  else history.replaceState(null, '', url);
}

/** A ref for a panel and its height, kept up to date from the moment the panel appears. */
function useHeight(): [(el: HTMLElement | null) => void, number] {
  const [h, setH] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) {
      setH(0);
      return;
    }
    observer.current = new ResizeObserver(() => setH(el.getBoundingClientRect().height));
    observer.current.observe(el);
    setH(el.getBoundingClientRect().height);
  }, []);
  return [ref, h];
}

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

export function App() {
  const initial = useRef(readUrl());
  const [started, setStarted] = useState(initial.current.here !== null || initial.current.searched !== null || initial.current.place !== null);
  const [here, setHere] = useState<Here | null>(initial.current.here ?? storedHere());
  const [picker, setPicker] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locateFailed, setLocateFailed] = useState(false);
  const [search, setSearch] = useState<SearchState>({ searched: initial.current.searched, response: null, loading: false, error: null });
  const [visible, setVisible] = useState<SearchResult[]>([]);
  const [hovered, setHovered] = useState<number | null>(null);
  const [selected, setSelected] = useState<PlaceSummary | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(initial.current.place);
  const [routes, setRoutes] = useState<RoutesResponse | null>(null);
  const [routesState, setRoutesState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [mode, setMode] = useState<DetailMode>('walk');
  const sortRef = useRef<Sort>('best');
  const [departure, setDeparture] = useState(0);
  const wide = useWide();
  const [searchRef, searchH] = useHeight();
  const [detailRef, detailH] = useHeight();

  const placeHere = useCallback((h: Here) => {
    setHere(h);
    setPicker(false);
    try {
      localStorage.setItem(HERE_KEY, JSON.stringify(h));
    } catch {
      /* private mode: the position is simply not remembered */
    }
  }, []);

  const locate = useCallback(
    (then?: () => void) => {
      if (!('geolocation' in navigator)) {
        setLocateFailed(true);
        setPicker(true);
        then?.();
        return;
      }
      setLocating(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude: lat, longitude: lon } = pos.coords;
          api
            .where(lat, lon)
            .catch(() => ({ town: null }))
            .then((w) => {
              placeHere({ lat, lon, label: w.town ?? 'Ma position' });
              setLocating(false);
              setLocateFailed(false);
              then?.();
            });
        },
        () => {
          setLocating(false);
          setLocateFailed(true);
          setPicker(true);
          then?.();
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
      );
    },
    [placeHere],
  );

  // The address bar follows the state; the back button closes a restaurant.
  useEffect(() => {
    if (started) writeUrl({ here, searched: search.searched, place: selectedId }, false);
  }, [started, here, search.searched, selectedId]);
  useEffect(() => {
    const onPop = () => {
      const u = readUrl();
      setSelectedId(u.place);
      if (!u.place) setSelected(null);
      const same = (a: Searched | null, b: Searched | null) => a?.target.type === b?.target.type && a?.target.key === b?.target.key;
      setSearch((s) => (same(s.searched, u.searched) ? s : { searched: u.searched, response: null, loading: false, error: null }));
    };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);

  // Search when what is searched for or the place changes.
  useEffect(() => {
    const searched = search.searched;
    if (!searched || !here) return;
    const ctl = new AbortController();
    setSearch((s) => ({ ...s, loading: true, error: null }));
    api
      .search(searched.target, here, ctl.signal)
      .then((response) => setSearch((s) => (s.searched === searched ? { searched, response, loading: false, error: null } : s)))
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setSearch((s) => ({ ...s, loading: false, error: e.message }));
      });
    return () => ctl.abort();
  }, [search.searched, here]);

  // The way to the chosen restaurant.
  useEffect(() => {
    if (!selectedId || !here) {
      setRoutes(null);
      setRoutesState('idle');
      return;
    }
    const ctl = new AbortController();
    setRoutesState('loading');
    setRoutes(null);
    setDeparture(0);
    api
      .place(selectedId, here, ctl.signal)
      .then((r) => {
        setRoutes(r);
        setRoutesState('idle');
        setSelected((s) => s ?? r.place);
        const listed = search.response?.results.find((x) => x.id === selectedId);
        const times = { walkMin: r.walk?.durationMin ?? null, transitMin: r.transit[0]?.durationMin ?? null, carMin: r.car?.durationMin ?? null };
        // Sorted by one way (🚲, 🚗…): that way first, when there is one.
        const sorted = sortRef.current;
        const has = sorted === 'bike' ? r.bike : sorted === 'walk' ? r.walk : sorted === 'car' ? r.car : sorted === 'transit' ? r.transit[0] : null;
        setMode(sorted !== 'best' && has ? sorted : (bestMode(listed ?? times) ?? bestMode(times) ?? 'car'));
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setRoutesState('error');
      });
    return () => ctl.abort();
  }, [selectedId, here]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (r: PlaceSummary) => {
    setSelected(r);
    setSelectedId(r.id);
    setHovered(null);
    writeUrl({ here, searched: search.searched, place: r.id }, true);
  };
  const back = () => {
    if (history.length > 1 && new URLSearchParams(location.search).get('r')) history.back();
    else {
      setSelected(null);
      setSelectedId(null);
    }
  };

  const start = () => {
    setStarted(true);
    if (!here) locate();
  };

  if (!started) return <Welcome onStart={start} locating={locating} />;

  const showDetail = selectedId !== null;
  const summary = selected ?? routes?.place ?? null;
  const padding: Padding = wide
    ? { top: 0, bottom: 0, left: 440, right: 0 }
    : showDetail
      ? { top: 56, bottom: detailH, left: 0, right: 0 }
      : { top: searchH, bottom: 0, left: 0, right: 0 };

  return (
    <div className={`app${showDetail ? ' has-detail' : ''}`}>
      <MapView
        here={here}
        showPlaces={!search.searched && !showDetail}
        target={search.searched?.target ?? null}
        results={showDetail ? [] : visible}
        hovered={hovered}
        selected={showDetail ? summary : null}
        routes={routes}
        mode={mode}
        departure={departure}
        padding={padding}
        onPick={pick}
        onMode={setMode}
      />
      {showDetail && summary ? (
        <Detail
          ref={detailRef}
          summary={summary}
          target={search.searched?.target ?? null}
          routes={routes}
          loading={routesState === 'loading'}
          error={routesState === 'error'}
          mode={mode}
          departure={departure}
          onMode={setMode}
          onDeparture={setDeparture}
          onBack={back}
        />
      ) : (
        <SearchPanel
          ref={searchRef}
          here={here}
          search={search}
          onSearch={(searched) => setSearch({ searched, response: null, loading: searched !== null && here !== null, error: null })}
          onPick={pick}
          onHover={setHovered}
          onChangePlace={() => setPicker(true)}
          onVisible={setVisible}
          onSort={(s) => {
            sortRef.current = s;
          }}
        />
      )}
      {picker || (!here && !locating) ? (
        <PlacePicker onPlace={placeHere} onLocate={() => locate()} onClose={here ? () => setPicker(false) : null} locating={locating} failed={locateFailed} />
      ) : null}
    </div>
  );
}
