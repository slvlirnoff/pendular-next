import { useEffect, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type LngLatBoundsLike } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { DetailMode, FreeVehicle, MapPlaces, MapStop, PlaceHit, PlaceSummary, RoutesResponse, Target } from '../../../src/api';
import { distanceTo, MODE, minutes, placeEmoji, stopEmoji, type Here } from '../lib';
import { LANG, t } from '../i18n';
import { REGION } from '../region';

export interface Padding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const COLORS: Record<DetailMode, string> = { walk: '#2563eb', bike: '#0e7490', transit: '#d93a24', car: '#334155', sharing: '#1d7348' };
/**
 * The base map's place and street names in one language: the name in it when the map has one
 * (name:uk), else the local name (Ukrainian) or its Latin form (English).
 */
function labelsIn(m: maplibregl.Map, lang: string) {
  const name: maplibregl.ExpressionSpecification = ['coalesce', ['get', `name:${lang}`], ['get', lang === 'en' ? 'name:latin' : 'name'], ['get', 'name']];
  for (const l of m.getStyle().layers ?? []) {
    if (l.type !== 'symbol') continue;
    const field = JSON.stringify(m.getLayoutProperty(l.id, 'text-field') ?? '');
    if (field.includes('name:nonlatin') || field.includes('name_en')) m.setLayoutProperty(l.id, 'text-field', name);
  }
}

/** The map when the site opens: the region's (Switzerland, Vinnytsia). */
const START: LngLatBoundsLike = REGION.view;

type Line = { mode: DetailMode; coords: [number, number][]; label: string };

/** The lines of each way there: walk, car, and the chosen public transport departure. */
function routeLines(routes: RoutesResponse | null, departure: number): Line[] {
  if (!routes) return [];
  const out: Line[] = [];
  if (routes.walk) out.push({ mode: 'walk', coords: routes.walk.geometry, label: minutes(routes.walk.durationMin) });
  if (routes.bike) out.push({ mode: 'bike', coords: routes.bike.geometry, label: minutes(routes.bike.durationMin) });
  if (routes.car) out.push({ mode: 'car', coords: routes.car.geometry, label: minutes(routes.car.durationMin) });
  const t = routes.transit[departure] ?? routes.transit[0];
  if (t) out.push({ mode: 'transit', coords: t.legs.flatMap((l) => l.geometry), label: minutes(t.durationMin) });
  if (routes.sharing) out.push({ mode: 'sharing', coords: [...routes.sharing.walk.geometry, ...routes.sharing.drive.geometry], label: minutes(routes.sharing.durationMin) });
  return out;
}

function routeFeatures(routes: RoutesResponse | null, departure: number, mode: DetailMode) {
  const features: GeoJSON.Feature[] = [];
  if (routes) {
    if (routes.walk) features.push({ type: 'Feature', properties: { mode: 'walk', selected: mode === 'walk', dashed: true }, geometry: { type: 'LineString', coordinates: routes.walk.geometry } });
    if (routes.bike) features.push({ type: 'Feature', properties: { mode: 'bike', selected: mode === 'bike', dashed: false }, geometry: { type: 'LineString', coordinates: routes.bike.geometry } });
    if (routes.car) features.push({ type: 'Feature', properties: { mode: 'car', selected: mode === 'car', dashed: false }, geometry: { type: 'LineString', coordinates: routes.car.geometry } });
    if (routes.sharing) {
      features.push({ type: 'Feature', properties: { mode: 'sharing', selected: mode === 'sharing', dashed: true }, geometry: { type: 'LineString', coordinates: routes.sharing.walk.geometry } });
      features.push({ type: 'Feature', properties: { mode: 'sharing', selected: mode === 'sharing', dashed: false }, geometry: { type: 'LineString', coordinates: routes.sharing.drive.geometry } });
    }
    const t = routes.transit[departure] ?? routes.transit[0];
    for (const l of t?.legs ?? []) {
      features.push({
        type: 'Feature',
        properties: { mode: 'transit', selected: mode === 'transit', dashed: l.mode === 'walk' },
        geometry: { type: 'LineString', coordinates: l.geometry },
      });
    }
  }
  // The chosen way last, drawn on top.
  features.sort((a, b) => Number(a.properties!.selected) - Number(b.properties!.selected));
  return { type: 'FeatureCollection' as const, features };
}

