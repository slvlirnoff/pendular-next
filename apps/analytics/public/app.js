// Commute Analytics: router. State lives in the URL hash: #/ , #/list/<id>, #/analysis/<id>.
import { h, clear, errorBox } from './util.js';
import { homeView } from './home.js';
import { listView } from './list.js';
import { analysisView } from './analysis.js';

const main = document.getElementById('main');
const routes = [[/^#\/list\/([^/]+)$/, listView], [/^#\/analysis\/([^/]+)$/, analysisView], [/^#\/?$/, homeView]];
let ctx = null;

function makeCtx() {
  const c = { dead: false, timer: 0, cleanups: [] };
  c.onCleanup = (f) => c.cleanups.push(f);
  c.poll = (fn, ms = 2000) => {
    const tick = async () => {
      if (c.dead) return;
      let more = false;
      try { more = await fn(); } catch { more = true; }
      if (!c.dead && more) c.timer = setTimeout(tick, ms);
    };
    c.timer = setTimeout(tick, ms);
  };
  c.destroy = () => { c.dead = true; clearTimeout(c.timer); c.cleanups.forEach((f) => f()); };
  return c;
}

function route() {
  ctx?.destroy();
  ctx = makeCtx();
  clear(main);
  window.scrollTo(0, 0);
  const hash = location.hash || '#/';
  for (const [re, view] of routes) {
    const m = hash.match(re);
    if (!m) continue;
    try { view(main, ctx, ...m.slice(1).map(decodeURIComponent)); }
    catch (e) { main.append(errorBox(e)); }
    main.querySelector('h1')?.focus({ preventScroll: true });
    return;
  }
  main.append(h('h1', { tabindex: '-1' }, 'Page not found'), h('p', {}, h('a', { href: '#/' }, 'Go to the lists')));
}
window.addEventListener('hashchange', route);
route();
