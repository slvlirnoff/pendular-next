import { h, clear, fmtInt, errorBox, loading, empty, say } from './util.js';
import { get, post } from './api.js';
import { parseCsv, decode, guessMapping, FIELDS } from './csv.js';

export function statusSummary(by) {
  const item = (key, label) => {
    const n = by?.[key] ?? 0;
    return h('span', { class: n ? '' : 'zero' }, h('i', { class: 'dot ' + key }), h('b', {}, fmtInt(n)), ' ' + label);
  };
  return h('div', { class: 'summary' }, item('exact', 'exact'), item('check', 'to check'), item('notfound', 'not found'), item('pending', 'pending'));
}

export function homeView(root, ctx) {
  root.append(h('h1', { tabindex: '-1' }, 'Lists'));
  document.title = 'Lists · Pendular Plural';
  const listBox = h('div', { class: 'card' });
  root.append(listBox, newListCard(ctx));

  async function load() {
    clear(listBox, loading('Loading lists…'));
    try {
      const lists = await get('/api/lists');
      if (ctx.dead) return;
      if (!lists.length) { clear(listBox, empty('No lists yet', 'Upload a staff list below to get started.')); return; }
      clear(listBox,
        h('div', { class: 'list-row head' }, h('span', {}, 'Name'), h('span', { class: '' }, 'People'), h('span', {}, 'Addresses')),
        lists.map((l) => h('div', { class: 'list-row' },
          h('a', { href: '#/list/' + encodeURIComponent(l.id) }, l.name),
          h('span', { class: 'mono' }, fmtInt(l.people)),
          statusSummary(l.byStatus))));
    } catch (e) { if (!ctx.dead) clear(listBox, h('div', { class: 'pad' }, errorBox(e, load))); }
  }
  load();
}

