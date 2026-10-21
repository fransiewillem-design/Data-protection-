// The page Microsoft's sign-in comes back to. It hands the one-time code to
// the app in this same tab and goes straight on; the code never stays in the
// address bar or the history.
const p = new URLSearchParams(location.hash.slice(1));
try {
  sessionStorage.setItem('hoopup-ms-back', JSON.stringify({
    code: p.get('code') || '', state: p.get('state') || '', error: p.get('error') || '' }));
} catch { /* the app will say the sign-in did not complete */ }
// Back to the page that started it: Home to read the junk folder, the block
// card to add the rules.
let mode = 'rules';
try { mode = JSON.parse(sessionStorage.getItem('hoopup-ms-start') || '{}').mode || 'rules'; } catch { /* rules */ }
location.replace(new URL(mode === 'read' ? './#/?msread=1' : './#/unsubscribe?outlook=1', location.href).href);
