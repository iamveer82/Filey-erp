import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { getTheme, setTheme } from "../theme";
import { getAccent, setAccent } from "../accent";

afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear();
  document.cookie = "filey_theme=; Max-Age=0; Path=/";
  document.cookie = "filey_accent=; Max-Age=0; Path=/";
  document.documentElement.classList.remove("dark");
  delete document.documentElement.dataset.accent;
});

it("keeps visual preferences usable when local storage is blocked and applies them before React loads", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Blocked"); });
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Blocked"); });
  setTheme("dark"); setAccent("blue");
  expect(getTheme()).toBe("dark"); expect(getAccent()).toBe("blue");
  expect(document.cookie).toContain("filey_theme=dark");
  document.documentElement.classList.remove("dark");
  delete document.documentElement.dataset.accent;
  const bootstrap = readFileSync("index.html", "utf8").match(/<script>([\s\S]*?)<\/script>/)![1];
  window.eval(bootstrap);
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(document.documentElement.dataset.accent).toBe("blue");
});

it("rejects invalid accent cookies rather than treating inherited object keys as colors", () => {
  document.cookie = "filey_accent=__proto__; Path=/";
  expect(getAccent()).toBe("amber");
});

it("still applies the OS theme when both storage and cookies are blocked", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Blocked"); });
  vi.spyOn(document, "cookie", "get").mockImplementation(() => { throw new Error("Blocked"); });
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const bootstrap = readFileSync("index.html", "utf8").match(/<script>([\s\S]*?)<\/script>/)![1];
  window.eval(bootstrap);
  expect(document.documentElement.classList.contains("dark")).toBe(true);
});
