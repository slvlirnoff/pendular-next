import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Mode, RestaurantSummary, RoutesResponse, SearchResult } from '../../src/api';
import { FOOD_BY_KEY } from '../../src/foods';
import { Detail } from './components/Detail';
import { MapView, type Padding } from './components/MapView';
import { PlacePicker } from './components/PlacePicker';
import { SearchPanel, type SearchState } from './components/SearchPanel';
import { Welcome } from './components/Welcome';
import { api, bestMode, type Here } from './lib';

const HERE_KEY = 'trajestaurant.here';

function storedHere(): Here | null {
  try {
    const v = JSON.parse(localStorage.getItem(HERE_KEY) ?? 'null') as Here | null;
    return v && typeof v.lat === 'number' && typeof v.lon === 'number' ? v : null;
  } catch {
    return null;
  }
}

/** What the address bar holds: ?ici=lat,lon,label &food=pizza &r=123 */
function readUrl(): { here: Here | null; food: string | null; restaurant: number | null } {
  const p = new URLSearchParams(location.search);
  const [lat, lon, ...label] = (p.get('ici') ?? '').split(',');
  const here = lat && lon && Number.isFinite(+lat) && Number.isFinite(+lon) ? { lat: +lat, lon: +lon, label: label.join(',') || 'Ma position' } : null;
  const food = p.get('food');
  const r = Number(p.get('r'));
  return { here, food: food && FOOD_BY_KEY.has(food) ? food : null, restaurant: Number.isInteger(r) && r > 0 ? r : null };
}

function writeUrl(s: { here: Here | null; food: string | null; restaurant: number | null }, push: boolean) {
  const p = new URLSearchParams();
  if (s.here) p.set('ici', `${s.here.lat.toFixed(5)},${s.here.lon.toFixed(5)},${s.here.label}`);
  if (s.food) p.set('food', s.food);
  if (s.restaurant) p.set('r', String(s.restaurant));
  const url = `${location.pathname}${p.size ? `?${p.toString()}` : ''}`;
  if (url === `${location.pathname}${location.search}`) return;
  if (push) history.pushState(null, '', url);
  else history.replaceState(null, '', url);
}

function useHeight(ref: React.RefObject<HTMLElement>, deps: unknown[]): number {
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      setH(0);
      return;
    }
    const ro = new ResizeObserver(() => setH(el.getBoundingClientRect().height));
    ro.observe(el);
    setH(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return h;
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
  const [started, setStarted] = useState(initial.current.here !== null || initial.current.food !== null || initial.current.restaurant !== null);
  const [here, setHere] = useState<Here | null>(initial.current.here ?? storedHere());
  const [picker, setPicker] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locateFailed, setLocateFailed] = useState(false);
  const [search, setSearch] = useState<SearchState>({ food: initial.current.food, response: null, loading: false, error: null });
  const [visible, setVisible] = useState<SearchResult[]>([]);
  const [hovered, setHovered] = useState<number | null>(null);
  const [selected, setSelected] = useState<RestaurantSummary | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(initial.current.restaurant);
  const [routes, setRoutes] = useState<RoutesResponse | null>(null);
  const [routesState, setRoutesState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [mode, setMode] = useState<Mode>('walk');
  const [departure, setDeparture] = useState(0);
  const wide = useWide();
  const searchRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const searchH = useHeight(searchRef, [started, selectedId]);
  const detailH = useHeight(detailRef, [started, selectedId]);

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
    if (started) writeUrl({ here, food: search.food, restaurant: selectedId }, false);
  }, [started, here, search.food, selectedId]);
  useEffect(() => {
    const onPop = () => {
      const u = readUrl();
      setSelectedId(u.restaurant);
      if (!u.restaurant) setSelected(null);
      setSearch((s) => (s.food === u.food ? s : { food: u.food, response: null, loading: false, error: null }));
    };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);

  // Search when the food or the place changes.
  useEffect(() => {
    const food = search.food;
    if (!food || !here) return;
    const ctl = new AbortController();
    setSearch((s) => ({ ...s, loading: true, error: null }));
    api
      .search(food, here, ctl.signal)
      .then((response) => setSearch((s) => (s.food === food ? { food, response, loading: false, error: null } : s)))
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setSearch((s) => ({ ...s, loading: false, error: e.message }));
      });
    return () => ctl.abort();
  }, [search.food, here]);

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
      .restaurant(selectedId, here, ctl.signal)
      .then((r) => {
        setRoutes(r);
        setRoutesState('idle');
        setSelected((s) => s ?? r.restaurant);
        const listed = search.response?.results.find((x) => x.id === selectedId);
        const times = { walkMin: r.walk?.durationMin ?? null, transitMin: r.transit[0]?.durationMin ?? null, carMin: r.car?.durationMin ?? null };
        setMode(bestMode(listed ?? times) ?? bestMode(times) ?? 'car');
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setRoutesState('error');
      });
    return () => ctl.abort();
  }, [selectedId, here]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (r: RestaurantSummary) => {
    setSelected(r);
    setSelectedId(r.id);
    setHovered(null);
    writeUrl({ here, food: search.food, restaurant: r.id }, true);
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
  const summary = selected ?? routes?.restaurant ?? null;
  const padding: Padding = wide
    ? { top: 0, bottom: 0, left: 440, right: 0 }
    : showDetail
      ? { top: 56, bottom: detailH, left: 0, right: 0 }
      : { top: searchH, bottom: 0, left: 0, right: 0 };

  return (
    <div className={`app${showDetail ? ' has-detail' : ''}`}>
      <MapView
        here={here}
        food={search.food}
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
          food={search.food}
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
          onFood={(food) => setSearch({ food, response: null, loading: food !== null && here !== null, error: null })}
          onPick={pick}
          onHover={setHovered}
          onChangePlace={() => setPicker(true)}
          onVisible={setVisible}
        />
      )}
      {picker || (!here && !locating) ? (
        <PlacePicker onPlace={placeHere} onLocate={() => locate()} onClose={here ? () => setPicker(false) : null} locating={locating} failed={locateFailed} />
      ) : null}
    </div>
  );
}
