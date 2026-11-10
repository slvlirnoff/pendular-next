import { useI18n, type Key } from '../i18n/index.js';

const SOURCES: { name: string; href: string; desc: Key }[] = [
  { name: 'opentransportdata.swiss', href: 'https://opentransportdata.swiss', desc: 'm.src.otd' },
  { name: 'OpenStreetMap', href: 'https://www.openstreetmap.org', desc: 'm.src.osm' },
  { name: 'MOTIS', href: 'https://motis-project.de', desc: 'm.src.motis' },
  { name: 'Mobilis', href: 'https://www.mobilis-vaud.ch', desc: 'm.src.mobilis' },
  { name: 'Alliance SwissPass', href: 'https://www.allianceswisspass.ch', desc: 'm.src.asp' },
  { name: 'mobitool', href: 'https://www.mobitool.ch', desc: 'm.src.mobitool' },
  { name: 'TCS', href: 'https://www.tcs.ch', desc: 'm.src.tcs' },
  { name: 'lausanne.ch', href: 'https://www.lausanne.ch', desc: 'm.src.lausanne' },
  { name: 'SBB', href: 'https://digital.sbb.ch', desc: 'm.src.sbb' },
  { name: 'OpenFreeMap / OpenMapTiles', href: 'https://openfreemap.org', desc: 'm.src.ofm' },
];

/** The "Method and sources" page: plain text in a readable column. */
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
      <p className="lead">{t('method.intro')}</p>

      <section aria-labelledby="m-scope">
        <h2 id="m-scope">{t('m.scope.h')}</h2>
        <p>{t('m.scope.p1')}</p>
        <p>{t('m.scope.p2')}</p>
      </section>

      <section aria-labelledby="m-cost">
        <h2 id="m-cost">{t('m.cost.h')}</h2>
        <h3>{t('m.cost.trips.h')}</h3>
        <p>{t('m.cost.trips.p')}</p>
        <h3>{t('m.cost.pt.h')}</h3>
        <p>{t('m.cost.pt.p')}</p>
        <h3>{t('m.cost.car.h')}</h3>
        <p>{t('m.cost.car.p')}</p>
        <p>{t('m.cost.car.time')}</p>
      </section>

      <section aria-labelledby="m-labels">
        <h2 id="m-labels">{t('m.labels.h')}</h2>
        <dl>
          {(['quoted', 'tariff', 'estimated'] as const).map((p) => (
            <div key={p}>
              <dt>
                <span className={`prov prov-${p}`}>{t(`prov.${p}`)}</span>
              </dt>
              <dd>{t(`m.labels.${p}`)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="m-options">
        <h2 id="m-options">{t('m.options.h')}</h2>
        <p>{t('m.options.p', { left: t('left.title') })}</p>
        <ul className="bullets">
          <li>{t('m.options.i1')}</li>
          <li>{t('m.options.i2')}</li>
          <li>{t('m.options.i3')}</li>
          <li>{t('m.options.i4')}</li>
          <li>{t('m.options.i5')}</li>
        </ul>
      </section>

      <section aria-labelledby="m-co2">
        <h2 id="m-co2">{t('m.co2.h')}</h2>
        <p>{t('m.co2.p')}</p>
      </section>

      <section aria-labelledby="m-limits">
        <h2 id="m-limits">{t('m.limits.h')}</h2>
        <ul className="bullets">
          <li>{t('m.limits.i1')}</li>
          <li>{t('m.limits.i2')}</li>
          <li>{t('m.limits.i3')}</li>
          <li>{t('m.limits.i4')}</li>
          <li>{t('m.limits.i5')}</li>
        </ul>
      </section>

      <section aria-labelledby="m-sources">
        <h2 id="m-sources">{t('m.sources.h')}</h2>
        <ul className="bullets">
          {SOURCES.map((s) => (
            <li key={s.name}>
              <a href={s.href}>
                {s.name}
              </a>
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
