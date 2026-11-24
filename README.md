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

Developed and tested with Node.js 22. The library lives in Supabase (Postgres and file storage), so the same account can continue the work from another device. Sign-in is limited to the emails in `ALLOWED_EMAILS`.

```bash
npm install
cp .env.example .env.local   # fill in Supabase, the database URLs, and at least one AI key
npm run db:migrate           # uses DIRECT_URL
npm run dev                  # http://localhost:3000
npm run worker               # in a second terminal; converts scans
```

`npm run build` and `npm start` run the production server locally. The worker is still required.

## Putting it online

Three services share one repository:

1. **Supabase.** Create a project. In Authentication, allow email sign-up (or create the user yourself). Copy the project URL, the anon key, and the service role key. Copy the pooler connection string (port 6543) as `DATABASE_URL` and the direct connection string (port 5432) as `DIRECT_URL`. From this repository, with those two URLs set, run `npm run db:migrate`. The private `scans` bucket is created on the first upload.
2. **Vercel.** Import the repository. Set every variable from `.env.example` except that Vercel does not need `DIRECT_URL`. Deploy. This serves the website and the requests that finish quickly, including tone and term suggestions.
3. **Railway.** Create a service from the same repository. The `railway.toml` start command runs `npm run worker` rather than the website. Set `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and the AI keys and model names. No public domain is needed. This is what renders pages and converts them to text; a Vercel function would be stopped before a long scan finished.

Scans upload from the browser straight to Supabase, so a large PDF does not have to pass through Vercel.

## Configuration

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project. The anon key is public and is used for sign-in. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server and worker only. Reads and writes scans. |
| `DATABASE_URL` | Pooler connection used by the website and the worker. |
| `DIRECT_URL` | Direct connection used by `npm run db:migrate`. |
| `ALLOWED_EMAILS` | Comma-separated emails that may sign in. Anyone else is refused. |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | At least one is required. |
| `ANTHROPIC_OCR_MODEL`, `OPENAI_OCR_MODEL` | Model that converts page images to text. |
| `ANTHROPIC_ANALYSIS_MODEL`, `OPENAI_ANALYSIS_MODEL` | Model that suggests tones and terms. |

Which provider does each job is chosen on the Settings page. The defaults are in `.env.example`.

## How terms are matched

Matching ignores case and matches whole words only, so `tax` does not match `taxes`; add `taxes` as a variant to count it under `tax`. Where terms overlap, the longest wins: with both `Soviet` and `Soviet Union` on the list, "Soviet Union" counts once, under `Soviet Union`.

## Development

```bash
npm test            # unit and service tests
npm run lint
npm run typecheck
npm run db:generate # after changing src/db/schema.ts
npm run db:migrate  # applies drizzle/ to the database in DIRECT_URL
```
