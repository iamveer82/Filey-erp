import { setCacheOrg } from "../api";
import { beforeEach, describe, expect, it } from "vitest";
import { resolveOpeningChat, saveChats, setActiveId, newChat, loadChats } from "../aiChats";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("filey_data_mode", "local"); setCacheOrg("test-org", "test-user");
  sessionStorage.clear();
});

describe("resolveOpeningChat", () => {
  it("starts a fresh chat on a new app launch, leaving history intact", () => {
    const old = { ...newChat(), turns: [{ role: "user" as const, text: "hi" }] };
    saveChats([old]);
    setActiveId(old.id);
    sessionStorage.clear();

    const opened = resolveOpeningChat(); // fresh launch: sessionStorage empty
    expect(opened.id).not.toBe(old.id);
    expect(opened.turns).toHaveLength(0);
    expect(loadChats().find((c) => c.id === old.id)).toBeTruthy();
  });

  it("restores the current conversation within the same app session", () => {
    const first = resolveOpeningChat();
    saveChats([{ ...first, turns: [{ role: "user", text: "hi" }] }]);

    const again = resolveOpeningChat();
    expect(again.id).toBe(first.id);
    expect(again.turns).toEqual([{ role: "user", text: "hi" }]);
  });

  it("treats the next launch as new again", () => {
    const first = resolveOpeningChat();
    saveChats([{ ...first, turns: [{ role: "user", text: "hi" }] }]);
    sessionStorage.clear(); // what the webview does when the app closes

    expect(resolveOpeningChat().id).not.toBe(first.id);
  });

  it("starts fresh even when a previous chat was active", () => {
    const live = { ...newChat(), turns: [{ role: "user" as const, text: "hi" }] };
    saveChats([live]);
    setActiveId(live.id);
    sessionStorage.clear();
    expect(resolveOpeningChat().id).not.toBe(live.id);
  });

  it("restores a selected history conversation on remount", () => {
    const selected = { ...newChat(), turns: [{ role: "assistant" as const, text: "Saved reply" }] };
    saveChats([selected]);
    setActiveId(selected.id);
    expect(resolveOpeningChat().id).toBe(selected.id);
  });

  it("keeps the session pointer isolated by account, workspace and storage mode", () => {
    const original = { ...resolveOpeningChat(), turns: [{ role: "user" as const, text: "Private request" }] };
    saveChats([original]);
    setActiveId(original.id);
    setCacheOrg("other-org", "other-user");
    expect(resolveOpeningChat().turns).toHaveLength(0);
    setCacheOrg("test-org", "test-user");
    localStorage.setItem("filey_data_mode", "cloud");
    expect(resolveOpeningChat().turns).toHaveLength(0);
    localStorage.setItem("filey_data_mode", "local");
    expect(resolveOpeningChat().id).toBe(original.id);
    expect(resolveOpeningChat().turns[0].text).toBe("Private request");
  });

  it("handles a deleted current conversation without restoring its old messages", () => {
    const removed = { ...resolveOpeningChat(), turns: [{ role: "user" as const, text: "Removed" }] };
    saveChats([removed]);
    setActiveId(removed.id);
    saveChats([]);
    expect(resolveOpeningChat().id).not.toBe(removed.id);
    expect(resolveOpeningChat().turns).toHaveLength(0);
  });
});
