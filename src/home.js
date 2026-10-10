// Home: the whole flow on one screen. Drop mail in, get four cards — each with
// one number and one button — and act on them without leaving the page.

import * as store from './store.js';
import { parseMessages, groupBySender } from './mailscan.js';
import {
  esc, toast, senderClass, unsubTier, upsertSender, runOneClickBatch,
  startUnsubQueue, wireQueue, wireBlock, blockAllCard, hostOf
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
    if (['spam', 'bait'].includes(senderClass(t))) h.scam += n;
    else h.real.push(t.name);
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
    `If it is an <b>alias</b> on your Microsoft account: Microsoft account → <b>Manage how you sign in</b> → remove ${code}.`,
    `If it is a <b>separate account</b> you only used for sign-ups: close that account once nothing you need is tied to it.`,
    `Until then, one Outlook rule — anything sent to ${code} → <b>Delete</b> — keeps it out of sight.`
  ];
  if (/^(icloud|me|mac)\./i.test(d)) return [
    `If it is a <b>Hide My Email</b> address: Settings → your name → iCloud → Hide My Email → choose it → <b>Deactivate</b>. Mail to it stops arriving at all.`,
    `If it is your main iCloud address it cannot be retired. Keep it for people, and give every company its own Hide My Email address from now on.`
  ];
  if (/^(gmail|googlemail)\./i.test(d)) return [
    `Gmail cannot drop one address without closing the account. Add a filter — To ${code} → <b>Delete it</b> — and stop giving it out.`
  ];
  return [`Delete the address or alias at your mail provider, or route everything sent to ${code} to Trash.`];
}

function addressPanel(state) {
  const health = addressHealth(state);
  if (!health.length) return '';
  return `
  <section class="card panel" id="addr-panel">
    <div class="row between"><h2>Your addresses</h2><button class="link-btn" data-action="panel-close">Close</button></div>
    <p class="small muted" style="margin-top:-4px">Based on the mail you have scanned so far.</p>
    ${health.map(h => {
      const pct = Math.round(100 * h.scam / Math.max(h.total, 1));
      const pill = { burned: ['overdue', 'Burned'], strained: ['escalated', 'Under attack'], ok: ['done', 'Fine'] }[h.verdict];
      let body = '';
      if (h.verdict === 'burned') body = `
        <p><b>${h.scam} of ${h.total}</b> mails were scams or spam, and nothing legitimate reaches it.
        This address is burned. Filters chase new domains forever; an address that no longer exists
        cannot be sold again. <b>Retire it.</b></p>
        <ol class="small">${retireSteps(h.address).map(x => `<li>${x}</li>`).join('')}</ol>`;
      if (h.verdict === 'strained') body = `
        <p><b>${h.scam} of ${h.total}</b> mails were scams or spam — but ${h.real.length === 1 ? 'a real sender still uses' : `${h.real.length} real senders still use`}
        it: ${h.real.map(esc).join(', ')}. Don't retire it yet.</p>
        <ol class="small">
          <li>Make a fresh address for ${h.real.length === 1 ? 'that sender' : 'those senders'} —
          one per company, so a leak names the leaker (<a href="#/aliases">Aliases</a>).</li>
          <li>Change your address with ${h.real.map(esc).join(', ')}.</li>
          <li>Then retire this one — or, if friends and family use it, keep it for them and stop
          using it for sign-ups.</li>
        </ol>`;
      if (h.verdict === 'ok') body = `<p class="small muted">${h.total} mail${h.total === 1 ? '' : 's'},
        ${h.scam ? `${h.scam} of them spam — not enough to act on` : 'all from real senders'}.</p>`;
      return `
      <div class="addr addr-${h.verdict}">
        <div class="addr-head"><span class="mono">${esc(h.address)}</span>
          <span class="pill ${pill[0]}">${pill[1]}</span></div>
        <div class="meter" title="${pct}% scam or spam"><span style="width:${pct}%"></span></div>
        ${body}
      </div>`;
    }).join('')}
  </section>`;
}

// ---- the page ----------------------------------------------------------------

function dropZone(compact) {
  return `
  <div id="drop" class="drop ${compact ? 'drop-compact' : 'drop-hero'}">
    ${compact
      ? `<span>${icon('drop')}</span><span><b>Drop more mail</b> to update — or
         <button class="link-btn" data-action="pick">choose files</button></span>`
      : `<div class="drop-icon">${icon('drop')}</div>
         <p class="drop-title">Drop your junk mail here</p>
         <p class="small muted">.eml or .mbox files · or <button class="link-btn" data-action="pick">choose files</button></p>`}
    <input type="file" id="files" multiple accept=".eml,.mbox,.txt,message/rfc822" hidden>
  </div>`;
}

const HOWTO = `
  <details class="howto">
    <summary>How do I get the files out of my mail app?</summary>
    <ul class="small">
      <li><b>Apple Mail:</b> open Junk, <code>Cmd+A</code>, drag onto the Desktop, drop the files here.</li>
      <li><b>Outlook:</b> select in Junk Email and drag to a Finder or Explorer window.</li>
      <li><b>Gmail:</b> Google Takeout → Mail → drop the <code>.mbox</code> here.</li>
    </ul>
  </details>`;

