// Home: the whole flow on one screen. Drop mail in, get four cards, each with
// one number and one button, and act on them without leaving the page.

import * as store from './store.js';
import { L, plural } from './i18n.js';
import { relationOf, keptMailing } from './letters.js';
import { moveGuide, MOVE_STEPS } from './move.js';
import { filesFromDrop, isMailFileName } from './mailfile.js';
import {
  esc, toast, senderClass, unsubTier, ingestFiles, ingestToasts, runOneClickBatch, isWanted, wantedWhy, isBlockable,
  startUnsubQueue, wireQueue, wireBlock, blockAllCard, hostOf, nameOf, akaOf, deleteWork, unsafeReason, writable, coveredBy,
  blockDoneIds, blockDoneAt, blockView, ruleCount, detectSystem
} from './views.js';

const ICONS = {
  unsub:  '<path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/><path d="m15 15 4 4m0-4-4 4"/>',
  block:  '<circle cx="12" cy="12" r="8"/><path d="m6.5 6.5 11 11"/>',
  delete: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
  addr:   '<path d="M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  drop:   '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14"/>'
};
const icon = k => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
  stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;

// ---- address health --------------------------------------------------------
//
// For each address the scanned mail reached: how much of it was scam or spam,
// and which real senders in the scan still use it. The user decides whether to
// keep or retire it; the app only knows what was dropped in.

export function addressHealth(state) {
  const by = new Map();
  for (const t of state.custom) {
    if (t.source !== 'mail') continue;
    const a = (t.evidence?.address || '').toLowerCase();
    if (!a) continue;
    if (!by.has(a)) by.set(a, { address: a, total: 0, scam: 0, real: [] });
    const h = by.get(a);
    const n = t.mailCount || 1;
    h.total += n;
    const c = senderClass(t);
    if (c === 'spam' || c === 'bait') h.scam += n;
    // An unverifiable sender is neither: it must not make an address look
    // safe to retire, nor count as evidence that it is overrun.
    else if (c !== 'unclear' && c !== 'person' && !t.personal) h.real.push(t.name);
  }
  // One soft grade. The scan is usually a junk folder, which says nothing about
  // the friends, bank or shops that use an address from the inbox, so the app
  // reports what it saw and asks the user rather than declaring it "burned".
  return [...by.values()].map(h => ({
    ...h,
    verdict: h.scam >= 2 && h.scam / h.total >= 0.5 ? 'spammy' : 'ok'
  })).sort((a, b) => (a.verdict === 'ok') - (b.verdict === 'ok') || b.scam - a.scam);
}

function retireSteps(addr) {
  const d = addr.split('@')[1] || '';
  const code = `<code>${esc(addr)}</code>`;
  if (/^(outlook|hotmail|live|msn)\./i.test(d)) return [
    L(`If it is an <b>alias</b> on your Microsoft account: Microsoft account → <b>Manage how you sign in</b> → remove ${code}.`,
      `Is het een <b>alias</b> van je Microsoft-account? Ga naar Microsoft-account → <b>Beheren hoe je je aanmeldt</b> → verwijder ${code}.`),
    L(`If it is a <b>separate account</b> you only used for sign-ups: close that account once nothing you need is tied to it.`,
      `Is het een <b>apart account</b> dat je alleen voor aanmeldingen gebruikte? Sluit het dan zodra er niets meer aan hangt wat je nodig hebt.`),
    L(`Until then, one Outlook rule (anything sent to ${code} → <b>Delete</b>) keeps it out of sight.`,
      `Tot die tijd houdt één Outlook-regel (alles aan ${code} → <b>Verwijderen</b>) het uit beeld.`)
  ];
  if (/^(icloud|me|mac)\./i.test(d)) return [
    L(`If it is a <b>Hide My Email</b> address: Settings → your name → iCloud → Hide My Email → choose it → <b>Deactivate</b>. Mail to it stops arriving at all.`,
      `Is het een adres van <b>Verberg mijn e-mailadres</b>? Ga naar Instellingen → je naam → iCloud → Verberg mijn e-mailadres → kies het → <b>Deactiveer</b>. Er komt dan helemaal geen mail meer op binnen.`),
    L(`If it is your main iCloud address it cannot be retired. Keep it for people, and give every company its own Hide My Email address from now on.`,
      `Is het je hoofdadres bij iCloud, dan kun je het niet opheffen. Gebruik het alleen nog voor mensen en geef elk bedrijf voortaan een eigen adres via Verberg mijn e-mailadres.`)
  ];
  if (/^(gmail|googlemail)\./i.test(d)) return [
    L(`Gmail cannot drop one address without closing the account. Add a filter (To ${code} → <b>Delete it</b>) and stop giving it out.`,
      `Gmail kan geen los adres opheffen zonder het hele account te sluiten. Maak een filter (Aan ${code} → <b>Verwijderen</b>) en geef het niet meer uit.`)
  ];
  return [L(`Delete the address or alias at your mail provider, or route everything sent to ${code} to Trash.`,
            `Verwijder het adres of de alias bij je mailprovider, of stuur alles aan ${code} naar de prullenbak.`)];
}

