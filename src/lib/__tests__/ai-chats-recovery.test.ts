import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatHistoryNeedsRecovery, loadChats, newChat, repairChatHistory, saveChats } from "../aiChats";
import { agentStorageKey, agentStorageScope } from "../agentStorage";
import { setCacheOrg } from "../api";
import { setDataMode } from "../dataMode";

beforeEach(() => {
  localStorage.clear();
  setDataMode("local");
  setCacheOrg("history-fixture", "owner");
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect(saveChats([])).toBe(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  setCacheOrg(null);
});

function stored(value: unknown): string {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  localStorage.setItem(agentStorageKey("filey.ai.chats")!, raw);
  return raw;
}

function conversation() {
  return { ...newChat(), title: "Invoice question", turns: [{ role: "user" as const, text: "Private invoice question" }] };
}

describe("chat history recovery", () => {
  it("keeps valid conversations readable when another saved record is malformed", () => {
    const good = conversation();
    stored([good, { ...newChat(), turns: null }]);
    expect(chatHistoryNeedsRecovery()).toBe(true);
    expect(loadChats()).toEqual([good]);
  });

  it("salvages valid turns without letting a normal save discard unreadable source", () => {
    const good = conversation();
    const raw = stored([{ ...good, turns: [null, ...good.turns, { role: "tool", text: "Unreadable role" }] }]);
    expect(loadChats()[0].turns).toEqual(good.turns);
    const failed = vi.fn();
    window.addEventListener("filey:chats:save-failed", failed);
    try {
      expect(saveChats([...loadChats(), newChat()])).toBe(false);
      expect(localStorage.getItem(agentStorageKey("filey.ai.chats")!)).toBe(raw);
      expect(failed).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("Private invoice question");
    } finally {
      window.removeEventListener("filey:chats:save-failed", failed);
    }
  });

  it.each(["{\"private\":\"sensitive broken JSON", "null", "{}", "[null]"])("does not overwrite wholly unreadable history: %s", (raw) => {
    stored(raw);
    expect(loadChats()).toEqual([]);
    expect(saveChats([conversation()])).toBe(false);
    expect(localStorage.getItem(agentStorageKey("filey.ai.chats")!)).toBe(raw);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("sensitive broken JSON");
  });

  it("does not treat a blocked read as an empty store and overwrite prior history", () => {
    const raw = stored([conversation()]);
    const key = agentStorageKey("filey.ai.chats")!;
    const original = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, name: string) {
      if (name === key) throw new DOMException("Storage blocked", "SecurityError");
      return original.call(this, name);
    });
    expect(chatHistoryNeedsRecovery()).toBe(true);
    expect(loadChats()).toEqual([]);
    expect(saveChats([newChat()])).toBe(false);
    vi.restoreAllMocks();
    expect(localStorage.getItem(key)).toBe(raw);
  });

  it("drops unsafe saved links and malformed optional metadata while preserving the message", () => {
    const good = conversation();
    stored([{ ...good, turns: [{ ...good.turns[0], files: [
      { name: "Remote", path: "https://attacker.example/private", url: "javascript:alert(1)" },
      { name: "Script", path: "javascript:alert(1)" },
      { name: "Network", path: "\\\\attacker.example\\share\\private.pdf" },
      { name: "Network URI", path: "file://attacker.example/share/private.pdf" },
      { name: "Dead URL", url: "blob:expired" },
      { name: "Windows PDF", path: "C:/Filey/Exports/invoice.pdf" },
      { name: "Mac PDF", path: "/Users/filey/Exports/invoice.pdf" },
      { name: "Mobile PDF", path: "file:///var/mobile/filey/outputs/invoice.pdf" },
      { name: "Video", videoJobId: "video-fixture-123" },
      { name: "Image", mediaJobId: "media-fixture-456" },
      null,
    ], run: { plan: null, actions: [{ id: "1", name: "lookup", status: "completed", detail: "Done", args: { secret: "private payload" } }], outcome: "Done" } }] }]);
    const turn = loadChats()[0].turns[0];
    expect(turn.text).toBe(good.turns[0].text);
    expect(turn.files).toEqual([
      { name: "Windows PDF", path: "C:/Filey/Exports/invoice.pdf" },
      { name: "Mac PDF", path: "/Users/filey/Exports/invoice.pdf" },
      { name: "Mobile PDF", path: "file:///var/mobile/filey/outputs/invoice.pdf" },
      { name: "Video", videoJobId: "video-fixture-123" },
      { name: "Image", mediaJobId: "media-fixture-456" },
    ]);
    expect(turn.run).toEqual({ plan: [], actions: [{ id: "1", name: "lookup", status: "completed", detail: "Done" }], outcome: "Done" });
    expect(JSON.stringify(turn)).not.toMatch(/javascript:|attacker|blob:|private payload/);
  });

  it("keeps a manual title independent from the derived title and normalizes its length", () => {
    const good = conversation();
    stored([{ ...good, title: "  Month-end review  ", customTitle: "  Month-end review  " }]);
    expect(loadChats()[0]).toMatchObject({ customTitle: "Month-end review", title: "Month-end review" });
    stored([{ ...good, customTitle: "x".repeat(150) }]);
    expect(loadChats()[0].customTitle).toHaveLength(120);
    stored([{ ...good, customTitle: "   " }]);
    expect(loadChats()[0]).not.toHaveProperty("customTitle");
    expect(agentStorageScope()).toBeTruthy();
  });

  it("repairs only on explicit request after preserving the exact source in this workspace", () => {
    const good = conversation();
    const raw = stored([good, { ...newChat(), turns: null }]);
    const backup = agentStorageKey("filey.ai.chats.recovery")!;
    expect(loadChats()).toEqual([good]);
    expect(saveChats([good])).toBe(false);
    expect(localStorage.getItem(backup)).toBeNull();
    expect(repairChatHistory(agentStorageScope()!)).toBe(true);
    expect(chatHistoryNeedsRecovery()).toBe(false);
    expect(localStorage.getItem(backup)).toBe(raw);
    expect(loadChats()).toEqual([good]);
    expect(saveChats([...loadChats(), newChat()])).toBe(true);
    const repaired = localStorage.getItem(agentStorageKey("filey.ai.chats")!);
    expect(repairChatHistory()).toBe(true);
    expect(localStorage.getItem(agentStorageKey("filey.ai.chats")!)).toBe(repaired);
    expect(localStorage.getItem(backup)).toBe(raw);
  });

  it("allows explicit recovery of wholly unreadable JSON while keeping it available for recovery", () => {
    const raw = stored("{broken private source");
    expect(repairChatHistory()).toBe(true);
    expect(localStorage.getItem(agentStorageKey("filey.ai.chats.recovery")!)).toBe(raw);
    expect(loadChats()).toEqual([]);
    expect(saveChats([conversation()])).toBe(true);
  });

  it("preserves source if the backup cannot be written", () => {
    const raw = stored("{broken private source");
    const backup = agentStorageKey("filey.ai.chats.recovery")!;
    const set = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === backup) throw new DOMException("Quota exceeded", "QuotaExceededError");
      set.call(this, key, value);
    });
    expect(repairChatHistory()).toBe(false);
    expect(localStorage.getItem(agentStorageKey("filey.ai.chats")!)).toBe(raw);
    expect(localStorage.getItem(backup)).toBeNull();
  });

  it("preserves source and retries using the same backup after the repaired write fails", () => {
    const raw = stored("{broken private source");
    const key = agentStorageKey("filey.ai.chats")!;
    const backup = agentStorageKey("filey.ai.chats.recovery")!;
    const set = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, name: string, value: string) {
      if (name === key) throw new DOMException("Quota exceeded", "QuotaExceededError");
      set.call(this, name, value);
    });
    expect(repairChatHistory()).toBe(false);
    expect(localStorage.getItem(key)).toBe(raw);
    expect(localStorage.getItem(backup)).toBe(raw);
    vi.restoreAllMocks();
    expect(repairChatHistory()).toBe(true);
    expect(loadChats()).toEqual([]);
    expect(localStorage.getItem(backup)).toBe(raw);
  });

  it("never replaces a different prior backup and refuses a changed account", () => {
    const raw = stored("{new broken private source");
    const backup = agentStorageKey("filey.ai.chats.recovery")!;
    localStorage.setItem(backup, "{older private source");
    expect(repairChatHistory()).toBe(false);
    expect(localStorage.getItem(agentStorageKey("filey.ai.chats")!)).toBe(raw);
    expect(localStorage.getItem(backup)).toBe("{older private source");
    const first = agentStorageScope()!;
    setCacheOrg("other-workspace", "other-owner");
    const other = stored("{other broken source");
    expect(repairChatHistory(first)).toBe(false);
    expect(localStorage.getItem(agentStorageKey("filey.ai.chats")!)).toBe(other);
    expect(localStorage.getItem(agentStorageKey("filey.ai.chats.recovery")!)).toBeNull();
    expect(localStorage.getItem(backup)).toBe("{older private source");
  });

  it("reports no recovery for absent/valid/anonymous stores without modifying history", () => {
    localStorage.clear();
    expect(chatHistoryNeedsRecovery()).toBe(false);
    const raw = stored([conversation()]);
    expect(chatHistoryNeedsRecovery()).toBe(false);
    expect(localStorage.getItem(agentStorageKey("filey.ai.chats")!)).toBe(raw);
    setCacheOrg(null);
    expect(chatHistoryNeedsRecovery()).toBe(false);
  });
});
