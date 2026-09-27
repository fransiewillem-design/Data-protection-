// Performs RFC 8058 one-click unsubscribes. Runs inside unsubscribe.html, in a
// hidden iframe, so that the permission to POST to arbitrary hosts lives here
// and not on the page holding the user's data.
//
// Deliberately never touches localStorage: everything it acts on arrives by
// postMessage from its own origin, and it keeps nothing.

const CONCURRENCY = 4;

function send(msg) {
  parent.postMessage({ source: 'dr-unsub', ...msg }, location.origin);
}

// RFC 8058 §3.1: POST, application/x-www-form-urlencoded, body List-Unsubscribe=One-Click.
async function unsubscribeOne(url) {
  try {
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',                 // the sender will not send CORS headers
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
      redirect: 'follow',
      credentials: 'omit',             // never attach cookies to a third party
      referrerPolicy: 'no-referrer'
    });
    // The response is opaque by design, so this means "delivered", not
    // "confirmed". Claiming more than that would be a lie.
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

async function runBatch(items) {
  let done = 0, failed = 0;
  const queue = [...items];

  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      const res = await unsubscribeOne(item.url);
      if (res.ok) done++; else failed++;
      send({ type: 'progress', done, failed, total: items.length, name: item.name, ok: res.ok });
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  send({ type: 'complete', done, failed, total: items.length });
}

addEventListener('message', e => {
  // Only ever act on our own page's instructions.
  if (e.origin !== location.origin) return;
  const d = e.data;
  if (!d || d.type !== 'dr-unsub-batch' || !Array.isArray(d.items)) return;

  const items = d.items
    .filter(i => i && typeof i.url === 'string' && /^https:\/\//i.test(i.url))
    .slice(0, 500);

  if (!items.length) { send({ type: 'complete', done: 0, failed: 0, total: 0 }); return; }
  runBatch(items);
});

send({ type: 'ready' });