function addressPanel(state) {
  const health = addressHealth(state);
  if (!health.length) return '';
  const answers = state.addressAnswers || {};
  const change = a => `<button class="link-btn" data-action="addr-answer" data-addr="${esc(a)}" data-answer="">${L('Change my answer', 'Antwoord wijzigen')}</button>`;
  return `
  <section class="card panel" id="addr-panel">
    <div class="row between"><h2>${L('Your addresses', 'Je adressen')}</h2>
      <button class="link-btn" data-action="panel-close">${L('Close', 'Sluiten')}</button></div>
    <p class="small muted" style="margin-top:-4px">${L(
      'Based only on the mail you dropped in, usually your junk folder. Mail from people you know is in your inbox, so HoopUp cannot see who else relies on an address. That is why it asks.',
      'Dit is alleen gebaseerd op de mail die je erin sleepte, meestal je map Ongewenst. Mail van mensen die je kent staat in je inbox, dus HoopUp kan niet zien wie een adres nog meer gebruikt. Daarom vragen we het jou.')}</p>
    ${health.map(h => {
      const pct = Math.round(100 * h.scam / Math.max(h.total, 1));
      const a = h.address;
      const names = h.real.map(esc).join(', ');
      const seen = L(`In what you scanned, <b>${h.scam} of ${h.total}</b> mails to this address were spam or scams.`,
                     `Van de gescande mails aan dit adres waren er <b>${h.scam} van de ${h.total}</b> spam of oplichting.`)
        + (h.real.length ? ' ' + L(`Real companies that also use it: ${names}.`, `Echte bedrijven die het ook gebruiken: ${names}.`) : '');
      let body;
      if (h.verdict === 'ok') {
        body = `<p class="small muted">${h.total} ${plural(h.total, 'mail', 'mails', 'mail', 'mails')}, ${h.scam
          ? L(`${h.scam} of them spam, nothing to act on`, `waarvan ${h.scam} spam, geen actie nodig`)
          : L('no spam', 'geen spam')}.</p>`;
      } else if (answers[a] === 'retire') {
        // Letters still to send to companies that know this address: they go
        // out before the address is retired, while it can receive the replies.
        const letters = deleteWork(state.custom.filter(writable)).send
          .filter(t => [t.evidence?.address, ...(t.evidence?.emails || [])].includes(a)).length;
        body = `<p>${seen}</p>
          ${moveGuide(h, { done: (state.addressMoves || {})[a] || [], letters, retire: retireSteps(a) })}
          <p class="small muted">${change(a)}</p>`;
      } else if (answers[a] === 'keep') {
        body = `<p>${seen}</p>
          <p><b>${L('Keep it, and make it quieter:', 'Houd het, maar maak het rustiger:')}</b></p>
          <ol class="small">
            <li>${L('Block the scams with the <b>Block scams</b> card on Home: one set of rules for your mail app.', 'Blokkeer de oplichters via de kaart <b>Oplichters blokkeren</b> op Home: één set regels voor je mailapp.')}</li>
            <li>${L('Stop giving this address out. Use a separate address for every new sign-up, so the next leak shows who leaked it (<a href="#/aliases">Aliases</a>).',
                    'Geef dit adres niet meer uit. Gebruik voor elke nieuwe aanmelding een apart adres, zodat het volgende lek laat zien wie lekte (<a href="#/aliases">Aliassen</a>).')}</li>
            ${h.real.length ? `<li>${L(`When convenient, move ${names} to their own address too.`, `Verhuis ${names} als het uitkomt ook naar een eigen adres.`)}</li>` : ''}
          </ol>
          <p class="small muted">${change(a)} · <button class="link-btn" data-action="addr-answer" data-addr="${esc(a)}" data-answer="retire">${L('Plan a move to a new address after all', 'Toch verhuizen naar een nieuw adres')}</button></p>`;
      } else {
        body = `<p>${seen}</p>
          <p><b>${L('Do people or companies you need still use this address?', 'Gebruiken mensen of bedrijven die je nodig hebt dit adres nog?')}</b></p>
          <div class="row">
            <button data-action="addr-answer" data-addr="${esc(a)}" data-answer="keep">${L('Yes, I still need it', 'Ja, ik heb het nog nodig')}</button>
            <button data-action="addr-answer" data-addr="${esc(a)}" data-answer="retire">${L('No, I can let it go', 'Nee, ik kan het missen')}</button>
          </div>`;
      }
      const pill = h.verdict === 'ok' ? ['done', L('Fine', 'In orde')] : ['escalated', L('Mostly spam', 'Vooral spam')];
      return `
      <div class="addr addr-${h.verdict}">
        <div class="addr-head"><span class="mono">${esc(a)}</span>
          <span class="pill ${pill[0]}">${pill[1]}</span></div>
        <div class="meter" title="${pct}% ${L('spam or scams', 'spam of oplichting')}"><span style="width:${pct}%"></span></div>
        ${body}
      </div>`;
    }).join('')}
  </section>`;
}

// Re-open the panel after an answer re-renders the page.
let reopenAddr = false;
// The mail app whose help to show open after the next render.
let openHelp = '';

// ---- the page ----------------------------------------------------------------

function dropZone(compact) {
  const pick = `<button class="link-btn" data-action="pick">${L('choose files', 'kies bestanden')}</button>`
    + ` ${L('or', 'of')} <button class="link-btn" data-action="pick-folder">${L('a folder', 'een map')}</button>`;
  return `
  <div id="drop" class="drop ${compact ? 'drop-compact' : 'drop-hero'}">
    ${compact
      ? `<span>${icon('drop')}</span><span>${L(`<b>Drop more mail</b> to update, or ${pick}`,
                                             `<b>Sleep meer mail hierheen</b> om bij te werken, of ${pick}`)}</span>`
      : `<div class="drop-icon">${icon('drop')}</div>
         <p class="drop-title">${L('Drop your junk mail here, or your whole mailbox', 'Sleep je ongewenste mail hierheen, of je hele mailbox')}</p>
         <p class="small muted">${L(`.eml, .msg or .mbox files, or a mailbox folder · or ${pick}`, `.eml-, .msg- of .mbox-bestanden, of een mailboxmap · of ${pick}`)}</p>`}
    <input type="file" id="files" multiple accept=".eml,.emlx,.msg,.mbox,.txt,message/rfc822,application/vnd.ms-outlook" hidden>
    <input type="file" id="folder" webkitdirectory multiple hidden>
  </div>`;
}

