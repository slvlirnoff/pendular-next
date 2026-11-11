import type { CommuteOption } from '@pendular/engine/types';

/** The routes that need the same ticket: one card in the list. */
export interface TicketGroup {
  key: string;
  /** False for a way without a ticket (car, walk, bike): always a single route. */
  ticketed: boolean;
  /** Fewest changes first, then fastest. */
  routes: CommuteOption[];
  /** Ticket and other costs of the cheapest route. */
  yearly: number;
  minDuration: number;
  maxDuration: number;
  minChanges: number;
  maxChanges: number;
  departures: number;
}

/** Same kind, same access site, same ticket. The engine's own key wins where it gives one. */
export function groupKey(o: CommuteOption): string {
  const own = (o as CommuteOption & { ticketGroup?: string }).ticketGroup;
  if (own) return own;
  return o.fareKey ? `${o.kind}|${o.access?.id ?? ''}|${o.fareKey}` : `single|${o.id}`;
}

const byRoute = (a: CommuteOption, b: CommuteOption) => a.changes - b.changes || a.durationMin - b.durationMin;

export function ticketGroups(options: CommuteOption[]): TicketGroup[] {
  const byKey = new Map<string, CommuteOption[]>();
  for (const o of options) {
    const key = groupKey(o);
    byKey.set(key, [...(byKey.get(key) ?? []), o]);
  }
  return [...byKey].map(([key, list]) => {
    const routes = [...list].sort(byRoute);
    const durations = routes.map((o) => o.durationMin);
    const changes = routes.map((o) => o.changes);
    return {
      key,
      ticketed: routes.some((o) => !!o.fareKey),
      routes,
      yearly: Math.min(...routes.map((o) => o.cost.yearly)),
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      minChanges: Math.min(...changes),
      maxChanges: Math.max(...changes),
      departures: routes.reduce((n, o) => n + (o.connections?.length ?? 0), 0),
    };
  });
}

/** The route a group stands for: the selected one when it is in the group, else the best one. */
export function groupRoute(g: TicketGroup, selected: string | null): CommuteOption {
  return g.routes.find((o) => o.id === selected) ?? g.routes[0]!;
}

/** A group sorts by its best route for the key. */
export const groupBest = (g: TicketGroup, f: (o: CommuteOption) => number) => Math.min(...g.routes.map(f));

/** Evening order of "HH:MM": a departure after midnight (before 04:00) is later than one at 23:50. */
const evening = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return (h < 4 ? h + 24 : h) * 60 + m;
};

/** The last trip home of the group: the latest among its routes. Null when no route has one. */
export function lastReturn(g: TicketGroup): NonNullable<CommuteOption['returnTrips']> | null {
  let best: NonNullable<CommuteOption['returnTrips']> | null = null;
  for (const o of g.routes) {
    if (o.returnTrips && (!best || evening(o.returnTrips.last) > evening(best.last))) best = o.returnTrips;
  }
  return best;
}

/** A last departure before 19:30 is worth a warning; one after midnight is a late one. */
export const isEarlyReturn = (r: { last: string }) => r.last >= '04:00' && r.last < '19:30';

/** Every departure of the group in time order, each with its route. */
export function groupDepartures(g: TicketGroup) {
  return g.routes
    .flatMap((route) => (route.connections ?? []).map((c) => ({ ...c, route })))
    .sort((a, b) => a.departure.localeCompare(b.departure) || a.arrival.localeCompare(b.arrival));
}
