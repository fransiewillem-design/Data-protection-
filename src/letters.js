// Request letter templates. Kept as plain functions so they are easy to edit.

import { lang } from './i18n.js';

// A target found in the user's own mail or SMS has demonstrably got exactly one
// identifier: the address or number it contacted them on. Handing it a full name,
// date of birth and postal address would give a scammer more than it started with,
// which is the opposite of what this letter is for. So evidence-derived targets get a
// minimal block, and the letter says why.
export function isEvidenceDerived(b) {
  if (!b) return false;
  // Anything we learned from the user's own mail or SMS is minimal-disclosure by
  // default, even if we could not pin down which address received it; failing
  // open here would leak a full profile to a scammer.
  // Every target the user added themselves is evidence-derived: it came from
  // their mail, their phone, a breach they were in, or their own typing. Only
  // the bundled broker catalogue gets a full identity block, because a broker
  // genuinely cannot find one person in a national database from an email alone.
  if (['mail', 'phone', 'breach', 'custom'].includes(b.source)) return true;
  return !!(b.evidence && (b.evidence.address || b.evidence.phone));
}

// Exactly what the company's own mail showed about the user, as labelled lines.
// Each value is cleaned to one line, so text taken from a mail cannot add
// lines of its own to the letter.
export function evidenceLines(b, nl) {
  const e = b.evidence || {};
  const one = v => String(v || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 120);
  const list = arr => [...new Set((arr || []).map(one).filter(Boolean))];
  const emails = list([e.address, ...(e.emails || [])]);
  const lines = [];
  const names = list(e.names);
  if (names.length) lines.push([nl ? 'Naam waarmee u mij aanschrijft' : 'Name you address me by', names.join(', ')]);
  if (emails.length) lines.push([nl ? (emails.length > 1 ? 'E-mailadressen' : 'E-mailadres') : (emails.length > 1 ? 'Email addresses' : 'Email address'), emails.join(', ')]);
  const postal = list(e.postal);
  if (postal.length) lines.push([nl ? 'Postadres' : 'Postal address', postal.join('; ')]);
  const phones = list(e.phone ? [e.phone, ...(e.phones || [])] : e.phones);
  if (phones.length) lines.push([nl ? (phones.length > 1 ? 'Telefoonnummers' : 'Telefoonnummer') : (phones.length > 1 ? 'Phone numbers' : 'Phone number'), phones.join(', ')]);
  return lines;
}

function minimalBlock(b, nl) {
  const lines = evidenceLines(b, nl);
  const id = lines.length
    ? lines.map(([k, v]) => `${k}: ${v}`).join('\n')
    : nl ? 'E-mailadres: [vul het adres in waarop u hun bericht ontving]'
         : 'Email address: [fill in the address their message reached you on]';
  const several = lines.length > 1 || /,|;/.test(lines[0]?.[1] || '');
  // Flowing sentences, no hard line breaks: a mail app wraps them to the
  // screen, where fixed breaks look ragged on a phone.
  const why = nl
    ? (several
      ? 'Dit zijn de enige gegevens die ik verstrek. Het zijn precies de gegevens die uw eigen berichten aan mij laten zien, dus u heeft ze aantoonbaar al, en ze volstaan om mijn gegevens te vinden.'
      : 'Dit is het enige identificatiegegeven dat ik verstrek, omdat u het aantoonbaar al van mij heeft (u heeft mij hierop benaderd) en het volstaat om mijn gegevens te vinden.')
      + ' Op grond van artikel 12, lid 2, AVG moet u de uitoefening van mijn rechten faciliteren. Op grond van artikel 12, lid 6, mag u alleen om aanvullende gegevens vragen als u redelijke twijfel heeft over mijn identiteit, en dan alleen wat nodig is om die twijfel weg te nemen.'
    : (several
      ? 'These are the only details I am providing. They are exactly what your own messages to me show, so you demonstrably hold them already, and they are enough to locate my records.'
      : 'This is the only identifier I am providing, because it is the one you demonstrably already hold (it is how you contacted me) and it is enough to locate my records.')
      + ' Under Article 12(2) GDPR you must facilitate the exercise of my rights. Under Article 12(6) you may ask for additional information only if you have reasonable doubts about my identity, and then only what is necessary to resolve them.';
  return id + '\n\n' + why;
}

// Sign as they know the user: the name their mail used, if any, and the
// identifier they hold. Never a name they did not have.
function signature(b, p, nl) {
  if (isEvidenceDerived(b)) {
    const e = b.evidence || {};
    const name = String((e.names || [])[0] || '').replace(/^(heer|mevrouw|mevr\.?|dhr\.?|meneer|mr\.?|mrs\.?|ms\.?|miss|dr\.?)\s+/i, '').trim();
    const id = e.address || e.phone || (nl ? '[adres]' : '[address]');
    return name ? `${name}\n${id}` : id + (nl ? '\n(de houder van bovengenoemd adres)' : '\n(the holder of the address above)');
  }
  return p.fullName || (nl ? '[naam]' : '[your name]');
}

function subjectId(b, p) {
  if (!isEvidenceDerived(b)) return p.fullName || '[your name]';
  const e = b.evidence || {};
  return e.address || e.phone || 'data subject request';
}

function identityBlock(p) {
  const lines = [];
  if (p.fullName) lines.push(`Full name: ${p.fullName}`);
  if (p.birthDate) lines.push(`Date of birth: ${p.birthDate}`);
  if (p.emails?.length) lines.push(`Email address(es): ${p.emails.join(', ')}`);
  if (p.phones?.length) lines.push(`Phone number(s): ${p.phones.join(', ')}`);
  if (p.addresses) lines.push(`Postal address: ${p.addresses.replace(/\n/g, ', ')}`);
  return lines.length ? lines.join('\n') : '[Fill in your details on the Settings page]';
}

