import { readFile, writeFile, readdir, mkdir, rm, copyFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { marked } from 'marked';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, '..');
const ENTRIES_DIR = path.join(ROOT_DIR, 'entries');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

function isValidEntryFilename(filename) {
  return /^(\d{4})-(\d{2})-(\d{2})\.md$/.test(filename);
}

function parseDateFromFilename(filename) {
  const m = filename.match(/^(\d{4})-(\d{2})-(\d{2})\.md$/);
  if (!m) return null;
  const [_, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  return {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    monthDay: `${mo}-${d}`,
    date,
    slug: `${y}-${mo}-${d}`,
  };
}

function htmlEscape(str) {
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Remove daily boilerplate sections from journal markdown (top Must Do's and bottom link/closer/100 days blocks)
function cleanJournalMarkdown(text) {
  const lines = String(text || '').split('\n');
  // 1) Remove everything above and including Must Do's list
  let startIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*#{0,6}\s*Must Do'?s\b/i.test(l)) {
      let j = i + 1;
      while (j < lines.length && (/^\s*[-*+]\s+/.test(lines[j]) || /^\s*\d+\.\s+/.test(lines[j]) || /^\s*\[[ xX]\]\s+/.test(lines[j]) || /^\s*$/.test(lines[j]))) {
        j++;
      }
      startIdx = j;
      break;
    }
  }
  // 2) Remove everything below and including [[link to]], Are We Closer, Link To, or 100 days
  let endIdx = lines.length;
  for (let i = startIdx; i < lines.length; i++) {
    const low = lines[i].toLowerCase();
    if (/\[\[\s*link\s*to\s*\]\]/i.test(lines[i]) || /^\s*#{0,6}\s*link\s*to\b/i.test(lines[i]) || /^\s*#{0,6}\s*are\s*we\s*closer\b/i.test(lines[i]) || /\b100\s*days\b/i.test(lines[i])) {
      endIdx = i; break;
    }
  }
  const cleaned = lines.slice(startIdx, endIdx).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return cleaned ? cleaned + '\n' : '';
}

function baseLayout({ title, content, extraHead = '', extraScripts = '', base = '' }) {
  const prefix = base ? base.replace(/\/?$/, '/') : '';
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${htmlEscape(title)}</title>
    <link rel="stylesheet" href="${prefix}style.css" />
    ${extraHead}
  </head>
  <body>
    <header class="site-header">
      <nav>
        <a href="${prefix}index.html">Home</a>
        <a href="${prefix}compare.html">Compare</a>
        <a href="${prefix}stats.html">Stats</a>
      </nav>
    </header>
    <main class="container">
      ${content}
    </main>
    <footer class="site-footer"></footer>
    ${extraScripts}
  </body>
  </html>`;
}

function sortByDateAsc(a, b) {
  return a.meta.date - b.meta.date;
}

function sortByDateDesc(a, b) {
  return b.meta.date - a.meta.date;
}

function tokenizeForWordCount(text) {
  const cleaned = cleanJournalMarkdown(text)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^\)]*\)/g, ' ')
    .replace(/\[[^\]]*\]\([^\)]*\)/g, ' ')
    .replace(/[\u2019']/g, "'")
    .replace(/[^a-zA-Z0-9\s']/g, ' ')
    .toLowerCase();
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  return tokens;
}

const STOPWORDS = new Set([
  'the','a','an','and','or','but','if','then','else','when','at','by','for','in','of','on','to','up','with','is','it','as','be','can','did','do','does','doing','done','from','had','has','have','i','me','my','we','our','you','your','he','she','they','them','their','this','that','these','those','so','not','no','yes','just','than','too','very','are','was','were','will','would','could','should','about','after','again','against','all','am','any','because','been','before','being','between','both','into','over','under','out','off','only','own','same','some','such','own','what','which','who','whom','why','how','there','here','where','also'
]);

function wordsWithoutStopwords(tokens) {
  return tokens.filter(w => w.length > 1 && !STOPWORDS.has(w));
}

function getWordCountsPerEntry(entries) {
  return entries.map(e => {
    const tokens = tokenizeForWordCount(e.markdown);
    const filtered = wordsWithoutStopwords(tokens);
    return { slug: e.meta.slug, year: e.meta.year, count: filtered.length };
  });
}

function aggregateCountsByYear(items) {
  const map = new Map();
  for (const it of items) {
    map.set(it.year, (map.get(it.year) || 0) + it.count);
  }
  return Array.from(map.entries()).sort((a, b) => a[0] - b[0]).map(([year, total]) => ({ year, total }));
}

function buildWordFrequency(entries) {
  const overall = new Map();
  const perYear = new Map();
  for (const e of entries) {
    const tokens = wordsWithoutStopwords(tokenizeForWordCount(e.markdown));
    for (const w of tokens) {
      overall.set(w, (overall.get(w) || 0) + 1);
      const y = e.meta.year;
      if (!perYear.has(y)) perYear.set(y, new Map());
      const ym = perYear.get(y);
      ym.set(w, (ym.get(w) || 0) + 1);
    }
  }
  return { overall, perYear };
}

function renderSparkline(values, { width = 280, height = 60, stroke = '#fff' } = {}) {
  const n = values.length;
  if (n === 0) return '';
  const max = Math.max(...values);
  const min = Math.min(...values);
  const pad = 6;
  const W = width;
  const H = height;
  const range = max === min ? 1 : (max - min);
  const points = values.map((v, i) => {
    const x = pad + (i * (W - 2 * pad)) / Math.max(1, n - 1);
    const y = H - pad - ((v - min) * (H - 2 * pad)) / range;
    return [x, y];
  });
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="sparkline">
    <path d="${d}" fill="none" stroke="${stroke}" stroke-width="2" />
  </svg>`;
}

// (co-occurrence graph removed by request)

async function loadEntries() {
  let files = [];
  try {
    files = await readdir(ENTRIES_DIR);
  } catch (e) {
    // No entries directory yet
    return [];
  }
  const mdFiles = files.filter(isValidEntryFilename);
  const entries = [];
  for (const file of mdFiles) {
    const meta = parseDateFromFilename(file);
    if (!meta) continue;
    const markdownRaw = await readFile(path.join(ENTRIES_DIR, file), 'utf8');
    const markdown = cleanJournalMarkdown(markdownRaw);
    const html = marked.parse(markdown);
    entries.push({ meta, markdown, html });
  }
  entries.sort(sortByDateAsc);
  return entries;
}

async function cleanDist() {
  await rm(DIST_DIR, { recursive: true, force: true });
  await ensureDir(DIST_DIR);
}

async function copyStatic() {
  // Copy style.css to root of dist
  await ensureDir(DIST_DIR);
  await copyFile(path.join(PUBLIC_DIR, 'style.css'), path.join(DIST_DIR, 'style.css'));
  // Write .nojekyll for GitHub Pages
  await writeFile(path.join(DIST_DIR, '.nojekyll'), '', 'utf8');
}

function entryPage(entry, { before = '', after = '', extraScripts = '', base = '' } = {}) {
  const content = `
<article class="entry">
  <h1>${htmlEscape(entry.meta.slug)}</h1>
  ${before}
  ${entry.html}
  ${after}
  <div class="entry-meta">Date: ${htmlEscape(entry.meta.slug)}</div>
</article>`;
  return baseLayout({ title: entry.meta.slug, content, extraScripts, base });
}

async function writeEntryPages(entries) {
  const entriesDir = path.join(DIST_DIR, 'entries');
  await ensureDir(entriesDir);
  const base = '..';
  const paths = entries.map(e => `${base}/entries/${e.meta.slug}.html`);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const prev = i > 0 ? entries[i - 1].meta.slug : null;
    const next = i < entries.length - 1 ? entries[i + 1].meta.slug : null;
    const prevHref = prev ? `${base}/entries/${prev}.html` : '';
    const nextHref = next ? `${base}/entries/${next}.html` : '';
    const nav = `
<div class="entry-nav">
  <a class="btn nav-left" ${prevHref ? `href="${prevHref}"` : 'aria-disabled="true"'} aria-label="Previous">←</a>
  <button class="btn nav-random" id="random-entry" aria-label="Random">Random</button>
  <a class="btn nav-right" ${nextHref ? `href="${nextHref}"` : 'aria-disabled="true"'} aria-label="Next">→</a>
</div>`;
    const extraScripts = `
<script>
  const ENTRY_PATHS = ${JSON.stringify(paths)};
  (function(){
    const randBtn = document.getElementById('random-entry');
    function goRandom(){
      if (!ENTRY_PATHS.length) return;
      const idx = Math.floor(Math.random() * ENTRY_PATHS.length);
      window.location.href = ENTRY_PATHS[idx];
    }
    if (randBtn) {
      randBtn.disabled = ENTRY_PATHS.length === 0;
      randBtn.addEventListener('click', goRandom);
    }
    const prevLink = document.querySelector('.nav-left');
    const nextLink = document.querySelector('.nav-right');
    document.addEventListener('keydown', function(e){
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowLeft' && prevLink && prevLink.getAttribute('href')) {
        e.preventDefault();
        window.location.href = prevLink.getAttribute('href');
      } else if (e.key === 'ArrowRight' && nextLink && nextLink.getAttribute('href')) {
        e.preventDefault();
        window.location.href = nextLink.getAttribute('href');
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        goRandom();
      }
    });
  })();
</script>`;
    const html = entryPage(e, { after: nav, extraScripts, base });
    const out = path.join(entriesDir, `${e.meta.slug}.html`);
    await writeFile(out, html, 'utf8');
  }
}

