// What a company's own mail shows it knows about the user: the name it
// addresses them by, a postal address, phone numbers and email addresses.
// The erasure letter identifies the user with exactly this and nothing more:
// telling a company something it did not already have would defeat the point.
//
// Everything here errs towards leaving things out. A company's own address in
// a footer, its helpline number or a generic "Dear customer" must never end up
// in a letter as if it were the user's, so only clearly labelled details count.

const GREETING = /^\s*(dear|hi|hello|hey|beste|hoi|hallo|geachte|lieve|dag|goedemorgen|goedemiddag|goedenavond)\s+(.{2,60}?)\s*[,!:]?\s*$/i;
const TITLE = /^(de|heer|mevrouw|mevr\.?|dhr\.?|meneer|mr\.?|mrs\.?|ms\.?|miss|mx\.?|dr\.?)$/i;
const PARTICLE = /^(van|de|der|den|ter|ten|te|het|von|du|da|di|le|la|del|dos|el|y|'t)$/i;
const GENERIC = new Set(['klant', 'klanten', 'customer', 'customers', 'lezer', 'reader', 'friend', 'friends', 'vriend', 'vriendin',
  'beloved', 'there', 'member', 'members', 'lid', 'leden', 'sir', 'madam', 'user', 'gebruiker', 'shopper', 'subscriber',
  'abonnee', 'all', 'allemaal', 'iedereen', 'everyone', 'team', 'collega', 'relatie', 'valued', 'deelnemer', 'participant',
  'winner', 'winnaar', 'fan', 'fans', 'liefhebber', 'bezoeker', 'visitor', 'gast', 'guest', 'partner', 'client', 'cliënt',
  'student', 'ouder', 'parent', 'bewoner', 'resident', 'consument', 'consumer', 'houder', 'burger', 'beste', 'dear',
  'hello', 'hallo', 'hi', 'hoi', 'heer', 'mevrouw', 'meneer', 'mr', 'mrs', 'ms', 'sir/madam', 'heer/mevrouw', 'reiziger',
  'traveller', 'traveler', 'speler', 'player', 'spaarder', 'belegger', 'investor', 'patient', 'patiënt', 'donateur', 'supporter']);

const ADDRESS_LABEL = /^\s*(bezorgadres|afleveradres|factuuradres|verzendadres|leveradres|postadres|woonadres|jouw adres|je adres|uw adres|adresgegevens|bezorgd op|wordt bezorgd op|delivery address|shipping address|billing address|home address|your address|ship to|deliver to|delivered to)\b\s*:?\s*(.*)$/i;
const PHONE = /(?:\+|00)\d{1,3}[\s.-]?(?:\(0\)[\s.-]?)?\d(?:[\s.-]?\d){7,10}|\b0\d(?:[\s.-]?\d){8}\b/g;
const OWN_PHONE = /\b(?:je|jouw|uw|your)\s+(?:mobiele\s+)?(?:telefoonnummer|mobiele nummer|mobiel nummer|mobielnummer|nummer|phone number|phone|mobile number|mobile)\s*(?:is|:)?\s*/i;
const SENT_TO = /\b(?:sent to|verzonden naar|verstuurd naar|gestuurd naar|addressed to|bestemd voor|this (?:e-?mail|message) was sent to|deze (?:e-?mail|mail|nieuwsbrief|e-mail) (?:is|werd) (?:verzonden|verstuurd|gestuurd) (?:naar|aan))\s*:?\s*([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/gi;
const DETAIL = /^(tel|telefoon|telefoonnummer|phone|mobiel|mobile|gsm|e-?mail|land|country|nederland|netherlands|belgi[eë]|belgium|deutschland|germany)\b/i;
const NL_POSTCODE = /\b[1-9]\d{3}\s?(?!SA|SD|SS)[A-Z]{2}\b/;
const STREET = /^[\p{L}][\p{L} .'’-]{1,40}\s\d{1,5}(?:\s?[a-zA-Z]{1,2})?(?:\s?[-/]\s?\d{1,4}[a-zA-Z]?)?$/u;

// HTML to text that keeps line structure, which address blocks depend on.
export function textLines(parts) {
  const text = parts.map(p => p.type !== 'html' ? p.text : p.text
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table|address)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;|&rsquo;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n) || 32)).replace(/&\w+;/g, ' ')
  ).join('\n').slice(0, 60000);
  return text.split(/\r?\n/).map(l => l.replace(/[\t ]+/g, ' ').trim()).filter(Boolean);
}

