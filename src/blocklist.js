// Turns the senders marked as spam or bait into block rules for the user's mail
// client. Generated on the device and handed over as a file or text to import;
// nothing is sent anywhere, and the app never touches the mailbox itself.

import { registrableDomain } from './mailscan.js';

// Mail services shared by many senders, legitimate ones included. Blocking one
// of these outright would catch wanted mail, so they only ever appear as a
// narrow reply-to rule, and the UI says so.
export const SHARED_SERVICES = new Set([
  'getdrip.com', 'drip.com', 'sendgrid.net', 'mailchimp.com', 'mcsv.net', 'mailgun.org',
  'amazonses.com', 'sparkpostmail.com', 'brevo.com', 'sendinblue.com', 'klaviyomail.com',
  'hubspotemail.net', 'mailjet.com', 'postmarkapp.com', 'useinsider.com', 'salesforce.com',
  'exacttarget.com', 'mandrillapp.com',
  // consumer mail: never block a whole provider
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'yahoo.com', 'proton.me', 'protonmail.com',
  // link infrastructure everyone uses
  'google.com', 'apple.com', 'microsoft.com', 'facebook.com', 'instagram.com',
  'twitter.com', 'x.com', 'youtube.com', 'linkedin.com', 'bit.ly'
]);

const isRealDomain = d => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d || '');

export function buildBlockList(targets, classOf) {
  const blockable = targets.filter(t => ['spam', 'bait'].includes(classOf(t)));

  // Anything a verified sender relies on is off limits, so a newsletter the
  // user wants can never be caught by a rule written for a scam.
  const safe = new Set();
  for (const t of targets) {
    if (t.trust !== 'verified') continue;
    if (t.site) safe.add(t.site);
    (t.linkDomains || []).forEach(d => safe.add(d));
    (t.replyToHosts || []).forEach(h => safe.add(registrableDomain(h)));
  }
  const usable = d => isRealDomain(d) && !safe.has(d) && !SHARED_SERVICES.has(d);

  const senders = new Set(), links = new Set(), replyTo = new Set(), sharedReplyTo = new Set();
  let unblockableSenders = 0;

  for (const t of blockable) {
    if (usable(t.site)) senders.add(t.site);
    else if (!isRealDomain(t.site)) unblockableSenders++;
    (t.linkDomains || []).filter(usable).forEach(d => links.add(d));
    for (const h of t.replyToHosts || []) {
      const reg = registrableDomain(h);
      if (safe.has(reg)) continue;
      (SHARED_SERVICES.has(reg) ? sharedReplyTo : replyTo).add(h);
    }
  }

  const sort = s => [...s].sort();
  return {
    count: blockable.length,
    senders: sort(senders),
    links: sort(links),
    replyTo: sort(replyTo),
    sharedReplyTo: sort(sharedReplyTo),
    unblockableSenders,
    // every domain a plain "blocked senders" list can usefully hold
    domains: sort(new Set([...senders, ...links]))
  };
}

// ---- formats ----------------------------------------------------------------

export function asPlainList(bl) {
  return bl.domains.join('\n') + (bl.domains.length ? '\n' : '');
}

const xmlEsc = s => String(s).replace(/[&<>'"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;' }[c]));

// Gmail's own export format (Settings → Filters and Blocked Addresses → Import).
// Queries are chunked because Gmail rejects very long filter criteria.
export function asGmailXml(bl, now = new Date()) {
  const stamp = now.toISOString().replace(/\.\d+Z$/, 'Z');
  const chunk = (arr, n) => arr.length ? Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n)) : [];
  const entries = [];
  let i = 0;
  const entry = (prop, value) => {
    i++;
    entries.push(`  <entry>
    <category term='filter'></category>
    <title>Mail Filter</title>
    <id>tag:mail.google.com,2008:filter:dr${now.getTime()}${i}</id>
    <updated>${stamp}</updated>
    <content></content>
    <apps:property name='${prop}' value='${xmlEsc(value)}'/>
    <apps:property name='shouldTrash' value='true'/>
    <apps:property name='sizeOperator' value='s_sl'/>
    <apps:property name='sizeUnit' value='s_smb'/>
  </entry>`);
  };
  chunk(bl.senders, 20).forEach(c => entry('from', c.join(' OR ')));
  chunk(bl.links, 20).forEach(c => entry('hasTheWord', c.join(' OR ')));
  return `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns='http://www.w3.org/2005/Atom' xmlns:apps='http://schemas.google.com/apps/2006'>
  <title>Mail Filters</title>
  <id>tag:mail.google.com,2008:filters:dr${now.getTime()}</id>
  <updated>${stamp}</updated>
${entries.join('\n')}
</feed>
`;
}

const sieveList = arr => '[' + arr.map(s => '"' + s.replace(/["\\]/g, '\\$&') + '"').join(', ') + ']';

// Sieve (RFC 5228): Fastmail, Proton, Mailbox.org and most self-hosted mail.
// Moves to Junk rather than discarding, so a wrong match is recoverable.
export function asSieve(bl) {
  const tests = [];
  if (bl.senders.length) tests.push(`  address :domain :is "from" ${sieveList(bl.senders)}`);
  if (bl.replyTo.length + bl.sharedReplyTo.length)
    tests.push(`  header :contains "reply-to" ${sieveList([...bl.replyTo, ...bl.sharedReplyTo])}`);
  if (bl.links.length) tests.push(`  body :contains ${sieveList(bl.links)}`);
  if (!tests.length) return '# Nothing to block yet.\n';
  return `# Generated by Data Reclaim on ${new Date().toISOString().slice(0, 10)}.
# Catches the senders you marked as spam, plus the sites and reply addresses
# their campaigns reuse. Moves matches to Junk; change the folder if yours
# is called something else (Proton: "Spam").
require ["fileinto", "body"];

if anyof (
${tests.join(',\n')}
) {
  fileinto "Junk";
  stop;
}
`;
}

// Picks the most likely client from the address the spam actually reached.
export function guessClient(targets) {
  const votes = {};
  for (const t of targets) {
    const a = (t.evidence?.address || '').toLowerCase();
    const k = /@(outlook|hotmail|live|msn)\./.test(a) ? 'outlookcom'
            : /@(gmail|googlemail)\./.test(a) ? 'gmail'
            : /@(icloud|me|mac)\./.test(a) ? 'apple' : null;
    if (k) votes[k] = (votes[k] || 0) + 1;
  }
  return Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] || 'outlookcom';
}
