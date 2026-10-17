/* Main-thread side of the skill script runner: one worker, one run at a time. */
import type { ScriptJob, ScriptResult } from "./skillScriptCore";

let worker: Worker | null = null;
let queue: Promise<unknown> = Promise.resolve();
let seq = 0;

function stop() {
  worker?.terminate();
  worker = null;
}

function runNow(job: ScriptJob, timeoutMs: number, signal?: AbortSignal): Promise<ScriptResult> {
  worker ??= new Worker(new URL("./skillScripts.worker.ts", import.meta.url), { type: "module" });
  const runner = worker, id = ++seq;
  return new Promise((resolve, reject) => {
    const done = () => { clearTimeout(timer); runner.removeEventListener("message", onMessage); signal?.removeEventListener("abort", onAbort); };
    // A stuck script cannot be interrupted inside Pyodide; dropping the worker is the only stop.
    const timer = setTimeout(() => { done(); stop(); reject(new Error("The script took too long and was stopped.")); }, timeoutMs);
    const onAbort = () => { done(); stop(); reject(signal?.reason ?? new Error("Stopped.")); };
    const onMessage = (event: MessageEvent<{ id: number; result?: ScriptResult; error?: string }>) => {
      if (event.data.id !== id) return;
      done();
      if (event.data.error) reject(new Error(`Python could not start: ${event.data.error}`));
      else resolve(event.data.result!);
    };
    runner.addEventListener("message", onMessage);
    signal?.addEventListener("abort", onAbort, { once: true });
    runner.postMessage({ id, job });
  });
}

/** The first run also downloads Python, so it gets longer. */
export function runSkillScriptJob(job: ScriptJob, signal?: AbortSignal): Promise<ScriptResult> {
  const timeout = worker ? 30_000 : 120_000;
  const run = queue.then(() => runNow(job, timeout, signal));
  queue = run.catch(() => undefined);
  return run;
}
