// The plan for moving away from an address the user decided to let go: in an
// order that loses nothing. The erasure letters go out while the old address
// still receives the replies, the accounts that matter move first, mail is
// forwarded for a while, and the address is only retired once nothing but
// spam arrives there. Each step can be ticked off; moving takes weeks.

import { L } from './i18n.js';
import { esc } from './views.js';

const ISP = /^(ziggo|kpnmail|kpnplanet|planet|home|xs4all|hetnet|chello|upcmail|quicknet|online|tele2|telfort|caiway|zeelandnet|solcon)\.nl$|^(telenet|skynet)\.be$/i;

export function providerOf(address) {
  const d = String(address).split('@')[1] || '';
  if (/^(outlook|hotmail|live|msn)\./i.test(d)) return 'microsoft';
  if (/^(gmail|googlemail)\./i.test(d)) return 'google';
  if (/^(icloud|me|mac)\./i.test(d)) return 'apple';
  if (ISP.test(d)) return 'isp';
  return 'other';
}

export const MOVE_STEPS = ['new', 'letters', 'inventory', 'important', 'people', 'forward', 'keep', 'check', 'retire'];

const copy = (text, label) =>
  `<button type="button" class="copy-chip" data-action="copy-text" data-text="${esc(text)}">${esc(label || text)}</button>`;

