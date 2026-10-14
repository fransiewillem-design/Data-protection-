// Where a company's privacy requests should go, and how sure HoopUp is of it.
// In order: an address the user typed; one the company's own mail gives (its
// privacy or DPO address on its own domain); one from the short list below,
// checked against the company's own privacy statement; and only then a guess
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

// { email, source: 'you' | 'mail' | 'list' | 'catalog' | 'guess' | 'none', url, bounced: [] }
export function contactFor(b, r = {}) {
  const bounced = new Set((r.bounced || []).map(x => x.toLowerCase()));
  const entry = b.source === 'mail' ? listed(b.site) : null;
  const guess = b.source === 'mail' || b.confidence === 'low';
  const candidates = [
    [r.to, 'you'],
    [b.privacyEmail, 'mail'],
    [entry?.email, 'list'],
    [b.email, guess ? 'guess' : 'catalog']
  ];
  const [email, source] = candidates.find(([e]) => e && !bounced.has(e.toLowerCase())) || ['', 'none'];
  return { email, source, url: b.privacyUrl || entry?.url || '', bounced: [...bounced], listSource: entry?.source || '' };
}
