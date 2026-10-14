// The user's own record of every request, as a spreadsheet: for their files,
// and to attach to a complaint. Made on this device; nothing is sent.

import * as store from './store.js';
import { L, lang } from './i18n.js';
import { keptMailing } from './letters.js';

// A cell that starts like a formula would run as one in a spreadsheet, and
// company names come from mail anyone can send.
const cell = v => {
  let s = String(v ?? '').replace(/\r?\n/g, ' ').trim();
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};

export function csvLog(state, targets, statusLabel, answerText) {
  const sep = lang() === 'nl' ? ';' : ',';
  const head = [L('Company', 'Bedrijf'), L('Website', 'Website'), L('Status', 'Status'), L('Sent on', 'Verstuurd op'),
    L('Sent to', 'Verstuurd aan'), L('Copies to', 'Kopie aan'), L('Deadline', 'Termijn tot'), L('Reminder sent', 'Herinnering verstuurd'),
    L('Answers', 'Antwoorden'), L('Bounced', 'Teruggekomen'), L('Unsubscribed on', 'Uitgeschreven op'),
    L('Last marketing mail', 'Laatste reclamemail'), L('Kept mailing', 'Bleef mailen'), L('Notes', 'Notities'), L('History', 'Geschiedenis')];
  const byId = new Map(targets.map(b => [b.id, b]));
  for (const t of state.custom || []) if (!byId.has(t.id)) byId.set(t.id, t);
  const rows = [];
  for (const b of byId.values()) {
    const r = store.getRequest(b.id);
    const touched = r.status !== 'todo' || r.history?.length || b.unsubscribedAt;
    if (!touched) continue;
    const due = r.sentAt ? new Date(Date.parse(r.sentAt + 'T00:00:00Z') + store.deadlineFor(b, r) * 864e5).toISOString().slice(0, 10) : '';
    const kept = keptMailing(b, r);
    rows.push([b.name || b.id, b.site || '', statusLabel(r.status), r.sentAt || '', r.sentTo || r.to || '', (r.sentCc || []).join(' '),
      due, r.reminderAt || '', (r.replies || []).map(answerText).join(' | '), (r.bounced || []).join(' '), b.unsubscribedAt || '',
      b.lastBulkAt || '', kept ? kept.last : '', r.notes || '',
      (r.history || []).map(h => `${String(h.ts).slice(0, 10)} ${h.event}`).join(' | ')]);
  }
  rows.sort((a, b) => String(b[3]).localeCompare(String(a[3])) || String(a[0]).localeCompare(String(b[0])));
  // A byte-order mark, so a spreadsheet reads the accents right.
  return '﻿' + [head, ...rows].map(r => r.map(cell).join(sep)).join('\r\n') + '\r\n';
}
