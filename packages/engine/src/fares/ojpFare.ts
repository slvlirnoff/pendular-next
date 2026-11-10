/**
 * Client for the Swiss "OJP Fare" API (opentransportdata.swiss, NOVA-backed): quoted price of a
 * single ticket for a public transport trip. See data/tariffs/OJP-FARE-NOTES.md for the format,
 * limits and what was (not) verified against the live service.
 *
 * - buildFareRequest: pure, OJP 1.0 XML (the documented request format).
 * - parseFareResponse: pure, tolerant mini-parser (no XML library available).
 * - createOjpFareClient: cache, request spacing, timeout; resolves null on any failure so the
 *   engine falls back to estimates.
 */
import { TRANSIT_MODES } from '../types.js';
import type { Leg, LegMode, StopPoint, TravelClass } from '../types.js';

export const OJP_FARE_URL = 'https://api.opentransportdata.swiss/ojpfare';

export interface FareQuote {
  /** Price of one single ticket, CHF (VAT included). */
  single: number;
  currency: string;
  travelClass: TravelClass;
  /** True when the price was requested with the Half Fare entitlement. */
  half: boolean;
  fareAuthority?: string;
  productName?: string;
  /** NOVA product id (125 = normal point-to-point ticket). */
  productId?: string;
  /** TripLeg id range the product covers (a trip can be split into several tickets). */
  fromLeg?: string;
  toLeg?: string;
}

export interface FareOptions {
  travelClass: TravelClass;
  halfFare: boolean;
  now?: Date;
}

const PT_MODE: Partial<Record<LegMode, string>> = {
  rail: 'rail',
  bus: 'bus',
  tram: 'tram',
  metro: 'metro',
  boat: 'water',
  funicular: 'funicular',
  cableway: 'telecabin',
};

/** Day passes NOVA sometimes substitutes when no first-class ticket exists (doc: "Bekannte Probleme"). */
const DAY_PASS_PRODUCT_IDS = new Set(['2361']);

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const utc = (iso: string): string => {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) throw new Error(`invalid date: ${iso}`);
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
};

const isoDuration = (ms: number): string => {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `PT${h ? `${h}H` : ''}${m || !h ? `${m}M` : ''}`;
};

const isTransit = (l: Leg): boolean => TRANSIT_MODES.includes(l.mode);

function stopRef(p: StopPoint): string {
  if (!p.stopId) throw new Error(`stop without stopId: ${p.name}`);
  return p.stopId;
}

/** Transit legs only: OJP Fare prices public transport legs, nothing else. */
export function transitLegs(legs: Leg[]): Leg[] {
  return legs.filter(isTransit);
}

/** Stop sequence of the priced legs, used as cache key. */
export function stopSequenceKey(legs: Leg[]): string {
  return transitLegs(legs)
    .map((l) => `${l.from.stopId ?? '?'}>${l.to.stopId ?? '?'}`)
    .join('|');
}

function quote(
  tag: 'LegBoard' | 'LegAlight' | 'LegIntermediates',
  p: StopPoint,
  order: number,
  arr?: string,
  dep?: string,
): string {
  const lines = [
    `<${tag}>`,
    `  <StopPointRef>${esc(stopRef(p))}</StopPointRef>`,
    `  <ojp:StopPointName><ojp:Text>${esc(p.name)}</ojp:Text></ojp:StopPointName>`,
  ];
  if (arr) lines.push(`  <ojp:ServiceArrival><ojp:TimetabledTime>${arr}</ojp:TimetabledTime></ojp:ServiceArrival>`);
  if (dep) lines.push(`  <ojp:ServiceDeparture><ojp:TimetabledTime>${dep}</ojp:TimetabledTime></ojp:ServiceDeparture>`);
  lines.push(`  <ojp:Order>${order}</ojp:Order>`, `</${tag}>`);
  return lines.join('\n');
}

function indent(s: string, n: number): string {
  const pad = ' '.repeat(n);
  return s
    .split('\n')
    .map((l) => pad + l)
    .join('\n');
}

