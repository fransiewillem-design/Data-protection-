<p align="center"><img src="assets/img/icon.svg" width="72" height="72" alt=""></p>

# HoopUp

**Stop spam. Get your data deleted.** Unsubscribe from real companies, block scams, and make companies delete your
data under the GDPR — all in your browser. No account, no server, no analytics: nothing you enter or
drop in is ever uploaded. Available in English and Dutch.

**Use it:** https://hoopup.tech

## What this actually does, and what it cannot

Be clear-eyed about this, because the commercial services in this space are not.

**Nothing can scour the internet and delete you.** There is no API for "forget me." What exists is a
legal right: under **Article 17 GDPR** you can order any company holding your data to erase it, and
they have **one month** to comply or justify refusing. California's CCPA/CPRA gives a similar right
with a 45-day clock. The paid services (Incogni, DeleteMe, Optery) are doing exactly this — sending
requests and chasing replies. This app does the same work, on your own terms, without handing your
identity file to yet another company that can be breached.

**Nothing blocks all spam either.** Once an address is in a breach dump it is on lists forever, resold
between operators you cannot reach. Filtering is an arms race you slowly lose. What actually works is
compartmentalisation: give every company a different address, so a leak burns one alias instead of
your identity — and tells you precisely who leaked it.

So HoopUp does the parts that work, and is honest about the rest:

| Stop the mail | Get the data deleted |
| --- | --- |
| Unsubscribe from real companies, one click where they support it | GDPR letters that reveal only what each company already has |
| Block scams by the sites and reply addresses they reuse | One-click-per-company sending from your own mail app |
| Tell you which address is burned and how to retire it | Deadlines, reminders and a regulator complaint, tracked for you |
| One alias per company, so the next leak names the leaker | Suspects first; your own providers get a narrower letter |

## How it works

Drop mail in and Home sorts it into four cards, each with one number and one button:

| Card | What the button does |
| --- | --- |
| **Unsubscribe** | One-click unsubscribe for *verified* senders; senders that could not be verified are named, never bulk-clicked |
| **Block scams** | One copy or one import for your mail app — a filter file for Gmail, a Sieve script for Fastmail/Proton, a script you paste into Script Editor (Apple Mail) or PowerShell (classic Outlook) — that blocks every unsafe sender via its reused link sites and reply addresses. Each site and address becomes its own condition, so a message has to match only one. Press *Done* once the rules are in; the next batch then shows only rules you do not have yet |
| **Delete my data** | Opens the letters for companies that genuinely hold your data |
| **Your addresses** | Which address gets mostly spam, and one question to decide whether to keep or retire it (below) |

**Your addresses.** Every mail says which address it was sent to, so Home can count, per address, how
much of the scanned mail was spam or scams and which real companies in the scan also use it. An address
with at least two unsafe mails making up at least half of its mail is shown as **mostly spam**. That is
all the app can honestly say: the scan is usually a junk folder, and the friends, bank and shops that
rely on an address write to the inbox, which the app never sees. So it asks one question — *do people
or companies you need still use this address?* — and the answer decides the advice:

- **No, I can let it go** → move any real company it saw first, then provider-specific steps to retire
  the address (Microsoft alias or account, iCloud Hide My Email, Gmail filter), with a warning that
  password resets go to it.
- **Yes, I still need it** → keep it and make it quieter: block the scams, stop giving it out, use a
  separate address per new sign-up.

The answer is remembered and can be changed.

**Who gets blocked, and who only gets an unsubscribe.** Each scanned sender is classified from what the
receiving mail server recorded (`Authentication-Results`, `Received-SPF`, spam score):

| Sender | Offered |
| --- | --- |
| Verified, with an unsubscribe link | Unsubscribe, and an erasure letter |
| Verified, no unsubscribe link (an order confirmation, a bank) | An erasure letter only — never a block |
| Failed authentication, with an "unsubscribe" link | Block; the link is flagged as a tracker, never clicked |
| Failed authentication, no link | Block |
| Passed authentication, but rated high-confidence spam by the mail provider (Microsoft SCL 9, `CAT:HSPM`/`PHSH`, `X-Spam-Flag: YES`) | Block |
| Passed authentication, but advertising gambling, crypto get-rich schemes, fake prizes, pharmacy or adult spam | Block — a casino that owns its domain passes SPF, DKIM and DMARC perfectly |
| A name claiming a trusted organisation (Belastingdienst, overheid, DigiD, ING, Rabobank, PostNL, DHL, KPN, PayPal…) sent from a domain that is not theirs | Block — the check vouches for the domain, and the domain is not the one claimed |
| No authentication result either way | Neither — listed as "could not verify", so it is not blocked or written to by mistake |

