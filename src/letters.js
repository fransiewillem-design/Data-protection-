// Request letter templates. Kept as plain functions so they are easy to edit.

function identityBlock(p) {
  const lines = [];
  if (p.fullName) lines.push(`Full name: ${p.fullName}`);
  if (p.birthDate) lines.push(`Date of birth: ${p.birthDate}`);
  if (p.emails?.length) lines.push(`Email address(es): ${p.emails.join(', ')}`);
  if (p.phones?.length) lines.push(`Phone number(s): ${p.phones.join(', ')}`);
  if (p.addresses) lines.push(`Postal address: ${p.addresses.replace(/\n/g, ', ')}`);
  return lines.length ? lines.join('\n') : '[Fill in your details on the "Your details" page]';
}

function identityBlockNL(p) {
  const lines = [];
  if (p.fullName) lines.push(`Volledige naam: ${p.fullName}`);
  if (p.birthDate) lines.push(`Geboortedatum: ${p.birthDate}`);
  if (p.emails?.length) lines.push(`E-mailadres(sen): ${p.emails.join(', ')}`);
  if (p.phones?.length) lines.push(`Telefoonnummer(s): ${p.phones.join(', ')}`);
  if (p.addresses) lines.push(`Postadres: ${p.addresses.replace(/\n/g, ', ')}`);
  return lines.length ? lines.join('\n') : '[Vul je gegevens in op de pagina "Your details"]';
}

const ref = () => 'DR-' + Math.random().toString(36).slice(2, 7).toUpperCase();

