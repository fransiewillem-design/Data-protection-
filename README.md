<p align="center"><img src="assets/img/icon.svg" width="72" height="72" alt=""></p>

# HoopUp

**Stop spam. Get your data deleted.** Unsubscribe from real companies, block scams, and make companies delete your
data under the GDPR, all in your browser. No account, no database, no analytics: nothing you enter or
drop in is ever uploaded. Available in English and Dutch.

**Use it:** https://hoopup.tech

## What this actually does, and what it cannot

Be clear-eyed about this, because the commercial services in this space are not.

**Nothing can scour the internet and delete you.** There is no API for "forget me." What exists is a
legal right: under **Article 17 GDPR** you can order any company holding your data to erase it, and
they have **one month** to comply or justify refusing. California's CCPA/CPRA gives a similar right
with a 45-day clock. The paid services (Incogni, DeleteMe, Optery) are doing exactly this: sending
requests and chasing replies. This app does the same work, on your own terms, without handing your
identity file to yet another company that can be breached.

**Nothing blocks all spam either.** Once an address is in a breach dump it is on lists forever, resold
between operators you cannot reach. Filtering is an arms race you slowly lose. What actually works is
compartmentalisation: give every company a different address, so a leak burns one alias instead of
your identity, and tells you precisely who leaked it.

So HoopUp does the parts that work, and is honest about the rest:

| Stop the mail | Get the data deleted |
| --- | --- |
| Unsubscribe from real companies, one click where they support it | GDPR letters that reveal only what each company already has |
| Block scams by the sites and reply addresses they reuse | One-click-per-company sending from your own mail app |
| Tell you which address gets mostly spam, and how to retire it | Deadlines, reminders and a regulator complaint, tracked for you |
| One alias per company, so the next leak names the leaker | Suspects first; your own providers get a narrower letter |

## How it works

Drop mail in (`.eml` files, Outlook's `.msg` files, Apple Mail's `.emlx` files, or an `.mbox` of any size: a
multi-gigabyte Google Takeout is read in slices, on the device), or a whole folder: an Apple Mail *Export
Mailbox* folder, a folder of `.msg` files, Thunderbird's folder files. Home asks which mail app you use and gives
three steps for it. The new Outlook on Windows and Outlook for Mac save only one mail at a time, so their steps go
through classic Outlook, Apple Mail or Thunderbird; a drop of a single mail on a computer points there, and a drag
straight out of a mail app (which gives the browser no files) is explained. Home sorts the mail into four cards,
each with one number and one button:

| Card | What the button does |
| --- | --- |
| **Unsubscribe** | One-click unsubscribe for *verified* senders; senders that could not be verified are named, never bulk-clicked |
| **Block scams** | One copy or one import for your mail app that blocks unsafe senders by the link sites and reply addresses they reuse: a filter file for Gmail, a Sieve script for Fastmail, Proton or another Sieve service (each filing into that service's own spam folder: `INBOX.Spam`, `spam`, `Junk`), or a script you paste into Script Editor on a Mac (Apple Mail) or into PowerShell (classic Outlook; long lists are split over rules of 100 values, a second run the same day replaces that day's rules, and a failed save is reported). You pick your computer (Mac, Windows, phone or other) and then only mail apps that can run there are offered: the Apple Mail script only on a Mac, the PowerShell script only for classic Outlook on Windows. Outlook for Mac and the new Outlook run no scripts and use the rules on the Outlook.com account, so they get the Outlook.com route. A short *Best way for you* box, chosen from the address the scams went to and the app, says what to do first. Each site and address becomes its own condition, so a message has to match only one. A sender that left neither cannot be caught by a rule, and the card says so. Press *I've added these rules* once they are in; the next batch then shows only rules you do not have yet |
| **Delete my data** | Opens the letters for companies that genuinely hold your data |
| **Your addresses** | Which address gets mostly spam, and one question to decide whether to keep or retire it (below) |