function pointAlong(coords: [number, number][], share: number): [number, number] | null {
  if (coords.length === 0) return null;
  let total = 0;
  const seg: number[] = [];
  for (let i = 1; i < coords.length; i++) {
    const [x0, y0] = coords[i - 1]!;
    const [x1, y1] = coords[i]!;
    const d = Math.hypot((x1 - x0) * Math.cos((y0 * Math.PI) / 180), y1 - y0);
    seg.push(d);
    total += d;
  }
  let target = total * share;
  for (let i = 0; i < seg.length; i++) {
    if (target <= seg[i]!) {
      const t = seg[i]! ? target / seg[i]! : 0;
      const [x0, y0] = coords[i]!;
      const [x1, y1] = coords[i + 1]!;
      return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
    }
    target -= seg[i]!;
  }
  return coords[coords.length - 1]!;
}

/** From this zoom on, the places around are shown when nothing is searched (a village, a city district). */
const PLACES_MIN_ZOOM = 14;

/** Stops are shown from this zoom on (a stop every few hundred metres in a town). */
const STOPS_MIN_ZOOM = 15;

/** A map icon for a place: its emoji on a white disc, drawn once per emoji. */
/** A shared vehicle parked anywhere: its emoji on a smaller disc, ringed in the bike's teal. */
function drawVehicleIcon(emoji: string): ImageData {
  const size = 36;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 2.5, 0, 2 * Math.PI);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#0e7490';
  ctx.stroke();
  ctx.font = '19px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, size / 2, size / 2 + 1.5);
  return ctx.getImageData(0, 0, size, size);
}

const VEHICLE_EMOJI: Record<FreeVehicle['kind'], string> = { scooter: '🛴', bike: '🚲', ebike: '🚲', cargo: '🚲', moped: '🛵', car: '🚗', other: '🛴' };

function drawPlaceIcon(emoji: string): ImageData {
  const size = 48;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 3, 0, 2 * Math.PI);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#b9b0aa';
  ctx.stroke();
  ctx.font = '26px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, size / 2, size / 2 + 2);
  return ctx.getImageData(0, 0, size, size);
}