Passing the sender check proves who sent a message, not that it is wanted, so content counts too. Each
category needs two hits, with a strong pattern ("free spins", "casino", "you have won") counting double,
so a single ordinary word never trips it: Albert Heijn's "Bonus" offers and a bank's "your account is
blocked" notice stay real companies (account-scare wording only counts against unverified senders). Only
the category is stored, never the text. One spam operation often rotates brand names on a single domain
(four "casinos" from one sender); every name it used is shown with it.

Block rules never use the From domain of forged mail: it is either made up or a real company's borrowed
for the scam. A sender that passed the check owns its domain, so for an unsafe verified sender the
domain itself is blocked too. A spoof of a real company (say a fake bol.com) is grouped separately from the genuine
sender, shown as "(impersonated)", and the real company's domain, link sites and reply hosts are
excluded from every rule.

**Sending the requests in bulk.** The Delete data page (and the Home card) turns the list into work:

- **Send all requests** — a queue that opens each company's letter as a filled-in draft in your own
  mail app (`mailto:`). You press Send there; the next one is ready when you come back. Each is marked
  sent as it opens, which starts its deadline. The letter is also copied to the clipboard, because some
  mail apps cut off a long `mailto:` body. A guessed `privacy@` address is flagged and can be corrected
  in the queue; the correction is kept for reminders.
- **No answer in time** — when the month is up, the same queue sends a reminder giving 14 more days.
- **Ready for a complaint** — still silent 14 days after the reminder, or refused: the complaint to the
  regulator is written for you, to submit on its website.
- **Web form only** — companies that only accept their own form get a checklist with direct links.
- **Print all / PDF** — every pending letter, one per page, to keep as a record or post.

The app never sends mail itself. A page that could send mail as you is a page that, if compromised,
could send anything as you; the one click per company is the price of not holding that power. Spam,
fake-unsubscribe and unverifiable senders are never in the queue — a letter to them only confirms
your address is live.

**Who goes first.** Delete data groups every company by how you relate to it, guessed from the
evidence and correctable per row:

| Group | Guessed from | Letter |
| --- | --- | --- |
| No reason to have your data | bundled data brokers, cold calls and texts, mail from senders that could not be verified | full erasure request |
| You may have signed up once | verified senders of newsletters | full erasure request |
| Your own providers | breach notices, verified mail with no unsubscribe link (orders, invoices, account notices) | stop marketing, erase what the service does not need, stop sharing, say what is kept — the account stays |

The send queue follows the same order, so the companies with no business holding your data are written
to first. A full erasure request to your own phone company would be refused for everything the contract
needs, or acted on by closing the account; the customer letter asks for what is enforceable without that.

**Dutch.** The interface is available in English and Dutch (EN | NL switch in the top bar). It follows
the browser language on first visit and remembers the choice. Letters follow the interface by default
(Settings → Letter language: same as the app, always English, always Dutch). In Dutch, every company found
in your own mail, calls or breaches, and every broker operating in the Netherlands or Belgium, gets a Dutch
letter; international brokers stay in English, with a note saying why. Dutch templates exist for the
erasure request, the customer letter, the reminder and the complaint to the Autoriteit Persoonsgegevens.

The navigation is three tabs — Home, Delete data, Settings. The detailed unsubscribe-and-block view,
aliases, the other ways to find who has your data, and *About & privacy* are linked from Home's cards,
Settings and the footer.

## Order of work

The lists feed each other, so sequence matters:

1. Fill in **Settings** — a request without enough to identify you can be refused legitimately.
2. Do the **marketing data brokers** first (Acxiom, LiveRamp, Epsilon). They are upstream suppliers;
   cutting them off reduces what everyone downstream can buy about you.
3. Then **people-search sites**. Search your own name first and keep the URL of your listing — most
   opt-out forms demand it.
4. Then **B2B scrapers** (ZoomInfo, Apollo, Lusha) if your work address is getting cold sales mail.
5. Chase anything past its deadline. **Missing the one-month deadline is itself an infringement of
   Art. 12(3) GDPR** — that is your ground for escalating, independent of the erasure itself.
6. **Re-run the people-search sites every six months.** They re-acquire from the same upstream feeds
   and quietly re-list you. This is maintenance, not a one-off.

## If they refuse or ignore you