function newListCard(ctx) {
  const nameIn = h('input', { type: 'text', id: 'nl-name', autocomplete: 'off', placeholder: 'e.g. Staff Lausanne 2026' });
  const fileIn = h('input', { type: 'file', id: 'nl-file', accept: '.csv,.txt,.tsv,text/csv,text/plain' });
  const pasteIn = h('textarea', { id: 'nl-paste', placeholder: 'id;address;postcode;city\nP001;Rue du Lac 12;1003;Lausanne', spellcheck: 'false' });
  const info = h('div', {});
  const importBox = h('div', {});
  let state = null; // { headers, rows, mapping, delimiter }

  async function onFile() {
    const f = fileIn.files[0];
    if (!f) return;
    clear(info);
    try { load(decode(await f.arrayBuffer()), f.name); }
    catch (e) { clear(info, errorBox('Could not read that file: ' + e.message)); }
  }
  function onPaste() {
    clear(info);
    if (!pasteIn.value.trim()) { clear(info, errorBox('Paste the CSV text first.')); return; }
    load(pasteIn.value, 'pasted text');
  }
  function load(text, source) {
    const p = parseCsv(text);
    clear(importBox);
    state = null;
    if (!p.headers.length || !p.rows.length) {
      clear(info, errorBox(`No data rows found in ${source}. The first row must be the column names, followed by one row per person.`));
      return;
    }
    state = { ...p, mapping: guessMapping(p.headers) };
    if (!nameIn.value.trim() && source !== 'pasted text') nameIn.value = source.replace(/\.[a-z0-9]+$/i, '');
    renderImport();
  }

  function renderImport() {
    const { headers, rows, mapping, delimiter } = state;
    const dName = { ',': 'comma', ';': 'semicolon', '\t': 'tab' }[delimiter];
    const selects = FIELDS.map(([f, label, req]) => {
      const sel = h('select', { id: 'map-' + f, 'aria-required': req ? 'true' : null },
        h('option', { value: '-1' }, req ? 'Choose a column…' : '— none —'),
        headers.map((hd, n) => h('option', { value: n, selected: mapping[f] === n }, hd)));
      sel.addEventListener('change', () => { mapping[f] = Number(sel.value); renderImport(); sel.focus(); });
      return h('div', { class: 'field' }, h('label', { for: 'map-' + f }, label + (req ? ' *' : '')), sel);
    });
    const mappedAt = (n) => FIELDS.filter(([f]) => mapping[f] === n).map(([, l]) => l.replace(/ \(.*\)/, ''));
    const attrCols = headers.filter((_, n) => !FIELDS.some(([f]) => mapping[f] === n));
    const hasPos = mapping.address >= 0 || (mapping.lat >= 0 && mapping.lon >= 0);
    const problems = [];
    if (mapping.id < 0) problems.push('Choose the column that holds the person id.');
    if (!hasPos) problems.push('Choose an address column, or both latitude and longitude.');
    if (!nameIn.value.trim()) problems.push('Give the list a name.');
    const submit = h('button', { class: 'btn primary', type: 'button', disabled: problems.length > 0, onclick: create }, `Create list with ${fmtInt(rows.length)} rows`);
    clear(importBox,
      h('div', { class: 'stack', style: 'margin-top:16px' },
        h('p', { class: 'muted' }, `Read ${fmtInt(rows.length)} rows with ${headers.length} columns (${dName}-separated). First 5 rows:`),
        h('div', { class: 'scroll card', style: 'margin:0' }, h('table', {},
          h('thead', {}, h('tr', {}, headers.map((hd, n) => h('th', {}, hd, mappedAt(n).map((m) => h('span', { class: 'tag' }, '→ ' + m)))))),
          h('tbody', {}, rows.slice(0, 5).map((r) => h('tr', {}, r.map((c) => h('td', {}, c))))))),
        h('h3', {}, 'Which column is which?'),
        h('div', { class: 'map-grid' }, selects),
        h('p', { class: 'subtle' }, attrCols.length
          ? `Kept as attributes for breakdowns: ${attrCols.join(', ')}.` : 'No further columns; nothing is kept as attribute.'),
        problems.length ? h('p', { class: 'subtle', id: 'nl-problems' }, problems.join(' ')) : null,
        h('div', { class: 'row' }, submit, h('span', { id: 'nl-status', role: 'status' }))));
  }
  nameIn.addEventListener('input', () => { if (state) { const f = document.activeElement; renderImport(); f?.focus?.(); } });

  async function create() {
    const { rows, headers, mapping } = state;
    const btn = importBox.querySelector('button.primary');
    const val = (r, f) => (mapping[f] >= 0 ? r[mapping[f]] : '');
    const out = [];
    let skipped = 0, badCoords = 0;
    for (const r of rows) {
      const extId = val(r, 'id');
      if (!extId) { skipped++; continue; }
      const p = { extId };
      for (const f of ['address', 'postcode', 'city']) if (val(r, f)) p[f] = val(r, f);
      const lat = Number(val(r, 'lat').replace(',', '.')), lon = Number(val(r, 'lon').replace(',', '.'));
      if (val(r, 'lat') && val(r, 'lon')) { if (Number.isFinite(lat) && Number.isFinite(lon)) { p.lat = lat; p.lon = lon; } else badCoords++; }
      const attrs = {};
      headers.forEach((hd, n) => { if (!FIELDS.some(([f]) => mapping[f] === n) && r[n]) attrs[hd] = r[n]; });
      if (Object.keys(attrs).length) p.attrs = attrs;
      out.push(p);
    }
    const status = importBox.querySelector('#nl-status');
    if (!out.length) { clear(status, errorBox('Every row has an empty id column, so nothing can be uploaded.')); return; }
    btn.disabled = true; clear(status, 'Uploading…');
    try {
      const list = await post('/api/lists', { name: nameIn.value.trim(), rows: out });
      say(`List created. ${skipped} rows without id left out.`);
      location.hash = '#/list/' + encodeURIComponent(list.id);
    } catch (e) {
      btn.disabled = false;
      clear(status, errorBox(e));
    }
  }

  fileIn.addEventListener('change', onFile);
  return h('section', { class: 'card', 'aria-labelledby': 'nl-h' },
    h('div', { class: 'card-head' }, h('h2', { id: 'nl-h' }, 'New list')),
    h('div', { class: 'pad stack' },
      h('p', { class: 'muted' }, 'A CSV with one row per person: a pseudonymous id and a home address. Other columns (department, shift …) are kept for breakdowns. The first row holds the column names.'),
      h('div', { class: 'field' }, h('label', { for: 'nl-name' }, 'List name'), nameIn),
      h('div', { class: 'sources' },
        h('div', { class: 'field' }, h('label', { for: 'nl-file' }, 'CSV file'), fileIn,
          h('p', { class: 'subtle', style: 'margin-top:6px' }, 'Comma, semicolon or tab separated.')),
        h('div', { class: 'field' }, h('label', { for: 'nl-paste' }, 'Or paste the text'), pasteIn,
          h('div', { class: 'row', style: 'margin-top:6px' }, h('button', { class: 'btn small', type: 'button', onclick: onPaste }, 'Read pasted text')))),
      info, importBox));
}
