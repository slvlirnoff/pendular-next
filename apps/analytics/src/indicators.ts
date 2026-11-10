import type { Indicators, RatioClass, ResultRow } from './types.js';

export interface Thresholds {
  goodPtRatio: number;
  goodPtMaxChanges: number;
  cyclingBikeMin: number;
  cyclingEbikeMin: number;
  noAlternativePtMin: number;
  noAlternativeRatio: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  goodPtRatio: 1.5,
  goodPtMaxChanges: 1,
  cyclingBikeMin: 20,
  cyclingEbikeMin: 30,
  noAlternativePtMin: 60,
  noAlternativeRatio: 2,
};

const MAX_PT_MIN = 90;
const OTHER_GROUP = 'other (small groups)';
const MISSING_VALUE = '–';

export function ratioClass(ptMin: number | null, carMin: number | null): RatioClass {
  if (ptMin === null || ptMin > MAX_PT_MIN) return 'noPt';
  if (carMin === null) return 'ptFaster';
  if (ptMin <= carMin) return 'ptFaster';
  if (ptMin <= carMin * 1.5) return 'upTo1_5';
  if (ptMin <= carMin * 2) return 'upTo2';
  return 'over2';
}

type Plain = Omit<Indicators, 'by'>;

const round = (n: number, d: number): number => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

function median(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = v.length >> 1;
  const m = v.length % 2 === 1 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
  return round(m, 1);
}

function plainIndicators(rows: ResultRow[], totalPeople: number, th: Thresholds): Plain {
  const ok = rows.filter((r) => !r.error);
  const n = ok.length;
  const share = (count: number): number => (n === 0 ? 0 : round(count / n, 4));
  const le = (v: number | null, limit: number): boolean => v !== null && v <= limit;

  const ratioCounts: Record<RatioClass, number> = { ptFaster: 0, upTo1_5: 0, upTo2: 0, over2: 0, noPt: 0 };
  const stops = new Map<string, number>();
  const seg = { goodPt: 0, cycling: 0, noAlternative: 0 };

  for (const r of ok) {
    ratioCounts[r.ratioClass]++;
    if (r.boardStop !== null) stops.set(r.boardStop, (stops.get(r.boardStop) ?? 0) + 1);

    const cycling = le(r.bikeMin, th.cyclingBikeMin) || le(r.ebikeMin, th.cyclingEbikeMin);
    // Unknown car time or unknown change count does not disqualify public transport.
    const goodPt =
      r.ptMin !== null &&
      (r.carMin === null || r.ptMin <= r.carMin * th.goodPtRatio) &&
      (r.ptChanges === null || r.ptChanges <= th.goodPtMaxChanges);
    const noPt =
      r.ptMin === null ||
      r.ptMin > th.noAlternativePtMin ||
      (r.carMin !== null && r.ptMin > r.carMin * th.noAlternativeRatio);
    if (goodPt) seg.goodPt++;
    if (cycling) seg.cycling++;
    if (noPt && !cycling) seg.noAlternative++;
  }

  const ratio = {} as Record<RatioClass, number>;
  for (const k of Object.keys(ratioCounts) as RatioClass[]) ratio[k] = share(ratioCounts[k]);

  return {
    people: totalPeople,
    analysed: n,
    ptWithin: {
      min30: share(ok.filter((r) => le(r.ptMin, 30)).length),
      min45: share(ok.filter((r) => le(r.ptMin, 45)).length),
      min60: share(ok.filter((r) => le(r.ptMin, 60)).length),
    },
    bikeWithin20: share(ok.filter((r) => le(r.bikeMin, 20)).length),
    ebikeWithin30: share(ok.filter((r) => le(r.ebikeMin, 30)).length),
    walkWithin20: share(ok.filter((r) => le(r.walkMin, 20)).length),
    ratio,
    median: {
      pt: median(ok.map((r) => r.ptMin)),
      car: median(ok.map((r) => r.carMin)),
      bike: median(ok.map((r) => r.bikeMin)),
      ebike: median(ok.map((r) => r.ebikeMin)),
    },
    boardStops: [...stops.entries()]
      .map(([name, people]) => ({ name, people }))
      .sort((a, b) => b.people - a.people || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .slice(0, 15),
    segments: seg,
  };
}

export function computeIndicators(
  rows: ResultRow[],
  totalPeople: number,
  opts: { thresholds?: Partial<Thresholds>; by?: string; minGroupSize?: number } = {},
): Indicators {
  const th: Thresholds = { ...DEFAULT_THRESHOLDS, ...opts.thresholds };
  const result: Indicators = plainIndicators(rows, totalPeople, th);
  const attribute = opts.by;
  if (attribute === undefined || attribute === '') return result;

  const minSize = opts.minGroupSize ?? 5;
  const buckets = new Map<string, ResultRow[]>();
  for (const r of rows) {
    const v = r.attrs[attribute];
    const key = v === undefined || v === '' ? MISSING_VALUE : v;
    const list = buckets.get(key);
    if (list) list.push(r);
    else buckets.set(key, [r]);
  }

  const big: [string, ResultRow[]][] = [];
  const small: ResultRow[] = [];
  for (const [key, list] of buckets) {
    if (list.length >= minSize) big.push([key, list]);
    else small.push(...list);
  }
  big.sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const groups = big.map(([value, list]) => ({ value, indicators: plainIndicators(list, list.length, th) }));
  // The merged group goes last. If even the merged group has fewer than minGroupSize people
  // it is left out, and its people are counted nowhere in `by`: no figure may describe
  // fewer people than the minimum.
  if (small.length >= minSize) {
    groups.push({ value: OTHER_GROUP, indicators: plainIndicators(small, small.length, th) });
  }
  result.by = { attribute, groups };
  return result;
}
