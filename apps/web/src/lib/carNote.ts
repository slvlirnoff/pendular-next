import type { CarAssumptions } from '@pendular/engine/types';
import type { T } from '../i18n/index.js';

/** "Hypothèses : trafic de pointe (+30 %), 15 min pour se garer (centre-ville)". Null without assumptions. */
export function carNote(car: CarAssumptions | undefined, t: T): string | null {
  if (!car) return null;
  const parts: string[] = [];
  const pct = Math.round((car.peakFactor - 1) * 100);
  if (pct > 0) parts.push(t('car.peak', { pct }));
  if (car.parkingMin > 0) {
    if (!car.parkingAuto) parts.push(t('car.parkManual', { min: car.parkingMin }));
    else if (car.parkingKind) parts.push(t('car.parkKind', { min: car.parkingMin, kind: t(`car.kind.${car.parkingKind}`) }));
    else parts.push(t('car.park', { min: car.parkingMin }));
  }
  return parts.length ? t('car.assume', { parts: parts.join(', ') }) : null;
}