// How to get mail out of each app, one app at a time: the one this computer
// most likely uses is open, the others are a tap away.
// A link to another app's steps in the same box.
const go = (app, text) => `<button type="button" class="link-btn" data-action="howto-go" data-app="${app}">${text}</button>`;
const steps = (list, tip = '') => `<ol>${list.map(x => `<li>${x}</li>`).join('')}</ol>${tip ? `<p class="muted">${tip}</p>` : ''}`;
const HOWTO_APPS = () => [
  ['apple', 'Apple Mail', L(steps([
      'Open <b>Junk</b> and press <code>Cmd+A</code>.',
      'Drag the mails into a folder, such as <b>Downloads</b>.',
      'Drag that folder here.'],
      'Your whole mailbox instead? <b>Mailbox</b> → <b>Export Mailbox…</b>, then drag that here.'), steps([
      'Open <b>Ongewenst</b> en druk op <code>Cmd+A</code>.',
      'Sleep de mails naar een map, zoals <b>Downloads</b>.',
      'Sleep die map hierheen.'],
      'Liever je hele mailbox? <b>Mailbox</b> → <b>Exporteer mailbox…</b>, en sleep die hierheen.'))],
  ['outlookmac', L('Outlook on Mac', 'Outlook op Mac'), L(steps([
      'Add your mail account to Apple Mail: <b>System Settings</b> → <b>Internet Accounts</b>.',
      'In Apple Mail, open <b>Junk</b>, press <code>Cmd+A</code> and drag the mails into a folder.',
      'Drag that folder here.'],
      'Why Apple Mail? Outlook for Mac saves only one mail at a time.'), steps([
      'Zet je mailaccount in Apple Mail: <b>Systeeminstellingen</b> → <b>Internetaccounts</b>.',
      'Open in Apple Mail <b>Ongewenst</b>, druk op <code>Cmd+A</code> en sleep de mails naar een map.',
      'Sleep die map hierheen.'],
      'Waarom Apple Mail? Outlook voor Mac slaat maar één mail tegelijk op.'))],
  ['outlookwin', L('Outlook on Windows', 'Outlook op Windows'), L(steps([
      'Open <b>Junk Email</b> and press <code>Ctrl+A</code>.',
      'Drag the mails into a folder, such as <b>Downloads</b>.',
      'Drag that folder here.'],
      `Only one file? That is the new Outlook. Turn off <b>New Outlook</b> at the top right and try again. No switch there? Use ${go('thunderbird', 'Thunderbird')}.`), steps([
      'Open <b>Ongewenste e-mail</b> en druk op <code>Ctrl+A</code>.',
      'Sleep de mails naar een map, zoals <b>Downloads</b>.',
      'Sleep die map hierheen.'],
      `Maar één bestand? Dan heb je de nieuwe Outlook. Zet rechtsboven <b>Nieuwe Outlook</b> uit en probeer het opnieuw. Geen schakelaar? Gebruik ${go('thunderbird', 'Thunderbird')}.`))],
  ['gmail', 'Gmail', L(steps([
      'Open <a href="https://takeout.google.com" target="_blank" rel="noopener noreferrer">Google Takeout</a>, press <b>Deselect all</b> and tick only <b>Mail</b>.',
      'Export, download the file Google sends you and unzip it.',
      'Drag the <code>.mbox</code> file here.']), steps([
      'Open <a href="https://takeout.google.com" target="_blank" rel="noopener noreferrer">Google Takeout</a>, klik op <b>Alles deselecteren</b> en vink alleen <b>Mail</b> aan.',
      'Exporteer, download het bestand dat Google je stuurt en pak het uit.',
      'Sleep het <code>.mbox</code>-bestand hierheen.']))],
  ['outlookcom', 'Hotmail, Outlook.com', L(steps([
      'The website cannot save mail, so use a mail app.',
      `On a Mac: follow ${go('outlookmac', 'the steps via Apple Mail')}.`,
      `On Windows: follow ${go('thunderbird', 'the steps via Thunderbird')}.`]), steps([
      'De website kan geen mail opslaan, dus gebruik een mailapp.',
      `Op een Mac: volg ${go('outlookmac', 'de stappen via Apple Mail')}.`,
      `Op Windows: volg ${go('thunderbird', 'de stappen via Thunderbird')}.`]))],
  ['thunderbird', 'Thunderbird', L(steps([
      'Install the free <a href="https://www.thunderbird.net" target="_blank" rel="noopener noreferrer">Thunderbird</a> and add your mail account.',
      'Open <b>Junk</b>, press <code>Ctrl+A</code>, right-click → <b>Save As…</b> and choose a folder.',
      'Drag that folder here.']), steps([
      'Installeer het gratis <a href="https://www.thunderbird.net" target="_blank" rel="noopener noreferrer">Thunderbird</a> en zet je mailaccount erin.',
      'Open <b>Ongewenst</b>, druk op <code>Ctrl+A</code>, rechtermuisknop → <b>Opslaan als…</b> en kies een map.',
      'Sleep die map hierheen.']))]
];

// The app to open first: the one the last drop came from, else the usual one
// on this computer.
function howtoDefault(state) {
  if (['apple', 'outlookwin', 'gmail'].includes(state.mailApp)) return state.mailApp;
  const sys = state.system || detectSystem();
  return sys === 'mac' ? 'apple' : sys === 'windows' ? 'outlookwin' : 'thunderbird';
}

const onPhone = () => /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent || '')
  || (/Mac/i.test(navigator.platform || '') && navigator.maxTouchPoints > 1);

