import "@testing-library/jest-dom/vitest";

// jsdom lacks some canvas/PDF globals that heavy libs (pdfjs) touch at import
// time. Minimal stubs so those modules import in tests; not exercised by render
// smoke (PDF work happens on user actions, not mount).
const g = globalThis as Record<string, unknown>;
if (!("DOMMatrix" in g)) g.DOMMatrix = class DOMMatrix {};
if (!("Path2D" in g)) g.Path2D = class Path2D {};
if (!("ImageData" in g)) g.ImageData = class ImageData {};

// jsdom doesn't implement scrollIntoView (used by chat auto-scroll).
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
