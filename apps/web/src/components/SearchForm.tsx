import { useId, useState } from 'react';
import type { AgeGroup, Weekday } from '@pendular/engine/types';
import { useI18n } from '../i18n/index.js';
import type { SearchState } from '../lib/state.js';
import { PlaceInput } from './PlaceInput.js';

const DAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const AGES: AgeGroup[] = ['child', 'youth', 'adult', 'senior'];

export function SearchForm(props: { state: SearchState; onChange: (s: SearchState) => void; onSubmit: () => void; busy: boolean }) {
  const { t, lang } = useI18n();
  const moreId = useId();
  const s = props.state;
  const set = <K extends keyof SearchState>(k: K, v: SearchState[K]) => props.onChange({ ...s, [k]: v });
  const [more, setMore] = useState(s.carCost !== 'full' || s.parkingPerMonth !== 260 || s.weeksOff !== 5 || !s.vaudResident);
  const ready = !!s.home && !!s.work && s.weekdays.length > 0;

  return (
    <form
      className="search card"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) props.onSubmit();
      }}
    >
      <div className="search-places">
        <PlaceInput label={t('form.home')} value={s.home} onChange={(p) => set('home', p)} />
        <button type="button" className="icon-button swap" aria-label={t('form.swap')} title={t('form.swap')} onClick={() => props.onChange({ ...s, home: s.work, work: s.home })}>
          <img src="/icons/sbb/arrow-change-horizontal-small.svg" alt="" width={24} height={24} />
        </button>
        <PlaceInput label={t('form.work')} value={s.work} onChange={(p) => set('work', p)} />
      </div>

      <div className="search-row">
        <fieldset className="field">
          <legend>{t('form.arrival')}</legend>
          <div className="inline">
            <input type="time" aria-label={t('form.arrivalFrom')} value={s.from} onChange={(e) => set('from', e.target.value)} required />
            <span aria-hidden="true">{t('form.and')}</span>
            <input type="time" aria-label={t('form.arrivalTo')} value={s.to} onChange={(e) => set('to', e.target.value)} required />
          </div>
        </fieldset>
        <fieldset className="field">
          <legend>{t('form.days')}</legend>
          <div className="days">
            {DAYS.map((d) => {
              const on = s.weekdays.includes(d);
              return (
                <button key={d} type="button" className={`chip${on ? ' is-on' : ''}`} aria-pressed={on} aria-label={new Date(2024, 0, 1 + DAYS.indexOf(d)).toLocaleDateString(lang, { weekday: 'long' })} onClick={() => set('weekdays', on ? s.weekdays.filter((x) => x !== d) : [...s.weekdays, d])}>
                  {t(`day.${d}`)}
                </button>
              );
            })}
          </div>
        </fieldset>
        <label className="field">
          <span>{t('form.age')}</span>
          <select value={s.ageGroup} onChange={(e) => set('ageGroup', e.target.value as AgeGroup)}>
            {AGES.map((a) => (
              <option key={a} value={a}>
                {t(`form.age.${a}`)}
              </option>
            ))}
          </select>
        </label>
        <div className="field checks">
          <label className="check">
            <input type="checkbox" checked={s.halfFare} onChange={(e) => set('halfFare', e.target.checked)} />
            {t('form.halfFare')}
          </label>
          <label className="check">
            <input type="checkbox" checked={s.firstClass} onChange={(e) => set('firstClass', e.target.checked)} />
            {t('form.firstClass')}
          </label>
        </div>
      </div>

      <div className="search-actions">
        <button type="button" className="link-button" aria-expanded={more} aria-controls={moreId} onClick={() => setMore(!more)}>
          {t('form.more')}
        </button>
        <button type="submit" className="primary" disabled={!ready || props.busy}>
          {t('form.submit')}
        </button>
      </div>

      {more && (
        <div className="search-row more" id={moreId}>
          <label className="field">
            <span>{t('form.weeksOff')}</span>
            <input type="number" min={0} max={51} value={s.weeksOff} onChange={(e) => set('weeksOff', Math.max(0, Math.min(51, Number(e.target.value) || 0)))} />
          </label>
          <label className="field">
            <span>{t('form.carCost')}</span>
            <select value={s.carCost} onChange={(e) => set('carCost', e.target.value as SearchState['carCost'])}>
              <option value="full">{t('form.carCost.full')}</option>
              <option value="running">{t('form.carCost.running')}</option>
            </select>
          </label>
          <label className="field">
            <span>{t('form.parking')}</span>
            <input type="number" min={0} max={2000} step={10} value={s.parkingPerMonth} onChange={(e) => set('parkingPerMonth', Math.max(0, Math.min(2000, Number(e.target.value) || 0)))} />
          </label>
          <div className="field checks">
            <label className="check">
              <input type="checkbox" checked={s.vaudResident} onChange={(e) => set('vaudResident', e.target.checked)} />
              {t('form.vaud')}
            </label>
          </div>
        </div>
      )}
    </form>
  );
}
