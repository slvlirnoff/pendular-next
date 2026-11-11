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

/** Driving to a station car park and to a city park-and-ride are one kind of access: their sites are compared with each other. */
const ACCESS_FAMILY: Partial<Record<OptionKind, string>> = { parkRail: 'car', cityParkRide: 'car', bikeRide: 'bike' };

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

/**
 * Inside one ticket: connection `a` of another route makes `b` add nothing when it leaves no
 * earlier, arrives no later and has no more changes. Nothing else: a slower route or one with a
 * change more is still a departure the holder of the ticket can take.
 */
export function coversStrictly(a: Conn, b: Conn): boolean {
  const tol = SAME_MINUTES * 60000;
  return a.changes <= b.changes && a.dep >= b.dep - tol && a.arr <= b.arr + tol;
}

/** The ticket an option belongs to; an option without one stands alone. */
export const ticketGroupOf = (o: CommuteOption): string => o.ticketGroup || `#${o.id}`;

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
 * Options are routes; routes that need the same ticket form a group (`ticketGroup`: same kind,
 * same access site, same fare), shown as one card.
 *
 * Between tickets, best first (cheapest, then fewest changes, then fastest): a ticket stays when
 * at least one connection of one of its routes is not made pointless by a connection of a ticket
 * already kept (`covers`): it is then the only good way to travel at that time. A dearer ticket
 * has to offer something.
 *
 * Inside a ticket that stays, routes do not compete on time or changes: a route is left out only
 * when every one of its connections is matched by a connection of another route of the ticket
 * that leaves no earlier, arrives no later and has no more changes (`coversStrictly`), so that
 * it adds no departure.
 *
 * Then the caps: `maxOptionsPerKind` tickets per kind (the one with the fastest route first,
 * then best first) and `maxRoutesPerTicket` routes per ticket (those that add most departures).
 * The car, walking and cycling all the way are never removed here.
 */
