import * as store from './store.js';
import {
  TEMPLATES, TEMPLATE_LABELS_NL, render as renderLetter, suggestedTemplate,
  templateFor, relationOf, RELATION_ORDER, writesDutch, letterLang
} from './letters.js';
import { allBreaches, breachesForAccount, pwnedPasswordCount } from './hibp.js';
import { L, plural, lang } from './i18n.js';
import { buildBlockList, asLinkList, asReplyList, asGmailXml, asSieve, guessClient } from './blocklist.js';

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

const CATEGORIES = () => ({
  'people-search': L('People-search sites', 'Personenzoekmachines'),
  'marketing-data': L('Marketing data brokers', 'Marketingdatabedrijven'),
  'b2b-contact': L('B2B contact scrapers', 'Zakelijke contactdatabases'),
  'credit-bureau': L('Credit bureaus', 'Kredietbureaus'),
  'search-engine': L('Search engines', 'Zoekmachines'),
  'nl': L('Netherlands-specific', 'Nederlandse partijen'),
  'breach': L('Breached company', 'Gelekt bedrijf')
});

const STATUS_NL = { todo: 'Niet gestart', sent: 'Verstuurd', ack: 'Ontvangst bevestigd',
                    done: 'Gewist', refused: 'Geweigerd', escalated: 'Klacht ingediend' };
const EVENT_NL = { 'Reminder sent': 'Herinnering verstuurd' };
const eventLabel = ev => {
  const k = Object.keys(store.STATUSES).find(k => store.STATUSES[k].label === ev);
  return k ? statusLabel(k) : L(ev, EVENT_NL[ev] || ev);
};
export const statusLabel = k => L(store.STATUSES[k]?.label || k, STATUS_NL[k] || k);

export function allTargets(state, catalog) {
  return [...catalog, ...state.custom];
}

// ---------------------------------------------------------------- dashboard

export function exposure(state) {
  const added = state.custom;

  const QUERIES = [
    ['"privacy policy" update', '"privacybeleid" wijziging',
     L('The highest-yield search there is. A company changing its privacy policy must notify everyone whose data it holds — so every hit is a company holding yours, including ones you forgot years ago.',
       'De zoekopdracht die het meest oplevert. Een bedrijf dat zijn privacybeleid wijzigt, moet iedereen van wie het gegevens heeft inlichten — dus elke treffer is een bedrijf dat jouw gegevens heeft, ook bedrijven die je allang vergeten was.')],
    ['"welcome to"', '"welkom bij"',
     L('Signup confirmations. Every account you have ever opened.', 'Aanmeldbevestigingen. Elk account dat je ooit hebt aangemaakt.')],
    ['"verify your email"', '"bevestig je e-mailadres"',
     L('Catches accounts the welcome search misses.', 'Vindt accounts die de welkomstzoekopdracht mist.')],
    ['unsubscribe', 'uitschrijven',
     L('Every marketing list you are on. If they can mail you, they hold your data.', 'Elke mailinglijst waarop je staat. Als ze je kunnen mailen, hebben ze je gegevens.')],
    ['"your order"', '"je bestelling"',
     L('Shops. These hold your postal address and often your card details too.', 'Webwinkels. Die hebben je postadres en vaak ook je betaalgegevens.')]
  ];

  return `
  <div class="head">
    <a class="back" href="#/">${L('← Home', '← Home')}</a>
    <h1>${L('More ways to find who has your data', 'Meer manieren om te vinden wie je gegevens heeft')}</h1>
    <p>${L('Scanning mail on <a href="#/">Home</a> finds most of them. These catch the rest.',
           'Mail scannen op <a href="#/">Home</a> vindt de meeste. Hiermee vind je de rest.')}</p>
  </div>

  <div class="card">
    <h2>${L('Search your mailbox', 'Doorzoek je mailbox')}</h2>
    <p class="small muted">${L('No export needed — run these searches in your mail app and add what you find by hand.',
      'Geen export nodig — voer deze zoekopdrachten uit in je mailapp en voeg toe wat je vindt.')}</p>
    <details>
      <summary class="small muted" style="cursor:pointer">${L('Show the searches', 'Toon de zoekopdrachten')}</summary>
      ${QUERIES.map(([en, nl, why]) => { const q = L(en, nl); return `
        <div class="item">
          <div class="body">
            <div class="name mono">${esc(q)}</div>
            <div class="meta">${esc(why)}</div>
          </div>
          <div class="actions"><button data-action="copy-query" data-q="${esc(q)}">${L('Copy', 'Kopieer')}</button></div>
        </div>`; }).join('')}
    </details>

    <p class="small" style="margin-top:14px"><strong>${L('Spam calls and texts:', 'Spamtelefoontjes en -sms:')}</strong></p>
    <p class="small muted">${L('Log the number it came from and, if the text carried a link, the domain in it. The domain is what can actually be written to; the number is the evidence that they hold you.',
      'Noteer het nummer en, als de sms een link bevatte, het domein daarin. Naar het domein kun je schrijven; het nummer is het bewijs dat ze jouw gegevens hebben.')}</p>
    <div class="row">
      <input id="ph-number" placeholder="+31 6 12345678" style="flex:1;min-width:150px">
      <input id="ph-domain" placeholder="${L('domain from the text (optional)', 'domein uit de sms (optioneel)')}" style="flex:1;min-width:170px">
      <button data-action="add-phone">${L('Add', 'Toevoegen')}</button>
    </div>

    <p class="small" style="margin-top:14px"><strong>${L('Add a company by hand:', 'Voeg zelf een bedrijf toe:')}</strong></p>
    <div class="row">
      <input id="qa-company" placeholder="${L('Company name', 'Bedrijfsnaam')}" style="flex:1;min-width:160px">
      <input id="qa-domain" placeholder="${L('their-domain.com (optional)', 'hun-domein.nl (optioneel)')}" style="flex:1;min-width:160px">
      <button class="primary" data-action="quick-add">${L('Add &amp; write letter', 'Toevoegen &amp; brief schrijven')}</button>
    </div>
    <div id="qa-added" style="margin-top:10px">
      ${added.length ? `<p class="small muted">${L(`${added.length} on your list:`, `${added.length} op je lijst:`)}</p>` + added.map(c => `
        <div class="item">
          <div class="body"><div class="name">${esc(nameOf(c))}</div></div>
          <div class="actions"><a class="btn" href="#/letter?b=${encodeURIComponent(c.id)}">${L('Letter', 'Brief')}</a></div>
        </div>`).join('') : ''}
    </div>
  </div>

  <div class="card">
    <h2>${L('Data brokers — assume they already have you', 'Databrokers — ga ervan uit dat ze je al hebben')}</h2>
    <p class="small muted">${L('These never emailed you and never will. They buy, merge and resell personal data on almost every adult in Europe, so there is nothing to discover: assume you are in their files and make them prove otherwise. 37 are bundled, each with its opt-out page and a letter.',
      'Deze hebben je nooit gemaild en zullen dat ook niet doen. Ze kopen, koppelen en verkopen persoonsgegevens van bijna elke volwassene in Europa, dus er valt niets te ontdekken: ga ervan uit dat je in hun bestanden staat en laat ze het tegendeel bewijzen. Er zitten er 37 in de app, elk met afmeldpagina en brief.')}</p>
    <div class="row">
      <a class="btn primary" href="#/delete?all=1">${L('Show the data brokers →', 'Toon de databrokers →')}</a>
    </div>
  </div>

  <div class="card">
    <h2>${L('Public breach records', 'Openbare datalekken')}</h2>
    <p class="small muted">${L('Companies that lost your data to attackers. Free to check — the breach database charges only for automated lookups, never for searching your own address on their site.',
      'Bedrijven die jouw gegevens bij een hack zijn kwijtgeraakt. Gratis te controleren — de lekdatabase vraagt alleen geld voor geautomatiseerd opzoeken, nooit voor het zoeken naar je eigen adres op hun site.')}</p>

    ${state.profile.emails.length ? `
      ${state.profile.emails.map(e => `
        <div class="item">
          <div class="body"><div class="name mono">${esc(e)}</div></div>
          <div class="actions">
            <button data-action="hibp-open" data-email="${esc(e)}">${L('Copy &amp; check ↗', 'Kopieer &amp; controleer ↗')}</button>
          </div>
        </div>`).join('')}
      <p class="small muted" style="margin-top:10px">${L('Copies the address and opens the database — paste it into their search box.',
        'Kopieert het adres en opent de database — plak het in hun zoekvak.')}</p>
    ` : `<p class="small muted">${L('Add your email addresses in <a href="#/profile">Settings</a> first, then check each one here.',
        'Voeg eerst je e-mailadressen toe bij <a href="#/profile">Instellingen</a>, en controleer ze dan hier.')}</p>`}

    <p class="small muted">${L('Breaches classed as sensitive are hidden from the public search. To see those, verify the address through the <em>Notify me</em> section of that site — also free, and it warns you about future breaches.',
      'Gevoelige lekken zijn verborgen in de openbare zoekfunctie. Om die te zien, bevestig je je adres via <em>Notify me</em> op die site — ook gratis, en je krijgt een seintje bij toekomstige lekken.')}</p>

    <div class="row" style="margin-top:12px">
      <input id="breach-q" placeholder="${L('Or search the breach list (e.g. linkedin)', 'Of doorzoek de lijst met lekken (bijv. linkedin)')}" style="flex:1;min-width:200px">
      <button data-action="load-breaches">${L('Load list', 'Lijst laden')}</button>
    </div>
    <div id="breach-result" style="margin-top:12px"></div>

    <details style="margin-top:14px">
      <summary class="small muted" style="cursor:pointer">${L('Optional: automate this with a paid API key', 'Optioneel: automatiseer dit met een betaalde API-sleutel')}</summary>
      <p class="small muted" style="margin-top:10px">${L('<strong>This is the one request in this app that transmits personal data</strong> — it sends the address being checked. Nothing else here does.',
        '<strong>Dit is het enige verzoek in deze app dat persoonsgegevens verstuurt</strong> — het adres dat je controleert. Niets anders hier doet dat.')}</p>
      <div class="row">
        <select id="acct-email" style="flex:1;min-width:200px">
          ${state.profile.emails.length
            ? state.profile.emails.map(e => `<option>${esc(e)}</option>`).join('')
            : `<option value="">${L('Add an email in Settings first', 'Voeg eerst een e-mailadres toe bij Instellingen')}</option>`}
        </select>
        <button data-action="check-account" ${state.hibpKey ? '' : 'disabled'}>${L('Check address', 'Controleer adres')}</button>
      </div>
      ${state.hibpKey ? '' : `<p class="small muted" style="margin-top:8px">${L('No key saved — add one in <a href="#/profile">Settings</a> to enable this.',
        'Geen sleutel opgeslagen — voeg er een toe bij <a href="#/profile">Instellingen</a>.')}</p>`}
      <div id="acct-result" style="margin-top:10px"></div>
    </details>
  </div>

  <div class="card">
    <h2>${L('Has a password of yours leaked?', 'Is een wachtwoord van je gelekt?')}</h2>
    <p class="small muted">${L('Safe to run: the password is hashed on this device and only the first five characters of that hash are sent, so the service cannot tell which password you asked about.',
      'Veilig: het wachtwoord wordt op dit apparaat gehasht en alleen de eerste vijf tekens van die hash worden verstuurd, dus de dienst weet niet naar welk wachtwoord je vroeg.')}</p>
    <div class="row">
      <input type="password" id="pw" placeholder="${L('Password to check', 'Te controleren wachtwoord')}" autocomplete="off" style="flex:1;min-width:200px">
      <button data-action="check-pw">${L('Check', 'Controleer')}</button>
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
      out.textContent = L('Checking…', 'Bezig met controleren…');
      try {
        const n = await pwnedPasswordCount(pw);
        out.innerHTML = n === 0
          ? `<span class="pill done">${L('Not found', 'Niet gevonden')}</span> ${L('This password does not appear in any known leak. That is not the same as "strong" — a unique passphrase in a password manager still beats it.',
              'Dit wachtwoord komt in geen enkel bekend lek voor. Dat is niet hetzelfde als "sterk" — een unieke wachtzin in een wachtwoordmanager is nog steeds beter.')}`
          : `<span class="pill overdue">${L(`Seen ${n.toLocaleString()}×`, `${n.toLocaleString('nl-NL')}× gezien`)}</span> ${L('This password has leaked. Change it anywhere you used it, and never reuse it.',
              'Dit wachtwoord is gelekt. Verander het overal waar je het gebruikt, en gebruik het nooit meer.')}`;
        root.querySelector('#pw').value = '';
      } catch (err) {
        out.innerHTML = `<span class="pill overdue">${L('Could not reach the service', 'Dienst niet bereikbaar')}</span>
          ${esc(err.message)}. ${L('Check your connection — some networks and content blockers block this API.', 'Controleer je verbinding — sommige netwerken en blockers blokkeren deze dienst.')}`;
      }
    }

    if (action === 'copy-query') {
      try {
        await navigator.clipboard.writeText(btn.dataset.q);
        toast(L('Copied — paste it into your mail search', 'Gekopieerd — plak het in de zoekbalk van je mail'));
      } catch {
        toast(L('Type it into your mail search box', 'Typ het in de zoekbalk van je mail'));
      }
    }

    if (action === 'add-phone') {
      const numEl = root.querySelector('#ph-number');
      const domEl = root.querySelector('#ph-domain');
      const phone = numEl.value.trim();
      const domain = domEl.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!phone) { toast(L('Enter the number it came from', 'Vul het nummer in')); return; }

      const id = 'phone:' + phone.replace(/[^0-9+]/g, '');
      if (state.custom.some(c => c.id === id)) { toast(L('That number is already logged', 'Dat nummer staat er al')); return; }
      store.update(st => st.custom.push({
        id, name: domain || phone, category: 'breach', regions: ['EU'], site: domain,
        optOutUrl: domain ? `https://${domain}` : '',
        email: domain ? `privacy@${domain}` : '',
        method: 'email', confidence: 'low',
        source: 'phone',
        evidence: { phone },
        notes: domain
          ? L(`Spam to ${phone}, linking to ${domain}. The letter reveals only that number.`,
              `Spam naar ${phone}, met een link naar ${domain}. De brief noemt alleen dat nummer.`)
          : L(`Spam to ${phone}. No domain given, so there is no one to write to yet. In the Netherlands, unsolicited marketing calls need prior consent; report repeat offenders to the ACM.`,
              `Spam naar ${phone}. Geen domein opgegeven, dus er is nog niemand om naar te schrijven. In Nederland is voor ongevraagde telemarketing vooraf toestemming nodig; meld herhaling bij de ACM.`)
      }));
      numEl.value = ''; domEl.value = '';
      toast(L(`${phone} logged`, `${phone} genoteerd`));
    }

    if (action === 'quick-add') {
      const nameEl = root.querySelector('#qa-company');
      const domEl = root.querySelector('#qa-domain');
      const name = nameEl.value.trim();
      const site = domEl.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!name) { toast(L('Give the company a name first', 'Geef het bedrijf eerst een naam')); return; }

      const id = 'custom:' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      if (state.custom.some(c => c.id === id)) { toast(L(`${name} is already on your list`, `${name} staat al op je lijst`)); return; }

      store.update(st => st.custom.push({
        id, name, category: 'breach', regions: ['EU'], site,
        optOutUrl: site ? `https://${site}` : '',
        email: site ? `privacy@${site}` : '',
        method: 'email', confidence: 'low',
        source: 'custom',
        evidence: { address: (state.profile.emails || [])[0] || '' },
        notes: L('Added by you. Check their privacy policy for the real contact address before sending.',
                 'Door jou toegevoegd. Zoek in hun privacybeleid het echte contactadres op voordat je verstuurt.')
      }));

      // This view suppresses the global re-render, so append the row by hand.
      const list = root.querySelector('#qa-added');
      const row = document.createElement('div');
      row.className = 'item';
      row.innerHTML = `<div class="body"><div class="name">${esc(name)}</div></div>
        <div class="actions"><a class="btn" href="#/letter?b=${encodeURIComponent(id)}">${L('Letter', 'Brief')}</a></div>`;
      list.appendChild(row);
      nameEl.value = '';
      domEl.value = '';
      nameEl.focus();
      toast(L(`${name} added — letter ready`, `${name} toegevoegd — brief staat klaar`));
    }

    if (action === 'hibp-open') {
      // Open before copying: awaiting the clipboard first breaks the user-gesture
      // chain and the popup blocker eats the new tab.
      window.open('https://haveibeenpwned.com/', '_blank', 'noopener,noreferrer');
      try {
        await navigator.clipboard.writeText(btn.dataset.email);
        toast(L('Address copied — paste it into their search box', 'Adres gekopieerd — plak het in hun zoekvak'));
      } catch {
        toast(L('Opened — type the address into their search box', 'Geopend — typ het adres in hun zoekvak'));
      }
    }

    if (action === 'check-account') {
      const out = root.querySelector('#acct-result');
      const email = root.querySelector('#acct-email').value;
      if (!email) return;
      out.textContent = L('Checking…', 'Bezig met controleren…');
      try {
        const list = await breachesForAccount(email, state.hibpKey);
        out.innerHTML = list.length === 0
          ? `<p class="small"><span class="pill done">${L('Clean', 'Schoon')}</span> ${L('No known breaches for this address.', 'Geen bekende lekken voor dit adres.')}</p>`
          : `<p class="small"><strong>${L(`${list.length} breaches.`, `${list.length} lekken.`)}</strong> ${L('Each is a company you can order to erase you.', 'Elk daarvan is een bedrijf dat je kunt opdragen je gegevens te wissen.')}</p>`
            + list.map(b => breachRow(b, state)).join('');
      } catch (err) {
        out.innerHTML = `<p class="small"><span class="pill overdue">${L('Failed', 'Mislukt')}</span> ${esc(err.message)}</p>`;
      }
    }

    if (action === 'load-breaches') {
      const out = root.querySelector('#breach-result');
      out.textContent = L('Loading…', 'Laden…');
      try {
        breaches = await allBreaches();
        renderBreachList(root, breaches, state);
      } catch (err) {
        out.innerHTML = `<p class="small"><span class="pill overdue">${L('Could not reach the breach database', 'Lekdatabase niet bereikbaar')}</span>
          ${esc(err.message)}.</p>`;
      }
    }

    if (action === 'add-breach-target') {
      const { name, domain } = btn.dataset;
      const id = 'breach:' + (domain || name).toLowerCase().replace(/[^a-z0-9]+/g, '-');
      if (state.custom.some(c => c.id === id)) { toast(L('Already on your list', 'Staat al op je lijst')); return; }
      store.update(s => s.custom.push({
        id, name, category: 'breach', regions: ['EU', 'US'],
        site: domain || '', optOutUrl: domain ? `https://${domain}` : '',
        email: domain ? `privacy@${domain}` : '', method: 'email', confidence: 'low',
        source: 'breach',
        evidence: { address: (state.profile.emails || [])[0] || '' },
        notes: L('Added from the breach list. Confirm the privacy contact address before sending.',
                 'Toegevoegd uit de lijst met lekken. Controleer het privacy-contactadres voordat je verstuurt.')
      }));
      btn.outerHTML = `<span class="pill sent">${L('on your list', 'op je lijst')}</span>`;
      toast(L(`${name} added`, `${name} toegevoegd`));
    }
  });

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
      out.innerHTML = `<p class="small muted">${L(`${list.length} breaches loaded. Type above to search.`, `${list.length} lekken geladen. Typ hierboven om te zoeken.`)}</p>`;
      return;
    }
    out.innerHTML = filtered.length
      ? filtered.slice(0, 40).map(b => breachRow(b, st)).join('')
      : `<p class="small muted">${L('No match.', 'Geen resultaat.')}</p>`;
  }
}

