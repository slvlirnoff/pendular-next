import { TRANSIT_MODES, type CommuteOption, type OptionKind } from '@pendular/engine/types';
import type { T } from '../i18n/index.js';

/** A short human name: "P+Rail Moudon", "Public transport: Lucens → Lausanne, IR 15". */
export function optionName(o: CommuteOption, t: T): string {
  const kind = t(`kind.${o.kind}` as `kind.${OptionKind}`);
  if (o.kind === 'parkRail' || o.kind === 'bikeRide' || o.kind === 'cityParkRide') {
    return t(`name.${o.kind}`, { site: o.access?.name ?? '' });
  }
  if (o.kind === 'transit') {
    const via = changeStops(o);
    return via.length ? t('name.transitVia', { via: via.join(', ') }) : t('name.transitDirect');
  }
  return kind;
}

export function routeLines(o: CommuteOption): string {
  return o.itinerary.legs
    .filter((l) => l.line)
    .map((l) => l.line!.name || l.mode)
    .join(' › ');
}

/** Marker shapes by access type, so the chart does not rely on colour. */
export const KIND_SHAPE: Record<OptionKind, 'circle' | 'square' | 'diamond' | 'triangle'> = {
  transit: 'circle',
  parkRail: 'square',
  cityParkRide: 'square',
  bikeRide: 'diamond',
  walk: 'diamond',
  bike: 'diamond',
  ebike: 'diamond',
  car: 'triangle',
};

/** Where the traveller changes vehicle, at most two names, without the stop detail ("Lucens, gare" → "Lucens"). */
export function changeStops(o: CommuteOption): string[] {
  // The typical connection only (`itinerary`), by mode like the engine's route title, not by line name.
  const legs = o.itinerary.legs.filter((l) => TRANSIT_MODES.includes(l.mode));
  const names = legs.slice(0, -1).map((l) => l.to.name.split(',')[0]!.trim());
  return [...new Set(names)].slice(0, 2);
}