function identityBlockNL(p) {
  const lines = [];
  if (p.fullName) lines.push(`Volledige naam: ${p.fullName}`);
  if (p.birthDate) lines.push(`Geboortedatum: ${p.birthDate}`);
  if (p.emails?.length) lines.push(`E-mailadres(sen): ${p.emails.join(', ')}`);
  if (p.phones?.length) lines.push(`Telefoonnummer(s): ${p.phones.join(', ')}`);
  if (p.addresses) lines.push(`Postadres: ${p.addresses.replace(/\n/g, ', ')}`);
  return lines.length ? lines.join('\n') : '[Vul je gegevens in op de pagina Instellingen]';
}

// A request counts once it reaches any channel the company itself provides,
// not only its privacy address (EDPB Guidelines 01/2022 on the right of access).
// Said in every letter, so one sent to customer service or to a guessed
// address is passed on rather than ignored.
const FORWARD_EN = `RIGHT ADDRESS
If this message has not reached the person or team responsible for data protection, please forward it to them. A request received through any channel you provide is valid, and the time limit runs from the day you received it (EDPB Guidelines 01/2022 on the right of access).`;
const FORWARD_NL = `JUISTE ADRES
Is dit bericht niet terechtgekomen bij de persoon of afdeling die over gegevensbescherming gaat, stuur het dan aan hen door. Een verzoek dat via een van uw kanalen binnenkomt is geldig, en de termijn loopt vanaf de dag van ontvangst (EDPB-richtsnoeren 01/2022 over het recht op inzage).`;

// The letter's reference, the same for every letter to one company, so a reply
// that quotes it is recognised, and a reminder carries the reference of the
// request it follows up.
export function refOf(b) {
  let h = 0x811c9dc5;
  for (const c of String(b?.id || b?.name || '')) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return 'HU-' + h.toString(36).toUpperCase().padStart(5, '0').slice(-5);
}

// Marketing that came after the user said stop: more than ten days after an
// unsubscribe (time for a mailing already scheduled to go out), or after the
// month a request gives them. Only mail with an unsubscribe option counts, so
// an invoice or an answer to the request never does.
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
export function keptMailing(b, rec = {}) {
  const last = b?.lastBulkAt;
  if (!last) return null;
  if (rec?.sentAt && rec.status !== 'todo' && daysBetween(rec.sentAt, last) > 30) return { since: 'request', from: rec.sentAt, last };
  if (b.unsubscribedAt && daysBetween(b.unsubscribedAt, last) > 10) return { since: 'unsub', from: b.unsubscribedAt, last };
  return null;
}

// The paragraph a letter gets when they kept mailing.
function keptNote(b, rec, nl) {
  const k = keptMailing(b, rec);
  if (!k) return '';
  if (k.since === 'request') return nl
    ? `\nSinds mijn verzoek stuurt u mij nog steeds reclame, voor het laatst op ${longDate(k.last, true)}, terwijl u daar op grond van artikel 21, lid 3, AVG mee had moeten stoppen.\n`
    : `\nSince my request you have kept sending me marketing, most recently on ${longDate(k.last, false)}, although Article 21(3) GDPR required you to stop.\n`;
  return nl
    ? `\nU BLEEF MAILEN\nOp ${longDate(k.from, true)} heb ik mij afgemeld voor uw mailings. Daarna stuurde u mij toch weer reclame, voor het laatst op ${longDate(k.last, true)}. Na mijn bezwaar mag u mijn gegevens niet meer gebruiken voor direct marketing (artikel 21, lid 3, AVG), en reclame mailen na een afmelding is ook in strijd met artikel 11.7 van de Telecommunicatiewet.\n`
    : `\nYOU KEPT MAILING ME\nOn ${longDate(k.from, false)} I unsubscribed from your mailings. You sent me marketing again afterwards, most recently on ${longDate(k.last, false)}. Once I object, you may no longer use my data for direct marketing (Article 21(3) GDPR), and marketing email after an unsubscribe also breaks the ePrivacy rules (Article 13 of Directive 2002/58/EC).\n`;
}

// Letters carry dates the way people write them: "11 oktober 2026".
const MONTHS = {
  nl: ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
};
const todayISO = () => new Date().toISOString().slice(0, 10);
export function longDate(iso, nl) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return iso || '';
  return `${d} ${MONTHS[nl ? 'nl' : 'en'][m - 1]} ${y}`;
}