function breachRow(b, state) {
  const already = state.custom.some(c => c.id === 'breach:' + ((b.Domain || b.Name).toLowerCase().replace(/[^a-z0-9]+/g, '-')));
  return `
  <div class="item">
    <div class="body">
      <div class="name">${esc(b.Title || b.Name)} <span class="muted small">${esc(b.BreachDate || '')}</span></div>
      <div class="meta">${esc((b.DataClasses || []).join(', ')) || L('unknown data', 'onbekende gegevens')}
        ${b.IsSensitive ? `<span class="pill overdue">${L('sensitive', 'gevoelig')}</span>` : ''}</div>
    </div>
    <div class="actions">
      ${already
        ? `<span class="pill sent">${L('on your list', 'op je lijst')}</span>`
        : `<button data-action="add-breach-target" data-name="${esc(b.Title || b.Name)}"
             data-domain="${esc(b.Domain || '')}">${L('Add', 'Toevoegen')}</button>`}
    </div>
  </div>`;
}

// ------------------------------------------------------------------ targets


// Adds a scanned sender, or refreshes it if it is already known. Only what a
// rule or a letter needs is kept: names, domains, the address it reached and
// how many mails — never subject lines or message text.
// Stored names are language-neutral apart from this one marker, translated on display.
export const nameOf = b => String(b.name || '').replace(/ \(impersonated\)$/, L(' (impersonated)', ' (nagemaakt)'));
// "LuckyGem · also as Koko.bet, Mr. Punter" for senders that rotate names.
export const akaOf = b => b.aka?.length ? L('also as ', 'ook als ') + b.aka.join(', ') : '';

export function upsertSender(sn) {
  const state = store.get();
  const forged = sn.trust === 'forged';
  const base = sn.name && sn.name !== sn.domain ? sn.name : sn.domain;
  // A forged sender is named for what it is, not for the brand it borrowed.
  const label = forged && /\.[a-z]{2,}$/i.test(sn.domain) ? `${base} (impersonated)` : base;
  const id = 'mail:' + (sn.key || sn.domain);

  // The address THEY mailed is the only identifier the letter may use. Prefer
  // one the user owns; otherwise take the recipient header verbatim, which is
  // how a per-company alias gets picked up correctly.
  const owned = (state.profile.emails || []).map(e => e.toLowerCase());
  const hit = (sn.recipients || []).find(r => owned.includes(r));
  const address = hit || (sn.recipients || [])[0] || (owned.length === 1 ? owned[0] : '');

  const data = {
    id, name: label, category: 'breach', regions: ['EU'], site: sn.domain, impersonates: forged,
    optOutUrl: `https://${sn.domain}`, email: `privacy@${sn.domain}`,
    method: 'email', confidence: 'low',
    source: 'mail',
    evidence: { address },
    unsubUrl: sn.unsubHttp || '',
    unsubMailto: sn.unsubMailto || '',
    unsubFrom: sn.unsubFrom || '',
    oneClick: !!sn.oneClick,
    spam: !sn.unsubHttp,
    trust: sn.trust || 'unknown',
    trustWhy: sn.trustWhy || '',
    risk: sn.risk || '',
    // Other names the same sender used: one spam operation often rotates
    // brands (four "casinos" from one domain), and the user should see that.
    aka: (sn.names || []).filter(n => n && n !== base).slice(0, 5),
    providerSpam: !!sn.providerSpam,
    linkDomains: (sn.linkDomains || []).slice(0, 10),
    replyToHosts: (sn.replyToHosts || []).slice(0, 3),
    mailCount: sn.count || 1,
    notes: `Found in your own mail: ${sn.domain} sent to ${address || 'an address of yours'}. The letter deliberately tells them nothing they do not already have.`
  };

  let added = false;
  store.update(st => {
    const i = st.custom.findIndex(c => c.id === id);
    if (i === -1) { st.custom.push(data); added = true; return; }
    const old = st.custom[i];
    // Keep what the user did (unsubscribed, renamed); take everything else fresh.
    // Counts take the larger: re-scanning the same files must not inflate them.
    st.custom[i] = { ...old, ...data, mailCount: Math.max(old.mailCount || 0, data.mailCount),
                     unsubscribedAt: old.unsubscribedAt };
  });
  return added;
}

export function markUnsubscribed(ids) {
  if (!ids.length) return;
  const at = new Date().toISOString().slice(0, 10);
  store.update(st => {
    for (const t of st.custom) if (ids.includes(t.id) && !t.unsubscribedAt) t.unsubscribedAt = at;
  });
}

// Selection is deliberately not persisted: it is a scratch choice for one bulk
// action, not something worth keeping in storage.
const selected = new Set();

export function brokers(state, catalog, params) {
  // A letter to a throwaway spam domain bounces, and sending one confirms the
  // address is live. Those stay off this list unless explicitly asked for.
  const hidden = b => ['spam', 'bait', 'unclear'].includes(senderClass(b));
  const spam = state.custom.filter(hidden);
  const showSpam = params.get('spam') === '1';
  const mine = showSpam ? state.custom : state.custom.filter(b => !hidden(b));
  const showBrokers = params.get('all') === '1';
  const targets = showBrokers ? allTargets({ ...state, custom: mine }, catalog) : mine;
  const q = (params.get('q') || '').toLowerCase();
  const shown = targets.filter(b => !q || (b.name + ' ' + (b.site || '')).toLowerCase().includes(q));

  lastTargets = new Map(targets.map(b => [b.id, b]));
  const work = deleteWork(targets);
  if (params.get('send') === '1' && !sendQueue && work.send.length) {
    sendQueue = { kind: 'request', ids: work.send.map(b => b.id), i: 0 };
  }

  const sent = mine.filter(b => ['sent', 'ack', 'escalated'].includes(store.getRequest(b.id).status)).length;
  const overdue = targets.filter(b => store.isOverdue(b, store.getRequest(b.id))).length;

  return `
  <div class="head">
    <h1>${L('Delete data', 'Gegevens verwijderen')}</h1>
    <p>${L('Order these companies to erase you under Article 17 GDPR. They have one month to comply. Unsubscribing only stops the mail — <a href="#/unsubscribe">that is the other page</a>.',
           'Laat deze bedrijven je gegevens wissen op grond van artikel 17 AVG. Ze hebben daar een maand de tijd voor. Uitschrijven stopt alleen de mail; dat doe je op <a href="#/unsubscribe">de andere pagina</a>.')}</p>
  </div>

  ${!mine.length && !showBrokers ? `<div class="notice">
    <p>${L('Nothing here yet. <a href="#/">Scan your mail</a> to find who holds your data.',
           'Nog niets hier. <a href="#/">Scan je mail</a> om te vinden wie je gegevens heeft.')}</p>
  </div>` : ''}

  ${mine.length ? `<div class="statbar">
    <div><b>${mine.length}</b><span>${L('from your evidence', 'uit je eigen mail')}</span></div>
    <div><b>${sent}</b><span>${L('requests sent', 'verzoeken verstuurd')}</span></div>
    <div class="${overdue ? 'bad' : ''}"><b>${overdue}</b><span>${L('past deadline', 'termijn verlopen')}</span></div>
  </div>` : ''}

  ${sendQueue ? sendQueueCard(state) : workCard(work, params)}

  <div class="card">
    <div class="row">
      <input id="target-q" placeholder="${L('Search', 'Zoeken')}" value="${esc(params.get('q') || '')}" style="flex:1;min-width:150px">
      <button data-action="add-custom">${L('Add company', 'Bedrijf toevoegen')}</button>
    </div>
    <p class="small muted" style="margin:10px 0 0">
      ${showBrokers
        ? `${L(`Your ${mine.length} plus ${catalog.length} bundled data brokers.`, `Jouw ${mine.length} bedrijven plus ${catalog.length} bekende databrokers.`)}
           <a href="#/delete">${L('Show only mine', 'Alleen de mijne tonen')}</a>`
        : `${L('Only what came from your own evidence.', 'Alleen wat uit je eigen mail en meldingen komt.')}
           <a href="#/delete?all=1">${L(`Add the ${catalog.length} bundled data brokers`, `Toon ook ${catalog.length} bekende databrokers`)}</a>`}
      ${spam.length && !showSpam
        ? `<br>${L(`${spam.length} spam or unverified ${spam.length === 1 ? 'sender is' : 'senders are'} hidden — a letter to those bounces and confirms your address is live.`,
                   `${spam.length} onveilige of niet te controleren ${spam.length === 1 ? 'afzender is' : 'afzenders zijn'} verborgen: een brief daarheen komt terug, of laat ze weten dat je adres actief is.`)}
           <a href="#/delete?spam=1">${L('Show them anyway', 'Toch tonen')}</a>`
        : ''}
    </p>
  </div>

  ${shown.length ? relationGroups(shown, state)
    : `<div class="card"><p class="muted">${L('Nothing matches.', 'Niets gevonden.')}</p></div>`}`;
}

const RELATIONS = () => ({
  none: {
    title: L('No reason to have your data', 'Geen reden om je gegevens te hebben'),
    blurb: L('Data brokers, cold callers, and senders that could not be verified. These come first: you never chose to give them anything, and erasing you there costs you nothing.',
      'Databrokers, ongevraagde bellers en afzenders die niet te controleren waren. Deze komen eerst: je hebt ze nooit iets gegeven, en daar gewist worden kost je niets.'),
    pick: L('Never gave them my data', 'Nooit mijn gegevens gegeven')
  },
  maybe: {
    title: L('You may have signed up once', 'Misschien ooit aangemeld'),
    blurb: L('Real companies whose newsletters reach you. If you do not recognise one, move it up to "Never gave them my data".',
      'Echte bedrijven waarvan je nieuwsbrieven krijgt. Herken je er een niet, zet hem dan op "Nooit mijn gegevens gegeven".'),
    pick: L('Not sure', 'Weet ik niet')
  },
  customer: {
    title: L('Your own providers', 'Waar je klant bent'),
    blurb: L('Companies you are a customer of. Erasing you there would be refused for the contract, or close your account. So they get a different letter: stop all marketing, delete what the service does not need, stop passing it on. Your account stays.',
      'Bedrijven waar je klant bent. Een volledig verwijderverzoek weigeren ze voor alles wat je contract nodig heeft, of ze heffen je account op. Daarom krijgen ze een andere brief: geen marketing meer, wis wat de dienst niet nodig heeft, deel het met niemand. Je account blijft.'),
    pick: L("I'm a customer", 'Ik ben klant')
  }
});

function relationGroups(list, state) {
  const R = RELATIONS();
  const groups = { none: [], maybe: [], customer: [] };
  for (const b of list) groups[relationOf(b, store.getRequest(b.id))].push(b);
  // Within a group, what came from the user's own evidence before bundled brokers.
  for (const g of Object.values(groups)) g.sort((a, b) => (a.source ? 0 : 1) - (b.source ? 0 : 1));
  return Object.entries(groups).filter(([, g]) => g.length).map(([k, g]) => `
    <section class="card rel-group rel-${k}">
      <h2>${R[k].title} <span class="count">${g.length}</span></h2>
      <p class="small muted" style="max-width:66ch;margin-top:-2px">${R[k].blurb}</p>
      ${g.map(b => targetRow(b, state)).join('')}
    </section>`).join('');
}

