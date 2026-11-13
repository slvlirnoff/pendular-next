import { forwardRef, useEffect, useState } from 'react';
import type { DeparturesResponse, DetailMode, PlaceDetail, PlaceSummary, RoutesResponse, Target, TransitOption, WeekHours } from '../../../src/api';
import { FOOD_BY_KEY } from '../../../src/foods';
import { api, clock, DEPARTURE_EMOJI, distance, kindLabel, legEmoji, MODE, minutes, openLabel, placeEmoji, placeName } from '../lib';
import { LOCALE, t } from '../i18n';

const YES = new Set(['yes', 'only', 'designated']);
const SOURCE_NAMES: Record<string, string> = { osm: 'OpenStreetMap', atp: 'All The Places', overture: 'Overture Maps', gbfs: 'sharedmobility.ch' };

/** A stop's next departures, asked again every minute. */
function Departures(props: { stopId: string }) {
  const [board, setBoard] = useState<DeparturesResponse | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const ctl = new AbortController();
    const load = () =>
      api
        .departures(props.stopId, ctl.signal)
        .then((b) => {
          setBoard(b);
          setFailed(false);
        })
        .catch((e: Error) => {
          if (e.name !== 'AbortError') setFailed(true);
        });
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      clearInterval(t);
      ctl.abort();
    };
  }, [props.stopId]);
  if (failed) return <p className="way-loading">{t('board.failed')}</p>;
  if (!board) return <p className="way-loading">{t('board.loading')}</p>;
  if (board.departures.length === 0) return <p className="way-loading">{t('board.none')}</p>;
  return (
    <div className="board">
      <h3 className="board-title">{t('board.title')}</h3>
      <ol className="departures-board">
        {board.departures.map((d, i) => (
          <li key={`${d.time}-${d.line}-${i}`} className={`dep${d.cancelled ? ' is-cancelled' : ''}`}>
            <span className="dep-time">
              {d.time}
              {d.delayMin ? <small className="dep-delay"> +{d.delayMin}</small> : null}
            </span>
            <span className={`dep-line dep-${d.mode}`}>
              <span aria-hidden="true">{DEPARTURE_EMOJI[d.mode]}</span> {d.line || '—'}
            </span>
            <span className="dep-dir">
              {d.direction}
              <small>
                {d.track ? `${t('board.track', { n: d.track })} · ` : ''}
                {d.cancelled ? t('board.cancelled') : d.minutes < 1 ? t('board.now') : t('board.in', { min: minutes(d.minutes) })}
              </small>
            </span>
          </li>
        ))}
      </ol>
      {board.typicalTimetable ? <p className="results-note">🚆 {t('note.typical')}</p> : null}
    </div>
  );
}