export const TEMPLATES = {
  // --- GDPR: erasure + access + objection in one letter -----------------------
  gdpr_erasure: {
    label: 'GDPR erasure (Art. 17 + 15 + 21)',
    jurisdiction: 'EU',
    subject: (b, p) => `Request under Articles 15, 17 and 21 GDPR, ${subjectId(b, p)}`,
    body: (b, p, rec) => `To the Data Protection Officer / Privacy Team of ${b.name},

I am a data subject within the meaning of Regulation (EU) 2016/679 (GDPR). I am writing to exercise my rights in respect of all personal data you hold about me.

My reference for this request: ${refOf(b)}

IDENTIFYING DETAILS
${isEvidenceDerived(b) ? minimalBlock(b, false) : identityBlock(p)}
${keptNote(b, rec, false)}
I request that you do the following.

1. ERASURE (Article 17 GDPR)
Erase all personal data you hold concerning me, including data obtained from third parties, data inferred or derived about me, and any copies held by processors acting on your behalf. Where you have made this data public or transferred it onwards, Article 17(2) requires you to inform the recipients of this erasure request.

2. OBJECTION (Article 21 GDPR)
Insofar as any processing relies on legitimate interests, I object to that processing. Where the processing is for direct marketing purposes, Article 21(3) gives this objection absolute effect: you must stop that processing entirely, without weighing interests.

3. ACCESS (Article 15 GDPR)
If you assert that any data may not be erased, provide for that data:
   a. the specific categories of personal data retained;
   b. the exact legal basis and, where relevant, the statutory retention obligation relied on;
   c. the source from which you obtained it;
   d. the recipients or categories of recipients to whom it has been disclosed;
   e. the envisaged retention period;
   f. whether it is used for automated decision-making or profiling, and if so the logic involved.

4. NO SUPPRESSION-ONLY OUTCOME
If you retain a minimal suppression record to honour this objection, confirm that it is limited to what is strictly necessary for that purpose and is not used for any other processing.

TIME LIMIT
Article 12(3) GDPR requires a response without undue delay and in any event within one month of receipt. If you extend that period, you must tell me within the first month and give reasons.

IDENTITY VERIFICATION
If you genuinely cannot identify me from the details above, tell me precisely what further information you need. Under Article 12(6) GDPR you may ask for additional information only where you have reasonable doubts about my identity, and only what is necessary to confirm it. The European Data Protection Board considers a copy of an identity document generally disproportionate for this purpose (Guidelines 01/2022 on the right of access).

If you do not respond within the statutory period, or refuse without a valid basis, I will lodge a complaint with my supervisory authority under Article 77 GDPR.

Please confirm receipt of this request.

${FORWARD_EN}

Yours faithfully,
${signature(b, p, false)}
${longDate(todayISO(), false)}`
  },

  gdpr_erasure_nl: {
    label: 'AVG verwijderingsverzoek (NL)',
    jurisdiction: 'EU',
    subject: (b, p) => `Verzoek op grond van artikel 15, 17 en 21 AVG, ${subjectId(b, p)}`,
    body: (b, p, rec) => `Aan de Functionaris Gegevensbescherming / het privacyteam van ${b.name},

Ik ben betrokkene in de zin van de Algemene verordening gegevensbescherming (AVG / Verordening (EU) 2016/679). Hierbij doe ik een beroep op mijn rechten met betrekking tot alle persoonsgegevens die u over mij verwerkt.

Mijn kenmerk: ${refOf(b)}

IDENTIFICATIEGEGEVENS
${isEvidenceDerived(b) ? minimalBlock(b, true) : identityBlockNL(p)}
${keptNote(b, rec, true)}
Ik verzoek u het volgende.

1. VERWIJDERING (artikel 17 AVG)
Wis alle persoonsgegevens die u over mij verwerkt, inclusief gegevens die u van derden heeft verkregen, gegevens die u over mij heeft afgeleid of gegenereerd, en kopieën bij verwerkers die namens u handelen. Voor zover u deze gegevens openbaar heeft gemaakt of heeft doorgegeven, verplicht artikel 17, lid 2, u om de ontvangers van dit verzoek op de hoogte te stellen.

2. BEZWAAR (artikel 21 AVG)
Voor zover de verwerking berust op een gerechtvaardigd belang, maak ik daartegen bezwaar. Voor zover de verwerking plaatsvindt ten behoeve van direct marketing, geldt dit bezwaar absoluut: op grond van artikel 21, lid 3, dient u die verwerking zonder belangenafweging volledig te staken.

3. INZAGE (artikel 15 AVG)
Indien u stelt dat bepaalde gegevens niet gewist kunnen worden, verzoek ik u voor die gegevens op te geven:
   a. om welke categorieën persoonsgegevens het gaat;
   b. de precieze rechtsgrond en, indien van toepassing, de wettelijke bewaarplicht waarop u zich beroept;
   c. de bron waaruit u de gegevens heeft verkregen;
   d. de ontvangers of categorieën ontvangers aan wie de gegevens zijn verstrekt;
   e. de bewaartermijn;
   f. of de gegevens worden gebruikt voor geautomatiseerde besluitvorming of profilering, en zo ja, welke logica daaraan ten grondslag ligt.

TERMIJN
Op grond van artikel 12, lid 3, AVG dient u zonder onredelijke vertraging en in elk geval binnen één maand na ontvangst te reageren. Verlengt u die termijn, dan dient u mij daarvan binnen de eerste maand gemotiveerd op de hoogte te stellen.

IDENTIFICATIE
Kunt u mij werkelijk niet identificeren op basis van bovenstaande gegevens, geef dan precies aan welke aanvullende informatie u nodig heeft. Op grond van artikel 12, lid 6, AVG mag u alleen om aanvullende informatie vragen als u redelijke twijfel heeft over mijn identiteit, en alleen wat nodig is om die te bevestigen. Volgens de Europese toezichthouders (EDPB, richtsnoeren 01/2022 over het recht op inzage) is een kopie van een identiteitsbewijs daarvoor in de regel niet proportioneel.

Ontvang ik geen tijdige reactie, of wijst u het verzoek zonder geldige grond af, dan dien ik een klacht in bij de Autoriteit Persoonsgegevens op grond van artikel 77 AVG.

Graag ontvang ik een ontvangstbevestiging.

${FORWARD_NL}

Met vriendelijke groet,
${signature(b, p, true)}
${longDate(todayISO(), true)}`
  },

  // --- CCPA / CPRA ------------------------------------------------------------
  ccpa_delete: {
    label: 'CCPA/CPRA delete + opt out of sale',
    jurisdiction: 'US',
    subject: (b, p) => `CCPA/CPRA request to delete and to opt out of sale/sharing, ${subjectId(b, p)}`,
    body: (b, p) => `To the Privacy Team of ${b.name},

I am making a consumer rights request under the California Consumer Privacy Act as amended by the CPRA (Cal. Civ. Code § 1798.100 et seq.).

My reference for this request: ${refOf(b)}

IDENTIFYING DETAILS
${isEvidenceDerived(b) ? minimalBlock(b, false) : identityBlock(p)}

I request that you:

1. DELETE (§ 1798.105): delete all personal information you have collected about me, and direct your service providers, contractors and any third parties to whom you sold or disclosed it to do the same.

2. OPT OUT OF SALE AND SHARING (§ 1798.120, § 1798.121): stop selling or sharing my personal information, including for cross-context behavioural advertising, and limit any use of sensitive personal information to what § 1798.121 permits.

3. DISCLOSE (§ 1798.110, § 1798.115): tell me the categories of personal information you collected about me, the categories of sources, the business purpose for collecting or selling it, the categories of third parties to whom it was sold or disclosed, and the specific pieces of personal information you hold.

4. If you deny any part of this request, state the specific statutory exemption you rely on for each part denied.

You must respond within 45 days (§ 1798.130(a)(2)), extendable once by a further 45 days with notice to me.

Do not require me to create an account in order to make this request (§ 1798.130(a)(2)(B)), and do not discriminate against me for exercising these rights (§ 1798.125).

If I am outside California and you decline on that basis, treat this letter as a request under any equivalent right available to me, and tell me which one applies.

Yours faithfully,
${signature(b, p, false)}
${longDate(todayISO(), false)}`
  },

  // --- Follow-ups -------------------------------------------------------------
  reminder: {
    label: 'Reminder: deadline passed',
    jurisdiction: 'any',
    subject: (b, p) => `Overdue: request under Articles 15, 17 and 21 GDPR, ${subjectId(b, p)}`,
    body: (b, p, rec) => `To the Data Protection Officer / Privacy Team of ${b.name},

On ${rec?.sentAt ? longDate(rec.sentAt, false) : '[date]'} I sent you a request to erase my personal data and to stop processing it, under Articles 15, 17 and 21 GDPR. The ${rec?.extended ? 'extended period of three months' : 'one-month period'} set by Article 12(3) has now passed without an adequate response.

My reference for that request: ${refOf(b)}
${keptNote(b, rec, false)}
IDENTIFYING DETAILS
${isEvidenceDerived(b) ? minimalBlock(b, false) : identityBlock(p)}

This letter is a formal reminder. I ask you to confirm within 14 days that my data has been erased, or to state the specific legal ground on which you refuse.

Failure to respond is itself an infringement of Article 12(3) and (4). If I have not heard from you within 14 days, I will lodge a complaint with the supervisory authority under Article 77 GDPR and will refer to this correspondence.

${FORWARD_EN}

Yours faithfully,
${signature(b, p, false)}
${longDate(todayISO(), false)}`
  },

  complaint: {
    label: 'Complaint to the supervisory authority',
    jurisdiction: 'EU',
    subject: (b, p) => `Complaint under Article 77 GDPR concerning ${b.name}`,
    body: (b, p, rec) => `To the supervisory authority${p.country === 'NL' ? ' (Autoriteit Persoonsgegevens)' : ''},

I wish to lodge a complaint under Article 77 GDPR against ${b.name}${b.site ? ` (${b.site})` : ''}.

COMPLAINANT
${identityBlock(p)}

WHAT HAPPENED
On ${rec?.sentAt ? longDate(rec.sentAt, false) : '[date]'} I sent ${b.name} a request under Articles 15, 17 and 21 GDPR, asking them to erase my personal data, to stop processing it for direct marketing, and to disclose the source of any data they retain.

The statutory period under Article 12(3) expired on ${rec?.sentAt ? longDate(addDays(rec.sentAt, rec.extended ? 90 : 30), false) : '[date]'}. ${rec?.status === 'refused'
  ? 'The controller refused the request without providing an adequate legal basis.'
  : 'The controller has not responded, or has not responded adequately.'}${keptMailing(b, rec) ? ` The controller also kept sending me marketing email after ${keptMailing(b, rec).since === 'request' ? 'my request' : `I unsubscribed on ${longDate(keptMailing(b, rec).from, false)}`}, most recently on ${longDate(keptMailing(b, rec).last, false)}.` : ''}

WHY I AM COMPLAINING
The controller has infringed:
  - Article 12(3) GDPR, by failing to respond within one month;
  - Article 17(1) GDPR, by failing to erase personal data without undue delay;
  - Article 21(3) GDPR, insofar as processing for direct marketing continued after my objection.

WHAT I ASK
I ask the authority to investigate, to order the controller to comply with my request, and to consider whether enforcement action is appropriate.

ENCLOSURES
  - My original request of ${rec?.sentAt ? longDate(rec.sentAt, false) : '[date]'}
  - ${rec?.status === 'refused' ? 'The controller’s refusal' : 'Proof of delivery, and any reminder sent'}

Yours faithfully,
${p.fullName || '[your name]'}
${longDate(todayISO(), false)}`
  }
};

