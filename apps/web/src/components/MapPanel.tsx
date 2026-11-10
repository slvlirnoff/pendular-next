import { useEffect, useRef } from 'react';
import maplibregl, { type GeoJSONSource, type LngLatBoundsLike } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { CommuteOption, Leg, Place } from '@pendular/engine/types';
import { useI18n } from '../i18n/index.js';

const STREET = new Set(['walk', 'bike', 'ebike', 'car']);

function legCoords(l: Leg): [number, number][] {
  if (l.geometry && l.geometry.length > 1) return l.geometry;
  // The timetable has no shapes: draw through the stops the vehicle calls at.
  return [l.from, ...(l.intermediateStops ?? []), l.to].map((s) => [s.lon, s.lat] as [number, number]);
}

function features(options: CommuteOption[], selected: string | null) {
  const lines = options.flatMap((o) =>
    o.itinerary.legs.map((l) => ({
      type: 'Feature' as const,
      properties: { selected: o.id === selected, street: STREET.has(l.mode), walk: l.mode === 'walk' },
      geometry: { type: 'LineString' as const, coordinates: legCoords(l) },
    })),
  );
  // Selected last, so it is drawn on top.
  return { type: 'FeatureCollection' as const, features: lines.sort((a, b) => Number(a.properties.selected) - Number(b.properties.selected)) };
}

function stops(o: CommuteOption | undefined) {
  const pts = (o?.itinerary.legs ?? []).filter((l) => !STREET.has(l.mode)).flatMap((l) => [l.from, l.to]);
  return {
    type: 'FeatureCollection' as const,
    features: pts.map((s) => ({ type: 'Feature' as const, properties: { name: s.name }, geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] } })),
  };
}

export function MapPanel(props: { home: Place; work: Place; options: CommuteOption[]; selected: string | null }) {
  const { t } = useI18n();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const ready = useRef(false);
  const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  useEffect(() => {
    if (!el.current) return;
    const m = (map.current = new maplibregl.Map({
      container: el.current,
      style: '/map/pwt-light.json',
      center: [props.work.lon, props.work.lat],
      zoom: 10,
      attributionControl: false,
      cooperativeGestures: true,
    }));
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'opentransportdata.swiss' }));
    m.on('load', () => {
      m.addSource('routes', { type: 'geojson', data: features([], null) });
      m.addSource('route-stops', { type: 'geojson', data: stops(undefined) });
      const sel: maplibregl.ExpressionSpecification = ['==', ['get', 'selected'], true];
      m.addLayer({ id: 'routes-other', type: 'line', source: 'routes', filter: ['!', sel], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': css('--map-stop'), 'line-width': 2, 'line-opacity': 0.45 } });
      m.addLayer({ id: 'routes-casing', type: 'line', source: 'routes', filter: sel, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 7 } });
      m.addLayer({ id: 'routes-selected', type: 'line', source: 'routes', filter: ['all', sel, ['!', ['get', 'walk']]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': css('--accent'), 'line-width': 4 } });
      m.addLayer({ id: 'routes-selected-walk', type: 'line', source: 'routes', filter: ['all', sel, ['get', 'walk']], paint: { 'line-color': css('--accent'), 'line-width': 3, 'line-dasharray': [0.5, 1.6] } });
      m.addLayer({ id: 'route-stops', type: 'circle', source: 'route-stops', paint: { 'circle-radius': 4.5, 'circle-color': '#ffffff', 'circle-stroke-color': css('--accent'), 'circle-stroke-width': 2 } });
      ready.current = true;
      m.fire('pendular:data');
    });
    const pin = (p: Place, cls: string) => {
      const d = document.createElement('div');
      d.className = `pin ${cls}`;
      d.title = p.label;
      return new maplibregl.Marker({ element: d, anchor: 'center' }).setLngLat([p.lon, p.lat]).addTo(m);
    };
    const a = pin(props.home, 'pin-home');
    const b = pin(props.work, 'pin-work');
    return () => {
      a.remove();
      b.remove();
      ready.current = false;
      m.remove();
      map.current = null;
    };
  }, [props.home.lat, props.home.lon, props.work.lat, props.work.lon]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const apply = () => {
      (m.getSource('routes') as GeoJSONSource | undefined)?.setData(features(props.options, props.selected));
      const chosen = props.options.find((o) => o.id === props.selected);
      (m.getSource('route-stops') as GeoJSONSource | undefined)?.setData(stops(chosen));
      const coords = (chosen ? [chosen] : props.options).flatMap((o) => o.itinerary.legs.flatMap(legCoords));
      coords.push([props.home.lon, props.home.lat], [props.work.lon, props.work.lat]);
      const lons = coords.map((c) => c[0]);
      const lats = coords.map((c) => c[1]);
      const bounds: LngLatBoundsLike = [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]];
      m.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: 400 });
    };
    if (ready.current) apply();
    else m.once('pendular:data', apply);
  }, [props.options, props.selected, props.home, props.work]);

  return <div ref={el} className="map" role="region" aria-label={t('map.title')} />;
}