function homePage(entries) {
  if (!entries.length) {
    const content = `
<section>
  <h1>Journal</h1>
  <p>No entries yet. Add files to <code>entries/</code> named <code>YYYY-MM-DD.md</code>.</p>
 </section>`;
    return baseLayout({ title: 'Journal', content, base: '' });
  }
  const paths = entries.map(e => `entries/${e.meta.slug}.html`);
  const extraScripts = `
<script>
  (function(){
    const ENTRY_PATHS = ${JSON.stringify(paths)};
    function go(){
      const idx = Math.floor(Math.random() * ENTRY_PATHS.length);
      window.location.replace(ENTRY_PATHS[idx]);
    }
    if (document.readyState === 'complete' || document.readyState === 'interactive') go();
    else document.addEventListener('DOMContentLoaded', go);
  })();
</script>`;
  const content = `
<section>
  <h1>Journal</h1>
  <p>Loading a random entry...</p>
  <p><a href="#" id="fallback-link">Open Random Now</a></p>
 </section>`;
  // Enhance fallback link
  const fallbackScript = `
<script>
  (function(){
    const ENTRY_PATHS = ${JSON.stringify(paths)};
    const link = document.getElementById('fallback-link');
    if (link) link.addEventListener('click', function(e){ e.preventDefault(); const idx=Math.floor(Math.random()*ENTRY_PATHS.length); window.location.href = ENTRY_PATHS[idx]; });
  })();
</script>`;
  return baseLayout({ title: 'Journal', content, extraScripts: extraScripts + fallbackScript, base: '' });
}

