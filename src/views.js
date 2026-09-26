import * as store from './store.js';
import { TEMPLATES, render as renderLetter, suggestedTemplate } from './letters.js';
import { allBreaches, breachesForAccount, pwnedPasswordCount } from './hibp.js';
import { parseMessages, groupBySender } from './mailscan.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// esc() stops an attribute breakout but not a `javascript:` payload, and broker
// entries can arrive from an imported backup file. Only ever emit http(s) hrefs:
// a script URL here would run with access to everything in localStorage.
export function safeUrl(u) {
  try {
    const parsed = new URL(String(u ?? ''), location.href);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

export function toast(msg) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

const CATEGORIES = {
  'people-search': 'People-search sites',
  'marketing-data': 'Marketing data brokers',
  'b2b-contact': 'B2B contact scrapers',
  'credit-bureau': 'Credit bureaus',
  'search-engine': 'Search engines',
  'nl': 'Netherlands-specific',
  'breach': 'Breached company'
};

export function allTargets(state, catalog) {
  return [...catalog, ...state.custom];
}

// ---------------------------------------------------------------- dashboard

export function dashboard(state, catalog) {
  const targets = allTargets(state, catalog);
  const recs = targets.map(b => ({ b, r: store.getRequest(b.id) }));
  const overdue = recs.filter(({ b, r }) => store.isOverdue(b, r));
  const sent = recs.filter(({ r }) => ['sent', 'ack', 'escalated'].includes(r.status));
  const done = recs.filter(({ r }) => r.status === 'done');
  const p = state.profile;
  const profileReady = p.fullName && p.emails.length;

  return `
  <div class="head">
    <h1>Overview</h1>
    <p>Two jobs, both ongoing. Get your data deleted where the law lets you force it, and make sure
    the next leak only burns one throwaway address instead of your real one.</p>
  </div>

  ${!profileReady ? `<div class="notice">
    <p><strong>Start here.</strong> The letters need your name and email addresses to be valid requests.
    <a href="#/profile">Fill in your details</a> — it stays in this browser.</p>
  </div>` : ''}

  ${overdue.length ? `<div class="notice bad">
    <p><strong>${overdue.length} ${overdue.length === 1 ? 'company is' : 'companies are'} past the legal deadline.</strong>
    Missing the deadline is itself a breach of Art. 12(3) GDPR — that is your ground for escalating.</p>
  </div>` : ''}

  <div class="grid cols-4">
    <div class="card stat"><div class="n">${targets.length}</div><div class="l">Targets tracked</div></div>
    <div class="card stat"><div class="n">${sent.length}</div><div class="l">Requests in flight</div></div>
    <div class="card stat ${overdue.length ? 'bad' : ''}"><div class="n">${overdue.length}</div><div class="l">Past deadline</div></div>
    <div class="card stat ok"><div class="n">${done.length}</div><div class="l">Confirmed erased</div></div>
  </div>

  ${overdue.length ? `<div class="card">
    <h2>Chase these</h2>
    ${overdue.map(({ b, r }) => `
      <div class="item">
        <div class="body">
          <div class="name">${esc(b.name)}</div>
          <div class="meta">Sent ${esc(r.sentAt)} — ${store.daysSince(r.sentAt)} days ago,
          deadline was ${store.deadlineDays(b)} days.</div>
        </div>
        <div class="actions">
          <a class="btn" href="#/letter?b=${encodeURIComponent(b.id)}&t=reminder">Reminder</a>
          <a class="btn" href="#/letter?b=${encodeURIComponent(b.id)}&t=complaint">Complaint</a>
        </div>
      </div>`).join('')}
  </div>` : ''}

  <div class="grid cols-2">
    <div class="card">
      <h2>The deletion side</h2>
      <p class="small muted">Nothing can sweep the internet and erase you. What works is Article 17 GDPR:
      a company that receives a valid request has one month to erase your data or justify keeping it.</p>
      <ol class="small">
        <li>Find who holds your data — <a href="#/exposure">Exposure</a></li>
        <li>Send the requests — <a href="#/brokers">Targets</a></li>
        <li>Chase the ones who ignore you, then complain to the regulator</li>
        <li>Re-run the people-search sites twice a year; they re-list</li>
      </ol>
    </div>
    <div class="card">
      <h2>The spam side</h2>
      <p class="small muted">Filters are an arms race you lose. Compartmentalising wins: every company gets
      its own address, so a leak is contained and you learn exactly who sold you out.</p>
      <p class="small"><a href="#/email">Set up the alias system →</a></p>
      <p class="small muted">${state.aliases.length
        ? `${state.aliases.length} aliases tracked, ${state.aliases.filter(a => a.status === 'burned').length} burned.`
        : 'No aliases tracked yet.'}</p>
    </div>
  </div>`;
}

// ----------------------------------------------------------------- exposure

export function exposure(state) {
  const added = state.custom;

  const QUERIES = [
    ['"privacy policy" update',
     'The highest-yield search there is. When a company changes its privacy policy it must notify everyone whose data it holds — so every hit is a company holding your data, including ones you forgot about years ago.'],
    ['"welcome to"',
     'Signup confirmations. Every account you have ever opened.'],
    ['"verify your email"',
     'Catches accounts the welcome search misses.'],
    ['unsubscribe',
     'Every marketing list you are on. If they can mail you, they hold your data.'],
    ['"your order"',
     'Shops. These hold your postal address and often your card details too.']
  ];

  return `
  <div class="head">
    <h1>Who has your data</h1>
    <p>Three sources, in order of how much they turn up. Everything you find becomes a company you can order
    to erase you under Article 17 GDPR — that is what the next page does with it.</p>
  </div>

  <div class="card">
    <h2>1. Scan your mail</h2>
    <p class="small muted">Drag messages out of your Junk or Inbox folder and drop them here. Works with any
    provider, including iCloud.</p>
    <p class="small muted"><strong>What happens to the mail:</strong> it is read in memory by this page and
    never uploaded — there is no server to upload it to. Nothing from the messages is saved either: close
    this tab and it is gone. Only the companies you explicitly add are kept, as a name and a domain, in this
    browser. No subject lines, no message text, ever.</p>

    <div id="drop" class="drop">
      <p><strong>Drop .eml or .mbox files here</strong></p>
      <p class="small muted">or <button data-action="pick">choose files</button></p>
      <input type="file" id="files" multiple accept=".eml,.mbox,.txt,message/rfc822" style="display:none">
    </div>

    <details style="margin-top:12px">
      <summary class="small muted" style="cursor:pointer">How do I get the files out of my mail app?</summary>
      <ul class="small muted" style="margin-top:10px">
        <li><strong>Apple Mail (iCloud):</strong> open the Junk mailbox, select all (<code>Cmd+A</code>), then
        drag the selection onto your Desktop. You get one <code>.eml</code> per message. Drop them here.</li>
        <li><strong>Outlook (desktop):</strong> same — select in Junk Email and drag to a Finder or Explorer
        window.</li>
        <li><strong>Gmail:</strong> Google Takeout → deselect all → select <em>Mail</em> → export. You get an
        <code>.mbox</code>; drop that in directly.</li>
      </ul>
    </details>

    <div id="scan-result" style="margin-top:14px"></div>
  </div>

  <div class="card">
    <h2>1b. Or find them by searching your mail</h2>
    <p class="small muted">No export needed — run these searches in your mail app and add what you find by
    hand. Slower, but it reaches mail you would never think to export.</p>
    <details>
      <summary class="small muted" style="cursor:pointer">Show the searches</summary>
      ${QUERIES.map(([q, why]) => `
        <div class="item">
          <div class="body">
            <div class="name mono">${esc(q)}</div>
            <div class="meta">${esc(why)}</div>
          </div>
          <div class="actions"><button data-action="copy-query" data-q="${esc(q)}">Copy</button></div>
        </div>`).join('')}
    </details>

    <p class="small" style="margin-top:14px"><strong>Add a company by hand:</strong></p>
    <div class="row">
      <input id="qa-company" placeholder="Company name" style="flex:1;min-width:160px">
      <input id="qa-domain" placeholder="their-domain.com (optional)" style="flex:1;min-width:160px">
      <button class="primary" data-action="quick-add">Add &amp; write letter</button>
    </div>
    <div id="qa-added" style="margin-top:10px">
      ${added.length ? `<p class="small muted">${added.length} added so far:</p>` + added.map(c => `
        <div class="item">
          <div class="body"><div class="name">${esc(c.name)}</div></div>
          <div class="actions"><a class="btn" href="#/letter?b=${encodeURIComponent(c.id)}">Letter</a></div>
        </div>`).join('') : ''}
    </div>
  </div>

  <div class="card">
    <h2>2. Data brokers — assume they already have you</h2>
    <p class="small muted">These never emailed you and never will. They buy, merge and resell personal data on
    almost every adult in Europe, which is why there is nothing to discover here: assume you are in their
    files and make them prove otherwise. 37 are already loaded, with their opt-out pages and a letter each.</p>
    <p class="small muted">Do the marketing brokers first — they are the upstream suppliers, so cutting them
    off reduces what everyone downstream can buy about you.</p>
    <div class="row">
      <a class="btn primary" href="#/brokers?cat=marketing-data">Start with the marketing brokers →</a>
      <a class="btn" href="#/brokers">See all 37 targets</a>
    </div>
  </div>

  <div class="card">
    <h2>3. Public breach records</h2>
    <p class="small muted">Companies that lost your data to attackers. Free to check — the breach database
    charges only for automated lookups, never for searching your own address on their site.</p>

    ${state.profile.emails.length ? `
      ${state.profile.emails.map(e => `
        <div class="item">
          <div class="body"><div class="name mono">${esc(e)}</div></div>
          <div class="actions">
            <button data-action="hibp-open" data-email="${esc(e)}">Copy &amp; check ↗</button>
          </div>
        </div>`).join('')}
      <p class="small muted" style="margin-top:10px">Copies the address and opens the database — paste it into
      their search box. Add anything it finds using the box in section 1, or the browser below.</p>
    ` : `<p class="small muted">Add your email addresses on <a href="#/profile">Your details</a> first, then
      check each one here.</p>`}

    <p class="small muted">Breaches classed as sensitive are hidden from the public search. To see those,
    verify the address through the <em>Notify me</em> section of that site — also free, and it warns you about
    future breaches.</p>

    <div class="row" style="margin-top:12px">
      <input id="breach-q" placeholder="Or search the breach list (e.g. linkedin)" style="flex:1;min-width:200px">
      <button data-action="load-breaches">Load list</button>
    </div>
    <div id="breach-result" style="margin-top:12px"></div>

    <details style="margin-top:14px">
      <summary class="small muted" style="cursor:pointer">Optional: automate this with a paid API key</summary>
      <p class="small muted" style="margin-top:10px">Only worth it if you own many addresses and want results
      listed here rather than on their site. <strong>This is the one request in this app that transmits
      personal data</strong> — it sends the address being checked. Nothing else here does.</p>
      <div class="row">
        <select id="acct-email" style="flex:1;min-width:200px">
          ${state.profile.emails.length
            ? state.profile.emails.map(e => `<option>${esc(e)}</option>`).join('')
            : '<option value="">Add an email on "Your details" first</option>'}
        </select>
        <button data-action="check-account" ${state.hibpKey ? '' : 'disabled'}>Check address</button>
      </div>
      ${state.hibpKey ? '' : `<p class="small muted" style="margin-top:8px">No key saved — add one on
        <a href="#/profile">Your details</a> to enable this.</p>`}
      <div id="acct-result" style="margin-top:10px"></div>
    </details>
  </div>

  <div class="card">
    <h2>Has a password of yours leaked?</h2>
    <p class="small muted">Safe to run: the password is hashed on this device and only the first five
    characters of that hash are sent, so the service cannot tell which password you asked about.</p>
    <div class="row">
      <input type="password" id="pw" placeholder="Password to check" autocomplete="off" style="flex:1;min-width:200px">
      <button data-action="check-pw">Check</button>
    </div>
    <div id="pw-result" class="small" style="margin-top:10px"></div>
  </div>`;
}

export function mountExposure(root, state, rerender) {
  let breaches = null;

  root.addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'check-pw') {
      const out = root.querySelector('#pw-result');
      const pw = root.querySelector('#pw').value;
      if (!pw) return;
      out.textContent = 'Checking…';
      try {
        const n = await pwnedPasswordCount(pw);
        out.innerHTML = n === 0
          ? `<span class="pill done">Not found</span> This password does not appear in any known leak. That is not
             the same as "strong" — a unique passphrase in a password manager still beats it.`
          : `<span class="pill overdue">Seen ${n.toLocaleString()}×</span> This password has leaked.
             Change it anywhere you used it, and never reuse it.`;
        root.querySelector('#pw').value = '';
      } catch (err) {
        out.innerHTML = `<span class="pill overdue">Could not reach the service</span>
          ${esc(err.message)}. Check your connection — some networks and content blockers block this API.`;
      }
    }

    if (action === 'pick') root.querySelector('#files').click();

    if (action === 'add-sender') {
      addSenderAsTarget(btn.dataset.name, btn.dataset.domain);
      btn.outerHTML = '<span class="pill done">letter ready</span>';
    }

    if (action === 'add-all-senders') {
      const list = window.__drSenders || [];
      let n = 0;
      for (const sn of list) if (addSenderAsTarget(sn.name, sn.domain, true)) n++;
      toast(`${n} companies added — see Targets`);
    }

    if (action === 'copy-query') {
      try {
        await navigator.clipboard.writeText(btn.dataset.q);
        toast('Copied — paste it into your mail search');
      } catch {
        toast('Type it into your mail search box');
      }
    }

    if (action === 'quick-add') {
      const nameEl = root.querySelector('#qa-company');
      const domEl = root.querySelector('#qa-domain');
      const name = nameEl.value.trim();
      const site = domEl.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!name) { toast('Give the company a name first'); return; }

      const id = 'custom:' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      if (state.custom.some(c => c.id === id)) { toast(`${name} is already on your list`); return; }

      store.update(st => st.custom.push({
        id, name, category: 'breach', regions: ['EU'], site,
        optOutUrl: site ? `https://${site}` : '',
        email: site ? `privacy@${site}` : '',
        method: 'email', confidence: 'low',
        notes: 'Added from your mailbox audit. Check their privacy policy for the real contact address before sending.'
      }));

      // This view suppresses the global re-render (it holds fetched results),
      // so append the new row by hand.
      const list = root.querySelector('#qa-added');
      const row = document.createElement('div');
      row.className = 'item';
      row.innerHTML = `<div class="body"><div class="name">${esc(name)}</div></div>
        <div class="actions"><a class="btn" href="#/letter?b=${encodeURIComponent(id)}">Letter</a></div>`;
      list.appendChild(row);
      nameEl.value = '';
      domEl.value = '';
      nameEl.focus();
      toast(`${name} added — letter ready`);
    }

    if (action === 'hibp-open') {
      // Open before copying: awaiting the clipboard first breaks the user-gesture
      // chain and the popup blocker eats the new tab.
      window.open('https://haveibeenpwned.com/', '_blank', 'noopener,noreferrer');
      try {
        await navigator.clipboard.writeText(btn.dataset.email);
        toast('Address copied — paste it into their search box');
      } catch {
        toast('Opened HIBP — type the address into their search box');
      }
    }

    if (action === 'check-account') {
      const out = root.querySelector('#acct-result');
      const email = root.querySelector('#acct-email').value;
      if (!email) return;
      out.textContent = 'Checking…';
      try {
        const list = await breachesForAccount(email, state.hibpKey);
        out.innerHTML = list.length === 0
          ? '<p class="small"><span class="pill done">Clean</span> No known breaches for this address.</p>'
          : `<p class="small"><strong>${list.length} breaches.</strong> Each is a company you can order to erase you.</p>`
            + list.map(b => breachRow(b, state)).join('');
      } catch (err) {
        out.innerHTML = `<p class="small"><span class="pill overdue">Failed</span> ${esc(err.message)}</p>`;
      }
    }

    if (action === 'load-breaches') {
      const out = root.querySelector('#breach-result');
      out.textContent = 'Loading…';
      try {
        breaches = await allBreaches();
        renderBreachList(root, breaches, state);
      } catch (err) {
        out.innerHTML = `<p class="small"><span class="pill overdue">Could not reach HIBP</span>
          ${esc(err.message)}. Either the network blocked the request, or you opened this file straight from
          disk — it needs to run through a local web server. See the README.</p>`;
      }
    }

    if (action === 'add-breach-target') {
      const { name, domain } = btn.dataset;
      const id = 'breach:' + (domain || name).toLowerCase().replace(/[^a-z0-9]+/g, '-');
      if (state.custom.some(c => c.id === id)) { toast('Already on your target list'); return; }
      store.update(s => s.custom.push({
        id, name, category: 'breach', regions: ['EU', 'US'],
        site: domain || '', optOutUrl: domain ? `https://${domain}` : '',
        email: domain ? `privacy@${domain}` : '', method: 'email', confidence: 'low',
        notes: 'Added from the breach list. Confirm the privacy contact address before sending.'
      }));
      btn.outerHTML = '<span class="pill sent">on your list</span>';
      toast(`${name} added to your targets`);
    }
  });

  function addSenderAsTarget(name, domain, quiet) {
    const label = name && name !== domain ? name : domain;
    const id = 'mail:' + domain;
    if (state.custom.some(c => c.id === id)) return false;
    store.update(st => st.custom.push({
      id, name: label, category: 'breach', regions: ['EU'], site: domain,
      optOutUrl: `https://${domain}`, email: `privacy@${domain}`,
      method: 'email', confidence: 'low',
      notes: `Found in your own mail: ${domain} has been sending to you, so it holds your address. Confirm their privacy contact before sending.`
    }));
    if (!quiet) toast(`${label} added — letter ready`);
    return true;
  }

  // ---- mail scanning ------------------------------------------------------

  const drop = root.querySelector('#drop');
  const fileInput = root.querySelector('#files');

  async function handleFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    const out = root.querySelector('#scan-result');
    out.innerHTML = `<p class="small muted">Reading ${files.length} file(s)…</p>`;
    try {
      const texts = await Promise.all(files.map(f => f.text()));
      const messages = texts.flatMap(t => parseMessages(t));
      if (!messages.length) {
        out.innerHTML = `<div class="notice warn"><p>No mail headers found in those files. Make sure they are
          <code>.eml</code> or <code>.mbox</code> exports rather than screenshots or PDFs.</p></div>`;
        return;
      }
      renderScan(out, groupBySender(messages), messages.length, files.length);
    } catch (err) {
      out.innerHTML = `<div class="notice bad"><p>Could not read those files: ${esc(err.message)}</p></div>`;
    }
  }

  function renderScan(out, senders, msgCount, fileCount) {
    const withUnsub = senders.filter(x => x.unsubHttp || x.unsubMailto);
    out.innerHTML = `
      <div class="notice">
        <p><strong>${msgCount} messages from ${senders.length} companies</strong>, read from ${fileCount}
        file(s) on this device. ${withUnsub.length} of them offer a working unsubscribe.</p>
      </div>
      <div class="row" style="margin-bottom:10px">
        <button class="primary" data-action="add-all-senders">Add all ${senders.length} as targets</button>
      </div>
      ${senders.map(sn => {
        const legit = !!(sn.unsubHttp || sn.unsubMailto);
        return `
        <div class="item" data-sender="${esc(sn.domain)}">
          <div class="body">
            <div class="name">${esc(sn.name)}
              <span class="pill ${legit ? 'sent' : 'overdue'}">${legit ? 'real sender' : 'no unsubscribe'}</span>
              <span class="pill">${sn.count} mail${sn.count === 1 ? '' : 's'}</span>
            </div>
            <div class="meta mono">${esc(sn.domain)}</div>
            ${sn.subjects.length ? `<div class="meta">${esc(sn.subjects[0])}</div>` : ''}
          </div>
          <div class="actions">
            ${sn.unsubHttp && safeUrl(sn.unsubHttp)
              ? `<a class="btn" href="${esc(safeUrl(sn.unsubHttp))}" target="_blank" rel="noopener noreferrer">Unsubscribe ↗</a>`
              : ''}
            <button data-action="add-sender" data-name="${esc(sn.name)}" data-domain="${esc(sn.domain)}">Demand deletion</button>
          </div>
        </div>`;
      }).join('')}
      <div class="notice warn" style="margin-top:14px">
        <p><strong>Treat the two groups differently.</strong> A sender marked <em>real sender</em> published a
        standards-compliant unsubscribe link, which means a real company with a legal department — unsubscribe
        works, and so does an erasure demand.</p>
        <p>A sender marked <em>no unsubscribe</em> is usually a criminal operation on a throwaway domain.
        <strong>Do not click anything in those messages</strong>: it confirms a human reads the mailbox and
        raises your value on the lists. An erasure letter to them will bounce. Report as junk and move on —
        the fix for those is a fresh alias, not a letter.</p>
      </div>`;
    window.__drSenders = senders;   // handed to the bulk-add handler
  }

  if (drop) {
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => {
      e.preventDefault(); drop.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => {
      e.preventDefault(); drop.classList.remove('over');
    }));
    drop.addEventListener('drop', e => handleFiles(e.dataTransfer.files));
  }
  fileInput?.addEventListener('change', () => handleFiles(fileInput.files));

  root.addEventListener('input', e => {
    if (e.target.id === 'breach-q' && breaches) renderBreachList(root, breaches, state);
  });

  function renderBreachList(rootEl, list, st) {
    const q = (rootEl.querySelector('#breach-q')?.value || '').toLowerCase().trim();
    const filtered = q
      ? list.filter(b => (b.Name + ' ' + b.Title + ' ' + (b.Domain || '')).toLowerCase().includes(q))
      : [];
    const out = rootEl.querySelector('#breach-result');
    if (!q) {
      out.innerHTML = `<p class="small muted">${list.length} breaches loaded. Type above to search.</p>`;
      return;
    }
    out.innerHTML = filtered.length
      ? filtered.slice(0, 40).map(b => breachRow(b, st)).join('')
      : '<p class="small muted">No match.</p>';
  }
}

