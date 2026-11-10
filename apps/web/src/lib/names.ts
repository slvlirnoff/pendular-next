import type { CommuteOption, OptionKind } from '@pendular/engine/types';
import type { T } from '../i18n/index.js';

/** A short human name: "P+Rail Moudon", "Public transport: Lucens → Lausanne, IR 15". */
export function optionName(o: CommuteOption, t: T): string {
  const kind = t(`kind.${o.kind}` as `kind.${OptionKind}`);
  if (o.kind === 'parkRail' || o.kind === 'bikeRide') return `${kind} ${o.access?.name ?? ''}`.trim();
  if (o.kind === 'cityParkRide') return o.access?.name ?? kind;
  if (o.kind === 'transit') return `${kind} · ${routeLines(o)}`;
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
