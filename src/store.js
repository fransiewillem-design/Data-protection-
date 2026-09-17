// Local-first state. Nothing here ever leaves the browser.
const KEY = 'data-reclaim/v1';

const EMPTY = {
  v: 1,
  profile: {
    fullName: '', birthDate: '', country: 'NL', language: 'en',
    emails: [], phones: [], addresses: ''
  },
  requests: {},   // brokerId -> record
  aliases: [],    // { id, alias, service, createdAt, status, spamSeen }
  custom: [],     // user-added brokers, same shape as data/brokers.json entries
  hibpKey: ''
};

function clone(o) { return JSON.parse(JSON.stringify(o)); }

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return clone(EMPTY);
    const parsed = JSON.parse(raw);
    // Merge forward so older saves keep working after an update.
    return { ...clone(EMPTY), ...parsed, profile: { ...EMPTY.profile, ...(parsed.profile || {}) } };
  } catch {
    return clone(EMPTY);
  }
}

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('Could not save state', err);
    alert('This browser refused to save (private window, or storage is full). Your changes will be lost when you close the tab. Export a backup from "Your details".');
  }
  listeners.forEach(fn => fn(state));
}

export function get() { return state; }

export function update(fn) { fn(state); persist(); }

export function reset() { state = clone(EMPTY); persist(); }

export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || parsed.v !== 1) {
    throw new Error('Not a Data Reclaim backup file.');
  }
  state = { ...clone(EMPTY), ...parsed, profile: { ...EMPTY.profile, ...(parsed.profile || {}) } };
  persist();
}

export function exportJSON() { return JSON.stringify(state, null, 2); }

// ---- request records -------------------------------------------------------

export const STATUSES = {
  todo:      { label: 'Not started', pill: 'todo' },
  sent:      { label: 'Sent',        pill: 'sent' },
  ack:       { label: 'Acknowledged', pill: 'ack' },
  done:      { label: 'Erased',      pill: 'done' },
  refused:   { label: 'Refused',     pill: 'refused' },
  escalated: { label: 'Escalated',   pill: 'escalated' }
};

// GDPR Art. 12(3): one month, extendable by two more.
// CCPA/CPRA: 45 days, extendable by another 45.
export function deadlineDays(broker) {
  const eu = broker.regions.includes('EU') || broker.regions.includes('NL') || broker.regions.includes('UK');
  return eu ? 30 : 45;
}

export function getRequest(brokerId) {
  return state.requests[brokerId] || { status: 'todo', sentAt: '', history: [], notes: '' };
}

export function setStatus(brokerId, status, extra = {}) {
  update(s => {
    const rec = s.requests[brokerId] || { status: 'todo', sentAt: '', history: [], notes: '' };
    rec.status = status;
    if (status === 'sent' && !extra.sentAt) rec.sentAt = today();
    Object.assign(rec, extra);
    rec.history = rec.history || [];
    rec.history.push({ ts: new Date().toISOString(), event: STATUSES[status]?.label || status });
    s.requests[brokerId] = rec;
  });
}

export function setNotes(brokerId, notes) {
  update(s => {
    const rec = s.requests[brokerId] || { status: 'todo', sentAt: '', history: [], notes: '' };
    rec.notes = notes;
    s.requests[brokerId] = rec;
  });
}

export function today() { return new Date().toISOString().slice(0, 10); }

export function daysSince(dateStr) {
  if (!dateStr) return null;
  const then = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(then.getTime())) return null;
  return Math.floor((Date.now() - then.getTime()) / 86400000);
}

export function isOverdue(broker, rec) {
  if (!['sent', 'ack'].includes(rec.status)) return false;
  const d = daysSince(rec.sentAt);
  return d !== null && d > deadlineDays(broker);
}
