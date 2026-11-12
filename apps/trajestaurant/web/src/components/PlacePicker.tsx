import { useEffect, useId, useRef, useState } from 'react';
import type { PlaceHit } from '../../../src/api';
import { api, type Here } from '../lib';

/** "Where are you?": the device's position, or a place typed by name. */
export function PlacePicker(props: { onPlace: (h: Here) => void; onLocate: () => void; onClose: (() => void) | null; locating: boolean; failed: boolean }) {
  const id = useId();
  const [text, setText] = useState('');
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      api
        .geocode(q, ctl.signal)
        .then((h) => {
          setHits(h);
          setActive(0);
        })
        .catch(() => undefined);
    }, 150);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [text]);

  const choose = (h: PlaceHit) => props.onPlace({ lat: h.lat, lon: h.lon, label: h.label.split(',').slice(-1)[0]!.trim() || h.label });

  return (
    <div className="sheet-backdrop" role="presentation" onClick={props.onClose ?? undefined}>
      <div className="card sheet" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2 id={`${id}-t`}>Où es-tu ?</h2>
          {props.onClose ? (
            <button type="button" className="sheet-close" aria-label="Fermer" onClick={props.onClose}>
              ×
            </button>
          ) : null}
        </div>
        <button type="button" className="btn btn-red btn-block" onClick={props.onLocate} disabled={props.locating}>
          <span aria-hidden="true">🎯</span> {props.locating ? 'Je cherche…' : 'Utiliser ma position'}
        </button>
        {props.failed ? <p className="sheet-note">Ta position n'est pas disponible. Écris plutôt le nom de ton village ou de ta gare.</p> : null}
        <label className="sheet-label" htmlFor={id}>
          Ou écris un lieu
        </label>
        <input
          ref={input}
          id={id}
          className="sheet-input"
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls={`${id}-list`}
          aria-activedescendant={hits.length ? `${id}-o${active}` : undefined}
          autoComplete="off"
          placeholder="Lucens, gare de Moudon, rue…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, hits.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && hits[active]) {
              e.preventDefault();
              choose(hits[active]!);
            } else if (e.key === 'Escape') props.onClose?.();
          }}
        />
        <ul id={`${id}-list`} role="listbox" className="place-hits">
          {hits.map((h, i) => (
            <li key={`${h.lat},${h.lon},${i}`} id={`${id}-o${i}`} role="option" aria-selected={i === active} className={i === active ? 'is-active' : ''} onClick={() => choose(h)} onMouseEnter={() => setActive(i)}>
              <span aria-hidden="true">📍</span> {h.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
