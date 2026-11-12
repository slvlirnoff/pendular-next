import { useEffect, useMemo, useRef, useState } from 'react';
import type { Itinerary, Leg, Place } from '@pendular/engine/types';
import { TRANSIT_MODES } from '@pendular/engine/types';
import { useI18n } from '../i18n/index.js';
import { fetchConnections, type ConnectionsQuery } from '../lib/api.js';
import { chf, duration, hhmm } from '../lib/format.js';
import { changeStopsOf, optionName } from '../lib/names.js';
import { afterPaint, reveal } from '../lib/motion.js';
import type { TicketGroup } from '../lib/groups.js';
import { ModeChain } from './ModeChain.js';
import { MapPanel } from './MapPanel.js';
import { headTicket, Timeline } from './OptionList.js';

type Direction = 'out' | 'back';
/** Minutes of the day shown at once; "earlier" and "later" move by as much. */
const SPAN = 180;
const DAY = 24 * 60;
const clock = (min: number) => `${String(Math.floor((((min % DAY) + DAY) % DAY) / 60)).padStart(2, '0')}:${String((((min % DAY) + DAY) % DAY) % 60).padStart(2, '0')}`;
const minutes = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));
const ms = (iso: string) => new Date(iso).getTime();
const iso = (t: number) => new Date(t).toISOString();
const ZONE_PASSES = new Set(['zonePassYearly', 'zonePassMonthly', 'flexiPass']);

/** How the timetable is held to the ticket of a card: its zones, else the two ends of its main vehicle. */
function restriction(group: TicketGroup): Pick<ConnectionsQuery, 'zones' | 'via'> {
  const route = group.routes[0]!;
  const ticket = route.cost.products[0];
  if (ticket && ZONE_PASSES.has(ticket.kind) && ticket.alliance && ticket.zones?.length) return { zones: { alliance: ticket.alliance, zones: ticket.zones } };
  if (ticket?.allZones) return {};
  const legs = route.itinerary.legs.filter((l) => TRANSIT_MODES.includes(l.mode));
  // The route of a pass priced by distance: where its main vehicle (the longest ride) is boarded and left.
  const main = legs.length ? legs.reduce((x, y) => (y.durationMin > x.durationMin ? y : x)) : undefined;
  return main?.from.stopId && main.to.stopId ? { via: [main.from.stopId, main.to.stopId] } : {};
}

/**
 * The drive or ride between home and the car park, added to a connection found from the car
 * park: before it on the way to work, after it on the way home, with the same margin to park.
 */
function withAccess(it: Itinerary, typical: Itinerary, dir: Direction): Itinerary {
  const access = typical.legs[0]!;
  const lead = ms(typical.legs[1]?.departure ?? access.arrival) - ms(access.departure);
  const ride = ms(access.arrival) - ms(access.departure);
  let leg: Leg;
  if (dir === 'out') {
    const dep = ms(it.departure) - lead;
    leg = { ...access, departure: iso(dep), arrival: iso(dep + ride) };
  } else {
    const dep = ms(it.arrival) + (lead - ride);
    leg = { ...access, from: access.to, to: access.from, departure: iso(dep), arrival: iso(dep + ride), geometry: access.geometry ? [...access.geometry].reverse() : undefined };
  }
  const legs = dir === 'out' ? [leg, ...it.legs] : [...it.legs, leg];
  const departure = legs[0]!.departure;
  const arrival = legs[legs.length - 1]!.arrival;
  return { ...it, legs, departure, arrival, durationMin: Math.round((ms(arrival) - ms(departure)) / 60000) };
}

/**
 * The timetable behind a card: every connection the ticket allows, to work and back home, with
 * the chosen one on a large map.
 */
