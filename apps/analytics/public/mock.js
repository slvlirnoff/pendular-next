// In-memory stand-in for the API (only used with ?mock=1). Mimics background work: each GET advances it.
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const streets = ['Rue du Lac', 'Avenue de Cour', 'Bahnhofstrasse', 'Chemin des Vignes', 'Route de Berne', 'Rue de la Gare'];
const towns = [['1003', 'Lausanne'], ['1020', 'Renens'], ['1110', 'Morges'], ['1800', 'Vevey'], ['1510', 'Moudon'], ['1530', 'Payerne']];
const places = [
  { label: 'Lausanne, Gare CFF', type: 'station', lat: 46.5168, lon: 6.629 }, { label: 'Lausanne, Avenue de Rhodanie 2', type: 'address', lat: 46.5093, lon: 6.6256 },
  { label: 'Renens VD, Gare', type: 'station', lat: 46.5388, lon: 6.5878 }, { label: 'Bern, Bundesplatz 3', type: 'address', lat: 46.9466, lon: 7.4441 },
  { label: 'Fribourg, Route de la Fonderie 8', type: 'address', lat: 46.8, lon: 7.15 },
];
const db = { lists: {}, people: {}, analyses: {}, results: {}, n: 3 };
const reasonsPool = ['postcode', 'houseNumber', 'street', 'ambiguous', 'noNumber', 'fallback'];

