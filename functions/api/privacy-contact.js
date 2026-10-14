// GET /api/privacy-contact?domain=example.nl
//
// Reads a company's own privacy statement and returns the privacy or DPO
// address it gives. A Cloudflare Pages Function on hoopup.tech, called only
// when the user presses "Look it up". It receives one thing, the company's
// domain name: nothing about the user. Nothing is logged or stored here; the
// answer is cached at the edge per domain for a week, so a company is read at
// most once a week whoever asks.
//
// It fetches other people's websites, so it is strict about where it goes:
// public hostnames only, https only, only the company's own domain (also
// after redirects), a few pages at most, each with a time and size limit.

const HOST = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const MULTI_TLD = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'co.jp', 'com.au', 'net.au', 'org.au',
  'com.br', 'co.nz', 'co.za', 'com.mx', 'co.in', 'com.tr', 'com.cn', 'com.sg']);
const PRIVACY_LOCAL = /^(privacy|privacyofficer|privacy[.-]officer|privacyteam|privacyvragen|privacydesk|privacy[.-]?office|dpo|fg|avg|gdpr|dataprotection|data[.-]protection|dataprotectionoffice(r)?|dataprivacy|datenschutz|gegevensbescherming|functionarisgegevensbescherming)$/i;
const OFFICER = /^(dpo|fg|privacyofficer|privacy[.-]officer|dataprotectionoffice(r)?|functionarisgegevensbescherming)$/i;
const LINK_WORDS = /privacy|privacyverklaring|privacybeleid|privacystatement|gegevensbescherming|datenschutz|data-protection/i;
const CONTEXT = /privacy|gegevensbescherming|functionaris|data protection|\bdpo\b|datenschutz|\bavg\b|gdpr|persoonsgegevens|personal data/i;
const PATHS = ['/privacy', '/privacyverklaring', '/privacy-statement', '/privacy-policy', '/privacybeleid',
  '/nl/privacy', '/en/privacy', '/legal/privacy', '/privacy/', '/privacyverklaring/'];
const MAX_FETCHES = 8, TIMEOUT = 6000, MAX_BYTES = 1_500_000;
const UA = 'HoopUp privacy-contact lookup (+https://hoopup.tech/#/about)';

export function registrable(host) {
  const parts = String(host || '').toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  return MULTI_TLD.has(lastTwo) ? parts.slice(-3).join('.') : lastTwo;
}
const brandOf = host => registrable(host).split('.')[0];

const json = (body, status = 200, cache = 'public, max-age=86400') => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache,
             'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }
});

// One page, following redirects only while they stay https on the same brand.
async function getPage(url, brand, budget) {
  for (let hop = 0; hop < 4 && budget.left > 0; hop++) {
    let u;
    try { u = new URL(url); } catch { return null; }
    if (u.protocol !== 'https:' || u.username || u.password || u.port || brandOf(u.hostname) !== brand) return null;
    budget.left--;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      const res = await fetch(u.href, { redirect: 'manual', signal: ctrl.signal,
        headers: { 'User-Agent': UA, 'Accept': 'text/html,text/plain;q=0.9', 'Accept-Language': 'nl,en;q=0.8' } });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { url = new URL(res.headers.get('location'), u).href; continue; }
      if (!res.ok || !/text\/(html|plain)/i.test(res.headers.get('content-type') || 'text/html')) return null;
      const reader = res.body?.getReader();
      if (!reader) return { url: u.href, text: await res.text() };
      const chunks = []; let size = 0;
      while (size < MAX_BYTES) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); size += value.length; }
      reader.cancel().catch(() => {});
      const all = new Uint8Array(size); let o = 0; for (const c of chunks) { all.set(c.subarray(0, size - o), o); o += c.length; if (o >= size) break; }
      return { url: u.href, text: new TextDecoder().decode(all) };
    } catch { return null; } finally { clearTimeout(timer); }
  }
  return null;
}

// Links on a page that look like the privacy statement, on the same brand.
export function privacyLinks(page, brand) {
  const out = [];
  for (const m of page.text.matchAll(/<a\b([^>]*)>([\s\S]{0,300}?)<\/a>/gi)) {
    const href = (/\bhref\s*=\s*["']([^"']+)["']/i.exec(m[1]) || [])[1]?.replace(/&amp;/g, '&') || '';
    const label = m[2].replace(/<[^>]+>/g, ' ');
    if (!LINK_WORDS.test(label) && !LINK_WORDS.test(href)) continue;
    try { const u = new URL(href, page.url); if (u.protocol === 'https:' && brandOf(u.hostname) === brand) out.push(u.href.split('#')[0]); } catch { /* not a link */ }
  }
  return [...new Set(out)].slice(0, 3);
}

// The best privacy address on a page: a DPO address beats a privacy@ address,
// which beats another address of theirs that sits next to privacy wording.
export function bestAddress(text, brand) {
  const plain = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/&#64;|&#x40;/gi, '@').replace(/&#46;|&#x2e;/gi, '.')
    .replace(/\s*[[(]\s*(at|apenstaartje)\s*[\])]\s*/gi, '@').replace(/\s*[[(]\s*(dot|punt)\s*[\])]\s*/gi, '.');
  let best = null;
  for (const m of plain.matchAll(/(?:mailto:)?([a-z0-9._+-]+)@([a-z0-9.-]+\.[a-z]{2,})/gi)) {
    const [local, host] = [m[1], m[2].toLowerCase()];
    if (brandOf(host) !== brand) continue;
    const around = plain.slice(Math.max(0, m.index - 200), m.index + 200);
    const score = OFFICER.test(local) ? 4 : PRIVACY_LOCAL.test(local) ? 3 : CONTEXT.test(around) ? 1 : 0;
    if (score && (!best || score > best.score)) best = { email: `${local}@${host}`.toLowerCase(), score };
  }
  return best?.email || '';
}

export async function lookup(domain) {
  const brand = brandOf(domain);
  const budget = { left: MAX_FETCHES };
  const pages = [];
  const home = await getPage(`https://www.${domain}/`, brand, budget) || await getPage(`https://${domain}/`, brand, budget);
  const base = home ? new URL(home.url).origin : `https://www.${domain}`;
  const candidates = [...(home ? privacyLinks(home, brand) : []), ...PATHS.map(p => base + p)];
  let statement = '';
  for (const url of [...new Set(candidates)]) {
    if (budget.left <= 0 || pages.length >= 2) break;
    const page = await getPage(url, brand, budget);
    if (!page) continue;
    pages.push(page);
    statement = statement || page.url;
    const email = bestAddress(page.text, brand);
    if (email) return { email, url: page.url };
  }
  return { email: home ? bestAddress(home.text, brand) : '', url: statement };
}

export async function onRequestGet({ request, waitUntil }) {
  const domain = String(new URL(request.url).searchParams.get('domain') || '').toLowerCase().trim().replace(/^www\./, '');
  if (!HOST.test(domain) || /^\d+(\.\d+){3}$/.test(domain) || /(^|\.)(local|internal|localhost|test|example|invalid)$/.test(domain)) {
    return json({ error: 'not a public domain name' }, 400, 'no-store');
  }
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(`https://hoopup.tech/api/privacy-contact?domain=${encodeURIComponent(domain)}`);
  const hit = cache && await cache.match(key);
  if (hit) return hit;
  const found = await lookup(domain).catch(() => ({ email: '', url: '' }));
  const res = json({ domain, email: found.email, url: found.url, checked: new Date().toISOString().slice(0, 10) },
    200, 'public, max-age=604800');
  if (cache) (waitUntil || (p => p))(cache.put(key, res.clone()));
  return res;
}