function targetRow(b, state) {
  const r = store.getRequest(b.id);
  const overdue = store.isOverdue(b, r);
  const pill = overdue ? 'overdue' : (store.STATUSES[r.status]?.pill || 'todo');
  const late = store.daysSince(r.sentAt) - store.deadlineDays(b);
  const label = overdue ? L(`Overdue by ${late}d`, `${late} dagen te laat`) : statusLabel(r.status);

  const SRC = { mail: L('from your mail', 'uit je mail'), phone: L('from a call or text', 'uit een telefoontje of sms'),
                breach: L('from a breach', 'uit een datalek'), custom: L('added by you', 'door jou toegevoegd') };
  const reveals = b.evidence?.address || b.evidence?.phone;
  return `
  <div class="item">
    <div class="body">
      <div class="name">${esc(nameOf(b))}
        <span class="pill ${pill}">${esc(label)}</span>
        ${SRC[b.source] ? `<span class="pill sent">${SRC[b.source]}</span>` : ''}
      </div>
      ${reveals ? `<div class="meta">${L('Letter reveals only', 'De brief noemt alleen')} <span class="mono">${esc(reveals)}</span></div>` : ''}
      <div class="meta">${b.site ? `<span class="mono">${esc(b.site)}</span>` : ''}${r.sentAt
        ? ` · ${L('sent', 'verstuurd')} ${esc(r.sentAt)}` : ''}${b.source ? '' : ` · ${esc(CATEGORIES()[b.category] || b.category)}`}</div>
      ${b.notes && lang() === 'en' ? `<div class="meta">${esc(b.notes)}</div>` : ''}
      <div class="meta rel-pick">${L('You and them:', 'Jouw relatie:')}
        <select data-action="set-relation" data-id="${esc(b.id)}" aria-label="${L(`How you relate to ${esc(b.name)}`, `Jouw relatie met ${esc(b.name)}`)}">
          ${Object.entries(RELATIONS()).map(([k, v]) =>
            `<option value="${k}" ${relationOf(b, r) === k ? 'selected' : ''}>${esc(v.pick)}</option>`).join('')}
        </select>
        ${r.relation ? '' : `<span class="muted">${L('(our guess)', '(onze inschatting)')}</span>`}</div>
    </div>
    <div class="actions">
      ${safeUrl(b.optOutUrl) ? `<a class="btn" href="${esc(safeUrl(b.optOutUrl))}" target="_blank" rel="noopener noreferrer">${L('Opt-out page ↗', 'Afmeldpagina ↗')}</a>` : ''}
      <a class="btn primary" href="#/letter?b=${encodeURIComponent(b.id)}">${L('Letter', 'Brief')}</a>
      <select data-action="set-status" data-id="${esc(b.id)}" style="width:auto" aria-label="${L(`Status of ${esc(b.name)}`, `Status van ${esc(b.name)}`)}">
        ${Object.keys(store.STATUSES).map(k =>
          `<option value="${k}" ${r.status === k ? 'selected' : ''}>${esc(statusLabel(k))}</option>`).join('')}
      </select>
    </div>
  </div>`;
}

export function mountBrokers(root, state, rerender) {
  wireSend(root, rerender);
  root.addEventListener('change', e => {
    const sel = e.target.closest('[data-action="set-status"]');
    if (sel) { store.setStatus(sel.dataset.id, sel.value); toast(L('Status updated', 'Status bijgewerkt')); }
    const rel = e.target.closest('[data-action="set-relation"]');
    if (rel) {
      store.setRelation(rel.dataset.id, rel.value);
      toast(rel.value === 'customer'
        ? L('Moved to your providers — they get the customer letter', 'Verplaatst naar je leveranciers — zij krijgen de klantenbrief')
        : L('Moved', 'Verplaatst'));
    }
  });

  let timer;
  root.addEventListener('input', e => {
    if (e.target.id !== 'target-q') return;
    clearTimeout(timer);
    const extra = location.hash.includes('all=1') ? '&all=1' : '';
    timer = setTimeout(() => {
      location.hash = `#/delete?q=${encodeURIComponent(e.target.value)}${extra}`;
    }, 350);
  });

  root.addEventListener('click', e => {
    if (e.target.closest('[data-action]')?.dataset.action !== 'add-custom') return;
    const name = prompt(L('Company name', 'Bedrijfsnaam'));
    if (!name) return;
    const site = prompt(L('Website domain (optional), e.g. example.com', 'Websitedomein (optioneel), bijv. voorbeeld.nl')) || '';
    const id = 'custom:' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    store.update(s => s.custom.push({
      id, name, category: 'breach', regions: ['EU', 'US'], site,
      optOutUrl: site ? `https://${site}` : '', email: site ? `privacy@${site}` : '',
      method: 'email', confidence: 'low', source: 'custom',
      evidence: { address: (store.get().profile.emails || [])[0] || '' },
      notes: L('Added by you. Confirm the privacy contact before sending.', 'Door jou toegevoegd. Controleer het privacy-contactadres voordat je verstuurt.')
    }));
    toast(L(`${name} added`, `${name} toegevoegd`));
  });
}

// ------------------------------------------------------------- send all
//
// Erasure requests in bulk, without the app ever touching the mailbox: each
// letter opens as a filled-in draft in the user's own mail app, they press
// Send, and the next one is ready. One click per company is the floor — a
// page cannot send mail, and should not be able to.

const isEU = b => ['EU', 'NL', 'UK'].some(r => (b.regions || []).includes(r));
export const recipient = (b, r = store.getRequest(b.id)) => r.to || b.email || '';
const REMINDER_GRACE = 14;   // days the reminder letter gives them

// What each company needs next. Spam, bait and unverifiable senders never get
// here: a letter to them confirms the address is live.
export function deleteWork(targets) {
  const w = { send: [], forms: [], reminders: [], complaints: [] };
  for (const b of targets) {
    if (['spam', 'bait', 'unclear'].includes(senderClass(b))) continue;
    const r = store.getRequest(b.id);
    if (r.status === 'todo') {
      if (b.method === 'form' && safeUrl(b.optOutUrl)) w.forms.push(b);
      else if (recipient(b, r)) w.send.push(b);
    } else if (['sent', 'ack'].includes(r.status)) {
      if (!r.reminderAt && store.isOverdue(b, r) && recipient(b, r)) w.reminders.push(b);
      else if (r.reminderAt && store.daysSince(r.reminderAt) > REMINDER_GRACE && isEU(b)) w.complaints.push(b);
    } else if (r.status === 'refused' && isEU(b)) w.complaints.push(b);
  }
  // The companies with no business holding the data go first; the user's own
  // providers, who get the narrower letter, go last.
  const rank = b => RELATION_ORDER[relationOf(b, store.getRequest(b.id))] * 2 + (b.source ? 0 : 1);
  for (const k of ['send', 'forms', 'reminders']) w[k].sort((a, b) => rank(a) - rank(b));
  return w;
}

// Module state, so a store write (marking one sent) re-renders the page
// without losing the user's place in the queue.
let sendQueue = null;        // { kind: 'request' | 'reminder', ids, i }
let lastTargets = new Map(); // id -> target, from the last render of this page

const queueTemplate = (kind, b, profile) => templateFor(kind, b, profile, store.getRequest(b.id));

function sendQueueCard(state) {
  const q = sendQueue;
  const total = q.ids.length;
  const reminder = q.kind === 'reminder';
  if (q.i >= total) return `
    <section class="card send-card" id="send-queue">
      <h2>${reminder ? L(`All ${total} reminders opened`, `Alle ${total} herinneringen geopend`)
                     : L(`All ${total} requests opened`, `Alle ${total} verzoeken geopend`)}</h2>
      <p class="small">${reminder
        ? L(`They have ${REMINDER_GRACE} days. Anyone still silent after that shows up here with a complaint to the regulator ready.`,
            `Ze hebben ${REMINDER_GRACE} dagen. Wie daarna nog zwijgt, verschijnt hier met een klacht bij de toezichthouder klaar.`)
        : L('The one-month deadlines are running. Anyone who has not answered by then shows up here with a reminder ready — you do not need to keep track.',
            'De termijn van een maand loopt. Wie dan nog niet heeft gereageerd, verschijnt hier met een herinnering klaar — je hoeft niets bij te houden.')}</p>
      <p class="small muted">${L('Did not send one after all? Set it back to "Not started" in the list below.',
        'Toch eentje niet verstuurd? Zet hem in de lijst hieronder terug op "Niet gestart".')}</p>
      <div class="row"><button data-action="send-close">${L('Close', 'Sluiten')}</button></div>
    </section>`;

  const b = lastTargets.get(q.ids[q.i]);
  if (!b) { q.i++; return sendQueueCard(state); }
  const r = store.getRequest(b.id);
  const to = recipient(b, r);
  const guessed = !r.to && b.confidence === 'low';
  const reveals = b.evidence?.address || b.evidence?.phone;
  const next = q.ids.slice(q.i + 1, q.i + 4).map(id => lastTargets.get(id)?.name).filter(Boolean);

  return `
  <section class="card send-card" id="send-queue">
    <div class="row between" style="align-items:flex-start">
      <div>
        <p class="small muted" style="margin:0">${reminder ? L('Sending reminders', 'Herinneringen versturen') : L('Sending requests', 'Verzoeken versturen')}
          · ${q.i + 1} / ${total}</p>
        <h2 style="margin:2px 0 0">${esc(nameOf(b))}</h2>
      </div>
      <button class="link-btn" data-action="send-close">${L('Stop', 'Stoppen')}</button>
    </div>
    <div class="meter send-meter"><span style="width:${Math.round(100 * q.i / total)}%"></span></div>
    <div class="field" style="margin-top:12px">
      <label for="send-to">${L('To', 'Aan')}${guessed ? ` <span class="pill low">${L('guessed', 'geraden')}</span>` : ''}</label>
      <input id="send-to" value="${esc(to)}" data-id="${esc(b.id)}" spellcheck="false">
      ${guessed ? `<p class="small muted" style="margin:4px 0 0">${L(
        `A guess from their domain. If it bounces, look for "privacy" or "DPO" in their privacy policy, fix it here, and send again.`,
        `Een gok op basis van hun domein. Komt hij terug, zoek dan "privacy" of "functionaris gegevensbescherming" in hun privacyverklaring, pas het hier aan en verstuur opnieuw.`)}</p>` : ''}
    </div>
    <p class="small">${reveals
      ? L(`The letter reveals only <span class="mono">${esc(reveals)}</span> — what they already have.`,
          `De brief noemt alleen <span class="mono">${esc(reveals)}</span> — wat ze al hebben.`)
      : L('The letter includes your name and address, so this broker can find your record.',
          'De brief bevat je naam en adres, zodat deze databroker je gegevens kan vinden.')}
      <a href="#/letter?b=${encodeURIComponent(b.id)}&t=${queueTemplate(q.kind, b, state.profile)}">${L('Read it', 'Lees de brief')}</a></p>
    ${!reminder && relationOf(b, r) === 'customer' ? `<p class="small"><span class="pill done">${L('customer letter', 'klantenbrief')}</span>
      ${L('You are a customer here, so this asks them to stop marketing and delete what they do not need — your account stays.',
          'Je bent hier klant, dus deze brief vraagt om te stoppen met marketing en te wissen wat ze niet nodig hebben — je account blijft.')}</p>` : ''}
    <div class="row">
      <button class="primary" data-action="send-open">${L(`Open email to ${esc(nameOf(b))} →`, `Open de mail aan ${esc(nameOf(b))} →`)}</button>
      <button data-action="send-skip">${L('Skip', 'Overslaan')}</button>
    </div>
    <p class="small muted" style="margin:10px 0 0">${L(
      'Your mail app opens with the letter filled in. Press Send there, come back, and the next one is ready. Each is marked as sent when it opens. The letter is also copied, in case your mail app cuts a long one short.',
      'Je mailapp opent met de brief ingevuld. Druk daar op Verstuur, kom terug, en de volgende staat klaar. Elke brief wordt als verstuurd gemarkeerd zodra hij opent. De brief wordt ook gekopieerd, voor het geval je mailapp een lange brief afkapt.')}
      ${next.length ? `<br>${L('Up next:', 'Hierna:')} ${next.map(esc).join(', ')}${total - q.i - 1 > next.length ? '…' : ''}` : ''}</p>
  </section>`;
}

function workCard(w, params) {
  const all = params.get('all') === '1' ? '&all=1' : '';
  const n = w.send.length;
  const parts = [];

  if (n) parts.push(`
    <div class="work-row">
      <div>
        <h2>${L('Send all requests', 'Alle verzoeken versturen')} <span class="count">${n}</span></h2>
        <p class="small muted">${L(`One click each: every letter opens in your own mail app, ready to send. Deadlines are tracked from that moment.`,
          `Eén klik per bedrijf: elke brief opent in je eigen mailapp, klaar om te versturen. De termijnen lopen vanaf dat moment.`)}</p>
      </div>
      <div class="row">
        <button class="primary" data-action="send-start" data-kind="request">${L(`Send ${n} ${n === 1 ? 'request' : 'requests'}`, `${n} ${n === 1 ? 'verzoek' : 'verzoeken'} versturen`)}</button>
        <a class="btn" href="#/print?set=request${all}">${L('Print all / PDF', 'Alles afdrukken / PDF')}</a>
      </div>
    </div>`);

  if (w.reminders.length) parts.push(`
    <div class="work-row">
      <div>
        <h2>${L('No answer in time', 'Niet op tijd gereageerd')} <span class="count bad">${w.reminders.length}</span></h2>
        <p class="small muted">${L(`Their month is up. A reminder gives them ${REMINDER_GRACE} more days before a complaint to the regulator.`,
          `Hun maand is om. Een herinnering geeft ze nog ${REMINDER_GRACE} dagen voordat je een klacht indient bij de toezichthouder.`)}
          <br><strong>${esc(w.reminders.map(b => nameOf(b)).join(', '))}</strong></p>
      </div>
      <div class="row">
        <button class="primary" data-action="send-start" data-kind="reminder">${L(`Send ${w.reminders.length} ${w.reminders.length === 1 ? 'reminder' : 'reminders'}`,
          `${w.reminders.length} ${w.reminders.length === 1 ? 'herinnering' : 'herinneringen'} versturen`)}</button>
        <a class="btn" href="#/print?set=reminder${all}">${L('Print', 'Afdrukken')}</a>
      </div>
    </div>`);

  if (w.complaints.length) parts.push(`
    <div class="work-row">
      <div>
        <h2>${L('Ready for a complaint', 'Klaar voor een klacht')} <span class="count bad">${w.complaints.length}</span></h2>
        <p class="small muted">${L(`These ignored the reminder too, or refused. The regulator takes complaints through its own website: write the complaint here, then submit it at
          <a href="https://autoriteitpersoonsgegevens.nl" target="_blank" rel="noopener noreferrer">autoriteitpersoonsgegevens.nl</a> ("Klacht indienen"), or your own country's authority. Once filed, set the status to Escalated.`,
          `Deze negeerden ook de herinnering, of weigerden. De toezichthouder neemt klachten aan via de eigen website: schrijf de klacht hier en dien hem in op
          <a href="https://autoriteitpersoonsgegevens.nl" target="_blank" rel="noopener noreferrer">autoriteitpersoonsgegevens.nl</a> ("Klacht indienen"). Zet daarna de status op Geëscaleerd.`)}</p>
        <div class="list">${w.complaints.map(b => `
          <div class="pick" style="cursor:default">
            <span class="pick-name">${esc(nameOf(b))}</span>
            <a class="btn" href="#/letter?b=${encodeURIComponent(b.id)}&t=${templateFor('complaint', b, store.get().profile)}">${L('Write complaint', 'Klacht schrijven')}</a>
          </div>`).join('')}</div>
      </div>
    </div>`);

  if (w.forms.length) parts.push(`
    <div class="work-row">
      <div>
        <h2>${L('Web form only', 'Alleen via webformulier')} <span class="count">${w.forms.length}</span></h2>
        <p class="small muted">${L('These only accept their own opt-out form. Open each, fill it in, and mark it done so its deadline is tracked too.',
          'Deze accepteren alleen hun eigen afmeldformulier. Open het, vul het in en markeer het als gedaan, zodat ook die termijn wordt bijgehouden.')}</p>
        <div class="list">${w.forms.map(b => `
          <div class="pick" style="cursor:default">
            <span class="pick-name">${esc(nameOf(b))}</span>
            <a class="btn" href="${esc(safeUrl(b.optOutUrl))}" target="_blank" rel="noopener noreferrer">${L('Open form ↗', 'Formulier openen ↗')}</a>
            <button data-action="form-done" data-id="${esc(b.id)}">${L('Done', 'Gedaan')}</button>
          </div>`).join('')}</div>
      </div>
    </div>`);

  if (!parts.length) return '';
  return `<section class="card work-card">${parts.join('<hr>')}</section>`;
}

function wireSend(root, rerender) {
  root.addEventListener('change', e => {
    if (e.target.id !== 'send-to') return;
    const to = e.target.value.trim();
    if (to && to !== recipient(lastTargets.get(e.target.dataset.id) || {})) store.setRecipient(e.target.dataset.id, to);
  });

  root.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const act = btn.dataset.action;

    if (act === 'send-start') {
      const w = deleteWork([...lastTargets.values()]);
      const list = btn.dataset.kind === 'reminder' ? w.reminders : w.send;
      sendQueue = { kind: btn.dataset.kind, ids: list.map(b => b.id), i: 0 };
      rerender();
    }

    if (act === 'send-skip' && sendQueue) { sendQueue.i++; rerender(); }

    if (act === 'send-close') {
      sendQueue = null;
      if (/[?&]send=1/.test(location.hash)) location.hash = '#/delete'; else rerender();
    }

    if (act === 'send-open' && sendQueue) {
      const b = lastTargets.get(sendQueue.ids[sendQueue.i]);
      if (!b) return;
      const r = store.getRequest(b.id);
      const to = root.querySelector('#send-to')?.value.trim() || recipient(b, r);
      const { subject, body } = renderLetter(queueTemplate(sendQueue.kind, b, store.get().profile), b, store.get().profile, r);

      // Must happen inside the click, before the re-render below: handing a
      // mailto: to the mail app needs the user gesture.
      const link = document.createElement('a');
      link.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      link.click();
      navigator.clipboard?.writeText(body).catch(() => {});

      const extra = to !== (b.email || '') ? { to } : {};
      sendQueue.i++;
      if (sendQueue.kind === 'reminder') store.markReminder(b.id, extra);
      else store.setStatus(b.id, 'sent', extra);
    }

    if (act === 'form-done') {
      store.setStatus(btn.dataset.id, 'sent');
      toast(L('Marked as done — deadline started', 'Gemarkeerd als gedaan — de termijn loopt'));
    }
  });
}

// ------------------------------------------------------------- print all

export function printAll(state, catalog, params) {
  const reminder = params.get('set') === 'reminder';
  const mine = state.custom;
  const targets = params.get('all') === '1' ? allTargets({ ...state, custom: mine }, catalog) : mine;
  const w = deleteWork(targets);
  const list = reminder ? w.reminders : w.send;
  const back = `#/delete${params.get('all') === '1' ? '?all=1' : ''}`;
  if (!list.length) return `<div class="card"><p>${L('Nothing to print.', 'Niets om af te drukken.')}
    <a href="${back}">${L('Back', 'Terug')}</a></p></div>`;

  return `
  <div class="head no-print">
    <a class="back" href="${back}">← ${L('Delete data', 'Gegevens verwijderen')}</a>
    <h1>${reminder ? L(`${list.length} reminders`, `${list.length} herinneringen`) : L(`${list.length} letters`, `${list.length} brieven`)}</h1>
    <p>${L('One letter per page. Save as PDF to keep a record of exactly what you sent, or print and post them. Mark them as sent once they are on their way.',
      'Eén brief per pagina. Bewaar als PDF als bewijs van wat je precies verstuurde, of druk af en verstuur per post. Markeer ze als verstuurd zodra ze onderweg zijn.')}</p>
    <div class="row">
      <button class="primary" data-action="print">${L('Print / save as PDF', 'Afdrukken / opslaan als PDF')}</button>
      <button data-action="print-mark" data-set="${reminder ? 'reminder' : 'request'}" data-ids="${esc(JSON.stringify(list.map(b => b.id)))}">${
        L(`Mark all ${list.length} as sent`, `Alle ${list.length} als verstuurd markeren`)}</button>
    </div>
  </div>
  ${list.map(b => {
    const r = store.getRequest(b.id);
    const { subject, body } = renderLetter(queueTemplate(reminder ? 'reminder' : 'request', b, state.profile), b, state.profile, r);
    return `<article class="card print-letter">
      <p class="small muted">${L('To', 'Aan')}: ${esc(b.name)}${recipient(b, r) ? ` · <span class="mono">${esc(recipient(b, r))}</span>` : ''}</p>
      <p class="small"><strong>${L('Subject', 'Onderwerp')}:</strong> ${esc(subject)}</p>
      <div class="letter">${esc(body)}</div>
    </article>`;
  }).join('')}`;
}