export function prune(options: CommuteOption[], leftOut: LeftOut[], rules: RuleSet): CommuteOption[] {
  const all = options as WithConns[];
  /** What is left out, with the option it is about: sorted out at the end. */
  const dropped: { o: WithConns; entry: LeftOut }[] = [];
  const drop = (o: WithConns, code: LeftOut['code'], against?: CommuteOption) => dropped.push({ o, entry: summary(o, code, against) });
  const untimed: WithConns[] = all.filter((o) => !COMPETES_WITH[o.kind]);
  const timed = all.filter((o) => COMPETES_WITH[o.kind]);

  // Tickets, best first by their best route; public transport before the options that need a
  // car or bike, which are judged against it.
  const byTicket = new Map<string, WithConns[]>();
  for (const o of timed) {
    const key = ticketGroupOf(o);
    const list = byTicket.get(key);
    if (list) list.push(o);
    else byTicket.set(key, [o]);
  }
  // --- Car parks and bike parks: what a site is shown with ------------------------------------
  // Every route from a site is a candidate, and a site can have several tickets (the bus and the
  // train from the same car park). Shown per site: its cheapest ticket and its fastest ticket,
  // nothing in between. And a site is not shown at all when another site of the same kind of
  // access (by car, by bike) has, for each of its tickets, a ticket that is no dearer and no
  // slower, parking and driving included, and better on one of the two: the far car park that
  // costs more and takes as long is not an alternative.
  const fastestMin = (routes: WithConns[]) => Math.min(...routes.map((o) => o.durationMin));
  const siteOf = (o: WithConns) => (o.access ? `${ACCESS_FAMILY[o.kind] ?? o.kind}|${o.access.id}` : undefined);
  const sites = new Map<string, WithConns[][]>();
  for (const routes of byTicket.values()) {
    const site = siteOf(routes[0]!);
    if (!site) continue;
    const l = sites.get(site);
    if (l) l.push(routes);
    else sites.set(site, [routes]);
  }
  const gone = new Set<WithConns[]>();
  for (const list of sites.values()) {
    if (list.length <= 2) continue;
    const cheapest = list.reduce((a, b) => (b[0]!.cost.yearly < a[0]!.cost.yearly || (b[0]!.cost.yearly === a[0]!.cost.yearly && fastestMin(b) < fastestMin(a)) ? b : a));
    const fastest = list.reduce((a, b) => (fastestMin(b) < fastestMin(a) || (fastestMin(b) === fastestMin(a) && b[0]!.cost.yearly < a[0]!.cost.yearly) ? b : a));
    for (const routes of list) {
      if (routes === cheapest || routes === fastest) continue;
      gone.add(routes);
      for (const o of routes) drop(o, 'overCap', cheapest[0]);
    }
    list.splice(0, list.length, ...list.filter((t) => !gone.has(t)));
  }
  const siteKeys = [...sites.keys()];
  const beaten = new Set<string>();
  for (const key of siteKeys) {
    const mine = sites.get(key)!;
    const family = key.slice(0, key.indexOf('|'));
    const by = siteKeys.find((other) => {
      if (other === key || beaten.has(other) || !other.startsWith(`${family}|`)) return false;
      const theirs = sites.get(other)!;
      // Two minutes are noise (`SAME_MINUTES`): a site that much faster is not faster.
      const noWorse = (s: WithConns[], t: WithConns[]) => t[0]!.cost.yearly <= s[0]!.cost.yearly && fastestMin(t) <= fastestMin(s) + SAME_MINUTES;
      const better = (s: WithConns[], t: WithConns[]) => t[0]!.cost.yearly < s[0]!.cost.yearly || fastestMin(t) < fastestMin(s) - SAME_MINUTES;
      return mine.every((s) => theirs.some((t) => noWorse(s, t) && better(s, t)));
    });
    if (!by) continue;
    beaten.add(key);
    const against = sites.get(by)![0]!.reduce((a, b) => (b.durationMin < a.durationMin ? b : a));
    for (const routes of mine) {
      gone.add(routes);
      for (const o of routes) drop(o, 'dominated', against);
    }
  }
  for (const [key, routes] of [...byTicket]) if (gone.has(routes)) byTicket.delete(key);

  const tickets = [...byTicket.values()].map((routes) => routes.sort(best));
  const order = [...tickets.filter((t) => t[0]!.kind === 'transit').sort((a, b) => best(a[0]!, b[0]!)), ...tickets.filter((t) => t[0]!.kind !== 'transit').sort((a, b) => best(a[0]!, b[0]!))];

  /** Routes kept so far, of other tickets, and the tickets kept, in order. */
  const kept: WithConns[] = [...untimed];
  const keptTickets: WithConns[][] = [];
  for (const routes of order) {
    const kind = routes[0]!.kind;
    const rivals = kept.filter((k) => COMPETES_WITH[kind]!.includes(k.kind));
    // Against the other tickets: does any connection of the ticket offer something?
    let offers = false;
    const beatenBy = new Map<WithConns, WithConns | undefined>();
    for (const o of routes) {
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
      if (conns.length === 0 || open.length > 0) offers = true;
      beatenBy.set(o, mostCovering);
    }
    if (!offers) {
      for (const o of routes) drop(o, 'dominated', beatenBy.get(o));
      continue;
    }
    // Inside the ticket: a route stays unless other routes of it serve all its departures.
    const stay: WithConns[] = [];
    for (const o of routes) {
      const conns = o._conns ?? [];
      const coveredBy = new Map<WithConns, number>();
      const adds = conns.filter((c) => {
        const by = stay.find((r) => r._conns?.some((x) => coversStrictly(x, c)));
        if (by) coveredBy.set(by, (coveredBy.get(by) ?? 0) + 1);
        return !by;
      });
      if (conns.length > 0 && adds.length === 0) drop(o, 'nearDuplicate', [...coveredBy.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]);
      else stay.push(o);
    }
    // Most routes of a ticket: those whose departures the others of the ticket do not serve.
    const maxRoutes = routes[0]!.access ? Math.min(rules.maxRoutesPerTicket, rules.maxRoutesPerAccessTicket ?? rules.maxRoutesPerTicket) : rules.maxRoutesPerTicket;
    if (stay.length > maxRoutes) {
      const adds = (o: WithConns) => (o._conns ?? []).filter((c) => !stay.some((r) => r !== o && r._conns?.some((x) => coversStrictly(x, c)))).length;
      const ranked = stay.map((o, i) => ({ o, i, n: adds(o) })).sort((a, b) => b.n - a.n || a.i - b.i);
      const out = new Set(ranked.slice(maxRoutes).map((x) => x.o));
      for (const o of stay) if (out.has(o)) drop(o, 'overCap', ranked[0]!.o);
      stay.splice(0, stay.length, ...stay.filter((o) => !out.has(o)));
    }
    kept.push(...stay);
    keptTickets.push(stay);
  }

  // Cap the tickets per kind: the one with the fastest route, then the rest best first.
  const fastestOf = new Map<OptionKind, WithConns>();
  for (const o of keptTickets.flat()) if (!fastestOf.has(o.kind) || o.durationMin < fastestOf.get(o.kind)!.durationMin) fastestOf.set(o.kind, o);
  const rank = (t: WithConns[]) => (t.includes(fastestOf.get(t[0]!.kind)!) ? 0 : 1);
  const capped = keptTickets.map((t, i) => ({ t, i })).sort((a, b) => (a.t[0]!.kind === b.t[0]!.kind ? rank(a.t) - rank(b.t) || a.i - b.i : a.i - b.i));
  const out: CommuteOption[] = [...untimed];
  const count = new Map<OptionKind, number>();
  const first = new Map<OptionKind, CommuteOption>();
  for (const { t } of capped) {
    const kind = t[0]!.kind;
    const n = count.get(kind) ?? 0;
    if (n >= rules.maxOptionsPerKind) {
      for (const o of t) drop(o, 'overCap', first.get(kind));
      continue;
    }
    // The fastest route of the ticket first.
    const lead = fastestOf.get(kind);
    const routes = lead && t.includes(lead) ? [lead, ...t.filter((o) => o !== lead)] : t;
    if (n === 0) first.set(kind, routes[0]!);
    count.set(kind, n + 1);
    out.push(...routes);
  }
  // A route from a car park or bike park is listed under the name of the site: a site is named
  // once, by its best route, and not at all when another of its routes is shown.
  const named = new Set<string>();
  for (const { o, entry } of dropped) {
    if (o.access) {
      const site = `${o.kind}|${o.access.id}`;
      if (named.has(site) || out.some((x) => x.kind === o.kind && x.access?.id === o.access!.id)) continue;
      named.add(site);
    }
    leftOut.push(entry);
  }
  return out;
}