async function writeHomePage(entries) {
  const html = homePage(entries);
  await writeFile(path.join(DIST_DIR, 'index.html'), html, 'utf8');
}

function comparePage(entries) {
  const byMonthDay = new Map();
  for (const e of entries) {
    const md = e.meta.monthDay;
    if (!byMonthDay.has(md)) byMonthDay.set(md, []);
    byMonthDay.get(md).push(e);
  }
  const days = Array.from(byMonthDay.entries()).sort(([a],[b]) => a.localeCompare(b));
  const sections = days.map(([md, arr]) => {
    const byYear = arr.slice().sort((a, b) => a.meta.year - b.meta.year);
    const columns = byYear.map(e => `
      <div class="compare-entry">
        <div class="compare-entry-header">
          <h3>${e.meta.year}</h3>
          <a class="open-link" href="entries/${e.meta.slug}.html">Open</a>
        </div>
        <div class="compare-entry-content">${e.html}</div>
      </div>
    `).join('\n');
    return `
      <details data-month-day="${md}">
        <summary><h2>${md}</h2></summary>
        <div class="compare-grid">\n${columns}\n</div>
      </details>`;
  }).join('\n');

  const content = `
<section>
  <h1>Compare Same Date Across Years</h1>
  ${sections || '<p>No comparable dates yet.</p>'}
 </section>`;
  const extraScripts = '';
  return baseLayout({ title: 'Compare', content, extraScripts, base: '' });
}

async function writeComparePage(entries) {
  const html = comparePage(entries);
  await writeFile(path.join(DIST_DIR, 'compare.html'), html, 'utf8');
}