// Dutch escalation letters, so a Dutch user can go request → herinnering →
// klacht without switching language halfway.
TEMPLATES.reminder_nl = {
  label: 'Herinnering: termijn verstreken',
  jurisdiction: 'EU',
  subject: (b, p) => `Termijn verstreken: verzoek op grond van artikel 15, 17 en 21 AVG, ${subjectId(b, p)}`,
  body: (b, p, rec) => `Aan de Functionaris Gegevensbescherming / het privacyteam van ${b.name},

Op ${rec?.sentAt ? longDate(rec.sentAt, true) : '[datum]'} heb ik u verzocht mijn persoonsgegevens te wissen en de verwerking ervan te staken, op grond van artikel 15, 17 en 21 AVG. De ${rec?.extended ? 'verlengde termijn van drie maanden' : 'termijn van één maand'} uit artikel 12, lid 3, is inmiddels verstreken zonder toereikende reactie.

Mijn kenmerk bij dat verzoek: ${refOf(b)}
${keptNote(b, rec, true)}
IDENTIFICATIEGEGEVENS
${isEvidenceDerived(b) ? minimalBlock(b, true) : identityBlockNL(p)}

Dit is een formele herinnering. Ik verzoek u binnen 14 dagen te bevestigen dat mijn gegevens zijn gewist, of de specifieke wettelijke grond te noemen waarop u weigert.

Het uitblijven van een reactie is op zichzelf een schending van artikel 12, lid 3 en 4, AVG. Heb ik binnen 14 dagen niets van u vernomen, dan dien ik een klacht in bij de Autoriteit Persoonsgegevens op grond van artikel 77 AVG en verwijs ik naar deze correspondentie.

${FORWARD_NL}

Met vriendelijke groet,
${signature(b, p, true)}
${longDate(todayISO(), true)}`
};

