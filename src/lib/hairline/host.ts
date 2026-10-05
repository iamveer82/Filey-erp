import kernelUrl from "../../vendor/hairline/kernel.js?url";
import figureUrl from "./document-tray.js?url";

export interface FigureHandle { set(value: number): void; choose(index: number): void; destroy(): void }
interface Figure {
  name: string;
  mount(context: { stage: HTMLElement; svg: SVGSVGElement; read: { textContent: string | null } }, value: number): FigureHandle;
}
interface Engine {
  inject(root: Document): void;
  mk(tag: string, attrs: Record<string, string>, parent: Element): SVGSVGElement;
  setReducedMotion(on: boolean): void;
}
type HairlineWindow = Window & { HL?: Engine; hairline?: (figure: Figure) => void };
let pending: Promise<{ engine: Engine; figure: Figure }> | undefined;

function script(url: string, module = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const node = document.createElement("script");
    if (module) node.type = "module";
    node.src = url;
    node.onload = () => { node.onload = node.onerror = null; resolve(); };
    node.onerror = () => { node.remove(); reject(new Error("Guide illustration unavailable.")); };
    document.head.append(node);
  });
}

/** Only these two bundled, first-party URLs can be loaded; no eval/inline code. */
export function loadGuideFigure(): Promise<{ engine: Engine; figure: Figure }> {
  return pending ??= (async () => {
    const runtime = window as HairlineWindow;
    if (!runtime.HL) await script(kernelUrl);
    const engine = runtime.HL;
    if (!engine) throw new Error("Guide illustration unavailable.");
    let figure: Figure | undefined;
    const previous = runtime.hairline;
    runtime.hairline = value => { if (value.name === "document-tray") figure = value; };
    try { await script(figureUrl, true); }
    finally {
      if (previous) runtime.hairline = previous;
      else delete runtime.hairline;
    }
    if (!figure) throw new Error("Guide illustration unavailable.");
    engine.inject(document);
    return { engine, figure };
  })().catch(error => { pending = undefined; throw error; });
}

export async function mountGuideFigure(stage: HTMLElement, read: { textContent: string | null }, signal?: AbortSignal): Promise<FigureHandle> {
  const { engine, figure } = await loadGuideFigure();
  if (signal?.aborted) throw new DOMException("Guide closed.", "AbortError");
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const reduced = () => engine.setReducedMotion(preference.matches);
  reduced();
  preference.addEventListener("change", reduced);
  stage.setAttribute("data-hairline", figure.name);
  const svg = engine.mk("svg", { viewBox: "0 0 400 320", "aria-hidden": "true" }, stage);
  try {
    const handle = figure.mount({ stage, svg, read }, 36);
    return { set: value => handle.set(value), choose: index => handle.choose(index), destroy: () => {
      preference.removeEventListener("change", reduced);
      handle.destroy(); svg.remove(); stage.removeAttribute("data-hairline");
    } };
  } catch (error) {
    preference.removeEventListener("change", reduced);
    svg.remove(); stage.removeAttribute("data-hairline");
    throw error;
  }
}
