# Filey heavy-tool worker

Processes the PDF/AI tools that **can't** run in a Supabase Edge Function —
OCR, Office↔PDF, PDF/A, strong compression — using LibreOffice, OCRmyPDF
(Tesseract) and Ghostscript.

It polls the `tool_jobs` table for rows with `status='pending'` and
`engine='worker'`, downloads the input from the `tool-inputs` bucket, runs
the tool, uploads results to `tool-outputs`, and marks the job `done`/`error`.
The client (`src/lib/serverTools.ts`) just inserts the job with
`engine: "worker"` and polls for the result — no client changes needed.

## Supported tools (`tool` id → output)

| tool        | does                          | engine   |
|-------------|-------------------------------|----------|
| `office2pdf`| Word/Excel/PPT/… → PDF        | worker   |
| `pdf2docx`  | PDF → Word (best-effort)      | worker   |
| `ocr`       | scanned PDF → searchable PDF  | worker   |
| `pdfa`      | PDF → archival PDF/A          | worker   |
| `compress`  | strong Ghostscript compression| worker   |

Add more by adding a handler in `index.js`.

## Prerequisites

Run `supabase/tool-jobs.sql` first (creates `tool_jobs` + `tool-inputs`).
Grab the **service-role** key from Supabase → Project Settings → API.

## Run locally (Docker)

```bash
cp .env.example .env   # fill in SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
docker build -t filey-worker .
docker run --rm --env-file .env filey-worker
```

## Deploy — Fly.io

```bash
fly launch --no-deploy            # adopts fly.toml
fly secrets set SUPABASE_URL=https://xxx.supabase.co \
                SUPABASE_SERVICE_ROLE_KEY=eyJ...
fly deploy
```

## Deploy — Railway

1. New service → Deploy from repo, set **root directory** to `worker/`.
2. It builds the Dockerfile automatically.
3. Add variables `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

## Notes

- The service-role key bypasses RLS — keep it server-only, never in the app.
- Outputs are written to `{user_id}/{job_id}/...` in `tool-outputs`, so each
  user can read their own results under existing storage RLS.
- Scale out by running more instances; the atomic claim (status guard)
  prevents two workers taking the same job.
- LibreOffice/OCR are heavy — 2 GB RAM recommended per instance.
