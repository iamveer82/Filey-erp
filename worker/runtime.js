/** Server credentials must never follow a redirect to another origin. */
export function workerFetch(fetcher = globalThis.fetch, timeoutMs = 30000) {
  return async (input, init = {}) => {
    const controller = new AbortController();
    const caller = init.signal ?? (input instanceof Request ? input.signal : undefined);
    const abort = () => controller.abort(caller.reason);
    if (caller?.aborted) abort();
    else caller?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error("Worker request timed out.")), timeoutMs);
    try {
      return await fetcher(input, { ...init, redirect: "error", signal: controller.signal });
    } finally {
      clearTimeout(timer);
      caller?.removeEventListener("abort", abort);
    }
  };
}

/** Document parsers do not need Supabase, payment, AI or other server secrets.
 * An allowlist also excludes loader hooks and authenticated proxy settings. */
export function converterEnvironment(workDir, source = process.env) {
  const env = {};
  for (const key of ["PATH", "Path", "SystemRoot", "WINDIR", "SystemDrive", "COMSPEC", "LANG", "LC_ALL", "LC_CTYPE", "TZ"]) {
    if (typeof source[key] === "string") env[key] = source[key];
  }
  return { ...env, HOME: workDir, USERPROFILE: workDir, APPDATA: workDir,
    LOCALAPPDATA: workDir, TMPDIR: workDir, TMP: workDir, TEMP: workDir };
}

export function runConverter(execute, executable, args, workDir, timeout) {
  return execute(executable, args, {
    timeout, cwd: workDir, env: converterEnvironment(workDir), maxBuffer: 1024 * 1024,
  });
}

// Converter stderr can contain document text, paths and parser diagnostics.
// Neither a user's job receipt nor shared worker logs may publish that output.
export const CONVERSION_FAILURE = "File conversion failed. Check that the file is supported and try again.";

export async function reportConversionFailure(client, job, finishClaim, log = console.error) {
  try {
    await finishClaim(client, job, {
      status: "error", error: CONVERSION_FAILURE, updated_at: new Date().toISOString(),
    });
  } catch { log(`Could not persist failure for job ${job.id}.`); }
  log(`Conversion failed for job ${job.id}.`);
}
