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

    return {
      address: from.address,
      name: from.name,
      domain: from.domain,
      subject: decodeWords(h.subject || ''),
      date: h.date || '',
      unsub: parseUnsubscribe(h['list-unsubscribe']),
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
        unsubHttp: '', unsubMailto: '', addresses: new Set(), subjects: [], isEsp: m.isEsp
      });
    }
    const g = map.get(key);
    g.count++;
    g.addresses.add(m.address);
    if (g.subjects.length < 3 && m.subject) g.subjects.push(m.subject);
    if (!g.unsubHttp && m.unsub.http) g.unsubHttp = m.unsub.http;
    if (!g.unsubMailto && m.unsub.mailto) g.unsubMailto = m.unsub.mailto;
    // Prefer a human-looking display name over the bare domain.
    if ((g.name === key || !g.name) && m.name) g.name = m.name;
  }
  return [...map.values()]
    .map(g => ({ ...g, addresses: [...g.addresses] }))
    .sort((a, b) => b.count - a.count);
}