export function mountPrintAll(root) {
  root.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'print') window.print();
    if (btn.dataset.action === 'print-mark') {
      const ids = JSON.parse(btn.dataset.ids || '[]');
      for (const id of ids) btn.dataset.set === 'reminder' ? store.markReminder(id) : store.setStatus(id, 'sent');
      toast(L(`${ids.length} marked as sent`, `${ids.length} als verstuurd gemarkeerd`));
      location.hash = '#/delete';
    }
  });
}

// Hands the one-click set to the isolated worker and renders its progress.
export function runOneClickBatch(root, items, rest) {
  const q = root.querySelector('#unsub-queue');
  if (!q) return;
  q.dataset.rest = JSON.stringify(rest.map(t => ({ id: t.id, name: t.name, unsubUrl: t.unsubUrl })));

  const paint = (done, failed, total, finished) => {
    q.innerHTML = `
      <div class="notice ${finished ? '' : 'warn'}">
        <p><strong>${finished ? L(`Sent ${done} of ${total}`, `${done} van ${total} verstuurd`)
                              : L(`Unsubscribing… ${done} of ${total}`, `Bezig met uitschrijven… ${done} van ${total}`)}</strong>${failed
          ? L(` — ${failed} could not be reached`, ` — ${failed} niet bereikbaar`) : ''}</p>
        ${finished ? `<p class="small">${L('Delivered, not confirmed: a browser hides cross-site responses, so the app cannot read what each sender replied. Compliant senders act on it immediately. If mail from one continues, send it a deletion letter — that one you can enforce.',
          'Verstuurd, niet bevestigd: een browser verbergt antwoorden van andere sites, dus de app kan niet lezen wat elke afzender terugstuurde. Nette afzenders verwerken het meteen. Blijft er mail komen, stuur die afzender dan een verwijderverzoek — dat kun je afdwingen.')}</p>` : ''}
        ${finished && failed ? `<p class="small">${L('The ones that could not be reached stay on your list, so you can try again.', 'De niet-bereikbare blijven op je lijst staan, zodat je het opnieuw kunt proberen.')}</p>` : ''}
        ${finished && rest.length ? `<p class="small"><strong>${L(`${rest.length} more`, `Nog ${rest.length}`)}</strong> ${L('published a link but not one-click, so they need opening individually.', 'gaven een link maar geen één-klik, dus die moeten één voor één open.')}</p>` : ''}
        <div class="row" style="margin-top:8px">
          ${finished && rest.length ? `<button class="primary" data-action="queue-rest">${L(`Open the remaining ${rest.length}`, `Open de overige ${rest.length}`)}</button>` : ''}
          ${finished ? `<button data-action="unsub-close">${L('Close', 'Sluiten')}</button>` : ''}
        </div>
      </div>`;
  };

  paint(0, 0, items.length, false);

  const delivered = [];
  const frame = document.createElement('iframe');
  frame.src = 'unsubscribe.html';
  frame.hidden = true;
  frame.setAttribute('aria-hidden', 'true');

  const onMessage = e => {
    if (e.origin !== location.origin || e.data?.source !== 'dr-unsub') return;
    const d = e.data;
    if (d.type === 'ready') {
      frame.contentWindow.postMessage({
        type: 'dr-unsub-batch',
        items: items.map(t => ({ id: t.id, name: t.name, url: safeUrl(t.unsubUrl) }))
      }, location.origin);
    }
    if (d.type === 'progress') {
      // Only a request that actually went out counts; a network failure must
      // leave the sender pending so the user can try again.
      if (d.ok && d.id) delivered.push(d.id);
      paint(d.done, d.failed, d.total, false);
    }
    if (d.type === 'complete') {
      paint(d.done, d.failed, d.total, true);
      markUnsubscribed(delivered);
      removeEventListener('message', onMessage);
      frame.remove();
    }
  };

  addEventListener('message', onMessage);
  document.body.appendChild(frame);
}

// The queue renders on whichever page asked for it, so its buttons are wired
// once here rather than inside a single page's mount.
export function wireQueue(root, onClose) {
  root.addEventListener('click', e => {
    const act = e.target.closest('[data-action]')?.dataset.action;
    const q = root.querySelector('#unsub-queue');
    if (!q) return;

    if (act === 'queue-rest') {
      startUnsubQueue(root, JSON.parse(q.dataset.rest || '[]'));
    }

    if (act === 'unsub-next') {
      const i = Number(q.dataset.i || 0);
      const urls = JSON.parse(q.dataset.urls || '[]');
      if (i < urls.length) {
        // One window.open per click. A loop is silently swallowed by the popup
        // blocker after the first, so stepping through is the only honest way.
        window.open(urls[i].url, '_blank', 'noopener,noreferrer');
        if (urls[i].id) markUnsubscribed([urls[i].id]);
        q.dataset.i = String(i + 1);
        renderQueue(q, urls, i + 1);
      }
    }

    if (act === 'unsub-copy') {
      const urls = JSON.parse(q.dataset.urls || '[]');
      navigator.clipboard.writeText(urls.map(u => u.url).join('\n'))
        .then(() => toast(L(`${urls.length} links copied`, `${urls.length} links gekopieerd`)))
        .catch(() => toast(L('Could not copy — select them by hand', 'Kopiëren mislukt — selecteer ze zelf')));
    }

    if (act === 'unsub-close') { q.innerHTML = ''; onClose?.(); }
  });
}

export function startUnsubQueue(root, list) {
  const q = root.querySelector('#unsub-queue');
  if (!q) return;
  if (!list.length) { toast(L('None of these published an unsubscribe link', 'Geen van deze gaf een uitschrijflink')); return; }
  const urls = list.map(t => ({ id: t.id, name: t.name, url: safeUrl(t.unsubUrl) }));
  q.dataset.urls = JSON.stringify(urls);
  q.dataset.i = '0';
  renderQueue(q, urls, 0);
}

function renderQueue(q, urls, i) {
  const done = i >= urls.length;
  q.innerHTML = `
    <div class="notice ${done ? '' : 'warn'}">
      ${done
        ? `<p><strong>${L(`All ${urls.length} opened.`, `Alle ${urls.length} geopend.`)}</strong> ${L('Each opened in its own tab — finish any that ask for a confirmation click.', 'Elk opende in een eigen tabblad — rond af waar nog om een bevestiging wordt gevraagd.')}</p>`
        : `<p><strong>${L(`Unsubscribing: ${i} of ${urls.length} done.`, `Uitschrijven: ${i} van ${urls.length} klaar.`)}</strong> ${L('Next:', 'Volgende:')}
           <strong>${esc(urls[i].name)}</strong></p>
           <p class="small muted">${L('Your browser blocks a page from opening many tabs at once, so this steps through them — one click each, no hunting for the link.',
             'Je browser laat een pagina niet veel tabbladen tegelijk openen, dus dit gaat er één voor één doorheen — één klik per afzender, zonder de link te hoeven zoeken.')}</p>`}
      <div class="row" style="margin-top:8px">
        ${done ? '' : `<button class="primary" data-action="unsub-next">${L(`Open ${esc(urls[i].name)} →`, `Open ${esc(urls[i].name)} →`)}</button>`}
        <button data-action="unsub-copy">${L(`Copy all ${urls.length} links`, `Kopieer alle ${urls.length} links`)}</button>
        <button data-action="unsub-close">${done ? L('Close', 'Sluiten') : L('Stop', 'Stoppen')}</button>
      </div>
    </div>`;
}

// ------------------------------------------------------------- unsubscribe

// Three outcomes, and only two of them are unsubscribing. A sender with no
// unsubscribe anywhere in its message is not a company that forgot — compliant
// bulk mail must offer one — so it is treated as spam to block, not written to.
// An unsubscribe link in a mail whose sender failed authentication is not a
// way out, it is a tracker: clicking it confirms a person reads this mailbox.
// So a forged sender's link is never offered, however legitimate it looks.
export function senderClass(b) {
  if (b.source !== 'mail') return 'company';
  const hasLink = !!(b.unsubUrl && safeUrl(b.unsubUrl));
  // Unsafe: failed the sender check, rated high-confidence spam by the mail
  // provider, or selling something unsafe whoever sends it (gambling, crypto,
  // prize and adult spam). Passing the sender check only proves who sent it.
  if (unsafeReason(b)) return hasLink ? 'bait' : 'spam';
  if (hasLink) return 'unsub';
  // A verified sender without an unsubscribe link is a real company sending
  // receipts or account mail — a deletion letter, never a block. One that
  // could not be verified either way is left for the user to judge.
  return b.trust === 'verified' ? 'company' : 'unclear';
}

// Why a sender is treated as unsafe, or '' when it is not.
export function unsafeReason(b) {
  if (b.source !== 'mail') return '';
  if (b.trust === 'forged') return L('failed the sender check', 'zakte voor de afzendercontrole');
  const R = {
    gambling: L('gambling advertising', 'gokreclame'),
    crypto: L('crypto or get-rich pitch', 'crypto- of snel-rijk-reclame'),
    pharma: L('pharmacy spam', 'medicijnspam'),
    impersonation: L('pretends to be an official organisation', 'doet zich voor als een officiële instantie'),
    prize: L('fake prize', 'nepprijs'),
    adult: L('adult spam', 'seksspam'),
    phishing: L('account scare (phishing)', 'accountdreiging (phishing)')
  };
  if (b.risk) return R[b.risk] || b.risk;
  if (b.providerSpam) return L('rated high-confidence spam by your mail provider', 'door je mailprovider als zekere spam aangemerkt');
  return '';
}

export function hostOf(u) { try { return new URL(u).hostname; } catch { return ''; } }

export function unsubTier(b) {
  if (senderClass(b) !== 'unsub') return null;
  // One-click POST only for a verified sender's own header: never fire a
  // request at an endpoint whose owner could not be confirmed.
  return b.oneClick && b.unsubFrom === 'header' && b.trust === 'verified' ? 'instant' : 'link';
}

let unsubPrimed = false;

