// Small DOM helpers and formatters. Text is always inserted as text nodes (uploaded data is untrusted).
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  add(el, kids);
  return el;
}
export function add(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
export function clear(el, ...kids) { el.replaceChildren(); return add(el, kids); }

export function say(text) { const l = document.getElementById('live'); if (l) { l.textContent = ''; setTimeout(() => (l.textContent = text), 30); } }

const intF = new Intl.NumberFormat('de-CH');
export const fmtInt = (n) => (n == null ? '–' : intF.format(n));
export const fmtPct = (x) => (x == null ? '–' : Math.round(x * 100) + '%');
export const fmtChf = (n) => (n == null ? '–' : 'CHF ' + intF.format(Math.round(n)));
export function fmtMin(m) {
  if (m == null) return '–';
  m = Math.round(m);
  if (m < 60) return m + ' min';
  return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0');
}
export const hhmm = (iso) => (typeof iso === 'string' && iso.length >= 16 ? iso.slice(11, 16) : '');

export const STATUS_LABEL = { exact: 'Exact', check: 'To check', notfound: 'Not found', manual: 'Manual', pending: 'Pending' };
export const REASON_LABEL = {
  postcode: 'Postcode differs', houseNumber: 'House number not found', street: 'Street only similar',
  ambiguous: 'Several candidates', noNumber: 'No house number', fallback: 'Found by fallback search',
};
export const reasonText = (codes) => (codes || []).map((c) => REASON_LABEL[c] || c).join(', ');
export const KIND_LABEL = {
  transit: 'Public transport', parkRail: 'Park and rail', cityParkRide: 'Park and ride (city)', bikeRide: 'Bike and ride',
  walk: 'Walk', bike: 'Bike', ebike: 'E-bike', car: 'Car',
};
export const CLASS_LABEL = { ptFaster: 'PT faster', upTo1_5: 'Up to 1.5×', upTo2: 'Up to 2×', over2: 'Over 2×', noPt: 'No PT' };

export const badge = (status, text) => h('span', { class: 'badge ' + status }, text || STATUS_LABEL[status] || status);

export function errorBox(err, retry) {
  const msg = err instanceof Error ? err.message : String(err);
  return h('div', { class: 'msg error', role: 'alert' }, msg,
    retry ? h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: retry }, 'Try again')) : null);
}
export const loading = (text = 'Loading…') => h('p', { class: 'loading' }, text);
export const empty = (title, text) => h('div', { class: 'empty' }, h('b', {}, title), text);

export function progressBar(done, total, label) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const bar = h('div', { class: 'progress', role: 'progressbar', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct },
    h('div', {}));
  bar.firstChild.style.width = pct + '%';
  return bar;
}

export function confirmDialog({ title, text, ok = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dialog', 'aria-labelledby': 'dlg-title' },
      h('h2', { id: 'dlg-title' }, title), h('p', {}, text),
      h('div', { class: 'row end' },
        h('button', { class: 'btn', type: 'button', onclick: () => dlg.close('no') }, 'Cancel'),
        h('button', { class: 'btn ' + (danger ? 'danger-solid' : 'primary'), type: 'button', onclick: () => dlg.close('yes') }, ok)));
    dlg.addEventListener('close', () => { dlg.remove(); resolve(dlg.returnValue === 'yes'); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

/** Pager line with Previous / Next. */
export function pager(offset, limit, total, go) {
  const from = total ? offset + 1 : 0, to = Math.min(total, offset + limit);
  return h('div', { class: 'pager' },
    h('span', {}, `${fmtInt(from)}–${fmtInt(to)} of ${fmtInt(total)}`),
    h('span', { class: 'row' },
      h('button', { class: 'btn small', type: 'button', disabled: offset <= 0, onclick: () => go(Math.max(0, offset - limit)) }, 'Previous'),
      h('button', { class: 'btn small', type: 'button', disabled: offset + limit >= total, onclick: () => go(offset + limit) }, 'Next')));
}

export function numOrNull(s) {
  const t = String(s ?? '').trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}