**The whole mailbox, and the mail you want.** The junk folder is quick, but the whole mailbox can go in
too, and then the app also sees what you do with each sender's mail, from what the export carries: Gmail's
labels (*Opened*, *Starred*, your own labels, *Sent*), the `Status` and `X-Mozilla-Status` flags of mbox
files, Apple Mail's flags in `.emlx` files, and the folder a mailbox came from. A sender counts as wanted when
you write to them (your sent mail in the same export), star or flag their mail, file it in a folder or label
of your own, or open at least half of it (not counted for mail that sat mostly in the junk folder). Wanted
senders are listed apart as *Mail you seem to want*: never pre-selected or bulk-unsubscribed, never in the
erasure queue, and never blocked if you wrote to, starred or filed them. *Keep* and *Unsubscribe anyway*
override the guess either way. Only counts are stored, never which message was opened. A sender is saved
without its empty fields, so a mailbox with several thousand senders still fits in the browser's storage.

**Your addresses.** Every mail says which address it was sent to, so Home can count, per address, how
much of the scanned mail was spam or scams and which real companies in the scan also use it. An address
with at least two unsafe mails making up at least half of its mail is shown as **mostly spam**. That is
all the app can honestly say: the scan is usually a junk folder, and the friends, bank and shops that
rely on an address write to the inbox, which the app never sees. So it asks one question, *do people
or companies you need still use this address?*, and the answer decides the advice:

- **No, I can let it go** → a nine-step plan to move to a new address without losing anything, in an
  order where the old address keeps working until the very end: make the new address (on Outlook/Hotmail
  and iCloud as an alias in the same account, so mail, contacts and files stay put), send the erasure
  letters while the old address can still receive the replies, list what uses it (password manager,
  "Sign in with…", mailbox searches, the companies in the scan), move the accounts that matter first,
  tell people, forward for a few months (auto-reply to contacts only), keep the old mail and contacts,
  check again after a month, and only then retire it, with a warning that password resets go to it.
  Steps can be ticked off; Home shows the progress.
- **Yes, I still need it** → keep it and make it quieter: block the scams, stop giving it out, use a
  separate address per new sign-up.

The answer is remembered and can be changed.

