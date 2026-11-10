import type { CommuteOption, LeftOut, OptionKind, RuleSet } from '../types.js';

/** One way of making the trip at one time: leave home, arrive (epoch ms), minutes door to door. */
export interface Conn {
  dep: number;
  arr: number;
  min: number;
  changes: number;
  /** The vehicles used (timetable runs), to recognise the same train reached another way. */
  vehicles?: string[];
}

export type WithConns = CommuteOption & { _conns?: Conn[] };

/**
 * Who an option competes with. Needing a car or a bike never hides public transport, because
 * not everyone has one: public transport is compared with public transport (and walking),
 * a drive or ride to the station with those and with its own kind.
 */
const COMPETES_WITH: Partial<Record<OptionKind, OptionKind[]>> = {
  transit: ['transit', 'walk'],
  parkRail: ['transit', 'walk', 'parkRail', 'cityParkRide'],
  cityParkRide: ['transit', 'walk', 'parkRail', 'cityParkRide'],
  bikeRide: ['transit', 'walk', 'bikeRide'],
};

/** Arriving within this many minutes of each other is arriving at the same time. */
const SAME_ARRIVAL_MIN = 5;
/** A connection with one more change is kept only when it saves more than this many minutes. */
const CHANGE_WORTH_MIN = 5;
/** Differences below this are noise, not a reason to keep two options apart. */
const SAME_MINUTES = 2;

/**
 * Connection `a` of an option costing `aYearly` makes connection `b` pointless: no more changes,
 * no dearer, and either it arrives at about the same time without taking longer, or it leaves
 * no earlier and arrives no later.
 */
export function covers(a: Conn, aYearly: number, b: Conn, bYearly: number): boolean {
  if (a.changes > b.changes || aYearly > bYearly) return false;
  const tol = SAME_MINUTES * 60000;
  // One change more has to save real time to count as another way of travelling.
  const slack = SAME_MINUTES + CHANGE_WORTH_MIN * (b.changes - a.changes);
  const sameArrival = Math.abs(a.arr - b.arr) <= SAME_ARRIVAL_MIN * 60000 && a.min <= b.min + slack;
  const inside = a.arr <= b.arr + tol && a.dep >= b.dep - tol;
  return sameArrival || inside;
}

/** An option without a timetable (walking) can be done at any time. */
function coversAnyTime(a: CommuteOption, b: Conn, bYearly: number): boolean {
  return a.changes <= b.changes && a.cost.yearly <= bYearly && a.durationMin <= b.min + SAME_MINUTES;
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

const best = (a: CommuteOption, b: CommuteOption) => a.cost.yearly - b.cost.yearly || a.changes - b.changes || a.durationMin - b.durationMin;

/**
 * Options are compared connection by connection, best first (cheapest, then fewest changes,
 * then fastest). An option stays when at least one of its connections is not made pointless by
 * a connection of an option already kept: it is then the only good way to travel at that time.
 * The car, walking and cycling all the way are never removed here.
 */
export function prune(options: CommuteOption[], leftOut: LeftOut[], rules: RuleSet): CommuteOption[] {
  const all = options as WithConns[];
  const kept: WithConns[] = all.filter((o) => !COMPETES_WITH[o.kind]);
  const timed = all.filter((o) => COMPETES_WITH[o.kind]);
  // Public transport first: the options that need a car or bike are judged against it.
  const order = [...timed.filter((o) => o.kind === 'transit').sort(best), ...timed.filter((o) => o.kind !== 'transit').sort(best)];

  for (const o of order) {
    const rivals = kept.filter((k) => COMPETES_WITH[o.kind]!.includes(k.kind));
    const conns = o._conns ?? [];
    let mostCovering: WithConns | undefined;
    let mostCount = 0;
    const coveredBy = new Map<WithConns, number>();
    const open = conns.filter((c) => {
      const by = rivals.find((r) => (r._conns ? r._conns.some((x) => covers(x, r.cost.yearly, c, o.cost.yearly)) : coversAnyTime(r, c, o.cost.yearly)));
      if (!by) return true;
      const n = (coveredBy.get(by) ?? 0) + 1;
      coveredBy.set(by, n);
      if (n > mostCount) [mostCovering, mostCount] = [by, n];
      return false;
    });
    if (conns.length > 0 && open.length === 0) leftOut.push(summary(o, 'dominated', mostCovering));
    else kept.push(o);
  }

  // Cap per kind, best first.
  const out: CommuteOption[] = [];
  const count = new Map<OptionKind, number>();
  const first = new Map<OptionKind, CommuteOption>();
  // Within a kind: the cheapest, then the fastest, then the rest best first.
  const fastestOf = new Map<OptionKind, WithConns>();
  for (const o of kept) if (!fastestOf.has(o.kind) || o.durationMin < fastestOf.get(o.kind)!.durationMin) fastestOf.set(o.kind, o);
  const rank = (o: WithConns) => (fastestOf.get(o.kind) === o ? 0 : 1);
  const capped = [...kept].sort((a, b) => (a.kind === b.kind ? rank(a) - rank(b) : 0));
  for (const o of capped) {
    const n = count.get(o.kind) ?? 0;
    if (n >= rules.maxOptionsPerKind) {
      leftOut.push(summary(o, 'overCap', first.get(o.kind)));
      continue;
    }
    if (n === 0) first.set(o.kind, o);
    count.set(o.kind, n + 1);
    out.push(o);
  }
  return out;
}
