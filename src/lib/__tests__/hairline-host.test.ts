import { StrictMode, createElement } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../vendor/hairline/kernel.js?url", () => ({ default: "/assets/hairline-kernel.js" }));
vi.mock("../hairline/document-tray.js?url", () => ({ default: "/assets/document-tray.js" }));

type Runtime = Window & { HL?: unknown; hairline?: (figure: unknown) => void };
type Context = { stage: HTMLElement; svg: SVGSVGElement; read: { textContent: string | null } };
let host: typeof import("../hairline/host");
let scripts: HTMLScriptElement[];
let preference: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
let engine: { inject: ReturnType<typeof vi.fn>; mk: ReturnType<typeof vi.fn>; setReducedMotion: ReturnType<typeof vi.fn> };
let mounts: Array<{ stage: HTMLElement; svg: SVGSVGElement; choose: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }>;
let figure: { name: string; mount: ReturnType<typeof vi.fn> };
const runtime = () => window as Runtime;
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

beforeEach(async () => {
  vi.resetModules(); scripts = []; mounts = [];
  delete runtime().HL; delete runtime().hairline;
  preference = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("matchMedia", vi.fn(() => preference));
  const append = document.head.append.bind(document.head);
  vi.spyOn(document.head, "append").mockImplementation((...nodes: (Node | string)[]) => {
    nodes.forEach(node => { if (node instanceof HTMLScriptElement) scripts.push(node); });
    append(...nodes);
  });
  engine = {
    inject: vi.fn(), setReducedMotion: vi.fn(),
    mk: vi.fn((tag: string, attrs: Record<string, string>, parent: Element) => {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", tag);
      Object.entries(attrs).forEach(([name, value]) => svg.setAttribute(name, value));
      parent.append(svg); return svg;
    }),
  };
  // The real figure restores stage attributes in destroy. Keep that contract
  // so a forgotten asynchronous StrictMode mount can damage the live one.
  figure = { name: "document-tray", mount: vi.fn(({ stage, svg, read }: Context) => {
    const attrs = ["tabindex", "role", "aria-label"].map(name => [name, stage.getAttribute(name)]);
    stage.setAttribute("tabindex", "0"); stage.setAttribute("role", "group");
    stage.setAttribute("aria-label", "Document tray. Arrow keys select a sheet.");
    read.textContent = "rest";
    const choose = vi.fn(), set = vi.fn();
    const destroy = vi.fn(() => {
      attrs.forEach(([name, value]) => value === null ? stage.removeAttribute(name!) : stage.setAttribute(name!, value!));
      svg.replaceChildren();
    });
    mounts.push({ stage, svg, choose, destroy }); return { set, choose, destroy };
  }) };
  host = await import("../hairline/host");
});