**Who gets blocked, and who only gets an unsubscribe.** Each scanned sender is classified from what the
receiving mail server recorded (`Authentication-Results`, `Received-SPF`, spam score):
*verified* means the check vouched for the From domain itself: DMARC pass, Microsoft's `compauth=pass`, or an
SPF/DKIM pass for that same domain. A scammer can pass SPF and DKIM for a domain of their own while
borrowing a brand in From, so a pass for another domain does not count. Only the topmost
`Authentication-Results` is read (the one the user's own provider added); copies further down came with
the message and could be written by the sender.

| Sender | Offered |
| --- | --- |
| Verified, with an unsubscribe link | Unsubscribe, and an erasure letter. The link is used only if it is `https`, on a real domain name (no bare IP address, no link shortener) and carries no login details |
| Verified, unsubscribe by email only (`List-Unsubscribe: <mailto:…>`) | Unsubscribe: the mail app opens with the unsubscribe mail filled in, addressed to their unsubscribe address only (any `cc` or `bcc` in the header is dropped), and an erasure letter |
| Verified, no unsubscribe link (an order confirmation, a bank) | An erasure letter only: never a block |
| Failed authentication, with an "unsubscribe" link | Block; the link is flagged as a tracker, never clicked |
| Failed authentication, no link | Block |
| Passed authentication, but rated high-confidence spam by the mail provider (Microsoft SCL 9, `CAT:HSPM`/`PHSH`, `X-Spam-Flag: YES`) | Block |
| Passed authentication, but advertising gambling, crypto get-rich schemes, fake prizes, pharmacy or adult spam, or an advance-fee scam (the widow, the next of kin, the business proposal) | Block: a casino that owns its domain passes SPF, DKIM and DMARC perfectly |
| A name claiming a trusted organisation (Belastingdienst, overheid, DigiD, ING, Rabobank, PostNL, DHL, KPN, PayPal…) sent from a domain that is not theirs | Block: the check vouches for the domain, and the domain is not the one claimed |
| No authentication result, or a pass only for another domain than the one in From | Neither: listed as "could not verify". Its unsubscribe link is never used, since a sender that is not who it claims to be sends a link to the spammer; it is not blocked or written to either |
| Sent from a personal account on a free mail service (Gmail, Hotmail, iCloud, Ziggo…) | Neither: there is no company to write to, and the provider is never blocked. Grouped per address, not per provider; if the content is a scam, it is blocked by its exact reply address and its links |

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

- **Send all requests**: a queue that opens each company's letter as a filled-in draft in your own
  mail app (`mailto:`). You press Send there; the next one is ready when you come back. Each is marked
  sent as it opens, which starts its deadline. If a mail app cuts off a long `mailto:` body, a *Copy it*
  link puts that letter on the clipboard; nothing is copied without asking, since a clipboard can sync to
  other devices (Windows clipboard history, Apple's Universal Clipboard). A guessed `privacy@` address is flagged and can be corrected
  in the queue; the correction is kept for reminders.
- **No answer in time**: when the month is up, the same queue sends a reminder giving 14 more days.
- **Ready for a complaint**: still silent 14 days after the reminder, or refused: the complaint to the
  regulator is written for you, to submit on its website.
- **Web form only**: companies that only accept their own form get a checklist with direct links.
- **Print all / PDF**: every pending letter, one per page, to keep as a record or post.
- **They answered: reply ready**: drop a company's answer in (on Home, or the drop zone on Delete data)
  and it is recognised: by the letter's reference (`HU-` and five characters, the same for every letter to
  one company), or by coming from the company's own checked domain on the subject of the request. Mail you
  sent yourself, forged mail and mailings never count. What the answer says, read from the answer above
  the quoted letter, moves the request on: *erased* or *we hold nothing* closes it, a refusal opens the
  complaint, *we take two more months* moves the deadline (Art. 12(3)), anything else means they
  responded. An answer the law does not support gets a reply ready: a demand for a copy of your ID, an
  insistence on their own web form, or "we must keep it by law" without saying what, which law and how long.
  The row says what HoopUp read; the status can always be corrected.
- **Kept mailing**: every sender's last marketing mail (one with an unsubscribe option) is remembered.
  Marketing more than ten days after you unsubscribed, or after the month a request gives them, is
  flagged on the Unsubscribe page and on Home; the letter, the reminder and the complaint say so, with the
  dates, and in the Netherlands the page links the ACM's spam report form.
- **Calendar and log**: *Add the deadlines to my calendar* saves an `.ics` file with each deadline, each
  reminder's end and a "scan your junk mail again" date, so the reminders come from your own calendar
  rather than from a server. It holds company names and dates only. *Download my log* saves a CSV of every
  request (dates, addresses, answers, bounces, history) for your records or a complaint.

The app never sends mail itself. A page that could send mail as you is a page that, if compromised,
could send anything as you; the one click per company is the price of not holding that power. Spam,
fake-unsubscribe and unverifiable senders are never in the queue: a letter to them only confirms
your address is live.

**Who goes first.** Delete data groups every company by how you relate to it, guessed from the
evidence and correctable per row:

| Group | Guessed from | Letter |
| --- | --- | --- |
| No reason to have your data | bundled data brokers, cold calls and texts, mail from senders that could not be verified | full erasure request |
| You may have signed up once | verified senders of newsletters | full erasure request |
| Your own providers | breach notices, verified mail with no unsubscribe link (orders, invoices, account notices) | stop marketing, erase what the service does not need, stop sharing, say what is kept; the account stays |

The send queue follows the same order, so the companies with no business holding your data are written
to first. A full erasure request to your own phone company would be refused for everything the contract
needs, or acted on by closing the account; the customer letter asks for what is enforceable without that.

**Dutch.** The interface is available in English and Dutch (EN | NL switch in the top bar). On a first
visit it follows the system language (English or Dutch), and any other language gets Dutch; a choice
made with the switch is remembered. Letters follow the interface by default
(Settings → Letter language: same as the app, always English, always Dutch). In Dutch, every company found
in your own mail, calls or breaches, and every broker operating in the Netherlands or Belgium, gets a Dutch
letter; international brokers stay in English, with a note saying why. Dutch templates exist for the
erasure request, the customer letter, the reminder and the complaint to the Autoriteit Persoonsgegevens.

The navigation is three tabs: Home, Delete data, Settings. The detailed unsubscribe-and-block view,
aliases, the other ways to find who has your data, and *About & privacy* are linked from Home's cards,
Settings and the footer.

## Order of work

The lists feed each other, so sequence matters:

1. Fill in **Settings**: a request without enough to identify you can be refused legitimately.
2. Do the **marketing data brokers** first (Acxiom, LiveRamp, Epsilon). They are upstream suppliers;
   cutting them off reduces what everyone downstream can buy about you.
3. Then **people-search sites**. Search your own name first and keep the URL of your listing; most
   opt-out forms demand it.
4. Then **B2B scrapers** (ZoomInfo, Apollo, Lusha) if your work address is getting cold sales mail.
5. Chase anything past its deadline. **Missing the one-month deadline is itself an infringement of
   Art. 12(3) GDPR**. That is your ground for escalating, independent of the erasure itself.
6. **Re-run the people-search sites every six months.** They re-acquire from the same upstream feeds
   and quietly re-list you. This is maintenance, not a one-off.

## If they refuse or ignore you

The letters escalate in three steps: request → reminder at the deadline → complaint to the supervisory
authority under Art. 77 GDPR. In the Netherlands that is the
[Autoriteit Persoonsgegevens](https://autoriteitpersoonsgegevens.nl); elsewhere in the EU it is your
national DPA. Complaints are free.

Refusals worth knowing. For the first three, Delete data has the reply ready once their answer is dropped in:

- **"Send us a copy of your passport."** Under Art. 12(6) a controller may ask for more only when it has
  reasonable doubts about your identity, and only what is necessary to resolve them. For a company that
  only ever had your email address, that doubt is hard to justify, and the EDPB considers an ID copy
  generally inappropriate (Guidelines 01/2022). The Dutch DPA fined DPG Media in 2022 for routinely
  demanding one. The letters say so. If you decide to send one anyway, cover your photo and citizen
  service number first (the Dutch government's KopieID app does this).
- **"Use our web form."** The GDPR prescribes no form. A request through any channel the company provides
  is valid, and the time limit runs from its receipt.
- **"We must keep it by law."** Only the data the obligation covers, only as long as it applies, only for
  that purpose (Art. 17(3)(b), 5(1)(b) and (e)); Art. 12(4) requires reasons. The reply asks which data,
  which provision and until when.
- **"We hold no data about you."** From a company whose mail reached you, the reply asks them to check
  their mailing lists and processors, and where the address came from (Art. 15(1)(g)).
- **"We have a legitimate interest."** For direct marketing this does not survive an objection:
  Art. 21(3) is absolute, with no balancing test. The letters invoke it explicitly.

Credit bureaus are the real exception: registrations there usually have a statutory basis and cannot be
erased on request. You can still demand access under Art. 15 and object to *marketing* use.

## Post on the doormat and sales calls

Not in a mailbox, so not something to drop in. The Unsubscribe page gives the opt-outs for the country in
Settings: in the Netherlands, [Postfilter](https://www.postfilter.nl) for addressed advertising post (free,
up to six weeks to take effect, six years valid; companies you are or were a customer of fall outside it,
which the erasure letter covers), a Nee/Nee or Nee/Ja sticker for folders, and, for sales calls, the rule
since 1 July 2021 that a company may only call you with consent or as its (recent) customer, with ACM
ConsuWijzer for reports and [acm.nl/spamklacht](https://www.acm.nl/nl/spamklacht) for spam texts. Belgium
(Robinson list, Do Not Call Me), the UK (MPS, TPS) and the US (Do Not Call Registry, OptOutPrescreen,
DMAchoice) get their own registers.

## Accuracy of the target list

`data/brokers.json` carries a `lastReviewed` date and a `confidence` field per entry. These companies
move their opt-out forms constantly. **Confirm a link before relying on it**: entries marked
`"confidence": "low"` have a guessed `privacy@domain` contact that should be checked against the
company's privacy policy first. The app flags these in the UI before you send.

The list is a plain JSON file: edit it, or add companies through the UI.

## Privacy and threat model

Your data lives in `localStorage` under the key `data-reclaim/v1` (named for the app's original name, and kept so existing users keep their data), in one browser profile. The point of
that design: this app holds your name, date of birth, address and every email address you own. On a
server, that file is a target, exactly the kind of target that produced the breaches this tool exists
to clean up after. So no server ever holds it: the one server-side piece is a stateless function that
looks up a company's privacy address on request, and it receives only that company's domain.

**What leaves your device, exhaustively.** Each only when you click something:

| Request | What it carries |
| --- | --- |
| `data/brokers.json` | Nothing: it is a file in this repo |
| `haveibeenpwned.com/api/v3/breaches` | Nothing about you: the public breach list |
| `api.pwnedpasswords.com/range/XXXXX` | Five characters of your password's SHA-1 hash |
| A sender's one-click unsubscribe URL | `List-Unsubscribe=One-Click`, no cookies, no referrer (see below) |
| `hoopup.tech/api/privacy-contact?domain=…` | Only the company's domain, when you press *Look it up*; the function reads that company's privacy statement, keeps and logs nothing, and the answer is cached a week per company |
| Letters | Nothing from the app: they open in your own mail app, and you press Send |
| Unsubscribe by email, replies to a company's answer | Nothing from the app: they open in your own mail app, and you press Send |
| `login.microsoftonline.com`, `graph.microsoft.com` | Only when you press *Add the rules to Outlook.com* or *Read my junk mail via Microsoft*, each on Microsoft's own sign-in page. Adding rules asks only for `MailboxSettings.ReadWrite` (rules live there; not your mail, not sending) and sends the block rules (spam sites and reply addresses) to your own mailbox. Reading asks only for `Mail.Read` (Microsoft has no per-folder permission, so its consent screen names the whole mailbox) and fetches only the Junk Email folder, each message's own source, straight into the browser, where it is read like dropped files; nothing is changed, and no message is kept, not even in the browser's HTTP cache (`cache: 'no-store'`). Neither gets a refresh token; the permission is held in memory for those requests and then dropped |
| Calendar file, request log | Nothing: both are made on your device and saved where you choose. The calendar file holds company names and dates only; if your calendar syncs, that is your calendar's doing |

**Where letters go.** In order: an address you typed; the privacy or DPO address the company's own mail
gives (privacy@, dpo@, fg@ … on its own domain); a short list checked against the companies' own privacy
statements (`src/contacts.js`, each entry with its source); an address looked up on the company's own
privacy statement when you press *Look it up* (one company, or all guessed ones at once); and only then a
guess, `privacy@` their domain, labelled *guessed* with a link to their privacy statement where known.

The look-up is `functions/api/privacy-contact.js`, a Cloudflare Pages Function on hoopup.tech. A browser
page cannot read other websites, so this one small piece runs on the server. It receives only the
company's domain, fetches at most eight pages of that company's own site (https only, same domain also
after redirects, six seconds and 1.5 MB per page), prefers a DPO address over privacy@ over another address
of theirs next to privacy wording, and returns it with the statement's URL. It stores and logs nothing; the
answer is cached a week per domain. Privacy statements that only appear after JavaScript runs cannot be
read this way: then the app shows the link and asks you to look.

**When the privacy address is unknown.** A request counts once it reaches any channel the company itself
provides, not only its privacy address; one sent to a random or made-up address may be ignored (EDPB
Guidelines 01/2022 on the right of access). (The AVG is the
same regulation under its Dutch name.) So a privacy address HoopUp is not sure of never goes alone: a
guess, but also one from the checked list or the look-up, which may be out of date. The letter is copied
to up to two addresses the company's own mail comes from: the Reply-To it set, a service address in its
footer, and the From address. No-reply addresses are never used (the guidance lets a company ignore a
channel plainly not meant for messages); newsletter senders only when there is nothing better. An address from the
list or the look-up also gets the usual `privacy@` of their domain as a copy, in case the listed one has
changed. If the guess bounces, the other addresses take over. Only when the company's own mail names its privacy address, or
you typed one, does the letter go without copies. Every letter to a company also asks it to
forward the request to whoever handles data protection, citing the same guidance. Where no address works,
the queue offers their contact form (copy the letter in) or post: to the company's address from its own
mail footer, or else a KvK register search, with the letter ready to print.

The addresses each letter went to are kept; drop the "could not be delivered" notice in on Home and those
addresses are marked wrong. If a copy still arrived, the request stands and the deadline runs; if every
address failed, the request goes back on the list and the next attempt uses the next-best address.

**Letters reveal nothing the recipient did not already have.** A company found in your own mail is
identified with exactly what its own mail shows it holds, and nothing from your profile: the addresses it
wrote to (and any "this mail was sent to …" in its footer), the name it addresses you by (the To line, the
greeting, a labelled address block), and a postal address or phone number only where its mail lists them
as yours ("Bezorgadres", "Delivery address", "your phone number"), or a number from Settings that its
mail contains. Its own address, helpline and generic greetings ("Dear customer") are never taken. The
letter says why, citing Article 12(2) (the controller must facilitate the request) and 12(6) (it may ask
for more only with reasonable doubt about your identity, and only what is necessary). The signature uses
only the name and address the company already had. Scams and unverified senders get no letter, and none
of these details are kept for them. A number logged from a call or text gets a letter citing only that
number.

Fail-closed, in two senses. Anything sourced from the user's own evidence (scanned mail, a logged
number, a breach they appeared in, a company they typed in) is minimal even when the recipient address
could not be determined, rather than falling back to the full profile. And targets saved before
provenance was tracked are repaired on load by inferring the source from their id, so data already in
someone's browser stops leaking without them having to re-add anything. Requests to the bundled data brokers, and
complaints to a supervisory authority, still carry full details: a broker cannot find you in its files
without them, and a regulator needs to know who is complaining.

**The one exception, stated plainly:** if you add a HIBP API key and check an address, that address is
sent to Have I Been Pwned. There is no k-anonymous form of that lookup, so the feature cannot exist
without it. It is optional, it is off unless you add a key, and the UI says so at the point of use.

Most people should never add a key. Checking your own address is free on haveibeenpwned.com; the paywall
is on the *automated* lookup, which they closed in 2019 because spammers were bulk-querying it to work out
which addresses are real. The *More ways to find who has your data* page therefore leads with the free route: it copies each address and
opens their site for you, and the key is tucked away as an optional convenience. Note that breaches they
class as sensitive are hidden from the public search; to see those, verify the address through the
*Notify me* section of their site, which is also free.

Nothing else goes anywhere. The letters are generated on your device and sent by your own mail client.

**This is enforced, not just intended.** `index.html` carries a Content Security Policy whose
`connect-src` names only those two hosts, so even a bug in this code could not post your data to
another server: the browser refuses the connection. `script-src` is `'self'`: no third-party scripts,
no CDN, no fonts, no analytics, no tracking pixels. Verified by test: an attempt to `POST` the stored
profile to an arbitrary host is blocked, while the legitimate hosts still work.

**Hostile input is contained.** Everything rendered is HTML-escaped, and link targets are restricted to
`http(s)`: a `javascript:` URL smuggled in through an imported backup file cannot be clicked into
running code. Verified by test with a deliberately malicious backup: no script executed, no such link
was rendered, and the payloads appeared as visible text.

**How one-click unsubscribe keeps the strict policy.** An RFC 8058 unsubscribe is a POST to whatever
host the sender nominates, so it needs `connect-src https:`, a permission the page holding the identity
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
Google offers is the *entire mailbox* (neither has a "spam folder only" scope), so the app would hold a
long-lived token granting full read access to everything, sitting in browser storage on a public origin.
Dropping files in creates no credential at all: the worst case for a bug in this code is one file the
user just chose, rather than their whole mail history. That trade is not worth a saved drag.

If this is ever shared with other people, the same property is what matters most: there is no account and no
database, and the one function only ever sees company domains, so whoever runs it never receives anyone's data and never becomes a controller
of it.

**What this does not protect against:**

- The stored file is **not encrypted**. Anyone with your unlocked machine and this browser profile can
  read it: the same exposure as your saved passwords, but worth knowing.
- Clearing site data **erases it**. Export a backup from *Settings*.
- Hosting on GitHub Pages means GitHub sees ordinary web-server request logs (your IP, your browser).
  That is true of any hosted page, and it is about the visit, not your data. Running it locally avoids
  even that.
- **Whoever can change this code can change what it does.** The CSP is defence in depth against a bug,
  not against a compromised repository: an attacker able to push here could lift the restriction in the
  same commit. Keep two-factor authentication on the GitHub account that owns it. This is the realistic
  attack on a static, serverless app: not the data, which never leaves the device, but the code.

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

### One-click Outlook.com rules (optional)

Outlook on the web takes rule values one at a time. Microsoft's Graph API takes a list, so with a sign-in
the whole block list goes in with one click. That needs an app registration at Microsoft, made once by
whoever runs the site (free, no secret, no certificate):

1. An app registration lives in a Microsoft Entra directory. A personal Microsoft account (Outlook.com,
   Hotmail) has none of its own: signing up for a free Azure account at
   [azure.microsoft.com/free](https://azure.microsoft.com/free) creates one (Microsoft asks for a card to
   verify identity; registering an app costs nothing). A work or school account already has one.
   Then [entra.microsoft.com](https://entra.microsoft.com) (or portal.azure.com) → **App registrations** →
   **New registration**. Name: *HoopUp*. Supported account types: **Personal Microsoft accounts only**.
2. Redirect URI: platform **Single-page application (SPA)**, `https://hoopup.tech/auth.html`.
3. **Register**, then copy the **Application (client) ID** into `MS_CLIENT_ID` in `src/config.js`.
4. **API permissions** → Microsoft Graph → Delegated → `MailboxSettings.ReadWrite` (users consent for
   their own mailbox; no admin consent is needed for personal accounts).
5. Optional, so Microsoft's consent screen names the site rather than the directory's default domain:
   **Branding & properties** → **Publisher domain** → verify `hoopup.tech`. The file it asks for is already
   served at `/.well-known/microsoft-identity-association.json`, holding the client ID.

HoopUp's registration is in place: its client ID is in `src/config.js`. The same sign-in also reads the Junk Email
folder of a Hotmail or Outlook.com mailbox into the browser (`Mail.Read`, asked for only when the user presses *Read
my junk mail via Microsoft*), so those users need no files at all. Adding `Mail.Read` under **API permissions**
is tidy but not required: personal accounts consent per request.

The flow is OAuth 2.0 authorization code with PKCE in the browser (`src/outlook.js`), returning through
`auth.html` with the code in the URL fragment. Earlier `HoopUp:` rules in the mailbox are replaced; the
user's own rules are left alone and keep running first. While `MS_CLIENT_ID` is empty, the button is not
shown and the Outlook.com steps stay manual.

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
documented v3 API and the k-anonymity range model and fails gracefully; check it once when you run it.

## Licence

MIT. See `LICENSE`.

Practical guidance, not legal advice.