export function Planner(props: { group: TicketGroup; home: Place; work: Place; arrival: { from: string; to: string }; onClose: () => void }) {
  const { t, lang } = useI18n();
  const { group, home, work } = props;
  const route = group.routes[0]!;
  const ticket = (group.routes.find((o) => o.cost.yearly === group.yearly) ?? route).cost.products[0];
  const access = route.access;
  const rest = useMemo(() => restriction(group), [group]);
  const [dir, setDir] = useState<Direction>('out');
  // Where each direction's period starts, minutes of the day: around the arrival asked for, and the late afternoon.
  const [start, setStart] = useState<Record<Direction, number>>(() => ({ out: Math.max(0, minutes(props.arrival.from) - 60), back: 16 * 60 }));
  const [found, setFound] = useState<{ status: 'loading' | 'done' | 'error'; its: Itinerary[]; within: 'zones' | 'route' | 'none' }>({ status: 'loading', its: [], within: 'none' });
  const [chosen, setChosen] = useState<number | null>(null);
  const from = start[dir];

  useEffect(() => {
    const ctl = new AbortController();
    setFound((f) => ({ ...f, status: 'loading' }));
    setChosen(null);
    fetchConnections(
      { from: access ? { label: access.name, lat: access.lat, lon: access.lon } : home, to: work, direction: dir, window: { from: clock(from), to: clock(from + SPAN) }, ...rest },
      ctl.signal,
    )
      .then((r) => {
        const its = access ? r.itineraries.map((it) => withAccess(it, route.itinerary, dir)) : r.itineraries;
        setFound({ status: 'done', its, within: r.within });
        setChosen(its.length ? 0 : null);
      })
      .catch((e: unknown) => {
        if ((e as Error).name !== 'AbortError') setFound({ status: 'error', its: [], within: 'none' });
      });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, from, group.key]);

  const list = useRef<HTMLOListElement>(null);
  // Opening a connection closes the one above it: the row chosen stays in view.
  const choose = (i: number | null) => {
    setChosen(i);
    if (i !== null) afterPaint(() => reveal(list.current?.children[i]));
  };
  const move = (by: number) => setStart((s) => ({ ...s, [dir]: Math.min(DAY - SPAN + 120, Math.max(0, s[dir] + by)) }));
  const shown = chosen !== null ? found.its[chosen] : undefined;
  const trips = useMemo(() => (shown ? [{ id: 'chosen', itinerary: shown }] : []), [shown]);
  const period = t(dir === 'out' ? 'planner.arrive' : 'planner.leave', { from: clock(from), to: clock(from + SPAN) });

  return (
    <section className="planner" aria-labelledby="planner-h">
      <header className="planner-head">
        <button type="button" className="link-button" onClick={props.onClose}>
          ← {t('planner.close')}
        </button>
        <div className="planner-ticket">
          <div>
            <h2 id="planner-h" tabIndex={-1}>
              {route.kind === 'transit' ? t('kind.transit') : optionName(route, t)}
              {ticket && <span className="planner-ticket-name"> · {headTicket(ticket, t)}</span>}
            </h2>
            <p>
              {home.label} ⇄ {work.label}
            </p>
          </div>
          <p className="planner-price">
            {chf(group.yearly, lang)} <small>{t('verdict.perYear')}</small>
          </p>
        </div>
      </header>

      <div className="planner-body">
        <div className="planner-list">
          <div className="segmented" role="group" aria-label={t('planner.direction')}>
            {(['out', 'back'] as const).map((d) => (
              <button key={d} type="button" aria-pressed={dir === d} className={dir === d ? 'is-on' : undefined} onClick={() => setDir(d)}>
                {t(`planner.${d}`)}
              </button>
            ))}
          </div>
          <div className="planner-period">
            <button type="button" className="link-button" onClick={() => move(-SPAN)} disabled={from <= 0}>
              ‹ {t('planner.earlier')}
            </button>
            <span>{period}</span>
            <button type="button" className="link-button" onClick={() => move(SPAN)} disabled={from >= DAY - SPAN + 120}>
              {t('planner.later')} ›
            </button>
          </div>
          <p className="planner-within">{t(`planner.within.${found.within}`)}</p>
          <div role="status" aria-live="polite">
            {found.status === 'loading' && <p className="hint is-busy">{t('planner.loading')}</p>}
            {found.status === 'error' && <p className="hint is-error">{t('state.error')}</p>}
            {found.status === 'done' && found.its.length === 0 && <p className="hint">{t('planner.none')}</p>}
          </div>
          {found.status !== 'error' && found.its.length > 0 && (
            <ol ref={list} className={found.status === 'loading' ? 'connections is-stale' : 'connections'}>
              {found.its.map((it, i) => {
                const via = changeStopsOf(it.legs);
                const lines = it.legs.filter((l) => l.mode !== 'walk');
                const on = i === chosen;
                return (
                  <li key={`${it.departure}-${it.arrival}-${i}`} className={on ? 'is-on' : undefined}>
                    <button type="button" aria-expanded={on} onClick={() => choose(on ? null : i)}>
                      <span className="conn-times">
                        <strong>{hhmm(it.departure)}</strong> → {hhmm(it.arrival)}
                      </span>
                      <span className="conn-facts">
                        {duration(it.durationMin)} · {it.changes === 0 ? t('opt.direct') : t('opt.changes', { n: it.changes })}
                      </span>
                      <span className="conn-route">
                        <ModeChain legs={lines.length ? lines : it.legs} />
                        {via.length > 0 && <span className="dep-via">{t('overview.via', { via: via.join(', ') })}</span>}
                      </span>
                    </button>
                    {on && <Timeline legs={it.legs} />}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        <div className="planner-map">
          <MapPanel home={home} work={work} options={trips} selected={shown ? 'chosen' : null} />
        </div>
      </div>
    </section>
  );
}
