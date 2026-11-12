import { forwardRef } from 'react';
import type { Mode, PlaceSummary, RoutesResponse, Target, TransitOption } from '../../../src/api';
import { FOOD_BY_KEY } from '../../../src/foods';
import { clock, distance, kindLabel, legEmoji, MODE, minutes, openLabel, placeEmoji } from '../lib';

const YES = new Set(['yes', 'only', 'designated']);
const SOURCE_NAMES: Record<string, string> = { osm: 'OpenStreetMap', atp: 'All The Places', overture: 'Overture Maps' };

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
    mode: Mode;
    departure: number;
    onMode: (m: Mode) => void;
    onDeparture: (i: number) => void;
    onBack: () => void;
  }
>(function Detail(props, ref) {
  const r = props.routes?.place ?? props.summary;
  const detail = props.routes?.place;
  const open = openLabel(r.open);
  const foods = r.foods.map((k) => FOOD_BY_KEY.get(k)).filter((f) => f && !f.generic);
  const times: Record<Mode, number | null> = {
    walk: props.routes?.walk?.durationMin ?? null,
    transit: props.routes?.transit[0]?.durationMin ?? null,
    car: props.routes?.car?.durationMin ?? null,
  };
  const extras = detail
    ? [
        YES.has(detail.takeaway ?? '') && '🥡 À l’emporter',
        YES.has(detail.delivery ?? '') && '🛵 Livraison',
        YES.has(detail.outdoorSeating ?? '') && '☀️ Terrasse',
        YES.has(detail.vegetarian ?? '') && '🌱 Végétarien',
        YES.has(detail.vegan ?? '') && '🌿 Vegan',
        detail.wheelchair === 'yes' && '♿ Accessible',
      ].filter((x): x is string => Boolean(x))
    : [];

  return (
    <section ref={ref} className="panel panel-detail" aria-label={r.name}>
      <div className="card detail">
        <div className="detail-head">
          <button type="button" className="back" onClick={props.onBack} aria-label="Retour à la liste">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <span className="emoji-dot emoji-big" aria-hidden="true">
            {placeEmoji(r, props.target)}
          </span>
          <div className="detail-title">
            <h2>{r.name}</h2>
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

        <div className="modes" role="tablist" aria-label="Comment y aller">
          {(['walk', 'transit', 'car'] as const).map((m) => (
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
            <p className="way-loading">Je calcule le chemin…</p>
          ) : props.error ? (
            <p className="way-loading">Le calcul du chemin n'a pas marché. Réessaie.</p>
          ) : props.mode === 'transit' ? (
            <Transit options={props.routes?.transit ?? []} chosen={props.departure} onChoose={props.onDeparture} typical={props.routes?.typicalTimetable ?? false} destination={r.name} />
          ) : props.mode === 'walk' ? (
            props.routes?.walk ? (
              <p className="way-street">
                🚶 {minutes(props.routes.walk.durationMin)} à pied · {distance(props.routes.walk.distanceM)}
              </p>
            ) : (
              <p className="way-street">Trop loin pour y aller à pied.</p>
            )
          ) : props.routes?.car ? (
            <p className="way-street">
              🚗 {minutes(props.routes.car.durationMin)} en voiture · {distance(props.routes.car.distanceM)} <small>(sans les bouchons ni le parking)</small>
            </p>
          ) : (
            <p className="way-street">Pas de route trouvée en voiture.</p>
          )}
        </div>

        <dl className="facts">
          {detail?.address ? (
            <>
              <dt>Adresse</dt>
              <dd>{detail.address}</dd>
            </>
          ) : null}
          {detail?.openingHours ? (
            <>
              <dt>Horaires</dt>
              <dd className="hours">{detail.openingHours.replace(/;\s*/g, '\n')}</dd>
            </>
          ) : null}
          {detail?.phone ? (
            <>
              <dt>Téléphone</dt>
              <dd>
                <a href={`tel:${detail.phone.replace(/[^+\d]/g, '')}`}>{detail.phone}</a>
              </dd>
            </>
          ) : null}
          {detail?.website ? (
            <>
              <dt>Site web</dt>
              <dd>
                <a href={/^https?:/.test(detail.website) ? detail.website : `https://${detail.website}`} target="_blank" rel="noreferrer">
                  {detail.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
                </a>
              </dd>
            </>
          ) : null}
        </dl>
        {extras.length ? (
          <div className="tags">
            {extras.map((x) => (
              <span key={x} className="tag tag-soft">
                {x}
              </span>
            ))}
          </div>
        ) : null}
        {detail ? (
          <p className="source">
            Source : {detail.sources.map((x) => SOURCE_NAMES[x] ?? x).join(', ')}.
            {detail.osmUrl ? (
              <>
                {' '}
                Une info manque ou est fausse ?{' '}
                <a href={detail.osmUrl} target="_blank" rel="noreferrer">
                  Corriger sur OpenStreetMap
                </a>
              </>
            ) : (
              <>
                {' '}
                Absent d'OpenStreetMap :{' '}
                <a href={`https://www.openstreetmap.org/#map=19/${r.lat}/${r.lon}`} target="_blank" rel="noreferrer">
                  l'ajouter
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
  if (props.options.length === 0) return <p className="way-street">Pas de transports publics plus rapides que la marche dans l'heure et demie qui vient.</p>;
  const chosen = props.options[props.chosen] ?? props.options[0]!;
  return (
    <>
      <ul className="departures" aria-label="Prochains départs">
        {props.options.map((o, i) => (
          <li key={o.departure + i}>
            <button type="button" className={`departure${o === chosen ? ' is-on' : ''}`} aria-pressed={o === chosen} onClick={() => props.onChoose(i)}>
              <strong>
                {clock(o.departure)} → {clock(o.arrival)}
              </strong>
              <span>
                {minutes(o.durationMin)}
                {o.changes ? ` · ${o.changes} chang.` : ''}
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
                Marcher {minutes(Math.max(1, l.durationMin))}
                {` jusqu’à ${l.to && i < chosen.legs.length - 1 ? l.to : props.destination}`}
              </span>
            ) : (
              <span className="leg-text">
                <span className="line-badge">{l.line?.name || l.line?.category || 'Ligne'}</span> {l.line?.headsign ? `direction ${l.line.headsign}` : ''}
                <br />
                <small>
                  {clock(l.departure)} {l.from} → {clock(l.arrival)} {l.to}
                </small>
              </span>
            )}
          </li>
        ))}
      </ol>
      {props.typical ? <p className="results-note">Horaire type : même jour et même heure dans l'horaire 2027.</p> : null}
    </>
  );
}
