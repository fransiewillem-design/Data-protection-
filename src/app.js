import * as store from './store.js';
import * as views from './views.js';
import * as home from './home.js';
import { L, setLang, lang } from './i18n.js';

const ROUTES = [
  { path: '/',            label: () => 'Home',                                  view: home.home,     mount: home.mountHome },
  { path: '/delete',      label: () => L('Delete data', 'Gegevens verwijderen'), view: views.brokers, mount: views.mountBrokers },
  { path: '/profile',     label: () => L('Settings', 'Instellingen'),            view: views.profile, mount: views.mountProfile },
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
    `<a href="#${r.path}" class="${r.path === owner ? 'active' : ''}">${r.label()}</a>`).join('');
}

// The interface language: what the user picked, else the browser's own.
// Separate from profile.language, which only decides the language of letters.
function uiLang(state) {
  if (state.uiLang) return state.uiLang;
  return /^nl\b/i.test(navigator.language || '') ? 'nl' : 'en';
}

// The static shell in index.html, re-labelled whenever the language changes.
function renderChrome() {
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  set('skip', L('Skip to content', 'Naar de inhoud'));
  set('local-badge', L('local only', 'alleen lokaal'));
  document.getElementById('local-badge')?.setAttribute('title', L(
    'No server, no account. Everything is stored in this browser only.',
    'Geen server, geen account. Alles staat alleen in deze browser.'));
  set('foot-local', L(
    'Everything you type stays in this browser (<code>localStorage</code>). No account, no server, no analytics. Back it up from <a href="#/profile">Settings</a>.',
    'Alles wat je invult blijft in deze browser (<code>localStorage</code>). Geen account, geen server, geen analytics. Maak een back-up via <a href="#/profile">Instellingen</a>.'));
  set('foot-build', L('Build', 'Versie'));
  set('foot-legal', L(
    'Guidance here is practical, not legal advice. Deadlines and rights cited are GDPR (EU/NL) and CCPA/CPRA (California).',
    'De uitleg hier is praktisch, geen juridisch advies. Genoemde termijnen en rechten komen uit de AVG (EU/NL) en de CCPA/CPRA (Californië).'));
  document.querySelector('.lang')?.setAttribute('aria-label', L('Language', 'Taal'));
  document.querySelectorAll('.lang [data-lang]').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.lang === lang())));
}

function render() {
  const { path, params } = parseHash();
  current = path;
  const route = path === '/letter' ? LETTER : (ROUTES.find(r => r.path === path) || ROUTES[0]);
  const state = store.get();
  setLang(uiLang(state));
  renderChrome();

  renderNav(path === '/letter' ? '/delete' : path);

  // A fresh container per render, so a view's listeners die with its markup
  // instead of stacking up on a long-lived element.
  const el = document.createElement('div');
  try {
    el.innerHTML = route.view(state, catalog, params);
  } catch (err) {
    console.error(err);
    el.innerHTML = `<div class="card"><h2>${L('Something broke rendering this page', 'Er ging iets mis bij het tonen van deze pagina')}</h2>
      <p class="small">${views.esc(err.message)}</p>
      <p class="small muted">${L(`Your saved data is untouched. Try
      <a href="#/profile">Settings → Backup</a> to back it up, then reload.`,
      `Je opgeslagen gegevens zijn ongewijzigd. Maak een back-up via
      <a href="#/profile">Instellingen → Back-up</a> en herlaad daarna.`)}</p></div>`;
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

document.querySelector('.lang')?.addEventListener('click', e => {
  const btn = e.target.closest('[data-lang]');
  if (!btn || btn.dataset.lang === lang()) return;
  store.update(s => { s.uiLang = btn.dataset.lang; });
  // Home and Find skip store-driven re-renders, so switch them explicitly.
  if (['/', '/find'].includes(current)) render();
});

function showBuild() {
  const el = document.getElementById('build');
  if (!el) return;
  const b = el.dataset.build;
  // The deploy rewrites the placeholder; if it is still there, this is a local copy.
  el.textContent = b.startsWith('__') ? 'dev' : b;
}

async function boot() {
  setLang(uiLang(store.get()));
  renderChrome();
  showBuild();
  try {
    const res = await fetch('data/brokers.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    catalog = (await res.json()).brokers;
  } catch (err) {
    catalog = [];
    document.getElementById('main').innerHTML = `
      <div class="card">
        <h2>${L('Could not load the target list', 'De lijst met bedrijven kon niet laden')}</h2>
        <p class="small">${views.esc(err.message)}</p>
        <p class="small">${L(`This almost always means the page was opened straight from disk
        (<code>file://</code>), which browsers block from reading local files. Serve the folder instead:`,
        `Dat betekent bijna altijd dat de pagina direct van schijf is geopend (<code>file://</code>); browsers
        blokkeren dan het lezen van lokale bestanden. Start in plaats daarvan een lokale server:`)}</p>
        <div class="letter">cd data-protection
python3 -m http.server 8000
# then open http://localhost:8000</div>
      </div>`;
    return;
  }
  render();
}

boot();
