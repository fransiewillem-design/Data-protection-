// Reads an Outlook .msg file, which is what classic Outlook for Windows saves
// when messages are dragged out of it. The format is a Compound File (MS-CFB)
// holding MAPI properties (MS-OXMSG). Only what the scanner needs is read: the
// internet headers Outlook kept from the original message, and the body. It
// is turned back into ordinary message text, so the rest of the app treats it
// like any .eml.

const MAXREG = 0xFFFFFFFA;   // larger sector numbers are markers, not sectors
const MAGIC = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];

export const isMsg = u8 => u8.length >= 512 && MAGIC.every((b, i) => u8[i] === b);

function container(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const u32 = o => (o + 4 <= u8.length ? dv.getUint32(o, true) : 0xFFFFFFFF);
  const size = 1 << dv.getUint16(30, true);
  const miniSize = 1 << dv.getUint16(32, true);
  if (size !== 512 && size !== 4096) throw new Error('not an Outlook message');
  const at = s => (s + 1) * size;

  // The sector allocation table, listed in the header and, for large files,
  // in a chain of further list sectors.
  // Sector numbers beyond the end of the file are ignored, so a crafted header
  // cannot make the table (and the memory it takes) larger than the file.
  const sectors = Math.ceil((u8.length - size) / size);
  const fatSectors = [];
  const keep = x => { if (x < sectors && fatSectors.length < sectors) fatSectors.push(x); };
  for (let i = 0; i < 109; i++) keep(u32(76 + 4 * i));
  for (let s = u32(68), n = 0; s < sectors && n < sectors; n++) {
    for (let i = 0; i < size / 4 - 1; i++) keep(u32(at(s) + 4 * i));
    s = u32(at(s) + size - 4);
  }
  const fat = fatSectors.flatMap(s => Array.from({ length: size / 4 }, (_, i) => u32(at(s) + 4 * i)));

  // Every walk is bounded and refuses loops: the file is untrusted input.
  const chain = (start, table) => {
    const out = [], seen = new Set();
    for (let s = start; s <= MAXREG && s < table.length && !seen.has(s); s = table[s]) { seen.add(s); out.push(s); }
    return out;
  };
  const gather = (sectors, from, unit, len) => {
    const out = new Uint8Array(sectors.length * unit);
    sectors.forEach((s, i) => out.set(from.subarray(s * unit, s * unit + unit), i * unit));
    return len == null ? out : out.subarray(0, Math.min(len, out.length));
  };
  const big = (start, len) => gather(chain(start, fat), u8.subarray(size), size, len);

  const dir = big(u32(48));
  const ddv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const utf16 = new TextDecoder('utf-16le');
  const entries = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nameLen = Math.min(64, ddv.getUint16(o + 64, true));
    entries.push({
      name: utf16.decode(dir.subarray(o, o + Math.max(0, nameLen - 2))),
      type: dir[o + 66],
      left: ddv.getUint32(o + 68, true), right: ddv.getUint32(o + 72, true), child: ddv.getUint32(o + 76, true),
      start: ddv.getUint32(o + 116, true), size: ddv.getUint32(o + 120, true)
    });
  }
  const root = entries[0];
  if (!root || root.type !== 5) throw new Error('not an Outlook message');

  const miniStream = big(root.start, root.size);
  const mf = big(u32(60));
  const mfv = new DataView(mf.buffer, mf.byteOffset, mf.byteLength);
  const miniFat = Array.from({ length: mf.length >> 2 }, (_, i) => mfv.getUint32(i * 4, true));
  const cutoff = u32(56) || 4096;

  const read = e => e.size < cutoff
    ? gather(chain(e.start, miniFat), miniStream, miniSize, e.size)
    : big(e.start, e.size);

  // The message's own properties are the streams directly under the root;
  // recipients and attachments sit in sub-storages and are left alone.
  const top = [], seen = new Set(), stack = [root.child];
  while (stack.length) {
    const i = stack.pop();
    if (i > MAXREG || seen.has(i) || !entries[i]) continue;
    seen.add(i);
    top.push(entries[i]);
    stack.push(entries[i].left, entries[i].right);
  }
  return { top, read };
}

const CODEPAGES = { 65001: 'utf-8', 1252: 'windows-1252', 28591: 'iso-8859-1', 28605: 'iso-8859-15', 20127: 'us-ascii',
  1250: 'windows-1250', 1251: 'windows-1251', 1253: 'windows-1253', 1254: 'windows-1254', 932: 'shift_jis', 936: 'gbk',
  949: 'euc-kr', 950: 'big5', 50220: 'iso-2022-jp', 51932: 'euc-jp', 28592: 'iso-8859-2' };

function decoder(cpid) {
  try { return new TextDecoder(CODEPAGES[cpid] || 'windows-1252'); } catch { return new TextDecoder('utf-8'); }
}

// Headers that describe the original MIME structure. The body handed on is a
// single decoded part, so these would mislead the parser.
const MIME_HEADERS = /^(content-type|content-transfer-encoding|mime-version)\s*:/i;

function stripMime(headers) {
  const out = [];
  let skipping = false;
  for (const line of headers.split(/\r?\n/)) {
    if (/^[ \t]/.test(line)) { if (!skipping) out.push(line); continue; }
    skipping = MIME_HEADERS.test(line);
    if (!skipping && line.trim()) out.push(line);
  }
  return out.join('\r\n');
}

const oneLine = s => String(s || '').replace(/[\r\n]+/g, ' ').trim();

export function msgToText(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const { top, read } = container(u8);
  const byName = new Map(top.filter(e => e.type === 2).map(e => [e.name.toUpperCase(), e]));

  // The internet code page, for 8-bit strings and the HTML body.
  let cpid = 0;
  const props = byName.get('__PROPERTIES_VERSION1.0');
  if (props) {
    const p = read(props), pv = new DataView(p.buffer, p.byteOffset, p.byteLength);
    for (let o = 32; o + 16 <= p.length; o += 16) if (pv.getUint32(o, true) === 0x3FDE0003) cpid = pv.getUint32(o + 8, true);
  }
  const eight = decoder(cpid);
  const utf16 = new TextDecoder('utf-16le');
  const str = id => {
    const w = byName.get(`__SUBSTG1.0_${id}001F`);
    if (w) return utf16.decode(read(w)).replace(/\0+$/, '');
    const a = byName.get(`__SUBSTG1.0_${id}001E`);
    return a ? eight.decode(read(a)).replace(/\0+$/, '') : '';
  };
  const bin = id => { const e = byName.get(`__SUBSTG1.0_${id}0102`); return e ? read(e) : null; };

  const htmlBytes = bin('1013');
  const html = htmlBytes ? eight.decode(htmlBytes) : str('1013');
  const body = html || str('1000');

  let headers = stripMime(str('007D'));
  if (!/^from\s*:/im.test(headers)) {
    // No headers kept (a draft, or a message created in Outlook itself):
    // rebuild the few that matter from the message's properties. Without the
    // sender check results such a sender is reported as unverified.
    const addr = oneLine(str('5D01') || str('0C1F'));
    if (!/@/.test(addr)) return '';
    const name = oneLine(str('0C1A')).replace(/[<>"]/g, '');
    headers = [`From: ${name ? `"${name}" ` : ''}<${addr}>`,
      `To: ${oneLine(str('5D07') || str('0076'))}`, `Subject: ${oneLine(str('0037'))}`].join('\r\n');
  }
  return `${headers}\r\nContent-Type: text/${html ? 'html' : 'plain'}; charset=utf-8\r\n\r\n${body}`;
}
