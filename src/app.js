import * as store from './store.js';
import * as views from './views.js';
import * as home from './home.js';

const ROUTES = [
  { path: '/',            label: 'Home',        view: home.home,          mount: home.mountHome },
  { path: '/delete',      label: 'Delete data', view: views.brokers,      mount: views.mountBrokers },
  { path: '/profile',     label: 'Settings',    view: views.profile,      mount: views.mountProfile },
  // Detail pages: reached from Home's cards, kept out of the nav.
  { path: '/unsubscribe', view: views.unsubscribe, mount: views.mountUnsubscribe, nav: false },
  { path: '/aliases',     view: views.email,       mount: views.mountEmail,       nav: false },
  { path: '/find',        view: views.exposure,    mount: views.mountExposure,    nav: false }
];

// Old hashes people may have bookmarked or that older copy still links to.
const ALIASES = { '/scan': '/', '/exposure': '/find', '/brokers': '/delete', '/email': '/aliases' };
const LETTER = { path: '/letter', view: views.letter, mount: views.mountLetter };

let catalog = [];
let current = '/';

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [rawPath, query = ''] = raw.split('?');
  const path = ALIASES[rawPath] || rawPath || '/';
  return { path, params: new URLSearchParams(query) };
}

function renderNav(path) {
  // Detail pages light up the tab they belong to.
  const owner = { '/unsubscribe': '/', '/aliases': '/profile', '/find': '/' }[path] || path;
  document.getElementById('nav').innerHTML = ROUTES.filter(r => r.nav !== false).map(r =>
    `<a href="#${r.path}" class="${r.path === owner ? 'active' : ''}">${r.label}</a>`).join('');
}

function render() {
  const { path, params } = parseHash();
  current = path;
  const route = path === '/letter' ? LETTER : (ROUTES.find(r => r.path === path) || ROUTES[0]);
  const state = store.get();

  renderNav(path === '/letter' ? '/delete' : path);

  // A fresh container per render, so a view's listeners die with its markup
  // instead of stacking up on a long-lived element.
  const el = document.createElement('div');
  try {
    el.innerHTML = route.view(state, catalog, params);
  } catch (err) {
    console.error(err);
    el.innerHTML = `<div class="card"><h2>Something broke rendering this page</h2>
      <p class="small">${views.esc(err.message)}</p>
      <p class="small muted">Your saved data is untouched. Try
      <a href="#/profile">Settings → Backup</a> to back it up, then reload.</p></div>`;
  }
  document.getElementById('main').replaceChildren(el);
  route.mount?.(el, state, render, params);
  window.scrollTo(0, 0);
}

store.subscribe(() => {
  // Home and Find update their own DOM (queues, panels, fetched results) and
  // re-render explicitly; a store write mid-queue must not wipe the progress.
  if (!['/', '/find'].includes(current)) render();
});

addEventListener('hashchange', render);

function showBuild() {
  const el = document.getElementById('build');
  if (!el) return;
  const b = el.dataset.build;
  // The deploy rewrites the placeholder; if it is still there, this is a local copy.
  el.textContent = b.startsWith('__') ? 'dev' : b;
}

async function boot() {
  showBuild();
  try {
    const res = await fetch('data/brokers.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    catalog = (await res.json()).brokers;
  } catch (err) {
    catalog = [];
    document.getElementById('main').innerHTML = `
      <div class="card">
        <h2>Could not load the target list</h2>
        <p class="small">${views.esc(err.message)}</p>
        <p class="small">This almost always means the page was opened straight from disk
        (<code>file://</code>), which browsers block from reading local files. Serve the folder instead:</p>
        <div class="letter">cd data-protection
python3 -m http.server 8000
# then open http://localhost:8000</div>
      </div>`;
    return;
  }
  render();
}

boot();