const HOWTO = (state, { inline = false, app = '' } = {}) => {
  const open = app || howtoDefault(state);
  return `
  <section class="howto-card ${inline ? 'howto-inline' : ''}" aria-labelledby="howto-title">
    <h2 id="howto-title">${L('Which mail app do you use?', 'Welke mailapp gebruik je?')}</h2>
    ${onPhone() ? `<p class="notice warn small">${L('A phone cannot save mail as files. Open hoopup.tech on your computer.',
      'Een telefoon kan geen mail als bestand opslaan. Open hoopup.tech op je computer.')}</p>` : ''}
    <div class="seg" role="tablist" aria-labelledby="howto-title">
      ${HOWTO_APPS().map(([k, name]) => `<button type="button" role="tab" id="howto-tab-${k}" aria-controls="howto-${k}"
        aria-selected="${k === open}" tabindex="${k === open ? 0 : -1}" data-action="howto-app" data-app="${k}">${name}</button>`).join('')}
    </div>
    ${HOWTO_APPS().map(([k, , body]) => `<div class="howto-panel small" role="tabpanel" id="howto-${k}" aria-labelledby="howto-tab-${k}" ${k === open ? '' : 'hidden'}>${body}</div>`).join('')}
  </section>`;
};

export function home(state) {
  const mail = state.custom.filter(t => t.source === 'mail');

  if (!mail.length) return `
  <section class="hero">
    <img class="hero-mark" src="assets/img/icon.svg" alt="" width="56" height="56">
    <h1>${L('Stop spam. Get your data deleted.', 'Stop spam. Laat je gegevens wissen.')}</h1>
    <p>${L('Drop in the mail from your junk folder, or your whole mailbox. HoopUp tells you what to do with each sender, and keeps the mail you actually read.',
           'Sleep de mail uit je map Ongewenst hierheen, of je hele mailbox. HoopUp vertelt je per afzender wat je ermee kunt doen, en houdt de mail die je echt leest.')}</p>
    <ol class="steps">
      <li><b>${L('Unsubscribe', 'Uitschrijven')}</b><span>${L('from real companies', 'bij echte bedrijven')}</span></li>
      <li><b>${L('Block', 'Blokkeren')}</b><span>${L('scams and fake senders', 'oplichters en nepafzenders')}</span></li>
      <li><b>${L('Delete', 'Wissen')}</b><span>${L('your data at companies', 'je gegevens bij bedrijven')}</span></li>
    </ol>
    ${dropZone(false)}
    <ul class="trust">
      <li>${L('Nothing is uploaded', 'Er wordt niets geüpload')}</li>
      <li>${L('No account', 'Geen account')}</li>
      <li>${L('Free', 'Gratis')}</li>
    </ul>
    ${HOWTO(state)}
    <p class="small muted" style="margin-top:22px">${L(`Already know a company that holds your data?
    <a href="#/delete">Write to it directly</a>.`, `Weet je al welk bedrijf je gegevens heeft?
    <a href="#/delete">Schrijf het direct aan</a>.`)}</p>
  </section>`;

  const cls = senderClass;
  // Home's one button only ever acts on verified senders. An unverified one
  // (headers stripped, or never authenticated) needs its warning seen first,
  // which happens on the detail page, not behind a bulk button.
  const unsub = mail.filter(t => cls(t) === 'unsub');
  // Newsletters the user reads, stars, files or answers are kept, never
  // unsubscribed in bulk.
  const wanted = unsub.filter(t => !t.unsubscribedAt && isWanted(t));
  const pending = unsub.filter(t => !t.unsubscribedAt && t.trust === 'verified' && !isWanted(t));
  const unchecked = unsub.filter(t => !t.unsubscribedAt && t.trust !== 'verified' && !isWanted(t));
  const instant = pending.filter(t => unsubTier(t) === 'instant');
  // Blocking is only for unsafe senders (forged, provider-rated high-confidence
  // spam, or gambling/crypto/prize/adult content). A real company is never
  // offered a block, only an unsubscribe and an erasure letter.
  const blocked = mail.filter(isBlockable);
  const bait = blocked.filter(t => cls(t) === 'bait').length;
  const unclear = mail.filter(t => cls(t) === 'unclear').length;
  const people = mail.filter(t => cls(t) === 'person').length;
  // After the user pressed Done, only senders that need a rule they do not
  // have yet count. New senders reusing known link sites are already covered.
  const doneIds = blockDoneIds(state);
  const doneAt = esc(blockDoneAt(state));
  const blockNew = blocked.filter(t => !doneIds.has(t.id));
  const newRules = doneIds.size ? ruleCount(blockView(state, false).bl) : null;
  const blockTodo = !doneIds.size ? blocked.length : newRules ? blockNew.length : 0;
  const fullRules = blockView(state, true).bl;
  const uncovered = blocked.filter(t => !coveredBy(fullRules, t)).length;
  const companies = state.custom.filter(writable);
  const work = deleteWork(companies);
  const toAsk = work.send.length + work.forms.length;
  const followUps = work.reminders.length + work.complaints.length + work.answers.length;
  // Senders that kept mailing after the user unsubscribed.
  const kept = mail.filter(t => t.unsubscribedAt && keptMailing(t, store.getRequest(t.id)));
  const suspect = [...work.send, ...work.forms].filter(t => relationOf(t, store.getRequest(t.id)) === 'none').length;
  const flagged = addressHealth(state).filter(h => h.verdict !== 'ok');
  const open = flagged.filter(h => !(state.addressAnswers || {})[h.address]);
  const mails = mail.reduce((n, t) => n + (t.mailCount || 1), 0);

  // One task is the next step: the first that still has work. Only its button
  // is purple, so the eye knows where to start.
  const tasks = [['unsub', pending.length], ['block', blockTodo], ['delete', toAsk + followUps], ['addr', open.length]];
  const nextKey = tasks.find(([, n]) => n)?.[0];
  const doneCount = tasks.filter(([, n]) => !n).length;

  const card = c => {
    const next = c.icon === nextKey;
    return `
    <article class="action ${c.n ? '' : 'is-done'} ${c.tone || ''} ${next ? 'is-next' : ''}">
      <div class="action-head"><span class="action-icon">${icon(c.icon)}</span>
        <span class="action-n">${c.n ? c.n : '✓'}</span></div>
      ${next ? `<span class="next-tag">${L('Next step', 'Volgende stap')}</span>` : ''}
      <h3>${c.title}</h3>
      <p>${c.text}</p>
      <div class="action-foot">
        ${c.n ? (c.href ? `<a class="btn ${next ? 'primary' : ''}" href="${c.href}">${c.cta}</a>`
                        : `<button class="${next ? 'primary' : ''}" data-action="${c.action}">${c.cta}</button>`)
              : `<span class="done-label">${c.done}</span>`}
        ${c.more ? `<a class="more" href="${c.more}">${L('Details', 'Details')}</a>` : ''}
      </div>
    </article>`;
  };

  const unsubText = (pending.length
      ? L(`${pending.length} verified ${plural(pending.length, 'company', 'companies', '', '')}.`,
          `${pending.length} ${plural(pending.length, 'echt bedrijf', 'echte bedrijven', 'echt bedrijf', 'echte bedrijven')}${pending.length > 1 && instant.length ? `, waarvan ${instant.length} met één klik` : ''}.`)
        + (instant.length ? L(` ${instant.length} ${instant.length === 1 ? 'goes' : 'go'} in one click.`,
                              pending.length > 1 ? '' : ' Dat gaat met één klik.') : '')
      : unsub.length && !unchecked.length && !wanted.length
        ? L(`Unsubscribed from all ${unsub.length}.`, `Bij alle ${unsub.length} uitgeschreven.`)
        : L('No verified company left to unsubscribe from.', 'Geen echt bedrijf meer om je bij uit te schrijven.'))
    + (wanted.length ? L(` ${wanted.length} you read or answer ${wanted.length === 1 ? 'is' : 'are'} kept.`,
                         ` Bij ${wanted.length} ${wanted.length === 1 ? 'afzender' : 'afzenders'} die je leest of beantwoordt, blijf je ingeschreven.`) : '')
    + (kept.length ? L(` ${kept.length} kept mailing after you unsubscribed: a letter is ready in Details.`,
                       ` ${kept.length} ${kept.length === 1 ? 'bleef' : 'bleven'} mailen nadat je je uitschreef: er staat een brief klaar bij Details.`) : '')
    + (unchecked.length ? L(` ${unchecked.length} more could not be verified. Check ${unchecked.length === 1 ? 'it' : 'them'} in Details.`,
                            ` ${unchecked.length} ${unchecked.length === 1 ? 'andere kon' : 'andere konden'} niet worden gecontroleerd. Bekijk ze bij Details.`) : '');

  const blockText = !blocked.length
    ? L('No scams found. Real companies are never blocked, only unsubscribed.', 'Geen oplichters gevonden. Echte bedrijven worden nooit geblokkeerd, alleen uitgeschreven.')
    : !doneIds.size
    ? L(`${blocked.length} ${plural(blocked.length, 'sender', 'senders', '', '')} ${blocked.length === 1 ? 'is' : 'are'} unsafe: scams or spam${bait ? `, ${bait} with fake unsubscribe links` : ''}.`,
        `${blocked.length} ${plural(blocked.length, 'afzender', 'afzenders', 'afzender', 'afzenders')} ${blocked.length === 1 ? 'is' : 'zijn'} onveilig: oplichters of spam${bait ? `, ${bait} met nep-uitschrijflinks` : ''}.`)
      + ' ' + (!uncovered ? L('One set of rules for your mail app blocks them all.', 'Eén set regels in je mailapp blokkeert ze allemaal.')
        : uncovered < blocked.length
        ? L(`One set of rules for your mail app blocks ${blocked.length - uncovered} of them. ${uncovered === 1 ? 'The other one' : `The other ${uncovered}`} left no link or reply address to block on: mark ${uncovered === 1 ? 'it' : 'those'} as junk.`,
            `Eén set regels in je mailapp blokkeert er ${blocked.length - uncovered}. ${uncovered === 1 ? 'De andere liet' : `De andere ${uncovered} lieten`} geen link of antwoordadres achter om op te blokkeren: markeer ${uncovered === 1 ? 'die' : 'die'} als ongewenst.`)
        : L('They left no link or reply address to block on: mark them as junk in your mail app.', 'Ze lieten geen link of antwoordadres achter om op te blokkeren: markeer ze als ongewenst in je mailapp.'))
    : newRules
    ? L(`${blockNew.length} new unsafe ${plural(blockNew.length, 'sender', 'senders', '', '')} since you blocked on ${doneAt}: ${newRules} new ${newRules === 1 ? 'rule' : 'rules'} to add.`,
        `${blockNew.length} nieuwe onveilige ${plural(blockNew.length, '', '', 'afzender', 'afzenders')} sinds je op ${doneAt} blokkeerde: ${newRules} ${newRules === 1 ? 'nieuwe regel' : 'nieuwe regels'} toe te voegen.`)
    : blockNew.length
    ? L(`Blocked on ${doneAt}. Those rules already cover the ${blockNew.length} new ${plural(blockNew.length, 'sender', 'senders', '', '')} too.`,
        `Geblokkeerd op ${doneAt}. Die regels dekken ook de ${blockNew.length} nieuwe ${plural(blockNew.length, '', '', 'afzender', 'afzenders')}.`)
    : L(`Blocked on ${doneAt}. Nothing new since.`, `Geblokkeerd op ${doneAt}. Sindsdien niets nieuws.`);

  const moving = flagged.filter(h => (state.addressAnswers || {})[h.address] === 'retire'
    && ((state.addressMoves || {})[h.address] || []).length < MOVE_STEPS.length);
  const movingText = moving.length
    ? L(`Moving away from <span class="mono">${esc(moving[0].address)}</span>: ${((state.addressMoves || {})[moving[0].address] || []).length} of ${MOVE_STEPS.length} steps done.`,
        `Verhuizen van <span class="mono">${esc(moving[0].address)}</span>: ${((state.addressMoves || {})[moving[0].address] || []).length} van ${MOVE_STEPS.length} stappen gedaan.`)
    : '';
  const addrText = open.length
    ? `<span class="mono">${esc(open[0].address)}</span> ${L('gets mostly spam. One question decides what to do.', 'krijgt vooral spam. Beantwoord één vraag en je weet wat je kunt doen.')}${open.length > 1
        ? L(` ${open.length - 1} more to check.`, ` Nog ${open.length - 1} te bekijken.`) : ''}${movingText ? ' ' + movingText : ''}`
    : movingText
    || (flagged.length
      ? L('You decided for every address that gets mostly spam.', 'Je hebt een besluit genomen voor elk adres dat vooral spam krijgt.')
      : L('No address is overrun with spam.', 'Geen enkel adres wordt overspoeld met spam.'));

  return `
  <div class="home-head">
    <div>
      <h1>${L('Your inbox', 'Je inbox')}</h1>
      <p class="muted">${L(
        `${mails} ${plural(mails, 'mail', 'mails', '', '')} from ${mail.length} ${plural(mail.length, 'sender', 'senders', '', '')} scanned · nothing left this device`,
        `${mails} ${plural(mails, '', '', 'mail', 'mails')} van ${mail.length} ${plural(mail.length, '', '', 'afzender', 'afzenders')} gescand · niets heeft dit apparaat verlaten`)}</p>
    </div>
    <div class="progress">
      <span>${doneCount === tasks.length ? L('All done', 'Alles gedaan') : L(`${doneCount} of ${tasks.length} done`, `${doneCount} van ${tasks.length} klaar`)}</span>
      <span class="progress-bar" role="progressbar" aria-label="${L('Progress', 'Voortgang')}" aria-valuemin="0" aria-valuemax="${tasks.length}" aria-valuenow="${doneCount}"><span style="width:${Math.round(100 * doneCount / tasks.length)}%"></span></span>
    </div>
  </div>

  <div class="actions">
    ${card({ icon: 'unsub', n: pending.length, title: L('Unsubscribe', 'Uitschrijven'),
      text: unsubText,
      cta: L(`Unsubscribe from ${pending.length}`, `Schrijf je uit bij ${pending.length}`), action: 'home-unsub',
      done: L('Nothing left', 'Niets meer te doen'), more: '#/unsubscribe' })}

    ${card({ icon: 'block', n: blockTodo, tone: blockTodo ? 'tone-bad' : '',
      title: L('Block scams', 'Oplichters blokkeren'),
      text: blockText,
      cta: doneIds.size ? L(`Block ${blockTodo} new`, `${blockTodo} nieuwe blokkeren`)
                        : L(`Block all ${blockTodo}`, `Alle ${blockTodo} blokkeren`),
      action: 'home-block', done: blocked.length ? L('Blocked', 'Geblokkeerd') : L('Nothing to block', 'Niets te blokkeren'),
      more: '#/unsubscribe' })}

    ${card({ icon: 'delete', n: toAsk + followUps, tone: followUps ? 'tone-bad' : '',
      title: L('Delete my data', 'Mijn gegevens wissen'),
      text: [
        toAsk ? L(`${toAsk} ${toAsk === 1 ? 'company holds' : 'companies hold'} your data. A legal request makes them erase it, and they must answer within a month.`,
                  `${toAsk} ${toAsk === 1 ? 'bedrijf heeft' : 'bedrijven hebben'} je gegevens. Een AVG-verzoek verplicht ze die te wissen, en ze moeten binnen een maand antwoorden.`) : '',
        suspect ? L(`${suspect} with no reason to have it ${suspect === 1 ? 'goes' : 'go'} first.`,
                    `${suspect} zonder reden om ze te hebben ${suspect === 1 ? 'gaat' : 'gaan'} voor.`) : '',
        work.answers.length ? L(`${work.answers.length} answered with a demand the law does not support. Your reply is ready.`,
                                `${work.answers.length} ${work.answers.length === 1 ? 'antwoordde' : 'antwoordden'} met een eis die de wet niet steunt. Je reactie staat klaar.`) : '',
        work.reminders.length ? L(`${work.reminders.length} did not answer in time. A reminder is ready.`,
                                  `${work.reminders.length} ${work.reminders.length === 1 ? 'reageerde' : 'reageerden'} niet op tijd. Er staat een herinnering klaar.`) : '',
        work.complaints.length ? L(`${work.complaints.length} ready for a complaint to the regulator.`,
                                   `${work.complaints.length} klaar voor een klacht bij de toezichthouder.`) : '',
        !toAsk && !followUps ? (companies.length
          ? L(`All ${companies.length} asked. Deadlines are tracked, and reminders appear here when one is due.`,
              `Alle ${companies.length} aangeschreven. De termijnen worden bijgehouden en herinneringen verschijnen hier zodra het tijd is.`)
          : L('No company to write to yet.', 'Nog geen bedrijf om aan te schrijven.')) : ''
      ].filter(Boolean).join(' '),
      cta: work.send.length ? L(`Send ${work.send.length} ${work.send.length === 1 ? 'request' : 'requests'}`, `${work.send.length} ${work.send.length === 1 ? 'verzoek' : 'verzoeken'} versturen`)
         : work.answers.length ? L('Write replies', 'Reacties schrijven')
         : work.reminders.length ? L('Send reminders', 'Herinneringen versturen') : L('Open', 'Openen'),
      href: work.send.length ? '#/delete?send=1' : '#/delete',
      done: companies.length ? L('All asked', 'Alles verstuurd') : L('Nothing yet', 'Nog niets') })}

    ${card({ icon: 'addr', n: open.length,
      title: L('Your addresses', 'Je adressen'),
      text: addrText,
      cta: L('Take a look', 'Bekijken'), action: 'home-addr',
      done: moving.length ? `<button class="link-btn" data-action="home-addr">${L('Continue', 'Verdergaan')}</button>`
        : flagged.length ? `<button class="link-btn" data-action="home-addr">${L('Review', 'Bekijken')}</button>` : L('All fine', 'Alles in orde') })}
  </div>

  ${unclear ? `<p class="small muted">${L(
    `${unclear} ${plural(unclear, 'sender', 'senders', '', '')} could not be verified, so HoopUp does not use ${unclear === 1 ? 'its' : 'their'} links and does not block or write to ${unclear === 1 ? 'it' : 'them'}. Click nothing in ${unclear === 1 ? 'that mail' : 'those mails'}. <a href="#/unsubscribe">See which</a>.`,
    `${unclear} ${plural(unclear, '', '', 'afzender', 'afzenders')} ${unclear === 1 ? 'kon' : 'konden'} niet gecontroleerd worden. HoopUp gebruikt ${unclear === 1 ? 'zijn' : 'hun'} links niet, blokkeert ${unclear === 1 ? 'hem' : 'ze'} niet en schrijft ${unclear === 1 ? 'hem' : 'ze'} niet aan. Klik nergens op in ${unclear === 1 ? 'die mail' : 'die mails'}. <a href="#/unsubscribe">Bekijk welke</a>.`)}</p>` : ''}

  ${people ? `<p class="small muted">${L(
    `${people} ${plural(people, 'sender', 'senders', '', '')} wrote from a personal account (Gmail, Outlook…), so there is no company to unsubscribe from or write to. Do not know ${people === 1 ? 'them' : 'one'}? Mark it as junk. <a href="#/unsubscribe">See which</a>.`,
    `${people} ${plural(people, '', '', 'afzender', 'afzenders')} ${people === 1 ? 'schreef' : 'schreven'} vanaf een persoonlijk account (Gmail, Outlook…), dus er is geen bedrijf om je bij uit te schrijven of aan te schrijven. Ken je ${people === 1 ? 'de afzender' : 'er een'} niet? Markeer de mail als ongewenst. <a href="#/unsubscribe">Bekijk welke</a>.`)}</p>` : ''}

  <div id="unsub-queue"></div>
  <div id="panel"></div>

  ${dropZone(true)}
  <details class="howto-more" id="howto-more" ${openHelp ? 'open' : ''}>
    <summary>${L('How do I get (more) mail in here?', 'Hoe krijg ik (meer) mail hierin?')}</summary>
    ${HOWTO(state, { inline: true, app: openHelp })}
  </details>

  <details class="senders">
    <summary>${L(`Every sender scanned (${mail.length})`, `Alle gescande afzenders (${mail.length})`)}</summary>
    <div class="list">
      ${mail.map(t => {
        const c = cls(t);
        const [p, l] = ['bait', 'spam'].includes(c) ? ['overdue', unsafeReason(t) + ' · ' + L('block', 'blokkeren')]
          : c === 'unclear' ? ['low', L('could not verify', 'niet te controleren')]
          : c === 'person' ? ['low', L('personal address', 'persoonlijk adres')]
          : isWanted(t) ? ['done', L('kept', 'gehouden') + ' · ' + wantedWhy(t)]
          : t.trust === 'verified' ? ['done', c === 'unsub' ? L('verified · unsubscribe', 'echt bedrijf · uitschrijven') : L('verified company', 'echt bedrijf')]
          : ['low', L('unverified', 'niet gecontroleerd')];
        return `<div class="pick" style="cursor:default">
          <span class="pick-name">${esc(nameOf(t))}${akaOf(t) ? `<span class="aka">${esc(akaOf(t))}</span>` : ''}</span><span class="pill ${p}">${l}</span>
          ${t.unsubscribedAt ? `<span class="pill">${L('unsubscribed', 'uitgeschreven')}</span>` : ''}
          <span class="pick-meta mono">${esc(t.site || '')}</span></div>`;
      }).join('')}
    </div>
  </details>
  <p class="small muted" style="margin-top:18px">${L(`<a href="#/find">More ways to find who has your data</a>:
  breach records, mailbox searches, data brokers.`, `<a href="#/find">Meer manieren om te zien wie je gegevens heeft</a>:
  datalekken, zoeken in je mailbox, databrokers.`)}</p>`;
}