function timedLeg(leg: Leg, id: number): string {
  const dep = utc(leg.departure);
  const arr = utc(leg.arrival);
  const t0 = new Date(dep).getTime();
  const t1 = new Date(arr).getTime();
  const mids = (leg.intermediateStops ?? []).filter((s) => s.stopId);
  const parts: string[] = [quote('LegBoard', leg.from, 1, undefined, dep)];
  mids.forEach((s, i) => {
    // Intermediate times are not in the engine's itinerary: interpolate evenly between board and alight.
    const t = new Date(Math.round((t0 + ((t1 - t0) * (i + 1)) / (mids.length + 1)) / 1000) * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z');
    parts.push(quote('LegIntermediates', s, i + 2, t, t));
  });
  parts.push(quote('LegAlight', leg.to, mids.length + 2, arr));
  const name = leg.line?.name ?? leg.line?.category ?? 'X';
  const op = leg.line?.operator ?? 'unknown';
  const day = leg.departure.slice(0, 10);
  const ref = `${name}:${leg.from.stopId}:${dep}`.replace(/\s+/g, '');
  const service = [
    '<ojp:Service>',
    `  <ojp:OperatingDayRef>${day}</ojp:OperatingDayRef>`,
    `  <ojp:JourneyRef>${esc(`ojp:pendular:${ref}`)}</ojp:JourneyRef>`,
    `  <LineRef>${esc(`ojp:${op.replace(/\s+/g, '')}:${name.replace(/\s+/g, '')}`)}</LineRef>`,
    '  <DirectionRef>H</DirectionRef>',
    `  <ojp:Mode><ojp:PtMode>${PT_MODE[leg.mode] ?? 'rail'}</ojp:PtMode></ojp:Mode>`,
    `  <ojp:PublishedLineName><ojp:Text>${esc(name)}</ojp:Text></ojp:PublishedLineName>`,
    `  <ojp:OperatorRef>${esc(`ojp:${op}`)}</ojp:OperatorRef>`,
    `  <ojp:DestinationText><ojp:Text>${esc(leg.line?.headsign ?? leg.to.name)}</ojp:Text></ojp:DestinationText>`,
    '</ojp:Service>',
  ];
  return [
    '<ojp:TripLeg>',
    `  <ojp:LegId>${id}</ojp:LegId>`,
    '  <ojp:TimedLeg>',
    indent(parts.join('\n'), 4),
    indent(service.join('\n'), 4),
    '  </ojp:TimedLeg>',
    '</ojp:TripLeg>',
  ].join('\n');
}

function transferLeg(a: Leg, b: Leg, id: number): string {
  const s = utc(a.arrival);
  const e = utc(b.departure);
  const dur = isoDuration(new Date(e).getTime() - new Date(s).getTime());
  const end = (tag: string, p: StopPoint): string =>
    `  <${tag}>\n    <StopPointRef>${esc(stopRef(p))}</StopPointRef>\n    <ojp:LocationName><ojp:Text>${esc(p.name)}</ojp:Text></ojp:LocationName>\n  </${tag}>`;
  return [
    '<ojp:TripLeg>',
    `  <ojp:LegId>${id}</ojp:LegId>`,
    '  <ojp:TransferLeg>',
    '    <ojp:TransferMode>walk</ojp:TransferMode>',
    indent(end('ojp:LegStart', a.to), 2),
    indent(end('ojp:LegEnd', b.from), 2),
    `    <ojp:TimeWindowStart>${s}</ojp:TimeWindowStart>`,
    `    <ojp:TimeWindowEnd>${e}</ojp:TimeWindowEnd>`,
    `    <ojp:Duration>${dur}</ojp:Duration>`,
    '  </ojp:TransferLeg>',
    '</ojp:TripLeg>',
  ].join('\n');
}

/**
 * OJP 1.0 OJPFareRequest for one trip made of the transit legs in `legs` (walking/other legs are
 * dropped; a transfer leg is inserted between consecutive transit legs). Throws when there is no
 * transit leg or a stop has no stopId.
 */
export function buildFareRequest(legs: Leg[], opts: FareOptions): string {
  const tl = transitLegs(legs);
  const first = tl[0];
  const last = tl[tl.length - 1];
  if (!first || !last) throw new Error('no transit leg to price');
  const stamp = (opts.now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const start = utc(first.departure);
  const end = utc(last.arrival);
  const tripLegs: string[] = [];
  let id = 1;
  tl.forEach((l, i) => {
    const prev = tl[i - 1];
    if (prev) tripLegs.push(transferLeg(prev, l, id++));
    tripLegs.push(timedLeg(l, id++));
  });
  const traveller = opts.halfFare
    ? [
        '<ojp:Traveller>',
        '  <ojp:PassengerCategory>Adult</ojp:PassengerCategory>',
        '  <ojp:EntitlementProduct>HTA</ojp:EntitlementProduct>',
        '</ojp:Traveller>',
      ]
    : [];
  const params = [
    '<ojp:Params>',
    '  <ojp:FareAuthorityFilter>ch:1:NOVA</ojp:FareAuthorityFilter>',
    '  <ojp:PassengerCategory>Adult</ojp:PassengerCategory>',
    `  <ojp:TravelClass>${opts.travelClass === 1 ? 'first' : 'second'}</ojp:TravelClass>`,
    ...traveller.map((l) => `  ${l}`),
    '</ojp:Params>',
  ];
  const trip = [
    '<ojp:Trip>',
    `  <ojp:TripId>pendular-${stamp}</ojp:TripId>`,
    `  <ojp:Duration>${isoDuration(new Date(end).getTime() - new Date(start).getTime())}</ojp:Duration>`,
    `  <ojp:StartTime>${start}</ojp:StartTime>`,
    `  <ojp:EndTime>${end}</ojp:EndTime>`,
    `  <ojp:Transfers>${tl.length - 1}</ojp:Transfers>`,
    indent(tripLegs.join('\n'), 2),
    '</ojp:Trip>',
  ].join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<OJP xmlns="http://www.siri.org.uk/siri" xmlns:ojp="http://www.vdv.de/ojp" version="1.0">',
    '  <OJPRequest>',
    '    <ServiceRequest>',
    `      <RequestTimestamp>${stamp}</RequestTimestamp>`,
    '      <RequestorRef>pendular</RequestorRef>',
    '      <ojp:OJPFareRequest>',
    `        <RequestTimestamp>${stamp}</RequestTimestamp>`,
    '        <ojp:TripFareRequest>',
    indent(trip, 10),
    '        </ojp:TripFareRequest>',
    indent(params.join('\n'), 8),
    '      </ojp:OJPFareRequest>',
    '    </ServiceRequest>',
    '  </OJPRequest>',
    '</OJP>',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------------------------

const unesc = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();

/** Text of the first element with this local name (any namespace prefix), or undefined. */
function tag(xml: string, local: string): string | undefined {
  const m = new RegExp(`<(?:[\\w.-]+:)?${local}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${local}>`).exec(xml);
  return m && m[1] !== undefined ? unesc(m[1].replace(/<[^>]+>/g, '')) : undefined;
}

/** Inner XML of every element with this local name. */
function blocks(xml: string, local: string): string[] {
  const re = new RegExp(`<(?:[\\w.-]+:)?${local}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${local}>`, 'g');
  const out: string[] = [];
  for (let m = re.exec(xml); m; m = re.exec(xml)) out.push(m[1] ?? '');
  return out;
}

/**
 * Fare products of an OJPFareDelivery. Returns [] on errors (Status false, ErrorCondition) and
 * when no priced product is present. The response does not say whether the Half Fare entitlement
 * was applied, so `half` comes from `hint.half` (what was requested).
 */
export function parseFareResponse(xml: string, hint: { half?: boolean } = {}): FareQuote[] {
  if (!xml) return [];
  if (/<(?:[\w.-]+:)?ErrorCondition[\s>]/.test(xml)) return [];
  const status = tag(xml, 'Status');
  if (status !== undefined && status.toLowerCase() === 'false') return [];
  const out: FareQuote[] = [];
  const results = blocks(xml, 'TripFareResult');
  const items = results.length ? results : [xml];
  for (const r of items) {
    const fromLeg = tag(r, 'FromTripLegIdRef');
    const toLeg = tag(r, 'ToTripLegIdRef');
    for (const p of blocks(r, 'FareProduct')) {
      const price = Number(tag(p, 'Price'));
      const cls = (tag(p, 'TravelClass') ?? '').toLowerCase();
      const travelClass: TravelClass | null =
        cls === 'first' || cls === '1' ? 1 : cls === 'second' || cls === '2' ? 2 : null;
      if (!Number.isFinite(price) || tag(p, 'Price') === '' || travelClass === null) continue;
      const q: FareQuote = {
        single: price,
        currency: tag(p, 'Currency') ?? 'CHF',
        travelClass,
        half: hint.half ?? false,
      };
      const authority = tag(p, 'FareAuthorityText') ?? tag(p, 'FareAuthorityRef');
      if (authority) q.fareAuthority = authority;
      const name = tag(p, 'FareProductName');
      if (name) q.productName = name;
      const id = tag(p, 'FareProductId');
      if (id) q.productId = id;
      if (fromLeg) q.fromLeg = fromLeg;
      if (toLeg) q.toLeg = toLeg;
      out.push(q);
    }
  }
  return out;
}

/**
 * Total of a trip for one class: day-pass substitutes are dropped, alternatives covering the same
 * leg range are reduced to the cheapest, and the remaining ranges (several tickets for one trip)
 * are summed. Null when nothing usable.
 */
export function totalForClass(quotes: FareQuote[], travelClass: TravelClass): FareQuote | null {
  const usable = quotes.filter(
    (q) => q.travelClass === travelClass && !(q.productId && DAY_PASS_PRODUCT_IDS.has(q.productId)),
  );
  if (!usable.length) return null;
  const byRange = new Map<string, FareQuote>();
  for (const q of usable) {
    const k = `${q.fromLeg ?? ''}-${q.toLeg ?? ''}`;
    const cur = byRange.get(k);
    if (!cur || q.single < cur.single) byRange.set(k, q);
  }
  const parts = [...byRange.values()];
  const head = parts[0];
  if (!head) return null;
  if (parts.length === 1) return head;
  const sum = Math.round(parts.reduce((a, q) => a + q.single, 0) * 100) / 100;
  return { ...head, single: sum, productName: parts.map((q) => q.productName ?? q.productId ?? '?').join('+') };
}

// ---------------------------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------------------------

export interface OjpFareClientOptions {
  url?: string;
  token?: string;
  fetch?: typeof fetch;
  /** Minimum time between two requests, ms (API limit: 50/min). Default 1300. */
  minIntervalMs?: number;
}

export interface OjpFareClient {
  quote(legs: Leg[], opts: FareOptions): Promise<FareQuote | null>;
}

const TIMEOUT_MS = 6000;

export function createOjpFareClient(o: OjpFareClientOptions = {}): OjpFareClient {
  const url = o.url ?? OJP_FARE_URL;
  const minInterval = o.minIntervalMs ?? 1300;
  const doFetch = o.fetch ?? (typeof fetch === 'function' ? fetch : undefined);
  const cache = new Map<string, FareQuote | null>();
  const inflight = new Map<string, Promise<FareQuote | null>>();
  let chain: Promise<unknown> = Promise.resolve();
  let lastCall = 0;

  const token = (): string | undefined => o.token ?? process.env['OJP_FARE_TOKEN'];

  const spaced = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(async () => {
      const wait = lastCall + minInterval - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastCall = Date.now();
      return fn();
    });
    chain = run.catch(() => undefined);
    return run;
  };

  async function call(legs: Leg[], opts: FareOptions): Promise<FareQuote | null> {
    const key = o.token ?? process.env['OJP_FARE_TOKEN'];
    if (!key || !doFetch) return null;
    const body = buildFareRequest(legs, opts);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml', Authorization: `Bearer ${key}` },
        body,
        signal: ctl.signal,
      });
      if (!res.ok) return null;
      const quotes = parseFareResponse(await res.text(), { half: opts.halfFare });
      return totalForClass(quotes, opts.travelClass);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async quote(legs, opts) {
      try {
        if (!token() || !transitLegs(legs).length) return null;
        const key = `${stopSequenceKey(legs)}#${opts.travelClass}#${opts.halfFare ? 'h' : 'f'}`;
        if (cache.has(key)) return cache.get(key) ?? null;
        let p = inflight.get(key);
        if (!p) {
          p = spaced(() => call(legs, opts))
            .catch(() => null)
            .then((r) => {
              // Only successful quotes are cached; failures may be transient.
              if (r) cache.set(key, r);
              return r;
            })
            .finally(() => inflight.delete(key));
          inflight.set(key, p);
        }
        return await p;
      } catch {
        return null;
      }
    },
  };
}
