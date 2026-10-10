// Home: the whole flow on one screen. Drop mail in, get four cards — each with
// one number and one button — and act on them without leaving the page.

import * as store from './store.js';
import { L, plural } from './i18n.js';
import { relationOf } from './letters.js';
import { parseMessages, groupBySender } from './mailscan.js';
import {
  esc, toast, senderClass, unsubTier, upsertSender, runOneClickBatch,
  startUnsubQueue, wireQueue, wireBlock, blockAllCard, hostOf, nameOf, deleteWork
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
// and which real senders still depend on it. An address that only ever gets
// scams is burned — no filter keeps up, and retiring it ends the stream.

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
    else if (c !== 'unclear') h.real.push(t.name);
  }
  const rank = { burned: 0, strained: 1, ok: 2 };
  return [...by.values()].map(h => ({
    ...h,
    verdict: h.scam >= 2 && h.real.length === 0 ? 'burned'
           : h.scam >= 2 && h.scam / h.total >= 0.5 ? 'strained' : 'ok'
  })).sort((a, b) => rank[a.verdict] - rank[b.verdict] || b.scam - a.scam);
}

function retireSteps(addr) {
  const d = addr.split('@')[1] || '';
  const code = `<code>${esc(addr)}</code>`;
  if (/^(outlook|hotmail|live|msn)\./i.test(d)) return [
    L(`If it is an <b>alias</b> on your Microsoft account: Microsoft account → <b>Manage how you sign in</b> → remove ${code}.`,
      `Is het een <b>alias</b> van je Microsoft-account: Microsoft-account → <b>Beheren hoe je je aanmeldt</b> → verwijder ${code}.`),
    L(`If it is a <b>separate account</b> you only used for sign-ups: close that account once nothing you need is tied to it.`,
      `Is het een <b>apart account</b> dat je alleen voor aanmeldingen gebruikte: sluit het zodra er niets meer aan hangt wat je nodig hebt.`),
    L(`Until then, one Outlook rule — anything sent to ${code} → <b>Delete</b> — keeps it out of sight.`,
      `Tot die tijd houdt één Outlook-regel — alles aan ${code} → <b>Verwijderen</b> — het uit beeld.`)
  ];
  if (/^(icloud|me|mac)\./i.test(d)) return [
    L(`If it is a <b>Hide My Email</b> address: Settings → your name → iCloud → Hide My Email → choose it → <b>Deactivate</b>. Mail to it stops arriving at all.`,
      `Is het een <b>Verberg mijn e-mailadres</b>-adres: Instellingen → je naam → iCloud → Verberg mijn e-mailadres → kies het → <b>Deactiveer</b>. Er komt dan helemaal geen mail meer op binnen.`),
    L(`If it is your main iCloud address it cannot be retired. Keep it for people, and give every company its own Hide My Email address from now on.`,
      `Is het je hoofdadres bij iCloud, dan kun je het niet opheffen. Gebruik het alleen nog voor mensen en geef elk bedrijf voortaan een eigen Verberg mijn e-mailadres-adres.`)
  ];
  if (/^(gmail|googlemail)\./i.test(d)) return [
    L(`Gmail cannot drop one address without closing the account. Add a filter — To ${code} → <b>Delete it</b> — and stop giving it out.`,
      `Gmail kan geen los adres opheffen zonder het hele account te sluiten. Maak een filter — Aan ${code} → <b>Verwijderen</b> — en geef het niet meer uit.`)
  ];
  return [L(`Delete the address or alias at your mail provider, or route everything sent to ${code} to Trash.`,
            `Verwijder het adres of de alias bij je mailprovider, of stuur alles aan ${code} naar de prullenbak.`)];
}

