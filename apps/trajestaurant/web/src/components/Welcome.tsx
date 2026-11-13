import { regionName } from '../../../src/regions';
import { LANG, LANGS, setLang, t } from '../i18n';
import { REGION } from '../region';
export function Logo(props: { size?: number; tone?: 'red' | 'white' }) {
  const size = props.size ?? 40;
  const pin = props.tone === 'white' ? '#ffffff' : 'var(--red)';
  const ink = props.tone === 'white' ? 'var(--red)' : '#ffffff';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill={pin} d="M12 1.5c-4.6 0-8.3 3.6-8.3 8.2 0 5.9 6.9 12 7.6 12.6.4.3 1 .3 1.4 0 .7-.6 7.6-6.7 7.6-12.6 0-4.6-3.7-8.2-8.3-8.2z" />
      <g fill="none" stroke={ink} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8.6 5.6v3a1.3 1.3 0 0 0 2.6 0v-3M9.9 5.6v9" />
        <path d="M14.6 14.6V5.6c1.5.7 2.1 2.6 1.7 4.7h-1.7" />
      </g>
    </svg>
  );
}

/** Food drifting around the edges: emoji, left %, top %. */
const FLOATING: [string, number, number][] = [
  ['🍕', 8, 8],
  ['🍔', 80, 6],
  ['🍣', 88, 30],
  ['🥙', 4, 34],
  ['🌮', 10, 62],
  ['🍦', 84, 58],
  ['🍜', 70, 84],
  // Fondue in Switzerland, varenyky in Ukraine.
  [REGION.country === 'ua' ? '🥟' : '🫕', 18, 86],
  ['🍗', 44, 4],
  ['🧋', 50, 92],
];

/** First screen: name, what it does, start (sign-in comes later). */
export function Welcome(props: { onStart: () => void; locating: boolean }) {
  return (
    <main className="welcome">
      <div className="welcome-food" aria-hidden="true">
        {FLOATING.map(([e, x, y], i) => (
          <span key={e} style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${i * -0.9}s` }}>
            {e}
          </span>
        ))}
      </div>
      <div className="welcome-body">
        <div className="welcome-logo">
          <Logo size={88} tone="white" />
        </div>
        <p className="welcome-hello">{t('welcome.hello')}</p>
        <h1 className="welcome-title">{regionName(REGION, LANG)}</h1>
        <p className="welcome-lede">{t('welcome.lede')}</p>
        <div className="welcome-actions">
          <button type="button" className="btn btn-white" onClick={props.onStart} disabled={props.locating}>
            {props.locating ? t('welcome.locating') : t('welcome.start')}
          </button>
          <button type="button" className="btn btn-ghost" disabled title={t('welcome.soonTitle')}>
            {t('welcome.signin')} <span className="soon">{t('welcome.soon')}</span>
          </button>
        </div>
        <LangPicker className="welcome-langs" />
      </div>
      <footer className="welcome-foot">
        {REGION.domain && <span>{REGION.domain}</span>}
        <span>{t('credits.places')}</span>
      </footer>
    </main>
  );
}

/** The four languages, the current one marked; choosing one reloads the page in it. */
export function LangPicker(props: { className?: string }) {
  return (
    <div className={`langs ${props.className ?? ''}`} role="group" aria-label={t('language')}>
      {LANGS.map((l) => (
        <button key={l.key} type="button" lang={l.key} className={`lang${l.key === LANG ? ' is-on' : ''}`} aria-pressed={l.key === LANG} title={l.name} onClick={() => l.key !== LANG && setLang(l.key)}>
          {l.key.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