export function mountHome(root, state, rerender) {
  if (openHelp) { openHelp = ''; requestAnimationFrame(() => root.querySelector('#howto-more')?.scrollIntoView({ behavior: 'smooth', block: 'center' })); }
  wireQueue(root, rerender);
  wireBlock(root, state, rerender);

  // Mail dragged straight out of a mail app arrives as nothing at all: the
  // app offers to write files later, which a browser cannot take.
  const showHelp = () => {
    const more = document.querySelector('#howto-more');
    if (more) more.open = true;
    (more || document.querySelector('.howto-card'))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  function noFiles() {
    toast(L('Your browser received no files. Dragging mail straight out of a mail app does not work in a browser: drag it into a folder on your computer first, then that folder here. Below is how, per mail app.',
      'Je browser kreeg geen bestanden mee. Mails rechtstreeks uit je mailapp slepen werkt niet in een browser: sleep ze eerst naar een map op je computer, en die map hierheen. Hieronder staat per mailapp hoe dat gaat.'));
    showHelp();
  }

  async function handleFiles(list) {
    // Folders (an Apple Mail .mbox bundle) arrive as empty entries.
    const files = [...list].filter(f => f.size > 0);
    if (!files.length) { toast(L('No mail files in there. Drop .eml, .msg or .mbox files, or a mailbox folder.', 'Daar zaten geen mailbestanden in. Sleep .eml-, .msg- of .mbox-bestanden hierheen, of een mailboxmap.')); return; }
    const drop = root.querySelector('#drop');
    const big = files.reduce((n, f) => n + f.size, 0) > 32 * 1024 * 1024;
    try {
      if (big && drop) drop.innerHTML = `<p class="drop-title" aria-live="polite">${L('Reading your mail on this device…', 'Je mail wordt op dit apparaat gelezen…')} <span id="drop-pct">0%</span></p>
        <p class="small muted">${L('A large export takes a few minutes. Nothing is uploaded.', 'Een grote export duurt een paar minuten. Er wordt niets geüpload.')}</p>`;
      const result = await ingestFiles(files, frac => {
        const el = root.querySelector('#drop-pct');
        if (el) el.textContent = Math.floor(frac * 100) + '%';
      });
      // One .eml alone is most likely the new Outlook (Windows) or Outlook for
      // Mac, which save one mail at a time. The page comes back with the way
      // to get the whole folder.
      const sys = store.get().system || detectSystem();
      const one = result.mail.length > 0 && files.length === 1 && /\.eml$/i.test(files[0].name) && ['mac', 'windows'].includes(sys);
      openHelp = one ? (sys === 'mac' ? 'outlookmac' : 'outlookwin') : '';
      rerender();
      const said = ingestToasts(result);
      const { mail, senders } = result;
      if (!mail.length) {
        if (!said) toast(L('No mail found in those files. Use .eml, .msg or .mbox files.', 'Geen mail gevonden in die bestanden. Gebruik .eml-, .msg- of .mbox-bestanden.'));
        return;
      }
      if (!said) toast(L(`${mail.length} ${plural(mail.length, 'mail', 'mails', '', '')} from ${senders.length} ${plural(senders.length, 'sender', 'senders', '', '')} sorted`,
        `${mail.length} ${plural(mail.length, '', '', 'mail', 'mails')} van ${senders.length} ${plural(senders.length, '', '', 'afzender', 'afzenders')} gesorteerd`)
        + (!one ? '' : sys === 'mac'
          ? L('. Only one? Outlook for Mac saves one mail at a time. Below is how to get the whole folder at once.',
              '. Maar één? Outlook voor Mac slaat één mail tegelijk op. Hieronder staat hoe je de hele map in één keer pakt.')
          : L('. Only one? The new Outlook saves one mail at a time. Below is how to get the whole folder at once.',
              '. Maar één? De nieuwe Outlook slaat één mail tegelijk op. Hieronder staat hoe je de hele map in één keer pakt.')));
    } catch (err) {
      if (big) rerender();
      toast(L('Could not read those files: ', 'Kon die bestanden niet lezen: ') + err.message);
    }
  }

  const drop = root.querySelector('#drop');
  const input = root.querySelector('#files');
  if (drop) {
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => {
      filesFromDrop(e.dataTransfer).then(files => files.length ? handleFiles(files) : noFiles());
    });
  }
  input?.addEventListener('change', () => handleFiles(input.files));
  const folder = root.querySelector('#folder');
  folder?.addEventListener('change', () => handleFiles([...folder.files].filter(f => isMailFileName(f.name))));

  const panel = root.querySelector('#panel');
  const show = html => { panel.innerHTML = html; panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  if (reopenAddr && panel) { reopenAddr = false; panel.innerHTML = addressPanel(store.get()); }

  const selectHowto = app => {
    for (const t of root.querySelectorAll('[data-action="howto-app"]')) {
      const on = t.dataset.app === app;
      t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1;
      root.querySelector('#howto-' + t.dataset.app).hidden = !on;
    }
  };
  // Arrow keys move between the mail apps, as in any tab list.
  root.querySelector('.seg')?.addEventListener('keydown', e => {
    const tabs = [...root.querySelectorAll('[data-action="howto-app"]')];
    const i = tabs.indexOf(document.activeElement);
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (i < 0 || !step) return;
    e.preventDefault();
    const next = tabs[(i + step + tabs.length) % tabs.length];
    selectHowto(next.dataset.app); next.focus();
  });

  root.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const act = btn.dataset.action;
    const now = store.get();

    if (act === 'pick') input?.click();
    if (act === 'howto-app') selectHowto(btn.dataset.app);
    if (act === 'howto-go') { selectHowto(btn.dataset.app); root.querySelector('#howto-tab-' + btn.dataset.app)?.focus(); }
    if (act === 'pick-folder') root.querySelector('#folder')?.click();

    if (act === 'home-unsub') {
      const pending = now.custom.filter(t => senderClass(t) === 'unsub' && !t.unsubscribedAt && t.trust === 'verified' && !isWanted(t));
      const instant = pending.filter(t => unsubTier(t) === 'instant');
      const links = pending.filter(t => ['link', 'mail'].includes(unsubTier(t)));
      if (instant.length) runOneClickBatch(root, instant, links);
      else startUnsubQueue(root, links);
      root.querySelector('#unsub-queue').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (act === 'home-block') show(blockAllCard(now, { closable: true }));
    if (act === 'home-addr') show(addressPanel(now));
    if (act === 'addr-answer') {
      const { addr, answer } = btn.dataset;
      store.update(s => { s.addressAnswers = { ...(s.addressAnswers || {}), [addr]: answer || undefined }; });
      reopenAddr = true;
      rerender();
    }
    if (act === 'panel-close') { panel.innerHTML = ''; rerender(); }
    if (act === 'copy-text') {
      navigator.clipboard.writeText(btn.dataset.text)
        .then(() => { btn.classList.add('copied'); toast(L('Copied', 'Gekopieerd')); })
        .catch(() => toast(L('Could not copy', 'Kopiëren mislukt')));
    }
  });

  // Ticking off a step of a move: saved on this device, panel redrawn in place.
  root.addEventListener('change', e => {
    const box = e.target.closest('[data-action="move-step"]');
    if (!box) return;
    const { addr, step } = box.dataset;
    store.update(s => {
      const moves = s.addressMoves || (s.addressMoves = {});
      const done = new Set(moves[addr] || []);
      if (box.checked) done.add(step); else done.delete(step);
      moves[addr] = MOVE_STEPS.filter(x => done.has(x));
    });
    const y = scrollY;
    panel.innerHTML = addressPanel(store.get());
    scrollTo(0, y);
  });
}
