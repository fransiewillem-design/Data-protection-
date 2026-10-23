// Two things with an Outlook.com mailbox, each through Microsoft's own sign-in
// and each asking for one permission only:
// - rules: adds the block rules in one go (Outlook on the web takes rule
//   values one at a time; Microsoft's API takes a list). Permission to change
//   mailbox settings, where rules live; not the mail itself.
// - read: fetches the Junk Email folder straight into the browser, so it can
//   be read here like dropped files. Permission to read mail; only that one
//   folder is fetched, nothing is changed and nothing is sent anywhere else.
// Never sending, never a refresh token. The permission is used for the
// requests below, held in memory only, and then forgotten. HoopUp never sees
// a password.

import { MS_CLIENT_ID, MS_TENANT, MS_HOSTS } from './config.js';

const AUTH = `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0`;
const SCOPES = {
  rules: 'https://graph.microsoft.com/MailboxSettings.ReadWrite',
  read: 'https://graph.microsoft.com/Mail.Read'
};
const GRAPH = 'https://graph.microsoft.com/v1.0/me';
const RULES = `${GRAPH}/mailFolders/inbox/messageRules`;
// Outlook.com empties Junk Email after ten days, so these are rarely reached:
// a thousand messages, or 300 MB in all, whichever comes first.
const MAX_READ = 1000, MAX_BYTES = 300 * 1024 * 1024;
const START = 'hoopup-ms-start', BACK = 'hoopup-ms-back';
// Values per rule: well within Outlook's size limit for rules.
const PER_RULE = 150;

