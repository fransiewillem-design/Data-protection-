# Data Reclaim

A local-first workstation for getting your personal data deleted and keeping spam off your real
email address. No account, no server, no analytics — everything you type stays in your browser.

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

So the app has two halves:

| Deletion | Spam |
| --- | --- |
| Find who holds your data (breach lookup + broker registry) | One alias per company |
| Generate a legally precise erasure request | Track which alias went where |
| Track the statutory deadline | Spot the leaker when spam arrives |
| Escalate: reminder → complaint to the regulator | Burn the alias, kill the stream at source |

## Running it

No build step, no dependencies. It does need to be served over HTTP rather than opened from disk,
because browsers block `file://` pages from reading local files.

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

### Hosting it on GitHub Pages

`.github/workflows/pages.yml` publishes the site on every push. Two things have to be true first, and
the second one cannot be automated:

1. **The repository must be eligible for Pages** — public, or private on a paid plan.
2. **The Pages site must be created once, by hand**, under *Settings → Pages → Build and deployment →
   Source: **GitHub Actions***.

The workflow passes `enablement: true`, which asks the API to do step 2 for you. Do not count on it: the
default `GITHUB_TOKEN` is refused with *"Resource not accessible by integration"* no matter how its
permissions are declared, because creating a Pages site needs repository-admin rights that the token
does not carry. Once the site exists, the workflow finds it and deploys on every push. Pages is not available for private repositories on the Free plan, and a Pages site built from a
private repository is served at a public URL anyway (access-controlled Pages is Enterprise-only), so
making the repository public is usually the honest choice.

Publishing is safe here: the app is entirely client-side and the repository holds no keys and no
personal data. A public URL exposes the code, never your data — what you enter stays in your browser.

## The pages

The two jobs are separate pages because they are separate things: unsubscribing is a courtesy the sender
may withdraw, erasure is an obligation with a deadline. Mixing them made it unclear which one a button
was doing.


- **Overview** — what is in flight, what is past its deadline, what to chase.
- **Scan your mail** — drag your Junk (or Inbox) messages out of Apple Mail, Outlook or a Gmail Takeout
  export and drop the `.eml`/`.mbox` files on the page. The browser parses the headers locally, groups
  senders by company, and sorts them into two piles that need opposite treatment: senders publishing a
  standards-compliant `List-Unsubscribe` header are real companies, where unsubscribing and an erasure
  demand both work; senders without one are usually throwaway criminal domains, where clicking anything
  confirms your address and a letter would bounce. One click turns any sender into a tracked target with
  a finished letter. Nothing is uploaded — there is no server to upload to.
- **Who has your data** — three further sources, in order of yield. Your own mailbox first: searching it for
  `"privacy policy" update`, `"welcome to"`, `unsubscribe` and similar surfaces every company holding
  your data, costs nothing and involves no third party at all (a policy-update notice is proof they
  hold you). Anything you find goes in via one box and comes out as a finished letter. Then the data
  brokers, who need no discovery — assume you are in their files. Then public breach records, free on
  the breach database's own site; the paid API is optional and tucked away.
- **Targets** — by default, only companies derived from your own evidence: senders found in the mail you
  scanned, and numbers you logged from spam calls or texts. Each row shows where it came from and which
  single identifier its letter will reveal. Splits every sender into what can actually be done to it, so no
  button is ever dead. Senders advertising RFC 8058 one-click (`List-Unsubscribe-Post`) go in a single
  batch, four at a time, with no page to visit. Senders that published only a link open one at a time,
  because a browser refuses to let a page open many tabs at once and a loop would silently drop all but
  the first. Senders that published nothing — everything from the breach list, where there is no message
  to read a header from — get a search for their unsubscribe or preference page, since a link cannot be
  guessed from a name. Everything starts selected. The 37 bundled data brokers are one link away but deliberately not in this list — they are not
  your evidence, they are everyone's.
- **Letter** — generates the request, in English or Dutch, filled in with your details. Copy it, open
  it in your mail app, or print it. Marking it sent starts the deadline clock.
- **Email defence** — the alias system, guidance on handling what is already arriving, and the tracker
  that tells you who leaked you.
- **Your details** — the identity fields that fill the letters, plus export / import / wipe.

## Order of work

The lists feed each other, so sequence matters:

1. Fill in **Your details** — a request without enough to identify you can be refused legitimately.
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

- **"Send us a copy of your passport."** Art. 12(2) and Recital 64 say a controller may not collect
  extra personal data just to obstruct a request. For a company that only ever had your email address,
  demanding ID is disproportionate. The letters say so.
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

Your data lives in `localStorage` under the key `data-reclaim/v1`, in one browser profile. The point of
that design: this app holds your name, date of birth, address and every email address you own. On a
server, that file is a target — exactly the kind of target that produced the breaches this tool exists
to clean up after. So there is no server.

**What leaves your device, exhaustively.** Three requests, each only when you click something:

| Request | What it carries |
| --- | --- |
| `data/brokers.json` | Nothing — it is a file in this repo |
| `haveibeenpwned.com/api/v3/breaches` | Nothing about you — the public breach list |
| `api.pwnedpasswords.com/range/XXXXX` | Five characters of your password's SHA-1 hash |

**Letters reveal nothing the recipient did not already have.** A target found in your own mail or SMS has
demonstrably got exactly one identifier: the address or number it contacted you on. Its letter cites that
and nothing else — no name, no date of birth, no postal address, no other addresses — and says why,
citing Article 12(2) and Recital 64, which forbid a controller demanding extra personal data as a
condition of acting. The signature and the subject line are the identifier too, since signing your real
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
which addresses are real. The Exposure page therefore leads with the free route: it copies each address and
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
- Clearing site data **erases it**. Export a backup from *Your details*.
- Hosting on GitHub Pages means GitHub sees ordinary web-server request logs (your IP, your browser).
  That is true of any hosted page, and it is about the visit, not your data. Running it locally avoids
  even that.
- **Whoever can change this code can change what it does.** The CSP is defence in depth against a bug,
  not against a compromised repository: an attacker able to push here could lift the restriction in the
  same commit. Keep two-factor authentication on the GitHub account that owns it. This is the realistic
  attack on a static, serverless app — not the data, which never leaves the device, but the code.

## Status

Verified in-browser: routing, persistence across reloads, profile → letter rendering (English and
Dutch), deadline and overdue calculation, escalation templates, alias tracking, import/export.

Verified adversarially: XSS payloads in every text field render as inert text; a `javascript:` URL in an
imported backup is never rendered as a link; exfiltration of the stored profile to an unlisted host is
refused by the CSP; and the CSP blocks nothing the app legitimately needs (zero violations across all
views).

**Not verified end-to-end:** the Have I Been Pwned calls. The network this was built on blocks those
domains at the proxy, so the requests could not be exercised against the live service. The code follows
the documented v3 API and the k-anonymity range model, and fails gracefully, but the first real call is
untested — check it once when you run it.

## Licence

MIT. See `LICENSE`.

Practical guidance, not legal advice.
