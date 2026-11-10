const LOCALE: Record<string, string> = { fr: 'fr-CH', de: 'de-CH', it: 'it-CH', en: 'en-GB' };

export const chf = (n: number, lang: string) =>
  `CHF ${new Intl.NumberFormat(LOCALE[lang] ?? 'fr-CH', { maximumFractionDigits: 0 }).format(Math.round(n))}`;

export const chf2 = (n: number, lang: string) =>
  `CHF ${new Intl.NumberFormat(LOCALE[lang] ?? 'fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;

export const num = (n: number, lang: string, digits = 0) =>
  new Intl.NumberFormat(LOCALE[lang] ?? 'fr-CH', { maximumFractionDigits: digits }).format(n);

/** 95 → "1 h 35", 42 → "42 min". */
export function duration(min: number): string {
  const m = Math.round(min);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

export const hhmm = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Zurich', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
