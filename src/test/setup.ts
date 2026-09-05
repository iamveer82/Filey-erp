import "@testing-library/jest-dom/vitest";

// jsdom lacks some canvas/PDF globals that heavy libs (pdfjs) touch at import
// time. Minimal stubs so those modules import in tests; not exercised by render
// smoke (PDF work happens on user actions, not mount).
const g = globalThis as Record<string, unknown>;
if (!("DOMMatrix" in g)) g.DOMMatrix = class DOMMatrix {};
if (!("Path2D" in g)) g.Path2D = class Path2D {};
if (!("ImageData" in g)) g.ImageData = class ImageData {};

// jsdom's canvas.getContext is "not implemented" and prints a stack trace on
// every render that mounts one (the agent-chat thinking orb). Hand back null —
// the same answer a browser gives for an unsupported context type, which
// canvas code already has to handle.
if (typeof HTMLCanvasElement !== "undefined")
  HTMLCanvasElement.prototype.getContext = () => null;

// jsdom doesn't implement scrollIntoView (used by chat auto-scroll).
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// No test may reach the network. Saving an invoice or recording a payment calls
// getExchangeRates(), which fetches api.frankfurter.app — so the suite was
// making real HTTPS requests from dozens of tests that have nothing to do with
// FX. Under load those exceeded vitest's 5s timeout and failed unrelated tests,
// which is the intermittent red this suite has had for months. It also meant a
// green run depended on someone else's uptime.
//
// Rejecting immediately is safe: every getExchangeRates caller already handles a
// failed fetch, falling back to the hardcoded rates. A test that genuinely needs
// fetch stubs its own with vi.stubGlobal, which takes precedence over this.
g.fetch = () =>
  Promise.reject(
    new Error(
      "Network access is disabled in tests. Use vi.stubGlobal('fetch', …) if this test needs it."
    )
  );