function breachRow(b, state) {
  const already = state.custom.some(c => c.id === 'breach:' + ((b.Domain || b.Name).toLowerCase().replace(/[^a-z0-9]+/g, '-')));
  return `
  <div class="item">
    <div class="body">
      <div class="name">${esc(b.Title || b.Name)} <span class="muted small">${esc(b.BreachDate || '')}</span></div>
      <div class="meta">${esc((b.DataClasses || []).join(', ')) || 'unknown data'}
        ${b.IsSensitive ? '<span class="pill overdue">sensitive</span>' : ''}</div>
    </div>
    <div class="actions">
      ${already
        ? '<span class="pill sent">on your list</span>'
        : `<button data-action="add-breach-target" data-name="${esc(b.Title || b.Name)}"
             data-domain="${esc(b.Domain || '')}">Add as target</button>`}
    </div>
  </div>`;
}

// ------------------------------------------------------------------ targets

export function brokers(state, catalog, params) {
  const targets = allTargets(state, catalog);
  const cat = params.get('cat') || '';
  const q = (params.get('q') || '').toLowerCase();

  const shown = targets.filter(b => {
    if (cat && b.category !== cat) return false;
    if (q && !(b.name + ' ' + (b.site || '')).toLowerCase().includes(q)) return false;
    return true;
  });

  const cats = [...new Set(targets.map(b => b.category))];

  return `
  <div class="head">
    <h1>Targets</h1>
    <p>Each of these is a company you can send a legally binding erasure request to. Work top down — the
    marketing data brokers feed the rest, so they are worth doing first.</p>
  </div>

  <div class="card">
    <div class="row">
      <input id="target-q" placeholder="Search targets" value="${esc(params.get('q') || '')}" style="flex:1;min-width:180px">
      <select id="target-cat">
        <option value="">All categories</option>
        ${cats.map(c => `<option value="${esc(c)}" ${c === cat ? 'selected' : ''}>${esc(CATEGORIES[c] || c)}</option>`).join('')}
      </select>
      <button data-action="add-custom">Add company</button>
    </div>
  </div>

  <div class="card">
    ${shown.length ? shown.map(b => targetRow(b, state)).join('') : '<p class="muted">No targets match.</p>'}
  </div>

  <p class="small muted">Opt-out links were last reviewed on the date in <code>data/brokers.json</code>.
  These companies move their forms constantly — if a link 404s, search the site for "privacy" or "opt out"
  and send the letter to their DPO instead.</p>`;
}

