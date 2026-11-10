/**
 * Address check for Commute Analytics.
 *
 * Every address is looked up in the official building address register (swisstopo search
 * service); the local MOTIS geocoder is the fallback. Search services are fuzzy: they silently
 * replace a wrong street or house number with a neighbour. So the service's rank is not trusted:
 * the INPUT is parsed here and compared with every candidate field by field, and only a candidate
 * that agrees on postcode, house number and street (same street type, at most a small typo) is
 * "exact". See GEOCODING.md.
 */
import { httpGet } from '../../api/src/httpGet.js';
import type { AddressCandidate, GeocodeResult } from './types.js';

export interface GeocodeDeps {
  fetch?: typeof fetch;
  /** MOTIS base URL (default http://127.0.0.1:8080). */
  motisUrl?: string;
  /** swisstopo API base URL (default https://api3.geo.admin.ch). */
  swisstopoUrl?: string;
}

export interface AddressInput {
  address?: string;
  postcode?: string;
  city?: string;
}

/** Reason codes, in the order they are reported. */
export const REASON_ORDER = ['postcode', 'houseNumber', 'noNumber', 'street', 'ambiguous', 'fallback'] as const;

// ───────────────────────────── text helpers ─────────────────────────────

/** Lower case, no accents; ß→ss, œ→oe. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae');
}

function words(s: string): string[] {
  return fold(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** Damerau-Levenshtein distance (optimal string alignment: one transposition counts 1). */
export function damerauLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const n = a.length;
  const m = b.length;
  if (!n) return m;
  if (!m) return n;
  const d: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i]![0] = i;
  for (let j = 0; j <= m; j++) d[0]![j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[n]![m]!;
}

export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371008.8;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ───────────────────────────── street names ─────────────────────────────

const ABBREVIATIONS: Record<string, string> = {
  av: 'avenue', ave: 'avenue', ch: 'chemin', chem: 'chemin', rte: 'route', pl: 'place', bd: 'boulevard',
  bld: 'boulevard', bvd: 'boulevard', blvd: 'boulevard', imp: 'impasse', fbg: 'faubourg', all: 'allee',
  prom: 'promenade', pza: 'piazza', vle: 'viale', sent: 'sentier', str: 'strasse',
  st: 'saint', ste: 'sainte', sankt: 'saint',
};

/** Street type words that stand first (or, as in "Grand-Rue", last): French and Italian. */
const LEADING_TYPES = new Set([
  'rue', 'route', 'chemin', 'avenue', 'boulevard', 'place', 'impasse', 'allee', 'quai', 'passage', 'sentier',
  'ruelle', 'promenade', 'cours', 'esplanade', 'faubourg', 'square', 'pont', 'via', 'viale', 'piazza',
  'piazzale', 'strada', 'vicolo', 'salita', 'sentiero', 'contrada', 'largo', 'corso', 'riva', 'rampa', 'ronco',
]);
/** German street types: the end of the (compound) name. */
const SUFFIX_TYPES: [string, string][] = [
  ['strasse', 'strasse'], ['gassli', 'gasse'], ['gasse', 'gasse'], ['weg', 'weg'], ['platz', 'platz'],
  ['allee', 'allee'], ['rain', 'rain'], ['steig', 'steig'], ['pfad', 'pfad'], ['halde', 'halde'],
  ['graben', 'graben'], ['ring', 'ring'], ['hof', 'hof'], ['quai', 'quai'],
];
const ARTICLES = new Set([
  'de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'au', 'aux', 'sur', 'sous', 'en',
  'di', 'del', 'della', 'dei', 'delle', 'degli', 'dello', 'dell', 'al', 'alla', 'da',
  'am', 'an', 'im', 'in', 'zum', 'zur', 'der', 'die', 'das', 'auf', 'bei', 'vor', 'ob', 'unter', 'zu',
]);

