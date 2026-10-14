// Adds the block rules to an Outlook.com mailbox in one go, through Microsoft's
// own sign-in. Outlook on the web takes rule values one at a time; Microsoft's
// API takes a list.
//
// What it asks for: permission to change mailbox settings (where rules live),
// and nothing else. Not the mail itself, not sending, not a refresh token. The
// permission is used for the requests below, held in memory only, and then
// forgotten. The sign-in happens on Microsoft's page; HoopUp never sees a
// password. What goes to Microsoft is the rules: the spam sites and reply
// addresses, sent to the user's own mailbox.

import { MS_CLIENT_ID, MS_TENANT, MS_HOSTS } from './config.js';

const AUTH = `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0`;
const SCOPE = 'https://graph.microsoft.com/MailboxSettings.ReadWrite';
const RULES = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messageRules';
const START = 'hoopup-ms-start', BACK = 'hoopup-ms-back';
// Values per rule: well within Outlook's size limit for rules.
const PER_RULE = 150;

const redirectUri = () => new URL('auth.html', location.href).href.replace(/[?#].*$/, '');
export const outlookAvailable = () => !!MS_CLIENT_ID
  && (MS_HOSTS.includes(location.hostname) || location.hostname === 'localhost');

const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Leaves for Microsoft's sign-in page; auth.html brings the answer back.
export async function outlookStart() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  sessionStorage.setItem(START, JSON.stringify({ verifier, state, at: Date.now() }));
  const q = new URLSearchParams({
    client_id: MS_CLIENT_ID, response_type: 'code', redirect_uri: redirectUri(),
    // In the fragment, so the one-time code never reaches a server log.
    response_mode: 'fragment', scope: SCOPE, state,
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

// Finishes the sign-in and replaces any earlier HoopUp rules with the current
// ones. Returns { added, sites, replies } or { error }.
export async function outlookFinish(bl) {
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
  if (!start || !back.code || back.state !== start.state || Date.now() - start.at > 15 * 60e3) return { error: 'signin' };

  const send = { credentials: 'omit', referrerPolicy: 'no-referrer' };
  let token;
  try {
    const res = await fetch(`${AUTH}/token`, { ...send, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: MS_CLIENT_ID, grant_type: 'authorization_code', code: back.code,
        redirect_uri: redirectUri(), code_verifier: start.verifier, scope: SCOPE }) });
    token = (await res.json()).access_token;
  } catch { /* below */ }
  if (!token) return { error: 'signin' };

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