TEMPLATES.complaint_nl = {
  label: 'Klacht bij de Autoriteit Persoonsgegevens',
  jurisdiction: 'EU',
  subject: (b, p) => `Klacht op grond van artikel 77 AVG over ${b.name}`,
  body: (b, p, rec) => `Aan de Autoriteit Persoonsgegevens,

Hierbij dien ik een klacht in op grond van artikel 77 AVG tegen ${b.name}${b.site ? ` (${b.site})` : ''}.

KLAGER
${identityBlockNL(p)}

WAT ER GEBEURDE
Op ${rec?.sentAt ? longDate(rec.sentAt, true) : '[datum]'} heb ik ${b.name} verzocht op grond van artikel 15, 17 en 21 AVG mijn persoonsgegevens te wissen, de verwerking voor direct marketing te staken en de bron te noemen van de gegevens die het over mij bewaart.

De wettelijke termijn uit artikel 12, lid 3, is verstreken op ${rec?.sentAt ? longDate(addDays(rec.sentAt, rec.extended ? 90 : 30), true) : '[datum]'}. ${rec?.status === 'refused'
  ? 'De verwerkingsverantwoordelijke heeft het verzoek geweigerd zonder toereikende rechtsgrond.'
  : 'De verwerkingsverantwoordelijke heeft niet, of niet toereikend, gereageerd.'}${keptMailing(b, rec) ? ` Daarnaast bleef de verwerkingsverantwoordelijke mij reclame sturen na ${keptMailing(b, rec).since === 'request' ? 'mijn verzoek' : `mijn afmelding op ${longDate(keptMailing(b, rec).from, true)}`}, voor het laatst op ${longDate(keptMailing(b, rec).last, true)}.` : ''}

WAAROM IK KLAAG
De verwerkingsverantwoordelijke heeft gehandeld in strijd met:
  - artikel 12, lid 3, AVG, door niet binnen één maand te reageren;
  - artikel 17, lid 1, AVG, door persoonsgegevens niet onverwijld te wissen;
  - artikel 21, lid 3, AVG, voor zover de verwerking voor direct marketing na mijn bezwaar is voortgezet.

WAT IK VRAAG
Ik verzoek de Autoriteit Persoonsgegevens dit te onderzoeken, de verwerkingsverantwoordelijke op te dragen aan mijn verzoek te voldoen, en te overwegen of handhaving passend is.

BIJLAGEN
  - Mijn oorspronkelijke verzoek van ${rec?.sentAt ? longDate(rec.sentAt, true) : '[datum]'}
  - ${rec?.status === 'refused' ? 'De weigering van de verwerkingsverantwoordelijke' : 'Bewijs van verzending, en de eventueel verstuurde herinnering'}

Met vriendelijke groet,
${p.fullName || '[naam]'}
${longDate(todayISO(), true)}`
};

// --- Existing customers ---------------------------------------------------------
//
// Telling your own phone company to erase you is a request it must refuse for
// everything the contract needs, and one it may act on by closing the account.
// What a customer actually wants is narrower: no marketing, nothing kept that
// the service does not need, nothing passed on. That is enforceable as it stands.

const breachNote = (b, nl) => b.source !== 'breach' ? '' : nl
  ? `\nUw organisatie is getroffen door een datalek waarbij klantgegevens zijn buitgemaakt. Dat maakt het des te belangrijker dat u niet meer bewaart dan strikt noodzakelijk (artikel 5, lid 1, onder c en e, AVG).\n`
  : `\nYour organisation has suffered a data breach involving customer data. That makes it all the more important that you keep no more than is strictly necessary (Article 5(1)(c) and (e) GDPR).\n`;

TEMPLATES.customer_minimise = {
  label: 'Existing customer: stop marketing, keep only what is needed',
  jurisdiction: 'EU',
  subject: (b, p) => `Request under Articles 15, 17 and 21 GDPR (existing customer), ${subjectId(b, p)}`,
  body: (b, p, rec) => `To the Data Protection Officer / Privacy Team of ${b.name},

I am a customer of yours and I intend to remain one. This is not a request to close my account or end any contract.

My reference for this request: ${refOf(b)}

IDENTIFYING DETAILS
${isEvidenceDerived(b) ? minimalBlock(b, false) : identityBlock(p)}
${breachNote(b, false)}${keptNote(b, rec, false)}
I ask you to:

1. Stop processing my personal data for direct marketing, including profiling for that purpose, by email, phone, text, post or online advertising (Article 21(2) and (3) GDPR). This objection is unconditional.

2. Erase all personal data you no longer need to provide your service to me or to meet a legal obligation, for example data from past contracts or orders beyond their retention period, usage and browsing profiles, and data obtained from third parties (Article 17(1)(a) and (c) GDPR).

3. Stop passing my personal data to third parties for their own purposes, and tell me which recipients you have disclosed it to so far (Articles 15(1)(c) and 19 GDPR).

4. Tell me which personal data you keep about me, for what purpose, and for how long (Article 15(1) GDPR).

Please respond within one month, as Article 12(3) GDPR requires.

${FORWARD_EN}

Yours faithfully,
${signature(b, p, false)}
${longDate(todayISO(), false)}`
};

TEMPLATES.customer_minimise_nl = {
  label: 'Bestaande klant: geen marketing, alleen bewaren wat nodig is',
  jurisdiction: 'EU',
  subject: (b, p) => `Verzoek op grond van artikel 15, 17 en 21 AVG (bestaande klant), ${subjectId(b, p)}`,
  body: (b, p, rec) => `Aan de Functionaris Gegevensbescherming / het privacyteam van ${b.name},

Ik ben klant bij u en wil dat blijven. Dit is geen verzoek om mijn account op te heffen of een overeenkomst te beëindigen.

Mijn kenmerk: ${refOf(b)}

IDENTIFICATIEGEGEVENS
${isEvidenceDerived(b) ? minimalBlock(b, true) : identityBlockNL(p)}
${breachNote(b, true)}${keptNote(b, rec, true)}
Ik verzoek u:

1. Mijn persoonsgegevens niet langer te verwerken voor direct marketing, inclusief profilering voor dat doel, via e-mail, telefoon, sms, post of online advertenties (artikel 21, lid 2 en 3, AVG). Dit bezwaar is onvoorwaardelijk.

2. Alle persoonsgegevens te wissen die u niet meer nodig heeft om uw dienst aan mij te leveren of om aan een wettelijke plicht te voldoen, bijvoorbeeld gegevens van eerdere contracten of bestellingen waarvan de bewaartermijn is verstreken, gebruiks- en surfprofielen, en gegevens die u van derden heeft verkregen (artikel 17, lid 1, onder a en c, AVG).

3. Mijn persoonsgegevens niet langer aan derden te verstrekken voor hun eigen doeleinden, en mij te laten weten aan welke ontvangers u ze tot nu toe heeft verstrekt (artikel 15, lid 1, onder c, en artikel 19 AVG).

4. Mij te laten weten welke persoonsgegevens u van mij bewaart, voor welk doel en hoe lang (artikel 15, lid 1, AVG).

Ik verzoek u binnen één maand te reageren, zoals artikel 12, lid 3, AVG voorschrijft.

${FORWARD_NL}

Met vriendelijke groet,
${signature(b, p, true)}
${longDate(todayISO(), true)}`
};