function addressPanel(state) {
  const health = addressHealth(state);
  if (!health.length) return '';
  return `
  <section class="card panel" id="addr-panel">
    <div class="row between"><h2>${L('Your addresses', 'Je adressen')}</h2>
      <button class="link-btn" data-action="panel-close">${L('Close', 'Sluiten')}</button></div>
    <p class="small muted" style="margin-top:-4px">${L('Based on the mail you have scanned so far.', 'Op basis van de mail die je tot nu toe hebt gescand.')}</p>
    ${health.map(h => {
      const pct = Math.round(100 * h.scam / Math.max(h.total, 1));
      const pill = {
        burned: ['overdue', L('Burned', 'Verbrand')],
        strained: ['escalated', L('Under attack', 'Onder vuur')],
        ok: ['done', L('Fine', 'In orde')]
      }[h.verdict];
      const names = h.real.map(esc).join(', ');
      const one = h.real.length === 1;
      let body = '';
      if (h.verdict === 'burned') body = `
        <p>${L(`<b>${h.scam} of ${h.total}</b> mails were scams or spam, and nothing legitimate reaches it.
        This address is burned. Filters chase new domains forever; an address that no longer exists
        cannot be sold again. <b>Retire it.</b>`,
        `<b>${h.scam} van de ${h.total}</b> mails waren oplichting of spam, en er komt niets legitiems meer op binnen.
        Dit adres is verbrand. Filters lopen eindeloos achter nieuwe domeinen aan; een adres dat niet meer bestaat
        kan niet opnieuw verkocht worden. <b>Hef het op.</b>`)}</p>
        <ol class="small">${retireSteps(h.address).map(x => `<li>${x}</li>`).join('')}</ol>`;
      if (h.verdict === 'strained') body = `
        <p>${L(`<b>${h.scam} of ${h.total}</b> mails were scams or spam — but ${one ? 'a real sender still uses' : `${h.real.length} real senders still use`}
        it: ${names}. Don't retire it yet.`,
        `<b>${h.scam} van de ${h.total}</b> mails waren oplichting of spam — maar ${one ? 'een echte afzender gebruikt' : `${h.real.length} echte afzenders gebruiken`}
        het nog: ${names}. Hef het nog niet op.`)}</p>
        <ol class="small">
          <li>${L(`Make a fresh address for ${one ? 'that sender' : 'those senders'} —
          one per company, so a leak names the leaker (<a href="#/aliases">Aliases</a>).`,
          `Maak een nieuw adres voor ${one ? 'die afzender' : 'die afzenders'} —
          één per bedrijf, zodat een lek de lekker verraadt (<a href="#/aliases">Aliassen</a>).`)}</li>
          <li>${L(`Change your address with ${names}.`, `Wijzig je adres bij ${names}.`)}</li>
          <li>${L(`Then retire this one — or, if friends and family use it, keep it for them and stop
          using it for sign-ups.`,
          `Hef daarna dit adres op — of, als vrienden en familie het gebruiken, houd het voor hen en gebruik
          het niet meer voor aanmeldingen.`)}</li>
        </ol>`;
      if (h.verdict === 'ok') body = `<p class="small muted">${h.total} ${plural(h.total, 'mail', 'mails', 'mail', 'mails')},
        ${h.scam ? L(`${h.scam} of them spam — not enough to act on`, `waarvan ${h.scam} spam — te weinig om iets mee te doen`)
                 : L('none of them scams', 'geen oplichting')}.</p>`;
      return `
      <div class="addr addr-${h.verdict}">
        <div class="addr-head"><span class="mono">${esc(h.address)}</span>
          <span class="pill ${pill[0]}">${pill[1]}</span></div>
        <div class="meter" title="${pct}% ${L('scam or spam', 'oplichting of spam')}"><span style="width:${pct}%"></span></div>
        ${body}
      </div>`;
    }).join('')}
  </section>`;
}

// ---- the page ----------------------------------------------------------------

function dropZone(compact) {
  const pick = `<button class="link-btn" data-action="pick">${L('choose files', 'kies bestanden')}</button>`;
  return `
  <div id="drop" class="drop ${compact ? 'drop-compact' : 'drop-hero'}">
    ${compact
      ? `<span>${icon('drop')}</span><span>${L(`<b>Drop more mail</b> to update — or ${pick}`,
                                             `<b>Sleep meer mail hierheen</b> om bij te werken — of ${pick}`)}</span>`
      : `<div class="drop-icon">${icon('drop')}</div>
         <p class="drop-title">${L('Drop your junk mail here', 'Sleep je ongewenste mail hierheen')}</p>
         <p class="small muted">${L(`.eml or .mbox files · or ${pick}`, `.eml- of .mbox-bestanden · of ${pick}`)}</p>`}
    <input type="file" id="files" multiple accept=".eml,.mbox,.txt,message/rfc822" hidden>
  </div>`;
}

