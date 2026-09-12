# Filey Tools reliability check — 8 September 2026

This update changes local tool execution and UI handoffs. It does not change customer records or require an API key.

## Tools interface

The catalogue opens with eight everyday tools, searchable access to all 88 tools, and horizontal category filters. Every tool has its own GoFiley illustration showing its specific operation, alongside its icon and input/output labels. The illustrations use optimized 640px WebP assets and load lazily. Cards, pill buttons, upload workspaces and result panels follow the existing Filey theme in both light and dark mode.

The shared workflow validates uploads, supports file ordering and removal, resets editor state when inputs change, and keeps generated results available after a cancelled download. Editors leave download-success feedback to the shared save handler. Original input files are never overwritten.

Browser checks used the isolated QA workspace and disposable documents: desktop and 390px layouts had no horizontal page overflow; search, all 88 catalogue entries, search reset, CSV-to-JSON conversion, PDF preview, rotation and result downloads were exercised. The production build and 225 tests across 16 Tools/invoice suites passed. Packaged desktop checks remain separate, as detailed below.

## Corrected output behavior

| Tool or shared path | Correction |
| --- | --- |
| Redact PDF | Rebuilds visible pages with the covered pixels removed. The output has no recoverable source text, forms or attachments. Coordinates follow the displayed page, including rotation. Pages become images. |
| Sanitize PDF | Rebuilds visible pages and removes metadata, hidden content, embedded actions and attachments. Pages become images. |
| Remove Metadata | Removes document info and page/catalog XMP objects, including their serialized data. |
| Encrypt, Decrypt, Remove Restrictions | Decryption preserves original selectable text and page content. Owner-only restrictions are actually decrypted. Normal edits reject encrypted input with an actionable message instead of saving corrupted output. |
| Extract Attachments | Uses the current PDF.js attachment map and lazy content API. Add/extract round-trips work again. |
| PDF to Images | BMP output is an actual 24-bit BMP; unsupported canvas encoders can no longer silently produce PNG bytes under another extension. |
| Raster, OCR and TIFF paths | Canvas failure stops the operation rather than silently omitting a page. OCR retains spaces in its searchable text layer. |
| Bookmarks | Nested bookmark export includes every level and terminates on malformed cycles. |
| Fill Form | Existing text and selections can be cleared. A different uploaded file clears old form state. Non-object JSON is rejected. |
| Page order | Explicit order and descending page ranges retain their requested order. Very large range endpoints are bounded by the document length. |
| Stamp, logo and letterhead | Placement matches the displayed rotation/crop, and background output retains page rotation. Invalid target pages are rejected. |
| E-Sign | A drawn signature can be exported without a document. Signing preserves every page in a PDF instead of exporting one page as PNG. Office/image inputs use the existing local conversion engines. Drawing is transparent and survives pen setting changes. |
| Tool labels and controls | Compatibility PDF describes the actual non-linearizing re-save. Archival Metadata explicitly does not certify PDF/A compliance. Options have accessible labels. Legacy DOC/PPT inputs request DOCX/PPTX conversion. |

## Verification scope

The registry has **88 tools**. The expanded `pdfjs-compatibility.test.ts` executes **75 registry actions** against generated, disposable documents using actual PDF.js/pdf-lib, native canvas, image decoders, Vtracer WASM, Office engines and local Tesseract OCR. PDF and archive outputs are reopened; targeted regressions check actual text, pixels, attachments, page count/order, metadata and encryption.

Node tests adapt browser blob URLs/canvas transport and load the vendored OCR language data with the installed Tesseract core. The standard and SIMD core WASM files were checked against the vendored browser copies and are identical. Mammoth uses its real browser implementation. They do not replace conversion results with mocks or call external services.

The 12 interactive entrypoints (`split`, `extract`, `delete`, `reorder`, `rotate`, `img-watermark`, `stamp`, `esign`, `logo`, `letterhead`, `redact`, `place-stamp`) need their workspaces rather than registry `run()`. Their shared engines are exercised by the smoke and renderer tests; dedicated UI tests cover signature download/PDF dispatch and form clearing. This is not a claim that every drag gesture has been tested in a packaged desktop app.

**HEIC/HEIF remains unverified with a valid encoded fixture.** No change pretends to certify that decoder. Packaged WebView checks, every unusual source-document variant, native save cancellation under each editor, and every supported format option remain release checks. The archival metadata tool remains a metadata operation, not certified PDF/A conversion; Word/PowerPoint input conversion intentionally simplifies layout to text.

Disposable browser upload fixtures are in `output/tools-qa/`: PDFs including a fillable form and a blank page, PNG/JPG/WebP/SVG, PSD/TIFF/CBZ, DOCX/XLSX/PPTX, CSV/JSON and text. No business records are included.

Run the relevant checks with:

```sh
npm run typecheck
npm test -- src/components/PdfToolbox.audit.test.ts src/components/__tests__/esign-controls.test.tsx src/components/__tests__/esign-output.test.tsx src/components/__tests__/form-fill-panel.test.tsx src/lib/__tests__/pdfjs-compatibility.test.ts src/lib/__tests__/pdftools-smoke.test.ts src/lib/__tests__/pdf-download.test.ts src/lib/__tests__/ranges.test.ts
```

## Tools workspace update — 11 September 2026

All 88 tools now have distinct covers; the complete built-in image generation prompt set is in [tool-cover-prompts.json](tool-cover-prompts.json). Originals are retained outside the shipped public folder.

Uploads lead into a consistent document workspace with labelled pill controls and action-specific buttons. The PDF canvas supports brush, text, highlights, rectangles, erasing added marks, crop, rotation, page removal/restoration, zoom, and undo/redo. Edits are automatically included by the primary action, and save failures stop processing instead of silently exporting the original. Annotation coordinates remain stable across viewport resizing, page rotation and crop offsets. Text remains searchable. The eraser removes added marks; use Redact PDF to remove original document content. Merge file ordering has one source of truth, including accessible earlier/later buttons.

Validation for this update: production build passed; 15 focused checks across 8 test files passed. Browser QA used a disposable local workspace and a synthetic two-page PDF: brush, undo/redo, automatic edit inclusion, successful download, mobile upload layout, and dark-mode editing were checked. No customer business records were modified. Existing build warnings about large dependency bundles and dynamic imports remain.