The letters escalate in three steps: request → reminder at the deadline → complaint to the supervisory
authority under Art. 77 GDPR. In the Netherlands that is the
[Autoriteit Persoonsgegevens](https://autoriteitpersoonsgegevens.nl); elsewhere in the EU it is your
national DPA. Complaints are free.

Two refusals worth knowing:

- **"Send us a copy of your passport."** Under Art. 12(6) a controller may ask for more only when it has
  reasonable doubts about your identity, and only what is necessary to resolve them. For a company that
  only ever had your email address, that doubt is hard to justify, and the EDPB considers an ID copy
  generally disproportionate (Guidelines 01/2022). The letters say so.
- **"We have a legitimate interest."** For direct marketing this does not survive an objection —
  Art. 21(3) is absolute, with no balancing test. The letters invoke it explicitly.

Credit bureaus are the real exception: registrations there usually have a statutory basis and cannot be
erased on request. You can still demand access under Art. 15 and object to *marketing* use.

## Accuracy of the target list

`data/brokers.json` carries a `lastReviewed` date and a `confidence` field per entry. These companies
move their opt-out forms constantly. **Confirm a link before relying on it** — entries marked
`"confidence": "low"` have a guessed `privacy@domain` contact that should be checked against the
company's privacy policy first. The app flags these in the UI before you send.

The list is a plain JSON file: edit it, or add companies through the UI.

## Privacy and threat model

Your data lives in `localStorage` under the key `data-reclaim/v1` (named for the app's original name, and kept so existing users keep their data), in one browser profile. The point of
that design: this app holds your name, date of birth, address and every email address you own. On a
server, that file is a target — exactly the kind of target that produced the breaches this tool exists
to clean up after. So there is no server.

**What leaves your device, exhaustively.** Each only when you click something:

| Request | What it carries |
| --- | --- |
| `data/brokers.json` | Nothing — it is a file in this repo |
| `haveibeenpwned.com/api/v3/breaches` | Nothing about you — the public breach list |
| `api.pwnedpasswords.com/range/XXXXX` | Five characters of your password's SHA-1 hash |
| A sender's one-click unsubscribe URL | `List-Unsubscribe=One-Click`, no cookies, no referrer (see below) |
| Letters | Nothing from the app — they open in your own mail app, and you press Send |

**Letters reveal nothing the recipient did not already have.** A target found in your own mail or SMS has
demonstrably got exactly one identifier: the address or number it contacted you on. Its letter cites that
and nothing else — no name, no date of birth, no postal address, no other addresses — and says why,
citing Article 12(2) (the controller must facilitate the request) and 12(6) (it may ask for more only
with reasonable doubt about your identity, and only what is necessary). The signature and the subject line are the identifier too, since signing your real
name would hand over exactly what the body withheld. This matters most for the letters that go to
criminals: a scammer who mails you learns nothing from your reply.

Fail-closed, in two senses. Anything sourced from the user's own evidence — scanned mail, a logged
number, a breach they appeared in, a company they typed in — is minimal even when the recipient address
could not be determined, rather than falling back to the full profile. And targets saved before
provenance was tracked are repaired on load by inferring the source from their id, so data already in
someone's browser stops leaking without them having to re-add anything. Requests to the bundled data brokers, and
complaints to a supervisory authority, still carry full details — a broker cannot find you in its files
without them, and a regulator needs to know who is complaining.

**The one exception, stated plainly:** if you add a HIBP API key and check an address, that address is
sent to Have I Been Pwned. There is no k-anonymous form of that lookup, so the feature cannot exist
without it. It is optional, it is off unless you add a key, and the UI says so at the point of use.

Most people should never add a key. Checking your own address is free on haveibeenpwned.com — the paywall
is on the *automated* lookup, which they closed in 2019 because spammers were bulk-querying it to work out
which addresses are real. The *More ways to find who has your data* page therefore leads with the free route: it copies each address and
opens their site for you, and the key is tucked away as an optional convenience. Note that breaches they
class as sensitive are hidden from the public search; to see those, verify the address through the
*Notify me* section of their site, which is also free.

Nothing else goes anywhere. The letters are generated on your device and sent by your own mail client.

**This is enforced, not just intended.** `index.html` carries a Content Security Policy whose
`connect-src` names only those two hosts, so even a bug in this code could not post your data to
another server — the browser refuses the connection. `script-src` is `'self'`: no third-party scripts,
no CDN, no fonts, no analytics, no tracking pixels. Verified by test: an attempt to `POST` the stored
profile to an arbitrary host is blocked, while the legitimate hosts still work.

**Hostile input is contained.** Everything rendered is HTML-escaped, and link targets are restricted to
`http(s)` — a `javascript:` URL smuggled in through an imported backup file cannot be clicked into
running code. Verified by test with a deliberately malicious backup: no script executed, no such link
was rendered, and the payloads appeared as visible text.

**How one-click unsubscribe keeps the strict policy.** An RFC 8058 unsubscribe is a POST to whatever
host the sender nominates, so it needs `connect-src https:` — a permission the page holding the identity
file must not have. That permission lives in `unsubscribe.html`, loaded in a hidden same-origin iframe.
A framed document served from its own URL gets its own policy instead of inheriting its parent's, so the
worker can reach any host while `index.html` still cannot reach anything but the two breach endpoints.
The worker never reads `localStorage`, holds nothing, and acts only on a URL list handed to it by
postMessage from its own origin. It sends no cookies (`credentials: 'omit'`) and no referrer.

Verified by test: four one-click unsubscribes arrive at the target server with the correct
`List-Unsubscribe=One-Click` body and no cookie or referer header, while the same test's attempt to POST
the stored profile to that host **from the main page** is refused by CSP and never arrives.

One honest limit: the response to a cross-site POST is opaque, so the app reports *delivered*, not
*confirmed*. If mail continues from a sender, the erasure letter is the enforceable follow-up.

**Why there is no "connect your mailbox" button.** Reading the mailbox directly would mean OAuth, and
OAuth is the less private design, not the more convenient one. The smallest scope either Microsoft or
Google offers is the *entire mailbox* — neither has a "spam folder only" scope — so the app would hold a
long-lived token granting full read access to everything, sitting in browser storage on a public origin.
Dropping files in creates no credential at all: the worst case for a bug in this code is one file the
user just chose, rather than their whole mail history. That trade is not worth a saved drag.

If this is ever shared with other people, the same property is what matters most: there is no server, no
account and no database, so whoever runs it never receives anyone's data and never becomes a controller
of it.

**What this does not protect against:**

- The stored file is **not encrypted**. Anyone with your unlocked machine and this browser profile can
  read it — the same exposure as your saved passwords, but worth knowing.
- Clearing site data **erases it**. Export a backup from *Settings*.
- Hosting on GitHub Pages means GitHub sees ordinary web-server request logs (your IP, your browser).
  That is true of any hosted page, and it is about the visit, not your data. Running it locally avoids
  even that.
- **Whoever can change this code can change what it does.** The CSP is defence in depth against a bug,
  not against a compromised repository: an attacker able to push here could lift the restriction in the
  same commit. Keep two-factor authentication on the GitHub account that owns it. This is the realistic
  attack on a static, serverless app — not the data, which never leaves the device, but the code.

## Running it

No bundler, no dependencies. It does need to be served over HTTP rather than opened from disk,
because browsers block `file://` pages from reading local files.

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

### Building

`sh scripts/build.sh` copies only what the site serves into `dist/` and stamps the commit into every
asset URL, so a browser never mixes a fresh page with stale cached modules. Both hosts below run it.

### Hosting on Cloudflare Pages (hoopup.tech)

1. Cloudflare → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**, and give Cloudflare
   access to this repository only.
2. Branch: the default branch. Framework preset: **None**. Build command: `sh scripts/build.sh`.
   Build output directory: `dist`.
3. **Custom domains** → add `hoopup.tech` (and `www.hoopup.tech`).

`_headers` adds what a `<meta>` tag cannot: `frame-ancestors` (no framing by other sites), HSTS,
`nosniff`, and a locked-down `Permissions-Policy`. The Content-Security-Policy is set per page, never on
`/*`: two policies on one response are both enforced, and a site-wide one would strip the unsubscribe
worker of the `connect-src https:` it exists to hold. Cloudflare serves `/unsubscribe.html` at
`/unsubscribe`, so that rule is listed under both paths.

### Hosting on GitHub Pages

A fallback only: the live site is on Cloudflare. `.github/workflows/pages.yml` builds and publishes when run by
hand (*Actions → Deploy to GitHub Pages → Run workflow*), after Pages is switched back on. The Pages site must be created once by
hand (*Settings → Pages → Source: GitHub Actions*); the workflow's `enablement: true` cannot do it,
because the default `GITHUB_TOKEN` lacks the admin rights. On the free plan the repository must be
public. GitHub Pages ignores `_headers`.

Publishing is safe either way: the app is entirely client-side and the repository holds no keys and no
personal data.

## Status

Checked before launch, in a real browser, on every page in English and Dutch, light and dark mode,
desktop and phone width: no script errors, no failed requests, no horizontal scrolling, no dead
internal links, every external link `https` and opened without a referrer, and no WCAG 2 A/AA
violations reported by axe-core.

End-to-end tests cover: classification of real junk mail (scams, a spoofed bol.com, a genuine order
confirmation, a real newsletter); one-click unsubscribe delivery against a test server; the block list
never containing a verified sender's domain; the send queue, a corrected recipient, reminders after 30
days and the complaint after 14 more (with time simulated); the relationship groups and their order;
Dutch letters following the interface; migration of older saved data; and the adversarial suite (XSS
in every field and in imported backups, exfiltration blocked by CSP, the unsubscribe worker isolated).

**Not verified end-to-end:** the Have I Been Pwned calls. The network this was built on blocks those
domains, so the requests could not be exercised against the live service. The code follows the
documented v3 API and the k-anonymity range model and fails gracefully — check it once when you run it.

## Licence

MIT. See `LICENSE`.

Practical guidance, not legal advice.
