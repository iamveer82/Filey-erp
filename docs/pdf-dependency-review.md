# PDF dependency review — September 7, 2026

The source workspace now uses `pdfjs-dist` 6.3.289. `src/lib/pdfjsSafe.ts` owns the official legacy parser and matching legacy worker URL. All PDF tools and preview/editor components use that entry. The legacy build adds standard JavaScript compatibility polyfills; it is not an older version of PDF.js. The modern build failed an actual PDF parse under Node 24.19 because `Uint8Array.toHex()` was unavailable, so requiring the newest browser primitives would unnecessarily narrow desktop WebView compatibility.

## Security controls

The upgrade includes the fix for [GHSA-hq66-cqwq-w95j](https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j), patched in 6.2.108. That advisory concerns the PDF viewer's scripting integration. Filey uses `getDocument` and canvas rendering; it does not instantiate the PDF.js scripting manager or run embedded document actions.

The loader retains `isEvalSupported: false`, but that is a legacy preference, not the fix for the 2026 scripting advisory. It was the workaround for [the separate 2024 font vulnerability](https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq). The 6.3.289 build no longer reads this option. Keep the dependency patched and the main module/worker paired. The desktop Tauri CSP disallows JavaScript `unsafe-eval`; the browser development HTML has a different, more permissive policy, so do not claim every build has the same CSP protection.

## Remaining PowerPoint dependency finding

`npm audit --omit=dev` still reports two high-severity dependency entries: `image-size` 1.2.1 and its parent `pptxgenjs` 4.0.1. The underlying findings are [ICNS infinite-loop denial of service](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) and [JXL/HEIF infinite-loop denial of service](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq). Both advisories include versions through 2.0.2 and list no patched release. The audit's suggested downgrade to PptxGenJS 1.1.5 is not a compatible fix and was not applied.

Filey's current PowerPoint input path is bounded as follows:

1. `PdfToolbox`'s `pdf2pptx` action calls `pdfToPptx` with the selected PDF.
2. `pdfToPptx` calls `pdfToImageFormat(file, "png", 2)`.
3. PDF.js renders each page into a canvas, which encodes a fresh PNG.
4. PptxGenJS receives only those PNG bytes as inline base64 with explicit slide dimensions. Filey has no other PptxGenJS caller, external image URL/path, or raw uploaded-image route into `addImage`.

The PptxGenJS browser package also maps `image-size` to `false`. The traced application flow does not expose raw ICNS/JXL/HEIF buffers to those parsers. This narrows the current exposure; it does not erase the dependency finding or guarantee arbitrary PDF rendering is resource-bounded. Reassess before adding direct image/PPTX uploads, Node conversion endpoints, or external image URLs. Keep the finding open until a compatible upstream fix is available.

## Verification

`src/lib/__tests__/pdfjs-compatibility.test.ts` uses the real production parser, its same-version worker and the PDF.js optional native canvas. It generates a PDF, checks extracted text, renders and verifies black/white pixels, runs Filey's text/PNG/PPTX exports, and inspects the generated PowerPoint ZIP to confirm one slide and PNG-only media. It also simulates an unavailable canvas and a failed PNG encoder: exports reject instead of silently omitting pages or leaving a promise pending. Worker bootstrap is in-process for Node; document parsing and rasterization are real. This is not a browser-worker/CSP integration test.

```sh
npm test -- src/lib/__tests__/pdfjs-compatibility.test.ts src/lib/__tests__/pdftools-smoke.test.ts src/lib/__tests__/pdf-download.test.ts src/pages/__tests__/pdf-tool-actions.test.tsx src/components/PdfToolbox.audit.test.ts
npm run typecheck
```

The compatibility test needs `@napi-rs/canvas`, already an optional dependency of PDF.js. No new dependency or test network access was added. Browser preview/worker checks and packaged desktop testing remain distinct validation steps. These changes do not publish a new installer.
