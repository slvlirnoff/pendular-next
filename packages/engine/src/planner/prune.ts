import type { CommuteOption, LeftOut, OptionKind, RuleSet, TimeWindow } from '../types.js';
import { windowToUtc } from '../time.js';

/**
 * Options compete only inside their access type: needing a car or a bike never hides public
 * transport, because not everyone has one.
 */
const ACCESS_TYPE: Record<OptionKind, string> = {
  transit: 'transit',
  parkRail: 'carAccess',
  cityParkRide: 'carAccess',
  bikeRide: 'bikeAccess',
  walk: 'walk',
  bike: 'bike',
  ebike: 'ebike',
  car: 'car',
};

type WithArrivals = CommuteOption & { _arrivals?: string[] };

function slices(o: WithArrivals, startMs: number, sliceMin: number): Set<number> {
  const out = new Set<number>();
  for (const a of o._arrivals ?? []) out.add(Math.floor((new Date(a).getTime() - startMs) / (sliceMin * 60000)));
  return out;
}

/** Differences below these are noise, not a reason to keep two options apart. */
const SAME_MINUTES = 2;
const SAME_CO2_SHARE = 0.05;

/**
 * `b` is at least as good as `a` on cost, time and CO₂ (within the noise margins), and better
 * on one of them or, when they tie, on changes and then on departures.
 */
function dominates(b: CommuteOption, a: CommuteOption): boolean {
  const co2Margin = Math.max(a.co2KgPerYear, b.co2KgPerYear) * SAME_CO2_SHARE;
  const le = b.cost.yearly <= a.cost.yearly && b.durationMin <= a.durationMin + SAME_MINUTES && b.co2KgPerYear <= a.co2KgPerYear + co2Margin;
  if (!le) return false;
  const lt = b.cost.yearly < a.cost.yearly || b.durationMin < a.durationMin - SAME_MINUTES || b.co2KgPerYear < a.co2KgPerYear - co2Margin;
  if (lt) return true;
  if (b.changes !== a.changes) return b.changes < a.changes;
  return (b.departuresInWindow ?? 0) > (a.departuresInWindow ?? 0);
}

function summary(o: CommuteOption, code: LeftOut['code'], against?: CommuteOption): LeftOut {
  return {
    kind: o.kind,
    title: o.access?.name ?? o.title,
    code,
    against: against?.title,
    delta: against
      ? {
          minutes: o.durationMin - against.durationMin,
          chfPerYear: o.cost.yearly - against.cost.yearly,
          co2KgPerYear: o.co2KgPerYear - against.co2KgPerYear,
        }
      : undefined,
    durationMin: o.durationMin,
    yearly: o.cost.yearly,
  };
}

export function prune(
  options: CommuteOption[],
  leftOut: LeftOut[],
  rules: RuleSet,
  window: TimeWindow,
  date: string,
): CommuteOption[] {
  const startMs = windowToUtc(date, window, rules.timezone).start.getTime();
  const byType = new Map<string, WithArrivals[]>();
  for (const o of options as WithArrivals[]) {
    const t = ACCESS_TYPE[o.kind];
    byType.set(t, [...(byType.get(t) ?? []), o]);
  }

  const kept: CommuteOption[] = [];
  for (const group of byType.values()) {
    const sliceOf = new Map(group.map((o) => [o.id, slices(o, startMs, rules.arrivalSliceMin)]));
    /** True when `o` arrives in a slice that no other option of `among` reaches. */
    const onlyWay = (o: WithArrivals, among: WithArrivals[]) =>
      [...(sliceOf.get(o.id) ?? [])].some((s) => !among.some((x) => x !== o && sliceOf.get(x.id)?.has(s)));

    // 1. Dominance, unless the option is the only way to arrive at some time.
    let alive = [...group];
    for (const o of [...group].sort((a, b) => b.cost.yearly - a.cost.yearly)) {
      const better = alive.find((x) => x !== o && dominates(x, o));
      if (better && !onlyWay(o, alive)) {
        alive = alive.filter((x) => x !== o);
        leftOut.push(summary(o, 'dominated', better));
      }
    }

    // 2. Cap per kind: keep the fastest, the cheapest, then by time; "only way" options stay.
    const byKind = new Map<OptionKind, WithArrivals[]>();
    for (const o of alive) byKind.set(o.kind, [...(byKind.get(o.kind) ?? []), o]);
    for (const list of byKind.values()) {
      if (list.length <= rules.maxOptionsPerKind) {
        kept.push(...list);
        continue;
      }
      const fastest = [...list].sort((a, b) => a.durationMin - b.durationMin);
      const cheapest = [...list].sort((a, b) => a.cost.yearly - b.cost.yearly)[0]!;
      const order = [cheapest, ...fastest.filter((o) => o !== cheapest)];
      const chosen: WithArrivals[] = [];
      for (const o of order) {
        if (chosen.length < rules.maxOptionsPerKind || onlyWay(o, [...chosen, o])) chosen.push(o);
        else leftOut.push(summary(o, 'overCap', chosen[0]));
      }
      kept.push(...chosen);
    }
  }
  return kept;
}
