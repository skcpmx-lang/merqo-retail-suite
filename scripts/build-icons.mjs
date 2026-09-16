/**
 * Regenerates the MERQO Windows icon set from the single authoritative
 * brand asset (assets/logo.svg): installer/icon-{16..256}.png + icon.ico.
 *
 * The ICO embeds PNG-compressed 32bpp entries for 16/32/48/64/128/256 so
 * Windows (Vista+) always has a crisp, correctly-padded frame for title
 * bar, taskbar, Start Menu, installer and Explorer.
 *
 * Usage: node scripts/build-icons.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = fs.readFileSync(path.join(root, 'assets/logo.svg'), 'utf8');
const sizes = [16, 32, 48, 64, 128, 256];

const pngs = new Map();
for (const s of sizes) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: s }, background: 'rgba(0,0,0,0)' });
  const buf = Buffer.from(r.render().asPng());
  pngs.set(s, buf);
  fs.writeFileSync(path.join(root, `installer/icon-${s}.png`), buf);
  console.log(`installer/icon-${s}.png  ${buf.length} bytes`);
}

// --- ICO container (PNG-compressed entries) ---
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);           // reserved
header.writeUInt16LE(1, 2);           // type: icon
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + sizes.length * 16;
const dir = [];
for (const s of sizes) {
  const e = Buffer.alloc(16);
  e.writeUInt8(s === 256 ? 0 : s, 0); // width  (0 == 256)
  e.writeUInt8(s === 256 ? 0 : s, 1); // height
  e.writeUInt8(0, 2);                 // palette
  e.writeUInt8(0, 3);                 // reserved
  e.writeUInt16LE(1, 4);              // planes
  e.writeUInt16LE(32, 6);             // bpp
  e.writeUInt32LE(pngs.get(s).length, 8);
  e.writeUInt32LE(offset, 12);
  dir.push(e);
  offset += pngs.get(s).length;
}
fs.writeFileSync(path.join(root, 'installer/icon.ico'), Buffer.concat([header, ...dir, ...sizes.map((s) => pngs.get(s))]));
console.log('installer/icon.ico regenerated');
