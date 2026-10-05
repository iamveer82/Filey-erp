import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deliverFile } from "../agentFiles";
import { loadChats, newChat, saveChats } from "../aiChats";
import { agentStorageScope, readAgentStorage, writeAgentStorage } from "../agentStorage";
import { setCacheOrg } from "../api";
import { setDataMode } from "../dataMode";

vi.mock("../localPaths", () => ({ hasTauri: false }));

const revoke = vi.fn();
beforeEach(() => {
  localStorage.clear();
  setDataMode("local"); setCacheOrg("web-output-fixture", "owner");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => `blob:${crypto.randomUUID()}`) });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
  loadChats(); // release the previous scope before counting revocations
  revoke.mockClear();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => { saveChats([]); setCacheOrg(null); loadChats(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("keeps browser downloads usable across time and same-page chat history without persisting dead URLs", async () => {
  vi.useFakeTimers();
  const file = await deliverFile({ name: "Unlocked.pdf", bytes: new Uint8Array([1, 2, 3]) });
  const chat = { ...newChat(), turns: [{ role: "assistant" as const, text: "Unlocked", files: [file] }] };
  expect(saveChats([chat])).toBe(true);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(revoke).not.toHaveBeenCalled();
  expect(loadChats()[0].turns[0].files).toEqual([file]);
  expect(readAgentStorage("filey.ai.chats")).not.toContain("blob:");
  // Appending a question and saving history retains the original download.
  const reopened = loadChats()[0];
  reopened.turns.push({ role: "user", text: "Thanks" });
  expect(saveChats([reopened])).toBe(true);
  expect(loadChats()[0].turns[0].files).toEqual([file]);
  saveChats([]);
  expect(revoke).toHaveBeenCalledExactlyOnceWith(file.url);
});

it("releases outputs on account change and never restores them into another account or edited message", async () => {
  const file = await deliverFile({ name: "Private.pdf", bytes: new Uint8Array([4]) });
  const chat = { ...newChat(), turns: [{ role: "assistant" as const, text: "Private output", files: [file] }] };
  const firstScope = agentStorageScope()!;
  saveChats([chat], firstScope);
  setCacheOrg("other-account", "other-owner");
  expect(revoke).toHaveBeenCalledExactlyOnceWith(file.url);
  expect(loadChats()).toEqual([]);
  expect(revoke).toHaveBeenCalledExactlyOnceWith(file.url);
  setCacheOrg("web-output-fixture", "owner");
  expect(loadChats()[0].turns[0].files).toEqual([]);

  const fresh = await deliverFile({ name: "Fresh.pdf", bytes: new Uint8Array([5]) });
  chat.turns[0].files = [fresh]; saveChats([chat]);
  const persisted = JSON.parse(readAgentStorage("filey.ai.chats")!);
  persisted[0].turns[0].text = "Different message";
  localStorage.setItem(`filey.ai.chats:${encodeURIComponent(agentStorageScope()!)}`, JSON.stringify(persisted));
  expect(loadChats()[0].turns[0].files).toEqual([]);
});

it("revokes outputs during A → B → A without requiring an intervening chat read", async () => {
  const file = await deliverFile({ name: "Private.pdf", bytes: new Uint8Array([4]) });
  const chat = { ...newChat(), turns: [{ role: "assistant" as const, text: "Private output", files: [file] }] };
  expect(saveChats([chat])).toBe(true);
  writeAgentStorage("filey.agent.mode", "manual");
  expect(revoke).not.toHaveBeenCalled();
  setCacheOrg("other-account", "other-owner");
  setCacheOrg("web-output-fixture", "owner");
  expect(revoke).toHaveBeenCalledExactlyOnceWith(file.url);
  expect(loadChats()[0].turns[0].files).toEqual([]);
});
