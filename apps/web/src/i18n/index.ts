import { createContext, useContext } from 'react';
import { fr, type Dict, type Key } from './fr.js';
import { en } from './en.js';
import { de } from './de.js';
import { it } from './it.js';

export type Lang = 'fr' | 'de' | 'it' | 'en';
export const LANGS: Lang[] = ['fr', 'de', 'it', 'en'];
const DICTS: Record<Lang, Dict> = { fr, en, de, it };

export type T = (key: Key, params?: Record<string, string | number>) => string;

export function translator(lang: Lang): T {
  const dict = DICTS[lang];
  return (key, params) => {
    let s: string = dict[key] ?? fr[key] ?? key;
    // "1 change|{n} changes": the first form for n = 1, the second otherwise.
    if (s.includes('|') && params && typeof params.n === 'number') s = (params.n === 1 ? s.split('|')[0] : s.split('|')[1]) ?? s;
    if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}

/** The language is the first path segment (/fr/, /de/…); French when absent. */
export function langFromPath(path: string): Lang {
  const seg = path.split('/')[1];
  return (LANGS as string[]).includes(seg ?? '') ? (seg as Lang) : 'fr';
}

export const I18n = createContext<{ lang: Lang; t: T }>({ lang: 'fr', t: translator('fr') });
export const useI18n = () => useContext(I18n);
export type { Key };
