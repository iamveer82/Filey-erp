// Supabase Edge Function: run a light PDF tool server-side.
//
// Deploy:
//   supabase functions deploy run-tool
// (requires the tool_jobs table + tool-inputs/tool-outputs buckets from
//  supabase/tool-jobs.sql, 2026-10-04-tool-job-authority.sql and existing schema.)
//
// Auth: requires a valid Supabase JWT (verified by default). The function
// reads jobs/files AS the caller (forwards their Authorization header), so
// RLS scopes inputs/outputs to the user's own storage folder. Server-only
// status writes bind the verified user, pending edge job and captured claim.
//
// Body: { jobId: string }. The job row must already exist with the input
// uploaded to the tool-inputs bucket. Heavy tools (engine='worker') are
// NOT handled here — a self-hosted worker processes those.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { mfaAllowed, MFA_REQUIRED } from "../_shared/mfa.ts";
import { ownedToolPath, toolFilename } from "../_shared/tool-path.ts";
import { PDFDocument, degrees } from "https://esm.sh/pdf-lib@1.17.1";
import { logAction } from "../_shared/rateLimit.ts";
import { BillingRequestError, readBillingBody } from "../_shared/billing-request.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let adminClient: SupabaseClient | null = null;
  let claimed: { id: string; user_id: string; updated_at: string } | null = null;

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const client = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } }
    );

    const { data: u } = await client.auth.getUser();
    const user = u.user;
    if (!user) return json({ error: "Unauthorized" }, 401);
    if (!mfaAllowed(user, auth.replace(/^Bearer\s+/i, ""))) return json(MFA_REQUIRED, 403);

    let body: unknown;
    try { body = JSON.parse(await readBillingBody(req, 4096)); }
    catch (error) {
      if (error instanceof BillingRequestError) return json({ error: "Tool request is too large" }, 413);
      return json({ error: "Invalid tool request" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)
      || typeof (body as {jobId?: unknown}).jobId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test((body as {jobId: string}).jobId)) {
      return json({ error: "A valid jobId is required" }, 400);
    }
    const jobId = (body as {jobId: string}).jobId;

    // The INSERT trigger admits 15 jobs/hour for both engines. Execution does
    // not reserve a second slot for the same already-admitted job.
    adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
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
    if (!ownedToolPath(job.input_path, user.id)) {
      return json({ error: "Forbidden: input path mismatch" }, 403);
    }
    if (job.engine !== "edge" || job.tool !== "rotate") return json({ error: "This job requires its configured worker" }, 400);
    const rotation = Number(job.params?.degrees ?? 90);
    if (!Number.isFinite(rotation) || !Number.isInteger(rotation / 90)) return json({ error: "Rotation must be a multiple of 90 degrees" }, 400);

    // One request claims the immutable specification. Clients cannot rewrite
    // status/inputs mid-run; a duplicate/retry cannot run the same job twice.
    const { data: activeJob, error: claimError } = await adminClient
      .from("tool_jobs")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", jobId)
      .eq("user_id", user.id)
      .eq("engine", "edge")
      .eq("status", "pending")
      .eq("updated_at", job.updated_at)
      .select("*")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!activeJob) return json({ error: "This job is already running or has finished. Check its result before retrying." }, 409);
    claimed = activeJob;
    await logAction(adminClient, user.id, "run_tool", { jobId });
    // The row returned by the conditional claim is authoritative, even when
    // a trusted server edited the pending specification after the first read.
    if (!ownedToolPath(activeJob.input_path, user.id) || activeJob.tool !== "rotate") throw new Error("Invalid claimed tool job");

    // Download the uploaded input.
    const dl = await client.storage.from("tool-inputs").download(activeJob.input_path);
    if (dl.error || !dl.data) throw new Error("Input file not found in storage.");
    if (dl.data.size > 52_428_800) throw new Error("Tool input is too large");
    const input = new Uint8Array(await dl.data.arrayBuffer());

    const outputs = await runTool(activeJob.tool, input, activeJob.params ?? {}, activeJob.file_name);

    // Store outputs in the per-user tool-outputs folder.
    const paths: string[] = [];
    let total = 0;
    for (let i = 0; i < outputs.length; i++) {
      const o = outputs[i];
      const path = `${user.id}/${activeJob.id}/${activeJob.updated_at.replace(/[^0-9]/g, "")}/${i}_${toolFilename(o.name)}`;
      if (!ownedToolPath(path, user.id)) throw new Error("Invalid tool output path.");
      const up = await client.storage
        .from("tool-outputs")
        // `as BlobPart`: newer Deno lib types declare Uint8Array over
        // ArrayBufferLike, which BlobPart (ArrayBuffer only) won't accept. The
        // bytes are a plain Uint8Array at runtime, so the cast is the whole fix.
        .upload(path, new Blob([o.bytes as BlobPart], { type: "application/pdf" }), {
          upsert: true,
          contentType: "application/pdf",
        });
      if (up.error) throw new Error(`Could not save ${o.name}: ${up.error.message}`);
      paths.push(path);
      total += o.bytes.byteLength;
    }

    const { data: completed, error: completionError } = await adminClient
      .from("tool_jobs")
      .update({
        status: "done",
        output_paths: paths,
        size_bytes: total,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("user_id", user.id)
      .eq("status", "processing")
      .eq("updated_at", activeJob.updated_at)
      .select("id")
      .maybeSingle();
    if (completionError) throw completionError;
    if (!completed) return json({ error: "This tool run was replaced or cancelled. Refresh its status." }, 409);

    return json({ ok: true, outputPaths: paths });
  } catch (e) {
    const msg = "The tool could not finish. Check the job status before trying again.";
    if (adminClient && claimed) {
      try {
        await adminClient
          .from("tool_jobs")
          .update({ status: "error", error: msg, updated_at: new Date().toISOString() })
          .eq("id", claimed.id)
          .eq("user_id", claimed.user_id)
          .eq("status", "processing")
          .eq("updated_at", claimed.updated_at);
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
        const next = ((page.getRotation().angle + deg) % 360 + 360) % 360;
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
