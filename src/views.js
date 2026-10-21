import * as store from './store.js';
import {
  TEMPLATES, TEMPLATE_LABELS_NL, render as renderLetter, suggestedTemplate,
  templateFor, relationOf, RELATION_ORDER, writesDutch, letterLang, evidenceLines,
  keptMailing, lastAnswer, REPLY_FOR, PUSHBACK, longDate
} from './letters.js';
import { matchAnswers, ownedAddresses } from './replies.js';
import { readMailFiles, filesFromDrop } from './mailfile.js';
import { icsFor, upcoming } from './calendar.js';
import { csvLog } from './log.js';
import { outlookAvailable, outlookStart, outlookFinish } from './outlook.js';
import { allBreaches, breachesForAccount, pwnedPasswordCount } from './hibp.js';
import { L, plural, lang } from './i18n.js';
import { buildBlockList, asLinkList, asReplyList, asGmailXml, asGmailQueries, asSieve, asAppleScript, asPowerShell } from './blocklist.js';
import { isPersonalDomain, cleanHost, nameMatchesDomain, groupBySender, registrableDomain } from './mailscan.js';
import { contactFor, CHECKED, lookupAvailable, lookupContact } from './contacts.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// esc() stops an attribute breakout but not a `javascript:` payload, and broker
// entries can arrive from an imported backup file. Only ever emit http(s) hrefs:
// a script URL here would run with access to everything in localStorage.
export function safeUrl(u) {
  // An empty value is no link at all, not "this page".
  if (!String(u ?? '').trim()) return '';
  try {
    const parsed = new URL(String(u ?? ''), location.href);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

// Link shorteners hide where a link really goes.
const SHORTENERS = /^(bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly|rebrand\.ly|cutt\.ly|shorturl\.at|rb\.gy|t\.ly|tiny\.cc|s\.id)$/i;

// An unsubscribe link HoopUp is willing to use: https (RFC 8058 requires it
// for one-click), a real domain name rather than a bare IP address, no
// shortener, and no login details smuggled into the address. Anything else is
// not opened or requested at all.
export function safeUnsubUrl(u) {
  try {
    const p = new URL(String(u ?? ''));
    if (p.protocol !== 'https:' || p.username || p.password) return '';
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(p.hostname) || SHORTENERS.test(p.hostname)) return '';
    return p.href;
  } catch {
    return '';
  }
}

// An unsubscribe by email (List-Unsubscribe: <mailto:…>): one address on a
// real domain, and at most a subject and a body. Any cc or bcc is dropped, so
// the user's mail goes nowhere but the sender's own unsubscribe address.
export function safeUnsubMailto(u) {
  const m = /^mailto:([^?#]+)(\?[^#]*)?$/i.exec(String(u ?? '').trim());
  if (!m) return '';
  let to;
  try { to = decodeURIComponent(m[1]).trim(); } catch { return ''; }
  if (!/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(to)) return '';
  const q = new URLSearchParams((m[2] || '').slice(1).replace(/\+/g, '%2B'));
  const keep = [];
  for (const k of ['subject', 'body']) {
    const v = [...q].find(([key]) => key.toLowerCase() === k)?.[1];
    if (v) keep.push(`${k}=${encodeURIComponent(v.replace(/[\r\n]+/g, ' ').slice(0, 300))}`);
  }
  if (!keep.length) keep.push('subject=unsubscribe');
  return `mailto:${encodeURIComponent(to)}?${keep.join('&')}`;
}

export function toast(msg) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  // Long enough to read: a sentence takes longer than a word.
  setTimeout(() => el.remove(), Math.min(16000, Math.max(2600, msg.length * 55)));
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
const EVENT_NL = { 'Reminder sent': 'Herinnering verstuurd', 'Reply sent': 'Antwoord verstuurd',
  'Answer: erased': 'Antwoord: gewist', 'Answer: erased, some kept by law': 'Antwoord: gewist, een deel wettelijk bewaard',
  'Answer: holds nothing': 'Antwoord: heeft niets van je', 'Answer: refused': 'Antwoord: geweigerd',
  'Answer: wants an ID copy': 'Antwoord: wil een kopie ID', 'Answer: wants their form': 'Antwoord: wil hun formulier',
  'Answer: must keep some by law': 'Antwoord: moet iets wettelijk bewaren', 'Answer: takes two more months': 'Antwoord: neemt twee maanden extra',
  'Answer: received': 'Antwoord: ontvangen', 'Answer received': 'Antwoord ontvangen' };
const eventText = ev => ev.startsWith('Bounced: ') ? L(ev, 'Kwam terug: ' + ev.slice(9)) : ev;
const eventLabel = ev => {
  const k = Object.keys(store.STATUSES).find(k => store.STATUSES[k].label === ev);
  return k ? statusLabel(k) : EVENT_NL[ev] ? L(ev, EVENT_NL[ev]) : eventText(ev);
};
export const statusLabel = k => L(store.STATUSES[k]?.label || k, STATUS_NL[k] || k);

export function allTargets(state, catalog) {
  return [...catalog, ...state.custom];
}

// ---------------------------------------------------------------- dashboard

export function exposure(state) {
  // Only what was added on this page. Senders from scanned mail live on the
  // Delete page, which keeps scams and unverifiable senders out of the letters;
  // listing them here with a Letter button would undo that.
  const added = state.custom.filter(c => c.source !== 'mail');

  const QUERIES = [
    ['"privacy policy" update', '"privacybeleid" wijziging',
     L('The highest-yield search there is. A company changing its privacy policy usually emails everyone whose data it holds, so every hit is a company holding yours, including ones you forgot years ago.',
       'De zoekopdracht die het meest oplevert. Een bedrijf dat zijn privacybeleid wijzigt, mailt dat meestal naar iedereen van wie het gegevens heeft, dus elke treffer is een bedrijf dat jouw gegevens heeft, ook bedrijven die je allang vergeten was.')],
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
    <p class="small muted">${L('No export needed. Run these searches in your mail app and add what you find by hand.',
      'Geen export nodig. Voer deze zoekopdrachten uit in je mailapp en voeg toe wat je vindt.')}</p>
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
      <input autocomplete="off" id="ph-number" placeholder="+31 6 12345678" style="flex:1;min-width:150px">
      <input autocomplete="off" id="ph-domain" placeholder="${L('domain from the text (optional)', 'domein uit de sms (optioneel)')}" style="flex:1;min-width:170px">
      <button data-action="add-phone">${L('Add', 'Toevoegen')}</button>
    </div>

    <p class="small" style="margin-top:14px"><strong>${L('Add a company by hand:', 'Voeg zelf een bedrijf toe:')}</strong></p>
    <div class="row">
      <input autocomplete="off" id="qa-company" placeholder="${L('Company name', 'Bedrijfsnaam')}" style="flex:1;min-width:160px">
      <input autocomplete="off" id="qa-domain" placeholder="${L('their-domain.com (optional)', 'hun-domein.nl (optioneel)')}" style="flex:1;min-width:160px">
      <button class="primary" data-action="quick-add">${L('Add &amp; write letter', 'Toevoegen &amp; brief schrijven')}</button>
    </div>
    <div id="qa-added" style="margin-top:10px">
      ${added.length ? `<p class="small muted">${L(`Added here (${added.length}):`, `Hier toegevoegd (${added.length}):`)}</p>` + added.map(c => `
        <div class="item">
          <div class="body"><div class="name">${esc(nameOf(c))}</div></div>
          <div class="actions"><a class="btn" href="#/letter?b=${encodeURIComponent(c.id)}">${L('Letter', 'Brief')}</a></div>
        </div>`).join('') : ''}
    </div>
  </div>

  <div class="card">
    <h2>${L('Data brokers: assume they already have you', 'Databrokers: ga ervan uit dat ze je al hebben')}</h2>
    <p class="small muted">${L('These never emailed you and never will. They buy, merge and resell personal data on almost every adult in Europe, so there is nothing to discover: assume you are in their files and make them prove otherwise. 37 are bundled, each with its opt-out page and a letter.',
      'Deze hebben je nooit gemaild en zullen dat ook niet doen. Ze kopen, koppelen en verkopen persoonsgegevens van bijna elke volwassene in Europa, dus er valt niets te ontdekken: ga ervan uit dat je in hun bestanden staat en laat ze het tegendeel bewijzen. Er zitten er 37 in de app, elk met afmeldpagina en brief.')}</p>
    <div class="row">
      <a class="btn primary" href="#/delete?all=1">${L('Show the data brokers →', 'Toon de databrokers →')}</a>
    </div>
  </div>

  <div class="card">
    <h2>${L('Public breach records', 'Openbare datalekken')}</h2>
    <p class="small muted">${L('Companies that lost your data to attackers. Free to check: the breach database charges only for automated lookups, never for searching your own address on their site.',
      'Bedrijven die jouw gegevens bij een hack zijn kwijtgeraakt. Gratis te controleren: de lekdatabase vraagt alleen geld voor geautomatiseerd opzoeken, nooit voor het zoeken naar je eigen adres op hun site.')}</p>

    ${state.profile.emails.length ? `
      ${state.profile.emails.map(e => `
        <div class="item">
          <div class="body"><div class="name mono">${esc(e)}</div></div>
          <div class="actions">
            <button data-action="hibp-open" data-email="${esc(e)}">${L('Copy &amp; check ↗', 'Kopieer &amp; controleer ↗')}</button>
          </div>
        </div>`).join('')}
      <p class="small muted" style="margin-top:10px">${L('Copies the address and opens the database. Paste it into their search box.',
        'Kopieert het adres en opent de database. Plak het in hun zoekvak.')}</p>
    ` : `<p class="small muted">${L('Add your email addresses in <a href="#/profile">Settings</a> first, then check each one here.',
        'Voeg eerst je e-mailadressen toe bij <a href="#/profile">Instellingen</a>, en controleer ze dan hier.')}</p>`}

    <p class="small muted">${L('Breaches classed as sensitive are hidden from the public search. To see those, verify the address through the <em>Notify me</em> section of that site. It is also free, and it warns you about future breaches.',
      'Gevoelige lekken zijn verborgen in de openbare zoekfunctie. Om die te zien, bevestig je je adres via <em>Notify me</em> op die site. Dat is ook gratis, en je krijgt een seintje bij toekomstige lekken.')}</p>

    <div class="row" style="margin-top:12px">
      <input autocomplete="off" id="breach-q" placeholder="${L('Or search the breach list (e.g. linkedin)', 'Of doorzoek de lijst met lekken (bijv. linkedin)')}" style="flex:1;min-width:200px">
      <button data-action="load-breaches">${L('Load list', 'Lijst laden')}</button>
    </div>
    <div id="breach-result" style="margin-top:12px"></div>

    <details style="margin-top:14px">
      <summary class="small muted" style="cursor:pointer">${L('Optional: automate this with a paid API key', 'Optioneel: automatiseer dit met een betaalde API-sleutel')}</summary>
      <p class="small muted" style="margin-top:10px">${L('<strong>This is the one request in this app that transmits personal data</strong>: it sends the address being checked. Nothing else here does.',
        '<strong>Dit is het enige verzoek in deze app dat persoonsgegevens verstuurt</strong>: het adres dat je controleert. Niets anders hier doet dat.')}</p>
      <div class="row">
        <select id="acct-email" style="flex:1;min-width:200px">
          ${state.profile.emails.length
            ? state.profile.emails.map(e => `<option>${esc(e)}</option>`).join('')
            : `<option value="">${L('Add an email in Settings first', 'Voeg eerst een e-mailadres toe bij Instellingen')}</option>`}
        </select>
        <button data-action="check-account" ${state.hibpKey ? '' : 'disabled'}>${L('Check address', 'Controleer adres')}</button>
      </div>
      ${state.hibpKey ? '' : `<p class="small muted" style="margin-top:8px">${L('No key saved. Add one in <a href="#/profile">Settings</a> to enable this.',
        'Geen sleutel opgeslagen. Voeg er een toe bij <a href="#/profile">Instellingen</a>.')}</p>`}
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
          ? `<span class="pill done">${L('Not found', 'Niet gevonden')}</span> ${L('This password does not appear in any known leak. That is not the same as "strong": a unique passphrase in a password manager still beats it.',
              'Dit wachtwoord komt in geen enkel bekend lek voor. Dat is niet hetzelfde als "sterk": een unieke wachtzin in een wachtwoordmanager is nog steeds beter.')}`
          : `<span class="pill overdue">${L(`Seen ${n.toLocaleString()}×`, `${n.toLocaleString('nl-NL')}× gezien`)}</span> ${L('This password has leaked. Change it anywhere you used it, and never reuse it.',
              'Dit wachtwoord is gelekt. Verander het overal waar je het gebruikt, en gebruik het nooit meer.')}`;
        root.querySelector('#pw').value = '';
      } catch (err) {
        out.innerHTML = `<span class="pill overdue">${L('Could not reach the service', 'Dienst niet bereikbaar')}</span>
          ${esc(err.message)}. ${L('Check your connection. Some networks and content blockers block this API.', 'Controleer je verbinding. Sommige netwerken en blockers blokkeren deze dienst.')}`;
      }
    }

    if (action === 'copy-query') {
      try {
        await navigator.clipboard.writeText(btn.dataset.q);
        toast(L('Copied. Paste it into your mail search', 'Gekopieerd. Plak het in de zoekbalk van je mail'));
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
              `Spam naar ${phone}. Geen domein opgegeven, dus er is nog niemand om naar te schrijven. In Nederland mag een bedrijf je alleen bellen om iets te verkopen als je daar vooraf toestemming voor gaf; meld herhaling bij de ACM.`)
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
      toast(L(`${name} added, letter ready`, `${name} toegevoegd, brief staat klaar`));
    }

    if (action === 'hibp-open') {
      // Open before copying: awaiting the clipboard first breaks the user-gesture
      // chain and the popup blocker eats the new tab.
      window.open('https://haveibeenpwned.com/', '_blank', 'noopener,noreferrer');
      try {
        await navigator.clipboard.writeText(btn.dataset.email);
        toast(L('Address copied. Paste it into their search box', 'Adres gekopieerd. Plak het in hun zoekvak'));
      } catch {
        toast(L('Opened. Type the address into their search box', 'Geopend. Typ het adres in hun zoekvak'));
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
// how many mails, never subject lines or message text.
// Stored names are language-neutral apart from this one marker, translated on display.
export const nameOf = b => String(b.name || '').replace(/ \(impersonated\)$/, L(' (impersonated)', ' (nagemaakt)'));
// "LuckyGem · also as Koko.bet, Mr. Punter" for senders that rotate names.
export const akaOf = b => b.aka?.length ? L('also as ', 'ook als ') + b.aka.join(', ') : '';

function senderRecord(sn, owned, ownPhones = []) {
  const forged = sn.trust === 'forged';
  const personal = !!sn.personal;
  const base = sn.name && sn.name !== sn.domain ? sn.name : personal ? (sn.addresses || [])[0] || sn.key : sn.domain;
  // A forged sender is named for what it is, not for the brand it borrowed.
  const label = forged && /\.[a-z]{2,}$/i.test(sn.domain) ? `${base} (impersonated)` : base;
  const id = 'mail:' + (sn.key || sn.domain);

  // The address THEY mailed is the only identifier the letter may use. Prefer
  // one the user owns; otherwise take the recipient header verbatim, which is
  // how a per-company alias gets picked up correctly.
  const hit = (sn.recipients || []).find(r => owned.includes(r));
  const address = hit || (sn.recipients || [])[0] || (owned.length === 1 ? owned[0] : '');

  // What their own mail shows about the user, for the letter to identify them
  // with: nothing more. Kept only for senders that might get a letter; a scam
  // or an unverified sender keeps no personal details at all.
  const found = sn.identity || {};
  const letterable = sn.trust === 'verified' && !sn.risk && !sn.providerSpam && !personal;
  const lastNine = x => String(x).replace(/\D/g, '').slice(-9);
  const evidence = !letterable ? { address } : {
    address,
    emails: [...new Set([address, ...(found.emails || [])].filter(Boolean))].slice(0, 5),
    names: (found.names || []).slice(0, 3),
    postal: (found.postal || []).slice(0, 2),
    // Labelled as the user's in the mail, or a number from Settings that the
    // mail contains: never a helpline that merely appears in it.
    phones: [...new Set([...(found.phones || []), ...ownPhones.filter(ph => lastNine(ph).length === 9 && (found.phoneSeen || []).includes(lastNine(ph)))])].slice(0, 3)
  };

  // Someone writing from a personal account with nothing unsafe about it (a
  // friend, in a whole-mailbox export) needs no action; it is kept small so a
  // large mailbox still fits in the browser's storage.
  if (personal && !forged && !sn.risk && !sn.providerSpam && !sn.unsubHttp) {
    return { id, name: label, site: sn.domain, personal, source: 'mail', trust: sn.trust || 'unknown',
             evidence: { address }, mailCount: sn.count || 1, risk: '', unsubUrl: '' };
  }

  return {
    id, name: label, category: 'breach', regions: ['EU'], site: sn.domain, impersonates: forged, personal,
    // A person on a free mail service has no privacy desk to write to.
    optOutUrl: personal ? '' : `https://${sn.domain}`, email: personal ? '' : `privacy@${sn.domain}`,
    method: 'email', confidence: 'low',
    source: 'mail',
    evidence,
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
    // The last mail with an unsubscribe option: shows whether they stopped.
    lastBulkAt: sn.lastBulkAt || '',
    // What the user did with their mail (opened, starred, replied, filed): how
    // mail they want is told from mail they do not.
    engaged: sn.eng ? { ...sn.eng, folder: String(sn.eng.folder || '').slice(0, 40) } : undefined,
    transactional: !!sn.transactional,
    nameMismatch: !!sn.nameMismatch,
    // The privacy address and statement their own mail gives, if any, and the
    // addresses and postal address the company itself uses: channels it
    // provides, for when its privacy address is unknown.
    privacyEmail: letterable ? sn.privacyEmail || '' : '',
    privacyUrl: letterable ? sn.privacyUrl || '' : '',
    serviceEmails: letterable ? (sn.serviceEmails || []).slice(0, 3) : [],
    companyPostal: letterable ? sn.companyPostal || '' : '',
    notes: ''
  };
}

// A later scan adds to what earlier mail showed (an order confirmation with the
// postal address, then a newsletter without it), but only while the sender
// still qualifies for a letter: if it no longer does, the details are dropped.
function mergeEvidence(a = {}, b = {}) {
  if (!b.names) return b;
  const both = k => [...new Set([...(b[k] || []), ...(a[k] || [])])];
  return { address: b.address || a.address, emails: both('emails').slice(0, 5), names: both('names').slice(0, 3),
           postal: both('postal').slice(0, 2), phones: both('phones').slice(0, 3) };
}

// A whole mailbox can hold thousands of senders, and the browser keeps about
// five million characters per site. So a saved sender leaves out what is
// empty: a field that is false, blank or an empty list reads the same when it
// is missing. Done after merging, so a value that became empty is dropped too.
const OPTIONAL = ['impersonates', 'personal', 'unsubMailto', 'unsubFrom', 'oneClick', 'spam', 'risk', 'aka', 'providerSpam',
  'replyToHosts', 'linkDomains', 'transactional', 'privacyEmail', 'privacyUrl', 'serviceEmails', 'companyPostal', 'lastBulkAt', 'trustWhy',
  'notes', 'unsubUrl'];
function compact(t) {
  for (const k of OPTIONAL) if (t[k] === false || t[k] === '' || (Array.isArray(t[k]) && !t[k].length)) delete t[k];
  if (t.engaged) {
    for (const [k, v] of Object.entries(t.engaged)) if (!v) delete t.engaged[k];
    if (!Object.keys(t.engaged).length) delete t.engaged;
  }
  if (t.source === 'mail' && /^Found in your own mail:/.test(t.notes || '')) delete t.notes;
  return t;
}

// Counts take the larger, so dropping the same mailbox twice changes nothing.
function mergeEngaged(a, b) {
  if (!a || !b) return b || a;
  const out = { folder: a.folder || b.folder || '', wrote: !!(a.wrote || b.wrote) };
  for (const k of ['known', 'read', 'starred', 'replied', 'important', 'filed', 'junk']) out[k] = Math.max(a[k] || 0, b[k] || 0);
  return out;
}

// Saves a whole scan in one write: one save, and at most one warning if the
// browser's storage is full, however many senders the mailbox had.
export function upsertSenders(list) {
  let added = 0;
  store.update(st => {
    const owned = (st.profile.emails || []).map(e => e.toLowerCase());
    const ownPhones = st.profile.phones || [];
    const index = new Map(st.custom.map((c, i) => [c.id, i]));
    for (const sn of list) {
      const data = senderRecord(sn, owned, ownPhones);
      const i = index.get(data.id);
      if (i === undefined) { index.set(data.id, st.custom.length); st.custom.push(compact(data)); added++; continue; }
      const old = st.custom[i];
      // Keep what the user did (unsubscribed, renamed); take everything else fresh.
      // Counts take the larger: re-scanning the same files must not inflate them.
      st.custom[i] = { ...old, ...data, mailCount: Math.max(old.mailCount || 0, data.mailCount),
                       transactional: !!(old.transactional || data.transactional),
                       evidence: mergeEvidence(old.evidence, data.evidence),
                       serviceEmails: data.serviceEmails?.length || !old.serviceEmails ? [...new Set([...(data.serviceEmails || []), ...(old.serviceEmails || [])])].slice(0, 3) : old.serviceEmails,
                       companyPostal: data.companyPostal || old.companyPostal || '',
                       lastBulkAt: [old.lastBulkAt, data.lastBulkAt].filter(Boolean).sort().at(-1) || '',
                       engaged: mergeEngaged(old.engaged, data.engaged),
                       keep: old.keep,
                       unsubscribedAt: old.unsubscribedAt };
      compact(st.custom[i]);
    }
  });
  return added;
}

export const upsertSender = sn => upsertSenders([sn]) > 0;

// Dropped mail, wherever it is dropped: delivery failures for letters, answers
// from companies, and senders. Everything is read on this device.
export async function ingestFiles(files, onProgress) {
  const { messages, app, unread, broken } = await readMailFiles(files, onProgress);
  const bounced = new Set(messages.flatMap(m => m.bounce || []));
  const { back, partial } = bounced.size ? store.markBounced(bounced) : { back: [], partial: [] };
  const { answers, used } = matchAnswers(messages.filter(m => !m.bounce), store.get());
  const changed = answers.length ? store.recordAnswers(answers) : [];
  // Mail the user sent (a whole-mailbox export holds it) is not a sender to
  // sort; one forged in their name (the "I hacked you" scam) still is. In a
  // whole mailbox, the user's own addresses are the ones most of it went to.
  const own = ownedAddresses(store.get());
  const tally = new Map();
  for (const m of messages) for (const r of m.recipients || []) tally.set(r, (tally.get(r) || 0) + 1);
  for (const [a, n] of tally) if (n >= Math.max(3, messages.length * 0.2)) own.add(a);
  const mine = m => (own.has(String(m.address).toLowerCase()) && m.trust !== 'forged') || m.seen?.sent;
  // Whoever the user writes to is someone they want to hear from.
  const wroteTo = new Set(), wroteToSite = new Set();
  for (const m of messages.filter(mine)) for (const r of m.recipients || []) {
    if (own.has(r)) continue;
    wroteTo.add(r);
    const d = registrableDomain(r.split('@')[1] || '');
    if (d && !isPersonalDomain(d)) wroteToSite.add(d);
  }
  const mail = messages.filter(m => !m.bounce && !used.has(m) && !mine(m));
  const senders = mail.length ? groupBySender(mail) : [];
  for (const g of senders) {
    if (g.addresses.some(a => wroteTo.has(String(a).toLowerCase())) || (!g.personal && wroteToSite.has(g.domain))) g.eng = { ...g.eng, wrote: true };
  }
  if (senders.length) upsertSenders(senders);
  if (app && senders.length) store.update(st => { st.mailApp = app; });
  return { back, partial, answers: answers.filter(a => changed.includes(a.id)), mail, senders, unread, broken };
}

// Files the browser could not read are nearly always in a cloud folder and
// not downloaded yet. How to fetch them depends on the computer.
function unreadNote(n) {
  const which = L(n === 1 ? 'It is' : 'They are', n === 1 ? 'staat het' : 'staan ze');
  const head = L(`${n} ${n === 1 ? 'file' : 'files'} could not be read.`, `${n} ${n === 1 ? 'bestand kon' : 'bestanden konden'} niet worden gelezen.`);
  return head + ' ' + ((store.get().system || detectSystem()) === 'mac'
    ? L(`${which} probably still only in iCloud: in Finder, Control-click the folder → Download Now, wait until the cloud icons are gone, then drop it here again.`,
        `Waarschijnlijk ${which} alleen nog in iCloud: klik in de Finder met de rechtermuisknop op de map → Download nu, wacht tot de wolkjes weg zijn en sleep de map opnieuw hierheen.`)
    : L('Is the folder in OneDrive or another cloud folder? Right-click it → Always keep on this device, then drop it here again.',
        'Staat de map in OneDrive of een andere cloudmap? Klik er met de rechtermuisknop op → Altijd behouden op dit apparaat, en sleep hem daarna opnieuw hierheen.'));
}

// What dropping the files did, said once.
export function ingestToasts({ back, partial, answers, unread = 0, broken = 0, mail = [] }) {
  const said = [];
  if (unread) said.push((mail.length ? L(`${mail.length} ${mail.length === 1 ? 'mail' : 'mails'} read.`, `${mail.length} ${mail.length === 1 ? 'mail' : 'mails'} gelezen.`) + ' ' : '') + unreadNote(unread));
  if (broken) said.push(L(`${broken} ${broken === 1 ? 'file was' : 'files were'} not mail HoopUp can read and ${broken === 1 ? 'was' : 'were'} skipped.`,
    `${broken} ${broken === 1 ? 'bestand was' : 'bestanden waren'} geen mail die HoopUp kan lezen en ${broken === 1 ? 'is' : 'zijn'} overgeslagen.`));
  if (answers.length) said.push(L(`${answers.length} ${answers.length === 1 ? 'answer' : 'answers'} to your letters recognised. See Delete data.`,
    `${answers.length} ${answers.length === 1 ? 'antwoord' : 'antwoorden'} op je brieven herkend. Zie Gegevens verwijderen.`));
  if (partial.length) said.push(L(`${partial.length === 1 ? 'One address' : `${partial.length} addresses`} did not exist, but the letter reached their other addresses: the request stands and the deadline runs.`,
    `${partial.length === 1 ? 'Eén adres bestond' : `${partial.length} adressen bestonden`} niet, maar de brief kwam aan op hun andere adressen: het verzoek staat en de termijn loopt.`));
  if (back.length) said.push(L(`${back.length} ${back.length === 1 ? 'letter' : 'letters'} bounced: the address did not exist. ${back.length === 1 ? 'It is' : 'They are'} back on your list under Delete data.`,
    `${back.length} ${back.length === 1 ? 'brief kwam' : 'brieven kwamen'} terug: het adres bestond niet. ${back.length === 1 ? 'Hij staat' : 'Ze staan'} weer op je lijst bij Gegevens verwijderen.`));
  if (said.length) toast(said.join(' '));
  return said.length > 0;
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
  // People on a free mail service never appear: there is no company to ask.
  const pool = state.custom.filter(b => !isPersonal(b));
  const hidden = b => ['spam', 'bait', 'unclear'].includes(senderClass(b));
  const spam = pool.filter(hidden);
  const showSpam = params.get('spam') === '1';
  const mine = showSpam ? pool : pool.filter(b => !hidden(b));
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
  // Letters about to go to a guessed address that has not been looked up yet.
  const guessed = work.send.filter(b => b.source === 'mail' && b.site && !b.lookup && contactFor(b, store.getRequest(b.id)).source === 'guess');
  const overdue = targets.filter(b => store.isOverdue(b, store.getRequest(b.id))).length;

  return `
  <div class="head">
    <h1>${L('Delete data', 'Gegevens verwijderen')}</h1>
    <p>${L('Order these companies to erase you under Article 17 GDPR. They have one month to comply. Unsubscribing only stops the mail; <a href="#/unsubscribe">that is the other page</a>.',
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

  ${sent || Object.values(state.requests || {}).some(r => r.status !== 'todo') ? `<section class="card tools-card">
    <div id="answer-drop" class="drop drop-compact">
      <span>${L(`<b>Got an answer from a company?</b> Drop it here (.eml or .msg), or <button class="link-btn" data-action="pick-answer">choose files</button>. HoopUp reads it on this device and moves the request on.`,
                `<b>Antwoord gekregen van een bedrijf?</b> Sleep het hierheen (.eml of .msg), of <button class="link-btn" data-action="pick-answer">kies bestanden</button>. HoopUp leest het op dit apparaat en werkt het verzoek bij.`)}</span>
      <input type="file" id="answer-files" multiple accept=".eml,.msg,.mbox,.txt,message/rfc822,application/vnd.ms-outlook" hidden>
    </div>
    <div class="row" style="margin-top:10px">
      ${upcoming(state, targets).length ? `<button data-action="export-ics">${L('Add the deadlines to my calendar', 'Zet de termijnen in mijn agenda')}</button>` : ''}
      <button data-action="export-csv">${L('Download my log (CSV)', 'Download mijn overzicht (CSV)')}</button>
    </div>
    <p class="small muted" style="margin:8px 0 0">${L('Both files are made on this device. The calendar file holds only company names and dates; the log is your record for a complaint.',
      'Beide bestanden worden op dit apparaat gemaakt. Het agendabestand bevat alleen bedrijfsnamen en datums; het overzicht is je bewijs bij een klacht.')}</p>
  </section>` : ''}

  ${!sendQueue && guessed.length && lookupAvailable() ? `<div class="notice">
    <p><b>${L(`${guessed.length} ${guessed.length === 1 ? 'letter would go' : 'letters would go'} to a guessed address.`, `${guessed.length} ${guessed.length === 1 ? 'brief zou' : 'brieven zouden'} naar een geraden adres gaan.`)}</b>
      ${L('HoopUp can look up the real privacy address on each company\'s own privacy statement.', 'HoopUp kan het echte privacyadres opzoeken in de privacyverklaring van elk bedrijf zelf.')}</p>
    <div class="row"><button class="primary" data-action="lookup-all">${L(`Look up ${guessed.length} ${guessed.length === 1 ? 'address' : 'addresses'}`, `${guessed.length} ${guessed.length === 1 ? 'adres' : 'adressen'} opzoeken`)}</button>
      <span class="small muted">${L('Sends only the companies\' web addresses (like webwinkel.nl) to hoopup.tech, which reads their privacy statements. Nothing about you is sent or kept.',
        'Stuurt alleen de webadressen van de bedrijven (zoals webwinkel.nl) naar hoopup.tech, dat hun privacyverklaringen leest. Er wordt niets over jou verstuurd of bewaard.')}</span></div>
  </div>` : ''}

  ${sendQueue ? sendQueueCard(state) : workCard(work, params)}

  <div class="card">
    <div class="row">
      <input autocomplete="off" id="target-q" placeholder="${L('Search', 'Zoeken')}" value="${esc(params.get('q') || '')}" style="flex:1;min-width:150px">
      <button data-action="add-custom">${L('Add company', 'Bedrijf toevoegen')}</button>
    </div>
    <p class="small muted" style="margin:10px 0 0">
      ${showBrokers
        ? `${L(`Your ${mine.length} plus ${catalog.length} bundled data brokers.`, `Jouw ${mine.length} bedrijven plus ${catalog.length} bekende databrokers.`)}
           <a href="#/delete">${L('Show only mine', 'Alleen de mijne tonen')}</a>`
        : `${L('Only what came from your own evidence. Each letter tells a company nothing it does not already have.', 'Alleen wat uit je eigen mail en meldingen komt. Elke brief vertelt een bedrijf niets wat het nog niet van je heeft.')}
           <a href="#/delete?all=1">${L(`Add the ${catalog.length} bundled data brokers`, `Toon ook ${catalog.length} bekende databrokers`)}</a>`}
      ${spam.length && !showSpam
        ? `<br>${L(`${spam.length} spam or unverified ${spam.length === 1 ? 'sender is' : 'senders are'} hidden: a letter to those bounces and confirms your address is live.`,
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
  const late = store.daysSince(r.sentAt) - store.deadlineFor(b, r);
  const label = overdue ? L(`Overdue by ${late}d`, `${late} dagen te laat`) : statusLabel(r.status);

  const SRC = { mail: L('from your mail', 'uit je mail'), phone: L('from a call or text', 'uit een telefoontje of sms'),
                breach: L('from a breach', 'uit een datalek'), custom: L('added by you', 'door jou toegevoegd') };
  const reveals = b.evidence ? evidenceLines(b, lang() === 'nl').map(([, v]) => v).join(' · ') : '';
  return `
  <div class="item">
    <div class="body">
      <div class="name">${esc(nameOf(b))}
        <span class="pill ${pill}">${esc(label)}</span>
        ${SRC[b.source] ? `<span class="pill sent">${SRC[b.source]}</span>` : ''}
      </div>
      ${reveals ? `<div class="meta">${L('Letter reveals only', 'De brief noemt alleen')} <span class="mono">${esc(reveals)}</span></div>` : ''}
      ${lastAnswer(r) ? `<div class="meta">${L('Their answer', 'Hun antwoord')} ${esc(answerText(lastAnswer(r)))} <span class="muted">${L('(as HoopUp read it; correct the status if not)', '(zoals HoopUp het las; pas de status aan als het niet klopt)')}</span>
        ${['partial', 'nodata'].includes(lastAnswer(r).kind) && !(r.answeredAt >= lastAnswer(r).at) && (lastAnswer(r).kind === 'partial' || b.source === 'mail')
          ? `<a href="#/letter?b=${encodeURIComponent(b.id)}&t=${templateFor('reply', b, state.profile, r)}">${lastAnswer(r).kind === 'partial'
            ? L('Ask what they keep and why', 'Vraag wat ze bewaren en waarom') : L('Their mail reached you: ask again', 'Hun mail bereikte je: vraag het opnieuw')}</a>` : ''}</div>` : ''}
      ${isWanted(b) && r.status === 'todo' ? `<div class="meta"><span class="pill done">${L('kept', 'gehouden')}</span>
        ${L(`Not in the send queue: ${esc(wantedWhy(b))}. Use Letter if you want them to erase you anyway.`, `Niet in de wachtrij: ${esc(wantedWhy(b))}. Gebruik Brief als je toch gewist wilt worden.`)}</div>` : ''}
      ${keptMailing(b, r) ? `<div class="meta"><span class="pill overdue">${L('kept mailing', 'bleef mailen')}</span>
        ${keptMailing(b, r).since === 'request'
          ? L(`Marketing after your request, last on ${esc(keptMailing(b, r).last)}.`, `Reclame na je verzoek, laatst op ${esc(keptMailing(b, r).last)}.`)
          : L(`Unsubscribed ${esc(keptMailing(b, r).from)}, mail again on ${esc(keptMailing(b, r).last)}. The letter says so.`, `Uitgeschreven op ${esc(keptMailing(b, r).from)}, opnieuw mail op ${esc(keptMailing(b, r).last)}. De brief noemt dat.`)}</div>` : ''}
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
      ${!b.source && safeUrl(b.optOutUrl) ? `<a class="btn" href="${esc(safeUrl(b.optOutUrl))}" target="_blank" rel="noopener noreferrer">${L('Opt-out page ↗', 'Afmeldpagina ↗')}</a>` : ''}
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

  // Answers dropped here go through the same reading as on Home.
  const drop = root.querySelector('#answer-drop');
  const input = root.querySelector('#answer-files');
  const take = async list => {
    const files = [...list].filter(f => f.size > 0);
    if (!files.length) return;
    try {
      const result = await ingestFiles(files);
      if (!ingestToasts(result)) toast(result.mail.length
        ? L('No answer to one of your letters in there. The mail was added to your senders.', 'Daar zat geen antwoord op een van je brieven bij. De mail is bij je afzenders gezet.')
        : L('No mail found in those files. Use .eml, .msg or .mbox files.', 'Geen mail gevonden in die bestanden. Gebruik .eml-, .msg- of .mbox-bestanden.'));
    } catch (err) {
      toast(L('Could not read those files: ', 'Kon die bestanden niet lezen: ') + err.message);
    }
  };
  if (drop) {
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => { filesFromDrop(e.dataTransfer).then(take); });
  }
  input?.addEventListener('change', () => take(input.files));
  root.addEventListener('click', e => {
    const act = e.target.closest('[data-action]')?.dataset.action;
    if (act === 'pick-answer') input?.click();
    if (act === 'export-ics') {
      const link = location.origin + location.pathname + '#/delete';
      downloadText({ text: icsFor(store.get(), [...lastTargets.values()], link), name: 'hoopup-deadlines.ics', type: 'text/calendar;charset=utf-8' });
      toast(L('Calendar file saved. Open it to add the dates to your calendar.', 'Agendabestand opgeslagen. Open het om de datums in je agenda te zetten.'));
    }
    if (act === 'export-csv') {
      downloadText({ text: csvLog(store.get(), [...lastTargets.values()], statusLabel, answerText), name: `hoopup-log-${store.today()}.csv`, type: 'text/csv;charset=utf-8' });
    }
  });
  root.addEventListener('change', e => {
    const sel = e.target.closest('[data-action="set-status"]');
    if (sel) { store.setStatus(sel.dataset.id, sel.value); toast(L('Status updated', 'Status bijgewerkt')); }
    const rel = e.target.closest('[data-action="set-relation"]');
    if (rel) {
      store.setRelation(rel.dataset.id, rel.value);
      toast(rel.value === 'customer'
        ? L('Moved to your providers. They get the customer letter', 'Verplaatst naar Waar je klant bent. Ze krijgen de klantenbrief')
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
// Send, and the next one is ready. One click per company is the floor: a
// page cannot send mail, and should not be able to.

const isEU = b => ['EU', 'NL', 'UK'].some(r => (b.regions || []).includes(r));
export const recipient = (b, r = store.getRequest(b.id)) => contactFor(b, r).email;
const REMINDER_GRACE = store.REMINDER_GRACE;   // days the reminder letter gives them

// Without a confirmed privacy address, two routes that always work: their
// contact form, or a letter by post to the company's own address.
function otherRoutes(b, c) {
  const letter = `#/letter?b=${encodeURIComponent(b.id)}`;
  const kvk = `https://www.kvk.nl/zoeken/?source=all&q=${encodeURIComponent(nameOf(b).replace(/ \(.*\)$/, ''))}`;
  const form = safeUrl(c.url) ? `<a href="${esc(safeUrl(c.url))}" target="_blank" rel="noopener noreferrer">${L('their privacy statement', 'hun privacyverklaring')} ↗</a>` : '';
  return `<details class="small" style="margin-top:8px"><summary>${L('Other ways to reach them', 'Andere manieren om ze te bereiken')}</summary>
    <ul>
      <li>${L(`<b>Their contact form:</b> ${form ? `${form} usually links to it.` : 'on their website, often under Contact or Privacy.'} <a href="${letter}">Open the letter</a>, copy it and paste it in.`,
              `<b>Hun contactformulier:</b> ${form ? `${form} linkt er meestal naar.` : 'op hun website, vaak onder Contact of Privacy.'} <a href="${letter}">Open de brief</a>, kopieer hem en plak hem erin.`)}</li>
      <li>${c.postal
        ? L(`<b>By post</b> to <span class="mono">${esc(c.postal)}</span> (from their own mail). <a href="${letter}">Open the letter</a> and print it; send it registered if you want proof that it arrived.`,
            `<b>Per post</b> naar <span class="mono">${esc(c.postal)}</span> (uit hun eigen mail). <a href="${letter}">Open de brief</a> en druk hem af; verstuur hem aangetekend als je bewijs wilt dat hij aankwam.`)
        : L(`<b>By post</b> to their registered address: find it in the <a href="${kvk}" target="_blank" rel="noopener noreferrer">KvK register ↗</a> (Dutch companies) or in their privacy statement. <a href="${letter}">Open the letter</a> and print it; send it registered if you want proof that it arrived.`,
            `<b>Per post</b> naar hun vestigingsadres: zoek het op in het <a href="${kvk}" target="_blank" rel="noopener noreferrer">KvK-register ↗</a> (Nederlandse bedrijven) of in hun privacyverklaring. <a href="${letter}">Open de brief</a> en druk hem af; verstuur hem aangetekend als je bewijs wilt dat hij aankwam.`)}</li>
    </ul>
    <p class="muted">${L('Mark it as sent in the list below once it is on its way; the one-month deadline runs from when they receive it.', 'Markeer hem in de lijst hieronder als verstuurd zodra hij onderweg is; de termijn van een maand loopt vanaf het moment dat zij hem ontvangen.')}</p>
  </details>`;
}

// Where the address in the To field comes from, and what to do if unsure.
function contactPill(c) {
  const P = {
    you: ['done', L('your address', 'door jou ingevuld')],
    mail: ['done', L('from their own mail', 'uit hun eigen mail')],
    list: ['done', L(`checked ${CHECKED}`, `gecontroleerd ${CHECKED}`)],
    lookup: ['done', L(`from their privacy statement, ${c.checked}`, `uit hun privacyverklaring, ${c.checked}`)],
    guess: ['low', L('guessed', 'geraden')],
    service: ['done', L('their customer service, from their own mail', 'hun klantenservice, uit hun eigen mail')],
    none: ['overdue', L('no address yet', 'nog geen adres')]
  }[c.source];
  return P ? `<span class="pill ${P[0]}">${P[1]}</span>` : '';
}

function contactNote(c) {
  const link = safeUrl(c.url) ? `<a href="${esc(safeUrl(c.url))}" target="_blank" rel="noopener noreferrer">${L('their privacy statement ↗', 'hun privacyverklaring ↗')}</a>` : '';
  const parts = [];
  if (c.bounced.length) parts.push(L(`<b>${c.bounced.map(esc).join(', ')} bounced</b>: that address does not exist.`,
    `<b>${c.bounced.map(esc).join(', ')} kwam terug</b>: dat adres bestaat niet.`));
  if (c.source === 'guess' || c.source === 'none') parts.push(link
    ? L(`A guess from their domain. Look up their privacy or DPO address in ${link}, fix it here, and send.`,
        `Een gok op basis van hun domein. Zoek hun privacy- of FG-adres op in ${link}, pas het hier aan en verstuur.`)
    : L('A guess from their domain. Look for "privacy" or "DPO" in their privacy statement (usually linked at the bottom of their website and their mails), fix it here, and send.',
        'Een gok op basis van hun domein. Zoek "privacy" of "functionaris gegevensbescherming" in hun privacyverklaring (meestal onderaan hun website en hun mails gelinkt), pas het hier aan en verstuur.'));
  else if (c.source === 'mail') parts.push(L(`Their own mail names this address for privacy questions.${link ? ` To double-check: ${link}.` : ''}`,
    `Hun eigen mail noemt dit adres voor privacyvragen.${link ? ` Ter controle: ${link}.` : ''}`));
  else if (c.source === 'service') parts.push(L('Their privacy address is unknown or bounced, so this goes to the address they write to you from. A request through a channel they provide counts, and the letter asks them to pass it on to whoever handles privacy.',
    'Hun privacyadres is onbekend of kwam terug, dus dit gaat naar het adres waarvandaan ze jou mailen. Een verzoek via een kanaal dat zij aanbieden telt, en de brief vraagt ze het door te sturen naar wie over privacy gaat.'));
  else if (c.source === 'lookup') parts.push(L(`Found in their own privacy statement on ${c.checked}.${link ? ` ${link}` : ''}`,
    `Gevonden in hun eigen privacyverklaring op ${c.checked}.${link ? ` ${link}` : ''}`));
  else if (c.source === 'list') parts.push(L(`Checked against their own privacy statement in ${CHECKED}.${link ? ` ${link}` : ''}`,
    `Gecontroleerd in hun eigen privacyverklaring (${CHECKED}).${link ? ` ${link}` : ''}`));
  parts.push(L('If the letter bounces, drop the bounce message in on Home: HoopUp then marks the address as wrong.',
    'Komt de brief terug? Sleep dat bericht dan op Home erin, en HoopUp markeert het adres als fout.'));
  return `<p class="small muted" style="margin:4px 0 0">${parts.join(' ')}</p>`;
}

// What each company needs next. Spam, bait and unverifiable senders never get
// here: a letter to them confirms the address is live.
export function deleteWork(targets) {
  const w = { send: [], forms: [], reminders: [], complaints: [], answers: [] };
  for (const b of targets) {
    if (!writable(b)) continue;
    const r = store.getRequest(b.id);
    // They answered with a demand the law does not support, and the user has
    // not replied to it yet.
    const a = lastAnswer(r);
    if (a && PUSHBACK.has(a.kind) && ['sent', 'ack'].includes(r.status) && !(r.answeredAt >= a.at)) w.answers.push(b);
    // Mail the user wants is not queued for erasure; it can still be written
    // to from its row.
    if (r.status === 'todo' && isWanted(b)) continue;
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
  // Anyone who kept mailing after an unsubscribe goes before everyone.
  const rank = b => (keptMailing(b, store.getRequest(b.id)) ? -10 : 0)
    + RELATION_ORDER[relationOf(b, store.getRequest(b.id))] * 2 + (b.source ? 0 : 1);
  for (const k of ['send', 'forms', 'reminders']) w[k].sort((a, b) => rank(a) - rank(b));
  return w;
}

// Module state, so a store write (marking one sent) re-renders the page
// without losing the user's place in the queue.
let sendQueue = null;        // { kind: 'request' | 'reminder', ids, i }
let lastTargets = new Map(); // id -> target, from the last render of this page
let lastOpened = null;       // { name, body } of the letter just handed to the mail app; never stored

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
            `Ze hebben ${REMINDER_GRACE} dagen. Zwijgt een bedrijf daarna nog steeds, dan staat hier een klacht bij de toezichthouder voor je klaar.`)
        : L('The one-month deadlines are running. Anyone who has not answered by then shows up here with a reminder ready, so you do not need to keep track.',
            'De termijn van een maand loopt. Heeft een bedrijf dan nog niet gereageerd, dan staat hier een herinnering voor je klaar. Je hoeft niets bij te houden.')}</p>
      <p class="small muted">${L('Did not send one after all? Set it back to "Not started" in the list below.',
        'Toch eentje niet verstuurd? Zet hem in de lijst hieronder terug op "Niet gestart".')}</p>
      <div class="row"><button class="primary" data-action="export-ics">${L('Add the deadlines to my calendar', 'Zet de termijnen in mijn agenda')}</button>
        <button data-action="send-close">${L('Close', 'Sluiten')}</button></div>
    </section>`;

  const b = lastTargets.get(q.ids[q.i]);
  if (!b) { q.i++; return sendQueueCard(state); }
  const r = store.getRequest(b.id);
  const to = recipient(b, r);
  const contact = contactFor(b, r);
  const reveals = b.evidence ? evidenceLines(b, lang() === 'nl').map(([, v]) => v).join(' · ') : '';
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
      <label for="send-to">${L('To', 'Aan')} ${contactPill(contact)}</label>
      <input autocomplete="off" id="send-to" value="${esc(to)}" data-id="${esc(b.id)}" spellcheck="false">
      ${contactNote(contact)}
      ${['guess', 'none'].includes(contact.source) && b.source === 'mail' && b.site && lookupAvailable()
        ? (b.lookup
          ? `<p class="small muted" style="margin:4px 0 0">${L(`Not found on their website (looked on ${esc(b.lookup.checked)}): their privacy statement may only show in a browser. Use the link above.`,
              `Niet gevonden op hun website (gekeken op ${esc(b.lookup.checked)}): hun privacyverklaring is misschien alleen in een browser te zien. Gebruik de link hierboven.`)}</p>`
          : `<div class="row" style="margin-top:6px"><button data-action="lookup-contact" data-id="${esc(b.id)}" data-site="${esc(b.site)}">${L('Look it up on their website', 'Zoek het op hun website op')}</button>
             <span class="small muted">${L('Sends only their web address to hoopup.tech, nothing about you.', 'Stuurt alleen hun webadres naar hoopup.tech, niets over jou.')}</span></div>`)
        : ''}
      ${contact.cc.length ? (() => {
        const own = contact.cc.filter(a => a !== contact.guessCc);
        const code = (list, and) => list.map(a => `<code>${esc(a)}</code>`).join(and);
        const parts = [];
        if (own.length) parts.push(L(`${code(own, ' and ')}, ${own.length === 1 ? 'an address' : 'addresses'} their own mail comes from`,
                                     `${code(own, ' en ')}, ${own.length === 1 ? 'een adres' : 'adressen'} waarvandaan hun eigen mail komt`));
        if (contact.guessCc) parts.push(L(`<code>${esc(contact.guessCc)}</code>, the usual privacy address (a guess)`,
                                          `<code>${esc(contact.guessCc)}</code>, het gebruikelijke privacyadres (een gok)`));
        return `<p class="small" style="margin:6px 0 0">${L(`<b>Copy to</b> ${parts.join('; and ')}.`, `<b>Kopie aan</b> ${parts.join('; en ')}.`)}
          ${L('If the privacy address is wrong or out of date, the request still reaches them through a channel they provide, and under the GDPR (AVG) that counts. A copy that bounces does no harm.',
              'Klopt het privacyadres niet of niet meer, dan bereikt het verzoek ze toch via een kanaal dat zij aanbieden, en volgens de AVG telt dat. Een kopie die terugkomt kan geen kwaad.')}</p>`;
      })() : ''}
      ${['guess', 'none', 'service'].includes(contact.source) ? otherRoutes(b, contact) : ''}
    </div>
    <p class="small">${reveals
      ? L(`The letter reveals only <span class="mono">${esc(reveals)}</span>: what their own mail shows they already have.`,
          `De brief noemt alleen <span class="mono">${esc(reveals)}</span>: wat hun eigen mail laat zien dat ze al hebben.`)
      : L('The letter includes your name and address, so this broker can find your record.',
          'De brief bevat je naam en adres, zodat deze databroker je gegevens kan vinden.')}
      <a href="#/letter?b=${encodeURIComponent(b.id)}&t=${queueTemplate(q.kind, b, state.profile)}">${L('Read it', 'Lees de brief')}</a></p>
    ${!reminder && relationOf(b, r) === 'customer' ? `<p class="small"><span class="pill done">${L('customer letter', 'klantenbrief')}</span>
      ${L('You are a customer here, so this asks them to stop marketing and delete what they do not need. Your account stays.',
          'Je bent hier klant, dus deze brief vraagt om te stoppen met marketing en te wissen wat ze niet nodig hebben. Je account blijft.')}</p>` : ''}
    <div class="row">
      <button class="primary" data-action="send-open">${L(`Open email to ${esc(nameOf(b))} →`, `Open de mail aan ${esc(nameOf(b))} →`)}</button>
      <button data-action="send-skip">${L('Skip', 'Overslaan')}</button>
    </div>
    <p class="small muted" style="margin:10px 0 0">${L(
      'Your mail app opens with the letter filled in. Press Send there, come back, and the next one is ready. Each is marked as sent when it opens.',
      'Je mailapp opent met de brief ingevuld. Druk daar op Verstuur, kom terug, en de volgende staat klaar. Elke brief wordt als verstuurd gemarkeerd zodra hij opent.')}
      ${lastOpened ? `<br>${L(`Was the letter to ${esc(lastOpened.name)} cut short in your mail app?`, `Kwam de brief aan ${esc(lastOpened.name)} afgekapt in je mailapp terecht?`)}
        <button class="link-btn" data-action="send-copy">${L('Copy it', 'Kopieer hem')}</button>` : ''}
      ${next.length ? `<br>${L('Up next:', 'Hierna:')} ${next.map(esc).join(', ')}${total - q.i - 1 > next.length ? '…' : ''}` : ''}</p>
  </section>`;
}

// What a company's answer said, as HoopUp read it.
export function answerText(a) {
  if (!a) return '';
  const said = {
    done: L('says your data is erased', 'zegt dat je gegevens zijn gewist'),
    partial: L('erased, but keeps some by law', 'gewist, maar bewaart een deel wettelijk'),
    nodata: L('says it holds nothing on you', 'zegt niets van je te hebben'),
    refused: L('refused', 'weigerde'),
    id: L('wants a copy of your ID', 'wil een kopie van je identiteitsbewijs'),
    form: L('wants you to use its web form', 'wil dat je hun webformulier gebruikt'),
    retain: L('says it must keep some by law', 'zegt een deel wettelijk te moeten bewaren'),
    extend: L('takes two more months', 'neemt twee maanden extra'),
    ack: L('confirmed receipt', 'bevestigde de ontvangst'),
    other: L('answered', 'antwoordde')
  }[a.kind] || L('answered', 'antwoordde');
  return `${a.at ? longDate(a.at, lang() === 'nl') + ': ' : ''}${said}`;
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

  if (w.answers.length) parts.push(`
    <div class="work-row">
      <div>
        <h2>${L('They answered: reply ready', 'Ze antwoordden: je reactie staat klaar')} <span class="count">${w.answers.length}</span></h2>
        <p class="small muted">${L('These answered with a demand the law does not support. The reply explains why, and asks them to go ahead. Their deadline keeps running.',
          'Deze antwoordden met een eis die de wet niet steunt. De reactie legt uit waarom en vraagt ze door te gaan. Hun termijn loopt gewoon door.')}</p>
        <div class="list">${w.answers.map(b => `
          <div class="pick" style="cursor:default">
            <span class="pick-name">${esc(nameOf(b))}<span class="aka">${esc(answerText(lastAnswer(store.getRequest(b.id))))}</span></span>
            <a class="btn primary" href="#/letter?b=${encodeURIComponent(b.id)}&t=${templateFor('reply', b, store.get().profile, store.getRequest(b.id))}">${L('Write reply', 'Reactie schrijven')}</a>
          </div>`).join('')}</div>
        ${w.answers.some(b => lastAnswer(store.getRequest(b.id))?.kind === 'id') ? `<p class="small muted" style="margin:8px 0 0">${L(
          'Decide to send an ID copy after all? Cover your photo and citizen service number (BSN) first, for example with the KopieID app from the Dutch government, and write on it who it is for.',
          'Besluit je toch een kopie ID te sturen? Dek eerst je pasfoto en BSN af, bijvoorbeeld met de KopieID-app van de Rijksoverheid, en zet erop voor wie hij is.')}</p>` : ''}
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

  // Looked-up addresses are saved with the company, with the date, so a letter
  // or reminder later uses the same one and the user sees where it came from.
  const EMAIL = /^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
  const saveLookups = found => store.update(st => {
    for (const [id, f] of found) {
      const t = st.custom.find(c => c.id === id);
      if (t) t.lookup = { email: EMAIL.test(f.email) ? f.email.toLowerCase() : '', url: safeUrl(f.url) ? f.url : '', checked: f.checked || store.today() };
    }
  });

  root.addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const act = btn.dataset.action;

    if (act === 'lookup-contact' || act === 'lookup-all') {
      const ids = act === 'lookup-contact' ? [btn.dataset.id]
        : deleteWork([...lastTargets.values()]).send.filter(b => b.source === 'mail' && b.site && !b.lookup
            && contactFor(b, store.getRequest(b.id)).source === 'guess').map(b => b.id);
      const found = [];
      btn.disabled = true;
      for (const [i, id] of ids.entries()) {
        const b = lastTargets.get(id);
        if (!b?.site) continue;
        btn.textContent = L(`Looking up ${i + 1} of ${ids.length}…`, `Opzoeken ${i + 1} van ${ids.length}…`);
        try { found.push([id, await lookupContact(b.site)]); }
        catch { toast(L('The look-up is not available right now. Try again later.', 'Opzoeken lukt nu even niet. Probeer het later opnieuw.')); break; }
      }
      if (found.length) {
        saveLookups(found);
        const hits = found.filter(([, f]) => EMAIL.test(f.email)).length;
        toast(L(`Found ${hits} of ${found.length} on their own privacy statements.`, `${hits} van ${found.length} gevonden in hun eigen privacyverklaringen.`));
      }
      rerender();
      return;
    }

    if (act === 'send-start') {
      const w = deleteWork([...lastTargets.values()]);
      const list = btn.dataset.kind === 'reminder' ? w.reminders : w.send;
      sendQueue = { kind: btn.dataset.kind, ids: list.map(b => b.id), i: 0 };
      rerender();
    }

    if (act === 'send-skip' && sendQueue) { sendQueue.i++; rerender(); }

    if (act === 'send-close') {
      sendQueue = null;
      lastOpened = null;
      if (/[?&]send=1/.test(location.hash)) location.hash = '#/delete'; else rerender();
    }

    if (act === 'send-copy' && lastOpened) {
      navigator.clipboard.writeText(lastOpened.body)
        .then(() => toast(L('Letter copied. Paste it over the shortened one.', 'Brief gekopieerd. Plak hem over de afgekapte.')))
        .catch(() => toast(L('Could not copy. Open the letter and select it.', 'Kopiëren mislukt. Open de brief en selecteer hem.')));
    }

    if (act === 'send-open' && sendQueue) {
      const b = lastTargets.get(sendQueue.ids[sendQueue.i]);
      if (!b) return;
      const r = store.getRequest(b.id);
      const to = root.querySelector('#send-to')?.value.trim() || recipient(b, r);
      const { subject, body } = renderLetter(queueTemplate(sendQueue.kind, b, store.get().profile), b, store.get().profile, r);

      // Must happen inside the click, before the re-render below: handing a
      // mailto: to the mail app needs the user gesture.
      // Their own service address goes along as a copy when the privacy address
      // is only a guess: a request through a channel they provide counts.
      const c = contactFor(b, r);
      const cc = to.toLowerCase() === c.email.toLowerCase() ? c.cc : [];
      const link = document.createElement('a');
      link.href = `mailto:${encodeURIComponent(to)}?${cc.length ? `cc=${encodeURIComponent(cc.join(','))}&` : ''}subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      link.click();
      // Not copied automatically: a clipboard can sync to other devices (Windows
      // clipboard history, Apple's Universal Clipboard), and the letter holds
      // personal details. The card offers a copy if the mail app cut it short.
      lastOpened = { name: nameOf(b), body };

      // Only an address the user typed is kept as theirs; the one actually used
      // is always kept, so a bounce for it can be recognised later.
      const extra = { ...(to !== c.email ? { to } : {}), sentTo: to, sentCc: cc };
      sendQueue.i++;
      if (sendQueue.kind === 'reminder') store.markReminder(b.id, extra);
      else store.setStatus(b.id, 'sent', extra);
    }

    if (act === 'form-done') {
      store.setStatus(btn.dataset.id, 'sent');
      toast(L('Marked as done, deadline started', 'Gemarkeerd als gedaan, de termijn loopt'));
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
  q.dataset.rest = JSON.stringify(rest.map(t => ({ id: t.id, name: t.name, unsubUrl: t.unsubUrl, unsubMailto: t.unsubMailto })));

  const paint = (done, failed, total, finished) => {
    q.innerHTML = `
      <div class="notice ${finished ? '' : 'warn'}">
        ${finished && !done
          ? `<p><strong>${L(total === 1 ? 'Could not reach the sender.' : `Could not reach any of the ${total}.`,
                            total === 1 ? 'De afzender was niet bereikbaar.' : `Geen van de ${total} was bereikbaar.`)}</strong></p>
             <p class="small">${L('Nothing was sent, so they all stay on your list. Check your connection and try again; a content blocker or company network can also stop these requests.',
               'Er is niets verstuurd, dus ze blijven allemaal op je lijst staan. Controleer je verbinding en probeer het opnieuw; ook een contentblocker of bedrijfsnetwerk kan deze verzoeken tegenhouden.')}</p>`
          : `<p><strong>${finished ? L(`Sent ${done} of ${total}`, `${done} van ${total} verstuurd`)
                              : L(`Unsubscribing… ${done} of ${total}`, `Bezig met uitschrijven… ${done} van ${total}`)}</strong>${failed
          ? L(`, ${failed} could not be reached`, `, ${failed} niet bereikbaar`) : ''}</p>
        ${finished ? `<p class="small">${L('Delivered, not confirmed: a browser hides cross-site responses, so the app cannot read what each sender replied. Compliant senders act on it immediately. If mail from one continues, send it a deletion letter. That one you can enforce.',
          'Verstuurd, niet bevestigd: een browser verbergt antwoorden van andere sites, dus de app kan niet lezen wat elke afzender terugstuurde. Nette afzenders verwerken het meteen. Blijft er mail komen, stuur die afzender dan een verwijderverzoek. Dat kun je afdwingen.')}</p>` : ''}
        ${finished && failed ? `<p class="small">${L('The ones that could not be reached stay on your list, so you can try again.', 'De niet-bereikbare blijven op je lijst staan, zodat je het opnieuw kunt proberen.')}</p>` : ''}`}
        ${finished && rest.length ? `<p class="small"><strong>${L(`${rest.length} more`, `Nog ${rest.length}`)}</strong> ${L('published a link but not one-click, so they need opening individually.', 'hebben een uitschrijflink maar geen uitschrijving met één klik, dus die open je één voor één.')}</p>` : ''}
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
        items: items.map(t => ({ id: t.id, name: t.name, url: safeUnsubUrl(t.unsubUrl) })).filter(t => t.url)
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
        if (/^mailto:/i.test(urls[i].url)) {
          // An unsubscribe by email: the mail app opens it, the user sends it.
          const href = safeUnsubMailto(urls[i].url);
          if (href) { const a = document.createElement('a'); a.href = href; a.click(); }
        } else window.open(urls[i].url, '_blank', 'noopener,noreferrer');
        if (urls[i].id) markUnsubscribed([urls[i].id]);
        q.dataset.i = String(i + 1);
        renderQueue(q, urls, i + 1);
      }
    }

    if (act === 'unsub-copy') {
      const urls = JSON.parse(q.dataset.urls || '[]');
      navigator.clipboard.writeText(urls.filter(u => !/^mailto:/i.test(u.url)).map(u => u.url).join('\n'))
        .then(() => toast(L(`${urls.filter(u => !/^mailto:/i.test(u.url)).length} links copied`, `${urls.filter(u => !/^mailto:/i.test(u.url)).length} links gekopieerd`)))
        .catch(() => toast(L('Could not copy. Select them by hand', 'Kopiëren mislukt. Selecteer ze zelf')));
    }

    if (act === 'unsub-close') { q.innerHTML = ''; onClose?.(); }
  });
}

export function startUnsubQueue(root, list) {
  const q = root.querySelector('#unsub-queue');
  if (!q) return;
  if (!list.length) { toast(L('None of these published an unsubscribe link', 'Geen van deze gaf een uitschrijflink')); return; }
  const urls = list.map(t => ({ id: t.id, name: t.name, url: safeUnsubUrl(t.unsubUrl) || safeUnsubMailto(t.unsubMailto) })).filter(t => t.url);
  q.dataset.urls = JSON.stringify(urls);
  q.dataset.i = '0';
  renderQueue(q, urls, 0);
}

function renderQueue(q, urls, i) {
  const done = i >= urls.length;
  q.innerHTML = `
    <div class="notice ${done ? '' : 'warn'}">
      ${done
        ? `<p><strong>${L(`All ${urls.length} opened.`, `Alle ${urls.length} geopend.`)}</strong> ${L('Each opened in its own tab. Finish any that ask for a confirmation click.', 'Elke link opende in een eigen tabblad. Vraagt een pagina nog om een bevestiging, klik die dan aan.')}</p>`
        : `<p><strong>${L(`Unsubscribing: ${i} of ${urls.length} done.`, `Uitschrijven: ${i} van ${urls.length} klaar.`)}</strong> ${L('Next:', 'Volgende:')}
           <strong>${esc(urls[i].name)}</strong></p>
           <p class="small muted">${/^mailto:/i.test(urls[i].url)
             ? L('This one only takes an unsubscribe by email. Your mail app opens with it filled in: press Send there, then come back for the next.',
                 'Deze afzender neemt alleen een afmelding per e-mail aan. Je mailapp opent met de mail al ingevuld: druk daar op Verstuur en kom terug voor de volgende.')
             : L('Your browser blocks a page from opening many tabs at once, so this steps through them: one click each, no hunting for the link.',
                 'Je browser laat een pagina niet veel tabbladen tegelijk openen, dus dit gaat er één voor één doorheen: één klik per afzender, zonder de link te hoeven zoeken.')}</p>`}
      <div class="row" style="margin-top:8px">
        ${done ? '' : /^mailto:/i.test(urls[i].url)
          ? `<button class="primary" data-action="unsub-next">${L(`Email ${esc(urls[i].name)} →`, `Mail ${esc(urls[i].name)} →`)}</button>`
          : `<button class="primary" data-action="unsub-next">${L(`Open ${esc(urls[i].name)} →`, `Open ${esc(urls[i].name)} →`)}</button>`}
        ${urls.some(u => !/^mailto:/i.test(u.url)) ? `<button data-action="unsub-copy">${L(`Copy all ${urls.filter(u => !/^mailto:/i.test(u.url)).length} links`, `Kopieer alle ${urls.filter(u => !/^mailto:/i.test(u.url)).length} links`)}</button>` : ''}
        <button data-action="unsub-close">${done ? L('Close', 'Sluiten') : L('Stop', 'Stoppen')}</button>
      </div>
    </div>`;
}

// ------------------------------------------------------------- unsubscribe

// Three outcomes, and only two of them are unsubscribing. A sender with no
// unsubscribe anywhere in its message is not a company that forgot (compliant
// bulk mail must offer one), so it is treated as spam to block, not written to.
// An unsubscribe link in a mail whose sender failed authentication is not a
// way out, it is a tracker: clicking it confirms a person reads this mailbox.
// So a forged sender's link is never offered, however legitimate it looks.
// A sender on a free mail service (Gmail, Hotmail, Ziggo…) is a person. Older
// saved data grouped them per provider, so a stored "gmail.com" counts too.
// Mail the user wants, told from what they do with it: they write to the
// sender, star or flag the mail, file it in a folder of their own, or open
// most of it. Or they said so. Opening alone does not count for mail that
// mostly sat in the junk folder, where people open things to see what they are.
export function wantedWhy(b) {
  if (b.keep === false || b.source !== 'mail') return '';
  if (b.keep === true) return L('you chose to keep it', 'je koos ervoor dit te houden');
  const e = b.engaged || {};
  if (e.wrote || e.replied) return L('you write to them', 'je mailt ze zelf');
  if (e.starred) return L('you star or flag their mail', 'je geeft hun mail een ster of vlag');
  if (e.filed) return L(`you keep it in "${e.folder}"`, `je bewaart het in "${e.folder}"`);
  if (e.known >= 2 && e.read * 2 >= e.known && !(e.junk * 2 >= (b.mailCount || 1))) return L(`you opened ${e.read} of ${e.known}`, `je opende ${e.read} van de ${e.known}`);
  return '';
}
export const isWanted = b => !!wantedWhy(b);
// Strong enough to overrule a block: the user acted on it, not just opened it.
export const keptByUser = b => b.keep === true || (b.keep !== false && !!(b.engaged?.wrote || b.engaged?.replied || b.engaged?.starred || b.engaged?.filed));

export const isPersonal = b => b.source === 'mail' && (!!b.personal || isPersonalDomain(b.site));

// Senders saved before the check existed are judged on name and domain alone.
export const nameMismatch = b => b.nameMismatch ?? !nameMatchesDomain(String(b.name || '').replace(/ \(.*\)$/, ''), '', b.site);

// Senders that may get a letter: real companies, never scams, unverifiable
// senders or people writing from a personal account.
export const writable = b => !isPersonal(b) && !['spam', 'bait', 'unclear'].includes(senderClass(b));

export function senderClass(b) {
  if (b.source !== 'mail') return 'company';
  const hasLink = !!safeUnsubUrl(b.unsubUrl);
  // Unsafe: failed the sender check, rated high-confidence spam by the mail
  // provider, or selling something unsafe whoever sends it (gambling, crypto,
  // prize and adult spam). Passing the sender check only proves who sent it.
  if (unsafeReason(b)) return hasLink ? 'bait' : 'spam';
  // A sender the check could not confirm may not be who it claims to be, so
  // its links are never used and it is never written to: its unsubscribe link
  // could lead straight to the spammer it is pretending not to be.
  if (b.trust !== 'verified') return 'unclear';
  // A name that has nothing to do with the domain ("USPS Delivery" from
  // sdothemed.com): the check proves who owns the domain, not who they claim
  // to be, so their links are not used and they are not written to.
  if (!isPersonal(b) && nameMismatch(b)) return 'unclear';
  // A link, or an unsubscribe by email from a sender the check confirmed.
  if (hasLink || safeUnsubMailto(b.unsubMailto)) return 'unsub';
  if (isPersonal(b)) return 'person';
  // A verified sender without an unsubscribe link is a real company sending
  // receipts or account mail: a deletion letter, never a block. One that
  // could not be verified either way is left for the user to judge.
  return b.trust === 'verified' ? 'company' : 'unclear';
}

// Why a sender is treated as unsafe, or '' when it is not.
export function unsafeReason(b) {
  if (b.source !== 'mail') return '';
  if (b.trust === 'forged') return L('failed the sender check', 'zakte voor de afzendercontrole');
  const R = {
    gambling: L('gambling advertising', 'gokreclame'),
    crypto: L('crypto or get-rich pitch', 'reclame voor crypto of snel rijk worden'),
    pharma: L('pharmacy spam', 'medicijnspam'),
    impersonation: L('pretends to be an official organisation', 'doet zich voor als een officiële instantie'),
    prize: L('fake prize', 'nepprijs'),
    adult: L('adult spam', 'seksspam'),
    phishing: L('account scare (phishing)', 'accountdreiging (phishing)'),
    fraud: L('advance-fee scam (fake inheritance or deal)', 'voorschotfraude (nep-erfenis of nepdeal)')
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
  if (b.trust !== 'verified') return null;
  if (safeUnsubUrl(b.unsubUrl)) return b.oneClick && b.unsubFrom === 'header' ? 'instant' : 'link';
  // Some only take an unsubscribe by email: the mail app opens it filled in.
  return safeUnsubMailto(b.unsubMailto) ? 'mail' : null;
}

let unsubPrimed = false;

// Shortcuts to the sections of a long page, with how many each holds.
function jumpRow(items) {
  return `<nav class="jump no-print" aria-label="${L('On this page', 'Op deze pagina')}">
    ${items.filter(([, n, to]) => n && to).map(([label, n, to]) =>
      `<button type="button" class="jump-chip" data-action="jump" data-to="sec-${to}">${label}${n > 0 ? ` <span class="count">${n}</span>` : ''}</button>`).join('')}
  </nav>`;
}

export function unsubscribe(state) {
  const mail = state.custom.filter(b => b.source === 'mail');
  const tiers = { instant: [], link: [], mail: [] };
  const spam = [], bait = [], unclear = [], people = [], unsubscribed = [], wanted = [];
  for (const b of state.custom) {
    const t = unsubTier(b);
    const c = senderClass(b);
    // Done is done: an unsubscribed sender is listed, never offered again.
    if (t && b.unsubscribedAt) unsubscribed.push(b);
    else if (t && isWanted(b)) wanted.push(b);
    else if (t) tiers[t].push(b);
    else if (c === 'bait') bait.push(b);
    else if (c === 'spam') spam.push(b);
    else if (c === 'unclear') unclear.push(b);
    else if (c === 'person') people.push(b);
  }

  if (!unsubPrimed && (tiers.instant.length || tiers.link.length || tiers.mail.length)) {
    [...tiers.instant, ...tiers.link, ...tiers.mail].filter(b => b.trust === 'verified').forEach(b => selected.add(b.id));
    unsubPrimed = true;
  }

  const sel = k => tiers[k].filter(b => selected.has(b.id));
  // Who ignored the unsubscribe: marketing more than ten days after it.
  const kept = unsubscribed.filter(b => keptMailing(b, store.getRequest(b.id)));
  const quiet = unsubscribed.filter(b => !kept.includes(b));

  const group = (key, title, blurb, cta, cls) => tiers[key].length ? `
    <section class="card" id="sec-${key}">
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
            <span class="pick-meta mono">${esc(b.site || '')}</span>
            <button class="link-btn" data-action="keep" data-id="${esc(b.id)}">${L('Keep', 'Houden')}</button>
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
    <p>${L('Real companies get an unsubscribe. Unsafe senders (scams, gambling and other spam) get blocked. Stopping the mail is not deletion; <a href="#/delete">that is the other page</a>.',
           'Bij echte bedrijven schrijf je je uit. Onveilige afzenders (oplichters, gokreclame en andere spam) blokkeer je. Uitschrijven stopt alleen de mail; je gegevens laten wissen doe je op <a href="#/delete">de andere pagina</a>.')}</p>
  </div>

  ${!mail.length ? `<div class="notice">
    <p>${L('Nothing here yet. <a href="#/">Scan your mail</a> and senders land here automatically.',
           'Nog niets hier. <a href="#/">Scan je mail</a> en afzenders komen hier vanzelf.')}</p>
  </div>` : ''}

  ${mail.length ? jumpRow([
    [L('Unsubscribe', 'Uitschrijven'), tiers.instant.length + tiers.link.length + tiers.mail.length, ['instant', 'link', 'mail'].find(k => tiers[k].length)],
    [L('Block', 'Blokkeren'), bait.length + spam.length, 'block'],
    [L('Still mailing', 'Mailen nog'), kept.length, 'kept'],
    [L('Kept', 'Gehouden'), wanted.length, 'wanted'],
    [L('Could not verify', 'Niet te controleren'), unclear.length, 'unclear'],
    [L('Personal', 'Persoonlijk'), people.length, 'people'],
    [L('Unsubscribed', 'Uitgeschreven'), quiet.length, 'done'],
    [L('Post and phone', 'Post en telefoon'), -1, 'offline']
  ]) : ''}

  <div id="outlook-result"></div>
  <div id="unsub-queue"></div>

  ${group('instant', L('One click, no page to visit', 'Met één klik, zonder pagina'),
    L('These support the one-click unsubscribe standard, so a single request finishes it. They all go at once.',
      'Deze afzenders ondersteunen uitschrijven met één klik. Ze gaan allemaal tegelijk.'),
    n => L(`Unsubscribe ${n || ''} now`, `Schrijf je nu uit bij ${n || ''}`), 'primary')}

  ${group('link', L('Opens their page', 'Via hun eigen pagina'),
    L('These published a link (usually "Uitschrijven" or "Unsubscribe" at the bottom), but not one-click, so the page has to load. They open one at a time.',
      'Deze afzenders hebben een uitschrijflink (meestal "Uitschrijven" onderaan de mail), maar geen uitschrijving met één klik. Hun pagina\'s openen één voor één.'),
    n => L(`Open ${n || ''}`, `${n || ''} openen`), '')}

  ${group('mail', L('By email', 'Per e-mail'),
    L('These only take an unsubscribe by email. Your mail app opens with it filled in, addressed only to their unsubscribe address: press Send, then come back for the next.',
      'Deze afzenders nemen alleen een afmelding per e-mail aan. Je mailapp opent met de mail al ingevuld, alleen gericht aan hun afmeldadres: druk op Verstuur en kom terug voor de volgende.'),
    n => L(`Email ${n || ''}`, `${n || ''} mailen`), '')}

  ${wanted.length ? `
    <section class="card" id="sec-wanted">
      <h2>${L('Mail you seem to want', 'Mail die je lijkt te willen')} <span class="count">${wanted.length}</span></h2>
      <p class="small muted" style="max-width:62ch">${L('Kept out of every unsubscribe and every deletion letter, because of what you do with it. Changed your mind about one? Unsubscribe from it here.',
        'HoopUp slaat deze over bij uitschrijven en verwijderverzoeken, omdat je deze mail gebruikt. Wil je er toch vanaf? Schrijf je hier uit.')}</p>
      <div class="list">${wanted.map(b => `
        <div class="pick" style="cursor:default;flex-wrap:wrap">
          <span class="pick-name">${esc(nameOf(b))}<span class="aka">${esc(wantedWhy(b))}</span></span>
          <span class="pick-meta mono">${esc(b.site || '')}</span>
          <button class="link-btn" data-action="unkeep" data-id="${esc(b.id)}">${L('Unsubscribe anyway', 'Toch uitschrijven')}</button>
        </div>`).join('')}</div>
    </section>` : ''}

  ${kept.length ? `
    <section class="card" id="sec-kept">
      <h2>${L('Still mailing you', 'Mailen je nog steeds')} <span class="count bad">${kept.length}</span></h2>
      <p class="small muted" style="max-width:62ch">${L('These sent marketing more than ten days after you unsubscribed. After an unsubscribe they must stop. A deletion letter makes that enforceable, and it says they kept mailing, with the dates.',
        'Deze stuurden nog reclame, meer dan tien dagen nadat je je uitschreef. Na een afmelding moeten ze stoppen. Een verwijderverzoek maakt dat afdwingbaar, en de brief noemt dat ze bleven mailen, met de datums.')}</p>
      <div class="list">${kept.map(b => `
        <div class="pick" style="cursor:default;flex-wrap:wrap">
          <span class="pick-name">${esc(nameOf(b))}</span>
          <span class="pick-meta mono">${esc(L(`unsubscribed ${b.unsubscribedAt} · mailed ${b.lastBulkAt}`, `uitgeschreven ${b.unsubscribedAt} · gemaild ${b.lastBulkAt}`))}</span>
          ${writable(b) ? `<a class="btn" href="#/letter?b=${encodeURIComponent(b.id)}">${L('Write to them', 'Schrijf ze aan')}</a>` : ''}
        </div>`).join('')}</div>
      ${state.profile?.country === 'NL' ? `<p class="small muted" style="margin:10px 0 0">${L(
        'Never bought anything from them, or never agreed to their mail? You can also report it to the ACM, the Dutch consumer regulator: <a href="https://www.acm.nl/nl/spamklacht" target="_blank" rel="noopener noreferrer">acm.nl/spamklacht</a>.',
        'Nooit iets bij ze gekocht, of nooit toestemming gegeven? Je kunt het ook melden bij de ACM: <a href="https://www.acm.nl/nl/spamklacht" target="_blank" rel="noopener noreferrer">acm.nl/spamklacht</a>.')}</p>` : ''}
    </section>` : ''}

  ${quiet.length ? `
    <section class="card" id="sec-done">
      <h2>${L('Already unsubscribed', 'Al uitgeschreven')} <span class="count">${quiet.length}</span></h2>
      <p class="small muted" style="max-width:60ch">${L('Done. Drop your junk mail in again in a couple of weeks: anyone who keeps mailing shows up above, with a letter ready.',
        'Klaar. Sleep over een paar weken je ongewenste mail opnieuw hierheen: wie blijft mailen verschijnt dan hierboven, met een brief klaar.')}</p>
      ${list(quiet, b => L(`unsubscribed ${b.unsubscribedAt}`, `uitgeschreven op ${b.unsubscribedAt}`))}
    </section>` : ''}

  ${bait.length + spam.length ? `<div id="sec-block">${blockAllCard(state)}</div>` : ''}

  ${spam.length ? `
    <section class="card" id="sec-spam">
      <h2>${L('Spam: block, do not reply', 'Spam: blokkeren, niet reageren')} <span class="count">${spam.length}</span></h2>
      <p class="small muted" style="max-width:60ch">${L('These are unsafe (the reason is shown per sender) and offered no way to unsubscribe. Do not click anything in them, and do not send them a letter: any response confirms a person reads this mailbox.',
        'Deze zijn onveilig (de reden staat per afzender) en boden geen manier om je uit te schrijven. Klik nergens op en stuur geen brief: elke reactie bevestigt dat er een mens deze mailbox leest.')}</p>
      ${list(spam, b => unsafeReason(b) + (b.site ? ' · ' + b.site : ''))}
    </section>` : ''}

  ${unclear.length ? `
    <section class="card" id="sec-unclear">
      <h2>${L('Could not verify', 'Niet te controleren')} <span class="count">${unclear.length}</span></h2>
      <p class="small muted" style="max-width:60ch">${L('HoopUp cannot tell who really sent these: the sender check could not confirm it, or the name does not match the domain it came from (a "USPS" mailing from an unrelated domain). A sender that is not who it claims to be would send an unsubscribe link straight to the spammer, so HoopUp does not open their links, block them or write to them. If you recognise the company, add it yourself under <a href="#/delete">Delete data</a>. If you do not, mark the mail as junk and click nothing in it.',
        'HoopUp kan niet zien wie deze mail echt stuurde: de afzendercontrole kon het niet bevestigen, of de naam past niet bij het domein waar de mail vandaan kwam (een "USPS" die mailt vanaf een onbekend domein). Een afzender die niet is wie hij zegt, stuurt een uitschrijflink die rechtstreeks naar de spammer leidt. Daarom opent HoopUp hun links niet, blokkeren we ze niet en schrijven we ze niet aan. Ken je het bedrijf, voeg het dan zelf toe bij <a href="#/delete">Gegevens verwijderen</a>. Ken je het niet, markeer de mail als ongewenst en klik nergens op.')}</p>
      ${list(unclear, b => b.trust !== 'verified' ? L('not verified', 'niet gecontroleerd') + ' · ' + (b.site || '') : L(`name does not match ${b.site}`, `naam past niet bij ${b.site}`))}
    </section>` : ''}

  ${people.length ? `
    <section class="card" id="sec-people">
      <h2>${L('Personal addresses', 'Persoonlijke adressen')} <span class="count">${people.length}</span></h2>
      <p class="small muted" style="max-width:60ch">${L('Sent from a personal account on a free mail service (Gmail, Outlook, Ziggo…), so there is no company to unsubscribe from or write to, and the service itself is never blocked. If you do not know the sender, mark the mail as junk in your mail app; never reply.',
        'Verstuurd vanaf een persoonlijk account bij een gratis maildienst (Gmail, Outlook, Ziggo…). Er is dus geen bedrijf om je bij uit te schrijven of aan te schrijven, en de maildienst zelf blokkeren we nooit. Ken je de afzender niet, markeer de mail dan als ongewenst in je mailapp en reageer nooit.')}</p>
      ${list(people, b => String(b.id || '').replace(/^mail:/, '').replace(/#forged$/, ''))}
    </section>` : ''}

  <div id="sec-offline">${offlineCard(state)}</div>`;
}


// Mail on the doormat and sales calls: no file to drop, but the same right to
// be left alone. Per country, because the opt-out registers are national.
const ext = (href, text) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
export function offlineCard(state) {
  const c = state.profile?.country || 'NL';
  const items = c === 'NL' ? [
    L(`<b>Advertising post with your name on it:</b> sign up at ${ext('https://www.postfilter.nl', 'Postfilter')}. It is free, takes up to six weeks to work, and lasts six years. Companies you are or were a customer of fall outside it: the letter under <a href="#/delete">Delete data</a> tells them to stop marketing by post as well.`,
      `<b>Reclamepost op je naam:</b> schrijf je in bij ${ext('https://www.postfilter.nl', 'Postfilter')}. Het is gratis, werkt binnen zes weken en geldt zes jaar. Bedrijven waar je klant bent of was vallen erbuiten: de brief bij <a href="#/delete">Gegevens verwijderen</a> laat ook hen stoppen met reclame per post.`),
    L('<b>Folders without your name:</b> a Nee/Nee sticker (no folders, no free local papers) or a Nee/Ja sticker (no folders, but the local paper) on your letterbox. Most municipalities hand them out for free.',
      '<b>Folders zonder naam:</b> een Nee/Nee-sticker (geen folders en geen huis-aan-huisbladen) of een Nee/Ja-sticker (geen folders, wel de huis-aan-huiskrant) op je brievenbus. De meeste gemeenten geven ze gratis.'),
    L(`<b>Sales calls:</b> since 1 July 2021 a company may only call you to sell something if you agreed to it, or if you are (or recently were) its customer. Tell the caller you do not want to be called again: they must stop. A call you never agreed to can be reported to ${ext('https://www.consuwijzer.nl', 'ACM ConsuWijzer')}. To get the company to erase your number too, add the number under <a href="#/find">More ways to find</a>, at Spam calls and texts.`,
      `<b>Verkoopgesprekken aan de telefoon:</b> sinds 1 juli 2021 mag een bedrijf je alleen bellen om iets te verkopen als je daar toestemming voor gaf, of als je er klant bent (of kort geleden was). Zeg dat je niet meer gebeld wilt worden: dan moeten ze stoppen. Een telefoontje waar je nooit mee instemde meld je bij ${ext('https://www.consuwijzer.nl', 'ACM ConsuWijzer')}. Wil je dat het bedrijf ook je nummer wist, voeg het nummer dan toe bij <a href="#/find">Meer manieren om te vinden</a>, onder Spamtelefoontjes en -sms.`),
    L(`<b>Spam by text message:</b> report it at ${ext('https://www.acm.nl/nl/spamklacht', 'acm.nl/spamklacht')} if you never agreed to it. A text that tries to get your bank details or login is fraud, not spam: report that to the ${ext('https://www.fraudehelpdesk.nl', 'Fraudehelpdesk')}.`,
      `<b>Spam per sms:</b> meld het op ${ext('https://www.acm.nl/nl/spamklacht', 'acm.nl/spamklacht')} als je er nooit toestemming voor gaf. Een sms die je bankgegevens of inlog probeert te krijgen is fraude, geen spam: meld die bij de ${ext('https://www.fraudehelpdesk.nl', 'Fraudehelpdesk')}.`)
  ] : c === 'BE' ? [
    L(`<b>Advertising post and calls:</b> the ${ext('https://www.robinson.be', 'Robinson list')} stops addressed advertising post, and the ${ext('https://www.dncm.be', 'Do Not Call Me list')} stops sales calls. Both are free.`,
      `<b>Reclamepost en telefoontjes:</b> de ${ext('https://www.robinson.be', 'Robinsonlijst')} stopt geadresseerde reclamepost, en de ${ext('https://www.dncm.be', 'Bel-me-niet-meer-lijst')} stopt verkoopgesprekken. Beide zijn gratis.`)
  ] : c === 'UK' ? [
    L(`<b>Advertising post:</b> register with the ${ext('https://www.mpsonline.org.uk', 'Mailing Preference Service')}. <b>Sales calls:</b> register with the ${ext('https://www.tpsonline.org.uk', 'Telephone Preference Service')}. Both are free.`,
      `<b>Reclamepost:</b> schrijf je in bij de ${ext('https://www.mpsonline.org.uk', 'Mailing Preference Service')}. <b>Verkoopgesprekken:</b> schrijf je in bij de ${ext('https://www.tpsonline.org.uk', 'Telephone Preference Service')}. Beide zijn gratis.`)
  ] : c === 'US' ? [
    L(`<b>Sales calls:</b> the ${ext('https://www.donotcall.gov', 'National Do Not Call Registry')}. <b>Pre-approved credit offers:</b> ${ext('https://www.optoutprescreen.com', 'OptOutPrescreen')}. <b>Catalogs and advertising post:</b> ${ext('https://www.dmachoice.org', 'DMAchoice')}.`,
      `<b>Verkoopgesprekken:</b> de ${ext('https://www.donotcall.gov', 'National Do Not Call Registry')}. <b>Vooraf goedgekeurde kredietaanbiedingen:</b> ${ext('https://www.optoutprescreen.com', 'OptOutPrescreen')}. <b>Catalogi en reclamepost:</b> ${ext('https://www.dmachoice.org', 'DMAchoice')}.`)
  ] : [
    L('<b>Advertising post and sales calls:</b> most countries keep a free national opt-out list for both. Your consumer authority can tell you which, and the letter under <a href="#/delete">Delete data</a> stops a company you can name, by post and phone as well.',
      '<b>Reclamepost en verkoopgesprekken:</b> de meeste landen hebben voor allebei een gratis landelijke afmeldlijst. Je consumentenautoriteit weet welke, en de brief bij <a href="#/delete">Gegevens verwijderen</a> stopt een bedrijf dat je kunt noemen, ook per post en telefoon.')
  ];
  return `
  <section class="card">
    <h2>${L('Post on the doormat and sales calls', 'Reclame op de mat en aan de telefoon')}</h2>
    <p class="small muted" style="max-width:62ch">${L(`Not in your mailbox, so not in a file to drop. For ${c === 'other' ? 'your country' : c}; change the country in <a href="#/profile">Settings</a>.`,
      `Niet in je mailbox, dus niet in een bestand te slepen. Voor ${c === 'other' ? 'jouw land' : c}; wijzig het land bij <a href="#/profile">Instellingen</a>.`)}</p>
    <ul class="small">${items.map(i => `<li>${i}</li>`).join('')}</ul>
  </section>`;
}

// ---------------------------------------------------------------- block all

const CLIENTS = () => ({
  apple:      'Apple Mail / iCloud',
  outlookmac: 'Outlook for Mac',
  outlookwin: L('Outlook (classic)', 'Outlook (klassiek)'),
  outlooknew: L('New Outlook', 'Nieuwe Outlook'),
  outlookcom: L('Outlook.com / Hotmail (browser)', 'Outlook.com / Hotmail (browser)'),
  gmail:      'Gmail',
  sieve:      L('Fastmail, Proton & others', 'Fastmail, Proton & andere')
});
// What can run where: a script for Apple Mail only on a Mac, one for classic
// Outlook only on Windows. Outlook for Mac and the new Outlook run no scripts
// at all; they use the rules kept on the Outlook.com account, which is where
// the Outlook.com route puts them.
const SYSTEMS = () => ({ mac: 'Mac', windows: 'Windows', other: L('Phone, tablet or other', 'Telefoon, tablet of anders') });
const CLIENTS_ON = { mac: ['apple', 'outlookmac', 'outlookcom', 'gmail', 'sieve'], windows: ['outlookwin', 'outlooknew', 'outlookcom', 'gmail', 'sieve'], other: ['outlookcom', 'gmail', 'sieve'] };
let blockClient = null, blockSystem = null;

export function detectSystem() {
  const ua = navigator.userAgent || '';
  const platform = (navigator.userAgentData?.platform || navigator.platform || '') + ' ' + ua;
  // An iPad asks for the desktop site as a Mac, but has a touch screen.
  if (/iPhone|iPad|Android|Mobile/i.test(ua) || (/Mac/i.test(platform) && navigator.maxTouchPoints > 1)) return 'other';
  if (/Mac/i.test(platform)) return 'mac';
  if (/Win/i.test(platform)) return 'windows';
  return 'other';
}

// The best mail app to start with on this computer, for this address.
function defaultClient(system, provider) {
  if (provider === 'google') return 'gmail';
  // One click on Microsoft's server beats anything on one computer.
  if (provider === 'microsoft' && outlookAvailable()) return 'outlookcom';
  if (system === 'mac') return 'apple';
  if (system === 'windows') return 'outlookwin';
  return provider === 'microsoft' ? 'outlookcom' : 'sieve';
}

// What the user has confirmed adding to their mail app ("Done"). An older
// "exported" record counts too: before the Done button existed, downloading
// the list was the only signal there was.
// Never block what the user wrote to, starred or filed, whatever it looks like.
export const isBlockable = t => ['spam', 'bait'].includes(senderClass(t)) && !keptByUser(t);
const blockClass = t => keptByUser(t) && ['spam', 'bait'].includes(senderClass(t)) ? 'kept' : senderClass(t);
export const blockDoneIds = state => new Set(state.blockDone?.ids || state.blockExport?.ids || []);
export const blockDoneAt = state => state.blockDone?.at || state.blockExport?.at || '';
export const ruleCount = bl => bl.links.length + bl.replyTo.length + bl.sharedReplyTo.length;
// Whether the rules catch this sender: one of its link sites or reply
// addresses is in them. A sender that left neither cannot be caught by a rule.
export function coveredBy(bl, t) {
  const reply = new Set([...bl.replyTo, ...bl.sharedReplyTo]);
  return bl.links.includes(t.site) || (t.linkDomains || []).some(d => bl.links.includes(d))
    || (t.replyToHosts || []).map(cleanHost).some(h => reply.has(h));
}
let showAllRules = false;

// The rules still to add. After a "Done", a new batch shows only rules the
// earlier ones do not already contain: new senders often reuse the same link
// sites, and those need nothing at all.
export function blockView(state, all = showAllRules) {
  const full = buildBlockList(state.custom, blockClass);
  const doneIds = blockDoneIds(state);
  if (!doneIds.size || all) return { bl: full, delta: false };
  const done = buildBlockList(state.custom.filter(t => !isBlockable(t) || doneIds.has(t.id)), blockClass);
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

// Whose servers the scanned scams went to: decides what works best.
function mailProvider(state) {
  const votes = {};
  for (const t of state.custom.filter(isBlockable)) {
    const a = String(t.evidence?.address || '').toLowerCase();
    const k = /@(outlook|hotmail|live|msn)\./.test(a) ? 'microsoft' : /@(gmail|googlemail)\./.test(a) ? 'google'
      : /@(icloud|me|mac)\./.test(a) ? 'icloud' : a ? 'other' : '';
    if (k) votes[k] = (votes[k] || 0) + 1;
  }
  return Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] || 'other';
}

// The short version: what to do, for this address in this mail app, in at
// most three lines. The panel below it has the clicks.
export function blockAdvice(provider, client, n, system = 'other') {
  const outlookJunk = ext('https://outlook.live.com/mail/0/junkemail', 'outlook.com');
  const learn = {
    microsoft: L('<b>On your phone or the web:</b> mark anything that still gets through as junk. Microsoft\'s filter learns from it.',
      '<b>Op je telefoon of het web:</b> markeer wat er nog doorkomt als ongewenst. Het filter van Microsoft leert daarvan.'),
    google: L('<b>Anything that still gets through:</b> <i>Report spam</i>. Gmail learns from it.',
      '<b>Wat er nog doorkomt:</b> <i>Spam melden</i>. Gmail leert daarvan.'),
    icloud: L('<b>On your iPhone:</b> move anything that still gets through to Junk. Apple\'s filter learns from it.',
      '<b>Op je iPhone:</b> verplaats wat er nog doorkomt naar Ongewenst. Het filter van Apple leert daarvan.')
  };
  const appleRule = L('<b>New scams:</b> add the Apple Mail rule below, with one paste. It deletes them as they arrive, while Mail is open on your Mac.',
    '<b>Nieuwe oplichters:</b> zet met één keer plakken de Apple Mail-regel hieronder erin. Die verwijdert ze zodra ze binnenkomen, zolang Mail op je Mac open staat.');
  const emptyJunk = L(`<b>Scams already in Junk:</b> empty that folder on ${outlookJunk} (<i>Junk Email</i> → <i>Empty folder</i>).`,
    `<b>Oplichters die al in Ongewenst staan:</b> leeg die map op ${outlookJunk} (<i>Ongewenste e-mail</i> → <i>Map leegmaken</i>).`);
  const outlookWeb = [
    L(`Outlook.com on the web takes rules one value at a time (${n} here). Do you also use <b>Apple Mail</b> on a Mac or <b>Outlook</b> on a Windows PC? Choose that above: there one paste does it all.`,
      `Outlook.com op het web neemt regels één waarde tegelijk aan (hier ${n}). Gebruik je ook <b>Apple Mail</b> op een Mac of <b>Outlook</b> op een Windows-pc? Kies dat hierboven: daar is het één keer plakken.`),
    L('Otherwise, step through them below; it takes a few minutes.', 'Anders loop je ze hieronder een voor een door; dat kost een paar minuten.') + ' ' + emptyJunk];
  let lines;
  if (provider === 'microsoft') {
    if (outlookAvailable() && client === 'outlookcom') lines = [
      L('<b>One click:</b> add the rules to Outlook.com below. They run on Microsoft\'s server: on your phone too, and with your computer off.',
        '<b>Eén klik:</b> zet de regels hieronder in Outlook.com. Ze draaien op de server van Microsoft: ook op je telefoon, en als je computer uit staat.'),
      emptyJunk, learn.microsoft];
    else if (client === 'apple') lines = [
      outlookAvailable() ? L('<b>Best:</b> choose <b>Outlook.com / Hotmail</b> above and add the rules with one click, on Microsoft\'s server.',
        '<b>Het beste:</b> kies hierboven <b>Outlook.com / Hotmail</b> en zet de regels er met één klik in, op de server van Microsoft.') : appleRule,
      emptyJunk + ' ' + L('Do not run the rule over Junk yourself: Mail cannot move damaged spam to your Outlook.com bin, and shows an error for each one.',
        'Laat de regel niet zelf over Ongewenst lopen: Mail kan beschadigde spam niet naar je Outlook.com-prullenbak verplaatsen en geeft dan per bericht een foutmelding.'),
      learn.microsoft];
    else if (client === 'outlookwin') lines = [
      L('<b>Once:</b> paste the script below into PowerShell. It adds the rules to Outlook and clears what is already in Junk and Inbox.',
        '<b>Eén keer:</b> plak het script hieronder in PowerShell. Het zet de regels in Outlook en ruimt op wat er al in Ongewenste e-mail en Postvak IN staat.'),
      learn.microsoft];
    else if (client === 'outlookcom') lines = [...outlookWeb, learn.microsoft];
    else if (client === 'outlookmac' || client === 'outlooknew') lines = [
      L(`${CLIENTS()[client]} runs no scripts: it uses the rules on your Outlook.com account. Add them there once, and they work in ${CLIENTS()[client]}, on your phone and on the web.`,
        `${CLIENTS()[client]} draait geen scripts: het gebruikt de regels van je Outlook.com-account. Zet ze daar één keer in, dan werken ze in ${CLIENTS()[client]}, op je telefoon en op het web.`),
      outlookAvailable() ? L('<b>One click</b> below does it.', '<b>Eén klik</b> hieronder regelt het.')
        : (client === 'outlookmac'
          ? L(`Outlook.com takes them one value at a time (${n} here). Quicker: if this account is also in <b>Apple Mail</b>, choose that above, where one paste does it all.`,
              `Outlook.com neemt ze één waarde tegelijk aan (hier ${n}). Sneller: staat dit account ook in <b>Apple Mail</b>, kies dat dan hierboven, daar is het één keer plakken.`)
          : L(`Outlook.com takes them one value at a time (${n} here). Quicker: if you still have <b>classic Outlook</b> (the switch at the top right of the new one), choose <b>Outlook (classic)</b> above, where one paste does it all.`,
              `Outlook.com neemt ze één waarde tegelijk aan (hier ${n}). Sneller: heb je nog <b>klassiek Outlook</b> (de schakelaar rechtsboven in de nieuwe), kies dan hierboven <b>Outlook (klassiek)</b>, daar is het één keer plakken.`)) + ' ' + emptyJunk,
      learn.microsoft];
    else {
      const fit = CLIENTS_ON[system].filter(k => /^(apple|outlook)/.test(k)).map(k => `<b>${CLIENTS()[k]}</b>`).join(', ');
      lines = [L(`Your address is on Outlook.com or Hotmail. Choose the app you read it in above: ${fit}.`,
        `Je adres is van Outlook.com of Hotmail. Kies hierboven de app waarin je het leest: ${fit}.`)];
    }
  } else if (provider === 'google') {
    lines = client === 'gmail' ? [
      L('<b>Once:</b> import the filter file below. Gmail then deletes these scams on Google\'s server, on every device.',
        '<b>Eén keer:</b> importeer het filterbestand hieronder. Gmail verwijdert deze oplichters dan op de server van Google, op elk apparaat.'),
      L('Tick <i>Also apply filter to matching conversations</i> while importing: that clears what is already there too.',
        'Vink bij het importeren <i>Filter ook toepassen op overeenkomende gesprekken</i> aan: dan verdwijnt ook wat er al staat.'),
      learn.google
    ] : [L('Your address is Gmail. Gmail\'s own filters work best: on Google\'s server, on every device. Choose <b>Gmail</b> above.',
      'Je adres is van Gmail. De eigen filters van Gmail werken het best: op de server van Google, op elk apparaat. Kies hierboven <b>Gmail</b>.')];
  } else if (provider === 'icloud') {
    lines = client === 'apple' ? [appleRule,
      L('<b>Scams already in Junk:</b> in Mail, open Junk, select all (<b>⌘A</b>) and press Delete.', '<b>Oplichters die al in Ongewenst staan:</b> open in Mail Ongewenst, selecteer alles (<b>⌘A</b>) en druk op Delete.'),
      learn.icloud
    ] : system === 'mac' ? [L('Your address is iCloud. iCloud\'s own rules cannot look at links, so choose <b>Apple Mail</b> above.',
      'Je adres is van iCloud. De eigen regels van iCloud kunnen niet naar links kijken, dus kies hierboven <b>Apple Mail</b>.')]
      : [L('Your address is iCloud. iCloud\'s own rules cannot look at links; only Apple Mail on a Mac can. Have a Mac? Choose <b>Mac</b> above.',
        'Je adres is van iCloud. De eigen regels van iCloud kunnen niet naar links kijken; alleen Apple Mail op een Mac kan dat. Heb je een Mac? Kies hierboven <b>Mac</b>.'), learn.icloud];
  } else {
    lines = client === 'sieve' ? [L('<b>Once:</b> copy the version for your mail service below and paste it in its filter settings. It runs on their server, on every device.',
      '<b>Eén keer:</b> kopieer hieronder de versie voor je maildienst en plak die in de filterinstellingen. Hij draait op hun server, op elk apparaat.')]
      : client === 'apple' ? [appleRule, L('<b>Scams already in Junk:</b> in Mail, open Junk, select all (<b>⌘A</b>) and press Delete.', '<b>Oplichters die al in Ongewenst staan:</b> open in Mail Ongewenst, selecteer alles (<b>⌘A</b>) en druk op Delete.')]
      : client === 'outlookwin' ? [L('<b>Once:</b> paste the script below into PowerShell. It adds the rules to Outlook and clears what is already in Junk and Inbox.',
        '<b>Eén keer:</b> plak het script hieronder in PowerShell. Het zet de regels in Outlook en ruimt op wat er al in Ongewenste e-mail en Postvak IN staat.')]
      : client === 'outlookcom' ? (outlookAvailable() ? [] : outlookWeb)
      : [];
  }
  if (!lines.length) return '';
  return `<div class="notice advice"><p><b>${L('Best way for you', 'Zo doe je het het best')}</b></p>
    <ol class="small">${lines.map(l => `<li>${l}</li>`).join('')}</ol></div>`;
}

export function blockAllCard(state, { closable = false } = {}) {
  const view = blockView(state);
  const bl = view.bl;
  const provider = mailProvider(state);
  if (!blockSystem) blockSystem = state.system || (state.mailApp === 'apple' ? 'mac' : state.mailApp === 'outlookwin' ? 'windows' : detectSystem());
  if (!blockClient) blockClient = state.mailApp || defaultClient(blockSystem, provider);
  if (!CLIENTS_ON[blockSystem].includes(blockClient)) blockClient = defaultClient(blockSystem, provider);
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
        <p class="small muted" style="max-width:58ch;margin:0">${L('Only unsafe senders are blocked, never a real company. The rules target what these campaigns reuse: the sites their links go to and where replies go. Not the From address, which in forged mail is made up or borrowed from a real company.',
          'Alleen onveilige afzenders worden geblokkeerd, nooit een echt bedrijf. De regels richten zich op wat deze afzenders steeds opnieuw gebruiken: de websites waar hun links naartoe gaan en de adressen waar antwoorden heen gaan. Niet op het afzenderadres, want dat is bij nepmail verzonnen of geleend van een echt bedrijf.')}</p>
      </div>
      <div class="row block-pick">
        <select id="block-system" style="width:auto" aria-label="${L('Your computer', 'Je computer')}">
          ${Object.entries(SYSTEMS()).map(([k, v]) => `<option value="${k}" ${k === blockSystem ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
        <select id="block-client" style="width:auto" aria-label="${L('Your mail app', 'Je mailapp')}">
          ${CLIENTS_ON[blockSystem].map(k => `<option value="${k}" ${k === blockClient ? 'selected' : ''}>${CLIENTS()[k]}</option>`).join('')}
        </select>
        ${closable ? `<button class="link-btn" data-action="panel-close">${L('Close', 'Sluiten')}</button>` : ''}
      </div>
    </div>

    ${view.delta && !rules ? `
    <p class="small" style="margin-top:12px">${L(`The rules you added on ${at} already include every link site and reply address found so far. Drop in your next batch of junk mail, and only rules you do not have yet will show up here.`,
      `De regels die je op ${at} toevoegde, bevatten alle websites en antwoordadressen die tot nu toe gevonden zijn. Sleep je volgende lading ongewenste mail erin, dan verschijnen hier alleen regels die je nog niet hebt.`)}</p>
    <div class="row">${toggle}<button class="link-btn" data-action="block-reset">${L('Start over (e.g. new mail app)', 'Opnieuw beginnen (bijv. andere mailapp)')}</button></div>` : `
    <div class="block-facts small">
      <span><b>${bl.links.length}</b> ${plural(bl.links.length, 'link site', 'link sites', 'website', 'websites')}</span>
      <span><b>${reply}</b> ${plural(reply, 'reply address', 'reply addresses', 'antwoordadres', 'antwoordadressen')}</span>
    </div>
    ${view.delta ? `<p class="small">${L(`Only what is new since ${at}. Add these to the rules you made then, or make a new rule. Both work.`,
      `Alleen wat nieuw is sinds ${at}. Voeg ze toe aan de regels die je toen maakte, of maak een nieuwe regel. Allebei werkt.`)}</p>` : ''}

    ${rules ? `<div id="block-advice">${blockAdvice(provider, blockClient, rules, blockSystem)}</div>` : ''}
    <div id="block-panel">${rules ? blockPanel(bl, blockClient) : `<p class="small muted">${L('Nothing blockable yet: these senders left no reusable trace. Drop the messages in again so their links and reply addresses are recorded.',
      'Nog niets te blokkeren: deze afzenders lieten geen herbruikbaar spoor achter. Zet de mails er opnieuw in, zodat hun links en antwoordadressen worden vastgelegd.')}</p>`}</div>
    ${rules ? `
    <div class="block-done">
      <button class="primary" data-action="block-done">${L("I've added these rules", 'Ik heb deze regels toegevoegd')}</button>
      <span class="small muted">${L('HoopUp cannot see your mail app, so tell it. Next time, only new rules show up.',
        'HoopUp kan niet in je mailapp kijken, dus laat het hier weten. De volgende keer zie je alleen nieuwe regels.')}</span>
      ${toggle}
    </div>` : ''}`}
  </section>`;
}

function nextLabel(what, i, n) {
  if (i >= n) return L(`All ${n} copied ✓`, `Alle ${n} gekopieerd ✓`);
  return what === 'site'
    ? L(`Copy site ${i + 1} of ${n}`, `Kopieer site ${i + 1} van ${n}`)
    : L(`Copy address ${i + 1} of ${n}`, `Kopieer adres ${i + 1} van ${n}`);
}

export function blockPanel(bl, client) {
  const reply = [...bl.replyTo, ...bl.sharedReplyTo];
  // Outlook on the web takes one value per entry: a pasted list becomes a
  // single value that no message contains. One button hands them over in turn.
  const next = (list, arr, what) => `<button class="primary" data-action="copy-next" data-list="${list}" data-i="0">${nextLabel(what, 0, arr.length)}</button>`;
  const sharedNote = bl.sharedReplyTo.length ? `<p class="small muted">${bl.sharedReplyTo.map(esc).join(', ')}
    ${L(`${bl.sharedReplyTo.length === 1 ? 'is a mailing service' : 'are mailing services'} that legitimate senders use too, so ${bl.sharedReplyTo.length === 1 ? 'it is' : 'they are'} only matched as a reply address, never blocked outright.`,
        `${bl.sharedReplyTo.length === 1 ? 'is een maildienst die' : 'zijn maildiensten die'} ook door echte afzenders ${bl.sharedReplyTo.length === 1 ? 'wordt' : 'worden'} gebruikt. Daarom blokkeren we ${bl.sharedReplyTo.length === 1 ? 'die' : 'ze'} alleen als antwoordadres, nooit helemaal.`)}</p>` : '';
  const scriptBtn = fmt => `<div class="row"><button class="primary" data-action="copy-block" data-fmt="${fmt}">${L('Copy script', 'Kopieer script')}</button></div>`;

  const steps = {
    outlookcom: (outlookAvailable() ? `
      <div class="notice small">
        <p>${L('<b>Private, before you click:</b> you sign in on Microsoft\'s own page, so HoopUp never sees your password. There is no HoopUp server in between: your browser talks to Microsoft directly. HoopUp asks only to change your mailbox settings, where rules live, not to read or send your mail, and forgets that permission straight after.',
          '<b>Privé, voor je klikt:</b> je logt in op de eigen pagina van Microsoft, dus HoopUp ziet je wachtwoord nooit. Er zit geen server van HoopUp tussen: je browser praat rechtstreeks met Microsoft. HoopUp vraagt alleen toestemming om je mailboxinstellingen te wijzigen, waar de regels staan, niet om je mail te lezen of te versturen, en vergeet die toestemming meteen daarna.')}</p>
        <p>${L('Microsoft then asks whether HoopUp may do that. It may call the app unverified: that only means HoopUp is a small project without a Microsoft partner account.',
          'Microsoft vraagt je daarna of HoopUp dat mag. Daar kan staan dat de app niet geverifieerd is: dat betekent alleen dat HoopUp een klein project is zonder partneraccount bij Microsoft.')}</p>
      </div>
      <div class="row"><button class="primary" data-action="outlook-connect">${L('Add the rules to Outlook.com', 'Zet de regels in Outlook.com')}</button></div>
      <p class="small">${L('The rules run on Microsoft\'s server, so they also work on your phone and when your computer is off. Earlier HoopUp rules are replaced; your own rules stay.',
        'De regels draaien op de server van Microsoft, dus ze werken ook op je telefoon en als je computer uit staat. Eerdere HoopUp-regels worden vervangen; je eigen regels blijven staan.')}</p>
      <details class="small"><summary>${L('Or add them by hand', 'Of zet ze er zelf in')}</summary>` : `
      `) + `
      <ol class="small">
        ${bl.links.length ? `<li>${L('<b>Settings</b> (gear) → <b>Mail</b> → <b>Rules</b> → <b>Add new rule</b>. Name it <i>HoopUp – links</i>, condition <b>Subject or body includes</b>.',
          '<b>Instellingen</b> (tandwiel) → <b>E-mail</b> → <b>Regels</b> → <b>Nieuwe regel toevoegen</b>. Noem hem <i>HoopUp – links</i>, voorwaarde <b>Onderwerp of hoofdtekst bevat</b>.')}</li>
        <li>${L('Click the button, paste in the box, press <b>Enter</b>. Repeat until the button says done:', 'Klik op de knop, plak in het vak, druk op <b>Enter</b>. Herhaal tot de knop zegt dat het klaar is:')}
          <div class="row">${next('links', bl.links, 'site')}</div></li>
        <li>${L('Action <b>Delete</b>, tick <b>Run rule now</b>, Save.', 'Actie <b>Verwijderen</b>, vink <b>Regel nu uitvoeren</b> aan, Opslaan.')}</li>` : ''}
        ${reply.length ? `<li>${bl.links.length
          ? L('Same again for a second rule, <i>HoopUp – replies</i>, condition <b>Message header includes</b>:', 'Hetzelfde voor een tweede regel, <i>HoopUp – antwoorden</i>, voorwaarde <b>Berichtkop bevat</b>:')
          : L('<b>Settings</b> (gear) → <b>Mail</b> → <b>Rules</b> → <b>Add new rule</b>, named <i>HoopUp – replies</i>, condition <b>Message header includes</b>. Click the button, paste, press <b>Enter</b>, until the button says done. Action <b>Delete</b>, tick <b>Run rule now</b>, Save:',
              '<b>Instellingen</b> (tandwiel) → <b>E-mail</b> → <b>Regels</b> → <b>Nieuwe regel toevoegen</b>, met de naam <i>HoopUp – antwoorden</i>, voorwaarde <b>Berichtkop bevat</b>. Klik op de knop, plak, druk op <b>Enter</b>, tot de knop zegt dat het klaar is. Actie <b>Verwijderen</b>, vink <b>Regel nu uitvoeren</b> aan, Opslaan:')}
          <div class="row">${next('reply', reply, 'address')}</div></li>` : ''}
      </ol>
      <p class="small muted">${L('Outlook on the web takes one value at a time, which is why the button hands them over one by one. Two rules, because inside one Outlook rule every condition has to match at once.',
        'Outlook op het web neemt één waarde tegelijk aan, daarom geeft de knop ze een voor een. Twee regels, omdat binnen één Outlook-regel alle voorwaarden tegelijk moeten kloppen.')}</p>${outlookAvailable() ? '</details>' : ''}`,
    outlookwin: `
      <ol class="small">
        <li>${L('Copy the script:', 'Kopieer het script:')} ${scriptBtn('powershell')}</li>
        <li>${L('Open the Start menu, type <b>PowerShell</b> and open it.', 'Open het Startmenu, typ <b>PowerShell</b> en open het.')}</li>
        <li>${L('Paste (<b>Ctrl+V</b> or right-click) and press <b>Enter</b>. If Outlook asks to allow access, allow it.', 'Plak (<b>Ctrl+V</b> of rechtermuisknop) en druk op <b>Enter</b>. Vraagt Outlook om toegang, sta het toe.')}</li>
      </ol>
      <p class="small muted">${L('The script adds the rules to Outlook and clears the scams already in Junk and Inbox to Deleted Items. It reads nothing and sends nothing. For classic Outlook on Windows. The new Outlook and Outlook for Mac cannot run scripts: choose those above.',
        'Het script zet de regels in Outlook en ruimt de oplichtersmails die al in Ongewenste e-mail en Postvak IN staan op naar Verwijderde items. Het leest niets en verstuurt niets. Voor klassiek Outlook op Windows. Het nieuwe Outlook en Outlook voor Mac kunnen geen scripts draaien: kies die hierboven.')}</p>`,
    gmail: `
      <ol class="small">
        <li>${L('Download the filter file below.', 'Download hieronder het filterbestand.')}</li>
        <li>${L('<b>Settings</b> (gear) → <b>See all settings</b> → <b>Filters and Blocked Addresses</b>.',
               '<b>Instellingen</b> (tandwiel) → <b>Alle instellingen bekijken</b> → <b>Filters en geblokkeerde adressen</b>.')}</li>
        <li>${L('<b>Import filters</b> → choose <code>hoopup-filters.xml</code> → <b>Open file</b> → <b>Create filters</b>. Tick <i>Also apply to matching conversations</i> to clear what is already there.',
               '<b>Filters importeren</b> → kies <code>hoopup-filters.xml</code> → <b>Bestand openen</b> → <b>Filters maken</b>. Vink <i>Filter ook toepassen op overeenkomende gesprekken</i> aan om wat er al staat op te ruimen.')}</li>
      </ol>
      ${reply.length ? `<p class="small muted">${L('Gmail filters cannot look at the reply address, so the file uses the link sites.', 'Gmail-filters kunnen niet naar het antwoordadres kijken, dus het bestand gebruikt de websites.')}</p>` : ''}
      <div class="row"><button class="primary" data-action="dl-block" data-fmt="gmail" ${bl.links.length ? '' : 'disabled'}>${L('Download Gmail filters', 'Download Gmail-filters')}</button></div>
      ${bl.links.length ? `<p class="small"><b>${L('Or without a file:', 'Of zonder bestand:')}</b> ${L('copy this, paste it into the Gmail search bar, click <b>Show search options</b> (the sliders icon) → <b>Create filter</b> → tick <b>Delete it</b> → <b>Create filter</b>. The braces mean <i>any of these</i>, so one filter covers them all.',
        'kopieer dit, plak het in de zoekbalk van Gmail, klik op <b>Zoekopties weergeven</b> (het schuifjes-icoon) → <b>Filter maken</b> → vink <b>Verwijderen</b> aan → <b>Filter maken</b>. De accolades betekenen <i>een van deze</i>, dus één filter dekt ze allemaal.')}</p>
      <div class="row">${asGmailQueries(bl).map((q, i, all) => `<button data-action="copy-block" data-fmt="gmailq" data-i="${i}">${all.length > 1 ? L(`Copy filter ${i + 1} of ${all.length}`, `Kopieer filter ${i + 1} van ${all.length}`) : L('Copy filter', 'Kopieer filter')}</button>`).join('')}</div>` : ''}`,
    apple: `
      <ol class="small">
        <li>${L('Copy the script:', 'Kopieer het script:')} ${scriptBtn('applescript')}</li>
        <li>${L('Open <b>Script Editor</b>: press <b>⌘ Space</b>, type <i>Script Editor</i>, press Enter (choose <b>New Document</b> if asked).', 'Open <b>Scripteditor</b>: druk op <b>⌘ spatie</b>, typ <i>Scripteditor</i>, druk op Enter (kies <b>Nieuw document</b> als daarom wordt gevraagd).')}</li>
        <li>${L('Paste (<b>⌘V</b>) and click <b>▶</b> (Run). When macOS asks whether Script Editor may control Mail, click <b>OK</b>.', 'Plak (<b>⌘V</b>) en klik op <b>▶</b> (Start). Vraagt macOS of Scripteditor Mail mag bedienen, klik dan op <b>OK</b>.')}</li>
      </ol>
      <p class="small muted">${L('The script adds one rule to Mail (Settings → Rules), checks every condition it made, and tells you how many it added. It reads nothing and sends nothing.',
        'Het script zet één regel in Mail (Instellingen → Regels), controleert elke voorwaarde die het maakte en meldt hoeveel het er toevoegde. Het leest niets en verstuurt niets.')}</p>`,
    sieve: `
      <ol class="small">
        <li>${L('Copy the script for your mail service:', 'Kopieer het script voor je maildienst:')}
          <div class="row">
            <button class="primary" data-action="copy-block" data-fmt="sieve-fastmail">Fastmail</button>
            <button class="primary" data-action="copy-block" data-fmt="sieve-proton">Proton</button>
            <button data-action="copy-block" data-fmt="sieve-other">${L('Other (Junk folder)', 'Andere (map Junk)')}</button>
          </div></li>
        <li>${L('<b>Fastmail:</b> Settings → Filters &amp; Rules → <b>Edit custom Sieve code</b> → paste it in the last box, below the code Fastmail made → Save. <b>Proton:</b> Settings → Filters → <b>Add sieve filter</b> → give it a name, paste → Save.',
               '<b>Fastmail:</b> Settings → Filters &amp; Rules → <b>Edit custom Sieve code</b> → plak het in het laatste vak, onder de code die Fastmail maakte → Save. <b>Proton:</b> Instellingen → Filters → <b>Sieve-filter toevoegen</b> → geef het een naam, plak → Opslaan.')}</li>
      </ol>
      <p class="small muted">${L('Each version moves matches to that service\'s own spam folder. On Fastmail the folder name must be exact: if it does not exist, Fastmail leaves the mail in the inbox.',
        'Elke versie verplaatst wat matcht naar de eigen spammap van die dienst. Bij Fastmail moet de mapnaam precies kloppen: bestaat hij niet, dan laat Fastmail de mail in de inbox staan.')}</p>`
  };

  // Outlook for Mac and the new Outlook keep these rules on the account: the
  // same steps, done once on outlook.com.
  if (client === 'outlookmac' || client === 'outlooknew') steps[client] = `<p class="small">${L(
    `${CLIENTS()[client]} has no way to run a script, and its rules for an Outlook.com account are the ones on outlook.com. So set them up there, in your browser, once: they then appear in ${CLIENTS()[client]} too.`,
    `${CLIENTS()[client]} kan geen script draaien, en de regels voor een Outlook.com-account zijn die op outlook.com. Zet ze daar dus één keer in, in je browser: ze verschijnen dan ook in ${CLIENTS()[client]}.`)}</p>` + steps.outlookcom;
  return steps[client] + sharedNote + `
    <p class="small muted" style="margin-top:10px">${L('New variants keep coming: these operations change domains constantly. Scan your junk again in a few weeks and update the rules. The list grows each time. If one address gets little else, see <b>Your addresses</b> on Home.',
      'Er blijven nieuwe varianten komen: deze partijen wisselen voortdurend van domein. Scan over een paar weken je ongewenste mail opnieuw en werk de regels bij. De lijst groeit elke keer. Krijgt één adres weinig anders meer, kijk dan bij <b>Je adressen</b> op Home.')}</p>`;
}

export function blockText(state, fmt, i = 0) {
  const bl = blockView(state).bl;
  if (fmt === 'gmailq') return { text: asGmailQueries(bl)[i] || '', name: 'gmail-filter.txt', type: 'text/plain' };
  if (fmt === 'gmail') return { text: asGmailXml(bl), name: 'hoopup-filters.xml', type: 'application/xml' };
  if (/^sieve/.test(fmt)) return { text: asSieve(bl, fmt.split('-')[1]), name: 'hoopup.sieve', type: 'text/plain' };
  if (fmt === 'applescript') return { text: asAppleScript(bl, store.today()), name: 'hoopup.applescript', type: 'text/plain' };
  if (fmt === 'powershell') return { text: asPowerShell(bl, store.today()), name: 'hoopup.ps1', type: 'text/plain' };
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
    if (e.target.id === 'block-system') {
      blockSystem = e.target.value;
      blockClient = defaultClient(blockSystem, mailProvider(store.get()));
      store.update(st => { st.system = blockSystem; st.mailApp = blockClient; });
      redraw(e.target);
      return;
    }
    if (e.target.id !== 'block-client') return;
    blockClient = e.target.value;
    store.update(st => { st.mailApp = blockClient; st.system = blockSystem; });
    const bl = blockView(store.get()).bl;
    root.querySelector('#block-panel').innerHTML = blockPanel(bl, blockClient);
    const advice = root.querySelector('#block-advice');
    if (advice) advice.innerHTML = blockAdvice(mailProvider(store.get()), blockClient, bl.links.length + bl.replyTo.length + bl.sharedReplyTo.length, blockSystem);
  });
  root.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const act = btn.dataset.action;
    if (act === 'dl-block') {
      downloadText(blockText(store.get(), btn.dataset.fmt));
      toast(L('Downloaded. Import it, then press the button below', 'Gedownload. Importeer het en druk dan op de knop hieronder'));
    }
    if (act === 'copy-next') {
      const bl = blockView(store.get()).bl;
      const arr = btn.dataset.list === 'links' ? bl.links : [...bl.replyTo, ...bl.sharedReplyTo];
      const i = Number(btn.dataset.i);
      if (i >= arr.length) { btn.dataset.i = 0; btn.textContent = nextLabel(btn.dataset.list === 'links' ? 'site' : 'address', 0, arr.length); return; }
      navigator.clipboard.writeText(arr[i]).then(() => {
        btn.dataset.i = i + 1;
        btn.textContent = nextLabel(btn.dataset.list === 'links' ? 'site' : 'address', i + 1, arr.length);
        toast(L(`Copied ${arr[i]}. Paste it, press Enter`, `${arr[i]} gekopieerd. Plak het, druk op Enter`));
      }).catch(() => toast(L('Could not copy', 'Kopiëren mislukt')));
    }
    if (act === 'copy-block') {
      navigator.clipboard.writeText(blockText(store.get(), btn.dataset.fmt, Number(btn.dataset.i || 0)).text)
        .then(() => toast(['applescript', 'powershell'].includes(btn.dataset.fmt)
          ? L('Script copied. Now paste it', 'Script gekopieerd. Plak het nu') : L('Copied', 'Gekopieerd'))).catch(() => toast(L('Could not copy', 'Kopiëren mislukt')));
    }
    if (act === 'block-done') {
      const ids = store.get().custom.filter(isBlockable).map(t => t.id);
      showAllRules = false;
      store.update(st => { st.blockDone = { at: store.today(), ids }; delete st.blockExport; });
      toast(L('Marked as blocked. Next time, only new rules show up.', 'Gemarkeerd als geblokkeerd. De volgende keer verschijnen alleen nieuwe regels.'));
      if (onChange) onChange(); else redraw(btn);
    }
    if (act === 'outlook-connect') {
      btn.disabled = true;
      outlookStart().catch(() => { btn.disabled = false; toast(L('Could not start the Microsoft sign-in.', 'Kon de aanmelding bij Microsoft niet starten.')); });
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

// Back from Microsoft's sign-in: add the rules, say what happened, and count
// them as added, as the Done button would.
async function finishOutlook(root) {
  history.replaceState(null, '', location.pathname + location.search + '#/unsubscribe');
  const out = root.querySelector('#outlook-result');
  if (!out) return;
  out.innerHTML = `<div class="notice" aria-live="polite"><p>${L('Adding the rules to Outlook.com…', 'De regels worden in Outlook.com gezet…')}</p></div>`;
  out.scrollIntoView({ block: 'center' });
  const r = await outlookFinish(blockView(store.get(), true).bl);
  if (!r) { out.innerHTML = ''; return; }
  if (r.error) {
    out.innerHTML = `<div class="notice warn"><p><b>${r.error === 'denied'
      ? L('Microsoft did not give permission, so nothing was changed.', 'Microsoft gaf geen toestemming, dus er is niets veranderd.')
      : r.error === 'signin' ? L('The sign-in did not complete, so nothing was changed.', 'De aanmelding is niet afgerond, dus er is niets veranderd.')
      : L('Outlook.com did not accept the rules, so nothing was changed.', 'Outlook.com nam de regels niet aan, dus er is niets veranderd.')}</b>
      ${L('Try again, or add them by hand below. A work or school account may need its administrator\'s approval.', 'Probeer het opnieuw, of zet ze er hieronder zelf in. Bij een werk- of schoolaccount is soms toestemming van de beheerder nodig.')}</p></div>`;
    return;
  }
  const ids = store.get().custom.filter(isBlockable).map(t => t.id);
  showAllRules = false;
  store.update(st => { st.blockDone = { at: store.today(), ids }; delete st.blockExport; if (!/^outlook/.test(st.mailApp || '')) st.mailApp = 'outlookcom'; });
  const card = root.querySelector('.block-card');
  if (card) card.outerHTML = blockAllCard(store.get());
  out.innerHTML = `<div class="notice"><p><b>${L(`Done: ${r.added} ${r.added === 1 ? 'rule' : 'rules'} added to Outlook.com`, `Klaar: ${r.added} ${r.added === 1 ? 'regel' : 'regels'} in Outlook.com gezet`)}</b>
    (${L(`${r.sites} spam sites, ${r.replies} reply addresses`, `${r.sites} spamwebsites, ${r.replies} antwoordadressen`)}). ${L('New scams go straight to Deleted Items. Anything already in Junk is junk anyway: select all there and delete it.',
      'Nieuwe oplichtersmail gaat meteen naar Verwijderde items. Wat al in Ongewenste e-mail staat is sowieso rommel: selecteer daar alles en verwijder het.')}</p></div>`;
}

export function mountUnsubscribe(root, state, rerender, params) {
  wireBlock(root, state);
  wireQueue(root, rerender);
  if (params?.get('outlook') === '1') finishOutlook(root);

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

    if (act === 'jump') root.querySelector('#' + btn.dataset.to)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (act === 'keep' || act === 'unkeep') {
      e.preventDefault();
      const id = btn.dataset.id;
      store.update(st => { const t = st.custom.find(c => c.id === id); if (t) t.keep = act === 'keep'; });
      selected.delete(id);
      toast(act === 'keep' ? L('Kept: it will not be unsubscribed or written to.', 'Gehouden: hier word je niet uitgeschreven en er gaat geen brief heen.')
                           : L('Moved to the unsubscribe list. Tick it to unsubscribe.', 'Verplaatst naar de uitschrijflijst. Vink hem aan om je uit te schrijven.'));
      rerender();
      return;
    }
    if (act === 'sel-group') {
      const ids = state.custom.filter(b => unsubTier(b) === btn.dataset.group && !b.unsubscribedAt && !isWanted(b)).map(b => b.id);
      const allOn = ids.every(id => selected.has(id));
      ids.forEach(id => allOn ? selected.delete(id) : selected.add(id));
      rerender();
      return;
    }


    const pick = k => state.custom.filter(b => unsubTier(b) === k && selected.has(b.id) && !isWanted(b));
    if (act === 'run-instant') runOneClickBatch(root, pick('instant'), []);
    if (act === 'run-link')    startUnsubQueue(root, pick('link').map(b => ({ id: b.id, name: b.name, unsubUrl: b.unsubUrl })));
    if (act === 'run-mail')    startUnsubQueue(root, pick('mail').map(b => ({ id: b.id, name: b.name, unsubMailto: b.unsubMailto })));
  });
}

// ------------------------------------------------------------------- letter

// The last step on the letter page: mark it sent, or what marking it did.
function sentStep(rec, isReply) {
  if (!isReply && rec.sentAt && rec.status !== 'todo') return `<b>${L(`Marked as sent on ${esc(longDate(rec.sentAt, false))}.`, `Gemarkeerd als verstuurd op ${esc(longDate(rec.sentAt, true))}.`)}</b>
    ${L('The one-month deadline runs from then; HoopUp shows a reminder if they do not answer.', 'De termijn van een maand loopt vanaf dan; HoopUp zet een herinnering klaar als ze niet antwoorden.')}
    <div class="row"><a class="btn" href="#/delete">${L('Back to the list', 'Terug naar de lijst')}</a></div>`;
  return isReply
    ? `<b>${L('Mark your reply as sent here.', 'Markeer je reactie hier als verstuurd.')}</b> ${L('Their deadline keeps running.', 'Hun termijn loopt door.')}
      <div class="row"><button class="primary" data-action="mark-answered">${L('Mark reply as sent', 'Markeer reactie als verstuurd')}</button></div>`
    : `<b>${L('Mark it as sent here.', 'Markeer hem hier als verstuurd.')}</b> ${L('That starts their one-month deadline, and HoopUp reminds you if they do not answer.', 'Dan start hun termijn van een maand, en HoopUp herinnert je als ze niet antwoorden.')}
      <div class="row"><button class="primary" data-action="mark-sent">${L('Mark as sent', 'Markeer als verstuurd')}</button></div>`;
}

export function letter(state, catalog, params) {
  const targets = allTargets(state, catalog);
  const b = targets.find(x => x.id === params.get('b'));
  if (!b) return `<div class="card"><p>${L('Unknown target.', 'Onbekend bedrijf.')}
    <a href="#/delete">${L('Back to the list', 'Terug naar de lijst')}</a></p></div>`;

  const rec = store.getRequest(b.id);
  const tid = params.get('t') || suggestedTemplate(b, state.profile, rec);
  const { subject, body } = renderLetter(tid, b, state.profile, rec);
  // A reply to their answer goes back to whoever answered, unless that was an
  // address nobody reads.
  const isReply = tid.startsWith('reply_');
  const answeredFrom = lastAnswer(rec)?.from || '';
  const to = isReply && answeredFrom && !/^(no-?reply|do-?not-?reply|donotreply|noreply|mailer-daemon|postmaster)\b/i.test(answeredFrom)
    ? answeredFrom : recipient(b, rec);
  const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const tplLabel = (k, t) => L(t.label, TEMPLATE_LABELS_NL[k] || t.label);

  return `
  <div class="head no-print">
    <a class="back" href="#/delete">← ${L('Delete data', 'Gegevens verwijderen')}</a>
    <h1>${esc(nameOf(b))}</h1>
    <p>${L(`Read it before you send it. Delete any clause that does not apply to you: a request you can stand
    behind beats a maximalist one you cannot.`,
    `Lees hem door voor je hem verstuurt. Schrap wat niet op jou van toepassing is. Een verzoek waar je achter
    kunt staan werkt beter dan een maximaal verzoek dat je niet kunt onderbouwen.`)}</p>
  </div>

  ${isReply && lastAnswer(rec) ? `<div class="notice no-print">
    <p>${L(`Their answer of ${esc(answerText(lastAnswer(rec)))}. This reply goes back to <code>${esc(to)}</code>, on their subject, so it lands with their answer.`,
           `Hun antwoord van ${esc(answerText(lastAnswer(rec)))}. Deze reactie gaat terug naar <code>${esc(to)}</code>, met hun onderwerp, zodat hij bij hun antwoord terechtkomt.`)}</p>
  </div>` : ''}

  ${b.method === 'form' && safeUrl(b.optOutUrl) ? `<div class="notice no-print">
    <p>${L(`<strong>This one has a self-serve form.</strong> Use
    <a href="${esc(safeUrl(b.optOutUrl))}" target="_blank" rel="noopener noreferrer">their opt-out page</a> first:
    it is usually faster. Send this letter if the form fails, asks for ID, or nothing happens.`,
    `<strong>Dit bedrijf heeft een eigen formulier.</strong> Probeer eerst
    <a href="${esc(safeUrl(b.optOutUrl))}" target="_blank" rel="noopener noreferrer">hun afmeldpagina</a>:
    dat gaat meestal sneller. Stuur deze brief als het formulier niet werkt, om een ID vraagt of er niets gebeurt.`)}</p>
  </div>` : ''}

  ${letterLang(state.profile) === 'nl' && !writesDutch(b, state.profile) && !params.get('t') ? `<div class="notice no-print">
    <p>${L('This company works outside the Netherlands, so the letter is in English: a Dutch one would likely go unread. Pick a Dutch template below if you prefer.',
      'Dit bedrijf werkt buiten Nederland, dus de brief is in het Engels. Een Nederlandse brief wordt daar waarschijnlijk niet gelezen. Kies hieronder een Nederlands sjabloon als je dat liever hebt.')}</p>
  </div>` : ''}

  ${b.confidence === 'low' ? `<div class="notice warn no-print">
    <p>${L(`<strong>Unverified contact.</strong> <code>${esc(to || 'no address on file')}</code> is a guess based on
    their domain. Check their privacy policy for the real DPO address before sending, or it will bounce.`,
    `<strong>Adres niet gecontroleerd.</strong> <code>${esc(to || 'geen adres bekend')}</code> is een gok op basis van
    hun domein. Zoek in hun privacyverklaring het echte adres van de functionaris gegevensbescherming, anders komt de mail terug.`)}</p>
  </div>` : ''}

  <div class="card no-print">
    <div class="row">
      <label for="tpl" style="margin:0">${L('Template', 'Sjabloon')}</label>
      <select id="tpl" class="tpl-select">
        ${Object.entries(TEMPLATES).map(([k, t]) =>
          `<option value="${k}" ${k === tid ? 'selected' : ''}>${esc(tplLabel(k, t))}</option>`).join('')}
      </select>
    </div>
    <ol class="send-steps">
      <li><b>${to ? L('Open the letter in your mail app.', 'Open de brief in je mailapp.') : L('Copy the letter into a new mail to them.', 'Kopieer de brief naar een nieuwe mail aan hen.')}</b>
        ${to ? L(' The address, subject and text are filled in.', ' Adres, onderwerp en tekst staan er al in.') : ''}
        <div class="row">
          ${to ? `<a class="btn primary" href="${mailto}">${L('Open in mail app', 'Openen in je mailapp')}</a>` : ''}
          <button class="${to ? '' : 'primary'}" data-action="copy">${L('Copy letter', 'Brief kopiëren')}</button>
          <button data-action="print">${L('Print / PDF', 'Afdrukken / PDF')}</button>
        </div></li>
      <li><b>${L('Send it there.', 'Verstuur hem daar.')}</b> ${L('It goes from your own address, so their answer comes back to you.', 'Hij gaat vanaf je eigen adres, dus hun antwoord komt bij jou terug.')}</li>
      <li id="sent-step">${sentStep(rec, isReply)}</li>
    </ol>
  </div>

  <div class="card">
    <p class="small muted no-print">${L('To', 'Aan')}: <code>${esc(to || '?')}</code></p>
    <p class="small"><strong>${L('Subject', 'Onderwerp')}:</strong> ${esc(subject)}</p>
    <div class="letter" id="letter-body" tabindex="0" role="region" aria-label="${L('Letter text', 'Tekst van de brief')}">${esc(body)}</div>
  </div>

  <div class="card no-print">
    <h2>${L('Notes &amp; history', 'Notities &amp; geschiedenis')}</h2>
    <div class="field">
      <label for="notes">${L('Your notes on this company', 'Jouw notities over dit bedrijf')}</label>
      <textarea autocomplete="off" id="notes" placeholder="${L('Reference number they gave you, who replied, what they claimed…',
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
        toast(L('Selected. Press Cmd/Ctrl+C', 'Geselecteerd. Druk op Cmd/Ctrl+C'));
      }
    }
    if (a === 'print') window.print();
    if (a === 'mark-answered') {
      store.markAnswered(id);
      toast(L('Reply marked as sent. Their deadline keeps running.', 'Reactie gemarkeerd als verstuurd. Hun termijn loopt door.'));
      btn.disabled = true;
    }
    if (a === 'mark-sent') {
      store.setStatus(id, 'sent');
      toast(L('Marked as sent, deadline clock started', 'Gemarkeerd als verstuurd, de termijn loopt'));
      const step = root.querySelector('#sent-step');
      if (step) step.innerHTML = sentStep(store.getRequest(id), false);
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
    `Spam die al naar je adres komt, kun je niet tegenhouden. Je kunt wél voorkomen dat je echte adres nog
    vaker uitlekt: geef het nergens meer op.`)}</p>
  </div>

  <div class="card">
    <h2>${L('The system', 'De aanpak')}</h2>
    <ol>${L(`
      <li><strong>Keep your real address private.</strong> It goes to people you know, your bank, and the
      tax office. Nothing else, ever again.</li>
      <li><strong>One alias per company.</strong> On iCloud+ this is Hide My Email, built into Safari and
      Mail: unlimited, free with any paid iCloud plan. Fastmail, Proton, addy.io, SimpleLogin and
      DuckDuckGo Email Protection all do the same.</li>
      <li><strong>When an alias starts getting spam, you know who leaked it.</strong> Log it below, then
      delete the alias. The spam stops instantly, at the source, with no filter to maintain.</li>
      <li><strong>Avoid plus-addressing</strong> (<code>you+shop@…</code>) for this. It is trivially stripped
      back to your real address, so it identifies the leaker but does not protect you.</li>`, `
      <li><strong>Houd je echte adres privé.</strong> Dat krijgen mensen die je kent, je bank en de
      Belastingdienst. Verder niemand meer.</li>
      <li><strong>Eén alias per bedrijf.</strong> Bij iCloud+ heet dit 'Verberg mijn e-mailadres', ingebouwd in
      Safari en Mail: onbeperkt, gratis bij elk betaald iCloud-abonnement. Fastmail, Proton, addy.io,
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
      <li><strong>Legitimate marketing you once signed up for:</strong> use the unsubscribe link. In the EU
      they must honour it, and you can cite Art. 21(3) GDPR if they do not.</li>
      <li><strong>Criminal spam and phishing:</strong> never click unsubscribe. It confirms a live human
      reads the mailbox and raises your value on the lists. Report as junk and delete.</li>
      <li><strong>Spam to an address you never gave out:</strong> it came from a breach or a broker. See
      <a href="#/find">who has your data</a>.</li>
      <li><strong>Extortion mail quoting a real password:</strong> it is from a breach dump, not a hacked
      camera. Change that password everywhere, ignore the rest.</li>
      <li><strong>Turn off remote images</strong> in your mail app. Tracking pixels confirm you opened it.</li>`, `
      <li><strong>Echte nieuwsbrieven waar je je ooit voor aanmeldde:</strong> gebruik de afmeldlink. In de EU
      moeten ze die honoreren; doen ze dat niet, verwijs dan naar art. 21 lid 3 AVG.</li>
      <li><strong>Criminele spam en phishing:</strong> klik nooit op afmelden. Dat bevestigt dat er een mens
      meeleest en maakt je adres meer waard. Markeer als ongewenst en verwijder.</li>
      <li><strong>Spam naar een adres dat je nooit hebt opgegeven:</strong> dat komt uit een datalek of van een
      databroker. Bekijk <a href="#/find">wie je gegevens heeft</a>.</li>
      <li><strong>Afpersingsmail met een echt wachtwoord:</strong> dat komt uit een gelekte database, niet van
      een gehackte camera. Wijzig dat wachtwoord overal en negeer de rest.</li>
      <li><strong>Zet externe afbeeldingen uit</strong> in je mailapp. Trackingpixels verraden dat je de mail opende.</li>`)}
    </ul>
  </div>

  <div class="card">
    <h2>${L('Alias tracker', 'Alias-logboek')} <span class="muted small">${aliases.length} ${L('tracked', 'vastgelegd')}${
      burned.length ? `, ${burned.length} ${L('burned', 'verbrand')}` : ''}</span></h2>
    <p class="small muted">${L(`Log which alias you gave to which company. When spam turns up, this tells you who
    sold or leaked it, and that company becomes a target for an erasure request.`,
    `Leg vast welke alias je aan welk bedrijf gaf. Komt er spam op binnen, dan weet je wie hem verkocht of
    lekte, en dat bedrijf krijgt een verwijderverzoek.`)}</p>
    <div class="row">
      <input autocomplete="off" id="al-alias" placeholder="alias@icloud.com" style="flex:1;min-width:180px">
      <input autocomplete="off" id="al-service" placeholder="${L('Company it was given to', 'Bedrijf dat hem kreeg')}" style="flex:1;min-width:160px">
      <button class="primary" data-action="add-alias">${L('Add', 'Toevoegen')}</button>
    </div>
    ${aliases.length ? `<div style="margin-top:12px">${aliases.map(a => `
      <div class="item">
        <div class="body">
          <div class="name mono">${esc(a.alias)}
            ${a.status === 'burned' ? `<span class="pill overdue">${L('burned', 'verbrand')}</span>` : ''}
            ${a.spamSeen ? `<span class="pill escalated">${a.spamSeen} spam</span>` : ''}</div>
          <div class="meta">${L('given to', 'gegeven aan')} ${esc(a.service || '?')} · ${esc(a.createdAt)}</div>
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
        'Vastgelegd. Blijft er spam op binnenkomen, markeer de alias dan als verbrand en stuur dat bedrijf een verzoek.'));
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
    <p>${L(`All optional. Letters to companies found in your mail never use these details: they identify you
    with exactly what that company's own mail shows. Your name, date of birth and address below only go into
    letters to the bundled data brokers (who cannot find you by an email address alone) and into a complaint
    to the regulator. Your addresses and phone numbers help HoopUp recognise which mail was sent to you.`,
    `Alles is optioneel. Brieven aan bedrijven uit je mail gebruiken deze gegevens nooit: die noemen precies
    wat de eigen mail van dat bedrijf laat zien. Je naam, geboortedatum en adres hieronder komen alleen in
    brieven aan de bekende databrokers (die je niet herkennen aan alleen een e-mailadres) en in een klacht bij
    de toezichthouder. Je adressen en telefoonnummers helpen HoopUp herkennen welke mail aan jou gericht was.`)}</p>
  </div>

  <div class="card">
    <h2>${L('Tools', 'Hulpmiddelen')}</h2>
    <div class="tool-links">
      <a href="#/aliases"><b>${L('Aliases', 'Aliassen')}</b><span>${L('One address per company, and a log of who leaked which',
        'Eén adres per bedrijf, en een logboek van wie welk adres lekte')}</span></a>
      <a href="#/unsubscribe"><b>${L('Unsubscribe &amp; block, in detail', 'Uitschrijven &amp; blokkeren in detail')}</b><span>${L(
        'Every sender, grouped, with block rules for your mail app', 'Alle afzenders, gegroepeerd, met blokkeerregels voor je mailapp')}</span></a>
      <a href="#/find"><b>${L('More ways to find who has your data', 'Meer manieren om te zien wie je gegevens heeft')}</b><span>${L(
        'Mailbox searches, breach records, data brokers, password check', 'Zoeken in je mailbox, datalekken, databrokers, wachtwoordcheck')}</span></a>
    </div>
  </div>

  <div class="notice">
    <p>${L(`Stored in this browser only, under <code>localStorage</code>. It is not encrypted: anyone with access
    to your unlocked computer and this browser profile can read it. Clearing site data wipes it, so keep a
    backup below.`,
    `Alleen opgeslagen in deze browser, in <code>localStorage</code>. Niet versleuteld: wie bij je ontgrendelde
    computer en dit browserprofiel kan, kan het lezen. Websitegegevens wissen haalt het weg, dus maak hieronder
    een back-up.`)}</p>
  </div>

  <div class="card">
    <div class="grid cols-2">
      <div class="field"><label for="fullName">${L('Full legal name', 'Volledige naam')}</label>
        <input autocomplete="off" id="fullName" value="${esc(p.fullName)}" placeholder="${L('As companies would have it', 'Zoals bedrijven hem kennen')}"></div>
      <div class="field"><label for="birthDate">${L('Date of birth', 'Geboortedatum')}</label>
        <input autocomplete="off" id="birthDate" type="date" value="${esc(p.birthDate)}"></div>
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
      <textarea autocomplete="off" id="emails" style="min-height:80px" placeholder="${L('Every address you have used to sign up anywhere',
        'Elk adres waarmee je je ooit ergens hebt aangemeld')}">${esc(p.emails.join('\n'))}</textarea></div>
    <div class="field"><label for="phones">${L('Phone numbers (one per line)', 'Telefoonnummers (één per regel)')}</label>
      <textarea autocomplete="off" id="phones" style="min-height:60px">${esc(p.phones.join('\n'))}</textarea></div>
    <div class="field"><label for="addresses">${L('Postal address', 'Postadres')}</label>
      <textarea autocomplete="off" id="addresses" style="min-height:70px">${esc(p.addresses)}</textarea></div>
    <button class="primary" data-action="save-profile">${L('Save', 'Opslaan')}</button>
  </div>

  <div class="card">
    <h2>${L('Breach database API key', 'API-sleutel voor de datalekdatabase')} <span class="muted small">${L('optional', 'optioneel')}</span></h2>
    <p class="small muted">${L(`You almost certainly do not need this. Checking your address is free on
    their website; see <a href="#/find">who has your data</a>. A key only buys you the same answer listed
    inside this app instead of on their site.`,
    `Dit heb je vrijwel zeker niet nodig. Je adres controleren is gratis op hun website, zie
    <a href="#/find">wie je gegevens heeft</a>. Met een sleutel krijg je hetzelfde antwoord, alleen in deze app
    in plaats van op hun site.`)}</p>
    <div class="row">
      <input autocomplete="off" id="hibpKey" type="password" value="${esc(state.hibpKey)}" placeholder="hibp-api-key" style="flex:1;min-width:200px">
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
    reinstall. The file contains everything above in plain text, so keep it somewhere sensible.`,
    `Exporteer voordat je browsergegevens wist, van computer wisselt of opnieuw installeert. Het bestand bevat
    alles hierboven als leesbare tekst, dus bewaar het op een veilige plek.`)}</p>
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
        'Je profiel, alle verzoeken en alle aliassen uit deze browser wissen? Dit kan niet ongedaan worden gemaakt.'))) return;
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
const UPDATED = { en: '14 October 2026', nl: '14 oktober 2026' };

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
    : L(`${ext(REPO + '/issues', 'GitHub')} (public: never post personal details there)`,
        `${ext(REPO + '/issues', 'GitHub')} (openbaar: zet daar nooit persoonsgegevens neer)`);
  const sec = (title, body) => `<section class="card legal"><h2>${title}</h2>${body}</section>`;

  return `
  <div class="head">
    <h1>${L('About &amp; privacy', 'Over &amp; privacy')}</h1>
    <p>${L('HoopUp (from the Dutch <i>hoepel op!</i>, "get lost") tells spammers, scammers and data brokers to leave you alone: off their mailing lists, out of their files, and without handing your data to yet another company.',
      'HoopUp (van <i>hoepel op!</i>) zegt spammers, oplichters en databrokers dat ze je met rust moeten laten: van hun mailinglijsten af, uit hun bestanden, en zonder je gegevens aan nóg een bedrijf te geven.')}</p>
  </div>

  ${sec(L('What it does', 'Wat het doet'), `<ul>${L(`
      <li><b>Unsubscribe</b> from real companies, in one go where they support it.</li>
      <li><b>Block scams</b> and other unsafe mail such as gambling spam, never a real company.</li>
      <li><b>Delete your data</b>: letters under the GDPR, sent from your own mail app, with reminders, replies when a company stalls, and a complaint to the regulator when a company ignores you.</li>
      <li><b>Advise on your addresses</b>: which one gets mostly spam, and whether to keep or retire it.</li>`, `
      <li><b>Uitschrijven</b> bij echte bedrijven, in één keer waar ze dat ondersteunen.</li>
      <li><b>Oplichters blokkeren</b> en andere onveilige mail zoals gokspam, maar nooit een echt bedrijf.</li>
      <li><b>Je gegevens laten wissen</b>: brieven op grond van de AVG, verstuurd vanuit je eigen mailapp, met herinneringen, reacties als een bedrijf traineert, en een klacht bij de toezichthouder als een bedrijf je negeert.</li>
      <li><b>Advies over je adressen</b>: welk adres vooral spam krijgt, en of je het houdt of opheft.</li>`)}</ul>`)}

  <h2 class="legal-title" id="privacy">${L('Privacy statement', 'Privacyverklaring')}</h2>
  <p class="small muted">${L(`Last updated ${UPDATED.en}.`, `Laatst bijgewerkt op ${UPDATED.nl}.`)}</p>

  ${sec(L('Who we are', 'Wie we zijn'), `<p>${L(
    `HoopUp is a free, non-commercial project by <b>fransiewillem</b>. Questions about privacy, or a request under the GDPR: ${contact}.`,
    `HoopUp is een gratis, niet-commercieel project van <b>fransiewillem</b>. Vragen over privacy, of een verzoek op grond van de AVG: ${contact}.`)}</p>`)}

  ${sec(L('In short', 'In het kort'), `<p>${L(
    'We keep no database and have no accounts, no analytics, no tracking cookies and no third-party scripts. Nothing you enter in HoopUp, and no mail you drop into it, is ever sent to us. We cannot see it, so we cannot lose it, sell it or hand it over.',
    'We houden geen database bij en hebben geen accounts, geen statistieken, geen trackingcookies en geen scripts van derden. Niets wat je in HoopUp invult, en geen mail die je erin sleept, wordt ooit naar ons gestuurd. We kunnen het niet zien, dus we kunnen het ook niet kwijtraken, verkopen of afgeven.')}</p>`)}

  ${sec(L('What stays on your own device', 'Wat op je eigen apparaat blijft'), `
    <p>${L('Everything below is processed in your browser and stored there only (localStorage). It only leaves your device in the cases listed under the next heading, and only when you choose to.',
      'Alles hieronder wordt in je browser verwerkt en alleen daar opgeslagen (localStorage). Het verlaat je apparaat alleen in de gevallen onder het volgende kopje, en alleen als jij dat kiest.')}</p>
    <ul>${L(`
      <li>The details you fill in under Settings: name, date of birth, email addresses, phone numbers and postal address. They are only used to fill in your letters.</li>
      <li>From mail you drop in, per sender only: its name and any other names it used, its domain, which of your addresses it wrote to, how many mails it sent, the domains its links and reply addresses point to, its unsubscribe address, the privacy address and privacy statement link its own mail gives, the service address and postal address it uses itself, the date of its last marketing mail (to see whether it stopped after you unsubscribed), what you did with its mail (how many you opened, whether you starred, answered or filed it, and the name of that folder or label, so mail you want is never unsubscribed), and the outcome of the checks (sender check, your mail provider's spam rating, kind of content such as gambling). For a real company that may get a letter, also what its own mail shows it holds about you: the name it addresses you by, a postal address and phone number if its mail lists them as yours. Those go into your letter to that company and nowhere else. Subjects and message text are read for these checks and are not kept, with one exception: when a company answers your letter, its date, the address it came from, its subject and what HoopUp read in it (such as "wants a copy of your ID") are kept with that request, so your reply can go back to them.</li>
      <li>Your progress: which companies you wrote to and when, notes, aliases, your answers about your addresses and the steps of a move you ticked off, which block rules you added, your language and mail app choice, and a breach-database API key if you add one.</li>`, `
      <li>De gegevens die je bij Instellingen invult: naam, geboortedatum, e-mailadressen, telefoonnummers en postadres. Ze worden alleen gebruikt om je brieven in te vullen.</li>
      <li>Uit mail die je erin sleept, per afzender alleen: de naam en eventuele andere namen die hij gebruikte, het domein, naar welk adres van jou hij schreef, hoeveel mails hij stuurde, de domeinen waar zijn links en antwoordadressen naar wijzen, het uitschrijfadres, het privacyadres en de link naar de privacyverklaring die zijn eigen mail noemt, het service- en postadres dat hij zelf gebruikt, de datum van zijn laatste reclamemail (om te zien of hij stopte nadat je je uitschreef), wat je met zijn mail deed (hoeveel je er opende, of je ze een ster gaf, beantwoordde of opborg, en de naam van die map of dat label, zodat mail die je wilt nooit wordt uitgeschreven), en de uitkomst van de controles (afzendercontrole, spamoordeel van je mailprovider, soort inhoud zoals gokken). Bij een echt bedrijf dat een brief kan krijgen ook wat zijn eigen mail laat zien dat het van je heeft: de naam waarmee het je aanschrijft, en een postadres en telefoonnummer als zijn mail die als de jouwe noemt. Die komen in je brief aan dat bedrijf en nergens anders. Onderwerpen en berichttekst worden voor deze controles gelezen en niet bewaard, op één ding na: als een bedrijf je brief beantwoordt, blijven de datum, het adres waar het vandaan kwam, het onderwerp en wat HoopUp erin las (zoals "wil een kopie ID") bij dat verzoek bewaard, zodat je reactie naar hen terug kan.</li>
      <li>Je voortgang: welke bedrijven je wanneer aanschreef, notities, aliassen, je antwoorden over je adressen en de stappen van een verhuizing die je afvinkte, welke blokkeerregels je toevoegde, je taal- en mailappkeuze en een API-sleutel voor de datalekdatabase als je die toevoegt.</li>`)}</ul>
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
      <li><b>Looking up a privacy address</b> (only when you press <i>Look it up</i>). Your browser sends the company's web address, such as webwinkel.nl, to hoopup.tech, and nothing else. A small function there reads that company's own privacy statement and returns the address it gives. Nothing about you is sent, and we store or log nothing; the answer is kept for a week per company, so the next person asking about the same company gets it without the site being read again. ${host.short} runs the function and sees your IP address, as with any visit.</li>
      <li><b>Letters</b>, replies to a company's answer and unsubscribes by email open in your own mail app and are sent by you, through your own mail provider. HoopUp does not put them on your clipboard unless you press Copy, because a clipboard can sync to your other devices.</li>
      <li><b>Reading your junk mail via Microsoft</b> (only if you press it, for Hotmail and Outlook.com). You sign in on Microsoft's own page; HoopUp never sees your password. HoopUp asks Microsoft for permission to read your mail, fetches only the messages in Junk Email, straight from Microsoft into your browser, and reads them on your device exactly like files you drop in. Nothing passes HoopUp, no message is kept, and the permission is forgotten when it is done. Microsoft records that you gave HoopUp that permission; you can withdraw it at account.live.com/consent.</li>
      <li><b>Adding block rules to Outlook.com</b> (only if you press it). You sign in on Microsoft's own page; HoopUp never sees your password. HoopUp asks Microsoft only for permission to change your mailbox settings, not to read or send your mail, uses it to add the rules (the spam sites and reply addresses) and forgets it straight away. Microsoft keeps the rules in your mailbox, like rules you make yourself.</li>
      <li><b>The calendar file and your log</b> are made on your device and saved where you choose. The calendar file holds company names and dates only. If you add it to a calendar that syncs (Google, iCloud, Outlook), that calendar's provider holds those names and dates.</li>
      <li><b>Emailing us.</b> Mail to ${esc(CONTACT_EMAIL)} is forwarded by Cloudflare Email Routing to a Gmail mailbox (Google). We use it only to answer you, and delete it once your question is settled.</li>`, `
      <li><b>Het bezoeken van de site.</b> De site wordt gehost door ${host.name} (${host.whereNL}). Zoals elke webhost ontvangt ${host.short} je IP-adres en de bestanden die je browser laadt, en kan die voor beveiliging vastleggen. Zie de ${ext(host.policy, `privacyverklaring van ${host.short}`)}; ${host.short} neemt deel aan het EU-VS Data Privacy Framework.</li>
      <li><b>Datalek- en wachtwoordcheck.</b> Als je die gebruikt, maakt je browser contact met ${ext('https://haveibeenpwned.com/Privacy', 'Have I Been Pwned')} (Australië). De lijst met datalekken bevat niets over jou. Een wachtwoordcheck stuurt alleen de eerste 5 tekens van een hash (een onomkeerbare code) van het wachtwoord, nooit het wachtwoord zelf. Alleen als je een eigen API-sleutel toevoegt en een adres controleert, wordt dat e-mailadres naar Have I Been Pwned gestuurd.</li>
      <li><b>Uitschrijven met één klik.</b> Je browser stuurt het uitschrijfverzoek naar het adres dat de afzender opgaf. Die afzender heeft je e-mailadres al; hij ziet ook je IP-adres. Er worden geen cookies of andere gegevens meegestuurd.</li>
      <li><b>Een link openen</b> (een uitschrijfpagina, een afmeldformulier, de website van de toezichthouder) werkt zoals elke link: die website ziet je bezoek. Deze site stuurt niet mee waar je vandaan kwam.</li>
      <li><b>Een privacyadres opzoeken</b> (alleen als je op <i>Zoek het op</i> drukt). Je browser stuurt het webadres van het bedrijf, zoals webwinkel.nl, naar hoopup.tech, en verder niets. Een kleine functie daar leest de privacyverklaring van dat bedrijf zelf en geeft het adres terug dat erin staat. Er wordt niets over jou verstuurd, en wij bewaren of loggen niets; het antwoord blijft een week per bedrijf bewaard, zodat wie daarna naar hetzelfde bedrijf vraagt het krijgt zonder dat de site opnieuw wordt gelezen. ${host.short} voert de functie uit en ziet je IP-adres, zoals bij elk bezoek.</li>
      <li><b>Brieven</b>, reacties op het antwoord van een bedrijf en afmeldingen per e-mail openen in je eigen mailapp en worden door jou verstuurd, via je eigen mailprovider. HoopUp zet ze niet op je klembord tenzij je op Kopieer drukt, omdat een klembord naar je andere apparaten kan synchroniseren.</li>
      <li><b>Je ongewenste mail inlezen via Microsoft</b> (alleen als je erop drukt, voor Hotmail en Outlook.com). Je logt in op de eigen pagina van Microsoft; HoopUp ziet je wachtwoord nooit. HoopUp vraagt Microsoft toestemming om je mail te lezen, haalt alleen de berichten uit Ongewenste e-mail op, rechtstreeks van Microsoft naar je browser, en leest ze op je apparaat, precies zoals bestanden die je erin sleept. Er gaat niets langs HoopUp, er wordt geen bericht bewaard en de toestemming wordt vergeten als het klaar is. Microsoft legt vast dat je HoopUp die toestemming gaf; je trekt hem in via account.live.com/consent.</li>
      <li><b>Blokkeerregels in Outlook.com zetten</b> (alleen als je erop drukt). Je logt in op de eigen pagina van Microsoft; HoopUp ziet je wachtwoord nooit. HoopUp vraagt Microsoft alleen toestemming om je mailboxinstellingen te wijzigen, niet om je mail te lezen of te versturen. Met die toestemming voegt HoopUp de regels toe (de spamwebsites en antwoordadressen), en daarna vergeet het die meteen. Microsoft bewaart de regels in je mailbox, net als regels die je zelf maakt.</li>
      <li><b>Het agendabestand en je overzicht</b> worden op je apparaat gemaakt en opgeslagen waar jij kiest. Het agendabestand bevat alleen bedrijfsnamen en datums. Zet je het in een agenda die synchroniseert (Google, iCloud, Outlook), dan heeft de aanbieder van die agenda die namen en datums.</li>
      <li><b>Ons mailen.</b> Mail aan ${esc(CONTACT_EMAIL)} wordt door Cloudflare Email Routing doorgestuurd naar een Gmail-mailbox (Google). We gebruiken je mail alleen om je te antwoorden en verwijderen hem zodra je vraag is afgehandeld.</li>`)}</ul>`)}

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
    <li>Company contact details may be outdated or guessed; the app shows where each address comes from (their own mail, a checked list, or a guess) and marks an address as wrong when a bounce is dropped in. We cannot see whether a company really erased your data; the app tracks deadlines so you can hold them to it.</li>
    <li>HoopUp is open source under the MIT licence: ${ext(REPO, 'source code')}.</li>`, `
    <li>HoopUp is gratis en wordt geleverd zoals het is, zonder enige garantie. Het is praktische uitleg, geen juridisch advies.</li>
    <li>Je verstuurt elke brief en elke uitschrijving zelf, en je bent verantwoordelijk voor wat je verstuurt. Lees elke brief voordat je hem verstuurt.</li>
    <li>Gebruik het voor je eigen gegevens. Namens iemand anders schrijven mag alleen met diens toestemming.</li>
    <li>Contactgegevens van bedrijven kunnen verouderd of gegokt zijn; de app laat zien waar elk adres vandaan komt (hun eigen mail, een gecontroleerde lijst of een gok) en markeert een adres als fout als je een melding dat de mail onbestelbaar was erin sleept. We kunnen niet zien of een bedrijf je gegevens echt heeft gewist; de app houdt de termijnen bij zodat je ze eraan kunt houden.</li>
    <li>HoopUp is open source onder de MIT-licentie: ${ext(REPO, 'broncode')}.</li>`)}</ul>`)}`;
}
