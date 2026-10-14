// Parses exported mail (.eml / .mbox) in the browser and works out who has been
// mailing you. Nothing is uploaded: the File is read with FileReader and every
// line below runs on the user's own machine.

import { identityFrom, textLines } from './identity.js';

const MULTI_TLD = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'co.jp', 'com.au', 'net.au', 'org.au',
  'com.br', 'co.nz', 'co.za', 'com.mx', 'co.in', 'com.tr', 'com.cn', 'com.sg'
]);

// Bulk senders that are infrastructure, not the company you want to write to.
const ESP_DOMAINS = new Set([
  'sendgrid.net', 'mailchimp.com', 'mcsv.net', 'mailgun.org', 'sparkpostmail.com',
  'amazonses.com', 'mandrillapp.com', 'sendinblue.com', 'brevo.com', 'klaviyomail.com',
  'hubspotemail.net', 'salesforce.com', 'exacttarget.com', 'mailjet.com', 'postmarkapp.com'
]);

// --- header decoding -------------------------------------------------------

// RFC 2047: =?UTF-8?B?...?= and =?UTF-8?Q?...?=
export function decodeWords(s) {
  return String(s || '').replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (whole, charset, enc, txt) => {
    try {
      let bin;
      if (enc.toLowerCase() === 'b') {
        bin = atob(txt.replace(/\s/g, ''));
      } else {
        bin = txt.replace(/_/g, ' ')
                 .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      }
      const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
      return new TextDecoder(charset).decode(bytes);
    } catch {
      return whole;   // unknown charset or bad base64: leave it as it was
    }
  }).replace(/\?=\s+=\?/g, '');   // adjacent encoded words
}

// Headers can be folded across lines; continuation lines start with space or tab.
export function parseHeaders(block) {
  const headers = {};
  const lines = block.split(/\r?\n/);
  let current = null;
  for (const line of lines) {
    if (/^[ \t]/.test(line)) {
      // A folded line belongs to the header above it, and only if that one
      // was kept: otherwise a later duplicate (say, a sender-written
      // Authentication-Results claiming "dmarc=pass") would be glued onto
      // the genuine first one.
      if (current) headers[current] += ' ' + line.trim();
    } else {
      const m = line.match(/^([A-Za-z0-9-]+):\s*(.*)$/);
      if (!m) { current = null; continue; }
      const name = m[1].toLowerCase();
      // Keep the first occurrence: the topmost header is the one the user's
      // own mail provider added last. Anything below it came with the message.
      if (name in headers) { current = null; continue; }
      current = name;
      headers[name] = m[2];
    }
  }
  return headers;
}

export function registrableDomain(host) {
  const parts = String(host || '').toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_TLD.has(lastTwo) && parts.length >= 3) return parts.slice(-3).join('.');
  return lastTwo;
}