export function unsubscribe(state) {
  const mail = state.custom.filter(b => b.source === 'mail');
  const tiers = { instant: [], link: [] };
  const spam = [], bait = [], unclear = [];
  for (const b of state.custom) {
    const t = unsubTier(b);
    const c = senderClass(b);
    if (t) tiers[t].push(b);
    else if (c === 'bait') bait.push(b);
    else if (c === 'spam') spam.push(b);
    else if (c === 'unclear') unclear.push(b);
  }

  if (!unsubPrimed && (tiers.instant.length || tiers.link.length)) {
    [...tiers.instant, ...tiers.link].filter(b => b.trust === 'verified').forEach(b => selected.add(b.id));
    unsubPrimed = true;
  }

  const sel = k => tiers[k].filter(b => selected.has(b.id));

  const group = (key, title, blurb, cta, cls) => tiers[key].length ? `
    <section class="card">
      <div class="row between" style="align-items:flex-start;gap:16px">
        <div>
          <h2>${title} <span class="count">${tiers[key].length}</span></h2>
          <p class="small muted" style="max-width:56ch;margin:0">${blurb}</p>
        </div>
        <button class="${cls}" data-action="run-${key}" ${sel(key).length ? '' : 'disabled'}>
          ${cta(sel(key).length)}
        </button>
      </div>
      <div class="row" style="margin:12px 0 4px">
        <button class="link-btn" data-action="sel-group" data-group="${key}">
          ${sel(key).length === tiers[key].length ? L(`Deselect all ${tiers[key].length}`, `Alle ${tiers[key].length} deselecteren`) : L(`Select all ${tiers[key].length}`, `Alle ${tiers[key].length} selecteren`)}
        </button>
      </div>
      <div class="list">
        ${tiers[key].map(b => `
          <label class="pick">
            <input type="checkbox" data-action="sel" data-id="${esc(b.id)}" ${selected.has(b.id) ? 'checked' : ''}>
            <span class="pick-name">${esc(nameOf(b))}</span>
            ${b.trust === 'verified' ? `<span class="pill done">${L('verified sender', 'gecontroleerde afzender')}</span>`
              : `<span class="pill low">${L('unverified — check first', 'niet gecontroleerd — kijk eerst zelf')}</span>`}
            ${b.unsubscribedAt ? `<span class="pill">${L('unsubscribed', 'uitgeschreven')}</span>` : ''}
            <span class="pick-meta mono">${esc(b.site || '')}</span>
          </label>`).join('')}
      </div>
    </section>` : '';

  const list = (items, extra = () => '') => `<div class="list">${items.map(b => `
    <div class="pick" style="cursor:default;flex-wrap:wrap">
      <span class="pick-name">${esc(nameOf(b))}${akaOf(b) ? `<span class="aka">${esc(akaOf(b))}</span>` : ''}</span>
      <span class="pick-meta mono">${esc(extra(b) || b.site || '')}</span>
    </div>`).join('')}</div>`;

  return `
  <div class="head">
    <a class="back" href="#/">${L('← Home', '← Home')}</a>
    <h1>${L('Unsubscribe &amp; block', 'Uitschrijven &amp; blokkeren')}</h1>
    <p>${L('Real companies get an unsubscribe. Unsafe senders — scams, gambling and other spam — get blocked. Stopping the mail is not deletion — <a href="#/delete">that is the other page</a>.',
           'Bij echte bedrijven schrijf je je uit. Onveilige afzenders — oplichters, gokreclame en andere spam — blokkeer je. Uitschrijven stopt alleen de mail; je gegevens laten wissen doe je op <a href="#/delete">de andere pagina</a>.')}</p>
  </div>

  ${!mail.length ? `<div class="notice">
    <p>${L('Nothing here yet. <a href="#/">Scan your mail</a> and senders land here automatically.',
           'Nog niets hier. <a href="#/">Scan je mail</a> en afzenders komen hier vanzelf.')}</p>
  </div>` : ''}

  <div id="unsub-queue"></div>

  ${group('instant', L('One click, no page to visit', 'Met één klik, zonder pagina'),
    L('These support the one-click unsubscribe standard, so a single request finishes it. They all go at once.',
      'Deze afzenders ondersteunen uitschrijven met één klik. Ze gaan allemaal tegelijk.'),
    n => L(`Unsubscribe ${n || ''} now`, `Schrijf je nu uit bij ${n || ''}`), 'primary')}

  ${group('link', L('Opens their page', 'Via hun eigen pagina'),
    L('These published a link — usually as "Uitschrijven" or "Unsubscribe" at the bottom — but not one-click, so the page has to load. They open one at a time.',
      'Deze afzenders hebben een uitschrijflink (meestal "Uitschrijven" onderaan de mail), maar geen uitschrijving met één klik. Hun pagina\'s openen één voor één.'),
    n => L(`Open ${n || ''}`, `${n || ''} openen`), '')}

  ${bait.length + spam.length ? blockAllCard(state) : ''}

  ${bait.length ? `
    <section class="card danger-card">
      <h2>${L('Fake unsubscribe links — do not click', 'Nep-uitschrijflinks — niet klikken')} <span class="count">${bait.length}</span></h2>
      <p class="small" style="max-width:62ch">${L('These contain an "unsubscribe" link, but the sender is <strong>unsafe</strong> — the reason is shown per sender. From senders like these the link is not a way out but a tracker: clicking it tells them a real person reads this mailbox.',
        'Deze bevatten een "uitschrijven"-link, maar de afzender is <strong>onveilig</strong> — de reden staat per afzender. Bij zulke afzenders is de link geen uitweg maar een tracker: als je klikt, weten ze dat er echt iemand deze mailbox leest.')}</p>
      ${list(bait, b => unsafeReason(b) + ' · ' + L('link goes to ', 'link gaat naar ') + hostOf(b.unsubUrl))}
    </section>` : ''}

  ${spam.length ? `
    <section class="card">
      <h2>${L('Spam — block, do not reply', 'Spam — blokkeren, niet reageren')} <span class="count">${spam.length}</span></h2>
      <p class="small muted" style="max-width:60ch">${L('These are unsafe — the reason is shown per sender — and offered no way to unsubscribe. Do not click anything in them, and do not send them a letter: any response confirms a person reads this mailbox.',
        'Deze zijn onveilig — de reden staat per afzender — en boden geen manier om je uit te schrijven. Klik nergens op en stuur geen brief: elke reactie bevestigt dat er een mens deze mailbox leest.')}</p>
      ${list(spam, b => unsafeReason(b) + (b.site ? ' · ' + b.site : ''))}
    </section>` : ''}

  ${unclear.length ? `
    <section class="card">
      <h2>${L('Could not verify', 'Niet te controleren')} <span class="count">${unclear.length}</span></h2>
      <p class="small muted" style="max-width:60ch">${L('These carry no sender check either way and no unsubscribe link, so the app neither blocks nor writes to them. If you recognise the company, add it under <a href="#/delete">Delete data</a>. If you do not, mark it as junk in your mail app.',
        'Bij deze afzenders ontbreekt de afzendercontrole helemaal, en er is geen uitschrijflink. Daarom blokkeren we ze niet en schrijven we ze niet aan. Ken je het bedrijf, voeg het dan toe bij <a href="#/delete">Gegevens verwijderen</a>. Ken je het niet, markeer het dan als ongewenst in je mailapp.')}</p>
      ${list(unclear)}
    </section>` : ''}`;
}


// ---------------------------------------------------------------- block all

const CLIENTS = () => ({
  outlookcom: 'Outlook.com / Hotmail',
  outlookwin: L('Outlook for Windows', 'Outlook voor Windows'),
  gmail:      'Gmail',
  apple:      'Apple Mail / iCloud',
  sieve:      L('Fastmail, Proton & others', 'Fastmail, Proton & andere')
});
let blockClient = null;

// What the user has confirmed adding to their mail app ("Done"). An older
// "exported" record counts too: before the Done button existed, downloading
// the list was the only signal there was.
const isBlockable = t => ['spam', 'bait'].includes(senderClass(t));
export const blockDoneIds = state => new Set(state.blockDone?.ids || state.blockExport?.ids || []);
export const blockDoneAt = state => state.blockDone?.at || state.blockExport?.at || '';
export const ruleCount = bl => bl.links.length + bl.replyTo.length + bl.sharedReplyTo.length;
let showAllRules = false;

// The rules still to add. After a "Done", a new batch shows only rules the
// earlier ones do not already contain: new senders often reuse the same link
// sites, and those need nothing at all.
export function blockView(state, all = showAllRules) {
  const full = buildBlockList(state.custom, senderClass);
  const doneIds = blockDoneIds(state);
  if (!doneIds.size || all) return { bl: full, delta: false };
  const done = buildBlockList(state.custom.filter(t => !isBlockable(t) || doneIds.has(t.id)), senderClass);
  const minus = (a, b) => a.filter(x => !b.includes(x));
  return {
    delta: true,
    bl: {
      count: state.custom.filter(t => isBlockable(t) && !doneIds.has(t.id)).length,
      links: minus(full.links, done.links),
      replyTo: minus(full.replyTo, done.replyTo),
      sharedReplyTo: minus(full.sharedReplyTo, done.sharedReplyTo)
    }
  };
}