// A name as companies write one: capitalised words, perhaps a title or
// particles ("de heer Van der Berg"), no digits, nothing generic.
function asName(raw, brand) {
  const s = String(raw || '').replace(/["“”]/g, '').replace(/\s+/g, ' ').trim();
  if (!s || s.length > 60 || /[\d@<>/\\|{}[\]=_#]/.test(s)) return '';
  const words = s.split(' ');
  if (words.length > 6) return '';
  const core = words.filter(w => !TITLE.test(w) && !PARTICLE.test(w));
  if (!core.length || core.some(w => !/^\p{Lu}[\p{L}'’.-]*$/u.test(w))) return '';
  if (core.some(w => GENERIC.has(w.toLowerCase().replace(/[.,]$/, '')))) return '';
  const b = String(brand || '').toLowerCase();
  if (b && core.some(w => b.includes(w.toLowerCase()))) return '';
  return words.filter((w, i) => !(i === 0 && /^de$/i.test(w))).join(' ');
}

const digits = s => String(s).replace(/\D/g, '');
function asPhone(raw) {
  const d = digits(raw);
  return d.length >= 9 && d.length <= 13 ? raw.replace(/\s+/g, ' ').trim() : '';
}

// The To header: the display name next to one of the user's own addresses.
function namesFromTo(to, recipients, brand) {
  const out = [];
  for (const m of String(to || '').matchAll(/"?([^",<]{2,60}?)"?\s*<([^>]+)>/g)) {
    if (recipients.includes(m[2].trim().toLowerCase())) { const n = asName(m[1], brand); if (n) out.push(n); }
  }
  return out;
}

export function identityFrom({ to = '', parts = [], recipients = [], brand = '' }) {
  const names = new Set(namesFromTo(to, recipients, brand));
  const postal = new Set(), phones = new Set(), emails = new Set(recipients), phoneSeen = new Set();
  const lines = textLines(parts);

  // A greeting near the top: "Beste Anna,", "Geachte heer Jansen,".
  for (const line of lines.slice(0, 60)) {
    const m = GREETING.exec(line);
    if (m) { const n = asName(m[2], brand); if (n) names.add(n); break; }
  }

  // A labelled address block: "Bezorgadres", then name, street, postcode.
  lines.forEach((line, i) => {
    const m = ADDRESS_LABEL.exec(line);
    if (!m) return;
    // One-line addresses ("Teststraat 12a, 1234 AB Amsterdam") split at commas.
    const block = [m[2], ...lines.slice(i + 1, i + 8)].flatMap(s => String(s || '').split(/,\s+/)).map(s => s.trim()).filter(Boolean);
    const pc = block.findIndex(s => NL_POSTCODE.test(s) || /\b\d{4,5}\s+\p{Lu}/u.test(s));
    if (pc < 0 || pc > 4) return;
    // The block ends at the postcode, plus any directly following lines that
    // say what they are ("Telefoon: …", "E-mail: …", a country). A sentence
    // after it ("Questions? Call us on …") is the company talking, not the user.
    const after = [];
    for (const s of block.slice(pc + 1)) {
      if (DETAIL.test(s) || /^[\d\s+().-]{9,}$/.test(s) || /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(s)) after.push(s);
      else break;
    }
    const street = block[pc - 1] || '';
    if (pc > 0 && STREET.test(street) && !/postbus|p\.?o\.? box|antwoordnummer/i.test(street)) {
      postal.add(`${street}, ${block[pc].slice(0, 60)}`);
      if (pc > 1) { const n = asName(block[pc - 2], brand); if (n) names.add(n); }
    }
    for (const s of after) for (const p of s.match(PHONE) || []) { const v = asPhone(p); if (v) phones.add(v); }
    for (const s of after) for (const e of s.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || []) emails.add(e.toLowerCase());
  });

  const text = lines.join('\n');
  // "Je telefoonnummer: 06 12345678"
  for (const line of lines) {
    const m = OWN_PHONE.exec(line);
    if (m) for (const p of line.slice(m.index + m[0].length).match(PHONE) || []) { const v = asPhone(p); if (v) phones.add(v); }
  }
  // "Deze e-mail is verzonden naar anna@…"
  for (const m of text.matchAll(SENT_TO)) emails.add(m[1].toLowerCase());
  // Every number in the mail, reduced to its last nine digits, so the app can
  // recognise one the user entered in Settings. Never shown or sent as such.
  for (const p of text.match(PHONE) || []) phoneSeen.add(digits(p).slice(-9));

  return { names: [...names].slice(0, 3), postal: [...postal].slice(0, 2), phones: [...phones].slice(0, 3),
           emails: [...emails].slice(0, 5), phoneSeen: [...phoneSeen].slice(0, 20) };
}
