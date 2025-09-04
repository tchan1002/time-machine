MD Journal Site

Static site generator that converts Markdown entries in `entries/` to a simple black-on-white HTML site, with:

- Compare view for same month-day across years
- Random entry button
- Stats page: total word count, yearly trends, top words, word frequency trends

Usage

1. Install deps:

```bash
npm install
```

2. Add entries in `entries/` as files named `YYYY-MM-DD.md`.

3. Build the site:

```bash
npm run build
```

4. Open `dist/index.html` in your browser.

Notes

- Styling is in `public/style.css`.
- The build script is `scripts/build.js`.
- Compare page groups entries by month-day and shows years side-by-side.
- Stats use a simple tokenizer with English stopwords.


