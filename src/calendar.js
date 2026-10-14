// Deadlines as a calendar file, for the reminders a server would otherwise
// send. Made on this device and saved by the user; it holds company names and
// dates only, nothing about the user.

import * as store from './store.js';
import { L } from './i18n.js';
import { refOf } from './letters.js';

const { REMINDER_GRACE } = store;

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// RFC 5545 text: escaped, and folded at 75 octets without splitting a character.
const text = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function fold(line) {
  const enc = new TextEncoder();
  const out = [];
  let cur = '', size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; size = 0; }
    cur += ch; size += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

// [{ date, kind, id, summary, description }] for everything still ahead.
export function upcoming(state, targets, today = store.today()) {
  const out = [];
  for (const b of targets) {
    const r = store.getRequest(b.id);
    if (!['sent', 'ack'].includes(r.status) || !r.sentAt) continue;
    if (!r.reminderAt) {
      const date = addDays(r.sentAt, store.deadlineFor(b, r) + 1);
      if (date >= today) out.push({ date, kind: 'deadline', id: b.id,
        summary: L(`Deadline: ${b.name} must answer your data request`, `Termijn: ${b.name} moet je verzoek beantwoorden`),
        description: L(`${b.name} had until yesterday. No answer? Open HoopUp: a reminder is ready.`,
                       `${b.name} had tot gisteren. Geen antwoord? Open HoopUp: er staat een herinnering klaar.`) });
    } else {
      const date = addDays(r.reminderAt, REMINDER_GRACE + 1);
      if (date >= today) out.push({ date, kind: 'reminder', id: b.id,
        summary: L(`${b.name}: reminder period over`, `${b.name}: termijn van de herinnering voorbij`),
        description: L(`Still no answer from ${b.name}? Open HoopUp: a complaint to the regulator is ready.`,
                       `Nog steeds geen antwoord van ${b.name}? Open HoopUp: er staat een klacht bij de toezichthouder klaar.`) });
    }
  }
  // Two weeks after the latest unsubscribe: time to see who kept mailing.
  const last = (state.custom || []).map(t => t.unsubscribedAt).filter(Boolean).sort().at(-1);
  if (last && addDays(last, 14) >= today) out.push({ date: addDays(last, 14), kind: 'rescan', id: 'rescan',
    summary: L('Scan your junk mail again', 'Scan je ongewenste mail opnieuw'),
    description: L('Drop your junk folder into HoopUp again. It shows who kept mailing after you unsubscribed, and recognises answers to your letters.',
                   'Sleep je map Ongewenst opnieuw in HoopUp. Je ziet dan wie bleef mailen nadat je je uitschreef, en antwoorden op je brieven worden herkend.') });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function icsFor(state, targets, link) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const events = upcoming(state, targets).flatMap(e => [
    'BEGIN:VEVENT',
    // Stable per company and kind, so importing again updates the event.
    `UID:${e.kind}-${refOf({ id: e.id }).slice(3).toLowerCase()}@hoopup.tech`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${e.date.replace(/-/g, '')}`,
    `DTEND;VALUE=DATE:${addDays(e.date, 1).replace(/-/g, '')}`,
    `SUMMARY:${text(e.summary)}`,
    `DESCRIPTION:${text(`${e.description}\n${link}`)}`,
    `URL:${link}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${text(e.summary)}`, 'TRIGGER:PT9H', 'END:VALARM',
    'END:VEVENT'
  ]);
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HoopUp//Deadlines//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    ...events, 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
}