function targetRow(b, state) {
  const r = store.getRequest(b.id);
  const overdue = store.isOverdue(b, r);
  const pill = overdue ? 'overdue' : (store.STATUSES[r.status]?.pill || 'todo');
  const label = overdue ? `Overdue by ${store.daysSince(r.sentAt) - store.deadlineDays(b)}d` : store.STATUSES[r.status]?.label;

  return `
  <div class="item">
    <div class="body">
      <div class="name">${esc(b.name)}
        <span class="pill ${pill}">${esc(label)}</span>
        ${b.confidence === 'low' ? '<span class="pill low">unverified link</span>' : ''}
      </div>
      <div class="meta">${esc(CATEGORIES[b.category] || b.category)}
        ${b.site ? `· ${esc(b.site)}` : ''}
        ${r.sentAt ? `· sent ${esc(r.sentAt)}` : ''}</div>
      ${b.notes ? `<div class="meta">${esc(b.notes)}</div>` : ''}
    </div>
    <div class="actions">
      ${safeUrl(b.optOutUrl) ? `<a class="btn" href="${esc(safeUrl(b.optOutUrl))}" target="_blank" rel="noopener noreferrer">Opt-out page ↗</a>` : ''}
      <a class="btn primary" href="#/letter?b=${encodeURIComponent(b.id)}">Letter</a>
      <select data-action="set-status" data-id="${esc(b.id)}" style="width:auto">
        ${Object.entries(store.STATUSES).map(([k, v]) =>
          `<option value="${k}" ${r.status === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}
      </select>
    </div>
  </div>`;
}

export function mountBrokers(root, state, rerender) {
  root.addEventListener('change', e => {
    const sel = e.target.closest('[data-action="set-status"]');
    if (sel) { store.setStatus(sel.dataset.id, sel.value); toast('Status updated'); return; }
    if (e.target.id === 'target-cat') {
      const q = root.querySelector('#target-q').value;
      location.hash = `#/brokers?cat=${encodeURIComponent(e.target.value)}&q=${encodeURIComponent(q)}`;
    }
  });

  let timer;
  root.addEventListener('input', e => {
    if (e.target.id !== 'target-q') return;
    clearTimeout(timer);
    const cat = root.querySelector('#target-cat').value;
    timer = setTimeout(() => {
      location.hash = `#/brokers?cat=${encodeURIComponent(cat)}&q=${encodeURIComponent(e.target.value)}`;
    }, 350);
  });

  root.addEventListener('click', e => {
    if (!e.target.closest('[data-action="add-custom"]')) return;
    const name = prompt('Company name');
    if (!name) return;
    const site = prompt('Website domain (optional), e.g. example.com') || '';
    const id = 'custom:' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    store.update(s => s.custom.push({
      id, name, category: 'breach', regions: ['EU', 'US'], site,
      optOutUrl: site ? `https://${site}` : '', email: site ? `privacy@${site}` : '',
      method: 'email', confidence: 'low', notes: 'Added by you. Confirm the privacy contact before sending.'
    }));
    toast(`${name} added`);
  });
}

