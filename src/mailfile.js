// Turns dropped files into parsed messages. Outlook .msg files are converted
// first; small files are read in one go; large mailbox exports (a Google
// Takeout .mbox can run to gigabytes) are read in slices, keeping only the
// start of each message, so they never have to fit in memory at once.

import { parseMessages } from './mailscan.js';
import { isMsg, msgToText } from './msg.js';

const WHOLE = 32 * 1024 * 1024;     // files up to this size are read whole
const SLICE = 8 * 1024 * 1024;
// Headers and the start of the body hold everything the scan uses (sender,
// checks, unsubscribe and links); attachments further down are skipped.
const KEEP = 256 * 1024;
const FROM_LINE = /^From \S+.*\d{4}\s*$/;
const pause = () => new Promise(r => setTimeout(r));

async function readLarge(file, emit, progress) {
  const decoder = new TextDecoder();
  let carry = '', lines = [], kept = 0, mbox = null;
  const flush = () => {
    if (lines.length) emit(parseMessages(lines.join('\n'), { single: true }));
    lines = []; kept = 0;
  };
  const take = line => {
    if (mbox === null) { if (!line.trim()) return; mbox = FROM_LINE.test(line); }
    if (mbox && FROM_LINE.test(line)) { flush(); return; }
    if (kept < KEEP) { lines.push(line); kept += line.length + 1; }
  };
  for (let pos = 0; pos < file.size; pos += SLICE) {
    const last = pos + SLICE >= file.size;
    const text = carry + decoder.decode(await file.slice(pos, pos + SLICE).arrayBuffer(), { stream: !last });
    const parts = text.split('\n');
    carry = parts.pop();
    for (const line of parts) take(line);
    progress(Math.min(pos + SLICE, file.size));
    await pause();   // lets the page show progress between slices
  }
  if (carry) take(carry);
  flush();
}

// Which mail app the files came from, so the block rules are offered for the
// app the user actually reads this mail in, not guessed from the address (a
// Hotmail address read in Apple Mail wants Apple Mail rules).
function appOf(file, head, isOutlookMsg) {
  if (isOutlookMsg) return 'outlookwin';
  if (/^X-Gmail-Labels:|^X-GM-THRID:/m.test(head)) return 'gmail';
  const mac = /mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');
  if (mac && /\.eml$/i.test(file.name)) return 'apple';
  return '';
}

export async function readMailFiles(files, onProgress = () => {}) {
  const total = files.reduce((n, f) => n + f.size, 0) || 1;
  const messages = [];
  // A loop, not push(...list): a mailbox can hold more messages than a
  // function call can take arguments.
  const add = list => { for (const m of list) messages.push(m); };
  let before = 0;
  const apps = {};
  for (const f of files) {
    const head = new Uint8Array(await f.slice(0, 512).arrayBuffer());
    const headText = new TextDecoder().decode(await f.slice(0, 64 * 1024).arrayBuffer());
    const app = appOf(f, headText, isMsg(head));
    if (app) apps[app] = (apps[app] || 0) + 1;
    if (isMsg(head)) add(parseMessages(msgToText(await f.arrayBuffer()), { single: true }));
    else if (f.size <= WHOLE) add(parseMessages(await f.text()));
    else await readLarge(f, add, n => onProgress((before + n) / total, f.name));
    before += f.size;
    onProgress(before / total, f.name);
  }
  const app = Object.entries(apps).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  return { messages, app };
}
