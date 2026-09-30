import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { runTool, TOOLS } from "../aiTools";
import { coachResult } from "../agentGuard";
import { setCacheOrg } from "../api";
import { setDataMode } from "../dataMode";
import { setAgentMode } from "../agentMode";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../log", async original => ({ ...await original<typeof import("../log")>(), log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
  setCacheOrg("shell-fixture-org", "shell-fixture-owner");
  setAgentMode("auto");
  vi.mocked(invoke).mockReset();
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
});
afterEach(() => { delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__; setCacheOrg(null); });

describe("agent shell command results", () => {
  it("marks a nonzero native exit failed and never coaches a blind retry", async () => {
    vi.mocked(invoke).mockResolvedValue({ stdout: "Created a draft before failure", stderr: "The command failed", exit_code: 1, cwd: "fixture" });
    const result = await runTool("run_shell", { command: "fixture command" }, () => true, true);
    expect(result).toMatchObject({ ok: false, exit_code: 1, retry_safe: false, error: expect.stringContaining("Some effects may already have occurred") });
    expect(coachResult(result, 10)).toBe(result);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it("reports only a confirmed zero exit successful", async () => {
    vi.mocked(invoke).mockResolvedValue({ stdout: "Done", stderr: "", exit_code: 0, cwd: "fixture" });
    expect(await runTool("run_shell", { command: "fixture command" }, () => true, true)).toMatchObject({ ok: true, exit_code: 0, stdout: "Done" });
  });
  it.each(["cancel", "workspace"] as const)("does not dispatch after %s during native module loading", async reason => {
    const controller = new AbortController();
    const pending = TOOLS.find(tool => tool.name === "run_shell")!.run({ command: "fixture command" }, controller.signal);
    if (reason === "cancel") controller.abort();
    else setCacheOrg("other-fixture-org", "other-fixture-owner");
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(invoke).not.toHaveBeenCalled();
  });
});
