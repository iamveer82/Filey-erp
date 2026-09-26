import { expect, it, vi } from "vitest";
import { watchViewport } from "../viewport";

it("fits the software keyboard, preserves pinch zoom, and removes listeners", () => {
  const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
  vi.stubGlobal("visualViewport", viewport);
  const stop = watchViewport();
  const style = document.documentElement.style;
  expect(style.getPropertyValue("--filey-viewport-height")).toBe("844px");
  viewport.height = 410; viewport.offsetTop = 18; viewport.dispatchEvent(new Event("resize"));
  expect(style.getPropertyValue("--filey-viewport-height")).toBe("410px");
  expect(style.getPropertyValue("--filey-viewport-top")).toBe("18px");
  viewport.scale = 2; viewport.height = 205; viewport.dispatchEvent(new Event("resize"));
  expect(style.getPropertyValue("--filey-viewport-height")).toBe("410px");
  stop(); viewport.scale = 1; viewport.dispatchEvent(new Event("resize"));
  expect(style.getPropertyValue("--filey-viewport-height")).toBe("");
  vi.unstubAllGlobals();
});