// --- Answers to their answer -------------------------------------------------------
//
// The usual ways a company stalls a request, each with the reply the law
// supports: a demand for a copy of an ID, an insistence on its own web form,
// "we must keep it by law" without saying what, and "we have nothing on you"
// from a company whose mail reached the user.

export const lastAnswer = rec => (rec?.replies || []).at(-1) || null;

function idLines(b, p, nl) {
  if (!isEvidenceDerived(b)) return nl ? identityBlockNL(p) : identityBlock(p);
  const lines = evidenceLines(b, nl);
  return lines.length ? lines.map(([k, v]) => `${k}: ${v}`).join('\n')
    : nl ? 'E-mailadres: [vul het adres in waarop u hun bericht ontving]' : 'Email address: [fill in the address their message reached you on]';
}

function answerSubject(b, p, rec, nl) {
  const theirs = String(lastAnswer(rec)?.subject || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 150);
  if (theirs) return /^(re|antw|aw|sv)\s*:/i.test(theirs) ? theirs : `Re: ${theirs}`;
  return `Re: ${nl ? `Verzoek op grond van artikel 15, 17 en 21 AVG, ${subjectId(b, p)}` : `Request under Articles 15, 17 and 21 GDPR, ${subjectId(b, p)}`}`;
}

const opening = (b, rec, nl, what) => nl
  ? `Aan de Functionaris Gegevensbescherming / het privacyteam van ${b.name},

Mijn kenmerk: ${refOf(b)}

Op ${rec?.sentAt ? longDate(rec.sentAt, true) : '[datum]'} heb ik u op grond van de AVG verzocht mijn persoonsgegevens te wissen en niet langer te gebruiken. Op ${lastAnswer(rec)?.at ? longDate(lastAnswer(rec).at, true) : '[datum]'} antwoordde u ${what}.`
  : `To the Data Protection Officer / Privacy Team of ${b.name},

My reference: ${refOf(b)}

On ${rec?.sentAt ? longDate(rec.sentAt, false) : '[date]'} I asked you, under the GDPR, to erase my personal data and to stop using it. On ${lastAnswer(rec)?.at ? longDate(lastAnswer(rec).at, false) : '[date]'} you replied ${what}.`;

const closing = (b, p, nl) => nl
  ? `Met vriendelijke groet,
${signature(b, p, true)}
${longDate(todayISO(), true)}`
  : `Yours faithfully,
${signature(b, p, false)}
${longDate(todayISO(), false)}`;

TEMPLATES.reply_id = {
  label: 'Their answer: they want a copy of your ID',
  jurisdiction: 'EU',
  subject: (b, p, rec) => answerSubject(b, p, rec, false),
  body: (b, p, rec) => `${opening(b, rec, false, 'that you first need a copy of my identity document')}

I will not send one, because it is not necessary. Under Article 12(6) GDPR you may ask for additional information only where you have reasonable doubts about my identity, and only what is necessary to resolve them. You know me by the details below, which come from your own messages to me, and my request was sent from that address. You can confirm that it is mine by writing to it.

The European Data Protection Board considers a copy of an identity document generally inappropriate for this purpose, because it creates a security risk of its own (Guidelines 01/2022 on the right of access). The Dutch Data Protection Authority fined DPG Media in 2022 for routinely demanding one with requests like mine.

IDENTIFYING DETAILS
${idLines(b, p, false)}

If you have a specific doubt about my identity, tell me what it is and what you need to resolve it. Otherwise, please carry out my request and confirm it to me within the time limit of Article 12(3) GDPR.

${closing(b, p, false)}`
};

TEMPLATES.reply_id_nl = {
  label: 'Hun antwoord: ze willen een kopie van je identiteitsbewijs',
  jurisdiction: 'EU',
  subject: (b, p, rec) => answerSubject(b, p, rec, true),
  body: (b, p, rec) => `${opening(b, rec, true, 'dat u eerst een kopie van mijn identiteitsbewijs nodig heeft')}

Die stuur ik niet, omdat het niet nodig is. Op grond van artikel 12, lid 6, AVG mag u alleen om aanvullende gegevens vragen als u redelijke twijfel heeft over mijn identiteit, en dan alleen wat nodig is om die twijfel weg te nemen. U kent mij aan de hand van de gegevens hieronder, die uit uw eigen berichten aan mij komen, en mijn verzoek is vanaf dat adres verstuurd. U kunt controleren dat het van mij is door ernaar te schrijven.

Volgens de Europese toezichthouders (EDPB, richtsnoeren 01/2022 over het recht op inzage) is een kopie van een identiteitsbewijs daarvoor in de regel niet passend, omdat die zelf een beveiligingsrisico oplevert. De Autoriteit Persoonsgegevens heeft DPG Media in 2022 beboet omdat het bij verzoeken zoals het mijne standaard om een kopie vroeg.

IDENTIFICATIEGEGEVENS
${idLines(b, p, true)}

Heeft u een concrete twijfel over mijn identiteit, laat mij dan weten welke twijfel dat is en wat u nodig heeft om die weg te nemen. Zo niet, voer dan mijn verzoek uit en bevestig dat binnen de termijn van artikel 12, lid 3, AVG.

${closing(b, p, true)}`
};

