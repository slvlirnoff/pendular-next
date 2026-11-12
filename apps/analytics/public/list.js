import { h, clear, fmtInt, fmtPct, errorBox, loading, empty, badge, say, progressBar, confirmDialog, pager, reasonText, numOrNull, STATUS_LABEL } from './util.js';
import { get, post, patch, del } from './api.js';
import { statusSummary } from './home.js';

const PAGE = 50;
const TABS = [['check', 'To check'], ['notfound', 'Not found'], ['exact', 'Exact'], ['manual', 'Manual'], ['all', 'All']];
const DAYS = [['mon', 'Mo'], ['tue', 'Tu'], ['wed', 'We'], ['thu', 'Th'], ['fri', 'Fr'], ['sat', 'Sa'], ['sun', 'Su']];
const addrText = (p) => [p.address, [p.postcode, p.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');

export function listView(root, ctx, id) {
  const lid = encodeURIComponent(id);
  let list = null, tab = null, offset = 0, shown = null, autoTab = true;
  const open = new Set();
  const title = h('h1', { tabindex: '-1' }, 'List');
  const head = h('div', {});
  const peopleCard = h('section', { class: 'card', 'aria-labelledby': 'ppl-h' });
  const analysesCard = h('section', { class: 'card', 'aria-labelledby': 'an-h' });
  const gate = { el: null };
  root.append(h('a', { class: 'back', href: '#/' }, '← All lists'), title, head, peopleCard, analysesCard);

  const pending = () => list?.byStatus.pending ?? 0;
  const busyAnalyses = () => (list?.analyses || []).some((a) => a.status === 'queued' || a.status === 'running');

  async function refreshList() {
    list = await get('/api/lists/' + lid);
    if (ctx.dead) return;
    title.textContent = list.name;
    document.title = list.name + ' · Pendular Plural';
    renderHead();
    renderAnalyses();
    updateGate();
  }

  function renderHead() {
    const p = pending(), done = list.people - p;
    clear(head, h('div', { class: 'card pad stack' },
      h('div', { class: 'row' }, h('b', {}, fmtInt(list.people) + ' people'), statusSummary(list.byStatus)),
      p > 0 ? h('div', { class: 'progress-line' },
        h('span', {}, `Checking addresses: ${fmtInt(done)} of ${fmtInt(list.people)} done. This page updates by itself.`),
        progressBar(done, list.people, 'Address check progress')) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn small danger', type: 'button', onclick: removeList }, 'Delete list'))));
  }

  async function removeList() {
    if (!await confirmDialog({ title: 'Delete this list?', text: `“${list.name}” with ${fmtInt(list.people)} people and ${list.analyses.length} analyses will be removed for good.`, ok: 'Delete list', danger: true })) return;
    try { await del('/api/lists/' + lid); location.hash = '#/'; }
    catch (e) { head.prepend(errorBox(e)); }
  }

  // ---- People ---------------------------------------------------------------------------
  function chooseTab() {
    const b = list.byStatus;
    return b.check > 0 ? 'check' : b.notfound > 0 ? 'notfound' : 'all';
  }
  async function loadPeople(keepOpen) {
    if (!list) return;
    open.clear();
    const key = tab + ':' + offset;
    renderPeopleShell();
    const body = peopleCard.querySelector('.ppl-body');
    clear(body, loading('Loading people…'));
    try {
      const q = `?offset=${offset}&limit=${PAGE}` + (tab !== 'all' ? '&status=' + tab : '');
      const r = await get(`/api/lists/${lid}/people${q}`);
      if (ctx.dead || key !== tab + ':' + offset) return;
      shown = JSON.stringify(list.byStatus);
      renderPeopleBody(body, r);
    } catch (e) { if (!ctx.dead) clear(body, h('div', { class: 'pad' }, errorBox(e, () => loadPeople(true)))); }
  }

  function renderPeopleShell() {
    const count = (k) => (k === 'all' ? list.people : list.byStatus[k] ?? 0);
    clear(peopleCard,
      h('div', { class: 'card-head' }, h('h2', { id: 'ppl-h' }, 'People'),
        list.byStatus.check > 0 ? h('button', { class: 'btn small', type: 'button', onclick: acceptAll }, `Accept all suggestions (${fmtInt(list.byStatus.check)})`) : null),
      h('div', { class: 'tabs', role: 'group', 'aria-label': 'Filter by address status' },
        TABS.map(([k, label]) => h('button', { type: 'button', 'aria-pressed': String(tab === k), onclick: () => { tab = k; autoTab = false; offset = 0; loadPeople(); } }, `${label} (${fmtInt(count(k))})`))),
      h('div', { class: 'ppl-msg', role: 'status' }),
      h('div', { class: 'ppl-body' }));
  }

  function flash(node) { const m = peopleCard.querySelector('.ppl-msg'); if (m) clear(m, node ? h('div', { class: 'pad' }, node) : null); }

  async function acceptAll() {
    const n = list.byStatus.check;
    if (!await confirmDialog({ title: 'Accept all suggestions?', text: `For ${fmtInt(n)} addresses to check, the best-matching suggestion is accepted. Review the “To check” tab first if you are unsure; individual rows can still be corrected afterwards.`, ok: 'Accept all' })) return;
    try {
      const r = await post(`/api/lists/${lid}/accept-checks`);
      say(`${r.accepted} suggestions accepted`);
      await refreshList();
      tab = chooseTab(); offset = 0;
      await loadPeople();
      flash(h('div', { class: 'msg ok' }, `${fmtInt(r.accepted)} suggestions accepted.`));
    } catch (e) { flash(errorBox(e)); }
  }

  function renderPeopleBody(body, r) {
    if (!r.total) {
      const hints = { check: 'Nothing to check. Every address is either exact, not found or corrected.', notfound: 'No address is missing. Nothing to fix here.' };
      clear(body, empty('No people in this view', hints[tab] || 'Try another tab.')); return;
    }
    const showStatus = tab === 'all';
    const rows = r.people.flatMap((p) => {
      const tr = h('tr', {},
        h('td', { class: 'nowrap' }, p.extId),
        h('td', {}, addrText(p) || h('span', { class: 'subtle' }, '(none)')),
        h('td', {}, p.matched || h('span', { class: 'subtle' }, '–')),
        h('td', {}, reasonText(p.reasons) || h('span', { class: 'subtle' }, '–')),
        showStatus ? h('td', {}, badge(p.status)) : null,
        h('td', {}, h('button', { class: 'btn small', type: 'button', 'aria-expanded': 'false', 'aria-label': `Edit ${p.extId}` }, 'Edit')));
      const btn = tr.querySelector('button');
      let detail = null;
      const toggle = () => {
        if (detail) { detail.remove(); detail = null; open.delete(p.id); btn.setAttribute('aria-expanded', 'false'); return; }
        detail = h('tr', { class: 'detail' }, h('td', { colspan: showStatus ? 6 : 5 }, editPanel(p)));
        tr.after(detail); open.add(p.id); btn.setAttribute('aria-expanded', 'true');
      };
      btn.addEventListener('click', toggle);
      return [tr];
    });
    clear(body,
      h('div', { class: 'scroll' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'ID'), h('th', {}, 'Address as uploaded'), h('th', {}, 'Matched'), h('th', {}, 'Why'), showStatus ? h('th', {}, 'Status') : null, h('th', {}, h('span', { class: 'sr-only' }, 'Actions')))),
        h('tbody', {}, rows))),
      pager(offset, PAGE, r.total, (o) => { offset = o; loadPeople(); }));
  }

  function editPanel(p) {
    const msg = h('div', { role: 'status' });
    const run = async (body, what) => {
      clear(msg, 'Saving…');
      try {
        await patch('/api/people/' + p.id, body);
        say(what);
        await refreshList();
        ensurePoll();
        await loadPeople(true);
        flash(h('div', { class: 'msg ok' }, `${p.extId}: ${what}`));
      } catch (e) { clear(msg, errorBox(e)); }
    };
    const aIn = h('input', { type: 'text', id: `a-${p.id}`, value: p.address || '' });
    const zIn = h('input', { type: 'text', id: `z-${p.id}`, value: p.postcode || '' });
    const cIn = h('input', { type: 'text', id: `c-${p.id}`, value: p.city || '' });
    const laIn = h('input', { type: 'text', id: `la-${p.id}`, inputmode: 'decimal', placeholder: '46.5197', value: p.lat ?? '' });
    const loIn = h('input', { type: 'text', id: `lo-${p.id}`, inputmode: 'decimal', placeholder: '6.6323', value: p.lon ?? '' });
    return h('div', { class: 'stack' },
      h('div', { class: 'edit-grid' },
        h('div', {}, h('h3', {}, 'Suggestions'),
          p.candidates?.length
            ? p.candidates.map((c, i) => h('div', { class: 'cand' },
              h('span', { class: 'grow' }, c.label, h('span', { class: 'subtle' }, ` · ${fmtPct(c.score)} fit`)),
              h('button', { class: 'btn small', type: 'button', 'aria-label': `Use suggestion ${i + 1} for ${p.extId}: ${c.label}`, onclick: () => run({ candidate: i }, 'suggestion accepted.') }, 'Use this')))
            : h('p', { class: 'subtle' }, 'No suggestions. Correct the address or place the person by hand.')),
        h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); if (!aIn.value.trim()) { clear(msg, errorBox('Enter an address.')); return; } run({ address: aIn.value.trim(), postcode: zIn.value.trim() || undefined, city: cIn.value.trim() || undefined }, 'sent to check again.'); } },
          h('h3', {}, 'Correct the address'),
          h('div', { class: 'field' }, h('label', { for: aIn.id }, 'Street and number'), aIn),
          h('div', { class: 'form-grid' },
            h('div', { class: 'field' }, h('label', { for: zIn.id }, 'Postcode'), zIn),
            h('div', { class: 'field' }, h('label', { for: cIn.id }, 'City'), cIn)),
          h('div', {}, h('button', { class: 'btn small primary', type: 'submit' }, 'Save and check again'))),
        h('form', { class: 'stack', onsubmit: (e) => {
          e.preventDefault();
          const la = numOrNull(laIn.value), lo = numOrNull(loIn.value);
          if (la == null || lo == null || Number.isNaN(la) || Number.isNaN(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) { clear(msg, errorBox('Enter latitude and longitude as decimal numbers, e.g. 46.5197 and 6.6323.')); return; }
          run({ lat: la, lon: lo }, 'position set by hand.');
        } },
          h('h3', {}, 'Type coordinates'),
          h('div', { class: 'form-grid' },
            h('div', { class: 'field' }, h('label', { for: laIn.id }, 'Latitude'), laIn),
            h('div', { class: 'field' }, h('label', { for: loIn.id }, 'Longitude'), loIn)),
          h('div', {}, h('button', { class: 'btn small', type: 'submit' }, 'Set position')))),
      msg);
  }

  // ---- Analyses -------------------------------------------------------------------------
  const analysesBody = h('div', {});
  const formWrap = h('div', {});
  clear(analysesCard,
    h('div', { class: 'card-head' }, h('h2', { id: 'an-h' }, 'Analyses')),
    analysesBody, formWrap);

  function renderAnalyses() {
    const as = list.analyses || [];
    if (!as.length) { clear(analysesBody, empty('No analysis yet', 'Fill in the form below to run the first one.')); return; }
    clear(analysesBody, h('div', { class: 'scroll' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Site'), h('th', {}, 'Status'), h('th', {}, 'Created'))),
      h('tbody', {}, as.map((a) => h('tr', {},
        h('td', {}, h('a', { href: '#/analysis/' + encodeURIComponent(a.id) }, a.name)),
        h('td', {}, a.site.label),
        h('td', {}, h('div', { class: 'row' },
          badge(a.status === 'done' ? 'done' : a.status === 'failed' ? 'failed' : 'pending', a.status[0].toUpperCase() + a.status.slice(1)),
          a.status === 'running' ? h('span', { class: 'row' }, progressBar(a.progress, a.total, 'Progress of ' + a.name), h('span', { class: 'subtle mono' }, `${fmtInt(a.progress)}/${fmtInt(a.total)}`)) : null,
          a.outdated ? badge('outdated', 'Outdated') : null)),
        h('td', { class: 'nowrap' }, (a.createdAt || '').slice(0, 10)))))))); 
  }

  // New analysis form (built once so polling never resets what is typed)
  const nameIn = h('input', { type: 'text', id: 'na-name', autocomplete: 'off', placeholder: 'e.g. Site Lausanne, weekday mornings' });
  const siteIn = h('input', { type: 'search', id: 'na-site', autocomplete: 'off', placeholder: 'Search a place or address' });
  const siteRes = h('div', { class: 'results', hidden: true });
  const siteChosen = h('div', { class: 'row', hidden: true });
  const slots = [];
  for (let m = 0; m < 24 * 60; m += 30) slots.push(String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'));
  const fromSel = h('select', { id: 'na-from' }, slots.map((s) => h('option', { value: s, selected: s === '07:00' }, s)));
  const toSel = h('select', { id: 'na-to' }, slots.map((s) => h('option', { value: s, selected: s === '09:00' }, s)));
  const days = new Set(['mon', 'tue', 'wed', 'thu', 'fri']);
  const dayBtns = DAYS.map(([k, label]) => {
    const b = h('button', { class: 'chip', type: 'button', 'aria-pressed': String(days.has(k)), 'aria-label': { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }[k] }, label);
    b.addEventListener('click', () => { days.has(k) ? days.delete(k) : days.add(k); b.setAttribute('aria-pressed', String(days.has(k))); });
    return b;
  });
  const parkIn = h('input', { type: 'checkbox', id: 'na-park' });
  const startBtn = h('button', { class: 'btn primary', type: 'button', 'aria-describedby': 'na-gate' }, 'Start analysis');
  const gateMsg = h('p', { id: 'na-gate', class: 'muted' });
  const formMsg = h('div', { role: 'status' });
  let site = null, searchSeq = 0, timer = 0;

  async function search() {
    const q = siteIn.value.trim(), seq = ++searchSeq;
    if (q.length < 2) { siteRes.hidden = true; return; }
    clear(siteRes, h('p', { class: 'loading' }, 'Searching…')); siteRes.hidden = false;
    try {
      const r = await get('/api/places?q=' + encodeURIComponent(q));
      if (seq !== searchSeq || ctx.dead) return;
      clear(siteRes, r.length ? r.map((pl) => h('button', { type: 'button', onclick: () => pick(pl) }, pl.label, h('small', {}, pl.type || ''))) : h('p', { class: 'loading' }, 'No place found. Try another spelling.'));
    } catch (e) { if (seq === searchSeq) clear(siteRes, errorBox(e)); }
  }
  function pick(pl) {
    site = { label: pl.label, lat: pl.lat, lon: pl.lon };
    siteRes.hidden = true; siteIn.parentElement.hidden = true; siteChosen.hidden = false;
    clear(siteChosen, h('span', {}, h('b', {}, site.label)), h('button', { class: 'link-btn', type: 'button', onclick: () => { site = null; siteChosen.hidden = true; siteIn.parentElement.hidden = false; siteIn.focus(); updateGate(); } }, 'Change'));
    updateGate();
  }
  siteIn.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 300); });
  ctx.onCleanup(() => clearTimeout(timer));

  function updateGate() {
    if (!list) return;
    const p = pending(), nf = list.byStatus.notfound;
    const usable = list.people - p - nf;
    let why = '';
    if (p > 0) why = `Addresses are still being checked (${fmtInt(p)} pending). You can start once they are done.`;
    else if (usable <= 0) why = 'No person has a usable position yet. Fix the addresses above first.';
    startBtn.disabled = !!why;
    const ck = list.byStatus.check;
    clear(gateMsg, why || [
      nf > 0 ? `${fmtInt(nf)} ${nf === 1 ? 'person is' : 'people are'} “not found” and will be left out of the analysis.` : '',
      ck > 0 ? `${fmtInt(ck)} addresses still “to check” are analysed at the position of the best suggestion.` : '',
      nf === 0 && ck === 0 ? 'All people have a position.' : ''].filter(Boolean).join(' '));
  }

  startBtn.addEventListener('click', async () => {
    const problems = [];
    if (!nameIn.value.trim()) problems.push('Give the analysis a name.');
    if (!site) problems.push('Pick the work site from the search results.');
    if (toSel.value <= fromSel.value) problems.push('The arrival window must end after it starts.');
    if (!days.size) problems.push('Choose at least one working day.');
    if (problems.length) { clear(formMsg, errorBox(problems.join(' '))); return; }
    const kinds = ['transit', 'car', 'bike', 'ebike', 'walk'];
    if (parkIn.checked) kinds.push('parkRail', 'bikeRide');
    startBtn.disabled = true; clear(formMsg, 'Starting…');
    try {
      const a = await post(`/api/lists/${lid}/analyses`, {
        name: nameIn.value.trim(), site, arrival: { from: fromSel.value, to: toSel.value },
        weekdays: DAYS.map(([k]) => k).filter((k) => days.has(k)), settings: { kinds },
      });
      location.hash = '#/analysis/' + encodeURIComponent(a.id);
    } catch (e) { clear(formMsg, errorBox(e)); updateGate(); }
  });

  clear(formWrap, h('form', { class: 'pad stack', style: 'border-top:1px solid var(--border)', onsubmit: (e) => e.preventDefault() },
    h('h3', {}, 'New analysis'),
    h('div', { class: 'form-grid' },
      h('div', { class: 'field' }, h('label', { for: 'na-name' }, 'Name'), nameIn),
      h('div', { class: 'field' }, h('label', { for: 'na-site' }, 'Work site'), h('div', {}, siteIn, siteRes), siteChosen)),
    h('div', { class: 'form-grid' },
      h('div', { class: 'field' }, h('label', { for: 'na-from' }, 'Arrival from'), fromSel),
      h('div', { class: 'field' }, h('label', { for: 'na-to' }, 'Arrival until'), toSel)),
    h('fieldset', {}, h('legend', { class: 'label' }, 'Working days'), h('div', { class: 'chips' }, dayBtns)),
    h('label', { class: 'check', for: 'na-park' }, parkIn, 'Include park and ride and bike and ride'),
    gateMsg, h('div', { class: 'row' }, startBtn), formMsg));

  // ---- Start ----------------------------------------------------------------------------
  (async function init() {
    clear(peopleCard, loading('Loading…'));
    try {
      await refreshList();
      if (ctx.dead) return;
      tab = chooseTab();
      await loadPeople();
      ensurePoll();
    } catch (e) {
      clear(peopleCard, h('div', { class: 'pad' }, errorBox(e, init)));
    }
  })();

  let polling = false;
  function ensurePoll() {
    if (polling || ctx.dead || !(pending() > 0 || busyAnalyses())) return;
    polling = true;
    ctx.poll(async () => {
      let more = true;
      try {
        const before = JSON.stringify(list.byStatus);
        await refreshList();
        const changed = JSON.stringify(list.byStatus) !== before;
        if (changed && autoTab && pending() === 0) { tab = chooseTab(); offset = 0; }
        if (changed && open.size === 0) await loadPeople();
        else if (changed) renderTabsOnly();
        more = pending() > 0 || busyAnalyses();
      } catch { /* try again on the next tick */ }
      if (!more) polling = false;
      return more;
    });
  }

  function renderTabsOnly() {
    const count = (k) => (k === 'all' ? list.people : list.byStatus[k] ?? 0);
    peopleCard.querySelectorAll('.tabs button').forEach((b, i) => { b.textContent = `${TABS[i][1]} (${fmtInt(count(TABS[i][0]))})`; });
  }
}
