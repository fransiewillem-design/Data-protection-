import * as store from './store.js';
import * as views from './views.js';

const ROUTES = [
  { path: '/',         label: 'Overview',      view: views.dashboard },
  { path: '/exposure', label: 'Exposure',      view: views.exposure,  mount: views.mountExposure },
  { path: '/brokers',  label: 'Targets',       view: views.brokers,   mount: views.mountBrokers },
  { path: '/email',    label: 'Email defence', view: views.email,     mount: views.mountEmail },
  { path: '/profile',  label: 'Your details',  view: views.profile,   mount: views.mountProfile }
];
const LETTER = { path: '/letter', view: views.letter, mount: views.mountLetter };

let catalog = [];
let current = '/';

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path: path || '/', params: new URLSearchParams(query) };
}

function renderNav(path) {
  document.getElementById('nav').innerHTML = ROUTES.map(r =>
    `<a href="#${r.path}" class="${r.path === path ? 'active' : ''}">${r.label}</a>`).join('');
}

function render() {
  const { path, params } = parseHash();
  current = path;
  const route = path === '/letter' ? LETTER : (ROUTES.find(r => r.path === path) || ROUTES[0]);
  const state = store.get();

  renderNav(path === '/letter' ? '/brokers' : path);

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
      <a href="#/profile">Your details → Export</a> to back it up, then reload.</p></div>`;
  }
  document.getElementById('main').replaceChildren(el);
  route.mount?.(el, state, render, params);
  window.scrollTo(0, 0);
}

store.subscribe(() => {
  // Exposure holds fetched results that a full re-render would throw away;
  // it updates its own DOM in place instead.
  if (current !== '/exposure') render();
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
