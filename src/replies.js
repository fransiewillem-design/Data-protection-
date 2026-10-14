// Which dropped messages are answers to the user's letters, and from which
// company. An answer quotes the letter's reference (HU-XXXXX), or comes from
// the company's own domain on the subject of the request. Mail the user sent
// themselves (a whole-mailbox export holds the letters too) never counts.

import { registrableDomain } from './mailscan.js';
import { refOf } from './letters.js';

const OPEN = new Set(['sent', 'ack', 'refused', 'escalated']);
const brandOf = host => registrableDomain(String(host || '').toLowerCase()).split('.')[0];
const hostOf = a => String(a || '').toLowerCase().split('@')[1] || '';

// The user's own addresses: what they wrote from, and what companies wrote to.
export function ownedAddresses(state) {
  return new Set([...(state.profile?.emails || []),
    ...(state.custom || []).flatMap(b => [b.evidence?.address, ...(b.evidence?.emails || [])])]
    .filter(Boolean).map(a => String(a).toLowerCase()));
}

export function matchAnswers(messages, state) {
  const custom = new Map((state.custom || []).map(b => [b.id, b]));
  const open = Object.entries(state.requests || {}).filter(([, r]) => OPEN.has(r.status)).map(([id, rec]) => {
    const b = custom.get(id) || { id };
    const brands = new Set([b.site, hostOf(rec.sentTo), ...(rec.sentCc || []).map(hostOf), hostOf(b.privacyEmail),
      hostOf(b.lookup?.email), hostOf(b.email)].filter(Boolean).map(brandOf).filter(x => x && x.length > 1));
    return { id, rec, brands, ref: refOf(b) };
  });
  if (!open.length) return { answers: [], used: new Set() };

  const owned = ownedAddresses(state);

  const answers = [], used = new Set();
  for (const m of messages) {
    // Forged mail is never an answer, whatever it quotes.
    if (!m.reply || m.bounce || m.trust === 'forged' || owned.has(String(m.address || '').toLowerCase())) continue;
    const bulk = !!(m.unsub?.http || m.unsub?.mailto);
    const byRef = open.filter(o => m.reply.refs.includes(o.ref));
    // Without the reference: their own domain (checked, not a scam), not a
    // mailing, and about the request. An order confirmation with a privacy
    // footer is none of these.
    const hit = byRef.length ? byRef
      : bulk || m.personal || m.risk || m.providerSpam || m.trust !== 'verified' || !(m.reply.subjectHit || m.reply.bodyHit) ? []
      : open.filter(o => o.brands.has(brandOf(m.domain)));
    const o = hit.find(x => !m.at || !x.rec.sentAt || m.at >= x.rec.sentAt);
    if (!o) continue;
    answers.push({ id: o.id, at: m.at || '', kind: m.reply.kind, from: String(m.address || '').toLowerCase(), subject: m.subject || '' });
    used.add(m);
  }
  return { answers, used };
}