export const TEMPLATES = {
  // --- GDPR: erasure + access + objection in one letter -----------------------
  gdpr_erasure: {
    label: 'GDPR erasure (Art. 17 + 15 + 21)',
    jurisdiction: 'EU',
    subject: (b, p) => `Request under Articles 15, 17 and 21 GDPR — ${p.fullName || '[your name]'}`,
    body: (b, p) => `To the Data Protection Officer / Privacy Team of ${b.name},

I am a data subject within the meaning of Regulation (EU) 2016/679 (GDPR). I am writing to exercise my rights in respect of all personal data you hold about me.

My reference for this request: ${ref()}

IDENTIFYING DETAILS
${identityBlock(p)}

I request that you do the following.

1. ERASURE — Article 17 GDPR
Erase all personal data you hold concerning me, including data obtained from third parties, data inferred or derived about me, and any copies held by processors acting on your behalf. Where you have made this data public or transferred it onwards, Article 17(2) requires you to inform the recipients of this erasure request.

2. OBJECTION — Article 21 GDPR
Insofar as any processing relies on legitimate interests, I object to that processing. Where the processing is for direct marketing purposes, Article 21(3) gives this objection absolute effect: you must stop that processing entirely, without weighing interests.

3. ACCESS — Article 15 GDPR
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
If you genuinely cannot identify me from the details above, tell me precisely what further information you need. Please note Article 12(2) and Recital 64: you may not collect additional personal data solely to make it harder to exercise these rights, and a demand for a scan of my passport or ID document is disproportionate for a request of this kind.

If you do not respond within the statutory period, or refuse without a valid basis, I will lodge a complaint with my supervisory authority under Article 77 GDPR.

Please confirm receipt of this request.

Yours faithfully,
${p.fullName || '[your name]'}
${new Date().toISOString().slice(0, 10)}`
  },

  gdpr_erasure_nl: {
    label: 'AVG verwijderingsverzoek (NL)',
    jurisdiction: 'EU',
    subject: (b, p) => `Verzoek op grond van artikel 15, 17 en 21 AVG — ${p.fullName || '[naam]'}`,
    body: (b, p) => `Aan de Functionaris Gegevensbescherming / Privacy Team van ${b.name},

Ik ben betrokkene in de zin van de Algemene verordening gegevensbescherming (AVG / Verordening (EU) 2016/679). Hierbij doe ik een beroep op mijn rechten met betrekking tot alle persoonsgegevens die u over mij verwerkt.

Mijn kenmerk: ${ref()}

IDENTIFICATIEGEGEVENS
${identityBlockNL(p)}

Ik verzoek u het volgende.

1. VERWIJDERING — artikel 17 AVG
Wis alle persoonsgegevens die u over mij verwerkt, inclusief gegevens die u van derden hebt verkregen, gegevens die u over mij hebt afgeleid of gegenereerd, en kopieën bij verwerkers die namens u handelen. Voor zover u deze gegevens openbaar hebt gemaakt of hebt doorgegeven, verplicht artikel 17, lid 2, u om de ontvangers van dit verzoek op de hoogte te stellen.

2. BEZWAAR — artikel 21 AVG
Voor zover de verwerking berust op een gerechtvaardigd belang, maak ik daartegen bezwaar. Voor zover de verwerking plaatsvindt ten behoeve van direct marketing, geldt dit bezwaar absoluut: op grond van artikel 21, lid 3, dient u die verwerking zonder belangenafweging volledig te staken.

3. INZAGE — artikel 15 AVG
Indien u stelt dat bepaalde gegevens niet gewist kunnen worden, verzoek ik u voor die gegevens op te geven:
   a. om welke categorieën persoonsgegevens het gaat;
   b. de precieze rechtsgrond en, indien van toepassing, de wettelijke bewaarplicht waarop u zich beroept;
   c. de bron waaruit u de gegevens hebt verkregen;
   d. de ontvangers of categorieën ontvangers aan wie de gegevens zijn verstrekt;
   e. de bewaartermijn;
   f. of de gegevens worden gebruikt voor geautomatiseerde besluitvorming of profilering, en zo ja, welke logica daaraan ten grondslag ligt.

TERMIJN
Op grond van artikel 12, lid 3, AVG dient u zonder onredelijke vertraging en in elk geval binnen één maand na ontvangst te reageren. Verlengt u die termijn, dan dient u mij daarvan binnen de eerste maand gemotiveerd op de hoogte te stellen.

IDENTIFICATIE
Kunt u mij werkelijk niet identificeren op basis van bovenstaande gegevens, geef dan precies aan welke aanvullende informatie u nodig hebt. Ik wijs u op artikel 12, lid 2, en overweging 64 AVG: u mag niet louter extra persoonsgegevens verzamelen om de uitoefening van deze rechten te bemoeilijken. Het opvragen van een kopie van mijn identiteitsbewijs is voor een verzoek als dit niet proportioneel.

Ontvang ik geen tijdige reactie, of wijst u het verzoek zonder geldige grond af, dan dien ik een klacht in bij de Autoriteit Persoonsgegevens op grond van artikel 77 AVG.

Graag ontvang ik een ontvangstbevestiging.

Met vriendelijke groet,
${p.fullName || '[naam]'}
${new Date().toISOString().slice(0, 10)}`
  },

  // --- CCPA / CPRA ------------------------------------------------------------
  ccpa_delete: {
    label: 'CCPA/CPRA delete + opt out of sale',
    jurisdiction: 'US',
    subject: (b, p) => `CCPA/CPRA request to delete and to opt out of sale/sharing — ${p.fullName || '[your name]'}`,
    body: (b, p) => `To the Privacy Team of ${b.name},

I am making a consumer rights request under the California Consumer Privacy Act as amended by the CPRA (Cal. Civ. Code § 1798.100 et seq.).

My reference for this request: ${ref()}

IDENTIFYING DETAILS
${identityBlock(p)}

I request that you:

1. DELETE (§ 1798.105) — delete all personal information you have collected about me, and direct your service providers, contractors and any third parties to whom you sold or disclosed it to do the same.

2. OPT OUT OF SALE AND SHARING (§ 1798.120, § 1798.121) — stop selling or sharing my personal information, including for cross-context behavioural advertising, and limit any use of sensitive personal information to what § 1798.121 permits.

3. DISCLOSE (§ 1798.110, § 1798.115) — tell me the categories of personal information you collected about me, the categories of sources, the business purpose for collecting or selling it, the categories of third parties to whom it was sold or disclosed, and the specific pieces of personal information you hold.

4. If you deny any part of this request, state the specific statutory exemption you rely on for each part denied.

You must respond within 45 days (§ 1798.130(a)(2)), extendable once by a further 45 days with notice to me.

Do not require me to create an account in order to make this request (§ 1798.130(a)(2)(B)), and do not discriminate against me for exercising these rights (§ 1798.125).

If I am outside California and you decline on that basis, treat this letter as a request under any equivalent right available to me, and tell me which one applies.

Yours faithfully,
${p.fullName || '[your name]'}
${new Date().toISOString().slice(0, 10)}`
  },

  // --- Follow-ups -------------------------------------------------------------
  reminder: {
    label: 'Reminder — deadline passed',
    jurisdiction: 'any',
    subject: (b, p) => `Overdue: request under Articles 15, 17 and 21 GDPR — ${p.fullName || '[your name]'}`,
    body: (b, p, rec) => `To the Data Protection Officer / Privacy Team of ${b.name},

On ${rec?.sentAt || '[date]'} I sent you a request to erase my personal data and to stop processing it, under Articles 15, 17 and 21 GDPR. The one-month period set by Article 12(3) has now passed without an adequate response.

IDENTIFYING DETAILS
${identityBlock(p)}

This letter is a formal reminder. I ask you to confirm within 14 days that my data has been erased, or to state the specific legal ground on which you refuse.

Failure to respond is itself an infringement of Article 12(3) and (4). If I have not heard from you within 14 days, I will lodge a complaint with the supervisory authority under Article 77 GDPR and will refer to this correspondence.

Yours faithfully,
${p.fullName || '[your name]'}
${new Date().toISOString().slice(0, 10)}`
  },

  complaint: {
    label: 'Complaint to the supervisory authority',
    jurisdiction: 'EU',
    subject: (b, p) => `Complaint under Article 77 GDPR concerning ${b.name}`,
    body: (b, p, rec) => `To the supervisory authority${p.country === 'NL' ? ' (Autoriteit Persoonsgegevens)' : ''},

I wish to lodge a complaint under Article 77 GDPR against ${b.name} (${b.site || ''}).

COMPLAINANT
${identityBlock(p)}

WHAT HAPPENED
On ${rec?.sentAt || '[date]'} I sent ${b.name} a request under Articles 15, 17 and 21 GDPR, asking them to erase my personal data, to stop processing it for direct marketing, and to disclose the source of any data they retain.

The statutory period under Article 12(3) expired on ${rec?.sentAt ? addDays(rec.sentAt, 30) : '[date]'}. ${rec?.status === 'refused'
  ? 'The controller refused the request without providing an adequate legal basis.'
  : 'The controller has not responded, or has not responded adequately.'}

WHY I AM COMPLAINING
The controller has infringed:
  - Article 12(3) GDPR, by failing to respond within one month;
  - Article 17(1) GDPR, by failing to erase personal data without undue delay;
  - Article 21(3) GDPR, insofar as processing for direct marketing continued after my objection.

WHAT I ASK
I ask the authority to investigate, to order the controller to comply with my request, and to consider whether enforcement action is appropriate.

ENCLOSURES
  - My original request of ${rec?.sentAt || '[date]'}
  - ${rec?.status === 'refused' ? 'The controller’s refusal' : 'Proof of delivery, and any reminder sent'}

Yours faithfully,
${p.fullName || '[your name]'}
${new Date().toISOString().slice(0, 10)}`
  }
};

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function suggestedTemplate(broker, profile) {
  const eu = broker.regions.includes('EU') || broker.regions.includes('NL') || broker.regions.includes('UK');
  if (eu) return profile.language === 'nl' ? 'gdpr_erasure_nl' : 'gdpr_erasure';
  // A US-only broker still has to handle a GDPR request if it targets EU residents,
  // but a CCPA request is the one it has a process for, so lead with that.
  return 'ccpa_delete';
}

export function render(templateId, broker, profile, record) {
  const t = TEMPLATES[templateId];
  if (!t) throw new Error('Unknown template: ' + templateId);
  return { subject: t.subject(broker, profile), body: t.body(broker, profile, record) };
}
