import { useI18n, type Key } from '../i18n/index.js';

const SOURCES: { name: string; href?: string; desc: Key }[] = [
  { name: 'opentransportdata.swiss', href: 'https://opentransportdata.swiss', desc: 'm.src.otd' },
  { name: 'OpenStreetMap', href: 'https://www.openstreetmap.org', desc: 'm.src.osm' },
  { name: 'MOTIS', href: 'https://motis-project.de', desc: 'm.src.motis' },
  { name: 'Alliance SwissPass, Mobilis, Frimobil, unireso, Onde Verte, Libero, ZVV, Léman Pass', desc: 'm.src.tariffs' },
  { name: 'mobitool', href: 'https://www.mobitool.ch', desc: 'm.src.mobitool' },
  { name: 'TCS', href: 'https://www.tcs.ch', desc: 'm.src.tcs' },
  { name: 'OFS / BFS', href: 'https://www.bfs.admin.ch', desc: 'm.src.bfs' },
  { name: 'sharedmobility.ch', href: 'https://sharedmobility.ch', desc: 'm.src.shared' },
  { name: 'lausanne.ch', href: 'https://www.lausanne.ch', desc: 'm.src.lausanne' },
  { name: 'SBB', href: 'https://digital.sbb.ch', desc: 'm.src.sbb' },
  { name: 'OpenFreeMap / OpenMapTiles', href: 'https://openfreemap.org', desc: 'm.src.ofm' },
];

const HOW: Key[] = ['m.how.trips', 'm.how.pt', 'm.how.car', 'm.how.bike', 'm.how.time', 'm.how.co2', 'm.how.list'];
const LIMITS: Key[] = ['m.limits.i1', 'm.limits.i2', 'm.limits.i3', 'm.limits.i4', 'm.limits.i5'];

/** The "Method and sources" page: the approach in a few lines, the limits, the sources. */
export function MethodPage(props: { searchHref: string; onBack: () => void }) {
  const { t } = useI18n();
  return (
    <article className="prose">
      <p>
        <a href={props.searchHref} onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          props.onBack();
        }}>
          {t('method.back')}
        </a>
      </p>
      <h1 tabIndex={-1}>{t('method.title')}</h1>

      <section aria-labelledby="m-what">
        <h2 id="m-what">{t('m.what.h')}</h2>
        <p>{t('m.what.p1')}</p>
        <p>{t('m.what.p2')}</p>
      </section>

      <section aria-labelledby="m-how">
        <h2 id="m-how">{t('m.how.h')}</h2>
        <ul className="bullets">
          {HOW.map((k) => (
            <li key={k}>{t(k, { left: t('left.title') })}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="m-labels">
        <h2 id="m-labels">{t('m.labels.h')}</h2>
        <dl>
          {(['tariff', 'estimated'] as const).map((p) => (
            <div key={p}>
              <dt>
                <span className={`prov prov-${p}`}>{t(`prov.${p}`)}</span>
              </dt>
              <dd>{t(`m.labels.${p}`)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="m-limits">
        <h2 id="m-limits">{t('m.limits.h')}</h2>
        <ul className="bullets">
          {LIMITS.map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="m-sources">
        <h2 id="m-sources">{t('m.sources.h')}</h2>
        <ul className="bullets">
          {SOURCES.map((s) => (
            <li key={s.name}>
              {s.href ? <a href={s.href}>{s.name}</a> : s.name}
              {' – '}
              {t(s.desc)}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="m-privacy">
        <h2 id="m-privacy">{t('m.privacy.h')}</h2>
        <p>{t('m.privacy.p')}</p>
      </section>
    </article>
  );
}