export function blockAllCard(state, { closable = false } = {}) {
  const view = blockView(state);
  const bl = view.bl;
  if (!blockClient) blockClient = guessClient(state.custom.filter(isBlockable));
  const reply = bl.replyTo.length + bl.sharedReplyTo.length;
  const rules = bl.links.length + reply;
  const at = esc(blockDoneAt(state));
  const toggle = blockDoneIds(state).size ? `<button class="link-btn" data-action="block-toggle">${showAllRules
    ? L('Show only new rules', 'Toon alleen nieuwe regels') : L('Show all rules', 'Toon alle regels')}</button>` : '';

  const title = !view.delta
    ? L(`Block all ${bl.count} at once`, `Blokkeer alle ${bl.count} in één keer`)
    : rules ? L(`${rules} new ${rules === 1 ? 'rule' : 'rules'} since ${at}`, `${rules} ${rules === 1 ? 'nieuwe regel' : 'nieuwe regels'} sinds ${at}`)
            : L('All blocked', 'Alles geblokkeerd');

  return `
  <section class="card block-card ${closable ? 'panel' : ''}" data-closable="${closable ? 1 : ''}">
    <div class="row between" style="align-items:flex-start;gap:16px">
      <div>
        <h2>${title}</h2>
        <p class="small muted" style="max-width:58ch;margin:0">${L('Only unsafe senders are blocked, never a real company. The rules target what these campaigns reuse — the sites their links go to and where replies go — not the From address, which in forged mail is made up or borrowed from a real company.',
          'Alleen onveilige afzenders worden geblokkeerd, nooit een echt bedrijf. De regels richten zich op wat deze afzenders steeds opnieuw gebruiken: de websites waar hun links naartoe gaan en de adressen waar antwoorden heen gaan. Niet op het afzenderadres, want dat is bij nepmail verzonnen of geleend van een echt bedrijf.')}</p>
      </div>
      <div class="row" style="flex-wrap:nowrap">
        <select id="block-client" style="width:auto" aria-label="${L('Your mail app', 'Je mailapp')}">
          ${Object.entries(CLIENTS()).map(([k, v]) => `<option value="${k}" ${k === blockClient ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
        ${closable ? `<button class="link-btn" data-action="panel-close">${L('Close', 'Sluiten')}</button>` : ''}
      </div>
    </div>

    ${view.delta && !rules ? `
    <p class="small" style="margin-top:12px">${L(`The rules you added on ${at} already cover every unsafe sender scanned so far. Drop in your next batch of junk mail, and only rules you do not have yet will show up here.`,
      `De regels die je op ${at} toevoegde, dekken alle onveilige afzenders die tot nu toe gescand zijn. Sleep je volgende lading ongewenste mail erin, dan verschijnen hier alleen regels die je nog niet hebt.`)}</p>
    <div class="row">${toggle}<button class="link-btn" data-action="block-reset">${L('Start over (e.g. new mail app)', 'Opnieuw beginnen (bijv. andere mailapp)')}</button></div>` : `
    <div class="block-facts small">
      <span><b>${bl.links.length}</b> ${plural(bl.links.length, 'link site', 'link sites', 'website', 'websites')}</span>
      <span><b>${reply}</b> ${plural(reply, 'reply address', 'reply addresses', 'antwoordadres', 'antwoordadressen')}</span>
    </div>
    ${view.delta ? `<p class="small">${L(`Only what is new since ${at}. Add these to the rules you made then, or make a new rule — both work.`,
      `Alleen wat nieuw is sinds ${at}. Voeg ze toe aan de regels die je toen maakte, of maak een nieuwe regel — allebei werkt.`)}</p>` : ''}

    <div id="block-panel">${rules ? blockPanel(bl, blockClient) : `<p class="small muted">${L('Nothing blockable yet: these senders left no reusable trace. Drop the messages in again so their links and reply addresses are recorded.',
      'Nog niets te blokkeren: deze afzenders lieten geen herbruikbaar spoor achter. Zet de mails er opnieuw in, zodat hun links en antwoordadressen worden vastgelegd.')}</p>`}</div>
    ${rules ? `
    <div class="block-done">
      <button class="primary" data-action="block-done">${L("I've added these rules — done", 'Ik heb deze regels toegevoegd — klaar')}</button>
      <span class="small muted">${L('HoopUp cannot see your mail app, so tell it. Next time, only new rules show up.',
        'HoopUp kan niet in je mailapp kijken, dus laat het hier weten. De volgende keer zie je alleen nieuwe regels.')}</span>
      ${toggle}
    </div>` : ''}`}
  </section>`;
}

export function blockPanel(bl, client) {
  const reply = [...bl.replyTo, ...bl.sharedReplyTo];
  // Mail apps match each entered value on its own only when it is entered on
  // its own: a pasted list becomes one long value that no message contains.
  // So the manual clients get one copy button per item, never a copy-all.
  const chips = arr => `<div class="copy-chips">${arr.map(d =>
    `<button type="button" class="copy-chip" data-action="copy-one" data-value="${esc(d)}">${esc(d)}</button>`).join('')}</div>`;
  const oneByOne = `<p class="small muted">${L('Click an item to copy it, paste it, then do the next one: <b>one item per entry</b>. Pasted together they become one long text that no message contains, and the rule never fires. As separate entries, a message only has to match <i>one</i> of them.',
    'Klik op een item om het te kopiëren, plak het, en doe dan het volgende: <b>elk item apart</b>. Samen geplakt worden ze één lange tekst die in geen enkel bericht staat, en dan doet de regel niets. Los ingevoerd hoeft een bericht maar met <i>één</i> ervan overeen te komen.')}</p>`;
  const twoRules = `<p class="small muted">${L('Two rules rather than one: inside a single Outlook rule, every condition has to match at once.',
    'Twee regels in plaats van één: binnen één Outlook-regel moeten alle voorwaarden tegelijk kloppen.')}</p>`;
  const sharedNote = bl.sharedReplyTo.length ? `<p class="small muted">${bl.sharedReplyTo.map(esc).join(', ')}
    ${L(`${bl.sharedReplyTo.length === 1 ? 'is a mailing service' : 'are mailing services'} that legitimate senders use too, so ${bl.sharedReplyTo.length === 1 ? 'it is' : 'they are'} only matched as a reply address, never blocked outright.`,
        `${bl.sharedReplyTo.length === 1 ? 'is een maildienst die' : 'zijn maildiensten die'} ook door echte afzenders ${bl.sharedReplyTo.length === 1 ? 'wordt' : 'worden'} gebruikt. Daarom blokkeren we ${bl.sharedReplyTo.length === 1 ? 'die' : 'ze'} alleen als antwoordadres, nooit helemaal.`)}</p>` : '';
  const check = how => `<p class="small muted">${L(`<b>Check it works:</b> ${how} The scams should move to the trash. Any that stay hide their link behind a button; the reply rule catches most of those.`,
    `<b>Controleer of het werkt:</b> ${how} De oplichtersmails horen naar de prullenmand te gaan. Blijven er een paar staan, dan zit hun link achter een knop verstopt; de antwoordregel vangt de meeste daarvan.`)}</p>`;

  const steps = {
    outlookcom: `
      ${oneByOne}
      <ol class="small">
        ${bl.links.length ? `<li>${L('<b>Settings</b> (gear) → <b>Mail</b> → <b>Rules</b> → <b>Add new rule</b>. Name it <i>HoopUp – links</i>. Condition <b>Subject or body includes</b>. Paste the first site and press <b>Enter</b>; it turns into a separate tag. Repeat for each site:',
          '<b>Instellingen</b> (tandwiel) → <b>E-mail</b> → <b>Regels</b> → <b>Nieuwe regel toevoegen</b>. Noem hem <i>HoopUp – links</i>. Voorwaarde <b>Onderwerp of hoofdtekst bevat</b>. Plak de eerste site en druk op <b>Enter</b>; hij wordt een los label. Herhaal dat voor elke site:')}
          ${chips(bl.links)}${L('Action <b>Delete</b>. Save.', 'Actie <b>Verwijderen</b>. Opslaan.')}</li>` : ''}
        ${reply.length ? `<li>${L('Add a second rule, <i>HoopUp – replies</i>. Condition <b>Message header includes</b>, again one address at a time, each followed by <b>Enter</b>:',
          'Voeg een tweede regel toe, <i>HoopUp – antwoorden</i>. Voorwaarde <b>Berichtkop bevat</b>, weer één adres tegelijk, steeds gevolgd door <b>Enter</b>:')}
          ${chips(reply)}${L('Action <b>Delete</b>. Save.', 'Actie <b>Verwijderen</b>. Opslaan.')}</li>` : ''}
      </ol>
      ${bl.links.length && reply.length ? twoRules : ''}
      ${check(L('open each rule and choose <b>Run rule</b> (or tick <i>Run rule now</i> when saving).', 'open elke regel en kies <b>Regel uitvoeren</b> (of vink <i>Regel nu uitvoeren</i> aan bij het opslaan).'))}
      <p class="small muted">${L('Menu names shift slightly between Outlook versions; the conditions are the same.', 'Menunamen verschillen soms per Outlook-versie; de voorwaarden zijn hetzelfde.')}</p>`,
    outlookwin: `
      ${oneByOne}
      <ol class="small">
        <li>${L('<b>Home</b> → <b>Rules</b> → <b>Manage Rules &amp; Alerts</b> → <b>New Rule</b> → <b>Apply rule on messages I receive</b>.',
               '<b>Start</b> → <b>Regels</b> → <b>Regels en waarschuwingen beheren</b> → <b>Nieuwe regel</b> → <b>Regel toepassen op berichten die ik ontvang</b>.')}</li>
        ${bl.links.length ? `<li>${L('Tick <b>with specific words in the body</b> and click <i>specific words</i>. Paste one site, click <b>Add</b>, and repeat — each one on its own line in the list:',
          'Vink <b>met specifieke woorden in de hoofdtekst</b> aan en klik op <i>specifieke woorden</i>. Plak één site, klik op <b>Toevoegen</b>, en herhaal — elke site op een eigen regel in de lijst:')}
          ${chips(bl.links)}${L('Then <b>delete it</b> → <b>Finish</b>.', 'Kies dan <b>verwijderen</b> → <b>Voltooien</b>.')}</li>` : ''}
        ${reply.length ? `<li>${L('Make a second rule the same way, with <b>with specific words in the message header</b>, again one address per <b>Add</b>:',
          'Maak op dezelfde manier een tweede regel, met <b>met specifieke woorden in de berichtkop</b>, weer één adres per <b>Toevoegen</b>:')}
          ${chips(reply)}</li>` : ''}
      </ol>
      ${bl.links.length && reply.length ? twoRules : ''}
      ${check(L('tick <i>Run this rule now on messages already in “Inbox”</i> on the last screen, or use <b>Run Rules Now</b> on your Junk folder.', 'vink op het laatste scherm <i>Deze regel nu toepassen op berichten die al in Postvak IN staan</i> aan, of gebruik <b>Regels nu toepassen</b> op je map Ongewenste e-mail.'))}
      <p class="small muted">${L('Outlook\'s Blocked Senders list only ever matches who a message is from, which is exactly what forged mail fakes — so rules, not that list.',
        'De lijst Geblokkeerde afzenders in Outlook kijkt alleen naar de afzender, en dat is precies wat vervalste mail nadoet — dus regels, niet die lijst.')}</p>`,
    gmail: `
      <ol class="small">
        <li>${L('Download the filter file below.', 'Download hieronder het filterbestand.')}</li>
        <li>${L('<b>Settings</b> (gear) → <b>See all settings</b> → <b>Filters and Blocked Addresses</b>.',
               '<b>Instellingen</b> (tandwiel) → <b>Alle instellingen bekijken</b> → <b>Filters en geblokkeerde adressen</b>.')}</li>
        <li>${L('<b>Import filters</b> → choose <code>hoopup-filters.xml</code> → <b>Open file</b> → <b>Create filters</b>. Tick <i>Also apply to matching conversations</i> to clear what is already there.',
               '<b>Filters importeren</b> → kies <code>hoopup-filters.xml</code> → <b>Bestand openen</b> → <b>Filters maken</b>. Vink <i>Filter ook toepassen op overeenkomende gesprekken</i> aan om wat er al staat op te ruimen.')}</li>
      </ol>
      ${reply.length ? `<p class="small muted">${L('Gmail filters cannot look at the reply address, so the file uses the link sites.', 'Gmail-filters kunnen niet naar het antwoordadres kijken, dus het bestand gebruikt de websites.')}</p>` : ''}
      <div class="row"><button class="primary" data-action="dl-block" data-fmt="gmail" ${bl.links.length ? '' : 'disabled'}>${L('Download Gmail filters', 'Download Gmail-filters')}</button></div>`,
    apple: `
      ${oneByOne}
      <ol class="small">
        <li>${L('Mail on your Mac → <b>Settings</b> → <b>Rules</b> → <b>Add Rule</b>. Name it <i>HoopUp</i>, and set the top menu to <b>If <u>any</u> of the following conditions are met</b> — with <i>all</i>, nothing would ever match.',
               'Mail op je Mac → <b>Instellingen</b> → <b>Regels</b> → <b>Voeg regel toe</b>. Noem hem <i>HoopUp</i> en zet het bovenste menu op <b>Als aan <u>een</u> van de volgende voorwaarden is voldaan</b> — met <i>alle</i> klopt er nooit iets.')}</li>
        ${bl.links.length ? `<li>${L('One condition row per site: <b>Message Content</b> · <b>contains</b> · paste one site. Click <b>+</b> at the end of the row for the next one.',
          'Eén voorwaarderegel per site: <b>Berichtinhoud</b> · <b>bevat</b> · plak één site. Klik op <b>+</b> aan het eind van de regel voor de volgende.')}
          ${chips(bl.links)}</li>` : ''}
        ${reply.length ? `<li>${L('Reply-To is not in the menu until you add it, once: open the first menu of a new row, choose <b>Edit Header List…</b> (at the bottom), click <b>+</b>, type <code>Reply-To</code> and click <b>OK</b>.',
          'Reply-To staat pas in het menu als je het één keer toevoegt: open het eerste menu van een nieuwe regel, kies <b>Wijzig kopregellijst…</b> (onderaan), klik op <b>+</b>, typ <code>Reply-To</code> en klik op <b>OK</b>.')}</li>
        <li>${L('Then one row per address: <b>Reply-To</b> · <b>contains</b> · paste one address, <b>+</b> for the next.',
          'Daarna één regel per adres: <b>Reply-To</b> · <b>bevat</b> · plak één adres, <b>+</b> voor de volgende.')}
          ${chips(reply)}</li>` : ''}
        <li>${L('Action <b>Move Message</b> → <b>Trash</b>. Click <b>OK</b>, then <b>Apply</b> when asked, to clear existing mail.', 'Actie <b>Verplaats bericht</b> → <b>Prullenmand</b>. Klik op <b>OK</b> en dan op <b>Pas toe</b> als daarom wordt gevraagd, om bestaande mail op te ruimen.')}</li>
      </ol>
      ${check(L('open your Junk mailbox, select all (⌘A), then <b>Message</b> → <b>Apply Rules</b> (⌥⌘L).', 'open je map Ongewenst, selecteer alles (⌘A) en kies <b>Bericht</b> → <b>Pas regels toe</b> (⌥⌘L).'))}
      <p class="small muted">${L('Mac rules run while Mail is open.', 'Regels op de Mac werken zolang Mail open is.')}</p>`,
    sieve: `
      <ol class="small">
        <li>${L('Download the Sieve script below.', 'Download hieronder het Sieve-script.')}</li>
        <li>${L('<b>Fastmail:</b> Settings → Filters &amp; Rules → <b>Edit custom Sieve code</b> → paste. <b>Proton:</b> Settings → Filters → <b>Add sieve filter</b> → paste, and change <code>"Junk"</code> to <code>"Spam"</code>.',
               '<b>Fastmail:</b> Settings → Filters &amp; Rules → <b>Edit custom Sieve code</b> → plakken. <b>Proton:</b> Instellingen → Filters → <b>Sieve-filter toevoegen</b> → plakken, en verander <code>"Junk"</code> in <code>"Spam"</code>.')}</li>
      </ol>
      <div class="row"><button class="primary" data-action="dl-block" data-fmt="sieve">${L('Download Sieve script', 'Download Sieve-script')}</button>
      <button data-action="copy-block" data-fmt="sieve">${L('Copy', 'Kopieer')}</button></div>`
  };

  return steps[client] + sharedNote + `
    <p class="small muted" style="margin-top:10px">${L('New variants keep coming: these operations change domains constantly. Scan your junk again in a few weeks and update the rules — the list grows each time. If one address gets little else, see <b>Your addresses</b> on Home.',
      'Er blijven nieuwe varianten komen: deze partijen wisselen voortdurend van domein. Scan over een paar weken je ongewenste mail opnieuw en werk de regels bij — de lijst groeit elke keer. Krijgt één adres weinig anders meer, kijk dan bij <b>Je adressen</b> op Home.')}</p>`;
}

export function blockText(state, fmt) {
  const bl = blockView(state).bl;
  if (fmt === 'gmail') return { text: asGmailXml(bl), name: 'hoopup-filters.xml', type: 'application/xml' };
  if (fmt === 'sieve') return { text: asSieve(bl), name: 'hoopup.sieve', type: 'text/plain' };
  if (fmt === 'reply') return { text: asReplyList(bl), name: 'hoopup-reply-addresses.txt', type: 'text/plain' };
  return { text: asLinkList(bl), name: 'hoopup-link-sites.txt', type: 'text/plain' };
}

export function downloadText({ text, name, type }) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Block-card controls, shared by every page that shows the card.
export function wireBlock(root, state, onChange) {
  const redraw = el => {
    const card = el.closest('.block-card');
    if (card) card.outerHTML = blockAllCard(store.get(), { closable: !!card.dataset.closable });
  };
  root.addEventListener('change', e => {
    if (e.target.id !== 'block-client') return;
    blockClient = e.target.value;
    root.querySelector('#block-panel').innerHTML = blockPanel(blockView(store.get()).bl, blockClient);
  });
  root.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const act = btn.dataset.action;
    if (act === 'dl-block') {
      downloadText(blockText(store.get(), btn.dataset.fmt));
      toast(L('Downloaded — import it, then press Done', 'Gedownload — importeer het en druk dan op Klaar'));
    }
    if (act === 'copy-one') {
      navigator.clipboard.writeText(btn.dataset.value)
        .then(() => { btn.classList.add('copied'); toast(L('Copied — paste it as one entry', 'Gekopieerd — plak het als los item')); })
        .catch(() => toast(L('Could not copy', 'Kopiëren mislukt')));
    }
    if (act === 'copy-block') {
      navigator.clipboard.writeText(blockText(store.get(), btn.dataset.fmt).text)
        .then(() => toast(L('Copied', 'Gekopieerd'))).catch(() => toast(L('Could not copy', 'Kopiëren mislukt')));
    }
    if (act === 'block-done') {
      const ids = store.get().custom.filter(isBlockable).map(t => t.id);
      showAllRules = false;
      store.update(st => { st.blockDone = { at: store.today(), ids }; delete st.blockExport; });
      toast(L('Marked as blocked. Next time, only new rules show up.', 'Gemarkeerd als geblokkeerd. De volgende keer verschijnen alleen nieuwe regels.'));
      if (onChange) onChange(); else redraw(btn);
    }
    if (act === 'block-toggle') { showAllRules = !showAllRules; redraw(btn); }
    if (act === 'block-reset') {
      if (!confirm(L('Forget which rules you added? Next time HoopUp shows the full list again.',
        'Vergeten welke regels je toevoegde? HoopUp toont dan weer de volledige lijst.'))) return;
      showAllRules = false;
      store.update(st => { delete st.blockDone; delete st.blockExport; });
      if (onChange) onChange(); else redraw(btn);
    }
  });
}

export function mountUnsubscribe(root, state, rerender) {
  wireBlock(root, state);
  wireQueue(root);

  root.addEventListener('change', e => {
    const box = e.target.closest('[data-action="sel"]');
    if (!box) return;
    if (box.checked) selected.add(box.dataset.id); else selected.delete(box.dataset.id);
    rerender();
  });

  root.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const act = btn.dataset.action;

    if (act === 'sel-group') {
      const ids = state.custom.filter(b => unsubTier(b) === btn.dataset.group).map(b => b.id);
      const allOn = ids.every(id => selected.has(id));
      ids.forEach(id => allOn ? selected.delete(id) : selected.add(id));
      rerender();
      return;
    }


    const pick = k => state.custom.filter(b => unsubTier(b) === k && selected.has(b.id));
    if (act === 'run-instant') runOneClickBatch(root, pick('instant'), []);
    if (act === 'run-link')    startUnsubQueue(root, pick('link').map(b => ({ name: b.name, unsubUrl: b.unsubUrl })));
  });
}

// ------------------------------------------------------------------- letter

export function letter(state, catalog, params) {
  const targets = allTargets(state, catalog);
  const b = targets.find(x => x.id === params.get('b'));
  if (!b) return `<div class="card"><p>${L('Unknown target.', 'Onbekend bedrijf.')}
    <a href="#/delete">${L('Back to the list', 'Terug naar de lijst')}</a></p></div>`;

  const rec = store.getRequest(b.id);
  const tid = params.get('t') || suggestedTemplate(b, state.profile, rec);
  const { subject, body } = renderLetter(tid, b, state.profile, rec);
  const to = recipient(b, rec);
  const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const tplLabel = (k, t) => L(t.label, TEMPLATE_LABELS_NL[k] || t.label);

  return `
  <div class="head no-print">
    <a class="back" href="#/delete">← ${L('Delete data', 'Gegevens verwijderen')}</a>
    <h1>${esc(nameOf(b))}</h1>
    <p>${L(`Read it before you send it. Delete any clause that does not apply to you — a request you can stand
    behind beats a maximalist one you cannot.`,
    `Lees hem door voor je hem verstuurt. Schrap wat niet op jou van toepassing is — een verzoek waar je achter
    kunt staan werkt beter dan een maximaal verzoek dat je niet kunt onderbouwen.`)}</p>
  </div>

  ${b.method === 'form' && safeUrl(b.optOutUrl) ? `<div class="notice no-print">
    <p>${L(`<strong>This one has a self-serve form.</strong> Use
    <a href="${esc(safeUrl(b.optOutUrl))}" target="_blank" rel="noopener noreferrer">their opt-out page</a> first —
    it is usually faster. Send this letter if the form fails, asks for ID, or nothing happens.`,
    `<strong>Dit bedrijf heeft een eigen formulier.</strong> Probeer eerst
    <a href="${esc(safeUrl(b.optOutUrl))}" target="_blank" rel="noopener noreferrer">hun afmeldpagina</a> —
    dat gaat meestal sneller. Stuur deze brief als het formulier niet werkt, om een ID vraagt of er niets gebeurt.`)}</p>
  </div>` : ''}

  ${letterLang(state.profile) === 'nl' && !writesDutch(b, state.profile) && !params.get('t') ? `<div class="notice no-print">
    <p>${L('This company works outside the Netherlands, so the letter is in English — a Dutch one would likely go unread. Pick a Dutch template below if you prefer.',
      'Dit bedrijf werkt buiten Nederland, dus de brief is in het Engels — een Nederlandse brief wordt daar waarschijnlijk niet gelezen. Kies hieronder een Nederlands sjabloon als je dat liever hebt.')}</p>
  </div>` : ''}

  ${b.confidence === 'low' ? `<div class="notice warn no-print">
    <p>${L(`<strong>Unverified contact.</strong> <code>${esc(to || 'no address on file')}</code> is a guess based on
    their domain. Check their privacy policy for the real DPO address before sending, or it will bounce.`,
    `<strong>Niet gecontroleerd adres.</strong> <code>${esc(to || 'geen adres bekend')}</code> is een gok op basis van
    hun domein. Zoek in hun privacyverklaring het echte adres van de functionaris gegevensbescherming, anders komt de mail terug.`)}</p>
  </div>` : ''}

  <div class="card no-print">
    <div class="row">
      <label for="tpl" style="margin:0">${L('Template', 'Sjabloon')}</label>
      <select id="tpl" class="tpl-select">
        ${Object.entries(TEMPLATES).map(([k, t]) =>
          `<option value="${k}" ${k === tid ? 'selected' : ''}>${esc(tplLabel(k, t))}</option>`).join('')}
      </select>
      <div class="spacer"></div>
      <button data-action="copy">${L('Copy letter', 'Brief kopiëren')}</button>
      ${to ? `<a class="btn" href="${mailto}">${L('Open in mail app', 'Openen in je mailapp')}</a>` : ''}
      <button data-action="print">${L('Print / PDF', 'Afdrukken / PDF')}</button>
      <button class="primary" data-action="mark-sent">${L('Mark as sent', 'Markeer als verstuurd')}</button>
    </div>
  </div>

  <div class="card">
    <p class="small muted no-print">${L('To', 'Aan')}: <code>${esc(to || '—')}</code></p>
    <p class="small"><strong>${L('Subject', 'Onderwerp')}:</strong> ${esc(subject)}</p>
    <div class="letter" id="letter-body" tabindex="0" role="region" aria-label="${L('Letter text', 'Tekst van de brief')}">${esc(body)}</div>
  </div>

  <div class="card no-print">
    <h2>${L('Notes &amp; history', 'Notities &amp; geschiedenis')}</h2>
    <div class="field">
      <label for="notes">${L('Your notes on this company', 'Jouw notities over dit bedrijf')}</label>
      <textarea id="notes" placeholder="${L('Reference number they gave you, who replied, what they claimed…',
        'Kenmerk dat ze gaven, wie er reageerde, wat ze beweerden…')}">${esc(rec.notes || '')}</textarea>
      <button data-action="save-notes" style="margin-top:6px">${L('Save notes', 'Notities opslaan')}</button>
    </div>
    ${rec.history?.length ? `<table>
      <thead><tr><th>${L('When', 'Wanneer')}</th><th>${L('Event', 'Gebeurtenis')}</th></tr></thead>
      <tbody>${rec.history.slice().reverse().map(h =>
        `<tr><td>${esc(h.ts.slice(0, 16).replace('T', ' '))}</td><td>${esc(eventLabel(h.event))}</td></tr>`).join('')}</tbody>
    </table>` : `<p class="small muted">${L('Nothing logged yet.', 'Nog niets vastgelegd.')}</p>`}
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
        toast(L('Letter copied', 'Brief gekopieerd'));
      } catch {
        // Clipboard API needs a secure context; fall back to selecting the text.
        const range = document.createRange();
        range.selectNodeContents(root.querySelector('#letter-body'));
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        toast(L('Selected — press Cmd/Ctrl+C', 'Geselecteerd — druk op Cmd/Ctrl+C'));
      }
    }
    if (a === 'print') window.print();
    if (a === 'mark-sent') {
      store.setStatus(id, 'sent');
      toast(L('Marked as sent — deadline clock started', 'Gemarkeerd als verstuurd — de termijn loopt'));
    }
    if (a === 'save-notes') {
      store.setNotes(id, root.querySelector('#notes').value);
      toast(L('Notes saved', 'Notities opgeslagen'));
    }
  });
}

