# AEB-Textual-Analysis

A web application for analysing the text of scanned speeches:

- Upload scanned PDFs or images; each page is converted to text by a vision model and can be checked against the page image and corrected.
- Combine documents (a speech spread over several scans) or split one (a scan holding several speeches).
- Keep a list of terms, with optional variants counted under the same term.
- Count how often each term appears in all documents or a selection, and export the counts.
- Read a document with its terms highlighted and give each occurrence a tone. Tones are yours to define; the defaults are very negative, negative, neutral, positive, and very positive.
- Ask the AI to suggest the tone of one occurrence or of every occurrence in a document. Suggestions are marked until you confirm them.
- Describe what the analysis is for and have the AI look for terms you may have overlooked, then include or exclude each one.

## Running it

Developed and tested with Node.js 22.

```bash
npm install
cp .env.example .env.local   # then add ANTHROPIC_API_KEY and/or OPENAI_API_KEY
npm run build
npm start                    # http://localhost:3000
```

`npm run dev` runs the development server instead.

The app is for one user on one machine: there is no login. The database and uploaded scans are stored in `./data` (set `DATA_DIR` to keep them elsewhere). Back up that folder to back up your work.

## Configuration

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | At least one is required. |
| `ANTHROPIC_OCR_MODEL`, `OPENAI_OCR_MODEL` | Model that converts page images to text. |
| `ANTHROPIC_ANALYSIS_MODEL`, `OPENAI_ANALYSIS_MODEL` | Model that suggests tones and terms. |
| `DATA_DIR` | Where the database and scans are kept. |

Which provider does each job is chosen on the Settings page. The defaults are in `.env.example`.

## How terms are matched

Matching ignores case and matches whole words only, so `tax` does not match `taxes`; add `taxes` as a variant to count it under `tax`. Where terms overlap, the longest wins: with both `Soviet` and `Soviet Union` on the list, "Soviet Union" counts once, under `Soviet Union`.

## Development

```bash
npm test            # unit and service tests
npm run lint
npm run typecheck
npm run db:generate # after changing src/db/schema.ts
```
