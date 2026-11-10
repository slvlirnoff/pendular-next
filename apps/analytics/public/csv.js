// CSV parsing in the browser: delimiter guessed (comma, semicolon, tab), quoted fields, first row = headers.
export function detectDelimiter(text) {
  const first = text.split(/\r?\n/).find((l) => l.trim() !== '') || '';
  let best = ',', bestN = -1, inQ = false;
  const counts = { ',': 0, ';': 0, '\t': 0 };
  for (const ch of first) { if (ch === '"') inQ = !inQ; else if (!inQ && ch in counts) counts[ch]++; }
  for (const d of [';', '\t', ',']) if (counts[d] > bestN) { best = d; bestN = counts[d]; }
  return best;
}

export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [], field = '', inQ = false, i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"' && field === '') inQ = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
    i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const clean = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (!clean.length) return { delimiter, headers: [], rows: [] };
  const headers = clean[0].map((s, n) => s.trim() || `column ${n + 1}`);
  return { delimiter, headers, rows: clean.slice(1).map((r) => headers.map((_, n) => (r[n] ?? '').trim())) };
}

/** Decode file bytes: UTF-8 when valid, else Windows-1252 (common for Swiss Excel exports). */
export function decode(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { return new TextDecoder('windows-1252').decode(buf); }
}

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const GUESS = {
  id: /^(id|ext ?id|person ?id|matricule|matr|personalnummer|personal ?nr|personalnr|pers ?nr|employee( id| number)?|staff ?id|pseudo\w*)$|\b(matricule|personalnummer)\b/,
  address: /^(adresse|address|strasse|street|rue|str|adr)\b|\b(strasse|rue|street|address|adresse)\b/,
  postcode: /^(npa|plz|postcode|post code|zip|zip ?code|postleitzahl|code postal|cp)$/,
  city: /^(localite|ort|city|ville|wohnort|stadt|commune|gemeinde|town)$/,
  lat: /^(lat|latitude|breite|y)$/,
  lon: /^(lon|lng|long|longitude|lange|x)$/,
};
export const FIELDS = [
  ['id', 'Person id', true], ['address', 'Address (street and number)'], ['postcode', 'Postcode'],
  ['city', 'City'], ['lat', 'Latitude (optional)'], ['lon', 'Longitude (optional)'],
];
/** Returns { field: columnIndex | -1 }. Each column is used at most once. */
export function guessMapping(headers) {
  const map = {}, used = new Set();
  for (const [f] of FIELDS) {
    let idx = headers.findIndex((h, n) => !used.has(n) && GUESS[f].test(norm(h)));
    if (idx >= 0) used.add(idx);
    map[f] = idx;
  }
  return map;
}