// ------------------------------------------------------------------- letter

export function letter(state, catalog, params) {
  const targets = allTargets(state, catalog);
  const b = targets.find(x => x.id === params.get('b'));
  if (!b) return '<div class="card"><p>Unknown target. <a href="#/brokers">Back to targets</a></p></div>';

  const rec = store.getRequest(b.id);
  const tid = params.get('t') || suggestedTemplate(b, state.profile);
  const { subject, body } = renderLetter(tid, b, state.profile, rec);
  const to = b.email || '';
  const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return `
  <div class="head no-print">
    <h1>${esc(b.name)}</h1>
    <p>Read it before you send it. Delete any clause that does not apply to you — a request you can stand
    behind beats a maximalist one you cannot.</p>
  </div>

  ${b.method === 'form' && safeUrl(b.optOutUrl) ? `<div class="notice no-print">
    <p><strong>This one has a self-serve form.</strong> Use
    <a href="${esc(safeUrl(b.optOutUrl))}" target="_blank" rel="noopener noreferrer">their opt-out page</a> first —
    it is usually faster. Send this letter if the form fails, asks for ID, or nothing happens.</p>
  </div>` : ''}

  ${b.confidence === 'low' ? `<div class="notice warn no-print">
    <p><strong>Unverified contact.</strong> <code>${esc(to || 'no address on file')}</code> is a guess based on
    their domain. Check their privacy policy for the real DPO address before sending, or it will bounce.</p>
  </div>` : ''}

  <div class="card no-print">
    <div class="row">
      <label for="tpl" style="margin:0">Template</label>
      <select id="tpl" style="width:auto">
        ${Object.entries(TEMPLATES).map(([k, t]) =>
          `<option value="${k}" ${k === tid ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}
      </select>
      <div class="spacer"></div>
      <button data-action="copy">Copy letter</button>
      ${to ? `<a class="btn" href="${mailto}">Open in mail app</a>` : ''}
      <button data-action="print">Print / PDF</button>
      <button class="primary" data-action="mark-sent">Mark as sent</button>
    </div>
  </div>

  <div class="card">
    <p class="small muted no-print">To: <code>${esc(to || '—')}</code></p>
    <p class="small"><strong>Subject:</strong> ${esc(subject)}</p>
    <div class="letter" id="letter-body">${esc(body)}</div>
  </div>

  <div class="card no-print">
    <h2>Notes &amp; history</h2>
    <div class="field">
      <label for="notes">Your notes on this company</label>
      <textarea id="notes" placeholder="Reference number they gave you, who replied, what they claimed…">${esc(rec.notes || '')}</textarea>
      <button data-action="save-notes" style="margin-top:6px">Save notes</button>
    </div>
    ${rec.history?.length ? `<table>
      <thead><tr><th>When</th><th>Event</th></tr></thead>
      <tbody>${rec.history.slice().reverse().map(h =>
        `<tr><td>${esc(h.ts.slice(0, 16).replace('T', ' '))}</td><td>${esc(h.event)}</td></tr>`).join('')}</tbody>
    </table>` : '<p class="small muted">Nothing logged yet.</p>'}
  </div>`;
}

export function mountLetter(root, state, rerender, params) {
  const id = params.get('b');

  root.addEventListener('change', e => {
    if (e.target.id === 'tpl') {
      location.hash = `#/letter?b=${encodeURIComponent(id)}&t=${encodeURIComponent(e.target.value)}`;
    }
  });

  root.addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const a = btn.dataset.action;

    if (a === 'copy') {
      const text = root.querySelector('#letter-body').textContent;
      try {
        await navigator.clipboard.writeText(text);
        toast('Letter copied');
      } catch {
        // Clipboard API needs a secure context; fall back to selecting the text.
        const range = document.createRange();
        range.selectNodeContents(root.querySelector('#letter-body'));
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        toast('Selected — press Cmd/Ctrl+C');
      }
    }
    if (a === 'print') window.print();
    if (a === 'mark-sent') { store.setStatus(id, 'sent'); toast('Marked as sent — deadline clock started'); }
    if (a === 'save-notes') { store.setNotes(id, root.querySelector('#notes').value); toast('Notes saved'); }
  });
}

