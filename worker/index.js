// Filey heavy-tool worker.
//
// Polls the tool_jobs table for pending jobs with engine='worker' and runs
// the heavy tools that can't run in a Supabase Edge Function: OCR, Office
// <-> PDF, PDF/A, strong compression. Uses the service-role key (bypasses
// RLS) so it can read any user's input and write to their output folder.
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional env: POLL_INTERVAL_MS (default 5000)
//
// External binaries (installed in the Docker image): soffice (LibreOffice),
// ocrmypdf, gs (Ghostscript), tesseract.

import { createClient } from "@supabase/supabase-js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const run = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_MS = Number(process.env.POLL_INTERVAL_MS || 5000);

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const INPUT_BUCKET = "tool-inputs";
const OUTPUT_BUCKET = "tool-outputs";
const PDF = "application/pdf";
const DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// tool id -> handler(workDir, inputFile, base) => [{ name, file, type }]
const handlers = {
  // Word / Excel / PowerPoint / etc. -> PDF
  async office2pdf(dir, input, base) {
    await run(
      "soffice",
      ["--headless", "--convert-to", "pdf", "--outdir", dir, input],
      { timeout: 180000 }
    );
    const out = path.join(dir, `${base}.pdf`);
    return [{ name: `${base}.pdf`, file: out, type: PDF }];
  },

  // PDF -> editable Word (best-effort via LibreOffice's PDF import)
  async pdf2docx(dir, input, base) {
    await run(
      "soffice",
      [
        "--headless",
        "--infilter=writer_pdf_import",
        "--convert-to",
        "docx",
        "--outdir",
        dir,
        input,
      ],
      { timeout: 180000 }
    );
    const out = path.join(dir, `${base}.docx`);
    return [{ name: `${base}.docx`, file: out, type: DOCX }];
  },

  // Make a scanned PDF searchable (OCR). --skip-text leaves existing text.
  async ocr(dir, input, base) {
    const out = path.join(dir, `${base}-ocr.pdf`);
    await run("ocrmypdf", ["--skip-text", input, out], { timeout: 600000 });
    return [{ name: `${base}-ocr.pdf`, file: out, type: PDF }];
  },

  // Archival PDF/A (ocrmypdf emits compliant PDF/A).
  async pdfa(dir, input, base) {
    const out = path.join(dir, `${base}-pdfa.pdf`);
    await run(
      "ocrmypdf",
      ["--skip-text", "--output-type", "pdfa", input, out],
      { timeout: 600000 }
    );
    return [{ name: `${base}-pdfa.pdf`, file: out, type: PDF }];
  },

  // Strong compression via Ghostscript.
  async compress(dir, input, base) {
    const out = path.join(dir, `${base}-compressed.pdf`);
    await run(
      "gs",
      [
        "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.5",
        "-dPDFSETTINGS=/ebook",
        "-dNOPAUSE",
        "-dBATCH",
        "-dQUIET",
        `-sOutputFile=${out}`,
        input,
      ],
      { timeout: 300000 }
    );
    return [{ name: `${base}-compressed.pdf`, file: out, type: PDF }];
  },
};

/** Claim the oldest pending worker job atomically (status guard prevents
 *  two workers grabbing the same job). Returns the job or null. */
async function claimJob() {
  const { data: rows } = await sb
    .from("tool_jobs")
    .select("*")
    .eq("status", "pending")
    .eq("engine", "worker")
    .order("created_at", { ascending: true })
    .limit(1);
  const job = rows?.[0];
  if (!job) return null;

  const { data: claimed } = await sb
    .from("tool_jobs")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("status", "pending")
    .select()
    .maybeSingle();
  return claimed ?? null; // null = another worker took it
}

async function processJob(job) {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "filey-"));
  try {
    const handler = handlers[job.tool];
    if (!handler) throw new Error(`Unsupported worker tool: ${job.tool}`);

    // Security: this worker uses the service-role key (bypasses storage
    // RLS), so it MUST only ever read the job owner's own input. The
    // input_path is a client-set field — reject anything not under the
    // owner's folder, or a user could read another user's files.
    if (!job.input_path || !String(job.input_path).startsWith(`${job.user_id}/`)) {
      throw new Error("input_path does not belong to the job owner.");
    }

    const dl = await sb.storage.from(INPUT_BUCKET).download(job.input_path);
    if (dl.error || !dl.data) throw new Error("Input file not found.");

    const safeName = (job.file_name || "input").replace(/[^\w.\-]+/g, "_");
    const inputFile = path.join(work, safeName);
    await fs.writeFile(inputFile, Buffer.from(await dl.data.arrayBuffer()));
    const base = safeName.replace(/\.[^.]+$/, "");

    const outputs = await handler(work, inputFile, base);

    const paths = [];
    let total = 0;
    for (let i = 0; i < outputs.length; i++) {
      const o = outputs[i];
      const buf = await fs.readFile(o.file);
      const dest = `${job.user_id}/${job.id}/${i}_${o.name}`;
      const up = await sb.storage
        .from(OUTPUT_BUCKET)
        .upload(dest, buf, { upsert: true, contentType: o.type });
      if (!up.error) {
        paths.push(dest);
        total += buf.length;
      }
    }

    await sb
      .from("tool_jobs")
      .update({
        status: "done",
        output_paths: paths,
        size_bytes: total,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    console.log(`✓ ${job.tool} ${job.id} -> ${paths.length} file(s)`);
  } catch (e) {
    const msg = (e && e.message) || String(e);
    await sb
      .from("tool_jobs")
      .update({
        status: "error",
        error: msg.slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    console.error(`✗ ${job.id}: ${msg}`);
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

async function main() {
  console.log(
    `Filey worker up. Tools: ${Object.keys(handlers).join(", ")}. Polling every ${POLL_MS}ms.`
  );
  for (;;) {
    try {
      const job = await claimJob();
      if (job) await processJob(job);
      else await sleep(POLL_MS);
    } catch (e) {
      console.error("loop error:", (e && e.message) || e);
      await sleep(POLL_MS);
    }
  }
}

main();