const HOWTO = () => `
  <details class="howto">
    <summary>${L('How do I get the files out of my mail app?', 'Hoe haal ik de bestanden uit mijn mailapp?')}</summary>
    <ul class="small">${L(`
      <li><b>Apple Mail:</b> open Junk, <code>Cmd+A</code>, drag onto the Desktop, drop the files here.</li>
      <li><b>Outlook:</b> select in Junk Email and drag to a Finder or Explorer window.</li>
      <li><b>Gmail:</b> Google Takeout → Mail → drop the <code>.mbox</code> here.</li>`, `
      <li><b>Apple Mail:</b> open Ongewenst, <code>Cmd+A</code>, sleep naar het bureaublad en dan hierheen.</li>
      <li><b>Outlook:</b> selecteer in Ongewenste e-mail en sleep naar een Finder- of Verkenner-venster.</li>
      <li><b>Gmail:</b> Google Takeout → Mail → sleep de <code>.mbox</code> hierheen.</li>`)}
    </ul>
  </details>`;

export function home(state) {
  const mail = state.custom.filter(t => t.source === 'mail');

  if (!mail.length) return `
  <section class="hero">
    <img class="hero-mark" src="assets/img/icon.svg" alt="" width="56" height="56">
    <h1>${L('Tell them to hoop up.', 'Laat ze ophoepelen.')}</h1>
    ${L('<p class="hero-eyebrow">From the Dutch <i>hoepel op!</i> — get lost.</p>', '')}
    <p>${L(`Drop in the mail from your Junk folder. Real companies get an unsubscribe, scams get blocked,
    and you see which companies to make delete your data — on this device. Nothing is uploaded.`,
    `Sleep de mail uit je map Ongewenst hierheen. Echte bedrijven krijgen een uitschrijving, oplichters worden
    geblokkeerd, en je ziet welke bedrijven je gegevens moeten wissen — op dit apparaat. Er wordt niets geüpload.`)}</p>
    ${dropZone(false)}
    <ul class="trust">
      <li>${L('Nothing is uploaded', 'Er wordt niets geüpload')}</li>
      <li>${L('No account', 'Geen account')}</li>
      <li>${L('Free &amp; open source', 'Gratis &amp; open source')}</li>
    </ul>
    ${HOWTO()}
    <p class="small muted" style="margin-top:22px">${L(`Already know a company that holds your data?
    <a href="#/delete">Write to it directly</a>.`, `Weet je al welk bedrijf je gegevens heeft?
    <a href="#/delete">Schrijf het direct aan</a>.`)}</p>
  </section>`;

  const cls = senderClass;
  // Home's one button only ever acts on verified senders. An unverified one
  // (headers stripped, or never authenticated) needs its warning seen first,
  // which happens on the detail page, not behind a bulk button.
  const unsub = mail.filter(t => cls(t) === 'unsub');
  const pending = unsub.filter(t => !t.unsubscribedAt && t.trust === 'verified');
  const unchecked = unsub.filter(t => !t.unsubscribedAt && t.trust !== 'verified');
  const instant = pending.filter(t => unsubTier(t) === 'instant');
  // Blocking is only for mail that failed the sender check. A real company is
  // never offered a block — only an unsubscribe and an erasure letter.
  const blocked = mail.filter(t => ['spam', 'bait'].includes(cls(t)));
  const bait = blocked.filter(t => cls(t) === 'bait').length;
  const unclear = mail.filter(t => cls(t) === 'unclear').length;
  const exported = new Set(state.blockExport?.ids || []);
  const blockNew = state.blockExport ? blocked.filter(t => !exported.has(t.id)) : blocked;
  const companies = state.custom.filter(t => !['spam', 'bait', 'unclear'].includes(cls(t)));
  const work = deleteWork(companies);
  const toAsk = work.send.length + work.forms.length;
  const followUps = work.reminders.length + work.complaints.length;
  const suspect = [...work.send, ...work.forms].filter(t => relationOf(t, store.getRequest(t.id)) === 'none').length;
  const flagged = addressHealth(state).filter(h => h.verdict !== 'ok');
  const worst = flagged[0];
  const mails = mail.reduce((n, t) => n + (t.mailCount || 1), 0);

  const card = c => `
    <article class="action ${c.n ? '' : 'is-done'} ${c.tone || ''}">
      <div class="action-head"><span class="action-icon">${icon(c.icon)}</span>
        <span class="action-n">${c.n ? c.n : '✓'}</span></div>
      <h3>${c.title}</h3>
      <p>${c.text}</p>
      <div class="action-foot">
        ${c.n ? (c.href ? `<a class="btn primary" href="${c.href}">${c.cta}</a>`
                        : `<button class="primary" data-action="${c.action}">${c.cta}</button>`)
              : `<span class="done-label">${c.done}</span>`}
        ${c.more ? `<a class="more" href="${c.more}">${L('Details', 'Details')}</a>` : ''}
      </div>
    </article>`;

  const unsubText = (pending.length
      ? L(`${pending.length} verified ${plural(pending.length, 'company', 'companies', '', '')}.`,
          `${pending.length} ${plural(pending.length, 'bevestigd bedrijf', 'bevestigde bedrijven', 'bevestigd bedrijf', 'bevestigde bedrijven')}.`)
        + (instant.length ? L(` ${instant.length} ${instant.length === 1 ? 'goes' : 'go'} in one click.`,
                              ` ${instant.length} met één klik.`) : '')
      : unsub.length && !unchecked.length
        ? L(`Unsubscribed from all ${unsub.length}.`, `Bij alle ${unsub.length} uitgeschreven.`)
        : L('No verified company left to unsubscribe from.', 'Geen bevestigd bedrijf meer om je bij uit te schrijven.'))
    + (unchecked.length ? L(` ${unchecked.length} more could not be verified — check ${unchecked.length === 1 ? 'it' : 'them'} in Details.`,
                            ` ${unchecked.length} ${unchecked.length === 1 ? 'andere kon' : 'andere konden'} niet worden bevestigd — bekijk ze bij Details.`) : '');

  const blockText = blockNew.length
    ? L(`${blockNew.length} ${plural(blockNew.length, 'sender', 'senders', '', '')} failed the sender check${bait ? `, ${bait} with fake unsubscribe links` : ''}. One import blocks them all.`,
        `${blockNew.length} ${plural(blockNew.length, 'afzender', 'afzenders', 'afzender', 'afzenders')} zakten voor de afzendercontrole${bait ? `, ${bait} met nep-uitschrijflinks` : ''}. Eén import blokkeert ze allemaal.`)
    : state.blockExport
      ? L(`Block list exported ${esc(state.blockExport.at)}. Nothing new since.`, `Blokkeerlijst geëxporteerd op ${esc(state.blockExport.at)}. Sindsdien niets nieuws.`)
      : L('No scams found. Real companies are never blocked — only unsubscribed.', 'Geen oplichting gevonden. Echte bedrijven worden nooit geblokkeerd — alleen uitgeschreven.');

  const addrText = worst
    ? `<span class="mono">${esc(worst.address)}</span> ${worst.verdict === 'burned'
        ? L('is burned — retire it.', 'is verbrand — hef het op.')
        : L('is under attack.', 'ligt onder vuur.')}${flagged.length > 1
        ? L(` ${flagged.length - 1} more ${flagged.length === 2 ? 'needs' : 'need'} attention.`, ` Nog ${flagged.length - 1} ${flagged.length === 2 ? 'vraagt' : 'vragen'} aandacht.`) : ''}`
    : L('No address is overrun with spam.', 'Geen enkel adres wordt overspoeld met spam.');

  return `
  <div class="home-head">
    <div>
      <h1>${L('Your inbox', 'Je inbox')}</h1>
      <p class="muted">${L(
        `${mails} ${plural(mails, 'mail', 'mails', '', '')} from ${mail.length} ${plural(mail.length, 'sender', 'senders', '', '')} scanned · nothing left this device`,
        `${mails} ${plural(mails, '', '', 'mail', 'mails')} van ${mail.length} ${plural(mail.length, '', '', 'afzender', 'afzenders')} gescand · niets heeft dit apparaat verlaten`)}</p>
    </div>
  </div>

  <div class="actions">
    ${card({ icon: 'unsub', n: pending.length, title: L('Unsubscribe', 'Uitschrijven'),
      text: unsubText,
      cta: L(`Unsubscribe from ${pending.length}`, `Bij ${pending.length} uitschrijven`), action: 'home-unsub',
      done: L('Nothing left', 'Niets meer te doen'), more: '#/unsubscribe' })}

    ${card({ icon: 'block', n: blockNew.length, tone: blockNew.length ? 'tone-bad' : '',
      title: L('Block scams', 'Oplichting blokkeren'),
      text: blockText,
      cta: state.blockExport ? L(`Block ${blockNew.length} new`, `${blockNew.length} nieuwe blokkeren`)
                             : L(`Block all ${blockNew.length}`, `Alle ${blockNew.length} blokkeren`),
      action: 'home-block', done: blocked.length ? L('Blocked', 'Geblokkeerd') : L('Nothing to block', 'Niets te blokkeren'),
      more: '#/unsubscribe' })}

    ${card({ icon: 'delete', n: toAsk + followUps, tone: followUps ? 'tone-bad' : '',
      title: L('Delete my data', 'Mijn gegevens wissen'),
      text: [
        toAsk ? L(`${toAsk} ${toAsk === 1 ? 'company holds' : 'companies hold'} your data. A legal request makes them erase it within a month.`,
                  `${toAsk} ${toAsk === 1 ? 'bedrijf heeft' : 'bedrijven hebben'} je gegevens. Een AVG-verzoek verplicht ze die binnen een maand te wissen.`) : '',
        suspect ? L(`${suspect} with no reason to have it ${suspect === 1 ? 'goes' : 'go'} first.`,
                    `${suspect} zonder reden om ze te hebben ${suspect === 1 ? 'gaat' : 'gaan'} voor.`) : '',
        work.reminders.length ? L(`${work.reminders.length} did not answer in time — a reminder is ready.`,
                                  `${work.reminders.length} ${work.reminders.length === 1 ? 'reageerde' : 'reageerden'} niet op tijd — een herinnering staat klaar.`) : '',
        work.complaints.length ? L(`${work.complaints.length} ready for a complaint to the regulator.`,
                                   `${work.complaints.length} klaar voor een klacht bij de toezichthouder.`) : '',
        !toAsk && !followUps ? (companies.length
          ? L(`All ${companies.length} asked. Deadlines are tracked — reminders appear here when one is due.`,
              `Alle ${companies.length} aangeschreven. De termijnen worden bijgehouden — herinneringen verschijnen hier zodra het tijd is.`)
          : L('No company to write to yet.', 'Nog geen bedrijf om aan te schrijven.')) : ''
      ].filter(Boolean).join(' '),
      cta: work.send.length ? L(`Send ${work.send.length} ${work.send.length === 1 ? 'request' : 'requests'}`, `${work.send.length} ${work.send.length === 1 ? 'verzoek' : 'verzoeken'} versturen`)
         : work.reminders.length ? L('Send reminders', 'Herinneringen versturen') : L('Open', 'Openen'),
      href: work.send.length ? '#/delete?send=1' : '#/delete',
      done: companies.length ? L('All asked', 'Alles verstuurd') : L('Nothing yet', 'Nog niets') })}

    ${card({ icon: 'addr', n: flagged.length, tone: worst?.verdict === 'burned' ? 'tone-bad' : '',
      title: L('Your addresses', 'Je adressen'),
      text: addrText,
      cta: L('See what to do', 'Bekijk wat je kunt doen'), action: 'home-addr', done: L('All fine', 'Alles in orde') })}
  </div>

  ${unclear ? `<p class="small muted">${L(
    `${unclear} ${plural(unclear, 'sender', 'senders', '', '')} could not be checked either way, so ${unclear === 1 ? 'it is' : 'they are'} neither blocked nor written to. <a href="#/unsubscribe">See which</a>.`,
    `${unclear} ${plural(unclear, '', '', 'afzender', 'afzenders')} ${unclear === 1 ? 'kon' : 'konden'} niet gecontroleerd worden, dus ${unclear === 1 ? 'die wordt' : 'die worden'} niet geblokkeerd en niet aangeschreven. <a href="#/unsubscribe">Bekijk welke</a>.`)}</p>` : ''}

  <div id="unsub-queue"></div>
  <div id="panel"></div>

  ${dropZone(true)}

  <details class="senders">
    <summary>${L(`Every sender scanned (${mail.length})`, `Alle gescande afzenders (${mail.length})`)}</summary>
    <div class="list">
      ${mail.map(t => {
        const c = cls(t);
        const [p, l] = c === 'bait' ? ['overdue', L('fake unsubscribe · block', 'nep-uitschrijflink · blokkeren')]
          : c === 'spam' ? ['overdue', L('failed check · block', 'zakte voor controle · blokkeren')]
          : c === 'unclear' ? ['low', L('could not verify', 'niet te bevestigen')]
          : t.trust === 'verified' ? ['done', c === 'unsub' ? L('verified · unsubscribe', 'bevestigd · uitschrijven') : L('verified company', 'bevestigd bedrijf')]
          : ['low', L('unverified', 'onbevestigd')];
        return `<div class="pick" style="cursor:default">
          <span class="pick-name">${esc(nameOf(t))}</span><span class="pill ${p}">${l}</span>
          ${t.unsubscribedAt ? `<span class="pill">${L('unsubscribed', 'uitgeschreven')}</span>` : ''}
          <span class="pick-meta mono">${esc(t.site || '')}</span></div>`;
      }).join('')}
    </div>
  </details>
  <p class="small muted" style="margin-top:18px">${L(`<a href="#/find">More ways to find who has your data</a>
  — breach records, mailbox searches, data brokers.`, `<a href="#/find">Meer manieren om te zien wie je gegevens heeft</a>
  — datalekken, zoeken in je mailbox, databrokers.`)}</p>`;
}

