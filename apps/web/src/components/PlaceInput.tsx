import { useEffect, useId, useRef, useState } from 'react';
import type { Place } from '@pendular/engine/types';
import { searchPlaces, type PlaceHit } from '../lib/api.js';
import { useI18n } from '../i18n/index.js';

const TYPE_ICON: Record<PlaceHit['type'], string> = { stop: 'train-station-small', address: 'house-small', place: 'location-pin-map-small' };

/** A combobox over the place search: stops, addresses and places. */
export function PlaceInput(props: { label: string; value: Place | null; onChange: (p: Place | null) => void }) {
  const { t, lang } = useI18n();
  const id = useId();
  const [text, setText] = useState(props.value?.label ?? '');
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [searched, setSearched] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => setText(props.value?.label ?? ''), [props.value]);

  useEffect(() => {
    const q = text.trim();
    if (!open || q.length < 2 || q === props.value?.label) return;
    const timer = setTimeout(() => {
      abort.current?.abort();
      const ctl = (abort.current = new AbortController());
      searchPlaces(q, lang, ctl.signal)
        .then((r) => {
          setHits(r);
          setActive(0);
          setSearched(true);
        })
        .catch(() => undefined);
    }, 180);
    return () => clearTimeout(timer);
  }, [text, open, lang, props.value]);

  const choose = (h: PlaceHit) => {
    props.onChange({ label: h.label, lat: h.lat, lon: h.lon, stopId: h.stopId });
    setText(h.label);
    setOpen(false);
  };

  const showList = open && text.trim().length >= 2 && (hits.length > 0 || searched);
  return (
    <div className="place">
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        role="combobox"
        aria-expanded={showList}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={showList && hits[active] ? `${id}-o${active}` : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={t('form.placeholder')}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setSearched(false);
          if (props.value) props.onChange(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.max(0, Math.min(a + 1, hits.length - 1)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && showList && hits[active]) {
            e.preventDefault();
            choose(hits[active]!);
          } else if (e.key === 'Escape' && showList) {
            e.preventDefault();
            setOpen(false);
          }
        }}
      />
      <div className="sr-only" role="status">
        {showList ? (hits.length > 0 ? t('form.found', { n: hits.length }) : t('form.noResults')) : ''}
      </div>
      <ul id={`${id}-list`} role="listbox" aria-label={props.label} className="place-list" hidden={!showList}>
        {showList && (
          <>
          {hits.length === 0 && (
            <li role="presentation" className="place-empty">
              {t('form.noResults')}
            </li>
          )}
          {hits.map((h, i) => (
            <li
              key={`${h.lat},${h.lon},${h.label}`}
              id={`${id}-o${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'is-active' : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(h);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <img src={`/icons/sbb/${TYPE_ICON[h.type]}.svg`} alt="" width={20} height={20} onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
              <span>{h.label}</span>
            </li>
          ))}
          </>
        )}
      </ul>
    </div>
  );
}