// retire: the provider-specific steps for the last step, from Home.
export function moveGuide(h, { done = [], letters = 0, retire = [] }) {
  const a = h.address;
  const kind = providerOf(a);
  const code = `<code>${esc(a)}</code>`;
  const names = h.real.map(esc).join(', ');
  const sameAccount = kind === 'microsoft' || kind === 'apple';

  const steps = {
    new: [L('Make the new address', 'Maak het nieuwe adres'), {
      microsoft: L('Add it to the same Microsoft account, so your mail, contacts and OneDrive stay where they are: <b>account.microsoft.com</b> → <b>Your info</b> → <b>Manage how you sign in</b> → <b>Add email</b> → <b>Create a new email address and add it as an alias</b>. Then choose <b>Make primary</b> next to the new address.',
        'Voeg het toe aan hetzelfde Microsoft-account, dan blijven je mail, contacten en OneDrive gewoon staan: <b>account.microsoft.com</b> → <b>Jouw info</b> → <b>Beheren hoe je je aanmeldt</b> → <b>E-mail toevoegen</b> → <b>Een nieuw e-mailadres maken en toevoegen als alias</b>. Kies daarna <b>Primair maken</b> bij het nieuwe adres.'),
      google: L('Gmail cannot rename an address, so make a new one: a new Google account, or an address at another provider. Keep the old Google account itself: it holds your Drive, Photos and purchases, and some sites use it to sign you in.',
        'Gmail kan een adres niet hernoemen, dus maak een nieuw: een nieuw Google-account, of een adres bij een andere aanbieder. Houd het oude Google-account zelf aan: daar staan je Drive, Foto\'s en aankopen, en sommige sites gebruiken het om je in te laten loggen.'),
      apple: L('Your main iCloud address cannot be removed, but you can stop using it. With iCloud+ you can add an iCloud Mail alias (<b>icloud.com</b> → <b>Mail</b> → <b>Settings</b> → <b>Accounts</b> → <b>Add alias</b>); it arrives in the same mailbox, so nothing has to move.',
        'Je hoofdadres bij iCloud kun je niet verwijderen, maar je kunt stoppen het te gebruiken. Met iCloud+ voeg je een iCloud Mail-alias toe (<b>icloud.com</b> → <b>Mail</b> → <b>Instellingen</b> → <b>Accounts</b> → <b>Voeg alias toe</b>); die komt in dezelfde mailbox binnen, dus er hoeft niets te verhuizen.'),
      isp: L('Pick an address that is not tied to your internet provider. An address from your provider stops when you switch provider, so move for good this time, for example to Proton, Fastmail, Outlook.com or iCloud+.',
        'Kies een adres dat niet aan je internetaanbieder vastzit. Een adres van je aanbieder stopt als je overstapt, dus verhuis nu voorgoed, bijvoorbeeld naar Proton, Fastmail, Outlook.com of iCloud+.'),
      other: L('Create the new address at your mail provider, or at a new one.', 'Maak het nieuwe adres aan bij je mailprovider, of bij een nieuwe.')
    }[kind] + ' ' + L('Keep it for people, your bank and the government, and give companies their own alias from now on (<a href="#/aliases">Aliases</a>).',
      'Gebruik het voor mensen, je bank en de overheid, en geef bedrijven voortaan een eigen alias (<a href="#/aliases">Aliassen</a>).')],

    letters: [L('Send the erasure letters first', 'Verstuur eerst de verwijderverzoeken'),
      L('Companies that only know the old address can only answer there. Send their letters while it still receives the replies.',
        'Bedrijven die alleen het oude adres kennen, kunnen alleen daarop antwoorden. Verstuur hun brieven nu het die antwoorden nog ontvangt.')
      + ' ' + (letters
        ? `<a href="#/delete?send=1">${L(`Send the ${letters} ${letters === 1 ? 'letter' : 'letters'} for this address`, `Verstuur de ${letters} ${letters === 1 ? 'brief' : 'brieven'} voor dit adres`)}</a>.`
        : L('There is nothing waiting for this address.', 'Voor dit adres staat niets klaar.'))],

    inventory: [L('List everything that uses it', 'Zoek uit wat het nog gebruikt'),
      `<ul>
        <li>${L(`<b>Your password manager:</b> search it for ${code}. Every result is an account to move.`,
                `<b>Je wachtwoordmanager:</b> zoek naar ${code}. Elk resultaat is een account om te verhuizen.`)}</li>
        <li>${L('<b>"Sign in with Google, Apple or Microsoft":</b> those sites are tied to that account. Its security settings list them.',
                '<b>"Inloggen met Google, Apple of Microsoft":</b> die sites hangen aan dat account. In de beveiligingsinstellingen staat de lijst.')}</li>
        <li>${L('<b>Your mailbox:</b> search it for these words; every sender that turns up knows the address:',
                '<b>Je mailbox:</b> zoek op deze woorden; elke afzender die je vindt, kent het adres:')}
          <div class="copy-chips">${L(['welcome', 'verify your email', 'password', 'your account', 'order', 'invoice'],
            ['welkom', 'bevestig je e-mailadres', 'wachtwoord', 'je account', 'bestelling', 'factuur']).map(w => copy(w)).join('')}</div></li>
        ${names ? `<li>${L(`<b>In the mail you scanned:</b> ${names}.`, `<b>In de gescande mail:</b> ${names}.`)}</li>` : ''}
      </ul>`],

    important: [L('Move what matters first', 'Verhuis eerst wat belangrijk is'),
      L('Change the address in the account settings of your bank, the government (MijnOverheid, DigiD, Belastingdienst), your health insurer, energy, internet and phone, your employer and pension fund, your password manager, and the recovery address of your Apple, Google or Microsoft account. It is usually under Profile, Settings or Account → Email address; most send a check to the new address.',
        'Verander het adres in de accountinstellingen van je bank, de overheid (MijnOverheid, DigiD, Belastingdienst), je zorgverzekeraar, energie, internet en telefoon, je werkgever en pensioenfonds, je wachtwoordmanager, en het herstel-e-mailadres van je Apple-, Google- of Microsoft-account. Meestal onder Profiel, Instellingen of Account → E-mailadres; de meeste sturen een controle naar het nieuwe adres.')],

    people: [L('Tell the people you know', 'Laat het de mensen weten die je kent'),
      L('Send them your new address, from the new address itself, so it lands in their contacts:', 'Stuur ze je nieuwe adres, vanaf het nieuwe adres zelf, zodat het in hun contacten komt:')
      + `<div class="copy-chips">${copy(L('Hi, I have a new email address: this one. Could you save it? My old address will stop working soon.',
        'Hoi, ik heb een nieuw e-mailadres: dit adres. Wil je het opslaan? Mijn oude adres stopt binnenkort.'), L('Copy a message', 'Kopieer een bericht'))}</div>`],

    forward: [L('Forward the old address for a few months', 'Stuur het oude adres een paar maanden door'),
      (sameAccount
        ? L('Both addresses arrive in the same mailbox, so there is nothing to forward.', 'Beide adressen komen in dezelfde mailbox binnen, dus er valt niets door te sturen.')
        : kind === 'google'
        ? L('In the old Gmail: <b>Settings</b> → <b>See all settings</b> → <b>Forwarding and POP/IMAP</b> → <b>Add a forwarding address</b>. What Gmail already put in Spam is not forwarded.',
            'In de oude Gmail: <b>Instellingen</b> → <b>Alle instellingen bekijken</b> → <b>Doorsturen en POP/IMAP</b> → <b>Een doorstuuradres toevoegen</b>. Wat Gmail al in Spam zette, wordt niet doorgestuurd.')
        : L('In the old provider\'s webmail, look for <b>Forwarding</b> under the settings and send everything to the new address.',
            'Zoek in de webmail van de oude aanbieder bij de instellingen naar <b>Doorsturen</b> en stuur alles naar het nieuwe adres.'))
      + ' ' + L('If you set an automatic reply that gives the new address, send it only to your contacts (Gmail and Outlook have that option): a reply to everyone tells spammers the address is alive. In the new mailbox, a rule that moves mail sent to the old address into a folder <i>Old address</i> shows you what still uses it.',
        'Zet je een automatisch antwoord met het nieuwe adres, stuur het dan alleen naar je contacten (Gmail en Outlook hebben die optie): een antwoord aan iedereen vertelt spammers dat het adres leeft. Een regel in de nieuwe mailbox die mail aan het oude adres naar een map <i>Oud adres</i> verplaatst, laat zien wat het nog gebruikt.')],

    keep: [L('Keep your old mail and contacts', 'Bewaar je oude mail en contacten'), {
      microsoft: L('Nothing to do: it all stays in the same account.', 'Niets te doen: alles blijft in hetzelfde account.'),
      apple: L('Nothing to do: it all stays in the same account.', 'Niets te doen: alles blijft in hetzelfde account.'),
      google: L('Contacts: <b>contacts.google.com</b> → <b>Export</b>, then <b>Import</b> in the new account. Mail: keep the old account so you can still search it, or download a copy with Google Takeout.',
        'Contacten: <b>contacts.google.com</b> → <b>Exporteren</b>, dan <b>Importeren</b> in het nieuwe account. Mail: houd het oude account aan zodat je erin kunt blijven zoeken, of download een kopie met Google Takeout.'),
      isp: L('Do this before the provider closes the address. Add both addresses to one mail app (Apple Mail, Outlook or Thunderbird) and drag your folders from the old account to the new one; that copies the mail across. Export your contacts as a vCard file and import them in the new account.',
        'Doe dit voordat de aanbieder het adres opheft. Voeg beide adressen toe aan één mailapp (Apple Mail, Outlook of Thunderbird) en sleep je mappen van het oude naar het nieuwe account; zo kopieer je de mail. Exporteer je contacten als vCard-bestand en importeer ze in het nieuwe account.'),
      other: L('Add both addresses to one mail app (Apple Mail, Outlook or Thunderbird) and drag your folders from the old account to the new one; that copies the mail across. Export your contacts as a vCard file and import them in the new account.',
        'Voeg beide adressen toe aan één mailapp (Apple Mail, Outlook of Thunderbird) en sleep je mappen van het oude naar het nieuwe account; zo kopieer je de mail. Exporteer je contacten als vCard-bestand en importeer ze in het nieuwe account.')
    }[kind]],

    check: [L('Check again after a month', 'Kijk na een maand opnieuw'),
      L('Look at what still arrives at the old address. Move every account you need, unsubscribe from the rest, and drop that mail in here to block the scams. When only spam arrives, you are ready for the last step.',
        'Bekijk wat er nog op het oude adres binnenkomt. Verhuis elk account dat je nodig hebt, schrijf je uit voor de rest, en sleep die mail hierheen om de oplichters te blokkeren. Komt er alleen nog spam binnen, dan ben je klaar voor de laatste stap.')],

    retire: [L('Retire the old address', 'Hef het oude adres op'),
      `<ol class="small">${retire.map(x => `<li>${x}</li>`).join('')}</ol>`
      + L('First check once more that no account you need still logs in with it: password resets go to this address.',
          'Controleer eerst nog één keer dat geen account dat je nodig hebt ermee inlogt: wachtwoordherstel gaat naar dit adres.')]
  };

  const count = MOVE_STEPS.filter(s => done.includes(s)).length;
  return `
    <p><b>${L(`Moving to a new address, step by step: ${count} of ${MOVE_STEPS.length} done`, `Stap voor stap naar een nieuw adres: ${count} van ${MOVE_STEPS.length} gedaan`)}</b></p>
    <p class="small muted">${L('In this order nothing gets lost: the old address keeps working until the very end. Tick off what you have done; HoopUp remembers it on this device.',
      'In deze volgorde raak je niets kwijt: het oude adres blijft werken tot het allerlaatst. Vink af wat je gedaan hebt; HoopUp onthoudt het op dit apparaat.')}</p>
    <ol class="move-steps">${MOVE_STEPS.map(id => {
      const [title, body] = steps[id];
      const on = done.includes(id);
      return `<li class="${on ? 'is-done' : ''}">
        <label class="move-head"><input type="checkbox" data-action="move-step" data-addr="${esc(a)}" data-step="${id}" ${on ? 'checked' : ''}>
          <b>${title}</b></label>
        <div class="small move-body">${body}</div>
      </li>`;
    }).join('')}</ol>`;
}
