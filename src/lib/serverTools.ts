// Client pipeline for server-side tools (Supabase). Uploads an input file
// to the private tool-inputs bucket, creates a tool_jobs row, then runs it
// via the run-tool edge function (light tools) or lets a self-hosted worker
// pick it up (heavy tools). Outputs land in the tool-outputs bucket — reuse
// downloadBytes / signedUrl from toolStorage to fetch them.
import { sb, isConfigured } from "./supabase";

export type ToolEngine = "edge" | "worker";

export interface ServerToolResult {
  jobId: string;
  outputPaths: string[];
}

const INPUT_BUCKET = "tool-inputs";

const sanitize = (name: string) =>
  name.replace(/[^\w.\-]+/g, "_").slice(0, 80) || "file";

/** Run a tool on the server. Resolves once the output is ready in storage. */
export async function runServerTool(opts: {
  tool: string;
  file: File;
  params?: Record<string, unknown>;
  engine?: ToolEngine;
  /** Max wait before giving up (ms). Workers may need longer. */
  timeoutMs?: number;
}): Promise<ServerToolResult> {
  if (!isConfigured) throw new Error("Supabase is not configured.");
  const client = sb();
  const engine: ToolEngine = opts.engine ?? "edge";

  const { data: u } = await client.auth.getUser();
  const uid = u.user?.id;
  if (!uid) throw new Error("Please sign in to use tools.");

  // crypto.randomUUID is available in all supported browsers.
  const jobId = crypto.randomUUID();
  const inputPath = `${uid}/${jobId}/${sanitize(opts.file.name)}`;

  // 1. upload the source file
  const up = await client.storage
    .from(INPUT_BUCKET)
    .upload(inputPath, opts.file, { upsert: true });
  if (up.error) throw up.error;

  // 2. create the job
  const { error: jErr } = await client.from("tool_jobs").insert({
    id: jobId,
    tool: opts.tool,
    engine,
    input_path: inputPath,
    params: opts.params ?? {},
    file_name: opts.file.name,
  });
  if (jErr) throw jErr;

  // 3a. light tools: invoke the edge function (it processes synchronously)
  if (engine === "edge") {
    const { error: fErr } = await client.functions.invoke("run-tool", {
      body: { jobId },
    });
    if (fErr) {
      await markError(jobId, fErr.message);
      throw fErr;
    }
  }

  // 3b. wait for completion (edge job is already done; worker takes longer)
  return waitForJob(jobId, opts.timeoutMs ?? (engine === "worker" ? 180000 : 60000));
}

async function waitForJob(
  jobId: string,
  timeoutMs: number
): Promise<ServerToolResult> {
  const client = sb();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data } = await client
      .from("tool_jobs")
      .select("status, output_paths, error")
      .eq("id", jobId)
      .single();
    if (data?.status === "done")
      return { jobId, outputPaths: (data.output_paths as string[]) ?? [] };
    if (data?.status === "error")
      throw new Error((data.error as string) || "Tool failed.");
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error("Tool timed out. Try again or use a smaller file.");
}

async function markError(jobId: string, msg: string) {
  try {
    await sb()
      .from("tool_jobs")
      .update({ status: "error", error: msg })
      .eq("id", jobId);
  } catch {
    /* best effort */
  }
}

/** List the current user's recent jobs (for a history/queue view). */
export async function listJobs(limit = 30) {
  if (!isConfigured) return [];
  const { data } = await sb()
    .from("tool_jobs")
    .select("id, tool, status, file_name, output_paths, error, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}
