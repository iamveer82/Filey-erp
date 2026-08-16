import { beforeEach, describe, expect, it } from "vitest";
import { resolveOpeningChat, saveChats, setActiveId, newChat, loadChats } from "../aiChats";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("resolveOpeningChat", () => {
  it("starts a fresh chat on a new app launch, leaving history intact", () => {
    const old = { ...newChat(), turns: [{ role: "user" as const, text: "hi" }] };
    saveChats([old]);
    setActiveId(old.id);

    const opened = resolveOpeningChat(); // fresh launch: sessionStorage empty
    expect(opened.id).not.toBe(old.id);
    expect(opened.turns).toHaveLength(0);
    expect(loadChats().find((c) => c.id === old.id)).toBeTruthy();
  });

  it("resumes the same chat for the rest of the run", () => {
    const first = resolveOpeningChat();
    saveChats([{ ...first, turns: [{ role: "user", text: "hi" }] }]);

    const again = resolveOpeningChat();
    expect(again.id).toBe(first.id);
    expect(again.turns).toHaveLength(1); // the live one, not another blank
  });

  it("treats the next launch as new again", () => {
    const first = resolveOpeningChat();
    saveChats([{ ...first, turns: [{ role: "user", text: "hi" }] }]);
    sessionStorage.clear(); // what the webview does when the app closes

    expect(resolveOpeningChat().id).not.toBe(first.id);
  });

  it("resumes rather than losing the thread when sessionStorage is unavailable", () => {
    const live = { ...newChat(), turns: [{ role: "user" as const, text: "hi" }] };
    saveChats([live]);
    setActiveId(live.id);
    const orig = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(resolveOpeningChat().id).toBe(live.id);
    } finally {
      if (orig) Object.defineProperty(window, "sessionStorage", orig);
    }
  });
});
