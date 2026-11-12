import { useEffect, useRef } from 'react';
import maplibregl, { type GeoJSONSource, type LngLatBoundsLike } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Mode, RestaurantSummary, RoutesResponse } from '../../../src/api';
import { foodEmoji, MODE, minutes, type Here } from '../lib';

export interface Padding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const COLORS: Record<Mode, string> = { walk: '#2563eb', transit: '#d93a24', car: '#334155' };
const SWITZERLAND: LngLatBoundsLike = [
  [5.95, 45.82],
  [10.49, 47.81],
];

type Line = { mode: Mode; coords: [number, number][]; label: string };

/** The lines of each way there: walk, car, and the chosen public transport departure. */
function routeLines(routes: RoutesResponse | null, departure: number): Line[] {
  if (!routes) return [];
  const out: Line[] = [];
  if (routes.walk) out.push({ mode: 'walk', coords: routes.walk.geometry, label: minutes(routes.walk.durationMin) });
  if (routes.car) out.push({ mode: 'car', coords: routes.car.geometry, label: minutes(routes.car.durationMin) });
  const t = routes.transit[departure] ?? routes.transit[0];
  if (t) out.push({ mode: 'transit', coords: t.legs.flatMap((l) => l.geometry), label: minutes(t.durationMin) });
  return out;
}

function routeFeatures(routes: RoutesResponse | null, departure: number, mode: Mode) {
  const features: GeoJSON.Feature[] = [];
  if (routes) {
    if (routes.walk) features.push({ type: 'Feature', properties: { mode: 'walk', selected: mode === 'walk', dashed: true }, geometry: { type: 'LineString', coordinates: routes.walk.geometry } });
    if (routes.car) features.push({ type: 'Feature', properties: { mode: 'car', selected: mode === 'car', dashed: false }, geometry: { type: 'LineString', coordinates: routes.car.geometry } });
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

export function MapView(props: {
  here: Here | null;
  /** The food searched for: its pictogram marks the restaurants. */
  food: string | null;
  results: RestaurantSummary[];
  hovered: number | null;
  selected: RestaurantSummary | null;
  routes: RoutesResponse | null;
  mode: Mode;
  departure: number;
  padding: Padding;
  onPick: (r: RestaurantSummary) => void;
  onMode: (m: Mode) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const ready = useRef<Promise<void> | null>(null);
  const markers = useRef(new Map<number, { marker: maplibregl.Marker; el: HTMLButtonElement }>());
  const hereMarker = useRef<maplibregl.Marker | null>(null);
  const labels = useRef<maplibregl.Marker[]>([]);
  const onPick = useRef(props.onPick);
  const onMode = useRef(props.onMode);
  onPick.current = props.onPick;
  onMode.current = props.onMode;

  useEffect(() => {
    if (!el.current) return;
    const m = new maplibregl.Map({
      container: el.current,
      style: '/map/pwt-light.json',
      bounds: SWITZERLAND,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.current = m;
    if (import.meta.env.DEV) (window as unknown as { __map: maplibregl.Map }).__map = m;
    m.touchZoomRotate.disableRotation();
    m.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Restaurants © OpenStreetMap · Itinéraires MOTIS, opentransportdata.swiss' }), 'bottom-right');
    ready.current = new Promise((resolve) =>
      m.on('load', () => {
        m.addSource('routes', { type: 'geojson', data: routeFeatures(null, 0, 'walk') });
        const sel: maplibregl.ExpressionSpecification = ['==', ['get', 'selected'], true];
        const color: maplibregl.ExpressionSpecification = ['match', ['get', 'mode'], 'walk', COLORS.walk, 'car', COLORS.car, COLORS.transit];
        m.addLayer({ id: 'routes-other', type: 'line', source: 'routes', filter: ['!', sel], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': 3, 'line-opacity': 0.35 } });
        m.addLayer({ id: 'routes-casing', type: 'line', source: 'routes', filter: sel, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 9 } });
        m.addLayer({ id: 'routes-solid', type: 'line', source: 'routes', filter: ['all', sel, ['!', ['get', 'dashed']]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': 5 } });
        m.addLayer({ id: 'routes-dashed', type: 'line', source: 'routes', filter: ['all', sel, ['get', 'dashed']], layout: { 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': 4.5, 'line-dasharray': [0.6, 1.4] } });
        // Credits start folded on small screens (the (i) button opens them).
        if (m.getContainer().clientWidth < 900) m.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
        resolve();
      }),
    );
    return () => {
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
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'food-pin';
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          const target = (props.selected ? [props.selected] : props.results).find((p) => p.id === r.id) ?? r;
          onPick.current(target);
        });
        const marker = new maplibregl.Marker({ element: b, anchor: 'bottom' }).setLngLat([r.lon, r.lat]).addTo(m);
        x = { marker, el: b };
        markers.current.set(r.id, x);
      }
      x.el.textContent = foodEmoji(r, props.food);
      x.el.setAttribute('aria-label', `${r.name}${r.town ? `, ${r.town}` : ''}`);
      x.el.classList.toggle('is-selected', props.selected?.id === r.id);
      x.el.classList.toggle('is-hovered', props.hovered === r.id);
      x.el.style.zIndex = String(props.selected?.id === r.id || props.hovered === r.id ? 1000 : 100 - i);
    });
  }, [props.results, props.selected, props.hovered, props.food]);

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
      const lines = routeLines(props.routes, props.departure);
      const shares: Record<Mode, number> = { walk: 0.45, transit: 0.6, car: 0.75 };
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
      if (props.selected) {
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
        m.easeTo({ center: pts[0], zoom: 13, padding, duration: reduce ? 0 : 500 });
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
  }, [props.here, props.results, props.selected, props.routes, props.mode, props.departure, pad.top, pad.bottom, pad.left, pad.right]);

  return <div ref={el} className="map" role="region" aria-label="Carte" />;
}
