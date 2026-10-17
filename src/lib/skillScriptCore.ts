/* Runs one pre-installed skill script inside Pyodide. Shared by the app's worker
 * (skillScripts.worker.ts) and the tests, which run real Pyodide in Node.
 *
 * Every run starts from a fresh copy of the pack, so a script can neither keep
 * state between runs nor change another skill's files. Scripts are the vendored
 * ones in src/skills only (bundledSkills.ts checks that); the user's text comes in
 * as input files next to the script, exactly like `python3 x.py input.txt`. */
import type { PyodideAPI } from "pyodide";

export interface ScriptJob {
  /** Absolute path → text: the pack's files plus the input files. */
  files: Record<string, string>;
  /** Folder the script runs in (its own skill folder). */
  cwd: string;
  /** Script file name inside cwd. */
  script: string;
  args: string[];
  stdin?: string;
}

export interface ScriptResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  /** Files the script created or changed in its folder (an --out file). */
  files: Record<string, string>;
}

const ROOT = "/skills";

export async function runScriptIn(py: PyodideAPI, job: ScriptJob): Promise<ScriptResult> {
  let stdout = "", stderr = "";
  py.setStdout({ batched: (line) => { stdout += line + "\n"; } });
  py.setStderr({ batched: (line) => { stderr += line + "\n"; } });
  let fed = false;
  py.setStdin({ stdin: () => (fed ? null : ((fed = true), job.stdin ?? "")) });

  py.runPython(`import shutil; shutil.rmtree(${JSON.stringify(ROOT)}, ignore_errors=True)`);
  for (const [path, text] of Object.entries(job.files)) {
    py.FS.mkdirTree(path.slice(0, path.lastIndexOf("/")));
    py.FS.writeFile(path, text);
  }

  py.globals.set("_filey_job", py.toPy({ cwd: job.cwd, argv: [job.script, ...job.args], root: ROOT }));
  let exit = 0;
  try {
    exit = await py.runPythonAsync(`
import os, sys, runpy
_job = _filey_job
_path = list(sys.path)
os.chdir(_job["cwd"])
sys.argv = list(_job["argv"])
_code = 0
try:
    runpy.run_path(sys.argv[0], run_name="__main__")
except SystemExit as e:
    _code = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
finally:
    sys.path[:] = _path
    for _name, _mod in list(sys.modules.items()):
        if (getattr(_mod, "__file__", None) or "").startswith(_job["root"]):
            del sys.modules[_name]
_code
`);
  } catch (error) {
    // A Python exception: its traceback is the useful part.
    stderr += error instanceof Error ? error.message : String(error);
    exit = 1;
  }

  const files: Record<string, string> = {};
  for (const name of py.FS.readdir(job.cwd) as string[]) {
    const path = `${job.cwd}/${name}`;
    if (name === "." || name === ".." || py.FS.isDir(py.FS.stat(path).mode)) continue;
    const text = py.FS.readFile(path, { encoding: "utf8" }) as string;
    if (job.files[path] !== text) files[name] = text;
  }
  return { exit_code: exit, stdout, stderr, files };
}