TEMPLATES.reply_form = {
  label: 'Their answer: they want you to use their web form',
  jurisdiction: 'EU',
  subject: (b, p, rec) => answerSubject(b, p, rec, false),
  body: (b, p, rec) => `${opening(b, rec, false, 'that I should submit it through your web form or portal')}

That is not required. The GDPR prescribes no form for a request. You may offer one, but a request that reaches you through another channel you provide, such as the email address I wrote to, is just as valid, and you must facilitate it (Article 12(2) GDPR; EDPB Guidelines 01/2022 on the right of access). The time limit runs from the day you received it.

My request stands as I sent it. If your form needs details from me, copy them from my email, or tell me which specific detail is missing.

IDENTIFYING DETAILS
${idLines(b, p, false)}

Please carry out my request and confirm it to me within the time limit of Article 12(3) GDPR.

${closing(b, p, false)}`
};

TEMPLATES.reply_form_nl = {
  label: 'Hun antwoord: ze willen dat je hun webformulier gebruikt',
  jurisdiction: 'EU',
  subject: (b, p, rec) => answerSubject(b, p, rec, true),
  body: (b, p, rec) => `${opening(b, rec, true, 'dat ik het verzoek via uw webformulier of portaal moet indienen')}

Dat is niet vereist. De AVG schrijft geen vorm voor een verzoek voor. U mag een formulier aanbieden, maar een verzoek dat via een ander kanaal van u binnenkomt, zoals het e-mailadres waaraan ik schreef, is net zo geldig, en u moet het faciliteren (artikel 12, lid 2, AVG; EDPB-richtsnoeren 01/2022 over het recht op inzage). De termijn loopt vanaf de dag van ontvangst.

Mijn verzoek blijft staan zoals ik het verstuurde. Heeft uw formulier gegevens van mij nodig, neem die dan over uit mijn e-mail, of laat mij weten welk gegeven precies ontbreekt.

IDENTIFICATIEGEGEVENS
${idLines(b, p, true)}

Voer mijn verzoek uit en bevestig dat binnen de termijn van artikel 12, lid 3, AVG.

${closing(b, p, true)}`
};

TEMPLATES.reply_retain = {
  label: 'Their answer: they must keep some of it by law',
  jurisdiction: 'EU',
  subject: (b, p, rec) => answerSubject(b, p, rec, false),
  body: (b, p, rec) => `${opening(b, rec, false, 'that you must keep some of it because of a legal obligation')}

Article 17(3)(b) GDPR allows that only for the data the obligation actually covers, only for as long as it applies, and only for that purpose (Article 5(1)(b) and (e)). Under Article 12(4) you must give reasons for any part of my request you do not carry out. So please tell me, for each category of data you keep:
   a. which data it is;
   b. which legal provision requires you to keep it;
   c. until when you will keep it.

Please also confirm that:
   - you have erased all my other personal data;
   - you use the data you keep for that legal obligation only: no marketing, no profiling, and you do not pass it on;
   - you will erase it when the retention period ends.

IDENTIFYING DETAILS
${idLines(b, p, false)}

${closing(b, p, false)}`
};

TEMPLATES.reply_retain_nl = {
  label: 'Hun antwoord: ze moeten iets wettelijk bewaren',
  jurisdiction: 'EU',
  subject: (b, p, rec) => answerSubject(b, p, rec, true),
  body: (b, p, rec) => `${opening(b, rec, true, 'dat u een deel ervan moet bewaren vanwege een wettelijke verplichting')}

Artikel 17, lid 3, onder b, AVG staat dat alleen toe voor de gegevens waarop die verplichting echt ziet, alleen zolang die geldt, en alleen voor dat doel (artikel 5, lid 1, onder b en e). Op grond van artikel 12, lid 4, moet u motiveren welk deel van mijn verzoek u niet uitvoert. Ik verzoek u daarom per categorie gegevens die u bewaart op te geven:
   a. om welke gegevens het gaat;
   b. welk wetsartikel u verplicht ze te bewaren;
   c. tot wanneer u ze bewaart.

Ik verzoek u ook te bevestigen dat:
   - u al mijn overige persoonsgegevens heeft gewist;
   - u de bewaarde gegevens alleen voor die wettelijke verplichting gebruikt, niet voor marketing of profilering, en ze niet aan anderen verstrekt;
   - u ze wist zodra de bewaartermijn verstreken is.

IDENTIFICATIEGEGEVENS
${idLines(b, p, true)}

${closing(b, p, true)}`
};

// Only fair when their own mail shows they had the address; the app offers it
// only then, and says so in the letter.
const mailedNote = (b, nl) => {
  const a = b.evidence?.address;
  if (b.source !== 'mail' || !a) return '';
  const last = b.lastBulkAt ? (nl ? `, voor het laatst op ${longDate(b.lastBulkAt, true)}` : `, most recently on ${longDate(b.lastBulkAt, false)}`) : '';
  return nl
    ? `\n\nToch bereikten uw eigen berichten mij op ${a}${last}. U had dus ten minste dat adres, en mogelijk meer bij een maildienst die u gebruikt.`
    : `\n\nYet your own messages reached me at ${a}${last}. So you held at least that address, and possibly more with a mailing service you use.`;
};

TEMPLATES.reply_nodata = {
  label: 'Their answer: they say they hold nothing on you',
  jurisdiction: 'EU',
  subject: (b, p, rec) => answerSubject(b, p, rec, false),
  body: (b, p, rec) => `${opening(b, rec, false, 'that you hold no personal data about me')}${mailedNote(b, false)}

Please check again, including your mailing lists and any service that sends mail on your behalf, and confirm:
   a. that the details below are erased everywhere, including with your processors (Articles 17 and 28 GDPR);
   b. where you obtained them, if not from me (Article 15(1)(g) GDPR);
   c. to whom you passed them on (Article 15(1)(c) GDPR).

IDENTIFYING DETAILS
${idLines(b, p, false)}

${closing(b, p, false)}`
};