// -------------------------------------------------------------------- email

export function email(state) {
  const aliases = state.aliases;
  const burned = aliases.filter(a => a.status === 'burned');

  return `
  <div class="head">
    <a class="back" href="#/profile">← ${L('Settings', 'Instellingen')}</a>
    <h1>${L('Aliases', 'Aliassen')}</h1>
    <p>${L(`You cannot block spam that is already addressed to you. You can make your real address worthless to
    leak, by never giving it out again.`,
    `Spam die al naar je adres gaat kun je niet tegenhouden. Je kunt wél zorgen dat een lek van je echte adres
    niets meer oplevert: geef het nooit meer uit.`)}</p>
  </div>

  <div class="card">
    <h2>${L('The system', 'De aanpak')}</h2>
    <ol>${L(`
      <li><strong>Keep your real address private.</strong> It goes to people you know, your bank, and the
      tax office. Nothing else, ever again.</li>
      <li><strong>One alias per company.</strong> On iCloud+ this is Hide My Email, built into Safari and
      Mail — unlimited, free with any paid iCloud plan. Fastmail, Proton, addy.io, SimpleLogin and
      DuckDuckGo Email Protection all do the same.</li>
      <li><strong>When an alias starts getting spam, you know who leaked it.</strong> Log it below, then
      delete the alias. The spam stops instantly, at the source, with no filter to maintain.</li>
      <li><strong>Avoid plus-addressing</strong> (<code>you+shop@…</code>) for this. It is trivially stripped
      back to your real address, so it identifies the leaker but does not protect you.</li>`, `
      <li><strong>Houd je echte adres privé.</strong> Dat krijgen mensen die je kent, je bank en de
      Belastingdienst. Verder niemand meer.</li>
      <li><strong>Eén alias per bedrijf.</strong> Bij iCloud+ heet dit 'Verberg mijn e-mailadres', ingebouwd in
      Safari en Mail — onbeperkt, gratis bij elk betaald iCloud-abonnement. Fastmail, Proton, addy.io,
      SimpleLogin en DuckDuckGo Email Protection doen hetzelfde.</li>
      <li><strong>Krijgt een alias spam, dan weet je wie hem heeft gelekt.</strong> Leg het hieronder vast en
      verwijder de alias. De spam stopt direct, bij de bron, zonder filter dat je moet bijhouden.</li>
      <li><strong>Gebruik hiervoor geen plus-adressen</strong> (<code>jij+winkel@…</code>). Het deel na de +
      is zo weggehaald, dus je ziet wel wie lekte maar je bent niet beschermd.</li>`)}
    </ol>
    <p class="small muted">${L(`Why this beats filtering: a filter fights every new sender forever. Deleting an
    alias ends that stream permanently, and the address cannot be re-sold because it no longer exists.`,
    `Waarom dit beter werkt dan filteren: een filter vecht eindeloos tegen elke nieuwe afzender. Een alias
    verwijderen stopt die stroom voorgoed, en het adres kan niet opnieuw verkocht worden omdat het niet meer bestaat.`)}</p>
  </div>

  <div class="card">
    <h2>${L('Handling what is already arriving', 'Wat er nu al binnenkomt')}</h2>
    <ul class="small">${L(`
      <li><strong>Legitimate marketing you once signed up for</strong> — use the unsubscribe link. In the EU
      they must honour it, and you can cite Art. 21(3) GDPR if they do not.</li>
      <li><strong>Criminal spam and phishing</strong> — never click unsubscribe. It confirms a live human
      reads the mailbox and raises your value on the lists. Report as junk and delete.</li>
      <li><strong>Spam to an address you never gave out</strong> — it came from a breach or a broker. See
      <a href="#/find">who has your data</a>.</li>
      <li><strong>Extortion mail quoting a real password</strong> — it is from a breach dump, not a hacked
      camera. Change that password everywhere, ignore the rest.</li>
      <li><strong>Turn off remote images</strong> in Mail. Tracking pixels confirm you opened it.</li>`, `
      <li><strong>Echte nieuwsbrieven waar je je ooit voor aanmeldde</strong> — gebruik de afmeldlink. In de EU
      moeten ze die honoreren; doen ze dat niet, verwijs dan naar art. 21 lid 3 AVG.</li>
      <li><strong>Criminele spam en phishing</strong> — klik nooit op afmelden. Dat bevestigt dat er een mens
      meeleest en maakt je adres meer waard. Markeer als ongewenst en verwijder.</li>
      <li><strong>Spam naar een adres dat je nooit uitgaf</strong> — dat komt uit een datalek of van een
      databroker. Bekijk <a href="#/find">wie je gegevens heeft</a>.</li>
      <li><strong>Afpersingsmail met een echt wachtwoord</strong> — dat komt uit een gelekte database, niet van
      een gehackte camera. Wijzig dat wachtwoord overal en negeer de rest.</li>
      <li><strong>Zet externe afbeeldingen uit</strong> in Mail. Trackingpixels verraden dat je de mail opende.</li>`)}
    </ul>
  </div>

  <div class="card">
    <h2>${L('Alias tracker', 'Alias-logboek')} <span class="muted small">${aliases.length} ${L('tracked', 'vastgelegd')}${
      burned.length ? `, ${burned.length} ${L('burned', 'verbrand')}` : ''}</span></h2>
    <p class="small muted">${L(`Log which alias you gave to which company. When spam turns up, this tells you who
    sold or leaked it — and that company becomes a target for an erasure request.`,
    `Leg vast welke alias je aan welk bedrijf gaf. Komt er spam op binnen, dan weet je wie hem verkocht of
    lekte — en dat bedrijf krijgt een verwijderverzoek.`)}</p>
    <div class="row">
      <input id="al-alias" placeholder="alias@icloud.com" style="flex:1;min-width:180px">
      <input id="al-service" placeholder="${L('Company it was given to', 'Bedrijf dat hem kreeg')}" style="flex:1;min-width:160px">
      <button class="primary" data-action="add-alias">${L('Add', 'Toevoegen')}</button>
    </div>
    ${aliases.length ? `<div style="margin-top:12px">${aliases.map(a => `
      <div class="item">
        <div class="body">
          <div class="name mono">${esc(a.alias)}
            ${a.status === 'burned' ? `<span class="pill overdue">${L('burned', 'verbrand')}</span>` : ''}
            ${a.spamSeen ? `<span class="pill escalated">${a.spamSeen} spam</span>` : ''}</div>
          <div class="meta">${L('given to', 'gegeven aan')} ${esc(a.service || '—')} · ${esc(a.createdAt)}</div>
        </div>
        <div class="actions">
          <button data-action="spam" data-id="${esc(a.id)}">${L('Got spam', 'Spam ontvangen')}</button>
          <button data-action="burn" data-id="${esc(a.id)}">${a.status === 'burned'
            ? L('Restore', 'Herstellen') : L('Mark burned', 'Markeer als verbrand')}</button>
          <button class="danger" data-action="del-alias" data-id="${esc(a.id)}">${L('Delete', 'Verwijderen')}</button>
        </div>
      </div>`).join('')}</div>` : `<p class="small muted" style="margin-top:12px">${L('Nothing logged yet.', 'Nog niets vastgelegd.')}</p>`}
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
      toast(L('Alias logged', 'Alias vastgelegd'));
    }
    if (a === 'spam') {
      store.update(s => { const al = s.aliases.find(x => x.id === id); if (al) al.spamSeen = (al.spamSeen || 0) + 1; });
      toast(L('Logged. If this keeps up, burn the alias and target that company.',
        'Vastgelegd. Blijft het komen, verbrand dan de alias en stuur dat bedrijf een verzoek.'));
    }
    if (a === 'burn') {
      store.update(s => { const al = s.aliases.find(x => x.id === id); if (al) al.status = al.status === 'burned' ? 'active' : 'burned'; });
    }
    if (a === 'del-alias') {
      if (!confirm(L('Remove this alias from the tracker? (It does not delete the alias at your mail provider.)',
        'Deze alias uit het logboek halen? (De alias bij je mailprovider blijft bestaan.)'))) return;
      store.update(s => { s.aliases = s.aliases.filter(x => x.id !== id); });
    }
  });
}

// ------------------------------------------------------------------ profile

export function profile(state) {
  const p = state.profile;
  return `
  <div class="head">
    <h1>${L('Settings', 'Instellingen')}</h1>
    <p>${L(`These fill in the letters. A request without enough detail to identify you is one a company can
    legitimately refuse, so this is worth filling in properly.`,
    `Hiermee worden de brieven ingevuld. Een verzoek waaruit niet blijkt wie je bent mag een bedrijf weigeren,
    dus vul dit zorgvuldig in.`)}</p>
  </div>

  <div class="card">
    <h2>${L('Tools', 'Hulpmiddelen')}</h2>
    <div class="tool-links">
      <a href="#/aliases"><b>${L('Aliases', 'Aliassen')}</b><span>${L('One address per company, and a log of who leaked which',
        'Eén adres per bedrijf, en een logboek van wie welk adres lekte')}</span></a>
      <a href="#/unsubscribe"><b>${L('Unsubscribe &amp; block, in detail', 'Uitschrijven &amp; blokkeren in detail')}</b><span>${L(
        'Every sender, grouped, with per-client block files', 'Alle afzenders, gegroepeerd, met blokkeerbestanden per mailprogramma')}</span></a>
      <a href="#/find"><b>${L('More ways to find who has your data', 'Meer manieren om te zien wie je gegevens heeft')}</b><span>${L(
        'Mailbox searches, breach records, data brokers, password check', 'Zoeken in je mailbox, datalekken, databrokers, wachtwoordcheck')}</span></a>
    </div>
  </div>

  <div class="notice">
    <p>${L(`Stored in this browser only, under <code>localStorage</code>. It is not encrypted — anyone with access
    to your unlocked computer and this browser profile can read it. Clearing site data wipes it, so keep a
    backup below.`,
    `Alleen opgeslagen in deze browser, in <code>localStorage</code>. Niet versleuteld — wie bij je ontgrendelde
    computer en dit browserprofiel kan, kan het lezen. Websitegegevens wissen haalt het weg, dus maak hieronder
    een back-up.`)}</p>
  </div>

  <div class="card">
    <div class="grid cols-2">
      <div class="field"><label for="fullName">${L('Full legal name', 'Volledige naam')}</label>
        <input id="fullName" value="${esc(p.fullName)}" placeholder="${L('As companies would have it', 'Zoals bedrijven hem kennen')}"></div>
      <div class="field"><label for="birthDate">${L('Date of birth', 'Geboortedatum')}</label>
        <input id="birthDate" type="date" value="${esc(p.birthDate)}"></div>
      <div class="field"><label for="country">${L('Country', 'Land')}</label>
        <select id="country">
          ${['NL', 'BE', 'DE', 'FR', 'ES', 'IT', 'IE', 'UK', 'US', 'other'].map(c =>
            `<option value="${c}" ${p.country === c ? 'selected' : ''}>${c === 'other' ? L('other', 'anders') : c}</option>`).join('')}
        </select></div>
      <div class="field"><label for="language">${L('Letter language', 'Taal van de brieven')}</label>
        <select id="language">
          <option value="auto" ${!['en', 'nl'].includes(p.letterLanguage) ? 'selected' : ''}>${L('Same as the app (English)', 'Zelfde als de app (Nederlands)')}</option>
          <option value="en" ${p.letterLanguage === 'en' ? 'selected' : ''}>${L('Always English', 'Altijd Engels')}</option>
          <option value="nl" ${p.letterLanguage === 'nl' ? 'selected' : ''}>${L('Always Dutch', 'Altijd Nederlands')}</option>
        </select></div>
    </div>
    <div class="field"><label for="emails">${L('Email addresses (one per line)', 'E-mailadressen (één per regel)')}</label>
      <textarea id="emails" style="min-height:80px" placeholder="${L('Every address you have used to sign up anywhere',
        'Elk adres waarmee je je ooit ergens hebt aangemeld')}">${esc(p.emails.join('\n'))}</textarea></div>
    <div class="field"><label for="phones">${L('Phone numbers (one per line)', 'Telefoonnummers (één per regel)')}</label>
      <textarea id="phones" style="min-height:60px">${esc(p.phones.join('\n'))}</textarea></div>
    <div class="field"><label for="addresses">${L('Postal address', 'Postadres')}</label>
      <textarea id="addresses" style="min-height:70px">${esc(p.addresses)}</textarea></div>
    <button class="primary" data-action="save-profile">${L('Save', 'Opslaan')}</button>
  </div>

  <div class="card">
    <h2>${L('Breach database API key', 'API-sleutel voor de datalekdatabase')} <span class="muted small">${L('optional', 'optioneel')}</span></h2>
    <p class="small muted">${L(`You almost certainly do not need this. Checking your address is free on
    their website — see <a href="#/find">who has your data</a>. A key only buys you the same answer listed
    inside this app instead of on their site.`,
    `Dit heb je vrijwel zeker niet nodig. Je adres controleren is gratis op hun website — zie
    <a href="#/find">wie je gegevens heeft</a>. Met een sleutel krijg je hetzelfde antwoord, alleen in deze app
    in plaats van op hun site.`)}</p>
    <div class="row">
      <input id="hibpKey" type="password" value="${esc(state.hibpKey)}" placeholder="hibp-api-key" style="flex:1;min-width:200px">
      <button data-action="save-key">${L('Save key', 'Sleutel opslaan')}</button>
    </div>
  </div>

  <div class="card">
    <h2>${L('Backup', 'Back-up')}</h2>
    <div class="row">
      <button data-action="export">${L('Export JSON', 'JSON exporteren')}</button>
      <button data-action="import">${L('Import JSON', 'JSON importeren')}</button>
      <div class="spacer"></div>
      <button class="danger" data-action="wipe">${L('Erase everything', 'Alles wissen')}</button>
    </div>
    <p class="small muted" style="margin-top:8px">${L(`Export before you clear browser data, switch machines, or
    reinstall. The file contains everything above in plain text — keep it somewhere sensible.`,
    `Exporteer voordat je browsergegevens wist, van computer wisselt of opnieuw installeert. Het bestand bevat
    alles hierboven als leesbare tekst — bewaar het op een veilige plek.`)}</p>
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
          letterLanguage: val('language'),
          emails: lines('emails'),
          phones: lines('phones'),
          addresses: val('addresses').trim()
        };
      });
      toast(L('Saved', 'Opgeslagen'));
    }

    if (a === 'save-key') {
      store.update(s => { s.hibpKey = val('hibpKey').trim(); });
      toast(L('Key saved in this browser', 'Sleutel opgeslagen in deze browser'));
    }

    if (a === 'export') {
      const blob = new Blob([store.exportJSON()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `hoopup-backup-${store.today()}.json`;
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
        if (!confirm(L('Importing replaces everything currently stored here. Continue?',
          'Importeren vervangt alles wat hier nu staat. Doorgaan?'))) return;
        try {
          store.importJSON(await file.text());
          toast(L('Backup restored', 'Back-up teruggezet'));
        } catch (err) {
          alert(L('Could not import: ', 'Importeren mislukt: ') + err.message);
        }
      };
      input.click();
    }

    if (a === 'wipe') {
      if (!confirm(L('Erase your profile, all request tracking and all aliases from this browser? This cannot be undone.',
        'Je profiel, alle verzoeken en alle aliassen uit deze browser wissen? Dit kan niet ongedaan worden.'))) return;
      if (!confirm(L('Really erase everything? Export a backup first if you might want it back.',
        'Echt alles wissen? Exporteer eerst een back-up als je het misschien terug wilt.'))) return;
      store.reset();
      toast(L('Everything erased', 'Alles gewist'));
    }
  });
}