/** A picture from elsewhere (Wikimedia Commons, a shop's site): gone without a trace when it does not load. */
function Picture(props: { src: string; className: string; alt?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <img className={props.className} src={props.src} alt={props.alt ?? ''} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

const DAY_FMT = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', timeZone: 'UTC' });
/** Short day name, 1 Monday … 7 Sunday (1 January 2024 was a Monday). */
const dayName = (weekday: number) => DAY_FMT.format(new Date(Date.UTC(2024, 0, weekday)));

/** One day's opening times as text: "08:00–12:00, 13:30–18:30", "24 h/24", "Fermé". */
function dayText(d: WeekHours['days'][number]): string {
  if (d.intervals.length === 0) return t('hours.closed');
  if (d.intervals.length === 1 && d.intervals[0]!.from === '00:00' && d.intervals[0]!.to === '24:00') return t('hours.allDay');
  const times = d.intervals.map((i) => `${i.from}–${i.to}${i.unknown ? ' ?' : ''}`).join(', ');
  // The server says the usual comments in French ("sur rendez-vous").
  const comments = [...new Set(d.intervals.map((i) => (i.comment === 'sur rendez-vous' ? t('hours.appointment') : i.comment)).filter(Boolean))];
  return comments.length ? `${times} (${comments.join(', ')})` : times;
}

/** The week, Monday first, days with the same hours on one line ("lun.–ven."), today's line marked. */
function Hours(props: { hours: WeekHours }) {
  const today = props.hours.days[0]!.weekday;
  const byDay = [...props.hours.days].sort((a, b) => a.weekday - b.weekday);
  const rows: { from: number; to: number; text: string }[] = [];
  for (const d of byDay) {
    const text = dayText(d);
    const last = rows[rows.length - 1];
    if (last && last.text === text && last.to === d.weekday - 1) last.to = d.weekday;
    else rows.push({ from: d.weekday, to: d.weekday, text });
  }
  const everyDay = rows.length === 1;
  return (
    <>
      <table className="hours-table">
        <tbody>
          {rows.map((row) => (
            <tr key={row.from} className={`${today >= row.from && today <= row.to ? 'is-today' : ''}${row.text === t('hours.closed') ? ' is-closed' : ''}`}>
              <th scope="row">{everyDay ? t('hours.everyDay') : row.from === row.to ? dayName(row.from) : `${dayName(row.from)}–${dayName(row.to)}`}</th>
              <td>{row.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!props.hours.stable ? <p className="hours-note">{t('hours.week')}</p> : null}
    </>
  );
}

const webUrl = (v: string) => (/^https?:/i.test(v) ? v : `https://${v}`);
const socialUrl = (site: 'instagram' | 'facebook', v: string) => (/^https?:/i.test(v) ? v : `https://www.${site}.com/${v.replace(/^@/, '')}`);

/** Calling, writing, the site, social pages, sharing: one tap each. */
function Actions(props: { place: PlaceDetail }) {
  const p = props.place;
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const data = { title: placeName(p), url: window.location.href };
    try {
      if (navigator.share) await navigator.share(data);
      else {
        await navigator.clipboard.writeText(data.url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      // Cancelled.
    }
  };
  const links: { key: string; href: string; icon: string; label: string; external?: boolean }[] = [];
  if (p.phone) links.push({ key: 'tel', href: `tel:${p.phone.replace(/[^+\d]/g, '')}`, icon: '📞', label: t('act.call') });
  if (p.website) links.push({ key: 'web', href: webUrl(p.website), icon: '🌐', label: t('act.web'), external: true });
  if (p.extra?.email) links.push({ key: 'mail', href: `mailto:${p.extra.email}`, icon: '✉️', label: t('act.mail') });
  if (p.extra?.instagram) links.push({ key: 'ig', href: socialUrl('instagram', p.extra.instagram), icon: '📸', label: 'Instagram', external: true });
  if (p.extra?.facebook) links.push({ key: 'fb', href: socialUrl('facebook', p.extra.facebook), icon: '👍', label: 'Facebook', external: true });
  return (
    <div className="actions">
      {links.map((l) => (
        <a key={l.key} className="action" href={l.href} {...(l.external ? { target: '_blank', rel: 'noreferrer' } : {})}>
          <span aria-hidden="true">{l.icon}</span>
          {l.label}
        </a>
      ))}
      <button type="button" className="action" onClick={share}>
        <span aria-hidden="true">↗</span>
        {copied ? t('act.copied') : t('act.share')}
      </button>
    </div>
  );
}

/** Car sharing: walk to the station, drive (traffic and parking in), and the car goes back to its station. */
function Sharing(props: { option: NonNullable<RoutesResponse['sharing']> }) {
  const { station, walk, drive } = props.option;
  const parts = drive.car;
  return (
    <div className="way-sharing">
      <p className="way-street">
        🔑 {t('sharing.way', { min: minutes(props.option.durationMin), dist: distance(drive.distanceM) })}
      </p>
      <ol className="legs">
        <li className="leg leg-walk">
          <span className="leg-icon" aria-hidden="true">
            🚶
          </span>
          <span className="leg-text">
            {t('sharing.walk', { min: minutes(walk.durationMin), name: station.name })}
            <br />
            <small>{station.cars === null ? t('sharing.unknown') : station.cars > 0 ? t(station.cars > 1 ? 'sharing.many' : 'sharing.one', { n: station.cars }) : t('sharing.none')}</small>
          </span>
        </li>
        <li className="leg leg-ride leg-sharing">
          <span className="leg-icon" aria-hidden="true">
            🚗
          </span>
          <span className="leg-text">
            {t('way.drive', { min: parts ? minutes(parts.drivingMin) : minutes(drive.durationMin) })}
            {parts && parts.factor > 1.04 ? t('sharing.trafficShort', { f: parts.factor.toLocaleString(LOCALE) }) : ''}
            {parts ? (
              <>
                <br />
                <small>{t('way.park', { n: parts.parkingMin })}</small>
              </>
            ) : null}
          </span>
        </li>
      </ol>
      <p className="results-note">
        {t('sharing.back')}{' '}
        {station.website ? (
          <a href={station.website} target="_blank" rel="noreferrer">
            {t('sharing.book', { brand: station.brand ?? t('sharing.provider') })}
          </a>
        ) : null}
      </p>
    </div>
  );
}

/** One restaurant: how to get there (tabs per mode) and what is known about it. */
export const Detail = forwardRef<
  HTMLElement,
  {
    summary: PlaceSummary;
    /** What was searched for: the food searched for gives the pictogram. */
    target: Target | null;
    routes: RoutesResponse | null;
    loading: boolean;
    error: boolean;
    mode: DetailMode;
    departure: number;
    onMode: (m: DetailMode) => void;
    onDeparture: (i: number) => void;
    onBack: () => void;
    /** A public transport stop: its departure board. */
    stopId?: string | null;
  }
>(function Detail(props, ref) {
  // An address or a stop (id 0) keeps the head the app gave it (a stop: "Lucens, gare", Gare).
  const r = props.summary.id === 0 ? props.summary : (props.routes?.place ?? props.summary);
  const detail = props.routes?.place;
  const open = openLabel(r.open);
  const foods = r.foods.map((k) => FOOD_BY_KEY.get(k)).filter((f) => f && !f.generic);
  const times: Record<DetailMode, number | null> = {
    walk: props.routes?.walk?.durationMin ?? null,
    bike: props.routes?.bike?.durationMin ?? null,
    transit: props.routes?.transit[0]?.durationMin ?? null,
    car: props.routes?.car?.durationMin ?? null,
    sharing: props.routes?.sharing?.durationMin ?? null,
  };
  // The bike within 25 km; car sharing only when a station with cars is near.
  const modes: DetailMode[] = (['walk', 'bike', 'transit', 'car', 'sharing'] as DetailMode[]).filter(
    (m) => m === 'walk' || m === 'transit' || m === 'car' || (m === 'bike' ? props.loading || Boolean(props.routes?.bike) : Boolean(props.routes?.sharing)),
  );
  const extras = detail
    ? [
        YES.has(detail.takeaway ?? '') && `🥡 ${t('extra.takeaway')}`,
        YES.has(detail.delivery ?? '') && `🛵 ${t('extra.delivery')}`,
        YES.has(detail.outdoorSeating ?? '') && `☀️ ${t('extra.terrace')}`,
        YES.has(detail.vegetarian ?? '') && `🌱 ${t('extra.vegetarian')}`,
        YES.has(detail.vegan ?? '') && `🌿 ${t('extra.vegan')}`,
        detail.wheelchair === 'yes' && `♿ ${t('extra.wheelchair')}`,
      ].filter((x): x is string => Boolean(x))
    : [];

  return (
    <section ref={ref} className="panel panel-detail" aria-label={placeName(r)}>
      <div className={`card detail${detail?.extra?.image ? ' has-hero' : ''}`}>
        {detail?.extra?.image ? <Picture className="hero" src={detail.extra.image} /> : null}
        <div className="detail-head">
          <button type="button" className="back" onClick={props.onBack} aria-label={t('back')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <span className="emoji-dot emoji-big" aria-hidden="true">
            {detail?.extra?.logo ? <Picture className="logo" src={detail.extra.logo} /> : null}
            <span className="emoji-fallback">{placeEmoji(r, props.target)}</span>
          </span>
          <div className="detail-title">
            <h2>{placeName(r)}</h2>
            <p>
              {kindLabel(r)}
              {r.brand && !r.name.toLowerCase().includes(r.brand.toLowerCase()) ? ` ${r.brand}` : ''}
              {r.town ? ` · ${r.town}` : ''} · {distance(r.distanceM)}
            </p>
          </div>
        </div>

        {open || foods.length ? (
          <div className="tags">
            {open ? <span className={`open open-${open.tone}`}>{open.text}</span> : null}
            {foods.map((f) => (
              <span key={f!.key} className="tag">
                {f!.emoji} {f!.label}
              </span>
            ))}
          </div>
        ) : null}

        {detail ? <Actions place={detail} /> : null}

        {props.stopId ? <Departures stopId={props.stopId} /> : null}

        <div className={`modes modes-${modes.length}`} role="tablist" aria-label={t('howToGo')}>
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={props.mode === m}
              className={`mode-tab mode-${m}${props.mode === m ? ' is-on' : ''}`}
              disabled={!props.loading && times[m] === null}
              onClick={() => props.onMode(m)}
            >
              <span className="mode-tab-emoji" aria-hidden="true">
                {MODE[m].emoji}
              </span>
              <span className="mode-tab-time">{props.loading ? '…' : times[m] !== null ? minutes(times[m]!) : '—'}</span>
              <span className="mode-tab-label">{MODE[m].label}</span>
            </button>
          ))}
        </div>

        <div className="way" role="tabpanel">
          {props.loading ? (
            <p className="way-loading">{t('way.loading')}</p>
          ) : props.error ? (
            <p className="way-loading">{t('way.error')}</p>
          ) : props.mode === 'transit' ? (
            <Transit options={props.routes?.transit ?? []} chosen={props.departure} onChoose={props.onDeparture} typical={props.routes?.typicalTimetable ?? false} destination={placeName(r)} />
          ) : props.mode === 'walk' ? (
            props.routes?.walk ? (
              <p className="way-street">
                🚶 {t('way.walk', { min: minutes(props.routes.walk.durationMin), dist: distance(props.routes.walk.distanceM) })}
              </p>
            ) : (
              <p className="way-street">{t('way.walkFar')}</p>
            )
          ) : props.mode === 'bike' ? (
            props.routes?.bike ? (
              <p className="way-street">
                🚲 {t('way.bike', { min: minutes(props.routes.bike.durationMin), dist: distance(props.routes.bike.distanceM) })}
              </p>
            ) : (
              <p className="way-street">{t('way.bikeFar')}</p>
            )
          ) : props.mode === 'sharing' && props.routes?.sharing ? (
            <Sharing option={props.routes.sharing} />
          ) : props.routes?.car ? (
            <p className="way-street">
              🚗 {t('way.car', { min: minutes(props.routes.car.durationMin), dist: distance(props.routes.car.distanceM) })}
              {props.routes.car.car ? (
                <small className="way-detail">
                  {t('way.drive', { min: minutes(props.routes.car.car.drivingMin) })}
                  {props.routes.car.car.factor > 1.04 ? t('way.traffic', { f: props.routes.car.car.factor.toLocaleString(LOCALE) }) : ''}{' '}
                  {t('way.park', { n: props.routes.car.car.parkingMin })}
                </small>
              ) : null}
            </p>
          ) : (
            <p className="way-street">{t('way.noCar')}</p>
          )}
        </div>

        {detail && (detail.address || detail.openingHours || detail.extra?.speciality || detail.extra?.description) ? (
          <div className="info">
            {detail.address ? (
              <div className="info-row">
                <span className="info-icon" aria-hidden="true">
                  📍
                </span>
                <div>
                  <span className="info-label">{t('info.address')}</span>
                  <p>{detail.address}</p>
                </div>
              </div>
            ) : null}
            {detail.openingHours ? (
              <div className="info-row">
                <span className="info-icon" aria-hidden="true">
                  🕐
                </span>
                <div>
                  <span className="info-label">{t('info.hours')}</span>
                  {detail.hours ? <Hours hours={detail.hours} /> : <p className="hours-raw">{detail.openingHours.replace(/;\s*/g, '\n')}</p>}
                </div>
              </div>
            ) : null}
            {detail.extra?.speciality ? (
              <div className="info-row">
                <span className="info-icon" aria-hidden="true">
                  🩺
                </span>
                <div>
                  <span className="info-label">{t('info.speciality')}</span>
                  <p>{detail.extra.speciality.replace(/_/g, ' ').replace(/;/g, ', ')}</p>
                </div>
              </div>
            ) : null}
            {detail.extra?.description ? (
              <div className="info-row">
                <span className="info-icon" aria-hidden="true">
                  ℹ️
                </span>
                <div>
                  <p>{detail.extra.description}</p>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {extras.length ? (
          <div className="tags">
            {extras.map((x) => (
              <span key={x} className="tag tag-soft">
                {x}
              </span>
            ))}
          </div>
        ) : null}
        {detail && detail.kindKey !== 'address' ? (
          <p className="source">
            {t('source.list', { list: detail.sources.map((x) => SOURCE_NAMES[x] ?? x).join(', ') })}
            {detail.osmUrl ? (
              <>
                {' '}
                {t('source.wrong')}{' '}
                <a href={detail.osmUrl} target="_blank" rel="noreferrer">
                  {t('source.fix')}
                </a>
              </>
            ) : (
              <>
                {' '}
                {t('source.absent')}{' '}
                <a href={`https://www.openstreetmap.org/#map=19/${r.lat}/${r.lon}`} target="_blank" rel="noreferrer">
                  {t('source.add')}
                </a>
              </>
            )}
          </p>
        ) : null}
      </div>
    </section>
  );
});

function Transit(props: { options: TransitOption[]; chosen: number; onChoose: (i: number) => void; typical: boolean; destination: string }) {
  if (props.options.length === 0) return <p className="way-street">{t('transit.none')}</p>;
  const chosen = props.options[props.chosen] ?? props.options[0]!;
  return (
    <>
      <ul className="departures" aria-label={t('transit.next')}>
        {props.options.map((o, i) => (
          <li key={o.departure + i}>
            <button type="button" className={`departure${o === chosen ? ' is-on' : ''}`} aria-pressed={o === chosen} onClick={() => props.onChoose(i)}>
              <strong>
                {clock(o.departure)} → {clock(o.arrival)}
              </strong>
              <span>
                {minutes(o.durationMin)}
                {o.changes ? ` · ${t('transit.changes', { n: o.changes })}` : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <ol className="legs">
        {chosen.legs.map((l, i) => (
          <li key={i} className={`leg leg-${l.mode === 'walk' ? 'walk' : 'ride'}`}>
            <span className="leg-icon" aria-hidden="true">
              {legEmoji(l.mode)}
            </span>
            {l.mode === 'walk' ? (
              <span className="leg-text">
                {t('transit.walk', { min: minutes(Math.max(1, l.durationMin)), to: l.to && i < chosen.legs.length - 1 ? l.to : props.destination })}
              </span>
            ) : (
              <span className="leg-text">
                <span className="line-badge">{l.line?.name || l.line?.category || t('transit.line')}</span> {l.line?.headsign ? t('transit.direction', { to: l.line.headsign }) : ''}
                <br />
                <small>
                  {clock(l.departure)} {l.from} → {clock(l.arrival)} {l.to}
                </small>
              </span>
            )}
          </li>
        ))}
      </ol>
      {props.typical ? <p className="results-note">{t('note.typical')}</p> : null}
    </>
  );
}
