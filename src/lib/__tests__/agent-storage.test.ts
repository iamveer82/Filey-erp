import { beforeEach, expect, it, vi } from "vitest";
const identity = vi.hoisted(() => ({ scope: "org:user:alice" as string | null }));
vi.mock("../api", () => ({ getCacheScope: () => identity.scope }));
import { agentStorageScope } from "../agentStorage";
import { addMemory, listMemories } from "../aiMemory";
import { addSkill, loadSkills } from "../agentSkills";
import { addTask, loadTasks, updateTask } from "../agentTasks";
import { newChat, saveChats, loadChats, setActiveId, getActiveId } from "../aiChats";
import { recordRun, listRuns } from "../agentJournal";
import { setAgentMode, getAgentMode } from "../agentMode";
import { setCapabilityEnabled, isCapabilityEnabled } from "../capabilities";
import { seedDefaultSkills } from "../defaultSkills";
import { waLogAdd, waLogList } from "../waLog";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local");
  identity.scope = "org:user:alice";
});

it("isolates AI data and permissions by account, organization and storage mode", () => {
  addMemory("Alice's customer terms");
  addSkill({ name: "alice-procedure", description: "terms", instructions: "Ask Alice" });
  addTask({ name: "Alice task", goal: "Review Alice's invoices", schedule: { type: "interval", minutes: 10 } });
  const chat = newChat(); saveChats([chat]); setActiveId(chat.id);
  recordRun({ goal: "Alice's failed run", reason: "exhausted", failures: [] });
  waLogAdd({ dir: "in", from: "123", text: "Alice's message" });
  setAgentMode("auto"); setCapabilityEnabled("channels", false);
  for (const [mode, scope] of [["local", "org:user:bob"], ["local", "other:user:alice"], ["cloud", "org:user:alice"]]) {
    localStorage.setItem("filey_data_mode", mode); identity.scope = scope;
    expect([listMemories(), loadSkills(), loadTasks(), loadChats(), listRuns(), waLogList()]).toEqual([[], [], [], [], [], []]);
    expect(getActiveId()).toBeNull();
    expect(getAgentMode()).toBe("accept_edits");
    expect(isCapabilityEnabled("channels")).toBe(true);
  }
  localStorage.setItem("filey_data_mode", "local");
  expect(listMemories()[0].text).toContain("Alice");
  expect(loadTasks()[0].name).toBe("Alice task");
  expect(getActiveId()).toBe(chat.id);
  expect(getAgentMode()).toBe("auto");
  expect(isCapabilityEnabled("channels")).toBe(false);
});

it("preserves unattributed legacy data without adopting it or its permissions", () => {
  const keys = ["filey.ai.memory", "filey.agent.skills", "filey.agent.tasks", "filey.ai.chats", "filey.agent.journal", "filey.wa_log", "filey.ai.history"];
  for (const key of keys) localStorage.setItem(key, '[{"text":"private legacy data"}]');
  localStorage.setItem("filey.agent.mode", "auto");
  expect([listMemories(), loadSkills(), loadTasks(), loadChats(), listRuns(), waLogList()]).toEqual([[], [], [], [], [], []]);
  expect(getAgentMode()).toBe("accept_edits");
  addMemory("New private note");
  for (const key of keys) expect(localStorage.getItem(key)).toContain("private legacy data");
});

it.each(["plan", "manual"] as const)("retains restrictive legacy %s mode until an explicit workspace choice", (mode) => {
  localStorage.setItem("filey.agent.mode", mode);
  localStorage.setItem("filey.agent.capabilities", JSON.stringify({ sales: false, channels: true }));
  expect(getAgentMode()).toBe(mode);
  expect(isCapabilityEnabled("sales")).toBe(false);
  setAgentMode("accept_edits");
  setCapabilityEnabled("sales", true);
  expect(getAgentMode()).toBe("accept_edits");
  expect(isCapabilityEnabled("sales")).toBe(true);
  setCapabilityEnabled("channels", false);
  expect(isCapabilityEnabled("channels")).toBe(false);
  identity.scope = "org:user:bob";
  expect(getAgentMode()).toBe(mode);
  expect(isCapabilityEnabled("sales")).toBe(false);
  expect(localStorage.getItem("filey.agent.mode")).toBe(mode);
});

it("rejects late task and chat results after the workspace changes", () => {
  const task = addTask({ name: "A", goal: "Private goal", schedule: { type: "daily", time: "09:00" } });
  const scope = agentStorageScope()!;
  identity.scope = "org:user:bob";
  expect(() => updateTask(task.id, { lastResult: "private result" }, scope)).toThrow(/workspace changed/);
  expect(() => addSkill({ name: "Private imported skill", description: "Private", instructions: "Keep Alice's procedure" }, scope)).toThrow(/workspace changed/);
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(saveChats([{ ...newChat(), turns: [{ role: "assistant", text: "private result" }] }], scope)).toBe(false);
  quiet.mockRestore();
  recordRun({ goal: "Private result", reason: "exhausted", failures: [] }, scope);
  waLogAdd({ dir: "out", from: "123", text: "Private result" }, scope);
  expect([loadTasks(), loadChats(), listRuns(), waLogList()]).toEqual([[], [], [], []]);
});

it("seeds built-in skills separately for each workspace", () => {
  seedDefaultSkills(); const count = loadSkills().length;
  expect(count).toBeGreaterThan(0);
  identity.scope = "org:user:bob";
  seedDefaultSkills(); expect(loadSkills()).toHaveLength(count);
  seedDefaultSkills(); expect(loadSkills()).toHaveLength(count);
});

it("supports hosted cloud sessions without granting storage to anonymous users", () => {
  localStorage.removeItem("filey_data_mode");
  expect(agentStorageScope()).toBe("cloud:org:user:alice");
  addMemory("Cloud fact");
  localStorage.setItem("filey_data_mode", "cloud");
  expect(listMemories()[0].text).toBe("Cloud fact");
  identity.scope = null;
  expect(agentStorageScope()).toBeNull();
  expect(listMemories()).toEqual([]);
  expect(() => addTask({ name: "Anonymous", goal: "Do not save", schedule: { type: "interval", minutes: 1 } })).toThrow(/Sign in/);
});

it("preserves plan/action summaries without persisting raw run payloads", () => {
  const chat = newChat();
  chat.turns = [{ role: "assistant", text: "Done", run: { plan: [{ step: "Review invoices", status: "completed" }], actions: [{ id: "1", name: "find_invoices", status: "completed", detail: "3 invoices", args: { secret: "do not retain" } }], outcome: "Done", screenshot: "private bitmap" } } as never];
  expect(saveChats([chat])).toBe(true);
  const saved = loadChats()[0].turns[0].run!;
  expect(saved.plan[0].status).toBe("completed");
  expect(saved.actions[0].detail).toBe("3 invoices");
  expect(JSON.stringify(saved)).not.toMatch(/secret|screenshot|bitmap/);
});
