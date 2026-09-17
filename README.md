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

To have it always available, push to GitHub and enable **Settings → Pages → Deploy from a branch**.
The included workflow (`.github/workflows/pages.yml`) publishes it on every push to `main`. That is
safe: the app is all client-side, so a public URL exposes the code, never your data.

## The pages

- **Overview** — what is in flight, what is past its deadline, what to chase.
- **Exposure** — check a password against the breach corpus (k-anonymous: only the first five
  characters of its SHA-1 hash are ever sent), check an address if you have a HIBP API key, and browse
  the full public breach list. Any breached company can be added to your targets in one click.
- **Targets** — 37 data brokers, people-search sites, B2B scrapers and Dutch registries, each with its
  opt-out page and status tracking. Add your own.
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

Your data lives in `localStorage` under the key `data-reclaim/v1`, in one browser profile.

- It is **not encrypted**. Anyone with access to your unlocked machine and this browser profile can
  read it. That is the same exposure as your saved passwords, but worth knowing.
- Clearing site data **erases it**. Export a backup from *Your details*.
- The only outbound requests the app makes are to `haveibeenpwned.com` and `api.pwnedpasswords.com`,
  and only when you click a check. The password check never transmits your password or its full hash.
- The letters are generated locally; nothing is sent until you press send in your own mail client.

## Status

Verified in-browser: routing, persistence across reloads, profile → letter rendering (English and
Dutch), deadline and overdue calculation, escalation templates, alias tracking, import/export.

**Not verified end-to-end:** the Have I Been Pwned calls. The network this was built on blocks those
domains at the proxy, so the requests could not be exercised against the live service. The code follows
the documented v3 API and the k-anonymity range model, and fails gracefully, but the first real call is
untested — check it once when you run it.

## Licence

MIT. See `LICENSE`.

Practical guidance, not legal advice.