// -------------------------------------------------------------------- email

export function email(state) {
  const aliases = state.aliases;
  const burned = aliases.filter(a => a.status === 'burned');

  return `
  <div class="head">
    <h1>Email defence</h1>
    <p>You cannot block spam that is already addressed to you. You can make your real address worthless to
    leak, by never giving it out again.</p>
  </div>

  <div class="card">
    <h2>The system</h2>
    <ol>
      <li><strong>Keep your real address private.</strong> It goes to people you know, your bank, and the
      tax office. Nothing else, ever again.</li>
      <li><strong>One alias per company.</strong> On iCloud+ this is Hide My Email, built into Safari and
      Mail — unlimited, free with any paid iCloud plan. Fastmail, Proton, addy.io, SimpleLogin and
      DuckDuckGo Email Protection all do the same.</li>
      <li><strong>When an alias starts getting spam, you know who leaked it.</strong> Log it below, then
      delete the alias. The spam stops instantly, at the source, with no filter to maintain.</li>
      <li><strong>Avoid plus-addressing</strong> (<code>you+shop@…</code>) for this. It is trivially stripped
      back to your real address, so it identifies the leaker but does not protect you.</li>
    </ol>
    <p class="small muted">Why this beats filtering: a filter fights every new sender forever. Deleting an
    alias ends that stream permanently, and the address cannot be re-sold because it no longer exists.</p>
  </div>

  <div class="card">
    <h2>Handling what is already arriving</h2>
    <ul class="small">
      <li><strong>Legitimate marketing you once signed up for</strong> — use the unsubscribe link. In the EU
      they must honour it, and you can cite Art. 21(3) GDPR if they do not.</li>
      <li><strong>Criminal spam and phishing</strong> — never click unsubscribe. It confirms a live human
      reads the mailbox and raises your value on the lists. Report as junk and delete.</li>
      <li><strong>Spam to an address you never gave out</strong> — it came from a breach or a broker. Add that
      company on the <a href="#/exposure">Exposure</a> page.</li>
      <li><strong>Extortion mail quoting a real password</strong> — it is from a breach dump, not a hacked
      camera. Change that password everywhere, ignore the rest.</li>
      <li><strong>Turn off remote images</strong> in Mail. Tracking pixels confirm you opened it.</li>
    </ul>
  </div>

  <div class="card">
    <h2>Alias tracker <span class="muted small">${aliases.length} tracked${burned.length ? `, ${burned.length} burned` : ''}</span></h2>
    <p class="small muted">Log which alias you gave to which company. When spam turns up, this tells you who
    sold or leaked it — and that company becomes a target for an erasure request.</p>
    <div class="row">
      <input id="al-alias" placeholder="alias@icloud.com" style="flex:1;min-width:180px">
      <input id="al-service" placeholder="Company it was given to" style="flex:1;min-width:160px">
      <button class="primary" data-action="add-alias">Add</button>
    </div>
    ${aliases.length ? `<div style="margin-top:12px">${aliases.map(a => `
      <div class="item">
        <div class="body">
          <div class="name mono">${esc(a.alias)}
            ${a.status === 'burned' ? '<span class="pill overdue">burned</span>' : ''}
            ${a.spamSeen ? `<span class="pill escalated">${a.spamSeen} spam</span>` : ''}</div>
          <div class="meta">given to ${esc(a.service || '—')} · ${esc(a.createdAt)}</div>
        </div>
        <div class="actions">
          <button data-action="spam" data-id="${esc(a.id)}">Got spam</button>
          <button data-action="burn" data-id="${esc(a.id)}">${a.status === 'burned' ? 'Restore' : 'Mark burned'}</button>
          <button class="danger" data-action="del-alias" data-id="${esc(a.id)}">Delete</button>
        </div>
      </div>`).join('')}</div>` : '<p class="small muted" style="margin-top:12px">Nothing logged yet.</p>'}
  </div>`;
}

