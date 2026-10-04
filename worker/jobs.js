/** A stalled worker must not finish a job requeued, canceled or claimed again.
 * Match the exact processing revision returned by its atomic claim. */
export async function finishWorkerClaim(client, job, patch) {
  if (typeof job.id !== "string" || !job.id || typeof job.updated_at !== "string" ||
      !Number.isFinite(Date.parse(job.updated_at))) throw new Error("Invalid worker claim.");
  const { data, error } = await client.from("tool_jobs").update(patch)
    .eq("id", job.id).eq("status", "processing").eq("updated_at", job.updated_at).select("id");
  if (error) throw error;
  return Array.isArray(data) && data.length === 1;
}
