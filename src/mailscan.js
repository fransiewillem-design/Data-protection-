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
    const url = m[1].trim();
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

// Unsubscribe wording across the languages this is likely to meet.
const UNSUB_WORDS =
  /unsubscrib|uitschrijv|afmeld|uitschrijf|opt[\s-]?out|abmeld|austragen|d[eé]sabonn|desinscri|cancelar.{0,12}suscri|annulla.{0,12}iscrizione|stop.{0,10}(mail|email)|e-?mailvoorkeur|mailvoorkeur|email.{0,10}preference|subscription.{0,10}preference/i;

function stripTags(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
}

// Returns the best unsubscribe URL in the body, or ''.
export function findUnsubInBody(parts) {
  const candidates = [];

  for (const part of parts) {
    if (part.type === 'html') {
      const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = re.exec(part.text))) {
        const href = m[1].replace(/&amp;/g, '&').trim();
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
      isEsp: ESP_DOMAINS.has(from.domain)
    };
  }).filter(Boolean);
}

// --- grouping --------------------------------------------------------------

export function groupBySender(messages) {
  const map = new Map();
  for (const m of messages) {
    const key = m.domain;
    if (!map.has(key)) {
      map.set(key, {
        domain: key, name: m.name || key, count: 0,
        unsubHttp: '', unsubMailto: '', unsubFrom: '', oneClick: false,
        addresses: new Set(), recipients: new Set(), subjects: [], isEsp: m.isEsp
      });
    }
    const g = map.get(key);
    g.count++;
    g.addresses.add(m.address);
    if (g.subjects.length < 3 && m.subject) g.subjects.push(m.subject);
    if (!g.unsubHttp && m.unsub.http) { g.unsubHttp = m.unsub.http; g.unsubFrom = m.unsubFrom; }
    if (!g.unsubMailto && m.unsub.mailto) g.unsubMailto = m.unsub.mailto;
    if (m.oneClick) g.oneClick = true;
    for (const r of m.recipients) g.recipients.add(r);
    // Prefer a human-looking display name over the bare domain.
    if ((g.name === key || !g.name) && m.name) g.name = m.name;
  }
  return [...map.values()]
    .map(g => ({ ...g, addresses: [...g.addresses], recipients: [...g.recipients] }))
    .sort((a, b) => b.count - a.count);
}
