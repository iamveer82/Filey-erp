import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

// The official legacy builds include standard JavaScript polyfills needed by
// older desktop WebViews. Always pair the worker with the same entry/version.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/* Central entry point for PDFs from users and suppliers. Filey now uses
 * pdfjs-dist 6.3.289 and its matching worker, including the 6.2.108 security
 * fix. The July 2026 scripting advisory (GHSA-hq66-cqwq-w95j) concerned the
 * viewer's enableScripting option; Filey renders canvases and does not install
 * the PDF.js scripting manager or execute a document's embedded actions.
 *
 * isEvalSupported:false was the workaround for the separate 2024 font issue
 * (GHSA-wgrm-67xf-hhpq). Keep that legacy preference centralized, but do not
 * treat it as a security boundary: 6.3.289 no longer reads this option. The
 * upgraded library, absence of a scripting viewer, and desktop CSP are the actual
 * controls. Keep the library and worker on the same patched version.
 */

type GetDocumentSrc = Parameters<typeof pdfjs.getDocument>[0];

/** Shared PDF loader; callers should use this instead of raw pdfjs.getDocument. */
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
