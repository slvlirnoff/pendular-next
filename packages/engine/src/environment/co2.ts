import type { LegMode } from '../types.js';
import data from '../../data/factors/co2.json' with { type: 'json' };

export type Co2Basis = 'pkm' | 'vkm';
export interface Co2Factor {
  /** g CO2-eq per km (passenger-km, or vehicle-km when basis is 'vkm'). */
  gPerKm: number;
  basis: Co2Basis;
  /** Key in co2.json that supplied the value (differs from the mode's own key when a fallback applied). */
  key: string;
}

interface Entry {
  value: number | null;
  basis: Co2Basis;
  fallback?: string;
}
const FACTORS = data.factors as Record<string, Entry | undefined>;

const LONG_DISTANCE = new Set(['IC', 'IR', 'EC', 'ICE', 'TGV', 'RJ', 'RJX', 'NJ', 'EN', 'EXT']);

function keyFor(mode: LegMode, hint?: { category?: string }): string {
  switch (mode) {
    case 'rail': {
      const cat = (hint?.category ?? '').trim().toUpperCase();
      return LONG_DISTANCE.has(cat) ? 'rail_long' : 'rail_regional';
    }
    case 'bus': return 'bus_regional';
    case 'tram': return 'tram';
    case 'metro': return 'metro';
    case 'boat': return 'boat';
    case 'funicular': return 'funicular';
    case 'cableway': return 'cableway';
    case 'car': return 'car';
    case 'bike': return 'bike';
    case 'ebike': return 'ebike';
    // A shared bike is a bike; the e-bike factor is applied leg by leg where the bike is known.
    case 'sharedBike': return 'bike';
    case 'walk': return 'walk';
  }
}

/** Emission factor for a leg mode, following `fallback` links for rows absent from the source. Null if none. */
export function co2Factor(mode: LegMode, hint?: { category?: string }): Co2Factor | null {
  let key: string | undefined = keyFor(mode, hint);
  for (let hops = 0; key !== undefined && hops < 3; hops++) {
    const e: Entry | undefined = FACTORS[key];
    if (!e) return null;
    if (e.value !== null) return { gPerKm: e.value, basis: e.basis, key };
    key = e.fallback;
  }
  return null;
}

/**
 * Annual kg CO2-eq. `kmByMode` is km per one-way trip; `tripsPerYear` counts one-way trips.
 * Modes without a factor contribute nothing. `hint` applies to every rail leg.
 */
export function co2KgPerYear(
  kmByMode: Partial<Record<LegMode, number>>,
  tripsPerYear: number,
  hint?: { category?: string },
): number {
  let g = 0;
  for (const [mode, km] of Object.entries(kmByMode) as [LegMode, number | undefined][]) {
    if (km === undefined || !(km > 0)) continue;
    const f = co2Factor(mode, hint);
    if (f) g += f.gPerKm * km;
  }
  return (g * tripsPerYear) / 1000;
}
