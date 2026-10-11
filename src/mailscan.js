// Parses exported mail (.eml / .mbox) in the browser and works out who has been
// mailing you. Nothing is uploaded: the File is read with FileReader and every
// line below runs on the user's own machine.

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
    if (/^[ \t]/.test(line) && current) {
      headers[current] += ' ' + line.trim();
    } else {
      const m = line.match(/^([A-Za-z0-9-]+):\s*(.*)$/);
      if (!m) continue;
      current = m[1].toLowerCase();
      // Keep the first occurrence; later duplicates are usually trace headers.
      if (!(current in headers)) headers[current] = m[2];
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

  address = address.replace(/^["']|["']$/g, '').trim();
  name = name.replace(/^["']|["']$/g, '').trim();
  const host = address.split('@')[1] || '';
  return { address, name, domain: registrableDomain(host) };
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

export function parseAuth(h) {
  const ar = (h['authentication-results'] || '') + ' ' + (h['received-spf'] || '');
  const pick = k => (new RegExp(k + '\\s*=\\s*([a-z]+)', 'i').exec(ar) || [])[1]?.toLowerCase() || '';
  let spf = pick('spf');
  if (!spf) { const r = /^\s*(pass|fail|softfail|neutral|none)/i.exec(h['received-spf'] || ''); spf = r ? r[1].toLowerCase() : ''; }
  const scl = parseInt((h['x-ms-exchange-organization-scl'] || '').trim(), 10);
  const forefront = (h['x-forefront-antispam-report'] || '') + ';' + (h['x-forefront-antispam-report-untrusted'] || '');
  return {
    spf, dkim: pick('dkim'), dmarc: pick('dmarc'),
    scl: Number.isFinite(scl) ? scl : null,
    compauthFail: /compauth=fail/i.test(ar),
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
// — a shop's "bonus" offer, a bank mentioning "investment" — never trips it.

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
  // Only applied to senders that are not verified: a real service may well
  // write that an account is suspended; a stranger saying so is phishing.
  { cat: 'phishing', unverifiedOnly: true,
    strong: [/\b(account|mailbox|cloud ?storage|storage|postvak|opslag|wachtwoord|password)\b.{0,50}\b(disabled|suspended|blocked|deactivated|locked|full|expired?|uitgeschakeld|geblokkeerd|opgeschort|vol|verlopen)\b/i],
    weak: [/\b(verify|confirm|validate|bevestig|verifieer|valideer)\b/i, /\b(urgent|immediately|within 24 hours|binnen 24 uur|direct)\b/i] }
];

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
  [/\bodido\b/i, ['odido.nl']], [/\bpaypal\b/i, ['paypal.com', 'paypal.nl', 'paypal.de']]
];
const ownedBy = (domain, allowed) => allowed.some(a => domain === a || domain.endsWith('.' + a));

export function impersonates(name, domain) {
  const d = String(domain || '').toLowerCase();
  return OFFICIAL.some(([re, allowed]) => re.test(name || '') && !ownedBy(d, allowed));
}

const plain = html => html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#\d+;|&\w+;/g, ' ');

export function contentRisk({ subject = '', name = '', domain = '', parts = [], verified = false }) {
  const text = [subject, ...parts.map(p => p.type === 'html' ? plain(p.text) : p.text)].join('\n').slice(0, 40000);
  for (const [cat, re] of RISKY_NAME) if (re.test(name) || re.test(domain)) return cat;
  if (impersonates(name, domain)) return 'impersonation';
  for (const r of RISK) {
    if (r.unverifiedOnly && verified) continue;
    const score = r.strong.filter(re => re.test(text)).length * 2 + r.weak.filter(re => re.test(text)).length;
    if (score >= 2) return r.cat;
  }
  return '';
}

// 'verified' only when the receiving server confirmed the sender's domain. A
// domain without a TLD cannot be real, whatever else the headers say.
export function senderTrust(domain, auth) {
  if (!/\.[a-z]{2,}$/i.test(domain || '')) return { trust: 'forged', why: 'the sender domain is not a real domain' };
  if (auth.dmarc === 'fail' || auth.compauthFail) return { trust: 'forged', why: 'the sender failed authentication' };
  if (auth.spf === 'pass' || auth.dkim === 'pass') return { trust: 'verified', why: 'the sending server is authorised by the domain' };
  if (['fail', 'softfail'].includes(auth.spf)) return { trust: 'forged', why: 'the sending server is not authorised by the domain it claims' };
  return { trust: 'unknown', why: 'the sender could not be verified' };
}

// --- message splitting -----------------------------------------------------

function splitMbox(text) {
  // mbox messages begin with a "From " line at the start of a line.
  const parts = text.split(/^From .*$/m).filter(p => p.trim());
  return parts.length ? parts : [text];
}

export function parseMessages(text) {
  const looksLikeMbox = /^From .+\d{4}$/m.test(text.slice(0, 4000));
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
      address: from.address,
      name: from.name,
      domain: from.domain,
      subject: decodeWords(h.subject || ''),
      date: h.date || '',
      recipients,
      unsub: { http: headerUnsub.http || bodyUnsub.url, mailto: headerUnsub.mailto },
      unsubFrom: headerUnsub.http ? 'header' : bodyUnsub.how,
      // RFC 8058: the sender promises a POST alone completes the unsubscribe.
      oneClick: /one-click/i.test(h['list-unsubscribe-post'] || ''),
      ...senderTrust(from.domain, auth),
      providerSpam: auth.providerSpam,
      risk: contentRisk({ subject: decodeWords(h.subject || ''), name: from.name, domain: from.domain, parts,
                          verified: senderTrust(from.domain, auth).trust === 'verified' }),
      replyToHost: (parseFrom(h['reply-to'] || '').address.split('@')[1] || '').toLowerCase(),
      linkDomains: collectLinkDomains(parts),
      isEsp: ESP_DOMAINS.has(from.domain)
    };
  }).filter(Boolean);
}

// --- grouping --------------------------------------------------------------

export function groupBySender(messages) {
  const map = new Map();
  for (const m of messages) {
    // Forged mail is grouped apart from genuine mail on the same domain. A
    // spoofed "bol.com" must never drag the real bol.com into the spam pile —
    // the domain in a forged From line belongs to whoever is being impersonated.
    const key = m.trust === 'forged' ? m.domain + '#forged' : m.domain;
    if (!map.has(key)) {
      map.set(key, {
        key, domain: m.domain, name: m.name || m.domain, count: 0,
        unsubHttp: '', unsubMailto: '', unsubFrom: '', oneClick: false,
        addresses: new Set(), recipients: new Set(), subjects: [], isEsp: m.isEsp,
        linkDomains: new Set(), replyToHosts: new Set(), risk: '', providerSpamCount: 0, names: new Set()
      });
    }
    const g = map.get(key);
    g.count++;
    g.addresses.add(m.address);
    if (g.subjects.length < 3 && m.subject) g.subjects.push(m.subject);
    if (!g.unsubHttp && m.unsub.http) { g.unsubHttp = m.unsub.http; g.unsubFrom = m.unsubFrom; }
    if (!g.unsubMailto && m.unsub.mailto) g.unsubMailto = m.unsub.mailto;
    if (m.oneClick) g.oneClick = true;
    const rank = { forged: 0, unknown: 1, verified: 2 };
    if (!g.trust || rank[m.trust] < rank[g.trust]) { g.trust = m.trust; g.trustWhy = m.why; }
    if (m.risk && !g.risk) g.risk = m.risk;
    if (m.name) g.names.add(m.name);
    if (m.providerSpam) g.providerSpamCount++;
    for (const r of m.recipients) g.recipients.add(r);
    for (const d of m.linkDomains || []) g.linkDomains.add(d);
    if (m.replyToHost) g.replyToHosts.add(m.replyToHost);
    // Prefer a human-looking display name over the bare domain.
    if ((g.name === g.domain || !g.name) && m.name) g.name = m.name;
  }
  return [...map.values()]
    .map(g => ({ ...g, providerSpam: g.providerSpamCount * 2 >= g.count && g.providerSpamCount > 0,
                 names: [...g.names], addresses: [...g.addresses], recipients: [...g.recipients],
                 linkDomains: [...g.linkDomains], replyToHosts: [...g.replyToHosts] }))
    .sort((a, b) => b.count - a.count);
}
