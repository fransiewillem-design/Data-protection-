// Have I Been Pwned lookups, done from the browser.
//
// Two very different endpoints:
//  - /range/ (Pwned Passwords) is free and k-anonymous: only the first 5 characters
//    of the SHA-1 hash ever leave this machine, so the password itself is never sent.
//  - /breachedaccount/ needs a paid API key. It is optional; without one you can still
//    browse the full breach list and tick the services you used.

const API = 'https://haveibeenpwned.com/api/v3';

export async function allBreaches() {
  const res = await fetch(`${API}/breaches`);
  if (!res.ok) throw new Error(`HIBP returned ${res.status}`);
  return res.json();
}

// NOTE: this is the only call in the app that transmits personal data — the address
// being checked goes to HIBP, because there is no k-anonymous form of this lookup.
export async function breachesForAccount(email, apiKey) {
  if (!apiKey) throw new Error('needs-key');
  const res = await fetch(
    `${API}/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`,
    { headers: { 'hibp-api-key': apiKey } }   // browsers forbid setting user-agent here
  );
  if (res.status === 404) return [];              // clean, as far as HIBP knows
  if (res.status === 401) throw new Error('That API key was rejected.');
  if (res.status === 429) throw new Error('Rate limited by HIBP — wait a moment and retry.');
  if (!res.ok) throw new Error(`HIBP returned ${res.status}`);
  return res.json();
}

// k-anonymity password check: send 5 hex chars, compare the rest locally.
export async function pwnedPasswordCount(password) {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  const hash = [...new Uint8Array(digest)]
    .map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  // Add-Padding hides the real response size, but being a custom header it needs a
  // CORS preflight. If that is refused, fall back to the plain request rather than
  // failing the check outright.
  const url = `https://api.pwnedpasswords.com/range/${prefix}`;
  let res;
  try {
    res = await fetch(url, { headers: { 'Add-Padding': 'true' } });
  } catch {
    res = await fetch(url);
  }
  if (!res.ok) throw new Error(`Pwned Passwords returned ${res.status}`);

  const text = await res.text();
  for (const line of text.split('\n')) {
    const [suf, count] = line.trim().split(':');
    if (suf === suffix) return parseInt(count, 10);
  }
  return 0;
}
