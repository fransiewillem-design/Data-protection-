// Turns the senders marked as spam or bait into block rules for the user's mail
// client. Generated on the device and handed over as a file or text to import;
// nothing is sent anywhere, and the app never touches the mailbox itself.

import { registrableDomain, cleanHost, isPersonalDomain } from './mailscan.js';

// A plain address, with nothing that could break out of a rule or a script.
const ADDRESS = /^[a-z0-9._+-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

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
    (t.replyToHosts || []).forEach(h => { if (!h.includes('@')) safe.add(registrableDomain(cleanHost(h))); });
  }
  // A free mail provider (Ziggo, GMX…) is never a target: a scammer with an
  // address there says nothing about everyone else who has one.
  const usable = d => isRealDomain(d) && !safe.has(d) && !SHARED_SERVICES.has(d) && !isPersonalDomain(d);

  // The From domain of a forged message is never blocked: it is either made up
  // (useless to block) or a real company's, borrowed for the scam (harmful to
  // block). What the scammer actually owns is where the links and replies go.
  const links = new Set(), replyTo = new Set(), sharedReplyTo = new Set();

  for (const t of blockable) {
    (t.linkDomains || []).filter(usable).forEach(d => links.add(d));
    // A sender that passed the check owns its domain, so here, unlike forged
    // mail, the domain itself is a fair target.
    if (t.trust === 'verified' && usable(t.site)) links.add(t.site);
    // Cleaned again here for senders stored before cleanHost existed.
    for (const h of (t.replyToHosts || []).map(cleanHost).filter(Boolean)) {
      // An exact address (a scammer on a free mail service) is narrow enough
      // to match as is.
      if (h.includes('@')) { if (ADDRESS.test(h)) replyTo.add(h); continue; }
      const reg = registrableDomain(h);
      if (safe.has(reg)) continue;
      (SHARED_SERVICES.has(reg) || isPersonalDomain(reg) ? sharedReplyTo : replyTo).add(h);
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

// The same filter as one line for Gmail's search bar: braces mean "any of
// these", so one paste makes one filter. Split like the file, because Gmail
// rejects very long criteria.
export function asGmailQueries(bl) {
  const out = [];
  for (let i = 0; i < bl.links.length; i += 20) out.push('{' + bl.links.slice(i, i + 20).join(' ') + '}');
  return out;
}

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

// Where each service keeps spam, as its Sieve names it. A folder that does
// not exist is not an error everywhere: Fastmail then quietly leaves the
// message in the inbox, so the name has to be right. Fastmail names folders
// "INBOX.<name>" in Sieve; Proton's own examples use "spam"; Dovecot-based
// services (mailbox.org, Posteo, most self-hosted mail) call it "Junk".
export const SIEVE_FOLDER = { fastmail: 'INBOX.Spam', proton: 'spam', other: 'Junk' };

// Sieve (RFC 5228): Fastmail, Proton, Mailbox.org and most self-hosted mail.
// Moves to the spam folder rather than discarding, so a wrong match is
// recoverable.
export function asSieve(bl, host = 'other') {
  const folder = SIEVE_FOLDER[host] || SIEVE_FOLDER.other;
  const tests = [];
  if (bl.replyTo.length + bl.sharedReplyTo.length)
    tests.push(`  header :contains "reply-to" ${sieveList([...bl.replyTo, ...bl.sharedReplyTo])}`);
  if (bl.links.length) tests.push(`  body :contains ${sieveList(bl.links)}`);
  if (!tests.length) return '# Nothing to block yet.\n';
  return `# Generated by HoopUp on ${new Date().toISOString().slice(0, 10)}.
# Catches mail from senders that failed authentication, by what their
# campaigns reuse: the sites they link to and the address replies go to.
# The From address is never matched: in forged mail it is made up or
# borrowed from a real company. Moves matches to "${folder}", the spam
# folder${host === 'fastmail' ? ' on Fastmail' : host === 'proton' ? ' on Proton' : ' on most mail services'}.
require ["fileinto", "body"];

if anyof (
${tests.join(',\n')}
) {
  fileinto "${folder}";
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
const hosts = arr => arr.filter(h => HOST.test(h) || ADDRESS.test(h));
const scriptName = day => `HoopUp ${/^\d{4}-\d\d-\d\d$/.test(day) ? day : ''}`.trim();

// Script Editor on a Mac: paste, press Run. One rule, "any condition", which
// moves matches to the Trash. Mail's scripting has rough edges (properties
// given at creation are sometimes dropped), so the script checks its own work:
// it builds the rule switched off, reads every condition back, removes any that
// did not come out exactly as intended, and only then switches the rule on.
// A condition that went wrong can therefore only fail to match, never match
// more: the worst case is a rule that catches less, not one that eats mail.
export function asAppleScript(bl, day) {
  const name = scriptName(day);
  const links = hosts(bl.links), replies = hosts([...bl.replyTo, ...bl.sharedReplyTo]);
  if (!links.length && !replies.length) return '-- Nothing to block yet.\n';
  const list = arr => '{' + arr.map(h => `"${h}"`).join(', ') + '}';
  return `-- HoopUp: adds the rule "${name}" to Apple Mail. Press Run.
set siteList to ${list(links)}
set replyList to ${list(replies)}
set added to 0
set skipped to 0
tell application "Mail"
  if exists rule "${name}" then delete rule "${name}"
  set r to make new rule at end of rules with properties {name:"${name}"}
  try
    -- Off, and with no action, until the checks below have passed.
    set enabled of r to false
    set delete message of r to false
    set all conditions must be met of r to false
    -- a new rule can start with a blank condition; never keep one
    try
      repeat with c in (get every rule condition of r)
        delete (contents of c)
      end repeat
    end try
    -- Every value of Mail's own terms sits in parentheses: written plainly,
    -- "set rule type of c to header key" reads as Mail's "to header" and
    -- does not compile.
    repeat with v in siteList
      set c to make new rule condition at end of rule conditions of r with properties {rule type:(message content), qualifier:(does contain value), expression:(v as text)}
      if rule type of c is not (message content) then set rule type of c to (message content)
      if qualifier of c is not (does contain value) then set qualifier of c to (does contain value)
      if expression of c is not (v as text) then set expression of c to (v as text)
      if rule type of c is (message content) and qualifier of c is (does contain value) and expression of c is (v as text) then
        set added to added + 1
      else
        delete c
        set skipped to skipped + 1
      end if
    end repeat
    repeat with v in replyList
      set c to make new rule condition at end of rule conditions of r with properties {rule type:(header key), header:"Reply-To", qualifier:(does contain value), expression:(v as text)}
      -- Some Mail versions drop the type or the header name on creation.
      if rule type of c is not (header key) then set rule type of c to (header key)
      if header of c is not "Reply-To" then set header of c to "Reply-To"
      if qualifier of c is not (does contain value) then set qualifier of c to (does contain value)
      if expression of c is not (v as text) then set expression of c to (v as text)
      if rule type of c is (header key) and header of c is "Reply-To" and qualifier of c is (does contain value) and expression of c is (v as text) then
        set added to added + 1
      else
        delete c
        set skipped to skipped + 1
      end if
    end repeat
    set safe to (added > 0) and (all conditions must be met of r is false)
    repeat with c in (get every rule condition of r)
      if expression of (contents of c) is "" then set safe to false
    end repeat
    if not safe then error "checks failed"
    set delete message of r to true
    set enabled of r to true
    set msg to "HoopUp: rule \\"${name}\\" added with " & added & " conditions."
    if skipped > 0 then set msg to msg & " " & skipped & " could not be added; please tell HoopUp."
    set msg to msg & return & return & "New scams now go straight to the Trash. To clear what is already in Junk, empty it in one go: for an Outlook.com, Hotmail or Exchange account on outlook.com (Junk Email > Empty folder), which also avoids Mail's 'Invalid base64 string' error; for other accounts in Mail (Junk, Cmd-A, Delete)."
  on error errText
    try
      delete r
    end try
    set msg to "HoopUp: Mail did not accept the rule (" & errText & "), so nothing was changed. Please tell HoopUp."
  end try
end tell
display dialog msg buttons {"OK"} default button "OK"
`;
}

// Classic Outlook for Windows, via PowerShell: paste, press Enter. Two rules,
// because within one Outlook rule every condition must match at once.
export function asPowerShell(bl, day) {
  const name = scriptName(day);
  const list = arr => '@(' + arr.map(h => `'${h}'`).join(',') + ')';
  const links = hosts(bl.links), replies = hosts([...bl.replyTo, ...bl.sharedReplyTo]);
  if (!links.length && !replies.length) return '# Nothing to block yet.\n';
  // Exchange limits how large a mailbox's rules may be, so long lists are
  // split over several rules of at most 100 values each.
  const parts = (arr, n = 100) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
  const rules = [
    ...parts(links).map((arr, i, all) => [`links${all.length > 1 ? ' ' + (i + 1) : ''}`, 'BodyOrSubject', arr]),
    ...parts(replies).map((arr, i, all) => [`replies${all.length > 1 ? ' ' + (i + 1) : ''}`, 'MessageHeader', arr])
  ];
  const rule = ([label, cond, arr]) => `  $r = $rules.Create('${name} ${label}', 0)
  $r.Conditions.${cond}.Text = [string[]]${list(arr)}
  $r.Conditions.${cond}.Enabled = $true
  $r.Actions.Delete.Enabled = $true
  $made += $r`;
  return `# HoopUp: adds block rules to Outlook. Paste into PowerShell and press Enter.
& {
  try { $ol = New-Object -ComObject Outlook.Application }
  catch { Write-Host 'HoopUp: could not reach classic Outlook. Is it installed? If this PowerShell window runs as administrator, open a normal one and paste again. The new Outlook cannot run scripts: on HoopUp, choose New Outlook instead.'; return }
  $rules = $ol.Session.DefaultStore.GetRules()
  # Running it again the same day replaces that day's rules instead of adding copies.
  for ($i = $rules.Count; $i -ge 1; $i--) { if ($rules.Item($i).Name -like '${name} *') { $rules.Remove($i) } }
  $made = @()
${rules.map(rule).join('\n')}
  try { $rules.Save($false) }
  catch { Write-Host "HoopUp: Outlook did not accept the rules ($($_.Exception.Message)), so nothing was saved. Please tell HoopUp."; return }
  foreach ($f in 23, 6) { foreach ($r in $made) { try { $r.Execute($false, $ol.Session.GetDefaultFolder($f)) } catch {} } }
  Write-Host "HoopUp: $($made.Count) rules added to Outlook. Scams already in Junk and Inbox were moved to Deleted Items."
}
`;
}