TEMPLATES.reply_nodata_nl = {
  label: 'Hun antwoord: ze zeggen niets van je te hebben',
  jurisdiction: 'EU',
  subject: (b, p, rec) => answerSubject(b, p, rec, true),
  body: (b, p, rec) => `${opening(b, rec, true, 'dat u geen persoonsgegevens van mij verwerkt')}${mailedNote(b, true)}

Ik verzoek u opnieuw te zoeken, ook in uw mailinglijsten en bij diensten die namens u mail versturen, en te bevestigen:
   a. dat de gegevens hieronder overal zijn gewist, ook bij uw verwerkers (artikel 17 en 28 AVG);
   b. waar u ze vandaan heeft, als u ze niet van mij kreeg (artikel 15, lid 1, onder g, AVG);
   c. aan wie u ze heeft verstrekt (artikel 15, lid 1, onder c, AVG).

IDENTIFICATIEGEGEVENS
${idLines(b, p, true)}

${closing(b, p, true)}`
};

// Which reply an answer calls for. 'partial' (erased, except what the law
// makes them keep) and 'nodata' are outcomes, so their reply is optional.
export const REPLY_FOR = { id: 'reply_id', form: 'reply_form', retain: 'reply_retain', partial: 'reply_retain', nodata: 'reply_nodata' };
export const PUSHBACK = new Set(['id', 'form', 'retain']);

// --- Which letter, in which language ---------------------------------------------

// 'auto' follows the interface: someone using the app in Dutch gets Dutch letters.
export function letterLang(profile) {
  const l = profile?.letterLanguage;
  return l === 'en' || l === 'nl' ? l : lang();
}

const isEU = b => ['EU', 'NL', 'UK', 'BE'].some(r => (b.regions || []).includes(r));

// A Dutch letter to Acxiom's US privacy desk is a letter nobody there reads.
// Dutch goes to companies found in the user's own evidence (they mailed, called
// or leaked a Dutch user) and to brokers operating in the Netherlands or Belgium.
export function writesDutch(b, profile) {
  if (letterLang(profile) !== 'nl') return false;
  return !!b.source || (b.regions || []).some(r => r === 'NL' || r === 'BE');
}

// How the user relates to a company, guessed from where it came from; the user
// can correct it. 'none' = no reason to hold their data, 'maybe' = may have
// signed up once, 'customer' = a provider they actually use.
export function guessRelation(b) {
  if (!b.source) return 'none';                 // bundled data broker
  if (b.source === 'phone') return 'none';      // cold call or text
  if (b.source === 'breach') return 'customer'; // breach notices come from services you had an account with
  if (b.source === 'mail') {
    if (b.trust !== 'verified') return 'none';  // marketing from a sender that could not be checked
    // Verified mail with no unsubscribe at all is transactional (an order,
    // an invoice, an account notice), which only goes to customers. One such
    // message counts even when the same company also sends marketing.
    return (b.unsubUrl || b.unsubMailto) && !b.transactional ? 'maybe' : 'customer';
  }
  return 'maybe';
}
export const relationOf = (b, rec) => rec?.relation || guessRelation(b);
export const RELATION_ORDER = { none: 0, maybe: 1, customer: 2 };

export function templateFor(kind, b, profile, rec) {
  const nl = writesDutch(b, profile);
  if (kind === 'reminder') return nl && isEU(b) ? 'reminder_nl' : 'reminder';
  if (kind === 'complaint') return letterLang(profile) === 'nl' ? 'complaint_nl' : 'complaint';
  if (kind === 'reply') {
    const t = REPLY_FOR[lastAnswer(rec)?.kind];
    if (t) return nl ? t + '_nl' : t;
  }
  return suggestedTemplate(b, profile, rec);
}

// Template labels as shown in the picker, per interface language.
export const TEMPLATE_LABELS_NL = {
  gdpr_erasure: 'AVG-verwijderverzoek (Engels)',
  gdpr_erasure_nl: 'AVG-verwijderverzoek (Nederlands)',
  ccpa_delete: 'CCPA/CPRA-verzoek (Californië, Engels)',
  reminder: 'Herinnering (Engels)',
  reminder_nl: 'Herinnering (Nederlands)',
  complaint: 'Klacht bij de toezichthouder (Engels)',
  complaint_nl: 'Klacht bij de Autoriteit Persoonsgegevens (Nederlands)',
  customer_minimise: 'Bestaande klant: geen marketing, alleen het nodige bewaren (Engels)',
  customer_minimise_nl: 'Bestaande klant: geen marketing, alleen het nodige bewaren (Nederlands)',
  reply_id: 'Antwoord: ze willen een kopie ID (Engels)',
  reply_id_nl: 'Antwoord: ze willen een kopie ID (Nederlands)',
  reply_form: 'Antwoord: ze willen hun webformulier (Engels)',
  reply_form_nl: 'Antwoord: ze willen hun webformulier (Nederlands)',
  reply_retain: 'Antwoord: ze moeten iets wettelijk bewaren (Engels)',
  reply_retain_nl: 'Antwoord: ze moeten iets wettelijk bewaren (Nederlands)',
  reply_nodata: 'Antwoord: ze zeggen niets te hebben (Engels)',
  reply_nodata_nl: 'Antwoord: ze zeggen niets te hebben (Nederlands)'
};

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function suggestedTemplate(broker, profile, rec) {
  const nl = writesDutch(broker, profile);
  if (isEU(broker) && relationOf(broker, rec) === 'customer') return nl ? 'customer_minimise_nl' : 'customer_minimise';
  if (isEU(broker)) return nl ? 'gdpr_erasure_nl' : 'gdpr_erasure';
  // A US-only broker still has to handle a GDPR request if it targets EU residents,
  // but a CCPA request is the one it has a process for, so lead with that.
  return 'ccpa_delete';
}

export function render(templateId, broker, profile, record) {
  const t = TEMPLATES[templateId];
  if (!t) throw new Error('Unknown template: ' + templateId);
  return { subject: t.subject(broker, profile, record), body: t.body(broker, profile, record) };
}
