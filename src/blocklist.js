// Turns the senders marked as spam or bait into block rules for the user's mail
// client. Generated on the device and handed over as a file or text to import;
// nothing is sent anywhere, and the app never touches the mailbox itself.

import { registrableDomain, cleanHost } from './mailscan.js';

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

  // Anything a legitimate sender relies on is off limits, so a newsletter the
  // user wants can never be caught by a rule written for a scam. "Legitimate"
  // is the classification, not just a passed sender check: a casino that owns
  // its domain passes that check, and must not shield its own link sites.
  const safe = new Set();
  for (const t of targets) {
    if (t.trust !== 'verified' || !['unsub', 'company'].includes(classOf(t))) continue;
    if (t.site) safe.add(t.site);
    (t.linkDomains || []).forEach(d => safe.add(d));
    (t.replyToHosts || []).forEach(h => safe.add(registrableDomain(cleanHost(h))));
  }
  const usable = d => isRealDomain(d) && !safe.has(d) && !SHARED_SERVICES.has(d);

  // The From domain of a forged message is never blocked: it is either made up
  // (useless to block) or a real company's, borrowed for the scam (harmful to
  // block). What the scammer actually owns is where the links and replies go.
  const links = new Set(), replyTo = new Set(), sharedReplyTo = new Set();

  for (const t of blockable) {
    (t.linkDomains || []).filter(usable).forEach(d => links.add(d));
    // A sender that passed the check owns its domain, so here — unlike forged
    // mail — the domain itself is a fair target.
    if (t.trust === 'verified' && usable(t.site)) links.add(t.site);
    // Cleaned again here for senders stored before cleanHost existed.
    for (const h of (t.replyToHosts || []).map(cleanHost).filter(Boolean)) {
      const reg = registrableDomain(h);
      if (safe.has(reg)) continue;
      (SHARED_SERVICES.has(reg) ? sharedReplyTo : replyTo).add(h);
    }
  }

  const sort = s => [...s].sort();
  return {
    count: blockable.length,
    links: sort(links),
    replyTo: sort(replyTo),
    sharedReplyTo: sort(sharedReplyTo)
  };
}

// ---- formats ----------------------------------------------------------------

export const asLinkList = bl => bl.links.join('\n') + (bl.links.length ? '\n' : '');
export const asReplyList = bl => [...bl.replyTo, ...bl.sharedReplyTo].join('\n');

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
  if (bl.replyTo.length + bl.sharedReplyTo.length)
    tests.push(`  header :contains "reply-to" ${sieveList([...bl.replyTo, ...bl.sharedReplyTo])}`);
  if (bl.links.length) tests.push(`  body :contains ${sieveList(bl.links)}`);
  if (!tests.length) return '# Nothing to block yet.\n';
  return `# Generated by HoopUp on ${new Date().toISOString().slice(0, 10)}.
# Catches mail from senders that failed authentication, by what their
# campaigns reuse: the sites they link to and the address replies go to.
# The From address is never matched — in forged mail it is made up or
# borrowed from a real company. Moves matches to Junk; change the folder if
# yours is called something else (Proton: "Spam").
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

// ---- one-paste scripts ------------------------------------------------------
// Apple Mail and Outlook have no way to paste a list into one rule field: a
// pasted list becomes a single value no message contains. A script that builds
// the rule is the one thing the user can copy once and paste once. Every value
// in these lists comes from received mail, i.e. from the scammer, so only plain
// hostnames are let through: nothing else can reach the script's syntax.
const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const hosts = arr => arr.filter(h => HOST.test(h));
const scriptName = day => `HoopUp ${/^\d{4}-\d\d-\d\d$/.test(day) ? day : ''}`.trim();

// Script Editor on a Mac: paste, press Run. One rule, "any condition", which
// moves matches to the Trash and is then run once over Junk and Inbox.
export function asAppleScript(bl, day) {
  const name = scriptName(day);
  const links = hosts(bl.links), replies = hosts([...bl.replyTo, ...bl.sharedReplyTo]);
  const conds = [
    ...links.map(h => `    make new rule condition at end of rule conditions with properties {rule type:message content, qualifier:does contain value, expression:"${h}"}`),
    ...replies.map(h => `    make new rule condition at end of rule conditions with properties {rule type:header key, header:"Reply-To", qualifier:does contain value, expression:"${h}"}`)
  ];
  // A rule with no conditions under "any" would match every message.
  if (!conds.length) return '-- Nothing to block yet.\n';
  return `-- HoopUp: adds the rule "${name}" to Apple Mail. Press Run (▶).
tell application "Mail"
  if exists rule "${name}" then delete rule "${name}"
  set r to make new rule at end of rules with properties {name:"${name}", enabled:true, all conditions must be met:false, delete message:true, stop evaluating rules:true}
  tell r
${conds.join('\n')}
  end tell
  try
    delete (every rule condition of r whose expression is "")
  end try
  try
    perform mail action with messages (every message of junk mailbox) for rule r
  end try
  try
    perform mail action with messages (every message of inbox) for rule r
  end try
end tell
display dialog "HoopUp: rule added with ${conds.length} conditions. Scams already in Junk and Inbox went to the Trash." buttons {"OK"} default button "OK"
`;
}

// Classic Outlook for Windows, via PowerShell: paste, press Enter. Two rules,
// because within one Outlook rule every condition must match at once.
export function asPowerShell(bl, day) {
  const name = scriptName(day);
  const list = arr => '@(' + arr.map(h => `'${h}'`).join(',') + ')';
  const links = hosts(bl.links), replies = hosts([...bl.replyTo, ...bl.sharedReplyTo]);
  const rule = (label, cond, arr) => `  $n = '${name} ${label}'; try { $rules.Remove($n) } catch {}
  $r = $rules.Create($n, 0)
  $r.Conditions.${cond}.Text = [string[]]${list(arr)}
  $r.Conditions.${cond}.Enabled = $true
  $r.Actions.DeleteMessage.Enabled = $true
  $made += $r`;
  if (!links.length && !replies.length) return '# Nothing to block yet.\n';
  return `# HoopUp: adds block rules to Outlook. Paste into PowerShell and press Enter.
& {
  try { $ol = New-Object -ComObject Outlook.Application } catch { Write-Host 'HoopUp: classic Outlook is not installed here. In the new Outlook, follow the Outlook.com steps.'; return }
  $rules = $ol.Session.DefaultStore.GetRules()
  $made = @()
${[links.length ? rule('links', 'BodyOrSubject', links) : '', replies.length ? rule('replies', 'MessageHeader', replies) : ''].filter(Boolean).join('\n')}
  $rules.Save()
  foreach ($f in 23, 6) { foreach ($r in $made) { try { $r.Execute($false, $ol.Session.GetDefaultFolder($f)) } catch {} } }
  Write-Host 'HoopUp: rules added. Scams already in Junk and Inbox were deleted.'
}
`;
}