// -------------------------------------------------------------------- about

const REPO = 'https://github.com/fransiewillem-design/Data-protection-';
// The address for privacy questions. Empty until the maintainer sets one; the
// page then falls back to GitHub, with a warning not to post personal details.
const CONTACT_EMAIL = 'hello@hoopup.tech';
const UPDATED = { en: '10 October 2026', nl: '10 oktober 2026' };

// The statement names whichever host is actually serving this copy, so it
// stays true before and after the move to the own domain.
const HOSTS = {
  github: { name: 'GitHub Pages', short: 'GitHub', where: 'GitHub Inc., USA', whereNL: 'GitHub Inc., VS',
            policy: 'https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement' },
  cloudflare: { name: 'Cloudflare Pages', short: 'Cloudflare', where: 'Cloudflare Inc., USA, served from data centres near you', whereNL: 'Cloudflare Inc., VS, geleverd vanuit datacenters bij jou in de buurt',
                policy: 'https://www.cloudflare.com/privacypolicy/' }
};
const currentHost = () => HOSTS[location.hostname.endsWith('github.io') ? 'github' : 'cloudflare'];

export function about() {
  const host = currentHost();
  const ext = (href, text) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  const contact = CONTACT_EMAIL
    ? `<a href="mailto:${esc(CONTACT_EMAIL)}">${esc(CONTACT_EMAIL)}</a>`
    : L(`${ext(REPO + '/issues', 'GitHub')} (public — never post personal details there)`,
        `${ext(REPO + '/issues', 'GitHub')} (openbaar — zet daar nooit persoonsgegevens neer)`);
  const sec = (title, body) => `<section class="card legal"><h2>${title}</h2>${body}</section>`;

  return `
  <div class="head">
    <h1>${L('About &amp; privacy', 'Over &amp; privacy')}</h1>
    <p>${L('HoopUp — from the Dutch <i>hoepel op!</i>, "get lost" — tells spammers, scammers and data brokers to leave you alone: off their mailing lists, out of their files, and without handing your data to yet another company.',
      'HoopUp — van <i>hoepel op!</i> — zegt spammers, oplichters en databrokers dat ze je met rust moeten laten: van hun mailinglijsten af, uit hun bestanden, en zonder je gegevens aan nóg een bedrijf te geven.')}</p>
  </div>

  ${sec(L('What it does', 'Wat het doet'), `<ul>${L(`
      <li><b>Unsubscribe</b> from real companies, in one go where they support it.</li>
      <li><b>Block scams</b> — and other unsafe mail such as gambling spam, never a real company.</li>
      <li><b>Delete your data</b>: letters under the GDPR, sent from your own mail app, with reminders and a complaint to the regulator when a company ignores you.</li>
      <li><b>Advise on your addresses</b>: which one gets mostly spam, and whether to keep or retire it.</li>`, `
      <li><b>Uitschrijven</b> bij echte bedrijven, in één keer waar ze dat ondersteunen.</li>
      <li><b>Oplichters blokkeren</b> — en andere onveilige mail zoals gokspam, nooit een echt bedrijf.</li>
      <li><b>Je gegevens laten wissen</b>: brieven op grond van de AVG, verstuurd vanuit je eigen mailapp, met herinneringen en een klacht bij de toezichthouder als een bedrijf je negeert.</li>
      <li><b>Advies over je adressen</b>: welk adres vooral spam krijgt, en of je het houdt of opheft.</li>`)}</ul>`)}

  <h2 class="legal-title" id="privacy">${L('Privacy statement', 'Privacyverklaring')}</h2>
  <p class="small muted">${L(`Last updated ${UPDATED.en}.`, `Laatst bijgewerkt op ${UPDATED.nl}.`)}</p>

  ${sec(L('Who we are', 'Wie we zijn'), `<p>${L(
    `HoopUp is a free, non-commercial project by <b>fransiewillem</b>. Questions about privacy, or a request under the GDPR: ${contact}.`,
    `HoopUp is een gratis, niet-commercieel project van <b>fransiewillem</b>. Vragen over privacy, of een verzoek op grond van de AVG: ${contact}.`)}</p>`)}

  ${sec(L('In short', 'In het kort'), `<p>${L(
    'We have no server, no accounts, no analytics, no tracking cookies and no third-party scripts. Nothing you enter in HoopUp, and no mail you drop into it, is ever sent to us. We cannot see it, so we cannot lose it, sell it or hand it over.',
    'We hebben geen server, geen accounts, geen statistieken, geen trackingcookies en geen scripts van derden. Niets wat je in HoopUp invult, en geen mail die je erin sleept, wordt ooit naar ons gestuurd. We kunnen het niet zien, dus we kunnen het ook niet kwijtraken, verkopen of afgeven.')}</p>`)}

  ${sec(L('What stays on your own device', 'Wat op je eigen apparaat blijft'), `
    <p>${L('Everything below is processed in your browser and stored there only (localStorage). It never leaves your device unless you choose to send a letter or export a backup.',
      'Alles hieronder wordt in je browser verwerkt en alleen daar opgeslagen (localStorage). Het verlaat je apparaat niet, tenzij je zelf een brief verstuurt of een back-up exporteert.')}</p>
    <ul>${L(`
      <li>The details you fill in under Settings: name, date of birth, email addresses, phone numbers and postal address. They are only used to fill in your letters.</li>
      <li>From mail you drop in: per sender only the name, domain, link domains, unsubscribe address and whether it passed the sender check. Subjects and message text are read to find unsubscribe links, and are not kept.</li>
      <li>Your progress: which companies you wrote to and when, notes, aliases, your language choice, and a breach-database API key if you add one.</li>`, `
      <li>De gegevens die je bij Instellingen invult: naam, geboortedatum, e-mailadressen, telefoonnummers en postadres. Ze worden alleen gebruikt om je brieven in te vullen.</li>
      <li>Uit mail die je erin sleept: per afzender alleen de naam, het domein, de linkdomeinen, het uitschrijfadres en of de afzendercontrole slaagde. Onderwerpen en berichttekst worden gelezen om uitschrijflinks te vinden, en niet bewaard.</li>
      <li>Je voortgang: welke bedrijven je wanneer aanschreef, notities, aliassen, je taalkeuze en een API-sleutel voor de datalekdatabase als je die toevoegt.</li>`)}</ul>
    <p>${L('This storage is not encrypted: use a device and browser profile only you use. You remove it all with <a href="#/profile">Settings</a> → Erase everything, or by clearing this site\'s data in your browser. Because it is strictly necessary for the service you ask for, and contains nothing used to track you, no cookie consent is needed for it.',
      'Deze opslag is niet versleuteld: gebruik een apparaat en browserprofiel dat alleen jij gebruikt. Je wist alles via <a href="#/profile">Instellingen</a> → Alles wissen, of door de websitegegevens van deze site in je browser te wissen. Omdat de opslag strikt noodzakelijk is voor de dienst die je vraagt, en niets bevat waarmee je gevolgd wordt, is er geen cookietoestemming voor nodig.')}</p>`)}

  ${sec(L('When something does leave your device', 'Wanneer er wél iets je apparaat verlaat'), `
    <p>${L('Only in these cases, and only when you choose to. The data then goes straight from your browser to the party named; it does not pass through us.',
      'Alleen in deze gevallen, en alleen als jij dat kiest. De gegevens gaan dan rechtstreeks van je browser naar de genoemde partij; ze komen niet langs ons.')}</p>
    <ul>${L(`
      <li><b>Visiting the site.</b> The site is hosted by ${host.name} (${host.where}). Like every web host, ${host.short} receives your IP address and the files your browser loads, and may log these for security. See the ${ext(host.policy, `${host.short} privacy policy`)}; ${host.short} participates in the EU–US Data Privacy Framework.</li>
      <li><b>Breach and password check.</b> When you use it, your browser contacts ${ext('https://haveibeenpwned.com/Privacy', 'Have I Been Pwned')} (Australia). The breach list carries nothing about you. A password check sends only the first 5 characters of a scrambled hash of the password, never the password itself. Only if you add your own API key and check an address is that email address sent to Have I Been Pwned.</li>
      <li><b>One-click unsubscribe.</b> Your browser sends the unsubscribe request to the address the sender published. That sender already has your email address; it also sees your IP address. No cookies or other details are sent.</li>
      <li><b>Opening a link</b> (an unsubscribe page, an opt-out form, the regulator's website) works like any link: that website sees your visit. This site never sends it where you came from.</li>
      <li><b>Letters</b> open in your own mail app and are sent by you, through your own mail provider.</li>`, `
      <li><b>Het bezoeken van de site.</b> De site wordt gehost door ${host.name} (${host.whereNL}). Zoals elke webhost ontvangt ${host.short} je IP-adres en de bestanden die je browser laadt, en kan die voor beveiliging vastleggen. Zie de ${ext(host.policy, `privacyverklaring van ${host.short}`)}; ${host.short} neemt deel aan het EU-VS Data Privacy Framework.</li>
      <li><b>Datalek- en wachtwoordcheck.</b> Als je die gebruikt, maakt je browser contact met ${ext('https://haveibeenpwned.com/Privacy', 'Have I Been Pwned')} (Australië). De lijst met datalekken bevat niets over jou. Een wachtwoordcheck stuurt alleen de eerste 5 tekens van een versleutelde hash van het wachtwoord, nooit het wachtwoord zelf. Alleen als je een eigen API-sleutel toevoegt en een adres controleert, wordt dat e-mailadres naar Have I Been Pwned gestuurd.</li>
      <li><b>Uitschrijven met één klik.</b> Je browser stuurt het uitschrijfverzoek naar het adres dat de afzender opgaf. Die afzender heeft je e-mailadres al; hij ziet ook je IP-adres. Er worden geen cookies of andere gegevens meegestuurd.</li>
      <li><b>Een link openen</b> (een uitschrijfpagina, een afmeldformulier, de website van de toezichthouder) werkt zoals elke link: die website ziet je bezoek. Deze site stuurt niet mee waar je vandaan kwam.</li>
      <li><b>Brieven</b> openen in je eigen mailapp en worden door jou verstuurd, via je eigen mailprovider.</li>`)}</ul>`)}

  ${sec(L('Sharing, sale and legal requests', 'Delen, verkoop en vorderingen'), `<p>${L(
    'We do not share or sell anything, because we receive nothing. For the same reason there is nothing we could hand over if asked to.',
    'We delen of verkopen niets, omdat we niets ontvangen. Om dezelfde reden is er niets dat we kunnen afgeven als iemand daarom vraagt.')}</p>`)}

  ${sec(L('Your rights', 'Je rechten'), `<p>${L(
    `Under the GDPR you have the right to access, correct and erase your personal data, among others. Everything HoopUp stores is already in your own hands: you can view, change and erase it yourself in the app. For anything else, contact us at ${contact}. You can also lodge a complaint with the ${ext('https://autoriteitpersoonsgegevens.nl', 'Autoriteit Persoonsgegevens')}, the Dutch data protection authority.`,
    `Op grond van de AVG heb je onder meer recht op inzage, correctie en verwijdering van je persoonsgegevens. Alles wat HoopUp opslaat, heb je al zelf in handen: je kunt het in de app bekijken, aanpassen en wissen. Voor al het andere kun je contact opnemen via ${contact}. Je kunt ook een klacht indienen bij de ${ext('https://autoriteitpersoonsgegevens.nl', 'Autoriteit Persoonsgegevens')}.`)}</p>`)}

  ${sec(L('Changes', 'Wijzigingen'), `<p>${L(
    'If this statement changes, the date at the top changes with it. Any change that sends more data anywhere will be announced on this page first, and you can always check the source code.',
    'Als deze verklaring verandert, verandert de datum bovenaan mee. Een wijziging waardoor er meer gegevens ergens heen gaan, kondigen we eerst op deze pagina aan, en je kunt altijd de broncode nakijken.')}</p>`)}

  <h2 class="legal-title" id="terms">${L('Terms of use', 'Gebruiksvoorwaarden')}</h2>
  ${sec(L('Using HoopUp', 'HoopUp gebruiken'), `<ul>${L(`
    <li>HoopUp is free and provided as is, without any guarantee. It is practical guidance, not legal advice.</li>
    <li>You send every letter and unsubscribe yourself, and you are responsible for what you send. Read each letter before you send it.</li>
    <li>Use it for your own data. Writing on behalf of someone else needs their permission.</li>
    <li>Company contact details may be outdated or guessed; the app marks guessed ones. We cannot see whether a company really erased your data — the app tracks deadlines so you can hold them to it.</li>
    <li>HoopUp is open source under the MIT licence: ${ext(REPO, 'source code')}.</li>`, `
    <li>HoopUp is gratis en wordt geleverd zoals het is, zonder enige garantie. Het is praktische uitleg, geen juridisch advies.</li>
    <li>Je verstuurt elke brief en elke uitschrijving zelf, en je bent verantwoordelijk voor wat je verstuurt. Lees elke brief voordat je hem verstuurt.</li>
    <li>Gebruik het voor je eigen gegevens. Namens iemand anders schrijven mag alleen met diens toestemming.</li>
    <li>Contactgegevens van bedrijven kunnen verouderd of gegokt zijn; de app markeert gegokte adressen. We kunnen niet zien of een bedrijf je gegevens echt heeft gewist — de app houdt de termijnen bij zodat je ze eraan kunt houden.</li>
    <li>HoopUp is open source onder de MIT-licentie: ${ext(REPO, 'broncode')}.</li>`)}</ul>`)}`;
}