/** "Av. de la Gare" -> "Avenue de la Gare", "Bahnhofstr." -> "Bahnhofstrasse". Keeps accents and case. */
export function expandAbbreviations(street: string): string {
  const parts = street.replace(/\./g, ' ').split(/([\s,;/-]+)/);
  return parts
    .map((p, i) => {
      if (i % 2 === 1 || !p) return p;
      const f = fold(p);
      const full = ABBREVIATIONS[f];
      if (full) return full.charAt(0).toUpperCase() + full.slice(1);
      if (f.length > 3 && f.endsWith('str') && /\p{L}$/u.test(p)) return p + 'asse';
      return p;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface StreetKey {
  /** Compact normalised name, e.g. "ruedebourg". */
  key: string;
  /** Without the type word and articles, e.g. "bourg". */
  core: string;
  /** Normalised type word ("rue", "strasse", …) or null. */
  type: string | null;
}

/** German transliterations (ae/oe/ue) and umlauts compare equal. */
const compact = (ws: string[]) => ws.join('').replace(/([aou])e/g, '$1');

export function normaliseStreet(raw: string): StreetKey {
  const ws = words(expandAbbreviations(raw));
  let type: string | null = null;
  let typeIdx = -1;
  if (ws.length && LEADING_TYPES.has(ws[0]!)) {
    type = ws[0]!;
    typeIdx = 0;
  } else if (ws.length > 1 && LEADING_TYPES.has(ws[ws.length - 1]!)) {
    type = ws[ws.length - 1]!;
    typeIdx = ws.length - 1;
  }
  const last = ws[ws.length - 1] ?? '';
  let coreWords = ws.filter((w, i) => i !== typeIdx);
  if (!type) {
    const hit = SUFFIX_TYPES.find(([suf]) => last.endsWith(suf));
    if (hit) {
      type = hit[1];
      // The suffix is part of the compound word: drop it from the core.
      coreWords = ws.slice(0, -1).concat(last.slice(0, last.length - hit[0].length) || []);
    }
  }
  return {
    key: compact(ws),
    core: compact(coreWords.filter((w) => !ARTICLES.has(w))),
    type,
  };
}

/** Bilingual register names ("Collègegasse / Rue du Collège"): the whole name, then each language. */
export function streetAlternatives(raw: string): StreetKey[] {
  const whole = normaliseStreet(raw);
  const parts = raw.split(/\s*\/\s*/).filter((x) => /\p{L}{2}/u.test(x));
  return parts.length > 1 ? [whole, ...parts.map(normaliseStreet)] : [whole];
}

export interface StreetMatch {
  dist: number;
  /** Same type word, same digits and within the typo tolerance: the street is the same. */
  exactish: boolean;
  /** The name is similar, but not the same street. */
  similar: boolean;
  /** 0-1 */
  sim: number;
}

const tolerance = (len: number) => (len <= 10 ? 1 : 2);
const digitsOf = (s: string) => s.replace(/\D/g, '');

/** Best match over the language variants of both names. */
export function compareStreets(input: StreetKey[], cand: StreetKey[]): StreetMatch {
  let best: StreetMatch | null = null;
  for (const a of input) {
    for (const b of cand) {
      const m = compareStreet(a, b);
      if (!best || (m.exactish && !best.exactish) || (m.exactish === best.exactish && m.dist < best.dist)) best = m;
    }
  }
  return best!;
}

export function compareStreet(input: StreetKey, cand: StreetKey): StreetMatch {
  const dist = damerauLevenshtein(input.key, cand.key);
  const maxLen = Math.max(input.key.length, cand.key.length, 1);
  const sim = 1 - dist / maxLen;
  const digitsEq = digitsOf(input.key) === digitsOf(cand.key);
  const tol = tolerance(Math.min(input.key.length, cand.key.length));
  const exactish = digitsEq && input.type === cand.type && dist <= tol;
  let similar = exactish;
  if (!similar && digitsEq) {
    const coreTol = tolerance(Math.min(input.core.length, cand.core.length));
    similar =
      sim >= 0.72 ||
      (input.core.length >= 3 && cand.core.length >= 3 && damerauLevenshtein(input.core, cand.core) <= coreTol);
  }
  return { dist, exactish, similar, sim };
}

// ───────────────────────────── house numbers, postcodes, towns ─────────────────────────────

const SUFFIX_WORDS: Record<string, string> = { bis: 'b', ter: 'c', quater: 'd' };

/** "12", "12a", "12 A", "12 bis", "5-7" -> key "12", "12a", "12a", "12b", "5". */
export function houseNumberKey(raw: string): string | null {
  const m = raw
    .trim()
    .toLowerCase()
    .match(/^(?:n[°ºo]?\.?\s*)?(\d{1,4}(?:\.\d{1,2})?)\s*(bis|ter|quater|[a-z])?(?:\s*[-/]\s*\d{1,4}\s*[a-z]?)?$/);
  if (!m) return null;
  const num = m[1]!.replace(/^0+(?=\d)/, '');
  return num + (m[2] ? (SUFFIX_WORDS[m[2]] ?? m[2]) : '');
}

const NUMBER_PART = String.raw`\d{1,4}(?:\.\d{1,2})?\s*(?:bis\b|ter\b|quater\b|[a-zA-Z](?![a-zA-Z]))?(?:\s*[-/]\s*\d{1,4}\s*[a-zA-Z]?)?`;
const TRAILING_NUMBER = new RegExp(String.raw`(?:^|[\s,])(?:n[°ºo]?\.?\s*)?(${NUMBER_PART})\s*$`, 'i');
const LEADING_NUMBER = new RegExp(String.raw`^(?:n[°ºo]?\.?\s*)?(${NUMBER_PART})[\s,]+(?=\p{L})`, 'iu');

/** Splits "Rue de Bourg 27", "27 rue de Bourg", "Via Nassa 5 a" into street text and number key. */
export function splitStreetNumber(text: string): { street: string; number: string | null } {
  const t = text.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  let m = t.match(TRAILING_NUMBER);
  if (m && m.index !== undefined) {
    const num = houseNumberKey(m[1]!);
    if (num) return { street: t.slice(0, m.index).replace(/[\s,]+$/, '').replace(/\b(n[°ºo]?|nr|no)\.?$/i, '').trim(), number: num };
  }
  m = t.match(LEADING_NUMBER);
  if (m) {
    const num = houseNumberKey(m[1]!);
    if (num) return { street: t.slice(m[0].length).trim(), number: num };
  }
  return { street: t.replace(/[\s,]+$/, ''), number: null };
}

const COUNTRY = /^(suisse|schweiz|svizzera|svizra|switzerland|ch|swiss)$/i;

export interface ParsedAddress {
  /** Street name as typed (abbreviations expanded), without number; '' when none. */
  street: string;
  streetKey: StreetKey;
  streetAlts: StreetKey[];
  /** Key such as "27" or "12a"; null when the input has no house number. */
  number: string | null;
  postcode: string | null;
  town: string | null;
}

function cleanPostcode(s: string | undefined): { postcode: string | null; rest: string } {
  const t = (s ?? '').trim();
  if (!t) return { postcode: null, rest: '' };
  const m = t.match(/(?:^|[^\d])(?:CH[-\s]?)?([1-9]\d{3})(?!\d)/i);
  if (!m) return { postcode: null, rest: t.replace(/\d+/g, ' ').trim() };
  const rest = t.replace(m[0], ' ').replace(/^CH[-\s]?/i, '').trim();
  return { postcode: m[1]!, rest };
}

/** Parses one-line or split input into street, number, postcode and town. */
export function parseAddress(input: AddressInput): ParsedAddress {
  const addr = (input.address ?? '').replace(/[\r\n\t]+/g, ', ').replace(/\s+/g, ' ').trim();
  const pcField = cleanPostcode(input.postcode);
  let postcode = pcField.postcode;
  let town = (input.city ?? '').trim() || pcField.rest || '';

  // Cut the address into comma parts; find "1003 Lausanne" in them or at the end of the last one.
  let parts = addr.split(/[,;]/).map((p) => p.trim()).filter(Boolean);
  while (parts.length > 1 && COUNTRY.test(parts[parts.length - 1]!)) parts.pop();
  // "5, rue de la Gare" and "Rue de la Gare, 5": a lone number belongs to the street next to it.
  const lone = (x: string) => /^(?:n[°ºo]?\.?\s*)?\d{1,3}\s*[a-zA-Z]?$/i.test(x);
  if (parts.length > 1 && lone(parts[0]!)) parts.splice(0, 2, `${parts[0]} ${parts[1]}`);
  else if (parts.length > 1) {
    const at = parts.findIndex((x, i) => i > 0 && lone(x));
    if (at > 0) parts.splice(at - 1, 2, `${parts[at - 1]} ${parts[at]}`);
  }
  let streetPart: string | null = null;
  const pcIdx = parts.findIndex((p) => /^(?:CH[-\s]?)?[1-9]\d{3}(?:\s+\p{L}.*)?$/iu.test(p) && parts.length > 1);
  if (pcIdx >= 0) {
    const pc = cleanPostcode(parts[pcIdx]);
    postcode = postcode ?? pc.postcode;
    town = town || pc.rest;
    parts = parts.filter((_, i) => i !== pcIdx);
  } else if (parts.length) {
    const lastIdx = parts.length - 1;
    const m =
      parts[lastIdx]!.match(/^(.+?)\s+(?:CH[-\s]?)?([1-9]\d{3})\s+(\p{L}[\p{L}\p{M}\d\s.'’/()-]*)$/iu) ??
      parts[lastIdx]!.match(/^(.*\D\s*\d{1,3}\s*[a-zA-Z]?)\s+(?:CH[-\s]?)?([1-9]\d{3})()$/iu);
    if (m && m[1]!.trim().length > 2) {
      postcode = postcode ?? m[2]!;
      town = town || (m[3] ?? '').trim();
      parts[lastIdx] = m[1]!.trim();
    }
  }
  if (parts.length > 1) {
    // "Rue de Bourg 27, Lausanne" or "Lausanne, Rue de Bourg 27"
    const idx = Math.max(0, parts.findIndex((p) => /\d/.test(p) && /\p{L}/u.test(p)));
    streetPart = parts[idx]!;
    const other = parts.find((p, i) => i !== idx && !/\d/.test(p));
    town = town || other || '';
  } else {
    streetPart = parts[0] ?? '';
  }
  const split = splitStreetNumber(streetPart);
  const street = expandAbbreviations(split.street);
  town = town.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return {
    street: /\p{L}{2}/u.test(street) ? street : '',
    streetKey: normaliseStreet(/\p{L}{2}/u.test(street) ? street : ''),
    streetAlts: streetAlternatives(/\p{L}{2}/u.test(street) ? street : ''),
    number: split.number,
    postcode,
    town: town || null,
  };
}

/** Multilingual names of the same town. */
const TOWN_ALIASES: string[][] = [
  ['geneve', 'genf', 'geneva', 'ginevra'],
  ['bern', 'berne', 'berna'],
  ['fribourg', 'freiburg', 'friburgo'],
  ['biel', 'bienne'],
  ['neuchatel', 'neuenburg'],
  ['sion', 'sitten'],
  ['delemont', 'delsberg'],
  ['morat', 'murten'],
  ['luzern', 'lucerne', 'lucerna'],
  ['solothurn', 'soleure', 'soletta'],
  ['chur', 'coire', 'coira'],
  ['saint gallen', 'sankt gallen', 'saint gall', 'san gallo', 'st gallen'],
  ['basel', 'bale', 'basilea'],
  ['zurich', 'zuerich', 'zurigo'],
  ['bellinzona', 'bellinzone', 'bellinz'],
  ['leuk', 'loeche'],
  ['visp', 'viege'],
  ['brig', 'brigue'],
  ['moutier', 'munster'],
  ['payerne', 'peterlingen'],
  ['grandson', 'gransee'],
  ['yverdon', 'iferten'],
  ['estavayer', 'stafis'],
];

const ALIAS_BY_KEY = new Map<string, number>();
TOWN_ALIASES.forEach((group, i) => group.forEach((n) => ALIAS_BY_KEY.set(compact(words(n)), i)));

const TOWN_STOPWORDS = new Set(['saint', 'sainte', 'san', 'bad', 'la', 'le', 'les', 'el', 'der', 'die', 'das', 'sankt']);

/** Do the input town and any of the candidate's names (locality, municipality) denote one place? */
export function townMatches(inputTown: string, candTowns: string[]): boolean {
  const parts = (s: string) => s.split(/[/]| - /).map((x) => words(x)).filter((w) => w.length);
  const canon = (w: string[]) => {
    const k = compact(w);
    return ALIAS_BY_KEY.has(k) ? `#${ALIAS_BY_KEY.get(k)}` : k;
  };
  for (const a of parts(inputTown)) {
    for (const b of candTowns.flatMap(parts)) {
      if (canon(a) === canon(b)) return true;
      // "Mex" ~ "Mex VD", "Lausanne" ~ "Lausanne 26": the shorter name is the start of the longer one
      const [short, long] = a.length <= b.length ? [a, b] : [b, a];
      if (short.every((w, i) => w === long[i]) && compact(short).length >= 3 && !(short.length === 1 && TOWN_STOPWORDS.has(short[0]!))) return true;
      if (compact(a).length >= 5 && compact(b).length >= 5 && damerauLevenshtein(compact(a), compact(b)) <= 1) return true;
    }
  }
  return false;
}

// ───────────────────────────── candidates and scoring ─────────────────────────────

export interface RawCandidate {
  label: string;
  lat: number;
  lon: number;
  source: 'swisstopo' | 'motis';
  street: string | null;
  number: string | null;
  zip: string | null;
  towns: string[];
  /** Position in the service's answer. */
  rank: number;
}

type NumberState = 'equal' | 'differ' | 'inputMissing' | 'candMissing';
type PostcodeState = 'equal' | 'differ' | 'missing';
type TownState = 'match' | 'mismatch' | 'unknown';

export interface Scored extends RawCandidate {
  streetKey: StreetKey;
  streetMatch: StreetMatch;
  numberState: NumberState;
  postcodeState: PostcodeState;
  townState: TownState;
  qualifies: boolean;
  score: number;
}

function numberParts(key: string): { n: number; suffix: string } {
  const m = key.match(/^(\d+(?:\.\d+)?)(.*)$/);
  return { n: m ? parseFloat(m[1]!) : NaN, suffix: m?.[2] ?? '' };
}

export function scoreCandidate(p: ParsedAddress, c: RawCandidate): Scored {
  const streetKey = normaliseStreet(c.street ?? '');
  const streetMatch = c.street ? compareStreets(p.streetAlts, streetAlternatives(c.street)) : { dist: 99, exactish: false, similar: false, sim: 0 };

  let numberState: NumberState;
  if (p.number === null) numberState = 'inputMissing';
  else if (c.number === null) numberState = 'candMissing';
  else numberState = p.number === c.number ? 'equal' : 'differ';

  const postcodeState: PostcodeState = !p.postcode ? 'missing' : c.zip === p.postcode ? 'equal' : 'differ';
  const townState: TownState = !p.town || !c.towns.length ? 'unknown' : townMatches(p.town, c.towns) ? 'match' : 'mismatch';

  // Something fits: the street, or postcode and town together.
  const qualifies = streetMatch.similar || (postcodeState === 'equal' && townState === 'match');

  const streetScore = streetMatch.exactish ? 1 - 0.08 * streetMatch.dist : streetMatch.similar ? 0.3 + 0.35 * streetMatch.sim : qualifies ? 0.1 : 0;
  let numScore: number;
  if (numberState === 'equal') numScore = 1;
  else if (numberState === 'inputMissing') numScore = 0.6;
  else if (numberState === 'candMissing') numScore = 0.2;
  else {
    const a = numberParts(p.number!);
    const b = numberParts(c.number!);
    numScore = a.n === b.n ? 0.5 : 0.15 + 0.15 / (1 + Math.abs(a.n - b.n));
  }
  let pcScore: number;
  if (postcodeState === 'equal') pcScore = townState === 'mismatch' ? 0.5 : 1;
  else if (postcodeState === 'missing') pcScore = townState === 'match' ? 0.8 : 0.6;
  else pcScore = townState === 'match' ? 0.4 : 0.15;
  const score = 0.45 * streetScore + 0.3 * numScore + 0.25 * pcScore;
  return { ...c, streetKey, streetMatch, numberState, postcodeState, townState, qualifies, score: Math.round(score * 1000) / 1000 };
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Chooses the best candidate and the reasons why it is not exact. Returns null when no candidate
 * has anything in common with the input.
 */
export interface Decision {
  result: GeocodeResult;
  /** The best candidate has a street similar to the input (otherwise it only shares postcode and town). */
  streetSimilar: boolean;
}

export function decide(p: ParsedAddress, cands: RawCandidate[], source: 'swisstopo' | 'motis'): Decision | null {
  const scored = cands.map((c) => scoreCandidate(p, c));
  const q = scored.filter((c) => c.qualifies).sort((a, b) => b.score - a.score || a.rank - b.rank);
  if (!q.length) return null;
  const best = q[0]!;

  // Several equally good candidates in different places?
  let ambiguous = false;
  if (best.numberState === 'equal' || best.numberState === 'inputMissing') {
    const tier = q.filter((c) => c.score >= best.score - 0.004);
    const seen = new Set<string>();
    const reps = tier.filter((c) => {
      if (best.numberState === 'equal') return true;
      const k = `${c.streetKey.key}|${c.zip}`; // no number given: one representative per street
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    ambiguous = reps.some((c) => c !== best && distanceM(c, best) > 100);
  }

  const reasons = new Set<string>();
  if (best.postcodeState !== 'equal' || (best.postcodeState === 'equal' && best.townState === 'mismatch')) reasons.add('postcode');
  if (best.numberState === 'differ' || best.numberState === 'candMissing') reasons.add('houseNumber');
  if (best.numberState === 'inputMissing') reasons.add('noNumber');
  if (!best.streetMatch.exactish) reasons.add('street');
  if (ambiguous) reasons.add('ambiguous');
  if (source === 'motis') reasons.add('fallback');

  // Without a number the position is "the street": take the candidate in the middle of its street.
  let pos = best;
  if (best.numberState === 'inputMissing') {
    const sameStreet = q.filter((c) => c.streetKey.key === best.streetKey.key && c.zip === best.zip);
    if (sameStreet.length > 2) {
      const cLat = sameStreet.reduce((s, c) => s + c.lat, 0) / sameStreet.length;
      const cLon = sameStreet.reduce((s, c) => s + c.lon, 0) / sameStreet.length;
      pos = sameStreet.reduce((a, c) => (distanceM(c, { lat: cLat, lon: cLon }) < distanceM(a, { lat: cLat, lon: cLon }) ? c : a));
    }
  }

  const seenLabels = new Set<string>();
  const candidates: AddressCandidate[] = [];
  const ordered = [pos, ...q.filter((c) => c !== pos)];
  for (const c of ordered) {
    const k = `${c.label}|${c.lat.toFixed(5)}|${c.lon.toFixed(5)}`;
    if (seenLabels.has(k)) continue;
    seenLabels.add(k);
    candidates.push({ label: c.label, lat: c.lat, lon: c.lon, score: round2(c.score), source: c.source });
    if (candidates.length === 5) break;
  }

  const ordered_reasons = REASON_ORDER.filter((r) => reasons.has(r));
  const exact = ordered_reasons.length === 0;
  return {
    streetSimilar: best.streetMatch.similar,
    result: {
      status: exact ? 'exact' : 'check',
      lat: pos.lat,
      lon: pos.lon,
      matched: pos.label,
      candidates,
      reasons: [...ordered_reasons],
    },
  };
}

// ───────────────────────────── services ─────────────────────────────

const stripTags = (s: string) =>
  s
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

interface SwisstopoResult {
  attrs?: { label?: string; detail?: string; lat?: number; lon?: number; featureId?: string };
}

/** One register entry of the swisstopo search answer. */
export function parseSwisstopoResult(r: SwisstopoResult, rank: number): RawCandidate | null {
  const a = r.attrs;
  if (!a || typeof a.lat !== 'number' || typeof a.lon !== 'number' || !a.label) return null;
  // label: "Rue de Bourg 27 <b>1003 Lausanne</b>"
  const bold = a.label.match(/<b>(.*?)<\/b>/);
  const left = stripTags(bold ? a.label.slice(0, bold.index) : a.label);
  const zipLocality = stripTags(bold ? bold[1]! : '');
  const zm = zipLocality.match(/^(\d{4})\s+(.*)$/);
  const { street, number } = splitStreetNumber(left);
  const towns: string[] = [];
  if (zm) towns.push(zm[2]!);
  // detail: "rue de bourg 27 1003 lausanne 5586 lausanne ch vd" -> municipality after the BFS number
  if (zm && a.detail) {
    const at = a.detail.lastIndexOf(` ${zm[1]} `);
    if (at >= 0) {
      const rest = a.detail.slice(at + 6);
      const m = rest.match(/^.*?\s+\d{1,4}\s+(.*?)\s+ch\s+[a-z]{2}\s*$/);
      if (m) towns.push(m[1]!.replace(/_/g, ' '));
    }
  }
  return {
    label: zm ? `${left}, ${zipLocality}` : left,
    lat: a.lat,
    lon: a.lon,
    source: 'swisstopo',
    street: street || null,
    number,
    zip: zm ? zm[1]! : null,
    towns,
    rank,
  };
}

interface MotisItem {
  type?: string;
  name?: string;
  street?: string;
  houseNumber?: string;
  zip?: string;
  lat?: number;
  lon?: number;
  areas?: { name: string; adminLevel?: number }[];
}

export function parseMotisItem(r: MotisItem, rank: number): RawCandidate | null {
  if (typeof r.lat !== 'number' || typeof r.lon !== 'number') return null;
  if (r.type && !['ADDRESS', 'PLACE', 'STOP'].includes(r.type)) return null;
  const towns = (r.areas ?? []).filter((x) => (x.adminLevel ?? 0) >= 7).map((x) => x.name);
  const street = r.street ?? (r.type === 'ADDRESS' ? null : (r.name ?? null));
  const number = r.houseNumber ? houseNumberKey(r.houseNumber) : null;
  const where = [r.zip, towns[towns.length - 1]].filter(Boolean).join(' ');
  return {
    label: [r.name ?? [street, r.houseNumber].filter(Boolean).join(' '), where].filter(Boolean).join(', '),
    lat: r.lat,
    lon: r.lon,
    source: 'motis',
    street,
    number,
    zip: r.zip && /^\d{4}$/.test(r.zip) ? r.zip : null,
    towns,
    rank,
  };
}

/** At most `max` calls at a time. */
function limiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve)); // the slot is handed over
    else active++;
    try {
      return await fn();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const notFound = (): GeocodeResult => ({ status: 'notfound', candidates: [], reasons: [] });

export function createGeocoder(deps: GeocodeDeps = {}): { check(input: AddressInput): Promise<GeocodeResult> } {
  const doFetch = deps.fetch ?? httpGet;
  const swisstopo = (deps.swisstopoUrl ?? 'https://api3.geo.admin.ch').replace(/\/+$/, '');
  const motis = (deps.motisUrl ?? 'http://127.0.0.1:8080').replace(/\/+$/, '');
  /** Fair use of the public service: at most 4 requests in flight. */
  const limit = limiter(4);

  async function getJson(url: string): Promise<unknown> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await doFetch(url);
        if (res.ok) return await res.json();
        lastErr = new Error(`HTTP ${res.status}`);
        if (res.status < 500 && res.status !== 429) break;
      } catch (e) {
        lastErr = e;
      }
      await sleep(300);
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  /** Only the address text goes out, never an identifier. */
  async function searchSwisstopo(text: string): Promise<RawCandidate[]> {
    const url = `${swisstopo}/rest/services/api/SearchServer?searchText=${encodeURIComponent(text)}&type=locations&origins=address&limit=5&sr=4326`;
    const body = (await limit(() => getJson(url))) as { results?: SwisstopoResult[] };
    return (body.results ?? []).map((r, i) => parseSwisstopoResult(r, i)).filter((c): c is RawCandidate => c !== null);
  }

  async function searchMotis(text: string): Promise<RawCandidate[]> {
    const url = `${motis}/api/v1/geocode?text=${encodeURIComponent(text)}`;
    const body = (await getJson(url)) as MotisItem[];
    return (Array.isArray(body) ? body : []).map((r, i) => parseMotisItem(r, i)).filter((c): c is RawCandidate => c !== null);
  }

  async function check(input: AddressInput): Promise<GeocodeResult> {
    const p = parseAddress(input);
    // Nothing to look for: empty or garbage input, or no street at all.
    if (!p.street) return notFound();

    const base = [p.street, p.number ?? ''].filter(Boolean).join(' ');
    const queries = [[base, p.postcode ?? p.town ?? ''].filter(Boolean).join(' ')];
    // The postcode may be the wrong part: ask again with the town (or without the postcode).
    if (p.postcode) queries.push([base, p.town ?? ''].filter(Boolean).join(' '));
    // The name may have a typo the service cannot digest: ask with the beginning of the long words.
    const stem = p.street.replace(/\p{L}{6,}/gu, (w) => w.slice(0, 5));
    if (stem !== p.street) queries.push([[stem, p.number ?? ''].filter(Boolean).join(' '), p.postcode ?? p.town ?? ''].filter(Boolean).join(' '));

    let swissFailed = 0;
    let swissAsked = 0;
    let weak: GeocodeResult | null = null; // a candidate that only shares postcode and town with the input
    for (const q of [...new Set(queries)]) {
      swissAsked++;
      try {
        const found = await searchSwisstopo(q);
        const d = decide(p, found, 'swisstopo');
        if (d) {
          if (d.streetSimilar) return d.result;
          weak ??= d.result;
        }
      } catch {
        swissFailed++;
      }
    }

    // Fallback: the local MOTIS geocoder. A fallback match is never better than "check".
    const text = [base, [p.postcode, p.town].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    try {
      const found = await searchMotis(text);
      const d = decide(p, found, 'motis');
      if (d && (d.streetSimilar || !weak)) return d.result;
      return weak ?? notFound();
    } catch (e) {
      // Both sources failed (network down): do not call it "not found", let the caller retry.
      if (swissFailed === swissAsked && !weak) throw e instanceof Error ? e : new Error(String(e));
      return weak ?? notFound();
    }
  }

  return { check };
}
