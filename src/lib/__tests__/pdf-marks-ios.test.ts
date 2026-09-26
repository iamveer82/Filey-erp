import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { downloadElementAsPdf } from "../pdfTools";

/* iOS WebKit drops <img> inside the SVG <foreignObject> that html-to-image
 * builds, so a stamp/signature captured that way never reached the PDF — it
 * worked on desktop Chrome and failed on phones. The export now lifts marks out
 * of the capture and paints them onto the rasterised page with canvas calls.
 * These tests pin that behaviour without needing an iOS device: html-to-image
 * is stubbed to return a blank page, exactly as iOS effectively does, so any
 * mark that survives into the PDF can only have come from the canvas pass. */

const toPng = vi.hoisted(() => vi.fn(async () => "data:image/png;base64,AAA"));
const embedPng = vi.hoisted(() => vi.fn(async () => "embedded"));
const drawImage = vi.hoisted(() => vi.fn());
const getContext = vi.hoisted(() =>
  vi.fn(() => ({
    drawImage,
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
  }))
);

vi.mock("html-to-image", () => ({ toPng }));
vi.mock("pdf-lib", () => ({
  PDFDocument: {
    create: async () => ({
      addPage: () => page,
      embedPng,
      save: async () => new Uint8Array([1, 2, 3]),
    }),
  },
  rgb: () => ({ kind: "rgb" }),
}));

const page = {
  drawRectangle: vi.fn(),
  drawImage: vi.fn(),
};

// The capture result. Stands in for what iOS effectively returns: the sheet
// with every mark missing.
const BLANK = "data:image/png;base64,BLANK-PAGE";
// What the composited canvas returns. Deliberately a different string, so a
// passing assertion can only mean the paint pass actually ran.
const MARK = "data:image/png;base64,PAGE-WITH-STAMP";

function sheet(inner: string) {
  const el = document.createElement("div");
  el.style.width = "794px";
  el.style.height = "1123px";
  el.innerHTML = inner;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  toPng.mockClear().mockResolvedValue(BLANK);
  embedPng.mockClear();
  page.drawImage.mockClear();
  page.drawRectangle.mockClear();
  drawImage.mockClear();
  stubLayout();

  // jsdom implements neither the FontFaceSet nor the print fallback.
  Object.defineProperty(document, "fonts", { value: { ready: Promise.resolve() }, configurable: true });
  window.print = vi.fn();

  // jsdom has no rasteriser; stand in for the canvas the marks are painted on.
  const proto = window.HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  proto.getContext = getContext;
  proto.toDataURL = vi.fn(() => MARK);

  // Images must "load" so the export can read their natural size. The getter
  // falls back to the attribute: the export works on a CLONE, and a JS expando
  // would not survive cloneNode.
  Object.defineProperty(window.Image.prototype, "src", {
    set(this: HTMLImageElement, value: string) {
      (this as unknown as Record<string, unknown>)._src = value;
      if (value) queueMicrotask(() => this.onload?.(new Event("load")));
    },
    get(this: HTMLImageElement) {
      return (
        ((this as unknown as Record<string, string>)._src as string | undefined) ??
        this.getAttribute("src") ??
        ""
      );
    },
    configurable: true,
  });
  Object.defineProperty(window.HTMLImageElement.prototype, "naturalWidth", { value: 8, configurable: true });
  Object.defineProperty(window.HTMLImageElement.prototype, "naturalHeight", { value: 8, configurable: true });
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const markLayer = (src: string) =>
  `<div data-doc-mark="Stamp" style="position:absolute"><img alt="Stamp" style="mix-blend-mode:multiply;opacity:0.5;clip-path:inset(5% 5% 5% 5%)" src="${src}"></div>`;

/* jsdom does no layout, so every rect is 0×0 and the export would treat every
 * mark as zero-sized. Give the sheet a real box and the mark a position on it,
 * in CSS px; the export multiplies by its own pixel ratio. */
function stubLayout() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const isMark = this.tagName === "IMG";
    return {
      x: isMark ? 400 : 0,
      y: isMark ? 700 : 0,
      left: isMark ? 400 : 0,
      top: isMark ? 700 : 0,
      right: isMark ? 600 : 794,
      bottom: isMark ? 800 : 1123,
      width: isMark ? 200 : 794,
      height: isMark ? 100 : 1123,
      toJSON: () => ({}),
    } as DOMRect;
  });
}

it("paints a stamp onto the page even when the capture drops it", async () => {
  const el = sheet(markLayer(MARK));
  await downloadElementAsPdf(el, "invoice");

  expect(toPng).toHaveBeenCalledOnce();
  // html-to-image returned a blank page; the mark had to be added afterwards.
  expect(embedPng).toHaveBeenCalledWith(MARK);
  expect(getContext).toHaveBeenCalled();
  expect(drawImage).toHaveBeenCalled();
  expect(page.drawImage).toHaveBeenCalled();
});

it("restores the mark in the DOM instead of leaving it hidden", async () => {
  const el = sheet(markLayer(MARK));
  await downloadElementAsPdf(el, "invoice");
  // The export works on a throwaway clone, so the live document is untouched…
  expect(el.querySelector<HTMLElement>("[data-doc-mark]")!.style.visibility).toBe("");
});

it("does not touch the page when a document has no marks", async () => {
  const el = sheet(`<img alt="Letterhead" src="${MARK}">`);
  await downloadElementAsPdf(el, "invoice");

  // A letterhead still goes through html-to-image: it is a real layout image,
  // not a floating mark, and must keep working exactly as before.
  expect(embedPng).toHaveBeenCalledWith(BLANK);
});

it("still produces a PDF when a mark image cannot be loaded", async () => {
  Object.defineProperty(window.Image.prototype, "src", {
    set(this: HTMLImageElement, value: string) {
      (this as unknown as Record<string, unknown>)._src = value;
      // Fail only the mark, never the page raster.
      if (value?.startsWith("data:image/png") && value !== BLANK)
        queueMicrotask(() => this.onerror?.(new Event("error")));
      else queueMicrotask(() => this.onload?.(new Event("load")));
    },
    get(this: HTMLImageElement) {
      return (
        ((this as unknown as Record<string, string>)._src as string | undefined) ??
        this.getAttribute("src") ??
        ""
      );
    },
    configurable: true,
  });
  const el = sheet(markLayer(MARK));
  // Resolves rather than throwing: a customer must still get their invoice
  // even when the stamp file is unreachable.
  await expect(downloadElementAsPdf(el, "invoice")).resolves.not.toThrow();
  expect(page.drawImage).toHaveBeenCalled();
});
