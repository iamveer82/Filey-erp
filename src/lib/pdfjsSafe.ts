import * as pdfjs from "pdfjs-dist";

/* Every PDF this app opens arrived from somewhere else — a supplier's invoice,
 * a scan, whatever a user dragged in. pdf.js defaults isEvalSupported to true,
 * which is the path behind "arbitrary JavaScript execution upon opening a
 * malicious PDF" (GHSA against pdfjs-dist < 6.2.108). With the session sitting
 * in localStorage, that is account takeover from opening a document.
 *
 * Turning eval off is the documented mitigation and costs nothing here: it only
 * affects a rarely-used font/JS path, and this app renders and edits pages
 * rather than running embedded PDF scripts.
 *
 * It exists as a wrapper rather than an option repeated at thirteen call sites
 * so the next call site cannot quietly omit it. Upgrading to >= 6.2.108 is
 * still worth doing — it is a major bump across the whole PDF toolkit, so it
 * wants its own change and its own testing, not a drive-by in a security fix.
 */

type GetDocumentSrc = Parameters<typeof pdfjs.getDocument>[0];

/** pdfjs.getDocument with the eval path disabled. Use this, never the raw one. */
export function getDocument(src: GetDocumentSrc) {
  // Callers here always pass an options object; the scalar forms are handled
  // so the wrapper is a drop-in for pdfjs.getDocument's full signature.
  // A typed array is bytes (data), not a location (url) — don't conflate them.
  const opts =
    typeof src === "string" || src instanceof URL
      ? { url: src as never }
      : ArrayBuffer.isView(src) || src instanceof ArrayBuffer
        ? { data: src as never }
        : { ...(src as Record<string, unknown>) };
  return pdfjs.getDocument({ ...opts, isEvalSupported: false } as never);
}

export { pdfjs };
