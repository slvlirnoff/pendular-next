import { h, clear, fmtInt, fmtPct, fmtMin, fmtChf, hhmm, errorBox, loading, empty, badge, say, progressBar, confirmDialog, pager, numOrNull, KIND_LABEL, CLASS_LABEL } from './util.js';
import { get, post, del, isMock } from './api.js';

const PAGE = 50;
const DAY_LABEL = { mon: 'Mo', tue: 'Tu', wed: 'We', thu: 'Th', fri: 'Fr', sat: 'Sa', sun: 'Su' };
const SEGMENTS = [
  ['goodPt', 'Good public transport alternative', 'Public transport is close enough to the car in time to be a realistic choice for these people.'],
  ['cycling', 'Within cycling reach', 'Public transport is weak, but the site is near enough to ride by bike or e-bike.'],
  ['noAlternative', 'No reasonable alternative', 'Neither public transport nor cycling works well; these people depend on the car.'],
];
const LEG_MODE = { walk: 'Walk', bike: 'Bike', ebike: 'E-bike', car: 'Car', rail: 'Train', bus: 'Bus', tram: 'Tram', metro: 'Metro', boat: 'Boat', funicular: 'Funicular', cableway: 'Cableway' };

export function analysisView(root, ctx, id) {
  const aid = encodeURIComponent(id);
  let a = null, builtFor = null, polling = false;
  const title = h('h1', { tabindex: '-1' }, 'Analysis');
  const head = h('div', {});
  const body = h('div', {});
  const panel = h('aside', { class: 'panel', role: 'dialog', 'aria-label': 'Comparison for one person', hidden: true, tabindex: '-1' });
  let panelOpener = null;
  document.body.append(panel);
  ctx.onCleanup(() => panel.remove());
  root.append(h('div', { id: 'back-slot' }), title, head, body);
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });

  async function refresh() {
    a = await get('/api/analyses/' + aid);
    if (ctx.dead) return;
    render();
  }

  function render() {
    title.textContent = a.name;
    document.title = a.name + ' · Commute Analytics';
    clear(root.querySelector('#back-slot'), h('a', { class: 'back', href: '#/list/' + encodeURIComponent(a.listId) }, '← Back to the list'));
    const active = a.status === 'queued' || a.status === 'running';
    clear(head,
      h('div', { class: 'meta' },
        h('span', {}, 'Site: ', h('b', {}, a.site.label)),
        h('span', {}, `Arrival ${a.arrival.from}–${a.arrival.to}`),
        h('span', {}, (a.weekdays || []).map((d) => DAY_LABEL[d] || d).join(' ')),
        h('span', {}, 'Created ' + (a.createdAt || '').slice(0, 10))),
      h('div', { class: 'card pad stack' },
        h('div', { class: 'row' },
          badge(a.status === 'done' ? 'done' : a.status === 'failed' ? 'failed' : 'pending', { queued: 'Queued', running: 'Running', done: 'Done', failed: 'Failed' }[a.status] || a.status),
          a.outdated ? badge('outdated', 'Outdated') : null,
          h('span', { class: 'grow' }),
          a.status === 'done' ? h('a', { class: 'btn small', href: isMock ? '#' : `/api/analyses/${aid}/export.csv`, download: `${a.name}.csv` }, 'Download CSV') : null,
          h('button', { class: 'btn small danger', type: 'button', onclick: remove }, 'Delete analysis')),
        active ? h('div', { class: 'progress-line' },
          h('span', {}, a.status === 'queued' ? 'Waiting in the queue. This page updates by itself.' : `Calculating routes: ${fmtInt(a.progress)} of ${fmtInt(a.total)} people.`),
          progressBar(a.progress, a.total, 'Analysis progress')) : null,
        a.status === 'failed' ? errorBox(a.error || 'The analysis failed without a message.') : null,
        a.outdated && !active ? h('div', { class: 'msg warn' }, 'The list changed after this analysis ran, so these figures may no longer match the people in it.',
          h('div', { class: 'row' }, h('button', { class: 'btn small primary', type: 'button', onclick: rerun }, 'Run again'))) : null,
        a.status === 'failed' && !a.outdated ? h('div', {}, h('button', { class: 'btn small primary', type: 'button', onclick: rerun }, 'Run again')) : null,
        h('div', { id: 'act-msg', role: 'status' })));
    if (a.status === 'done') {
      const key = a.id + '|' + a.finishedAt;
      if (builtFor !== key) { builtFor = key; buildResults(); }
    } else { builtFor = null; clear(body); }
    if (active) ensurePoll();
  }

  function actMsg(node) { const m = head.querySelector('#act-msg'); if (m) clear(m, node); }

  async function rerun() {
    actMsg('Starting again…');
    try { a = await post(`/api/analyses/${aid}/rerun`); say('Analysis queued again'); render(); }
    catch (e) { actMsg(errorBox(e)); }
  }
  async function remove() {
    if (!await confirmDialog({ title: 'Delete this analysis?', text: `“${a.name}” and all its results will be removed for good.`, ok: 'Delete analysis', danger: true })) return;
    try { await del('/api/analyses/' + aid); location.hash = '#/list/' + encodeURIComponent(a.listId); }
    catch (e) { actMsg(errorBox(e)); }
  }
  function ensurePoll() {
    if (polling || ctx.dead) return;
    polling = true;
    ctx.poll(async () => {
      let more = true;
      try { await refresh(); more = a.status === 'queued' || a.status === 'running'; } catch { /* retry */ }
      if (!more) polling = false;
      return more;
    });
  }

  // ---- Results --------------------------------------------------------------------------
  function buildResults() {
    const ind = a.indicators;
    if (!ind) { clear(body, empty('No figures', 'The analysis finished without key figures. Run it again.')); return; }
    const groupBox = h('div', {});
    const tableBox = h('div', {});
    clear(body,
      ind.analysed === 0 ? h('div', { class: 'msg warn', style: 'margin-bottom:16px' }, 'No person could be analysed. Check the addresses on the list page.') : null,
      tiles(ind), reachCard(ind),
      h('div', { class: 'two', style: 'margin-bottom:16px' }, ratioCard(ind), stopsCard(ind)),
      segmentsCard(ind), groupBox, tableBox);
    const attrSet = new Set();
    const setAttrs = breakdown(groupBox);
    resultsTable(tableBox, attrSet, () => setAttrs(attrSet));
  }

  const tile = (big, cap) => h('div', { class: 'tile' }, h('div', { class: 'big' }, big), h('div', { class: 'cap' }, cap));
  function tiles(i) {
    return h('div', { class: 'tiles' },
      tile(fmtInt(i.analysed), i.analysed === i.people ? 'people analysed' : `people analysed of ${fmtInt(i.people)}`),
      tile(fmtMin(i.median.pt), 'median public transport'), tile(fmtMin(i.median.car), 'median car'),
      tile(fmtMin(i.median.bike), 'median bike'), tile(fmtMin(i.median.ebike), 'median e-bike'));
  }
  const barRow = (label, share) => {
    const fill = h('div', { class: 'fill' });
    fill.style.width = Math.round(share * 100) + '%';
    return h('div', { class: 'bar-row' }, h('span', {}, label), h('div', { class: 'track', role: 'img', 'aria-label': `${label}: ${fmtPct(share)}` }, fill), h('span', { class: 'val' }, fmtPct(share)));
  };
  function reachCard(i) {
    return h('section', { class: 'card', 'aria-labelledby': 'reach-h' },
      h('div', { class: 'card-head' }, h('h2', { id: 'reach-h' }, 'Share of people who reach the site')),
      h('div', { class: 'pad bars' },
        barRow('Public transport, 30 min', i.ptWithin.min30), barRow('Public transport, 45 min', i.ptWithin.min45), barRow('Public transport, 60 min', i.ptWithin.min60),
        barRow('Bike, 20 min', i.bikeWithin20), barRow('E-bike, 30 min', i.ebikeWithin30), barRow('On foot, 20 min', i.walkWithin20)));
  }
  function ratioCard(i) {
    const order = ['ptFaster', 'upTo1_5', 'upTo2', 'over2', 'noPt'];
    const total = order.reduce((s, k) => s + (i.ratio[k] || 0), 0);
    const isShare = total <= 1.0001; // the API does not say whether these are shares or counts
    const bar = h('div', { class: 'stacked', role: 'img', 'aria-label': 'Public transport compared with car: ' + order.map((k) => `${CLASS_LABEL[k]} ${fmtPct(total ? i.ratio[k] / total : 0)}`).join(', ') });
    order.forEach((k) => { const d = h('div', { class: 'c-' + k }); d.style.flexGrow = String(i.ratio[k] || 0); d.style.flexBasis = '0'; if (!i.ratio[k]) d.style.display = 'none'; bar.append(d); });
    return h('section', { class: 'card', 'aria-labelledby': 'ratio-h' },
      h('div', { class: 'card-head' }, h('h2', { id: 'ratio-h' }, 'Public transport compared with car')),
      h('div', { class: 'pad' }, h('p', { class: 'subtle', style: 'margin-bottom:10px' }, 'Door-to-door time by public transport as a multiple of the car time.'), bar,
        h('div', { class: 'legend' }, order.map((k) => h('div', {}, h('i', { class: 'sw c-' + k }), h('span', { class: 'grow' }, CLASS_LABEL[k]),
          h('span', { class: 'v' }, (isShare ? '' : fmtInt(i.ratio[k] || 0) + ' · ') + fmtPct(total ? (i.ratio[k] || 0) / total : 0)))))));
  }
  function stopsCard(i) {
    const stops = (i.boardStops || []).slice(0, 10);
    return h('section', { class: 'card', 'aria-labelledby': 'stops-h' },
      h('div', { class: 'card-head' }, h('h2', { id: 'stops-h' }, 'Main boarding stops')),
      stops.length ? h('ol', { class: 'pad ranked' }, stops.map((s) => h('li', {}, h('span', {}, s.name), h('span', { class: 'n' }, fmtInt(s.people))))) : empty('No boarding stops', 'Nobody has a public transport trip.'));
  }
  function segmentsCard(i) {
    return h('section', { class: 'card', 'aria-labelledby': 'seg-h' },
      h('div', { class: 'card-head' }, h('h2', { id: 'seg-h' }, 'Segments')),
      h('div', { class: 'pad segs' }, SEGMENTS.map(([k, label, text]) => h('div', { class: 'seg' }, h('h3', {}, label), h('div', { class: 'big' }, fmtInt(i.segments[k])), h('p', {}, text)))));
  }

  // ---- Breakdown ------------------------------------------------------------------------
  function breakdown(box) {
    const sel = h('select', { id: 'by-sel', disabled: true }, h('option', { value: '' }, 'No other columns in this list'));
    const out = h('div', {});
    const hint = h('p', { class: 'pad subtle' }, 'Pick an attribute from the list file (for example department) to compare groups.');
    sel.addEventListener('change', async () => {
      hint.hidden = !!sel.value;
      if (!sel.value) { clear(out); return; }
      clear(out, loading('Calculating…'));
      const by = sel.value;
      try {
        const r = await get(`/api/analyses/${aid}/indicators?by=${encodeURIComponent(by)}`);
        if (ctx.dead || sel.value !== by) return;
        const groups = r.by?.groups || [];
        clear(out, groups.length ? h('div', { class: 'scroll' }, groupTable(by, groups)) : empty('No groups', 'This attribute has no values.'));
      } catch (e) { clear(out, h('div', { class: 'pad' }, errorBox(e))); }
    });
    clear(box, h('section', { class: 'card', 'aria-labelledby': 'by-h' },
      h('div', { class: 'card-head' }, h('h2', { id: 'by-h' }, 'Break down by'),
        h('div', { class: 'field', style: 'min-width:220px' }, h('label', { for: 'by-sel', class: 'sr-only' }, 'Break down by attribute'), sel)),
      hint, out));
    return (names) => {
      names = [...names].sort();
      const keep = sel.value;
      clear(sel, h('option', { value: '' }, names.length ? '— choose an attribute —' : 'No other columns in this list'), names.map((n) => h('option', { value: n }, n)));
      sel.disabled = names.length === 0;
      if (names.includes(keep)) sel.value = keep;
    };
  }
  function groupTable(by, groups) {
    const cols = [['People', (i) => fmtInt(i.analysed)], ['PT ≤ 30', (i) => fmtPct(i.ptWithin.min30)], ['PT ≤ 45', (i) => fmtPct(i.ptWithin.min45)], ['PT ≤ 60', (i) => fmtPct(i.ptWithin.min60)],
      ['Bike ≤ 20', (i) => fmtPct(i.bikeWithin20)], ['E-bike ≤ 30', (i) => fmtPct(i.ebikeWithin30)], ['Walk ≤ 20', (i) => fmtPct(i.walkWithin20)],
      ['Median PT', (i) => fmtMin(i.median.pt)], ['Median car', (i) => fmtMin(i.median.car)], ['No alternative', (i) => fmtInt(i.segments.noAlternative)]];
    return h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, by), cols.map(([l]) => h('th', { class: 'num' }, l)))),
      h('tbody', {}, groups.map((g) => h('tr', {}, h('td', {}, g.value || '(empty)'), cols.map(([, f]) => h('td', { class: 'num' }, f(g.indicators)))))));
  }

  // ---- Results table + side panel -------------------------------------------------------
  function resultsTable(box, attrSet, onAttrs) {
    let offset = 0;
    async function load() {
      clear(box, h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'People')), loading('Loading results…')));
      try {
        const r = await get(`/api/analyses/${aid}/results?offset=${offset}&limit=${PAGE}`);
        if (ctx.dead) return;
        const before = attrSet.size;
        r.rows.forEach((row) => Object.keys(row.attrs || {}).forEach((k) => attrSet.add(k)));
        if (attrSet.size !== before) onAttrs();
        const tr = (row) => {
          const btn = h('button', { class: 'link-btn', type: 'button', 'aria-label': `Open comparison for ${row.extId}` }, row.extId);
          const t = h('tr', { class: 'click' }, h('td', { class: 'nowrap' }, btn),
            h('td', { class: 'num' }, fmtMin(row.ptMin)), h('td', { class: 'num' }, row.ptChanges ?? '–'), h('td', { class: 'num' }, fmtChf(row.ptCost)),
            h('td', { class: 'num' }, fmtMin(row.carMin)), h('td', { class: 'num' }, fmtMin(row.bikeMin)), h('td', { class: 'num' }, fmtMin(row.ebikeMin)),
            h('td', {}, row.error ? h('span', { title: row.error }, 'Error') : CLASS_LABEL[row.ratioClass] || row.ratioClass));
          t.addEventListener('click', () => openPanel(row, btn));
          return t;
        };
        clear(box, h('section', { class: 'card', 'aria-labelledby': 'res-h' },
          h('div', { class: 'card-head' }, h('h2', { id: 'res-h' }, 'People'), h('span', { class: 'subtle' }, 'Click a row for the full comparison')),
          r.total ? [h('div', { class: 'scroll' }, h('table', {},
            h('thead', {}, h('tr', {}, h('th', {}, 'ID'), ['PT min', 'Changes', 'PT cost per year', 'Car min', 'Bike min', 'E-bike min'].map((l) => h('th', { class: 'num' }, l)), h('th', {}, 'Class'))),
            h('tbody', {}, r.rows.map(tr)))), pager(offset, PAGE, r.total, (o) => { offset = o; load(); })]
            : empty('No results', 'Nobody could be analysed.')));
      } catch (e) { if (!ctx.dead) clear(box, h('section', { class: 'card pad' }, errorBox(e, load))); }
    }
    load();
  }

  function closePanel() { panel.hidden = true; clear(panel); panelOpener?.focus?.(); panelOpener = null; }
  async function openPanel(row, opener) {
    panelOpener = opener;
    const close = h('button', { class: 'btn small', type: 'button', onclick: closePanel }, 'Close');
    const attrs = Object.entries(row.attrs || {}).map(([k, v]) => `${k}: ${v}`).join(' · ');
    const content = h('div', {}, loading('Loading comparison…'));
    clear(panel, h('header', {}, h('div', {}, h('h2', {}, row.extId), attrs ? h('p', { class: 'subtle' }, attrs) : null), close), content);
    panel.hidden = false; close.focus();
    try {
      const r = await get(`/api/analyses/${aid}/results/${encodeURIComponent(row.personId)}`);
      if (panel.hidden) return;
      clear(content, comparison(r, row));
    } catch (e) { clear(content, errorBox(e, () => openPanel(row, opener))); }
  }
  function comparison(r, row) {
    const opts = r.options || [];
    if (!opts.length) return empty('No options', row.error || 'No travel option was found for this person.');
    const tags = (o) => ['cheapest', 'fastest', 'greenest'].filter((k) => r.verdict?.[k] === o.id).map((k) => badge('manual', k[0].toUpperCase() + k.slice(1)));
    return h('div', {}, opts.map((o) => h('section', { class: 'opt' },
      h('h3', {}, KIND_LABEL[o.kind] || o.kind, tags(o)),
      o.title ? h('p', { class: 'muted' }, o.title) : null,
      h('div', { class: 'facts' }, h('span', {}, fmtMin(o.durationMin)), h('span', {}, `${o.changes ?? 0} ${o.changes === 1 ? 'change' : 'changes'}`),
        h('span', {}, fmtChf(o.cost?.yearly) + ' per year'), o.co2KgPerYear != null ? h('span', {}, fmtInt(Math.round(o.co2KgPerYear)) + ' kg CO₂ per year') : null),
      h('ol', { class: 'legs' }, (o.itinerary?.legs || []).map((l) => h('li', {}, legText(l)))))));
  }
  function legText(l) {
    const t = hhmm(l.departure) ? `${hhmm(l.departure)}–${hhmm(l.arrival)}, ` : '';
    const line = l.line?.name ? ' ' + l.line.name : '';
    const km = l.distanceM ? `, ${(l.distanceM / 1000).toFixed(1)} km` : '';
    return `${LEG_MODE[l.mode] || l.mode}${line}: ${l.from?.name || '?'} → ${l.to?.name || '?'} (${t}${fmtMin(l.durationMin)}${km})`;
  }

  // ---- Start ----------------------------------------------------------------------------
  (async function init() {
    clear(head, loading('Loading analysis…'));
    try { await refresh(); } catch (e) { clear(head, errorBox(e, init)); }
  })();
}
