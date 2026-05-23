// Supabase Edge Function: run a light PDF tool server-side.
//
// Deploy:
//   supabase functions deploy run-tool
// (requires the tool_jobs table + tool-inputs/tool-outputs buckets from
//  supabase/tool-jobs.sql and the existing schema.)
//
// Auth: requires a valid Supabase JWT (verified by default). The function
// acts AS the caller (forwards their Authorization header), so RLS scopes
// every read/write to that user's own job and storage folder.
//
// Body: { jobId: string }. The job row must already exist with the input
// uploaded to the tool-inputs bucket. Heavy tools (engine='worker') are
// NOT handled here — a self-hosted worker processes those.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, degrees } from "https://esm.sh/pdf-lib@1.17.1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface OutFile {
  name: string;
  bytes: Uint8Array;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  let client: SupabaseClient | null = null;
  let jobId: string | null = null;

  try {
    const auth = req.headers.get("Authorization") ?? "";
    client = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } }
    );

    const { data: u } = await client.auth.getUser();
    const user = u.user;
    if (!user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    jobId = body?.jobId ?? null;
    if (!jobId) return json({ error: "jobId is required" }, 400);

    // RLS ensures the job belongs to the caller.
    const { data: job, error: jErr } = await client
      .from("tool_jobs")
      .select("*")
      .eq("id", jobId)
      .single();
    if (jErr || !job) return json({ error: "Job not found" }, 404);

    // Defense in depth: the input must live under the caller's own folder.
    // (Storage RLS already enforces this for the caller's token, but reject
    // explicitly so a tampered input_path can never be processed.)
    if (!String(job.input_path).startsWith(`${user.id}/`)) {
      return json({ error: "Forbidden: input path mismatch" }, 403);
    }

    await client
      .from("tool_jobs")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", jobId);

    // Download the uploaded input.
    const dl = await client.storage.from("tool-inputs").download(job.input_path);
    if (dl.error || !dl.data) throw new Error("Input file not found in storage.");
    const input = new Uint8Array(await dl.data.arrayBuffer());

    const outputs = await runTool(job.tool, input, job.params ?? {}, job.file_name);

    // Store outputs in the per-user tool-outputs folder.
    const paths: string[] = [];
    let total = 0;
    for (let i = 0; i < outputs.length; i++) {
      const o = outputs[i];
      const path = `${user.id}/${jobId}/${i}_${o.name}`;
      const up = await client.storage
        .from("tool-outputs")
        .upload(path, new Blob([o.bytes], { type: "application/pdf" }), {
          upsert: true,
          contentType: "application/pdf",
        });
      if (!up.error) {
        paths.push(path);
        total += o.bytes.byteLength;
      }
    }

    await client
      .from("tool_jobs")
      .update({
        status: "done",
        output_paths: paths,
        size_bytes: total,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    return json({ ok: true, outputPaths: paths });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (client && jobId) {
      try {
        await client
          .from("tool_jobs")
          .update({ status: "error", error: msg, updated_at: new Date().toISOString() })
          .eq("id", jobId);
      } catch {
        /* best effort */
      }
    }
    return json({ error: msg }, 500);
  }
});

// Light, pure-JS PDF tools. Add new cases here as the set grows.
async function runTool(
  tool: string,
  bytes: Uint8Array,
  params: Record<string, unknown>,
  fileName: string
): Promise<OutFile[]> {
  const base = (fileName || "document").replace(/\.pdf$/i, "");

  switch (tool) {
    case "rotate": {
      const deg = Number(params.degrees ?? 90);
      const pdf = await PDFDocument.load(bytes);
      for (const page of pdf.getPages()) {
        const next = (page.getRotation().angle + deg) % 360;
        page.setRotation(degrees(next));
      }
      const out = await pdf.save();
      return [{ name: `${base}-rotated.pdf`, bytes: new Uint8Array(out) }];
    }
    default:
      throw new Error(`Unsupported tool: ${tool}`);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
