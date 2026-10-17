/// <reference lib="webworker" />
// Pyodide lives in this worker: the first run loads it (about 13 MB, served from /pyodide/),
// later runs reuse it. The main thread terminates the worker if a run takes too long.
import { loadPyodide, type PyodideAPI } from "pyodide";
import { runScriptIn, type ScriptJob } from "./skillScriptCore";

let runtime: Promise<PyodideAPI> | null = null;

self.onmessage = async (event: MessageEvent<{ id: number; job: ScriptJob }>) => {
  const { id, job } = event.data;
  try {
    runtime ??= loadPyodide({ indexURL: new URL("/pyodide/", self.location.origin).href });
    const result = await runScriptIn(await runtime, job);
    self.postMessage({ id, result });
  } catch (error) {
    runtime = null;
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