function statsPage(entries) {
  const wordCounts = getWordCountsPerEntry(entries);
  const totalWords = wordCounts.reduce((s, w) => s + w.count, 0);
  const totalUniqueWords = (() => {
    const set = new Set();
    for (const e of entries) {
      for (const t of wordsWithoutStopwords(tokenizeForWordCount(e.markdown))) {
        if (!/^[0-9]+$/.test(t)) set.add(t);
      }
    }
    return set.size;
  })();
  const byYear = aggregateCountsByYear(wordCounts);
  const { overall, perYear } = buildWordFrequency(entries);

  // Monthly word count trend (YYYY-MM)
  const perMonthMap = new Map();
  for (const e of entries) {
    const y = e.meta.year;
    const m = String(e.meta.month).padStart(2, '0');
    const ym = `${y}-${m}`;
    const count = wordsWithoutStopwords(tokenizeForWordCount(e.markdown)).length;
    perMonthMap.set(ym, (perMonthMap.get(ym) || 0) + count);
  }
  const perMonth = Array.from(perMonthMap.entries())
    .sort((a,b) => a[0].localeCompare(b[0]));
  const monthLabels = perMonth.map(([ym]) => ym).slice(1);
  const monthValues = perMonth.map(([,v]) => v).slice(1);
  const monthTrendSVG = renderSparkline(monthValues, { width: 1000, height: 160, stroke: '#fff' });

  // Daily word count series (using filtered tokens for consistency) - drop the first point
  const dailySeries = entries.map(e => ({ slug: e.meta.slug, count: wordsWithoutStopwords(tokenizeForWordCount(e.markdown)).length }));
  const dailyValues = dailySeries.slice(1).map(d => d.count);
  const dailySVG = renderSparkline(dailyValues, { width: 1000, height: 120, stroke: '#34d399' });

  const allWordsSorted = Array.from(overall.entries()).sort((a, b) => b[1] - a[1]);
  const topWordsGte10 = allWordsSorted.filter(([_, c]) => c >= 10);
  const topWords = allWordsSorted.slice(0, 50);

  // Monthly trends per word and variance ranking
  const monthlyOrder = Array.from(new Set(entries.map(e => `${e.meta.year}-${String(e.meta.month).padStart(2,'0')}`))).sort((a,b)=>a.localeCompare(b));
  const monthIndex = new Map(monthlyOrder.map((k,i)=>[k,i]));
  const perWordMonthCounts = new Map();
  for (const e of entries) {
    const ym = `${e.meta.year}-${String(e.meta.month).padStart(2,'0')}`;
    const tokens = wordsWithoutStopwords(tokenizeForWordCount(e.markdown));
    for (const w of tokens) {
      if (!perWordMonthCounts.has(w)) perWordMonthCounts.set(w, new Array(monthlyOrder.length).fill(0));
      const arr = perWordMonthCounts.get(w);
      arr[monthIndex.get(ym)]++;
    }
  }
  function variance(arr){
    if (!arr.length) return 0;
    const mean = arr.reduce((a,b)=>a+b,0) / arr.length;
    const v = arr.reduce((s,x)=>s + (x-mean)*(x-mean), 0) / arr.length;
    return v;
  }
  const wordsGte10 = Array.from(perWordMonthCounts.entries()).filter(([w, arr]) => arr.reduce((a,b)=>a+b,0) >= 10)
    .map(([w, arr]) => [w, arr.slice(1)]); // drop first month for normalization
  wordsGte10.sort((a,b)=> variance(b[1]) - variance(a[1]));
  const wordTrendRows = wordsGte10.map(([word, series]) => {
    const svg = renderSparkline(series, { width: 400, height: 60, stroke: '#9ae6b4' });
    const total = series.reduce((a,b)=>a+b,0);
    return `<tr><td>${htmlEscape(word)}</td><td>${total}</td><td>${svg}</td></tr>`;
  }).join('\n');

  const topTableAll = topWordsGte10.map(([w, c]) => `<tr><td>${htmlEscape(w)}</td><td>${c}</td></tr>`).join('\n');
  
  // Hapax legomena (count === 1)
  const hapaxRows = Array.from(overall.entries())
    .filter(([_, c]) => c === 1)
    .sort((a,b) => a[0].localeCompare(b[0]))
    .map(([w]) => `<tr><td>${htmlEscape(w)}</td></tr>`)
    .join('\n');

  // Hottest words: recent increase (last N months vs previous N months)
  const windowN = Math.min(3, Math.max(1, monthlyOrder.length >> 3) || 3);
  const end = monthlyOrder.length;
  const recentStart = Math.max(0, end - windowN);
  const prevStart = Math.max(0, end - 2 * windowN);
  const havePrev = (end - prevStart) >= 2 * windowN;
  const hottest = wordsGte10
    .map(([word, series]) => {
      const recent = series.slice(Math.max(0, series.length - windowN)).reduce((a,b)=>a+b,0);
      const prev = havePrev ? series.slice(Math.max(0, series.length - 2*windowN), Math.max(0, series.length - windowN)).reduce((a,b)=>a+b,0) : 0;
      const delta = recent - prev;
      return { word, recent, prev, delta, series };
    })
    .filter(x => x.delta > 0)
    .sort((a,b) => b.delta - a.delta)
    .slice(0, 50);
  const hottestRows = hottest.map(h => {
    const svg = renderSparkline(h.series, { width: 300, height: 50, stroke: '#34d399' });
    return `<tr><td>${htmlEscape(h.word)}</td><td>${h.prev}</td><td>${h.recent}</td><td>+${h.delta}</td><td>${svg}</td></tr>`;
  }).join('\n');

  // Slider-driven hottest words for a specific month index
  const sliderData = {
    months: monthlyOrder,
    perWord: Array.from(perWordMonthCounts.entries()).reduce((m, [w, arr]) => {
      if (arr.reduce((a,b)=>a+b,0) >= 5) m[w] = arr; // threshold to reduce noise
      return m;
    }, {})
  };

  // co-occurrence removed

  const content = `
<section>
  <h1>Stats</h1>
  <div class="stats-cards">
    <div class="stat-card"><div class="stat-label">Entries</div><div class="stat-value">${entries.length}</div></div>
    <div class="stat-card"><div class="stat-label">Total Words</div><div class="stat-value">${totalWords}</div></div>
  </div>
  <h2>Hottest Words (recent ↑)</h2>
  <div class="scroll-invisible scroll-rows-10">
    <table class="table">
      <thead><tr><th>Word</th><th>Prev</th><th>Recent</th><th>Δ</th><th>Trend</th></tr></thead>
      <tbody>
        ${hottestRows || '<tr><td colspan="5">No recent increases detected.</td></tr>'}
      </tbody>
    </table>
  </div>
  <h2>Word Trends by Month (spiky first, count ≥ 10)</h2>
  <div class="scroll-invisible scroll-rows-5">
    <table class="table">
      <thead><tr><th>Word</th><th>Total</th><th>Trend (per month)</th></tr></thead>
      <tbody>
        ${wordTrendRows || '<tr><td colspan="3">No data.</td></tr>'}
      </tbody>
    </table>
  </div>
  <h2>Top Words (count ≥ 10)</h2>
  <div class="scroll-invisible scroll-rows-5">
    <table class="table">
      <thead><tr><th>Word</th><th>Count</th></tr></thead>
      <tbody>
        ${topTableAll || '<tr><td colspan="2">No words ≥ 10.</td></tr>'}
      </tbody>
    </table>
  </div>
  
  <h2>Word Count Trends (per month)</h2>
  <div class="chart">
    <div class="chart-labels">${monthLabels.slice(-12).map(l => `<span>${l}</span>`).join('')}</div>
    ${monthTrendSVG}
  </div>
  <h2>Daily Word Count</h2>
  <div class="chart">
    ${dailySVG}
  </div>
</section>`;
  const extraScripts = `
<script>
  (function(){
    const data = ${JSON.stringify(sliderData)};
    const months = data.months;
    const perWord = data.perWord;
    const slider = document.getElementById('hot-month');
    const label = document.getElementById('hot-month-label');
    const tableBody = document.querySelector('#hot-month-table tbody');
    function renderMonth(idx){
      if (!months.length) return;
      const i = Math.max(0, Math.min(months.length - 1, idx|0));
      label.textContent = months[i] || '';
      // rank by month count descending for that index
      const rows = Object.entries(perWord)
        .map(([w, arr]) => [w, arr[i] || 0])
        .filter(([, c]) => c > 0)
        .sort((a,b)=>b[1]-a[1])
        .slice(0, 50)
        .map(function(pair){ var w = pair[0], c = pair[1]; return '<tr><td>'+w+'</td><td>'+c+'</td></tr>'; })
        .join('');
      tableBody.innerHTML = rows || '<tr><td colspan="2">No words this month.</td></tr>';
    }
    slider?.addEventListener('input', function(){ renderMonth(this.value); });
    renderMonth(slider ? slider.value : (months.length-1));
  })();
</script>`;
  return baseLayout({ title: 'Stats', content, extraScripts, base: '' });
}

async function writeStatsPage(entries) {
  const html = statsPage(entries);
  await writeFile(path.join(DIST_DIR, 'stats.html'), html, 'utf8');
}

async function main() {
  await ensureDir(ENTRIES_DIR);
  await ensureDir(PUBLIC_DIR);
  await cleanDist();
  await copyStatic();
  const entries = await loadEntries();
  await writeEntryPages(entries);
  await writeHomePage(entries);
  await writeComparePage(entries);
  await writeStatsPage(entries);
  console.log(`Built ${entries.length} entries to ${DIST_DIR}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});