export function home(state) {
  const mail = state.custom.filter(t => t.source === 'mail');

  if (!mail.length) return `
  <section class="hero">
    <h1>Clean up your inbox</h1>
    <p>Drop in the mail from your Junk folder. It is sorted into what to unsubscribe from, what to
    block, and which companies to make delete your data — on this device. Nothing is uploaded.</p>
    ${dropZone(false)}
    ${HOWTO}
    <p class="small muted" style="margin-top:22px">Already know a company that holds your data?
    <a href="#/delete">Write to it directly</a>.</p>
  </section>`;

  const cls = senderClass;
  // Home's one button only ever acts on verified senders. An unverified one
  // (headers stripped, or never authenticated) needs its warning seen first,
  // which happens on the detail page, not behind a bulk button.
  const unsub = mail.filter(t => cls(t) === 'unsub');
  const pending = unsub.filter(t => !t.unsubscribedAt && t.trust === 'verified');
  const unchecked = unsub.filter(t => !t.unsubscribedAt && t.trust !== 'verified');
  const instant = pending.filter(t => unsubTier(t) === 'instant');
  const blocked = mail.filter(t => ['spam', 'bait'].includes(cls(t)));
  const bait = blocked.filter(t => cls(t) === 'bait').length;
  const exported = new Set(state.blockExport?.ids || []);
  const blockNew = state.blockExport ? blocked.filter(t => !exported.has(t.id)) : blocked;
  const companies = state.custom.filter(t => !['spam', 'bait'].includes(cls(t)));
  const asked = companies.filter(t => store.getRequest(t.id).status !== 'todo').length;
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
        ${c.more ? `<a class="more" href="${c.more}">Details</a>` : ''}
      </div>
    </article>`;

  return `
  <div class="home-head">
    <div>
      <h1>Your inbox</h1>
      <p class="muted">${mails} mail${mails === 1 ? '' : 's'} from ${mail.length} sender${mail.length === 1 ? '' : 's'}
      scanned · nothing left this device</p>
    </div>
  </div>

  <div class="actions">
    ${card({ icon: 'unsub', n: pending.length, title: 'Unsubscribe',
      text: (pending.length
        ? `${pending.length} verified sender${pending.length === 1 ? '' : 's'}.${instant.length ? ` ${instant.length} go${instant.length === 1 ? 'es' : ''} in one click.` : ''}`
        : unsub.length && !unchecked.length ? `Unsubscribed from all ${unsub.length}.` : 'No verified sender left to unsubscribe from.')
        + (unchecked.length ? ` ${unchecked.length} more could not be verified — check ${unchecked.length === 1 ? 'it' : 'them'} in Details.` : ''),
      cta: `Unsubscribe from ${pending.length}`, action: 'home-unsub', done: 'Nothing left', more: '#/unsubscribe' })}

    ${card({ icon: 'block', n: blockNew.length, tone: blockNew.length ? 'tone-bad' : '',
      title: 'Block',
      text: blockNew.length
        ? `${blockNew.length} scam${blockNew.length === 1 ? '' : 's'} and spam${bait ? `, ${bait} with fake unsubscribe links` : ''}. One import blocks them all.`
        : state.blockExport ? `Block list exported ${esc(state.blockExport.at)}. Nothing new since.` : 'No scams found.',
      cta: state.blockExport ? `Block ${blockNew.length} new` : `Block all ${blockNew.length}`,
      action: 'home-block', done: blocked.length ? 'Blocked' : 'Nothing to block', more: '#/unsubscribe' })}

    ${card({ icon: 'delete', n: companies.length - asked,
      title: 'Delete my data',
      text: companies.length - asked
        ? `${companies.length - asked} compan${companies.length - asked === 1 ? 'y holds' : 'ies hold'} your data. A legal request makes them erase it within a month.`
        : companies.length ? `All ${companies.length} asked. Deadlines are tracked.` : 'No company to write to yet.',
      cta: 'Write the letters', href: '#/delete', done: companies.length ? 'All asked' : 'Nothing yet' })}

    ${card({ icon: 'addr', n: flagged.length, tone: worst?.verdict === 'burned' ? 'tone-bad' : '',
      title: 'Your addresses',
      text: worst
        ? `<span class="mono">${esc(worst.address)}</span> is ${worst.verdict === 'burned' ? 'burned — retire it' : 'under attack'}.${flagged.length > 1 ? ` ${flagged.length - 1} more ${flagged.length === 2 ? 'needs' : 'need'} attention.` : ''}`
        : 'No address is overrun with spam.',
      cta: 'See what to do', action: 'home-addr', done: 'All fine' })}
  </div>

  <div id="unsub-queue"></div>
  <div id="panel"></div>

  ${dropZone(true)}

  <details class="senders">
    <summary>Every sender scanned (${mail.length})</summary>
    <div class="list">
      ${mail.map(t => {
        const c = cls(t);
        const [p, l] = c === 'bait' ? ['overdue', 'fake unsubscribe'] : c === 'spam' ? ['overdue', 'spam']
          : t.trust === 'verified' ? ['done', 'verified'] : ['low', 'unverified'];
        return `<div class="pick" style="cursor:default">
          <span class="pick-name">${esc(t.name)}</span><span class="pill ${p}">${l}</span>
          ${t.unsubscribedAt ? '<span class="pill">unsubscribed</span>' : ''}
          <span class="pick-meta mono">${esc(t.site || '')}</span></div>`;
      }).join('')}
    </div>
  </details>
  <p class="small muted" style="margin-top:18px"><a href="#/find">More ways to find who has your data</a>
  — breach records, mailbox searches, data brokers.</p>`;
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
      if (!messages.length) { toast('No mail headers found — use .eml or .mbox exports'); return; }
      const senders = groupBySender(messages);
      senders.forEach(sn => upsertSender(sn));
      rerender();
      toast(`${messages.length} mails from ${senders.length} senders sorted`);
    } catch (err) {
      toast('Could not read those files: ' + err.message);
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
