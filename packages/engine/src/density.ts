import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Shape of data/density/density-1km.json (built by data/scripts/build-density.ts). */
export interface DensityFile {
  format: 'pendular-density/1';
  /** Side of one grid cell in metres (LV95). */
  cellM: number;
  /** LV95 coordinates of the south-west corner of cell (0, 0). */
  e0: number;
  n0: number;
  /** Cells per grid row; cell id = row * width + column. */
  width: number;
  /** Radius the sum is taken over, in metres. */
  radiusM: number;
  sources: { residents: { name: string; year: number }; jobs: { name: string; year: number } | null };
  /** Cell ids sorted ascending, stored as differences to the previous id (first one absolute). */
  key: number[];
  /** Residents and jobs per cell, same order as `key`. `jobs` is absent when there is no jobs data. */
  res: number[];
  jobs?: number[];
}

export interface DensityAround {
  /** People living within the radius (about 1 km). */
  residents: number;
  /** People working within the radius; null when the data file has no jobs. */
  jobs: number | null;
}

export interface DensityIndex {
  around(p: { lat: number; lon: number }): DensityAround;
  /** Same lookup for a point already in LV95. */
  aroundLv95(e: number, n: number): DensityAround;
  readonly file: Pick<DensityFile, 'cellM' | 'radiusM' | 'sources'> & { cells: number };
}

export type ParkingKind = 'cityCentre' | 'townCentre' | 'elsewhere';

export interface ParkingThresholds {
  /** What is compared with the limits: residents only, or residents plus jobs (needs jobs data). */
  measure: 'residents' | 'residentsAndJobs';
  cityCentre: { minDensity: number; minutes: number };
  townCentre: { minDensity: number; minutes: number };
  elsewhere: { minutes: number };
}

/** ASSUMPTIONS taken over from an earlier prototype, not measured. Change them here. */
export const DEFAULT_PARKING_THRESHOLDS: ParkingThresholds = {
  measure: 'residents',
  cityCentre: { minDensity: 20_000, minutes: 15 },
  townCentre: { minDensity: 8_000, minutes: 10 },
  elsewhere: { minutes: 5 },
};

/** Minutes to find a space and walk to the door, from how dense the area is. */
export function parkingAt(
  d: DensityAround,
  thresholds: ParkingThresholds = DEFAULT_PARKING_THRESHOLDS,
): { minutes: number; kind: ParkingKind } {
  // Without jobs data the combined measure falls back to residents.
  const density = thresholds.measure === 'residentsAndJobs' && d.jobs != null ? d.residents + d.jobs : d.residents;
  if (density >= thresholds.cityCentre.minDensity) return { minutes: thresholds.cityCentre.minutes, kind: 'cityCentre' };
  if (density >= thresholds.townCentre.minDensity) return { minutes: thresholds.townCentre.minutes, kind: 'townCentre' };
  return { minutes: thresholds.elsewhere.minutes, kind: 'elsewhere' };
}

/**
 * WGS84 degrees to Swiss LV95 (E, N) with the swisstopo approximate formulas
 * ("Näherungslösungen für die direkte Transformation", about 1 m accuracy).
 */
export function wgs84ToLv95(lat: number, lon: number): { e: number; n: number } {
  const p = (lat * 3600 - 169028.66) / 10000;
  const l = (lon * 3600 - 26782.5) / 10000;
  const e = 2600072.37 + 211455.93 * l - 10938.51 * l * p - 0.36 * l * p * p - 44.54 * l ** 3;
  const n = 1200147.07 + 308807.95 * p + 3745.25 * l * l + 76.63 * p * p - 194.56 * l * l * p + 119.79 * p ** 3;
  return { e, n };
}

const DEFAULT_PATH = fileURLToPath(new URL('../data/density/density-1km.json', import.meta.url));

export function loadDensity(path: string = DEFAULT_PATH): DensityIndex {
  return densityFromFile(JSON.parse(readFileSync(path, 'utf8')) as DensityFile);
}

export function densityFromFile(f: DensityFile): DensityIndex {
  if (f.format !== 'pendular-density/1') throw new Error(`unknown density format ${String(f.format)}`);
  const count = f.key.length;
  const ids = new Int32Array(count);
  let acc = 0;
  for (let i = 0; i < count; i++) {
    acc += f.key[i]!;
    ids[i] = acc;
  }
  const res = Int32Array.from(f.res);
  const jobs = f.jobs ? Int32Array.from(f.jobs) : null;
  const reach = Math.ceil(f.radiusM / f.cellM) + 1;
  const r2 = f.radiusM * f.radiusM;

  // First index with ids[i] >= v.
  const lower = (v: number): number => {
    let lo = 0;
    let hi = count;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (ids[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const aroundLv95 = (e: number, n: number): DensityAround => {
    const c0 = Math.floor((e - f.e0) / f.cellM);
    const r0 = Math.floor((n - f.n0) / f.cellM);
    let sr = 0;
    let sj = 0;
    for (let r = r0 - reach; r <= r0 + reach; r++) {
      if (r < 0) continue;
      const cn = f.n0 + (r + 0.5) * f.cellM;
      const dn = cn - n;
      const base = r * f.width;
      const cLo = Math.max(0, c0 - reach);
      const cHi = Math.min(f.width - 1, c0 + reach);
      for (let i = lower(base + cLo); i < count; i++) {
        const id = ids[i]!;
        const c = id - base;
        if (c > cHi) break;
        const de = f.e0 + (c + 0.5) * f.cellM - e;
        if (de * de + dn * dn > r2) continue;
        sr += res[i]!;
        if (jobs) sj += jobs[i]!;
      }
    }
    return { residents: sr, jobs: jobs ? sj : null };
  };

  return {
    aroundLv95,
    around: (p) => {
      const { e, n } = wgs84ToLv95(p.lat, p.lon);
      return aroundLv95(e, n);
    },
    file: { cellM: f.cellM, radiusM: f.radiusM, sources: f.sources, cells: count },
  };
}

/**
 * Limits on residents + jobs within 1 km, for places with few residents and many jobs (a
 * station district, a hospital, a campus). Assumptions, chosen so that Bern station
 * (18,000 residents, 85,000 jobs) counts as a city centre and EPFL (7,500 and 10,600) as a
 * town centre, without moving Aigle or Lucens.
 */
export const COMBINED_PARKING_THRESHOLDS: ParkingThresholds = {
  measure: 'residentsAndJobs',
  cityCentre: { minDensity: 60_000, minutes: 15 },
  townCentre: { minDensity: 15_000, minutes: 10 },
  elsewhere: { minutes: 5 },
};

/** The default rule: by residents, or by residents and jobs together, whichever says denser. */
export function parkingByDensity(d: DensityAround): { minutes: number; kind: ParkingKind } {
  const a = parkingAt(d);
  const b = parkingAt(d, COMBINED_PARKING_THRESHOLDS);
  return b.minutes > a.minutes ? b : a;
}
