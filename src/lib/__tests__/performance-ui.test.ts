import { afterEach, expect, it, vi } from "vitest";
const motion = vi.hoisted(() => ({ create: vi.fn(), destroy: vi.fn() }));
vi.mock("lenis", () => ({ default: class { constructor() { motion.create(); } destroy() { motion.destroy(); } } }));
import { attachSmoothScroll } from "../smoothScroll";
import { MODULES, prefetchModule } from "../../modules/registry";

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); localStorage.clear(); });

it("prefetches navigation intent but respects data-saving connections", () => {
  const preload = vi.spyOn(MODULES[0].Component, "preload").mockResolvedValue({ default: () => null });
  const connection = { saveData: true, effectiveType: "4g" };
  Object.defineProperty(navigator, "connection", { configurable: true, get: () => connection });
  prefetchModule(MODULES[0].id);
  expect(preload).not.toHaveBeenCalled();
  connection.saveData = false; connection.effectiveType = "2g";
  prefetchModule(MODULES[0].id);
  expect(preload).not.toHaveBeenCalled();
  connection.effectiveType = "4g";
  prefetchModule(MODULES[0].id);
  expect(preload).toHaveBeenCalledOnce();
  delete (navigator as Navigator & { connection?: unknown }).connection;
});

it("suspends the scroll animation while hidden and stops listening after unmount", () => {
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const stop = attachSmoothScroll(document.createElement("main"), document.createElement("div"));
  expect(motion.create).toHaveBeenCalledOnce();
  visibility.mockReturnValue("hidden"); document.dispatchEvent(new Event("visibilitychange"));
  expect(motion.destroy).toHaveBeenCalledOnce();
  visibility.mockReturnValue("visible"); document.dispatchEvent(new Event("visibilitychange"));
  expect(motion.create).toHaveBeenCalledTimes(2);
  stop(); document.dispatchEvent(new Event("visibilitychange"));
  expect(motion.create).toHaveBeenCalledTimes(2);
  expect(motion.destroy).toHaveBeenCalledTimes(2);
});