const redirectUri = () => new URL('auth.html', location.href).href.replace(/[?#].*$/, '');
export const outlookAvailable = () => !!MS_CLIENT_ID
  && (MS_HOSTS.includes(location.hostname) || location.hostname === 'localhost');

const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Leaves for Microsoft's sign-in page; auth.html brings the answer back to
// the page for this mode.
export async function outlookStart(mode = 'rules') {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  sessionStorage.setItem(START, JSON.stringify({ verifier, state, at: Date.now(), mode }));
  const q = new URLSearchParams({
    client_id: MS_CLIENT_ID, response_type: 'code', redirect_uri: redirectUri(),
    // In the fragment, so the one-time code never reaches a server log.
    response_mode: 'fragment', scope: SCOPES[mode], state,
    code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account'
  });
  location.assign(`${AUTH}/authorize?${q}`);
}

// Whether the user just came back from Microsoft's sign-in.
export const outlookReturning = () => { try { return !!sessionStorage.getItem(BACK); } catch { return false; } };

export const ruleBodies = bl => {
  const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
  const sites = chunks(bl.links, PER_RULE), replies = chunks([...bl.replyTo, ...bl.sharedReplyTo], PER_RULE);
  const name = (what, i, n) => `HoopUp: ${what}${n > 1 ? ` ${i + 1}` : ''}`;
  // Inside one rule every kind of condition must match at once, so links and
  // reply addresses each get their own rules. A message moves to Deleted
  // Items, where it can still be recovered.
  return [
    ...sites.map((list, i) => ({ displayName: name('spam sites', i, sites.length), isEnabled: true,
      conditions: { bodyContains: list }, actions: { delete: true, stopProcessingRules: true } })),
    ...replies.map((list, i) => ({ displayName: name('reply addresses', i, replies.length), isEnabled: true,
      conditions: { headerContains: list }, actions: { delete: true, stopProcessingRules: true } }))
  ];
};

// Nothing from Microsoft goes into the browser's cache: not the mail, not the
// permission.
const send = { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' };

// Finishes the sign-in for one mode: { token } or { error }, or null when
// there is nothing to finish.
async function takeToken(mode) {
  let start, back;
  try {
    start = JSON.parse(sessionStorage.getItem(START) || 'null');
    back = JSON.parse(sessionStorage.getItem(BACK) || 'null');
  } finally {
    sessionStorage.removeItem(START);
    sessionStorage.removeItem(BACK);
  }
  if (!back) return null;
  if (back.error) return { error: back.error === 'access_denied' ? 'denied' : 'signin' };
  if (!start || (start.mode || 'rules') !== mode || !back.code || back.state !== start.state
    || Date.now() - start.at > 15 * 60e3) return { error: 'signin' };
  try {
    const res = await fetch(`${AUTH}/token`, { ...send, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: MS_CLIENT_ID, grant_type: 'authorization_code', code: back.code,
        redirect_uri: redirectUri(), code_verifier: start.verifier, scope: SCOPES[mode] }) });
    const token = (await res.json()).access_token;
    return token ? { token } : { error: 'signin' };
  } catch {
    return { error: 'signin' };
  }
}

// Finishes the sign-in and replaces any earlier HoopUp rules with the current
// ones. Returns { added, sites, replies } or { error }.
export async function outlookFinish(bl) {
  const got = await takeToken('rules');
  if (!got || got.error) return got;
  let token = got.token;

  const auth = { ...send, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
  try {
    const listed = await fetch(RULES, auth);
    if (!listed.ok) return { error: listed.status === 401 || listed.status === 403 ? 'denied' : 'rules' };
    const existing = (await listed.json()).value || [];
    // Earlier HoopUp rules are replaced, never stacked; the user's own rules
    // are left alone and keep running first.
    for (const r of existing.filter(r => /^HoopUp:/.test(r.displayName || ''))) {
      await fetch(`${RULES}/${encodeURIComponent(r.id)}`, { ...auth, method: 'DELETE' });
    }
    let sequence = Math.max(0, ...existing.filter(r => !/^HoopUp:/.test(r.displayName || '')).map(r => r.sequence || 0));
    let added = 0;
    for (const body of ruleBodies(bl)) {
      const res = await fetch(RULES, { ...auth, method: 'POST', body: JSON.stringify({ ...body, sequence: ++sequence }) });
      if (res.ok) added++;
    }
    if (!added) return { error: 'rules' };
    return { added, sites: bl.links.length, replies: bl.replyTo.length + bl.sharedReplyTo.length };
  } catch {
    return { error: 'rules' };
  } finally {
    token = '';
  }
}

// Finishes the sign-in and fetches the Junk Email folder, each message as it
// arrived (its full source, headers included), for reading on this device.
// Returns { mails: [text] } or { error }, or null when nothing to finish.
export async function outlookReadJunk(onProgress = () => {}) {
  const got = await takeToken('read');
  if (!got || got.error) return got;
  let token = got.token;
  const auth = { ...send, headers: { Authorization: `Bearer ${token}` } };
  try {
    const ids = [];
    let next = `${GRAPH}/mailFolders/junkemail/messages?$select=id&$top=100`;
    while (next && ids.length < MAX_READ) {
      const res = await fetch(next, auth);
      if (!res.ok) return { error: res.status === 401 || res.status === 403 ? 'denied' : 'read' };
      const page = await res.json();
      for (const m of page.value || []) ids.push(m.id);
      // The permission only ever goes to Microsoft's own mail API.
      next = String(page['@odata.nextLink'] || '');
      try { if (next && new URL(next).origin !== 'https://graph.microsoft.com') next = ''; } catch { next = ''; }
    }
    const list = ids.slice(0, MAX_READ), mails = [];
    let done = 0, bytes = 0;
    // A few at a time: quick, and well inside Microsoft's limits.
    const worker = async () => {
      while (list.length && bytes < MAX_BYTES) {
        const id = list.shift();
        const res = await fetch(`${GRAPH}/messages/${encodeURIComponent(id)}/$value`, auth);
        if (res.ok) { const text = await res.text(); bytes += text.length; mails.push(text); }
        onProgress(++done, ids.length);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return { mails };
  } catch {
    return { error: 'read' };
  } finally {
    token = '';
  }
}
