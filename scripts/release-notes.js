// Usage: node scripts/release-notes.js v1.0.0
// Prints the matching CHANGELOG section (or a fallback note) for GitHub Releases.
const fs = require('node:fs');
const path = require('node:path');

const tag = (process.argv[2] || '').replace(/^v/, '');
const changelog = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
const lines = changelog.split('\n');
let out = [];
let capture = false;
for (const line of lines) {
  const m = line.match(/^## \[([^\]]+)\]/);
  if (m) {
    if (capture) break;
    if (m[1] === tag) capture = true;
    continue;
  }
  if (capture) out.push(line);
}
const body = out.join('\n').trim();
console.log(body || `MERQO Retail Suite ${tag || ''}\n\nSee CHANGELOG.md for details.`);
