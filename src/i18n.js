// Two languages, kept side by side at every call site: L('English', 'Nederlands').
// Pairing them inline means a string can never be translated in one place and
// stale in another, and the language is read at render time, so switching is
// just a re-render.

let current = 'nl';

export function setLang(l) {
  current = l === 'nl' ? 'nl' : 'en';
  if (typeof document !== 'undefined') document.documentElement.lang = current;
}

export const lang = () => current;
export const L = (en, nl) => (current === 'nl' ? nl : en);

// Plural helper: plural(n, 'mail', 'mails', 'mail', 'mails')
export const plural = (n, en1, enN, nl1, nlN) => L(n === 1 ? en1 : enN, n === 1 ? nl1 : nlN);