export function mountEmail(root, state, rerender) {
  root.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const a = btn.dataset.action, id = btn.dataset.id;

    if (a === 'add-alias') {
      const alias = root.querySelector('#al-alias').value.trim();
      const service = root.querySelector('#al-service').value.trim();
      if (!alias) return;
      store.update(s => s.aliases.unshift({
        id: crypto.randomUUID(), alias, service,
        createdAt: store.today(), status: 'active', spamSeen: 0
      }));
      toast('Alias logged');
    }
    if (a === 'spam') {
      store.update(s => { const al = s.aliases.find(x => x.id === id); if (al) al.spamSeen = (al.spamSeen || 0) + 1; });
      toast('Logged. If this keeps up, burn the alias and target that company.');
    }
    if (a === 'burn') {
      store.update(s => { const al = s.aliases.find(x => x.id === id); if (al) al.status = al.status === 'burned' ? 'active' : 'burned'; });
    }
    if (a === 'del-alias') {
      if (!confirm('Remove this alias from the tracker? (It does not delete the alias at your mail provider.)')) return;
      store.update(s => { s.aliases = s.aliases.filter(x => x.id !== id); });
    }
  });
}

// ------------------------------------------------------------------ profile

export function profile(state) {
  const p = state.profile;
  return `
  <div class="head">
    <h1>Your details</h1>
    <p>These fill in the letters. A request without enough detail to identify you is one a company can
    legitimately refuse, so this is worth filling in properly.</p>
  </div>

  <div class="notice">
    <p>Stored in this browser only, under <code>localStorage</code>. It is not encrypted — anyone with access
    to your unlocked computer and this browser profile can read it. Clearing site data wipes it, so keep a
    backup below.</p>
  </div>

  <div class="card">
    <div class="grid cols-2">
      <div class="field"><label for="fullName">Full legal name</label>
        <input id="fullName" value="${esc(p.fullName)}" placeholder="As companies would have it"></div>
      <div class="field"><label for="birthDate">Date of birth</label>
        <input id="birthDate" type="date" value="${esc(p.birthDate)}"></div>
      <div class="field"><label for="country">Country</label>
        <select id="country">
          ${['NL', 'BE', 'DE', 'FR', 'ES', 'IT', 'IE', 'UK', 'US', 'other'].map(c =>
            `<option ${p.country === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select></div>
      <div class="field"><label for="language">Letter language</label>
        <select id="language">
          <option value="en" ${p.language === 'en' ? 'selected' : ''}>English</option>
          <option value="nl" ${p.language === 'nl' ? 'selected' : ''}>Nederlands</option>
        </select></div>
    </div>
    <div class="field"><label for="emails">Email addresses (one per line)</label>
      <textarea id="emails" style="min-height:80px" placeholder="Every address you have used to sign up anywhere">${esc(p.emails.join('\n'))}</textarea></div>
    <div class="field"><label for="phones">Phone numbers (one per line)</label>
      <textarea id="phones" style="min-height:60px">${esc(p.phones.join('\n'))}</textarea></div>
    <div class="field"><label for="addresses">Postal address</label>
      <textarea id="addresses" style="min-height:70px">${esc(p.addresses)}</textarea></div>
    <button class="primary" data-action="save-profile">Save</button>
  </div>

  <div class="card">
    <h2>Breach database API key <span class="muted small">optional</span></h2>
    <p class="small muted">You almost certainly do not need this. Checking your address is free on
    their website — see <a href="#/exposure">Who has your data</a>. A key only buys you the same answer listed
    inside this app instead of on their site.</p>
    <div class="row">
      <input id="hibpKey" type="password" value="${esc(state.hibpKey)}" placeholder="hibp-api-key" style="flex:1;min-width:200px">
      <button data-action="save-key">Save key</button>
    </div>
  </div>

  <div class="card">
    <h2>Backup</h2>
    <div class="row">
      <button data-action="export">Export JSON</button>
      <button data-action="import">Import JSON</button>
      <div class="spacer"></div>
      <button class="danger" data-action="wipe">Erase everything</button>
    </div>
    <p class="small muted" style="margin-top:8px">Export before you clear browser data, switch machines, or
    reinstall. The file contains everything above in plain text — keep it somewhere sensible.</p>
  </div>`;
}

export function mountProfile(root, state, rerender) {
  root.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const a = btn.dataset.action;
    const val = id => root.querySelector('#' + id).value;
    const lines = id => val(id).split('\n').map(s => s.trim()).filter(Boolean);

    if (a === 'save-profile') {
      store.update(s => {
        s.profile = {
          fullName: val('fullName').trim(),
          birthDate: val('birthDate'),
          country: val('country'),
          language: val('language'),
          emails: lines('emails'),
          phones: lines('phones'),
          addresses: val('addresses').trim()
        };
      });
      toast('Saved');
    }

    if (a === 'save-key') {
      store.update(s => { s.hibpKey = val('hibpKey').trim(); });
      toast('Key saved in this browser');
    }

    if (a === 'export') {
      const blob = new Blob([store.exportJSON()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `data-reclaim-backup-${store.today()}.json`;
      link.click();
      URL.revokeObjectURL(url);
    }

    if (a === 'import') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json';
      input.onchange = async () => {
        const file = input.files[0];
        if (!file) return;
        if (!confirm('Importing replaces everything currently stored here. Continue?')) return;
        try {
          store.importJSON(await file.text());
          toast('Backup restored');
        } catch (err) {
          alert('Could not import: ' + err.message);
        }
      };
      input.click();
    }

    if (a === 'wipe') {
      if (!confirm('Erase your profile, all request tracking and all aliases from this browser? This cannot be undone.')) return;
      if (!confirm('Really erase everything? Export a backup first if you might want it back.')) return;
      store.reset();
      toast('Everything erased');
    }
  });
}