afterEach(() => {
  cleanup(); scripts.forEach(node => node.remove());
  delete runtime().HL; delete runtime().hairline;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

async function finishLoading() {
  const kernel = scripts.find(node => node.src.endsWith("hairline-kernel.js"));
  if (kernel) { runtime().HL = engine; kernel.dispatchEvent(new Event("load")); await flush(); }
  const drawing = scripts.find(node => node.src.endsWith("document-tray.js"));
  expect(drawing).toBeDefined(); expect(drawing!.type).toBe("module");
  runtime().hairline?.(figure); drawing!.dispatchEvent(new Event("load")); await flush();
}

describe("Hairline asset and host lifetime", () => {
  it("deduplicates concurrent loads and reuses the one definition across later mounts", async () => {
    const first = host.loadGuideFigure(), second = host.loadGuideFigure();
    expect(second).toBe(first); expect(scripts).toHaveLength(1);
    await finishLoading();
    expect(await first).toEqual({ engine, figure }); expect(await second).toEqual({ engine, figure });
    expect(scripts).toHaveLength(2); expect(engine.inject).toHaveBeenCalledOnce();
    expect(await host.loadGuideFigure()).toEqual({ engine, figure }); expect(scripts).toHaveLength(2);
  });

  it("removes failed kernel scripts, rejects safely, and allows a later load to recover", async () => {
    const first = host.loadGuideFigure(); const rejected = expect(first).rejects.toThrow("Guide illustration unavailable.");
    const failed = scripts[0]; failed.dispatchEvent(new Event("error")); await rejected;
    expect(failed.isConnected).toBe(false); expect(engine.inject).not.toHaveBeenCalled();
    const retry = host.loadGuideFigure();
    expect(scripts).toHaveLength(2); expect(retry).not.toBe(first);
    runtime().HL = engine; scripts[1].dispatchEvent(new Event("load")); await flush();
    runtime().hairline?.(figure); scripts[2].dispatchEvent(new Event("load"));
    expect(await retry).toEqual({ engine, figure });
  });

  it("restores a pre-existing registration callback after figure load success and failure", async () => {
    runtime().HL = engine;
    const previous = vi.fn(); runtime().hairline = previous;
    const failed = host.loadGuideFigure(); const rejected = expect(failed).rejects.toThrow("Guide illustration unavailable.");
    expect(runtime().hairline).not.toBe(previous);
    scripts[0].dispatchEvent(new Event("error")); await rejected;
    expect(runtime().hairline).toBe(previous); expect(scripts[0].isConnected).toBe(false);
    const retry = host.loadGuideFigure();
    runtime().hairline?.(figure); scripts[1].dispatchEvent(new Event("load")); await retry;
    expect(runtime().hairline).toBe(previous); expect(previous).not.toHaveBeenCalled();
  });

  it("rejects a module that did not register the expected figure without mounting an empty stage", async () => {
    runtime().HL = engine;
    const stage = document.createElement("div");
    const pending = host.mountGuideFigure(stage, { textContent: null });
    const rejected = expect(pending).rejects.toThrow("Guide illustration unavailable.");
    runtime().hairline?.({ name: "other-figure" }); scripts[0].dispatchEvent(new Event("load")); await rejected;
    expect(stage.children).toHaveLength(0); expect(engine.mk).not.toHaveBeenCalled();
    expect(preference.addEventListener).not.toHaveBeenCalled(); expect(runtime().hairline).toBeUndefined();
  });

  it("does not mount or subscribe when the waiting host was explicitly aborted", async () => {
    const stage = document.createElement("div"), controller = new AbortController();
    const pending = host.mountGuideFigure(stage, { textContent: null }, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); await finishLoading(); await rejected;
    expect(engine.mk).not.toHaveBeenCalled(); expect(figure.mount).not.toHaveBeenCalled();
    expect(preference.addEventListener).not.toHaveBeenCalled(); expect(stage.attributes).toHaveLength(0);
  });

  it("applies current reduced motion, tracks changes, and removes the exact subscription on destroy", async () => {
    preference.matches = true;
    const stage = document.createElement("div"), read = { textContent: null };
    const pending = host.mountGuideFigure(stage, read); await finishLoading();
    const handle = await pending;
    expect(engine.setReducedMotion).toHaveBeenLastCalledWith(true);
    const [event, listener] = preference.addEventListener.mock.calls[0];
    expect(event).toBe("change"); preference.matches = false; listener();
    expect(engine.setReducedMotion).toHaveBeenLastCalledWith(false);
    expect(stage).toHaveAttribute("data-hairline", "document-tray");
    expect(stage.firstElementChild).toHaveAttribute("aria-hidden", "true");
    handle.choose(4); expect(mounts[0].choose).toHaveBeenLastCalledWith(4);
    handle.destroy();
    expect(mounts[0].destroy).toHaveBeenCalledOnce(); expect(stage.children).toHaveLength(0);
    expect(stage).not.toHaveAttribute("data-hairline"); expect(stage).not.toHaveAttribute("tabindex");
    expect(preference.removeEventListener).toHaveBeenCalledWith("change", listener);
  });

  it("cleans reduced motion and SVG state when the figure itself fails to mount", async () => {
    figure.mount.mockImplementation(() => { throw new Error("Broken geometry"); });
    const stage = document.createElement("div");
    const pending = host.mountGuideFigure(stage, { textContent: null });
    const rejected = expect(pending).rejects.toThrow("Broken geometry"); await finishLoading(); await rejected;
    const listener = preference.addEventListener.mock.calls[0][1];
    expect(preference.removeEventListener).toHaveBeenCalledWith("change", listener);
    expect(stage.children).toHaveLength(0); expect(stage).not.toHaveAttribute("data-hairline");
  });

  it("StrictMode abandons the first async effect without removing the live stage's keyboard attributes", async () => {
    const { default: HairlineGuideFigure } = await import("../../components/HairlineGuideFigure");
    const view = render(createElement(StrictMode, null, createElement(HairlineGuideFigure, { step: 3 })));
    expect(scripts).toHaveLength(1);
    await act(finishLoading);
    await waitFor(() => expect(figure.mount).toHaveBeenCalledOnce());
    const stage = view.container.querySelector<HTMLElement>(".filey-guide-figure")!;
    expect(stage.querySelectorAll("svg")).toHaveLength(1);
    expect(stage).toHaveAttribute("data-hairline", "document-tray"); expect(stage).toHaveAttribute("tabindex", "0");
    expect(stage).toHaveAttribute("role", "group"); expect(stage).toHaveAccessibleName(/Document tray/);
    expect(mounts[0].choose).toHaveBeenCalledWith(3); expect(mounts[0].destroy).not.toHaveBeenCalled();
    view.unmount(); expect(mounts[0].destroy).toHaveBeenCalledOnce();
    expect(preference.addEventListener).toHaveBeenCalledOnce(); expect(preference.removeEventListener).toHaveBeenCalledOnce();
  });

  it("unmount before deferred asset completion never mounts a forgotten figure or attaches a listener", async () => {
    const { default: HairlineGuideFigure } = await import("../../components/HairlineGuideFigure");
    const view = render(createElement(HairlineGuideFigure, { step: 1 })); view.unmount();
    await act(finishLoading);
    expect(figure.mount).not.toHaveBeenCalled(); expect(engine.mk).not.toHaveBeenCalled();
    expect(preference.addEventListener).not.toHaveBeenCalled(); expect(preference.removeEventListener).not.toHaveBeenCalled();
  });

  it("uses the latest chapter when props change before loading, and tears down a mounted figure on unmount", async () => {
    const { default: HairlineGuideFigure } = await import("../../components/HairlineGuideFigure");
    const view = render(createElement(HairlineGuideFigure, { step: 0 }));
    view.rerender(createElement(HairlineGuideFigure, { step: 5 })); await act(finishLoading);
    expect(mounts[0].choose).toHaveBeenCalledWith(5); expect(mounts[0].choose).not.toHaveBeenCalledWith(0);
    view.rerender(createElement(HairlineGuideFigure, { step: 2 })); expect(mounts[0].choose).toHaveBeenLastCalledWith(2);
    view.unmount(); expect(mounts[0].destroy).toHaveBeenCalledOnce();
    expect(preference.removeEventListener).toHaveBeenCalledWith("change", preference.addEventListener.mock.calls[0][1]);
  });
});
