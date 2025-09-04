import { readdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const ENTRIES_DIR = path.join(ROOT, 'entries');

function isEntryFile(name) {
  return /^(\d{4})-(\d{2})-(\d{2})\.md$/i.test(name);
}

function cleanTopAndBottom(markdown) {
  const lines = String(markdown || '').split('\n');
  let startIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*#{0,6}\s*Must Do'?s\b/i.test(lines[i])) {
      let j = i + 1;
      while (j < lines.length && (/^\s*[-*+]\s+/.test(lines[j]) || /^\s*\d+\.\s+/.test(lines[j]) || /^\s*\[[ xX]\]\s+/.test(lines[j]) || /^\s*$/.test(lines[j]))) {
        j++;
      }
      startIdx = j; break;
    }
  }
  let endIdx = lines.length;
  for (let i = startIdx; i < lines.length; i++) {
    if (/\[\[\s*link\s*to\s*\]\]/i.test(lines[i]) || /^\s*#{0,6}\s*link\s*to\b/i.test(lines[i]) || /^\s*#{0,6}\s*are\s*we\s*closer\b/i.test(lines[i]) || /\b100\s*days\b/i.test(lines[i])) {
      endIdx = i; break;
    }
  }
  const cleaned = lines.slice(startIdx, endIdx).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return cleaned ? cleaned + '\n' : '';
}

async function run() {
  const files = await readdir(ENTRIES_DIR);
  let changed = 0; let total = 0;
  for (const name of files) {
    if (!isEntryFile(name)) continue;
    total++;
    const p = path.join(ENTRIES_DIR, name);
    const orig = await readFile(p, 'utf8');
    const cleaned = cleanTopAndBottom(orig);
    if (cleaned !== orig) {
      await writeFile(p, cleaned, 'utf8');
      changed++;
    }
  }
  console.log(`Cleaned ${changed}/${total} entries in ${ENTRIES_DIR}`);
}

run().catch(err => { console.error(err); process.exit(1); });