// The host part of an address, cut at the first character no hostname can
// hold: malformed headers like 'x@scam.example>' would otherwise carry the
// stray '>' into a block rule, which then never matches.
export function cleanHost(h) {
  return String(h || '').toLowerCase().split(/[\s<>"'()[\],;:\\]/)[0].replace(/^\.+|\.+$/g, '');
}

// What a block rule should match for a Reply-To: the host, or, on a free mail
// service, the exact address (one scammer on Proton is not every Proton user).
function replyTarget(rt) {
  if (isPersonalDomain(rt.domain) && /^[a-z0-9._+-]+@[a-z0-9.-]+$/i.test(rt.address)) return rt.address.toLowerCase();
  return rt.host;
}

export function parseFrom(raw) {
  const value = decodeWords(raw || '');

  // The address is the LAST angle-bracket group holding an '@'. Taking the first
  // one lets a display name containing '<...>' hijack the parse, which both
  // malformed senders and deliberately crafted headers do.
  const groups = [...value.matchAll(/<([^>]*)>/g)].filter(m => m[1].includes('@'));
  const last = groups.length ? groups[groups.length - 1] : null;

  let address, name;
  if (last) {
    address = last[1].trim();
    name = value.slice(0, last.index).trim();
  } else {
    // No brackets: the whole value is the address, if it looks like one.
    const bare = value.trim();
    address = bare.includes('@') ? bare : '';
    name = address ? '' : bare;
  }

  address = address.replace(/^["'<]+|["'>]+$/g, '').trim();
  name = name.replace(/^["']|["']$/g, '').trim();
  const host = cleanHost(address.split('@')[1]);
  return { address, name, host, domain: registrableDomain(host) };
}

// List-Unsubscribe: <https://...>, <mailto:...?subject=unsub>
export function parseUnsubscribe(raw) {
  const out = { http: '', mailto: '' };
  for (const m of String(raw || '').matchAll(/<([^>]+)>/g)) {
    const url = unwrapSafeLink(m[1].trim());
    if (/^https?:/i.test(url) && !out.http) out.http = url;
    if (/^mailto:/i.test(url) && !out.mailto) out.mailto = url;
  }
  return out;
}


// --- message bodies --------------------------------------------------------
//
// Most bulk mail, and nearly all Dutch bulk mail, puts its unsubscribe link in
// the body rather than in a List-Unsubscribe header. Reading headers alone
// classified real retailers as untraceable spam, so the body has to be decoded.

function decodeTransfer(raw, encoding, charset) {
  const enc = (encoding || '').toLowerCase().trim();
  let bin;
  if (enc === 'base64') {
    try { bin = atob(raw.replace(/\s/g, '')); } catch { return raw; }
  } else if (enc === 'quoted-printable') {
    bin = raw.replace(/=\r?\n/g, '')                       // soft line breaks
             .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  } else {
    return raw;   // 7bit / 8bit / binary: already text
  }
  try {
    return new TextDecoder(charset || 'utf-8').decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  } catch {
    return bin;
  }
}

function paramOf(headerValue, name) {
  const m = new RegExp(name + '\\s*=\\s*"?([^";]+)"?', 'i').exec(headerValue || '');
  return m ? m[1].trim() : '';
}

// Walks multipart trees and returns the decoded text/plain and text/html parts.
export function extractParts(headers, body, depth = 0) {
  const ctype = headers['content-type'] || 'text/plain';
  if (depth > 6) return [];

  if (/^multipart\//i.test(ctype)) {
    const boundary = paramOf(ctype, 'boundary');
    if (!boundary) return [];
    const chunks = body.split(new RegExp('--' + boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
    const out = [];
    for (const chunk of chunks) {
      const trimmed = chunk.replace(/^\r?\n/, '');
      if (!trimmed.trim() || trimmed.startsWith('--')) continue;
      const split = trimmed.search(/\r?\n\r?\n/);
      if (split === -1) continue;
      out.push(...extractParts(parseHeaders(trimmed.slice(0, split)), trimmed.slice(split).replace(/^\r?\n\r?\n/, ''), depth + 1));
    }
    return out;
  }

  if (!/^text\//i.test(ctype)) return [];
  return [{
    type: /html/i.test(ctype) ? 'html' : 'text',
    text: decodeTransfer(body, headers['content-transfer-encoding'], paramOf(ctype, 'charset'))
  }];
}

// Every site the message links to, as registrable domains. Scam campaigns
// rotate the sender domain on every message but reuse their link hosts, so
// these are what a block rule can actually hold on to.
export function collectLinkDomains(parts) {
  const out = new Set();
  for (const part of parts) {
    if (part.type !== 'html') continue;
    const re = /<a\b([^>]*)>/gi;
    let m;
    while ((m = re.exec(part.text))) {
      const orig = /originalsrc\s*=\s*["']([^"']+)["']/i.exec(m[1]);
      const raw = /\bhref\s*=\s*["']([^"']+)["']/i.exec(m[1]);
      const url = unwrapSafeLink(((orig || raw) || [])[1]?.replace(/&amp;/g, '&') || '');
      try {
        const host = new URL(url).hostname;
        if (host) out.add(registrableDomain(host));
      } catch { /* mailto:, anchors, junk */ }
      if (out.size >= 15) return [...out];
    }
  }
  return [...out];
}

// Delivery failure notices, in the forms the big providers send them.
function isBounce(h, from) {
  return /^(mailer-?daemon|postmaster|mail-daemon)$/i.test(from.address.split('@')[0])
    || /report-type\s*=\s*"?delivery-status/i.test(h['content-type'] || '')
    || /^\s*(undeliverable|undelivered|delivery status notification \(failure\)|mail delivery failed|returned mail|failure notice|delivery has failed|message not delivered|onbestelbaar|niet bezorgd|kan niet worden bezorgd)\b/i.test(decodeWords(h.subject || ''));
}

// Every address the notice mentions. The app only acts on the ones it sent a
// letter to, so a notice that quotes other addresses changes nothing.
function bouncedTo(h, body) {
  const out = new Set();
  for (const m of String(h['x-failed-recipients'] || '').matchAll(/[\w.+-]+@[\w.-]+\.\w+/g)) out.add(m[0].toLowerCase());
  for (const m of body.slice(0, 200000).matchAll(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi)) out.add(m[0].toLowerCase());
  return [...out].slice(0, 40);
}

// Addresses the company itself uses to talk to the user: the reply address
// of its mail, a service address in its footer, and the address it sends from.
// A request sent to one of these reaches them through a channel they
// provided, which the GDPR counts (EDPB Guidelines 01/2022), even when the
// privacy address is unknown. No-reply and bulk addresses never qualify.
// Never: addresses that say nobody reads them. The guidance lets a company
// ignore a request sent to a channel plainly not meant for messages.
const NO_REPLY = /^(no-?reply|do-?not-?reply|donotreply|noreply|mailer|bounces?|postmaster|mailer-daemon|automated|system)([._+-].*)?$/i;
// Weak: bulk senders. A channel the company uses, but rarely read; only used
// when there is nothing better.
const BULK = /^(newsletters?|nieuwsbrief|news|nieuws|marketing|notifications?|notificaties|alerts?|campaign|promo|deals|mail)([._+-].*)?$/i;
const SERVICE_LOCAL = /^(klantenservice|service|support|contact|info|customerservice|customer[.-]?service|customercare|help|helpdesk|hallo|hello|vragen|klantcontact|care|webshop|orders?|bestellingen)$/i;

export function serviceAddresses(parts, fromAddress, replyAddress, domain) {
  const brand = registrableDomain(domain).split('.')[0];
  const ours = a => { const h = String(a).split('@')[1] || ''; return !!brand && registrableDomain(h).split('.')[0] === brand; };
  const valid = a => /^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(a || '') && ours(a) && !NO_REPLY.test(a.split('@')[0]);
  const strong = a => valid(a) && !BULK.test(a.split('@')[0]);
  const out = [];
  // In order: the reply address they set, a service address in their footer,
  // and the address they wrote from.
  if (strong(replyAddress)) out.push(replyAddress);
  for (const part of parts) for (const m of (part.text || '').matchAll(/([a-z0-9._+-]+)@([a-z0-9.-]+\.[a-z]{2,})/gi)) {
    const a = `${m[1]}@${m[2]}`;
    if (SERVICE_LOCAL.test(m[1]) && strong(a)) out.push(a);
  }
  if (strong(fromAddress)) out.push(fromAddress);
  if (!out.length) for (const a of [replyAddress, fromAddress]) if (valid(a)) out.push(a);
  return [...new Set(out.map(a => a.toLowerCase()))].slice(0, 3);
}

// The company's own postal address, from its footer: a street and postcode
// close to its legal form ("B.V.", "N.V."), its Chamber of Commerce number or
// its name. A labelled delivery address is the user's and never taken.
export function companyPostal(lines, name, domain) {
  const brand = registrableDomain(domain).split('.')[0];
  const legal = /\b(b\.?v\.?|n\.?v\.?|v\.o\.f\.?|ltd|gmbh|s\.a\.|inc|kvk|chamber of commerce|handelsregister)\b/i;
  const tail = lines.slice(-60);
  for (let i = tail.length - 1; i > 0; i--) {
    const pc = /\b[1-9]\d{3}\s?[A-Z]{2}\s+\p{Lu}[\p{L} .'-]{1,30}/u.exec(tail[i]);
    if (!pc) continue;
    const parts = tail[i].split(/,\s+|\s+[|·•]\s+/).map(x => x.trim());
    const pcPart = parts.find(x => /\b[1-9]\d{3}\s?[A-Z]{2}\b/.test(x)) || pc[0];
    const streetLine = parts.length > 1 ? parts[parts.indexOf(pcPart) - 1] : tail[i - 1];
    if (!streetLine || !/^[\p{L}][\p{L} .'-]{1,40}\s\d{1,5}\s?[a-zA-Z]?(?:[-\s]\d{1,4})?$/u.test(streetLine.trim())) continue;
    const near = tail.slice(Math.max(0, i - 4), i + 3).join(' ');
    if (/bezorgadres|afleveradres|factuuradres|delivery address|shipping address|billing address/i.test(near)) continue;
    if (!legal.test(near) && !near.toLowerCase().includes(brand) && !(name && near.includes(name))) continue;
    const who = parts.length > 2 ? parts[0] : (/\b(b\.?v\.?|n\.?v\.?)\b/i.test(tail[i - 2] || '') ? tail[i - 2] : name || '');
    return [who, streetLine.trim(), pcPart.trim()].filter(Boolean).join(', ').slice(0, 140);
  }
  return '';
}

// The company's own privacy contact, if its mail gives one: an address like
// privacy@ or dpo@, and a link to its privacy statement. Only on the sender's
// own domain (or the same brand under another country domain: zalando.de for
// zalando.nl), so a footer link to anyone else is never taken for theirs.
const PRIVACY_LOCAL = /^(privacy|privacyofficer|privacy[.-]officer|privacyteam|privacyvragen|privacydesk|privacy[.-]?office|dpo|fg|avg|gdpr|dataprotection|data[.-]protection|dataprotectionoffice(r)?|dataprivacy|datenschutz|gegevensbescherming|functionarisgegevensbescherming)$/i;
const PRIVACY_LINK = /privacy|privacyverklaring|privacybeleid|privacystatement|gegevensbescherming|datenschutz|data-protection/i;

export function privacyContact(parts, domain) {
  const brand = registrableDomain(domain).split('.')[0];
  const ours = host => !!brand && registrableDomain(host).split('.')[0] === brand;
  let email = '', url = '';
  for (const part of parts) {
    const text = part.text || '';
    if (!email) for (const m of text.matchAll(/(?:mailto:)?([a-z0-9._+-]+)@([a-z0-9.-]+\.[a-z]{2,})/gi)) {
      if (PRIVACY_LOCAL.test(m[1]) && ours(m[2])) { email = `${m[1]}@${m[2]}`.toLowerCase(); break; }
    }
    if (!url && part.type === 'html') for (const m of text.matchAll(/<a\b([^>]*)>([\s\S]{0,200}?)<\/a>/gi)) {
      const href = (/\bhref\s*=\s*["']([^"']+)["']/i.exec(m[1]) || [])[1]?.replace(/&amp;/g, '&') || '';
      const label = m[2].replace(/<[^>]+>/g, ' ');
      if (!PRIVACY_LINK.test(label) && !PRIVACY_LINK.test(href)) continue;
      try {
        const u = new URL(unwrapSafeLink(href));
        if (u.protocol === 'https:' && ours(u.hostname) && PRIVACY_LINK.test(u.pathname + ' ' + label)) { url = u.href; break; }
      } catch { /* not a link */ }
    }
    if (email && url) break;
  }
  return { email, url };
}

// Unsubscribe wording across the languages this is likely to meet.
const UNSUB_WORDS =
  /unsubscrib|uitschrijv|afmeld|uitschrijf|opt[\s-]?out|abmeld|austragen|d[eé]sabonn|desinscri|desuscri|darse\s+de\s+baja|cancelar.{0,12}suscri|annulla.{0,12}iscrizione|stop.{0,10}(mail|email)|e-?mailvoorkeur|mailvoorkeur|email.{0,10}preference|subscription.{0,10}preference/i;

export function unwrapSafeLink(url) {
  try {
    const u = new URL(url);
    if (/safelinks\.protection\.outlook\.com$/i.test(u.hostname) && u.searchParams.get('url')) {
      return u.searchParams.get('url');
    }
  } catch { /* not a URL */ }
  return url;
}

function stripTags(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

// Returns the best unsubscribe URL in the body, or ''.
export function findUnsubInBody(parts) {
  const candidates = [];

  for (const part of parts) {
    if (part.type === 'html') {
      const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = re.exec(part.text))) {
        const attrs = m[1];
        // Outlook keeps the pre-rewrite URL in originalsrc; otherwise unwrap.
        const orig = /originalsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
        const raw = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs);
        if (!orig && !raw) continue;
        const href = unwrapSafeLink((orig ? orig[1] : raw[1]).replace(/&amp;/g, '&').trim());
        if (!/^https?:\/\//i.test(href)) continue;
        const label = stripTags(m[2]);
        // The visible word is the stronger signal; a tracking URL often hides
        // the wording, and a href alone can match an unrelated path.
        if (UNSUB_WORDS.test(label)) candidates.push({ url: href, score: 2 });
        else if (UNSUB_WORDS.test(href)) candidates.push({ url: href, score: 1 });
      }
    } else {
      for (const line of part.text.split(/\r?\n/)) {
        if (!UNSUB_WORDS.test(line)) continue;
        const url = /(https?:\/\/[^\s<>"')]+)/i.exec(line);
        if (url) candidates.push({ url: url[1], score: 1 });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  if (!candidates.length) return { url: '', how: '' };
  // score 2 = the visible link text said "unsubscribe"; score 1 = only the URL
  // did, which is also what a scammer does to bait a click, so it is flagged.
  return { url: candidates[0].url, how: candidates[0].score === 2 ? 'body' : 'body-url-only' };
}

// --- sender authentication -------------------------------------------------

// Each result in the receiving server's Authentication-Results, with the
// domain it speaks for: "dkim=pass header.d=zalando.com". A pass only counts
// for the From domain when it is about that domain.
function authResults(ar) {
  const out = [];
  for (const part of ar.split(';')) {
    const m = /\b(spf|dkim|dmarc|compauth)\s*=\s*([a-z]+)/i.exec(part);
    if (!m) continue;
    const prop = k => ((new RegExp('\\b' + k + '\\s*=\\s*"?([^\\s;"()]+)', 'i').exec(part) || [])[1] || '');
    const method = m[1].toLowerCase();
    let domain = '';
    if (method === 'dkim') domain = prop('header\\.d') || prop('header\\.i').replace(/^.*@/, '');
    if (method === 'spf') domain = prop('smtp\\.mailfrom').replace(/^.*@/, '') || prop('smtp\\.helo');
    if (method === 'dmarc') domain = prop('header\\.from');
    out.push({ method, result: m[2].toLowerCase(), domain: domain.toLowerCase() });
  }
  return out;
}

export function parseAuth(h) {
  const ar = h['authentication-results'] || '';
  const results = authResults(ar);
  // Received-SPF: "pass (...) ... envelope-from=x@y.com;" when there is no
  // Authentication-Results to say it.
  const rs = h['received-spf'] || '';
  const rsResult = (/^\s*(pass|fail|softfail|neutral|none)/i.exec(rs) || [])[1];
  if (rsResult && !results.some(r => r.method === 'spf')) {
    const env = (/envelope-from\s*=\s*"?([^\s;"]+)/i.exec(rs) || /domain of \S*?@?([a-z0-9.-]+\.[a-z]{2,})/i.exec(rs) || [])[1] || '';
    results.push({ method: 'spf', result: rsResult.toLowerCase(), domain: env.replace(/^.*@/, '').toLowerCase() });
  }
  const first = method => results.find(r => r.method === method)?.result || '';
  const scl = parseInt((h['x-ms-exchange-organization-scl'] || '').trim(), 10);
  const forefront = (h['x-forefront-antispam-report'] || '') + ';' + (h['x-forefront-antispam-report-untrusted'] || '');
  return {
    results,
    spf: first('spf'), dkim: first('dkim'), dmarc: first('dmarc'),
    scl: Number.isFinite(scl) ? scl : null,
    compauthFail: first('compauth') === 'fail',
    compauthPass: first('compauth') === 'pass',
    // The receiving provider's own verdict. Only the high-confidence grades
    // count: ordinary junk (Microsoft SCL 5) also catches real newsletters.
    providerSpam: (Number.isFinite(scl) && scl >= 9) ||
      /\bCAT:(HSPM|PHSH|HPHSH|HPHISH|MALW|SPOOF)\b/i.test(forefront) ||
      /^\s*yes\b/i.test(h['x-spam-flag'] || '')
  };
}

// --- content risk ----------------------------------------------------------
//
// Passing the sender check proves who sent a message, not that it is wanted:
// an online casino that owns its domain passes SPF, DKIM and DMARC perfectly.
// These categories are unsafe whoever sends them, so they override "verified".
// Each needs two hits (a strong pattern counts as two), so a single stray word
// (a shop's "bonus" offer, a bank mentioning "investment") never trips it.

const RISK = [
  { cat: 'gambling',
    strong: [/\bcasino/i, /\b(free|gratis|bonus|extra)[ -]?spins?\b/i, /\bgiros? gratis\b/i, /\bfreispiele\b/i,
             /\bno[ -]deposit\b/i, /\b(deposit|stortings)[ -]?bonus\b/i, /\bsportsbook\b/i, /\b\d+\s?FS\b/],
    weak: [/\bjackpots?\b/i, /\bslots?\b/i, /\bwager/i, /\bbetting\b|\bweddenschap/i, /\bgokken\b|\bgok\b/i,
           /\b(welcome|welkoms?)[ -]?bonus\b/i, /\broulette\b|\bblackjack\b|\bpoker\b/i, /\bbonus (up to|tot|hasta)\b/i,
           /\bbono\b/i, /\bspins?\b/i] },
  { cat: 'crypto',
    strong: [/\b(guaranteed|gegarandeerd)\b.{0,40}\b(returns?|profits?|rendement|winst)\b/i,
             /\bdouble your (bitcoin|crypto|money|investment)\b/i, /\b(trading|crypto) ?(bot|robot)\b/i],
    weak: [/\bbitcoin\b/i, /\bcrypto(currency|valuta|munt)?\b/i, /\bpassive income\b|\bpassief inkomen\b/i,
           /\bforex\b/i, /\bget rich\b|\brijk worden\b/i] },
  { cat: 'prize',
    strong: [/\b(you('ve| have)|u heeft|je hebt) (won|gewonnen)\b/i, /\bclaim your (prize|reward|gift|winnings)\b/i,
             /\b(selected|geselecteerd) (as|als) (a |the |de )?winn/i, /\bclaim (je|uw) (prijs|beloning|cadeau)\b/i],
    weak: [/\bwinners?\b|\bwinnaar\b/i, /\b(free|gratis) (iphone|ipad|gift ?card|cadeaukaart)\b/i, /\bcongratulations\b|\bgefeliciteerd\b/i] },
  { cat: 'pharma',
    strong: [/\b(viagra|cialis|levitra|sildenafil|tadalafil|kamagra)\b/i, /\b(no|without) (a )?prescription\b|\bzonder recept\b/i,
             /\b(cheap|discount|goedkope?)\b.{0,25}\b(meds|medication|pills|tablets|medicijnen|pillen)\b/i],
    weak: [/\bpharmacy\b/i, /\b(pills|tablets|meds|pillen)\b/i, /\b(erectile|erectie|potency|potentie)\b/i,
           /\b(weight loss|afvallen|ozempic|wegovy)\b/i] },
  { cat: 'adult',
    strong: [/\b(singles|women|vrouwen)\b.{0,25}\b(near you|in your area|bij jou in de buurt)\b/i],
    weak: [/\bsexy\b/i, /\bhookups?\b/i, /\bxxx\b/i] },
  // Advance-fee fraud: the widow, the next of kin, the business proposal. It
  // mostly comes from free mail addresses, which pass the sender check, so
  // the check says nothing here. A company domain needs stronger evidence.
  { cat: 'fraud', strictForCompanies: true,
    strong: [/\b(business|investment|partnership) proposal\b/i, /\bnext of kin\b/i,
             /\b(late|deceased) (husband|wife|father|client|brother)\b/i, /\b(inheritance|beneficiary|compensation) (fund|funds|claim|payment)\b/i,
             /\bterminal (illness|cancer)\b/i, /\bATM (card|visa card)\b/i, /\bdonate\b.{0,50}\b(funds?|money|sum|fortune)\b/i],
    weak: [/\b\d+([.,]\d+)?\s?(million|mln|miljoen)\s?(usd|us dollars|dollars|euros?|eur|gbp|pounds)?\b/i,
           /\b(beneficiary|inheritance|erfenis|nalatenschap|widow|weduwe)\b/i, /\b(barrister|united nations|IMF|world bank)\b/i,
           /\b(strictly )?(confidential|vertrouwelijk)\b/i, /\bdear (beloved|friend)\b|\bbeste vriend\b/i,
           /\b(private|personal) (e-?mail|address|contact)\b/i, /\bkindly\b/i] },
  // Only applied to senders that are not verified: a real service may well
  // write that an account is suspended; a stranger saying so is phishing.
  { cat: 'phishing', unverifiedOnly: true,
    strong: [/\b(account|mailbox|cloud ?storage|storage|postvak|opslag|wachtwoord|password)\b.{0,50}\b(disabled|suspended|blocked|deactivated|locked|full|expired?|uitgeschakeld|geblokkeerd|opgeschort|vol|verlopen)\b/i],
    weak: [/\b(verify|confirm|validate|bevestig|verifieer|valideer)\b/i, /\b(urgent|immediately|within 24 hours|binnen 24 uur|direct)\b/i] }
];

// Consumer mailbox providers. A sender on one of these is a person with an
// account (a friend, or a scammer with a free address), never the company
// that runs the service: it is grouped per address, not offered a letter, and
// the provider itself is never blocked.
const PERSONAL_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com',
  'yahoo.com', 'ymail.com', 'rocketmail.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'tutanota.com', 'tuta.io',
  'gmx.com', 'gmx.net', 'gmx.de', 'web.de', 'mail.com', 'zoho.com', 'yandex.com', 'yandex.ru', 'mail.ru', 'fastmail.com', 'hey.com',
  'ziggo.nl', 'kpnmail.nl', 'kpnplanet.nl', 'planet.nl', 'home.nl', 'xs4all.nl', 'hetnet.nl', 'chello.nl', 'upcmail.nl',
  'quicknet.nl', 'online.nl', 'tele2.nl', 'telfort.nl', 'caiway.nl', 'zeelandnet.nl', 'solcon.nl', 'telenet.be', 'skynet.be'
]);
export const isPersonalDomain = d => PERSONAL_MAIL.has(String(d || '').toLowerCase())
  || /^(hotmail|live|outlook|yahoo|gmx|msn)\.(co\.)?[a-z]{2,3}$/i.test(String(d || ''));

// Sender names and domains that say it outright.
const RISKY_NAME = [
  ['gambling', /casino|slots?\b|spins?\b|jackpot|\bbet(s|ting|\d)?\b|bet\d|gambl|lotto|loterij/i],
  ['pharma', /pharmacy|pharma\b|\bmeds\b|pills|\brx\b|viagra|cialis/i]
];

// A sender name that claims an organisation people trust, sent from a domain
// that is not that organisation's. Passing the sender check does not help: the
// check only vouches for the domain, and the domain is not the one claimed.
const OFFICIAL = [
  [/\bbelastingdienst\b|\btoeslagen\b/i, ['belastingdienst.nl', 'toeslagen.nl']],
  [/\b(rijks)?overheid\b|\binformatievoorziening\b|\bmijnoverheid\b/i, ['overheid.nl', 'rijksoverheid.nl', 'mijnoverheid.nl']],
  [/\bdigid\b/i, ['digid.nl', 'logius.nl']],
  [/\bcjib\b/i, ['cjib.nl']], [/\brdw\b/i, ['rdw.nl']], [/\buwv\b/i, ['uwv.nl']], [/\bsvb\b/i, ['svb.nl']],
  [/\bing\b/i, ['ing.nl', 'ing.com', 'ing.be']], [/\brabobank\b/i, ['rabobank.nl', 'rabobank.com']],
  [/\babn ?amro\b/i, ['abnamro.nl', 'abnamro.com']], [/\bsns( bank)?\b/i, ['snsbank.nl']], [/\basn ?bank\b/i, ['asnbank.nl']],
  [/\bpostnl\b/i, ['postnl.nl', 'postnl.com']], [/\bdhl\b/i, ['dhl.com', 'dhl.nl', 'dhl.de', 'dhlparcel.nl', 'dhlecommerce.nl']],
  [/\bdpd\b/i, ['dpd.nl', 'dpd.com']], [/\bkpn\b/i, ['kpn.com', 'kpn.nl']], [/\bziggo\b/i, ['ziggo.nl', 'vodafoneziggo.nl']],
  [/\bodido\b/i, ['odido.nl']], [/\bpaypal\b/i, ['paypal.com', 'paypal.nl', 'paypal.de']],
  // Parcel carriers: the favourite costume of "your package is waiting" scams.
  // Short all-caps names are matched case-sensitively, so "start-ups" or
  // "bups" in a name never count as UPS.
  [/\busps\b/i, ['usps.com', 'usps.gov']], [/\bUPS\b/, ['ups.com']], [/\bfed ?ex\b/i, ['fedex.com']],
  [/\broyal ?mail\b/i, ['royalmail.com', 'royalmail.co.uk']], [/\bbpost\b/i, ['bpost.be']], [/\bGLS\b/, ['gls-group.eu', 'gls-group.com', 'gls-info.nl']],
  [/\b(evri|hermes)\b/i, ['evri.com', 'hermes-europe.co.uk', 'myhermes.de']], [/\bcorreos\b/i, ['correos.es']],
  [/\bdeutsche post\b/i, ['deutschepost.de', 'dhl.de']], [/\bla poste\b/i, ['laposte.fr', 'laposte.net']],
  [/\bamazon\b/i, ['amazon.com', 'amazon.nl', 'amazon.de', 'amazon.co.uk', 'amazon.fr', 'amazon.es', 'amazon.it', 'amazon.be']],
  [/\b(apple|icloud)\b/i, ['apple.com', 'icloud.com']],
  [/\b(microsoft|office ?365|microsoft ?365)\b/i, ['microsoft.com', 'office.com', 'microsoftonline.com', 'outlook.com', 'live.com']],
  [/\bnetflix\b/i, ['netflix.com']], [/\bspotify\b/i, ['spotify.com']], [/\bdisney\+?/i, ['disney.com', 'disneyplus.com', 'disney.nl']],
  [/\b(google|gmail)\b/i, ['google.com', 'gmail.com', 'youtube.com']],
  [/\b(facebook|instagram|whatsapp)\b/i, ['facebook.com', 'facebookmail.com', 'instagram.com', 'whatsapp.com', 'meta.com']],
  [/\bbooking\.com\b/i, ['booking.com']], [/\bcoinbase\b/i, ['coinbase.com']], [/\bbinance\b/i, ['binance.com']],
  [/\bnorton\b/i, ['norton.com', 'nortonlifelock.com', 'gen.digital']], [/\bmcafee\b/i, ['mcafee.com']],
  [/\bgeek ?squad\b/i, ['geeksquad.com', 'bestbuy.com']], [/\bebay\b/i, ['ebay.com', 'ebay.nl', 'ebay.de', 'ebay.co.uk']],
  [/\bmarktplaats\b/i, ['marktplaats.nl']], [/\bbol(\.com)?\b/i, ['bol.com']], [/\bcoolblue\b/i, ['coolblue.nl', 'coolblue.be']],
  [/\balbert heijn\b/i, ['ah.nl', 'ah.be', 'albertheijn.nl']], [/\bvodafone\b/i, ['vodafone.nl', 'vodafone.com', 'vodafoneziggo.nl']],
  [/\bt-mobile\b/i, ['t-mobile.nl', 't-mobile.com', 'odido.nl']], [/\bmastercard\b/i, ['mastercard.com', 'mastercard.nl']],
  [/\b(american express|amex)\b/i, ['americanexpress.com', 'aexp.com']], [/\bNS\b/, ['ns.nl']], [/\bDUO\b/, ['duo.nl']],
  [/\bCAK\b/, ['hetcak.nl']], [/\bpolitie\b/i, ['politie.nl']], [/\bIRS\b/, ['irs.gov']], [/\bHMRC\b/, ['hmrc.gov.uk', 'gov.uk']],
  [/\bbunq\b/i, ['bunq.com']], [/\bknab\b/i, ['knab.nl']], [/\btriodos\b/i, ['triodos.nl', 'triodos.com']],
  [/\brevolut\b/i, ['revolut.com']], [/\bkbc\b/i, ['kbc.be', 'kbc.com']], [/\bbelfius\b/i, ['belfius.be']]
];
const ownedBy = (domain, allowed) => allowed.some(a => domain === a || domain.endsWith('.' + a));

// Words in a sender name that say nothing about who it is.
const NAME_FILLER = new Set(['team', 'support', 'service', 'services', 'customer', 'customers', 'klantenservice', 'info',
  'news', 'newsletter', 'nieuws', 'nieuwsbrief', 'noreply', 'no', 'reply', 'mail', 'email', 'notification', 'notifications',
  'alert', 'alerts', 'delivery', 'bezorging', 'order', 'orders', 'bestelling', 'account', 'accounts', 'security', 'beveiliging',
  'the', 'de', 'het', 'een', 'van', 'from', 'via', 'and', 'en', 'your', 'je', 'jouw', 'uw', 'my', 'mijn', 'our', 'ons',
  'official', 'online', 'store', 'shop', 'winkel', 'webshop', 'deals', 'aanbiedingen', 'update', 'updates', 'marketing',
  'sales', 'hello', 'hallo', 'hi', 'admin', 'billing', 'invoice', 'factuur', 'payments', 'betalingen', 'member', 'members',
  'club', 'rewards', 'loyalty', 'care', 'help', 'helpdesk', 'contact', 'office', 'bv', 'inc', 'ltd', 'gmbh', 'nv', 'llc',
  'nl', 'be', 'com', 'net', 'org', 'group', 'groep', 'nederland', 'netherlands', 'europe', 'international', 'global']);

// Whether a sender's name has anything to do with the domain it mails from.
// "USPS Delivery" at sdothemed.com does not; "Albert Heijn" at ah.nl does
// (initials), "Koninklijke Nederlandse Munt" at knm.nl does, "Sarah from
// Notion" at mail.notion.so does, and so does a person whose name is in the
// address itself (jan.devries@acme.io). Names made only of filler words
// ("Customer Service") cannot be judged and are let through.
export function nameMatchesDomain(name, address, domain) {
  const norm = x => String(x || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const words = norm(name).split(/[^a-z0-9]+/).filter(Boolean);
  const tokens = words.filter(w => w.length >= 2 && !NAME_FILLER.has(w));
  if (!tokens.length) return true;
  const host = norm(domain);
  const label = host.split('.')[0];
  const flat = host.replace(/[^a-z0-9]/g, '');
  const local = norm(String(address || '').split('@')[0]).replace(/[^a-z0-9]/g, '');
  const initials = words.filter(w => !['de', 'het', 'van', 'the', 'and', 'en'].includes(w)).map(w => w[0]).join('');
  if (tokens.some(t => t.length >= 3 && (flat.includes(t) || local.includes(t)))) return true;
  if (label.length >= 3 && tokens.some(t => t.includes(label))) return true;
  if (tokens.join('').includes(label) || (label.length >= 3 && label.includes(tokens.join('')))) return true;
  if (initials.length >= 2 && (label === initials || label.startsWith(initials))) return true;
  return tokens.every(t => t.length < 3) && tokens.some(t => flat.includes(t));
}

export function impersonates(name, domain) {
  const d = String(domain || '').toLowerCase();
  return OFFICIAL.some(([re, allowed]) => re.test(name || '') && !ownedBy(d, allowed));
}

const plain = html => html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#\d+;|&\w+;/g, ' ');

export function contentRisk({ subject = '', name = '', domain = '', parts = [], verified = false, personal = false }) {
  const text = [subject, ...parts.map(p => p.type === 'html' ? plain(p.text) : p.text)].join('\n').slice(0, 40000);
  for (const [cat, re] of RISKY_NAME) if (re.test(name) || re.test(domain)) return cat;
  if (impersonates(name, domain)) return 'impersonation';
  for (const r of RISK) {
    if (r.unverifiedOnly && verified) continue;
    const score = r.strong.filter(re => re.test(text)).length * 2 + r.weak.filter(re => re.test(text)).length;
    if (score >= (r.strictForCompanies && verified && !personal ? 4 : 2)) return r.cat;
  }
  return '';
}

// 'verified' only when the receiving server confirmed the sender's domain. A
// domain without a TLD cannot be real, whatever else the headers say.
export function senderTrust(domain, auth) {
  if (!/\.[a-z]{2,}$/i.test(domain || '')) return { trust: 'forged', why: 'the sender domain is not a real domain' };
  if (auth.dmarc === 'fail' || auth.compauthFail) return { trust: 'forged', why: 'the sender failed authentication' };
  // Verified means the check vouched for THIS domain. A scammer can pass SPF
  // and DKIM for a domain of their own while putting someone else's in From;
  // a pass only counts when it is about the From domain (DMARC alignment).
  const own = registrableDomain(domain);
  const about = r => r.domain ? registrableDomain(r.domain) === own : r.method === 'dmarc';
  const results = auth.results || [];
  if (results.some(r => r.method === 'dmarc' && r.result === 'pass' && about(r)) || auth.compauthPass)
    return { trust: 'verified', why: 'the domain passed DMARC' };
  if (results.some(r => (r.method === 'dkim' || r.method === 'spf') && r.result === 'pass' && r.domain && about(r)))
    return { trust: 'verified', why: 'the sending server is authorised by the domain' };
  if (['fail', 'softfail'].includes(auth.spf) && !results.some(r => r.result === 'pass'))
    return { trust: 'forged', why: 'the sending server is not authorised by the domain it claims' };
  if (results.some(r => r.result === 'pass'))
    return { trust: 'unknown', why: 'the check passed for a different domain than the one in From' };
  return { trust: 'unknown', why: 'the sender could not be verified' };
}

// --- message splitting -----------------------------------------------------

function splitMbox(text) {
  // mbox messages begin with a "From " line at the start of a line.
  const parts = text.split(/^From .*$/m).filter(p => p.trim());
  return parts.length ? parts : [text];
}

// `single`: the text is known to be one message (the large-file reader has
// already split the mailbox), so a body line starting "From " is not a split.
export function parseMessages(text, { single = false, folder = '' } = {}) {
  const looksLikeMbox = !single && /^From .+\d{4}$/m.test(text.slice(0, 4000));
  const chunks = looksLikeMbox ? splitMbox(text) : [text];

  return chunks.map(chunk => {
    // Headers end at the first blank line.
    const split = chunk.search(/\r?\n\r?\n/);
    const headerBlock = split === -1 ? chunk : chunk.slice(0, split);
    const h = parseHeaders(headerBlock);
    if (!h.from) return null;

    const from = parseFrom(h.from);
    if (!from.domain) return null;

    const body = split === -1 ? '' : chunk.slice(split).replace(/^\r?\n\r?\n/, '');
    const parts = extractParts(h, body);
    const headerUnsub = parseUnsubscribe(h['list-unsubscribe']);
    const auth = parseAuth(h);
    const bodyUnsub = headerUnsub.http ? { url: '', how: '' } : findUnsubInBody(parts);
    const lines = textLines(parts);

    // Which of the user's own addresses this was sent to. This is the ONLY
    // identifier the sender demonstrably holds, and the letter must not go
    // beyond it.
    const recipients = [];
    for (const key of ['to', 'delivered-to', 'x-original-to', 'envelope-to']) {
      for (const m of String(h[key] || '').matchAll(/[\w.+-]+@[\w.-]+\.\w+/g)) {
        if (!recipients.includes(m[0].toLowerCase())) recipients.push(m[0].toLowerCase());
      }
    }

    return {
      // A "could not be delivered" notice: not a sender, but news about an
      // address the user wrote to.
      bounce: isBounce(h, from) ? bouncedTo(h, body + '\n' + parts.map(p => p.text).join('\n')) : null,
      address: from.address,
      name: from.name,
      domain: from.domain,
      subject: decodeWords(h.subject || ''),
      date: h.date || '',
      at: dayOf(h.date),
      seen: engagementOf(h, folder),
      // Possibly an answer to one of the user's letters.
      reply: replyInfo(decodeWords(h.subject || ''), lines),
      recipients,
      unsub: { http: headerUnsub.http || bodyUnsub.url, mailto: headerUnsub.mailto },
      unsubFrom: headerUnsub.http ? 'header' : bodyUnsub.how,
      // RFC 8058: the sender promises a POST alone completes the unsubscribe.
      oneClick: /one-click/i.test(h['list-unsubscribe-post'] || ''),
      ...senderTrust(from.domain, auth),
      providerSpam: auth.providerSpam,
      risk: contentRisk({ subject: decodeWords(h.subject || ''), name: from.name, domain: from.domain, parts,
                          verified: senderTrust(from.domain, auth).trust === 'verified', personal: isPersonalDomain(from.domain) }),
      replyToHost: replyTarget(parseFrom(h['reply-to'] || '')),
      identity: identityFrom({ to: h.to, parts, recipients, brand: `${from.name} ${from.domain}` }),
      privacy: privacyContact(parts, from.domain),
      contacts: serviceAddresses(parts, from.address, parseFrom(h['reply-to'] || '').address, from.domain),
      companyPostal: companyPostal(lines, from.name, from.domain),
      linkDomains: collectLinkDomains(parts),
      isEsp: ESP_DOMAINS.has(from.domain),
      personal: isPersonalDomain(from.domain)
    };
  }).filter(Boolean);
}

// --- what the user does with a sender's mail --------------------------------
//
// In a whole mailbox, the mail someone wants shows in what they do with it:
// they open it, star or flag it, reply, or file it in a folder of their own.
// Read from what the export carries: Gmail's labels (Google Takeout), the
// Status and X-Mozilla-Status flags of mbox files (Thunderbird and others),
// and Apple Mail's flags (added by the file reader as X-Emlx-Flags).

// Gmail's own labels, in English and Dutch; anything else is the user's.
const GMAIL_SYSTEM = new Set(['inbox', 'postvak in', 'spam', 'trash', 'prullenbak', 'sent', 'verzonden', 'drafts', 'concepten',
  'chat', 'chats', 'important', 'belangrijk', 'starred', 'met ster', 'opened', 'geopend', 'unread', 'ongelezen', 'archived',
  'gearchiveerd', 'all mail', 'alle e-mail', 'muted', 'genegeerd', 'scheduled', 'gepland', 'snoozed', 'gesnoozed']);
// Folders every mail app has; a folder with any other name is the user's.
const SYSTEM_FOLDER = /^(all mail.*|alle e-?mail.*|inbox|postvak in|junk|junk e-?mail|ongewenst|ongewenste e-?mail|spam|bulk|trash|deleted|deleted items|deleted messages|verwijderd|verwijderde items|prullenbak|sent|sent items|sent messages|verzonden|verzonden items|drafts|concepten|outbox|postvak uit|archive|archief|all mail|alle e-mail|mbox|mail|messages|notes|recovered messages)$/i;
const JUNK_FOLDER = /^(junk|junk e-?mail|ongewenst|ongewenste e-?mail|spam|bulk)$/i;
const SENT_FOLDER = /^(sent|sent items|sent messages|verzonden|verzonden items)$/i;

export function engagementOf(h, folder = '') {
  const labels = String(h['x-gmail-labels'] || '').split(',').map(x => x.replace(/^"|"$/g, '').trim()).filter(Boolean);
  const has = (...names) => labels.some(l => names.includes(l.toLowerCase()));
  const own = labels.filter(l => !GMAIL_SYSTEM.has(l.toLowerCase()) && !/^(category|categorie) /i.test(l) && !/^imap_/i.test(l));
  let read = has('opened', 'geopend') ? true : has('unread', 'ongelezen') ? false : null;
  let answered = false, flagged = has('starred', 'met ster');
  // mbox: "Status: RO" (read, old), "X-Status: A" (answered), "F" (flagged).
  if (h.status !== undefined) read = /R/.test(h.status);
  if (/A/.test(h['x-status'] || '')) answered = true;
  if (/F/.test(h['x-status'] || '')) flagged = true;
  // Thunderbird: hexadecimal flags, 0x1 read, 0x2 replied, 0x4 flagged.
  const moz = parseInt(String(h['x-mozilla-status'] || '').trim(), 16);
  if (Number.isFinite(moz)) { read = !!(moz & 1); answered ||= !!(moz & 2); flagged ||= !!(moz & 4); }
  // Apple Mail: bit 0 read, bit 2 answered, bit 4 flagged.
  const emlx = parseInt(String(h['x-emlx-flags'] || '').trim(), 10);
  if (Number.isFinite(emlx)) { read = !!(emlx & 1); answered ||= !!(emlx & 4); flagged ||= !!(emlx & 16); }
  // A Takeout export is one file for everything; its labels say where a
  // message lives, the file name does not.
  const box = h['x-gmail-labels'] !== undefined ? '' : String(folder || '').trim();
  return {
    read, answered, flagged,
    important: has('important', 'belangrijk'),
    // Filed by the user: a label or folder of their own.
    filed: own[0] || (box && !SYSTEM_FOLDER.test(box) ? box : ''),
    junk: has('spam') || JUNK_FOLDER.test(box),
    sent: has('sent', 'verzonden') || SENT_FOLDER.test(box)
  };
}

// --- answers to the user's letters -------------------------------------------
//
// A company's answer to an erasure request quotes the letter's reference
// (HU-XXXXX), or comes back on its subject. What it says is read from the
// answer itself, above the quoted letter: the letter itself mentions identity
// documents and legal retention, and must never be mistaken for the answer.

const LETTER_REF = /\bHU-[A-Z0-9]{5}\b/g;
const OUR_SUBJECT = /artikel 15, 17 en 21 AVG|Articles 15, 17 and 21 GDPR|CCPA\/CPRA request|termijn verstreken|overdue: request/i;
const ABOUT_SUBJECT = /\b(avg|gdpr|privacy\w*|persoonsgegevens|personal data|verwijder\w*|gegevens wissen|erasure|deletion|data (subject |access |deletion )?request|inzage\w*|art(ikel|icle|\.)\s?1[57])\b/i;
const ABOUT_BODY = /\b(privacyverzoek|verwijderverzoek|verwijderingsverzoek|inzageverzoek|avg-verzoek|verzoek (op grond van|tot|om)\b.{0,40}\b(avg|verwijder\w*|wissen|inzage|persoonsgegevens)|(your|the) (privacy|data|deletion|erasure|access|gdpr|data subject) request|request (to|for) (delete|erase|erasure|deletion|access)|right to (erasure|be forgotten))\b/i;
// Where the quoted letter, or an earlier message, starts.
const QUOTE_START = /^(>|-{2,}\s*(original message|oorspronkelijk bericht|forwarded message|doorgestuurd bericht)|_{5,}|(from|van|sent|verzonden):\s|(op|on)\s.{4,120}\s(schreef|wrote)\b|.{0,80}\b(schreef|wrote):\s*$|aan de functionaris gegevensbescherming|to the (data protection officer|privacy team)|mijn kenmerk:|my reference for this request:|##-)/i;

// What the answer says, in the order that matters: a demand for an ID copy or
// a web form is a demand even when the answer also mentions deletion.
const RETAIN = /\b(wettelijke|fiscale|administratieve)\s+(bewaar(plicht|termijn)\w*|verplichting\w*)|\bbewaarplicht\w*|\bwettelijk\b.{0,40}\b(verplicht|vereist)\b.{0,40}\bbewaren\b|\blegal(ly)?\b.{0,20}\b(obligation|required|requirement|bound)\b.{0,40}\b(keep|retain|store)\b|\brequired by law to (keep|retain|store)\b|\b(tax|accounting|fiscal) (law|laws|obligations?|rules|records)\b|\bretention (period|obligation)s?\b/i;
const PAST = String.raw`(?:(?!\b(?:zullen|zal|worden|wordt|will|would|shall)\b)[^.\n]){0,50}`;
const NOT_DONE = /\bnog niet\b|\bniet\b.{0,20}\b(verwijderd|gewist)\b|\bnot (yet )?(been )?(deleted|erased|removed)\b|\bbefore (we|it) (can|could) (be )?(delete|erase)/i;
const SAYS = [
  ['id', /\b(kopie|scan|foto)\b.{0,40}\b(identiteitsbewijs|legitimatiebewijs|paspoort|id-?kaart|identiteitskaart|rijbewijs)\b|\b(identiteitsbewijs|legitimatiebewijs)\b|\b(copy|scan|photo)\b.{0,40}\b(passport|id card|identity (card|document)|driv(er'?s|ing) licen[cs]e|photo id|government[- ]issued id)\b|\bproof of (identity|id)\b|\bverify your identity\b|\b(uw|je|jouw) identiteit\b.{0,40}\b(vaststellen|verifi[eë]ren|controleren|bevestigen)\b/i],
  // Done, in the past tense and within one sentence: "zijn verwijderd", not
  // "zullen worden verwijderd".
  ['done', new RegExp(String.raw`\b(zijn|is|werden|werd|hebben|heeft)\b${PAST}\b(verwijderd|gewist|geanonimiseerd|vernietigd)\b|\b(have|has) (now )?been (permanently )?(deleted|erased|removed|anonymi[sz]ed)\b|\bwe (have )?(now )?(deleted|erased|anonymi[sz]ed)\b`, 'i')],
  ['nodata', /\bgeen\b.{0,30}\b(persoons)?gegevens\b.{0,40}\b(gevonden|aangetroffen|bekend)\b|\b(niet|geen)\b.{0,20}\b(bekend|klant)\b.{0,20}\b(bij ons|in onze|in ons)\b|\bkunnen\b.{0,20}\b(u|je)\b.{0,30}\bniet\b.{0,20}\b(vinden|terugvinden)\b|\bno (personal )?(data|information|records?|account)\b.{0,40}\b(found|associated|linked|on file|about you|for you|matching)\b|\b(could|can) ?not (find|locate)\b.{0,40}\b(data|records?|account|you)\b|\bdo(es)? not (hold|have|process) any (personal )?(data|information)\b/i],
  ['refused', /\b(niet|geen gevolg)\b.{0,30}\b(voldoen|honoreren|uitvoeren|in behandeling nemen)\b|\b(wijzen|weigeren)\b.{0,40}\b(af|verzoek)\b|\bafgewezen\b|\b(cannot|can ?not|unable to|will not|won'?t)\b.{0,20}\b(comply|fulfil+|honou?r|process|action)\b.{0,20}\b(your|this|the)\b.{0,20}\brequest\b|\b(declin|refus|reject)(e|ed|ing)\b.{0,20}\b(your|this|the) request\b/i],
  ['form', /\b(verzoek|aanvraag|request)\b.{0,80}(formulier|portaal|\bweb ?form|\bonline form|\bportal)\b|(formulier|portaal|\bweb ?form|\bonline form|\bportal)\b.{0,80}\b(verzoek|aanvraag|request)\b/i],
  ['retain', RETAIN],
  ['extend', /\b(verlengen|verlengd|verlenging)\b.{0,80}\b(termijn|maanden)\b|\btermijn\b.{0,40}\b(verlengen|verlengd)\b|\btwee (extra |aanvullende )?maanden\b|\bextend(ed|ing)?\b.{0,60}\b(period|deadline|time|months)\b|\b(two|2) (further|more|additional|extra) months\b/i],
  ['ack', /\b(ontvangen|ontvangst|in behandeling|wordt behandeld|received (your|the)|receipt of (your|the)|we have received|is being (processed|handled|reviewed)|we will (respond|reply|get back|process|handle)|binnen (30|dertig) dagen|within (30|thirty) days|binnen (één|een) maand|within one month)\b/i]
];

export function answerKind(text) {
  const t = String(text || '');
  for (const [kind, re] of SAYS) {
    if (!re.test(t)) continue;
    if (kind === 'done' && NOT_DONE.test(t)) continue;
    // Erased, except what the law makes them keep.
    if (kind === 'done' && RETAIN.test(t)) return 'partial';
    return kind;
  }
  return 'other';
}

export function replyInfo(subject, lines) {
  const refs = [...new Set((subject + '\n' + lines.join('\n')).match(LETTER_REF) || [])].slice(0, 5);
  const cut = lines.findIndex(l => QUOTE_START.test(l));
  const top = (cut < 0 ? lines : lines.slice(0, cut)).join('\n').slice(0, 6000);
  const subjectHit = OUR_SUBJECT.test(subject) || ABOUT_SUBJECT.test(subject);
  const kind = answerKind(top);
  // About the request: it says so, or it says what only an answer to one
  // says ("your data has been deleted", "send a copy of your passport"). A
  // bank's "verify your identity in the app" is not one.
  const bodyHit = ABOUT_BODY.test(top) || ['done', 'partial', 'nodata'].includes(kind)
    || (kind === 'id' && /identiteitsbewijs|legitimatiebewijs|paspoort|passport|identity document|id[- ]?(card|kaart)/i.test(top))
    || (/\b(uw|je|jouw|your) (verzoek|request)\b/i.test(top) && /\b(persoonsgegevens|gegevens|personal data|privacy)\b/i.test(top));
  if (!refs.length && !subjectHit && !bodyHit) return null;
  return { refs, subjectHit, bodyHit, kind };
}

// The day a message was sent, from its Date header. Dates in the future or
// before 1995 are spam lying about it, and count as unknown.
export function dayOf(raw) {
  const t = Date.parse(String(raw || '').replace(/\s*\([^)]*\)\s*$/, ''));
  if (!Number.isFinite(t) || t > Date.now() + 2 * 864e5 || t < Date.UTC(1995, 0, 1)) return '';
  return new Date(t).toISOString().slice(0, 10);
}

// --- grouping --------------------------------------------------------------

export function groupBySender(messages) {
  const map = new Map();
  for (const m of messages) {
    if (m.bounce) continue;
    // Forged mail is grouped apart from genuine mail on the same domain. A
    // spoofed "bol.com" must never drag the real bol.com into the spam pile:
    // the domain in a forged From line belongs to whoever is being impersonated.
    // A free mail address is a person, so it is grouped per address: one
    // "gmail.com" sender would lump a friend in with every scammer on Gmail.
    const base = m.personal && m.address ? m.address.toLowerCase() : m.domain;
    const key = m.trust === 'forged' ? base + '#forged' : base;
    if (!map.has(key)) {
      map.set(key, {
        key, domain: m.domain, personal: !!m.personal, name: m.name || m.domain, count: 0,
        unsubHttp: '', unsubMailto: '', unsubFrom: '', oneClick: false, lastBulkAt: '',
        eng: { known: 0, read: 0, starred: 0, replied: 0, important: 0, filed: 0, folder: '' },
        addresses: new Set(), recipients: new Set(), subjects: [], isEsp: m.isEsp,
        linkDomains: new Set(), replyToHosts: new Set(), risk: '', providerSpamCount: 0, names: new Set(),
        transactional: false, privacyEmail: '', privacyUrl: '', serviceEmails: new Set(), companyPostal: '', idNames: new Set(), idPostal: new Set(), idPhones: new Set(), idEmails: new Set(), phoneSeen: new Set()
      });
    }
    const g = map.get(key);
    g.count++;
    g.addresses.add(m.address);
    if (g.subjects.length < 3 && m.subject) g.subjects.push(m.subject);
    if (!g.unsubHttp && m.unsub.http) { g.unsubHttp = m.unsub.http; g.unsubFrom = m.unsubFrom; }
    if (!g.unsubMailto && m.unsub.mailto) g.unsubMailto = m.unsub.mailto;
    if (m.oneClick) g.oneClick = true;
    // What the user did with this sender's mail.
    const e = m.seen || {};
    if (e.read !== null && e.read !== undefined) { g.eng.known++; if (e.read) g.eng.read++; }
    if (e.flagged) g.eng.starred++;
    if (e.answered) g.eng.replied++;
    if (e.important) g.eng.important++;
    if (e.filed) { g.eng.filed++; g.eng.folder ||= e.filed.slice(0, 40); }
    // The last marketing mail: what shows whether they stopped after an
    // unsubscribe or a request.
    if (m.at && (m.unsub.http || m.unsub.mailto) && (!g.lastBulkAt || m.at > g.lastBulkAt)) g.lastBulkAt = m.at;
    // A checked message with no way to unsubscribe is an order, an invoice or
    // an account notice: mail that only goes to customers. One is enough to
    // know the user deals with this company, even if it also sends marketing.
    if (m.trust === 'verified' && !m.unsub.http && !m.unsub.mailto) g.transactional = true;
    const rank = { forged: 0, unknown: 1, verified: 2 };
    if (!g.trust || rank[m.trust] < rank[g.trust]) { g.trust = m.trust; g.trustWhy = m.why; }
    if (m.risk && !g.risk) g.risk = m.risk;
    if (m.name) g.names.add(m.name);
    if (m.providerSpam) g.providerSpamCount++;
    for (const r of m.recipients) g.recipients.add(r);
    for (const d of m.linkDomains || []) g.linkDomains.add(d);
    if (m.replyToHost) g.replyToHosts.add(m.replyToHost);
    if (!g.privacyEmail && m.privacy?.email) g.privacyEmail = m.privacy.email;
    if (!g.privacyUrl && m.privacy?.url) g.privacyUrl = m.privacy.url;
    for (const a of m.contacts || []) g.serviceEmails.add(a);
    if (!g.companyPostal && m.companyPostal) g.companyPostal = m.companyPostal;
    const id = m.identity || {};
    for (const [k, set] of [['names', g.idNames], ['postal', g.idPostal], ['phones', g.idPhones], ['emails', g.idEmails], ['phoneSeen', g.phoneSeen]])
      for (const v of id[k] || []) set.add(v);
    // Prefer a human-looking display name over the bare domain.
    if ((g.name === g.domain || !g.name) && m.name) g.name = m.name;
  }
  return [...map.values()]
    .map(g => ({ ...g, providerSpam: g.providerSpamCount * 2 >= g.count && g.providerSpamCount > 0,
                 names: [...g.names], addresses: [...g.addresses], recipients: [...g.recipients],
                 linkDomains: [...g.linkDomains], replyToHosts: [...g.replyToHosts], serviceEmails: [...g.serviceEmails].slice(0, 3),
                 nameMismatch: !g.personal && !nameMatchesDomain(g.name, [...g.addresses][0], g.domain),
                 identity: { names: [...g.idNames].slice(0, 3), postal: [...g.idPostal].slice(0, 2), phones: [...g.idPhones].slice(0, 3),
                             emails: [...g.idEmails].slice(0, 5), phoneSeen: [...g.phoneSeen].slice(0, 20) } }))
    .sort((a, b) => b.count - a.count);
}
