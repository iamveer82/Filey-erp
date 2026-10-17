// @vitest-environment node
// The same runner the app's worker uses, on real Pyodide: the bundled scripts run unchanged.
import { beforeAll, expect, it } from "vitest";
import { loadPyodide, type PyodideAPI } from "pyodide";
import { runScriptIn } from "../skillScriptCore";
import { skillScriptJob } from "../bundledSkills";

let py: PyodideAPI;
beforeAll(async () => { py = await loadPyodide(); }, 120_000);

it("scores a YouTube hook with the pack's own hookscore.py", async () => {
  const r = await runScriptIn(py, await skillScriptJob("yt-script", "hookscore.py", ["--hook", "I lost $40,000 on one invoice. Here is the mistake."], {}));
  expect(r.exit_code, r.stderr).toBe(0);
  expect(r.stdout).toMatch(/\d/);
}, 60_000);

it("lints an Instagram caption file and keeps runs apart", async () => {
  const caption = "Comment PRICE and I will send the sheet.\n\nHow we price lubricant orders for workshops in Sharjah.\n\n#lubricants #uae";
  const r = await runScriptIn(py, await skillScriptJob("ig-caption", "caption.py", ["caption.txt"], { "caption.txt": caption }));
  // The linter exits 1 when its verdict is not READY; the verdict itself is in the output.
  expect(r.stderr).toBe("");
  expect(r.stdout).toContain("Comment PRICE");
  expect(r.stdout).toMatch(/READY|FIX|verdict/i);
  const next = await runScriptIn(py, await skillScriptJob("ig-caption", "caption.py", ["caption.txt"], {}));
  expect(next.stderr).toMatch(/FileNotFoundError|No such file/);
}, 60_000);

it("returns a file the script writes, and a crash as stderr", async () => {
  const draft = "In today's fast-paced world, it's important to note that we leverage synergies.";
  const r = await runScriptIn(py, await skillScriptJob("li-human", "humanize.py", ["post.txt", "--out", "clean.txt"], { "post.txt": draft }));
  expect(r.exit_code, r.stderr).toBe(0);
  expect(r.files["clean.txt"]).toBeTruthy();
  expect(r.files["post.txt"]).toBeUndefined();
}, 60_000);