function mkPerson(listId, i, status) {
  const [pc, city] = pick(towns);
  const p = { id: db.n++, listId, extId: 'P' + String(i + 1).padStart(4, '0'), address: `${pick(streets)} ${1 + Math.floor(rnd() * 80)}`, postcode: pc, city,
    attrs: { department: pick(['Operations', 'Finance', 'Care', 'IT']), shift: pick(['day', 'early', 'late']) }, status, lat: null, lon: null, matched: null, candidates: [], reasons: [] };
  resolve(p, status);
  return p;
}
function resolve(p, status) {
  const base = { lat: 46.5 + rnd() * 0.3, lon: 6.5 + rnd() * 0.3 };
  p.status = status;
  if (status === 'exact') { Object.assign(p, base, { matched: `${p.address}, ${p.postcode} ${p.city}`, candidates: [], reasons: [] }); }
  else if (status === 'check') {
    p.reasons = [pick(reasonsPool), pick(reasonsPool)].filter((v, i, a) => a.indexOf(v) === i);
    p.candidates = [0, 1, 2].map((k) => ({ label: `${p.address.replace(/\d+/, (n) => +n + k)}, ${p.postcode} ${p.city}`, lat: base.lat + k * 0.001, lon: base.lon, score: 0.9 - k * 0.2, source: 'swisstopo' }));
    Object.assign(p, { lat: p.candidates[0].lat, lon: p.candidates[0].lon, matched: p.candidates[0].label });
  } else if (status === 'notfound') { p.reasons = ['street']; p.candidates = []; p.lat = p.lon = p.matched = null; }
}
function summary(l) {
  const ps = db.people[l.id], by = { pending: 0, exact: 0, check: 0, notfound: 0, manual: 0 };
  ps.forEach((p) => by[p.status]++);
  return { id: l.id, name: l.name, version: l.version, createdAt: l.createdAt, updatedAt: l.updatedAt, people: ps.length, byStatus: by };
}
function addList(id, name, n, pend) {
  db.lists[id] = { id, name, version: 1, createdAt: '2026-11-0' + (id === 'l1' ? 3 : 8) + 'T09:00:00Z', updatedAt: '2026-11-08T10:00:00Z' };
  db.people[id] = Array.from({ length: n }, (_, i) => {
    const r = rnd(), st = pend ? 'pending' : r < 0.6 ? 'exact' : r < 0.82 ? 'check' : r < 0.9 ? 'notfound' : 'manual';
    return mkPerson(id, i, st);
  });
}
function advancePending(id) {
  for (const p of db.people[id]) if (p.status === 'pending' && rnd() < 0.5) resolve(p, rnd() < 0.6 ? 'exact' : rnd() < 0.6 ? 'check' : 'notfound');
}
function mkResults(a) {
  const ps = db.people[a.listId].filter((p) => p.lat != null);
  return ps.map((p) => {
    const dist = 3 + rnd() * 40, car = Math.round(8 + dist * 1.1), pt = rnd() < 0.12 ? null : Math.round(15 + dist * (1.2 + rnd() * 1.6));
    const ratio = pt == null ? Infinity : pt / car;
    return { personId: p.id, extId: p.extId, attrs: p.attrs, lat: p.lat, lon: p.lon, ptMin: pt, ptChanges: pt == null ? null : Math.floor(rnd() * 3), ptDepartures: 4,
      ptCost: pt == null ? null : 900 + Math.round(rnd() * 1400), ptProduct: 'GA', boardStop: pt == null ? null : pick(['Moudon', 'Payerne', 'Renens VD', 'Morges', 'Lausanne']),
      carMin: car, carKm: Math.round(dist), carCost: 5200, bikeMin: dist < 18 ? Math.round(dist * 4.2) : null, ebikeMin: dist < 30 ? Math.round(dist * 3) : null,
      walkMin: dist < 2 ? 20 : null, co2Pt: 100, co2Car: 900,
      ratioClass: ratio === Infinity ? 'noPt' : ratio <= 1 ? 'ptFaster' : ratio <= 1.5 ? 'upTo1_5' : ratio <= 2 ? 'upTo2' : 'over2', error: null };
  });
}
function indicators(rows, by) {
  const n = rows.length || 1, share = (f) => rows.filter(f).length / n;
  const med = (k) => { const v = rows.map((r) => r[k]).filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const ratio = { ptFaster: 0, upTo1_5: 0, upTo2: 0, over2: 0, noPt: 0 }; rows.forEach((r) => ratio[r.ratioClass]++);
  const stops = {}; rows.forEach((r) => r.boardStop && (stops[r.boardStop] = (stops[r.boardStop] || 0) + 1));
  const good = rows.filter((r) => r.ptMin != null && r.ratioClass !== 'over2').length;
  const cyc = rows.filter((r) => r.ptMin == null || r.ratioClass === 'over2').filter((r) => r.ebikeMin != null && r.ebikeMin <= 30).length;
  const out = { people: rows.length, analysed: rows.length,
    ptWithin: { min30: share((r) => r.ptMin != null && r.ptMin <= 30), min45: share((r) => r.ptMin != null && r.ptMin <= 45), min60: share((r) => r.ptMin != null && r.ptMin <= 60) },
    bikeWithin20: share((r) => r.bikeMin != null && r.bikeMin <= 20), ebikeWithin30: share((r) => r.ebikeMin != null && r.ebikeMin <= 30), walkWithin20: share((r) => r.walkMin != null && r.walkMin <= 20),
    ratio, median: { pt: med('ptMin'), car: med('carMin'), bike: med('bikeMin'), ebike: med('ebikeMin') },
    boardStops: Object.entries(stops).map(([name, people]) => ({ name, people })).sort((a, b) => b.people - a.people),
    segments: { goodPt: good, cycling: cyc, noAlternative: rows.length - good - cyc } };
  if (by) {
    const g = {}; rows.forEach((r) => (g[r.attrs[by] ?? ''] ||= []).push(r));
    out.by = { attribute: by, groups: Object.entries(g).map(([value, rs]) => ({ value, indicators: indicators(rs) })) };
  }
  return out;
}
function advanceAnalysis(a) {
  if (a.status === 'queued') {
    if (db.people[a.listId].some((p) => p.status === 'pending')) return;
    a.status = 'running'; a.total = db.people[a.listId].filter((p) => p.lat != null).length;
  } else if (a.status === 'running') {
    a.progress = Math.min(a.total, a.progress + Math.ceil(a.total / 4));
    if (a.progress >= a.total) { a.status = 'done'; a.finishedAt = new Date().toISOString(); db.results[a.id] = mkResults(a); a.outdated = false; }
  }
}
const full = (a) => ({ ...a, indicators: a.status === 'done' ? indicators(db.results[a.id]) : null });

function compare(row) {
  const mk = (kind, title, min, cost, legs) => ({ id: kind, kind, title, durationMin: min, changes: kind === 'transit' ? row.ptChanges ?? 0 : 0, cost: { yearly: cost, products: [], extras: [], provenance: 'tariff' }, co2KgPerYear: kind === 'car' ? 900 : 100, hoursPerYear: 100,
    kmByMode: {}, itinerary: { departure: '', arrival: '', durationMin: min, changes: 0, legs } });
  const leg = (mode, f, t, d, m, line) => ({ mode, from: { name: f }, to: { name: t }, departure: `2026-11-10T${d}:00+01:00`, arrival: `2026-11-10T${d.slice(0, 3)}${String(+d.slice(3) + m).padStart(2, '0')}:00+01:00`, durationMin: m, distanceM: m * 300, line: line && { name: line } });
  const opts = [];
  if (row.ptMin != null) opts.push(mk('transit', `${row.boardStop} → Lausanne, IR 15`, row.ptMin, row.ptCost, [leg('walk', 'Home', row.boardStop, '07:05', 8), leg('rail', row.boardStop, 'Lausanne', '07:15', row.ptMin - 20, 'IR 15'), leg('walk', 'Lausanne', 'Work site', '07:50', 12)]));
  opts.push(mk('car', 'Direct by car', row.carMin, 5200, [leg('car', 'Home', 'Work site', '07:30', row.carMin)]));
  if (row.bikeMin) opts.push(mk('bike', 'Direct by bike', row.bikeMin, 300, [leg('bike', 'Home', 'Work site', '07:30', row.bikeMin)]));
  return { options: opts, leftOut: [], verdict: { cheapest: 'bike', fastest: 'car', greenest: 'bike', costPerHourSaved: {} }, stamp: {} };
}

addList('l1', 'Staff Lausanne 2026', 120, false);
addList('l2', 'Pilot depot', 8, false);
db.analyses.a1 = { id: 'a1', listId: 'l1', name: 'Lausanne site, mornings', site: places[1], arrival: { from: '07:00', to: '09:00' }, weekdays: ['mon', 'tue', 'wed', 'thu', 'fri'],
  settings: { kinds: ['transit', 'car', 'bike', 'ebike', 'walk'] }, status: 'done', outdated: true, progress: 90, total: 90, error: null, createdAt: '2026-11-08T11:00:00Z', finishedAt: '2026-11-08T11:03:00Z' };
db.results.a1 = mkResults(db.analyses.a1);
db.analyses.a1.total = db.analyses.a1.progress = db.results.a1.length;

export async function handle(method, path, body) {
  await wait(120);
  const [p, qs] = path.split('?'), q = new URLSearchParams(qs || ''), seg = p.split('/').slice(2);
  const [res, id, sub, sub2] = seg;
  const bad = (m, c = 404) => { throw new Error(m); };
  if (res === 'health') return { ok: true, queue: { pendingAddresses: 0, queuedAnalyses: 0 } };
  if (res === 'places') { const t = (q.get('q') || '').toLowerCase(); return places.filter((x) => x.label.toLowerCase().includes(t)); }
  if (res === 'lists') {
    if (!id) {
      if (method === 'GET') return Object.values(db.lists).map(summary);
      const lid = 'l' + (Object.keys(db.lists).length + 1);
      db.lists[lid] = { id: lid, name: body.name, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      db.people[lid] = body.rows.map((r, i) => ({ id: db.n++, listId: lid, extId: r.extId, address: r.address ?? null, postcode: r.postcode ?? null, city: r.city ?? null, attrs: r.attrs || {}, status: 'pending', lat: null, lon: null, matched: null, candidates: [], reasons: [] }));
      return summary(db.lists[lid]);
    }
    const l = db.lists[id]; if (!l) bad('List not found');
    if (!sub) {
      if (method === 'DELETE') { delete db.lists[id]; return { ok: true }; }
      advancePending(id);
      return { ...summary(l), analyses: Object.values(db.analyses).filter((a) => a.listId === id).map((a) => { advanceAnalysis(a); return a; }) };
    }
    if (sub === 'people') {
      const st = q.get('status'), off = +q.get('offset') || 0, lim = +q.get('limit') || 50;
      const all = db.people[id].filter((x) => !st || x.status === st);
      return { total: all.length, people: all.slice(off, off + lim) };
    }
    if (sub === 'accept-checks') { let n = 0; db.people[id].forEach((x) => { if (x.status === 'check') { x.status = 'exact'; x.reasons = []; n++; } }); return { accepted: n }; }
    if (sub === 'analyses') {
      const a = { id: 'a' + (Object.keys(db.analyses).length + 1), listId: id, name: body.name, site: body.site, arrival: body.arrival, weekdays: body.weekdays || ['mon', 'tue', 'wed', 'thu', 'fri'],
        settings: { kinds: ['transit', 'car', 'bike', 'ebike', 'walk'], ...(body.settings || {}) }, status: 'queued', outdated: false, progress: 0, total: 0, error: null, createdAt: new Date().toISOString(), finishedAt: null };
      db.analyses[a.id] = a; return a;
    }
  }
  if (res === 'people') {
    const person = Object.values(db.people).flat().find((x) => x.id === +id); if (!person) bad('Person not found');
    if ('candidate' in body) { const c = person.candidates[body.candidate]; Object.assign(person, { status: 'manual', lat: c.lat, lon: c.lon, matched: c.label, reasons: [], candidates: [] }); }
    else if ('lat' in body) Object.assign(person, { status: 'manual', lat: body.lat, lon: body.lon, matched: null, reasons: [] });
    else { Object.assign(person, { address: body.address, postcode: body.postcode ?? null, city: body.city ?? null, status: 'pending' }); }
    db.lists[person.listId].version++;
    Object.values(db.analyses).filter((a) => a.listId === person.listId).forEach((a) => (a.outdated = true));
    return person;
  }
  if (res === 'analyses') {
    const a = db.analyses[id]; if (!a) bad('Analysis not found');
    if (!sub) { if (method === 'DELETE') { delete db.analyses[id]; return { ok: true }; } advanceAnalysis(a); return full(a); }
    if (sub === 'rerun') { Object.assign(a, { status: 'queued', progress: 0, outdated: false, finishedAt: null }); return a; }
    if (sub === 'indicators') return indicators(db.results[id], q.get('by'));
    if (sub === 'results' && !sub2) { const off = +q.get('offset') || 0, lim = +q.get('limit') || 50; return { total: db.results[id].length, rows: db.results[id].slice(off, off + lim) }; }
    if (sub === 'results') return compare(db.results[id].find((r) => r.personId === +sub2));
  }
  bad('Unknown call ' + path);
}