export function MapView(props: {
  here: Here | null;
  /** Nothing is searched nor chosen: show the places around (from PLACES_MIN_ZOOM on). */
  showPlaces: boolean;
  /** The chosen place is an address: the map shows it close up, with the places around it, not the whole way there. */
  around?: boolean;
  /** What was searched for: the food searched for gives the pictogram. */
  target: Target | null;
  results: PlaceSummary[];
  hovered: number | null;
  selected: PlaceSummary | null;
  routes: RoutesResponse | null;
  mode: DetailMode;
  departure: number;
  padding: Padding;
  onPick: (r: PlaceSummary) => void;
  onMode: (m: DetailMode) => void;
  /** A public transport stop clicked on the map: its card and departure board. */
  onStop?: (s: PlaceHit) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const ready = useRef<Promise<void> | null>(null);
  const markers = useRef(new Map<number, { marker: maplibregl.Marker; pin: HTMLDivElement; el: HTMLButtonElement }>());
  const hereMarker = useRef<maplibregl.Marker | null>(null);
  const labels = useRef<maplibregl.Marker[]>([]);
  const [zoomedOut, setZoomedOut] = useState(false);
  const placesById = useRef(new Map<number, MapPlaces['places'][number]>());
  const showPlaces = useRef(props.showPlaces);
  showPlaces.current = props.showPlaces;
  const here = useRef(props.here);
  here.current = props.here;
  const onPick = useRef(props.onPick);
  const onMode = useRef(props.onMode);
  onPick.current = props.onPick;
  onMode.current = props.onMode;
  const onStop = useRef(props.onStop);
  onStop.current = props.onStop;

  useEffect(() => {
    if (!el.current) return;
    const m = new maplibregl.Map({
      container: el.current,
      style: '/map/pwt-light.json',
      bounds: START,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.current = m;
    if (import.meta.env.DEV) (window as unknown as { __map: maplibregl.Map }).__map = m;
    m.touchZoomRotate.disableRotation();
    m.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: t('credits.map') }), 'bottom-right');
    ready.current = new Promise((resolve) =>
      m.on('load', () => {
        if (REGION.labelsInLanguage) labelsIn(m, LANG);
        // The places around, under the routes: an emoji icon, the name when zoomed in. The map
        // leaves out icons that would overlap, places to eat and chains winning.
        m.addSource('places', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({
          id: 'places',
          type: 'symbol',
          source: 'places',
          layout: {
            'icon-image': ['get', 'icon'],
            'icon-size': ['interpolate', ['linear'], ['zoom'], PLACES_MIN_ZOOM, 0.8, 17, 1.05],
            'symbol-sort-key': ['get', 'rank'],
            'text-field': ['step', ['zoom'], '', 15.5, ['get', 'name']],
            'text-font': ['Noto Sans Regular'],
            'text-size': 11.5,
            'text-offset': [0, 1.3],
            'text-anchor': 'top',
            'text-max-width': 9,
            'text-optional': true,
          },
          paint: { 'text-color': '#3b3532', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
        });
        m.on('click', 'places', (e) => {
          const id = Number(e.features?.[0]?.properties?.id);
          const p = placesById.current.get(id);
          if (!p) return;
          onPick.current({ ...p, distanceM: here.current ? Math.round(distanceTo(here.current, p)) : 0, open: null });
        });
        m.on('mouseenter', 'places', () => (m.getCanvas().style.cursor = 'pointer'));
        m.on('mouseleave', 'places', () => (m.getCanvas().style.cursor = ''));
        // Public transport stops, from STOPS_MIN_ZOOM on, over the places (they win where icons overlap).
        m.addSource('stops', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer({
          id: 'stops',
          type: 'symbol',
          source: 'stops',
          layout: {
            'icon-image': ['get', 'icon'],
            'icon-size': ['interpolate', ['linear'], ['zoom'], STOPS_MIN_ZOOM, 0.8, 17, 1],
            'text-field': ['step', ['zoom'], '', 16, ['get', 'name']],
            'text-font': ['Noto Sans Regular'],
            'text-size': 11,
            'text-offset': [0, 1.3],
            'text-anchor': 'top',
            'text-max-width': 9,
            'text-optional': true,
          },
          paint: { 'text-color': '#1e3a8a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 },
        });
        m.on('click', 'stops', (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as { id: string; name: string; modes: string };
          const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates as [number, number];
          onStop.current?.({ label: p.name, lat, lon, type: 'stop', stopId: p.id, modes: JSON.parse(p.modes) as MapStop['modes'] });
        });
        m.on('mouseenter', 'stops', () => (m.getCanvas().style.cursor = 'pointer'));
        m.on('mouseleave', 'stops', () => (m.getCanvas().style.cursor = ''));
        // Shared scooters, bikes and mopeds parked anywhere, live, under the stops and places.
        m.addSource('vehicles', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        m.addLayer(
          {
            id: 'vehicles',
            type: 'symbol',
            source: 'vehicles',
            layout: { 'icon-image': ['get', 'icon'], 'icon-size': ['interpolate', ['linear'], ['zoom'], STOPS_MIN_ZOOM, 0.75, 18, 1], 'icon-allow-overlap': false },
          },
          'places',
        );
        m.on('click', 'vehicles', (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as { provider: string; kind: FreeVehicle['kind']; rangeKm?: number };
          const text = [`${p.provider} · ${t(`vehicle.${p.kind}`)}`, typeof p.rangeKm === 'number' ? t('vehicle.range', { n: p.rangeKm }) : null, t('vehicle.book', { provider: p.provider })].filter(Boolean);
          const box = document.createElement('div');
          box.className = 'vehicle-pop';
          for (const [i, line] of text.entries()) {
            const el = document.createElement(i === 0 ? 'strong' : 'span');
            el.textContent = line!;
            box.append(el);
          }
          new maplibregl.Popup({ closeButton: false, offset: 14, maxWidth: '240px' }).setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number]).setDOMContent(box).addTo(m);
        });
        m.on('mouseenter', 'vehicles', () => (m.getCanvas().style.cursor = 'pointer'));
        m.on('mouseleave', 'vehicles', () => (m.getCanvas().style.cursor = ''));
        m.addSource('routes', { type: 'geojson', data: routeFeatures(null, 0, 'walk') });
        const sel: maplibregl.ExpressionSpecification = ['==', ['get', 'selected'], true];
        const color: maplibregl.ExpressionSpecification = ['match', ['get', 'mode'], 'walk', COLORS.walk, 'bike', COLORS.bike, 'car', COLORS.car, 'sharing', COLORS.sharing, COLORS.transit];
        m.addLayer({ id: 'routes-other', type: 'line', source: 'routes', filter: ['!', sel], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': 3, 'line-opacity': 0.22 } });
        // A faint way is chosen by a click on it (a wider invisible line makes it easy to hit).
        m.addLayer({ id: 'routes-other-hit', type: 'line', source: 'routes', filter: ['!', sel], paint: { 'line-color': '#000000', 'line-width': 16, 'line-opacity': 0 } });
        m.on('click', 'routes-other-hit', (e) => {
          const mode = e.features?.[0]?.properties?.mode as DetailMode | undefined;
          if (mode) onMode.current(mode);
        });
        m.on('mouseenter', 'routes-other-hit', () => (m.getCanvas().style.cursor = 'pointer'));
        m.on('mouseleave', 'routes-other-hit', () => (m.getCanvas().style.cursor = ''));
        m.addLayer({ id: 'routes-casing', type: 'line', source: 'routes', filter: sel, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 9 } });
        m.addLayer({ id: 'routes-solid', type: 'line', source: 'routes', filter: ['all', sel, ['!', ['get', 'dashed']]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': 5 } });
        m.addLayer({ id: 'routes-dashed', type: 'line', source: 'routes', filter: ['all', sel, ['get', 'dashed']], layout: { 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': 4.5, 'line-dasharray': [0.6, 1.4] } });
        // Credits start folded on small screens (the (i) button opens them).
        if (m.getContainer().clientWidth < 900) m.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
        resolve();
      }),
    );
    m.on('styleimagemissing', (e) => {
      if (m.hasImage(e.id)) return;
      if (e.id.startsWith('place:')) m.addImage(e.id, drawPlaceIcon(e.id.slice('place:'.length)), { pixelRatio: 2 });
      else if (e.id.startsWith('vehicle:')) m.addImage(e.id, drawVehicleIcon(e.id.slice('vehicle:'.length)), { pixelRatio: 2 });
    });
    // The places in view, asked again once the map stops moving.
    let pending: AbortController | null = null;
    const loadPlaces = () => {
      pending?.abort();
      const source = m.getSource('places') as GeoJSONSource | undefined;
      if (!source) return;
      const tooFar = m.getZoom() < PLACES_MIN_ZOOM;
      setZoomedOut(showPlaces.current && tooFar);
      if (!showPlaces.current || tooFar) {
        source.setData({ type: 'FeatureCollection', features: [] });
        return;
      }
      const b = m.getBounds();
      const ctl = (pending = new AbortController());
      fetch(`/api/map/places?bbox=${[b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((x) => x.toFixed(5)).join(',')}`, { signal: ctl.signal })
        .then((r) => r.json() as Promise<MapPlaces>)
        .then((d) => {
          placesById.current = new Map(d.places.map((p) => [p.id, p]));
          source.setData({
            type: 'FeatureCollection',
            features: d.places.map((p) => ({
              type: 'Feature' as const,
              properties: { id: p.id, name: p.name, icon: `place:${placeEmoji(p, null)}`, rank: p.foods.length ? 0 : p.brand ? 1 : 2 },
              geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] },
            })),
          });
        })
        .catch(() => undefined);
    };
    // The stops in view, likewise.
    let pendingStops: AbortController | null = null;
    const loadStops = () => {
      pendingStops?.abort();
      const source = m.getSource('stops') as GeoJSONSource | undefined;
      if (!source) return;
      if (!showPlaces.current || m.getZoom() < STOPS_MIN_ZOOM) {
        source.setData({ type: 'FeatureCollection', features: [] });
        return;
      }
      const b = m.getBounds();
      const ctl = (pendingStops = new AbortController());
      fetch(`/api/stops?min=${b.getSouth().toFixed(5)},${b.getWest().toFixed(5)}&max=${b.getNorth().toFixed(5)},${b.getEast().toFixed(5)}`, { signal: ctl.signal })
        .then((r) => r.json() as Promise<MapStop[]>)
        .then((list) => {
          if (!Array.isArray(list)) return;
          source.setData({
            type: 'FeatureCollection',
            features: list.map((s) => ({
              type: 'Feature' as const,
              properties: { id: s.id, name: s.name, modes: JSON.stringify(s.modes), icon: `place:${stopEmoji(s.modes)}` },
              geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] },
            })),
          });
        })
        .catch(() => undefined);
    };
    // The shared vehicles in view, likewise, and again every minute while they are shown (they move).
    let pendingVehicles: AbortController | null = null;
    const loadVehicles = () => {
      pendingVehicles?.abort();
      const source = m.getSource('vehicles') as GeoJSONSource | undefined;
      if (!source) return;
      if (!showPlaces.current || m.getZoom() < STOPS_MIN_ZOOM) {
        source.setData({ type: 'FeatureCollection', features: [] });
        return;
      }
      const b = m.getBounds();
      const ctl = (pendingVehicles = new AbortController());
      fetch(`/api/vehicles?min=${b.getSouth().toFixed(5)},${b.getWest().toFixed(5)}&max=${b.getNorth().toFixed(5)},${b.getEast().toFixed(5)}`, { signal: ctl.signal })
        .then((r) => r.json() as Promise<FreeVehicle[]>)
        .then((list) => {
          if (!Array.isArray(list)) return;
          source.setData({
            type: 'FeatureCollection',
            features: list.map((v) => ({
              type: 'Feature' as const,
              properties: { provider: v.provider, kind: v.kind, ...(v.rangeKm !== undefined ? { rangeKm: v.rangeKm } : {}), icon: `vehicle:${VEHICLE_EMOJI[v.kind]}` },
              geometry: { type: 'Point' as const, coordinates: [v.lon, v.lat] },
            })),
          });
        })
        .catch(() => undefined);
    };
    const vehiclesTimer = setInterval(() => {
      if (showPlaces.current && m.getZoom() >= STOPS_MIN_ZOOM && document.visibilityState === 'visible') loadVehicles();
    }, 60_000);
    m.on('moveend', loadPlaces);
    m.on('trajestaurant:places', loadPlaces);
    m.on('moveend', loadStops);
    m.on('trajestaurant:places', loadStops);
    m.on('moveend', loadVehicles);
    m.on('trajestaurant:places', loadVehicles);
    return () => {
      clearInterval(vehiclesTimer);
      m.remove();
      map.current = null;
    };
  }, []);

  // Where the searcher is.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    hereMarker.current?.remove();
    hereMarker.current = null;
    if (!props.here) return;
    const d = document.createElement('div');
    d.className = 'here-dot';
    d.title = props.here.label;
    hereMarker.current = new maplibregl.Marker({ element: d, anchor: 'center' }).setLngLat([props.here.lon, props.here.lat]).addTo(m);
  }, [props.here]);

  // One marker per restaurant shown; only the chosen one while its way is shown.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const shown = props.selected ? [props.selected] : props.results;
    const keep = new Set(shown.map((r) => r.id));
    for (const [id, x] of markers.current) {
      if (!keep.has(id)) {
        x.marker.remove();
        markers.current.delete(id);
      }
    }
    shown.forEach((r, i) => {
      let x = markers.current.get(r.id);
      if (!x) {
        // MapLibre places the element it is given (position and transform): that element has no
        // style of its own. The round badge and the tip under it are its children, the tip's point
        // being the bottom of the element, so the place.
        const pin = document.createElement('div');
        pin.className = 'pin';
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'food-pin';
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          const target = (props.selected ? [props.selected] : props.results).find((p) => p.id === r.id) ?? r;
          // An address's pin: its card is already open.
          if (target.kindKey === 'address') return;
          onPick.current(target);
        });
        const tip = document.createElement('span');
        tip.className = 'pin-tip';
        pin.append(b, tip);
        const marker = new maplibregl.Marker({ element: pin, anchor: 'bottom' }).setLngLat([r.lon, r.lat]).addTo(m);
        x = { marker, pin, el: b };
        markers.current.set(r.id, x);
      }
      x.el.textContent = placeEmoji(r, props.target);
      x.el.setAttribute('aria-label', `${r.name}${r.town ? `, ${r.town}` : ''}`);
      x.el.classList.toggle('is-selected', props.selected?.id === r.id);
      x.el.classList.toggle('is-hovered', props.hovered === r.id);
      x.pin.classList.toggle('is-selected', props.selected?.id === r.id);
      x.pin.style.zIndex = String(props.selected?.id === r.id || props.hovered === r.id ? 1000 : 100 - i);
    });
  }, [props.results, props.selected, props.hovered, props.target]);

  // The ways there, with their duration written on the map (as on the sketch).
  useEffect(() => {
    let cancelled = false;
    void ready.current?.then(() => {
      const m = map.current;
      if (!m || cancelled) return;
      (m.getSource('routes') as GeoJSONSource | undefined)?.setData(routeFeatures(props.selected ? props.routes : null, props.departure, props.mode));
      for (const l of labels.current) l.remove();
      labels.current = [];
      if (!props.selected) return;
      // Only the chosen way's time: the others are drawn faint, a click on one chooses it.
      const lines = routeLines(props.routes, props.departure).filter((l) => l.mode === props.mode);
      const shares: Record<DetailMode, number> = { walk: 0.45, bike: 0.35, transit: 0.6, car: 0.75, sharing: 0.3 };
      for (const line of lines) {
        const at = pointAlong(line.coords, shares[line.mode]);
        if (!at) continue;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `route-label mode-${line.mode}${line.mode === props.mode ? ' is-selected' : ''}`;
        b.textContent = `${MODE[line.mode].emoji} ${line.label}`;
        b.setAttribute('aria-label', `${MODE[line.mode].label} : ${line.label}`);
        b.addEventListener('click', () => onMode.current(line.mode));
        labels.current.push(new maplibregl.Marker({ element: b, anchor: 'center' }).setLngLat(at).addTo(m));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [props.routes, props.selected, props.mode, props.departure]);

  // Frame what matters: the way there, else the first results, else the searcher.
  const pad = props.padding;
  useEffect(() => {
    let cancelled = false;
    void ready.current?.then(() => {
      const m = map.current;
      if (!m || cancelled) return;
      const pts: [number, number][] = [];
      if (props.here) pts.push([props.here.lon, props.here.lat]);
      if (props.selected && props.around) {
        // An address: close up on it, the places around visible (from PLACES_MIN_ZOOM on).
        pts.length = 0;
        pts.push([props.selected.lon, props.selected.lat]);
      } else if (props.selected) {
        pts.push([props.selected.lon, props.selected.lat]);
        const line = routeLines(props.routes, props.departure).find((l) => l.mode === props.mode);
        if (line) pts.push(...line.coords);
      } else {
        for (const r of props.results.slice(0, 5)) pts.push([r.lon, r.lat]);
      }
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      // easeTo keeps its padding on the map, and fitBounds adds the map's padding to its own:
      // start from none each time. Panels taller than the map leave it at least 120 px.
      m.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
      const { clientWidth: w, clientHeight: h } = m.getContainer();
      const fit = (a: number, b: number, size: number) => {
        const room = size - 120;
        return a + b + 56 <= room ? [a + 28, b + 28] : [Math.max(8, (a * room) / (a + b + 56)), Math.max(8, (b * room) / (a + b + 56))];
      };
      const [top, bottom] = fit(pad.top + 48, pad.bottom + 16, h) as [number, number];
      const [left, right] = fit(pad.left, pad.right, w) as [number, number];
      const padding = { top, bottom, left, right };
      if (pts.length === 0) return;
      if (pts.length === 1) {
        m.easeTo({ center: pts[0], zoom: props.around ? 16.5 : PLACES_MIN_ZOOM + 0.5, padding, duration: reduce ? 0 : 500 });
        return;
      }
      const lons = pts.map((p) => p[0]);
      const lats = pts.map((p) => p[1]);
      m.fitBounds(
        [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ],
        { padding, maxZoom: 15.5, duration: reduce ? 0 : 600 },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [props.here, props.results, props.selected, props.around, props.routes, props.mode, props.departure, pad.top, pad.bottom, pad.left, pad.right]);

  // Shown or hidden with the search: asked for the current view when they come back.
  useEffect(() => {
    void ready.current?.then(() => {
      const m = map.current;
      if (!m) return;
      m.setLayoutProperty('places', 'visibility', props.showPlaces ? 'visible' : 'none');
      m.setLayoutProperty('stops', 'visibility', props.showPlaces ? 'visible' : 'none');
      m.setLayoutProperty('vehicles', 'visibility', props.showPlaces ? 'visible' : 'none');
      m.fire('trajestaurant:places');
    });
  }, [props.showPlaces]);

  return (
    <>
      <div ref={el} className="map" role="region" aria-label={t('map.region')} />
      {zoomedOut ? <p className="map-hint">{t('map.zoom')}</p> : null}
    </>
  );
}