export function mountHome(root, state, rerender) {
  wireQueue(root, rerender);
  wireBlock(root, state);

  async function handleFiles(list) {
    const files = [...list];
    if (!files.length) return;
    try {
      const texts = await Promise.all(files.map(f => f.text()));
      const messages = texts.flatMap(t => parseMessages(t));
      if (!messages.length) { toast(L('No mail headers found — use .eml or .mbox exports', 'Geen mailheaders gevonden — gebruik .eml- of .mbox-bestanden')); return; }
      const senders = groupBySender(messages);
      senders.forEach(sn => upsertSender(sn));
      rerender();
      toast(L(`${messages.length} ${plural(messages.length, 'mail', 'mails', '', '')} from ${senders.length} ${plural(senders.length, 'sender', 'senders', '', '')} sorted`,
        `${messages.length} ${plural(messages.length, '', '', 'mail', 'mails')} van ${senders.length} ${plural(senders.length, '', '', 'afzender', 'afzenders')} gesorteerd`));
    } catch (err) {
      toast(L('Could not read those files: ', 'Kon die bestanden niet lezen: ') + err.message);
    }
  }

  const drop = root.querySelector('#drop');
  const input = root.querySelector('#files');
  if (drop) {
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => handleFiles(e.dataTransfer.files));
  }
  input?.addEventListener('change', () => handleFiles(input.files));

  const panel = root.querySelector('#panel');
  const show = html => { panel.innerHTML = html; panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  root.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const act = btn.dataset.action;
    const now = store.get();

    if (act === 'pick') input?.click();

    if (act === 'home-unsub') {
      const pending = now.custom.filter(t => senderClass(t) === 'unsub' && !t.unsubscribedAt && t.trust === 'verified');
      const instant = pending.filter(t => unsubTier(t) === 'instant');
      const links = pending.filter(t => unsubTier(t) === 'link');
      if (instant.length) runOneClickBatch(root, instant, links);
      else startUnsubQueue(root, links);
      root.querySelector('#unsub-queue').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (act === 'home-block') show(blockAllCard(now, { closable: true }));
    if (act === 'home-addr') show(addressPanel(now));
    if (act === 'panel-close') { panel.innerHTML = ''; rerender(); }
  });
}
