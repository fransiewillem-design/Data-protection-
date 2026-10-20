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

async function readLarge(file, emit, progress, folder) {
  const decoder = new TextDecoder();
  let carry = '', lines = [], kept = 0, mbox = null;
  const flush = () => {
    if (lines.length) emit(parseMessages(lines.join('\n'), { single: true, folder }));
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

// The folder a file came from, as the user named it: "Bank" for
// Bank.mbox/mbox (an Apple Mail export), for a Thunderbird folder file called
// Bank, or for a message inside Bank.mbox/…/Messages/123.emlx. A folder the
// user made says they keep that mail; Inbox, Junk and the like say nothing.
export function folderOf(file) {
  const parts = String(file.hoopupPath || file.webkitRelativePath || file.name || '').split('/').filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) if (/\.mbox$/i.test(parts[i])) return parts[i].replace(/\.mbox$/i, '');
  const name = parts.at(-1) || '';
  return name && !name.includes('.') && name !== 'mbox' ? name : '';
}

// Files worth reading in a dropped folder. A mailbox export carries indexes,
// settings and attachments next to the mail; those are skipped.
export const isMailFileName = name => !/^\./.test(name) && !/^(table_of_contents|info\.plist)$/i.test(name)
  && (/\.(eml|emlx|msg|mbox|mbx|txt)$/i.test(name) || !/\.[a-z0-9]{1,8}$/i.test(name));

// Apple Mail's own message files: a line with the length, the message, then
// a property list holding its flags (read, answered, flagged). The flags go
// in front as a header the scan reads.
function emlxText(bytes) {
  const nl = bytes.indexOf(10);
  const n = parseInt(new TextDecoder().decode(bytes.subarray(0, nl)), 10);
  if (nl < 0 || !Number.isFinite(n)) return new TextDecoder().decode(bytes);
  const msg = new TextDecoder().decode(bytes.subarray(nl + 1, nl + 1 + n));
  const flags = /<key>flags<\/key>\s*<integer>(\d+)<\/integer>/.exec(new TextDecoder().decode(bytes.subarray(nl + 1 + n)))?.[1];
  return (flags ? `X-Emlx-Flags: ${flags}\n` : '') + msg;
}

// Everything in what was dropped, folders included (an Apple Mail export is a
// folder). The entries are taken during the drop event itself, as a browser
// allows only then.
const MAX_FILES = 200000;
export async function filesFromDrop(dt) {
  const entries = [...(dt.items || [])].map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...(dt.files || [])];
  const out = [];
  const walk = async (entry, path, depth) => {
    if (out.length >= MAX_FILES || depth > 12) return;
    if (entry.isFile) {
      if (!isMailFileName(entry.name)) return;
      const f = await new Promise((res, rej) => entry.file(res, rej)).catch(() => null);
      if (f) { f.hoopupPath = path + entry.name; out.push(f); }
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej)).catch(() => []);
        if (!batch.length) break;
        for (const e of batch) await walk(e, path + entry.name + '/', depth + 1);
      }
    }
  };
  for (const e of entries) await walk(e, '', 0);
  return out;
}

// Which mail app the files came from, so the block rules are offered for the
// app the user actually reads this mail in, not guessed from the address (a
// Hotmail address read in Apple Mail wants Apple Mail rules).
function appOf(file, head, isOutlookMsg) {
  if (isOutlookMsg) return 'outlookwin';
  if (/\.emlx$/i.test(file.name) || /\.mbox\//i.test(file.hoopupPath || file.webkitRelativePath || '')) return 'apple';
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
  let before = 0, unread = 0, broken = 0;
  const apps = {};
  for (const [i, f] of files.entries()) {
    // A folder of thousands of small files: let the page breathe.
    if (i && i % 25 === 0) await pause();
    // A file that fails is skipped, not the whole drop. Most often it is
    // stored only in iCloud or OneDrive (a cloud icon in Finder or Explorer),
    // which the browser cannot read until it is downloaded.
    try {
      const head = new Uint8Array(await f.slice(0, 512).arrayBuffer());
      const headText = new TextDecoder().decode(await f.slice(0, 64 * 1024).arrayBuffer());
      const app = appOf(f, headText, isMsg(head));
      if (app) apps[app] = (apps[app] || 0) + 1;
      const folder = folderOf(f);
      if (isMsg(head)) add(parseMessages(msgToText(await f.arrayBuffer()), { single: true, folder }));
      else if (/\.emlx$/i.test(f.name)) add(parseMessages(emlxText(new Uint8Array(await f.arrayBuffer())), { single: true, folder }));
      else if (f.size <= WHOLE) add(parseMessages(await f.text(), { folder }));
      else await readLarge(f, add, n => onProgress((before + n) / total, f.name), folder);
    } catch (err) {
      if (['NotReadableError', 'NotFoundError', 'SecurityError', 'AbortError'].includes(err?.name)) unread++;
      else broken++;
    }
    before += f.size;
    onProgress(before / total, f.name);
  }
  const app = Object.entries(apps).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  return { messages, app, unread, broken };
}
