import { afterEach, expect, it, vi } from "vitest";
import { applyTheme, watchAppearance } from "../theme";
import { applyAccent } from "../accent";

afterEach(() => { localStorage.clear(); applyTheme("light"); applyAccent("amber"); });

it("applies preferences from another tab and stops listening on disposal", () => {
  const stop = watchAppearance();
  const changed = vi.fn();
  window.addEventListener("filey-ui", changed);
  localStorage.setItem("theme", "dark");
  window.dispatchEvent(new StorageEvent("storage", { key: "theme", storageArea: localStorage }));
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  localStorage.setItem("filey-accent", "blue");
  window.dispatchEvent(new StorageEvent("storage", { key: "filey-accent", storageArea: localStorage }));
  expect(document.documentElement.dataset.accent).toBe("blue");
  expect(changed).toHaveBeenCalledTimes(2);
  stop();
  localStorage.setItem("theme", "light");
  window.dispatchEvent(new StorageEvent("storage", { key: "theme", storageArea: localStorage }));
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  window.removeEventListener("filey-ui", changed);
});
