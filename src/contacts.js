// Where a company's privacy requests should go, and how sure HoopUp is of it.
// In order: an address the user typed; one the company's own mail gives (its
// privacy or DPO address on its own domain); one from the short list below,
// checked against the company's own privacy statement; one looked up on the
// company's privacy statement at the user's request; and only then a guess
// (privacy@ their domain), labelled as such. An address that bounced is never
// offered again.

// Checked against each company's own privacy statement or official document
// (source linked). Kept short on purpose: an entry here is only added with a
// source, and a wrong one is worse than none, since the app falls back to
// asking the user to look it up.
export const CHECKED = '2026-10';
const DIRECTORY = [
  { domains: ['zalando.nl', 'zalando.de', 'zalando.com', 'zalando.be', 'zalando.co.uk', 'zalando-lounge.nl'],
    email: 'datenschutz@zalando.de',
    source: 'https://corporate.zalando.com/sites/default/files/media-download/Zalando-SE_Corporate-Website_Privacy-Notice_2022-11.pdf' },
  { domains: ['postnl.nl', 'postnl.com'], email: 'fg@postnl.nl',
    url: 'https://www.postnl.nl/privacyverklaring/', source: 'https://postnl.nl/en/privacy-statement' },
  { domains: ['coolblue.nl'], email: 'privacyvragen@coolblue.nl',
    url: 'https://www.coolblue.nl/privacy', source: 'https://www.coolblue.be/en/c/security-privacy-more-complicated.html' },
  { domains: ['coolblue.be'], email: 'privacyvragen@coolblue.be',
    source: 'https://www.coolblue.be/en/c/security-privacy-more-complicated.html' },
  { domains: ['kpn.com', 'kpn.nl'], email: 'privacyofficer@kpn.com',
    url: 'https://www.kpn.com/algemeen/missie-en-privacy-statement/onze-missie',
    source: 'https://irpages2.eqs.com/download/companies/koninkpnnv/Hauptversammlung/20230412_AVG_beleid_AVA2023_NL.pdf' },
  // No address confirmed from an official source yet, but the statement says
  // where to find it.
  { domains: ['ah.nl', 'ah.be', 'albertheijn.nl'], url: 'https://www.ah.nl/privacy' },
  { domains: ['odido.nl', 't-mobile.nl'], url: 'https://www.odido.nl/privacy-statement' },
  { domains: ['ziggo.nl', 'vodafone.nl', 'vodafoneziggo.nl'], url: 'https://www.ziggo.nl/privacy' },
  { domains: ['booking.com'], url: 'https://www.booking.com/content/privacy.html' }
];

const listed = site => DIRECTORY.find(d => d.domains.includes(String(site || '').toLowerCase()));

// { email, cc: [], guessCc, source: 'you' | 'mail' | 'list' | 'lookup' | 'catalog' | 'guess' | 'service' | 'none', url, bounced: [], postal }
export function contactFor(b, r = {}) {
  const bounced = new Set((r.bounced || []).map(x => x.toLowerCase()));
  const entry = b.source === 'mail' ? listed(b.site) : null;
  const guess = b.source === 'mail' || b.confidence === 'low';
  const candidates = [
    [r.to, 'you'],
    [b.privacyEmail, 'mail'],
    [entry?.email, 'list'],
    [b.lookup?.email, 'lookup'],
    [b.email, guess ? 'guess' : 'catalog']
  ];
  let [email, source] = candidates.find(([e]) => e && !bounced.has(e.toLowerCase())) || ['', 'none'];
  // Without a confirmed privacy address, the letter also goes to an address
  // the company itself writes from (its reply or customer-service address):
  // a request through a channel the company provides counts (EDPB Guidelines
  // 01/2022), so it reaches them even if the guessed address does not exist.
  // The same goes for an address from the checked list or the look-up, which
  // may have changed since. Only an address the company's own mail names, or
  // one the user typed, goes without copies.
  // An address from the list or the look-up also gets the usual privacy@ of
  // their domain as a copy: if the listed address has changed, the common one
  // may still be read. A copy that bounces costs nothing; the others arrived.
  let cc = [], guessCc = '';
  if (['guess', 'none', 'list', 'lookup'].includes(source)) {
    const usable = a => a && !bounced.has(a.toLowerCase()) && a.toLowerCase() !== email.toLowerCase();
    const service = (b.serviceEmails || []).filter(usable);
    if (source === 'none' && service.length) { email = service.shift(); source = 'service'; }
    cc = service.slice(0, 2);
    const usual = b.source === 'mail' && b.site && !b.personal ? `privacy@${b.site}` : '';
    if (['list', 'lookup'].includes(source) && usable(usual) && !cc.includes(usual)) { guessCc = usual; cc.push(usual); }
  }
  return { email, cc, guessCc, source, url: b.privacyUrl || entry?.url || b.lookup?.url || '', bounced: [...bounced],
           listSource: entry?.source || '', checked: b.lookup?.checked || '', postal: b.companyPostal || '' };
}

// The look-up runs on hoopup.tech (functions/api/privacy-contact.js). A copy
// served from GitHub Pages has no such function, so it does not offer it.
export const lookupAvailable = () => !location.hostname.endsWith('github.io');

// Sends one thing: the company's domain. Nothing about the user.
export async function lookupContact(site) {
  const res = await fetch('api/privacy-contact?domain=' + encodeURIComponent(site), { credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!res.ok) throw new Error(String(res.status));
  const data = await res.json();
  return { email: String(data.email || ''), url: String(data.url || ''), checked: String(data.checked || '').slice(0, 10) };
}
