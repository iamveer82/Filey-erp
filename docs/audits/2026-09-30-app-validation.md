# App validation — 30 September 2026

This batch refines the existing application and fixes concrete workflow failures. Changes are local; no release, deployment, production migration, customer-data write or paid transaction was performed.

## Finished changes

- Invoice actions are directly accessible beside Save and Download PDF. Check e-invoice is the primary UAE action. The toolbar wraps at narrow widths without horizontal page overflow.
- Supported UAE invoice, commercial invoice and credit-note fields are available in the editor/review. Exempt and reverse-charge details survive saving. Credit type 81 uses the same reversal protections as type 381.
- Mobile invoice preview keeps the fixed A4 layout and scales the whole page to the available width. At a 390-pixel viewport, the dialog is 390 pixels wide and the page fits inside it.
- AI drafts and attachments stay with their conversation. Attachment additions accumulate, failed runs restore the composition for retry, and dictation cannot write into a different chat or account. Preview URLs are released.
- Teams reply links open the parent conversation. Touch-keyboard Enter inserts a new line; the send button posts. Scrolled-up or hidden mobile conversations do not prematurely clear unread messages.
- Settings lookups fail before writing if the read fails or the workspace changes. Thread reads reject late responses across workspace changes and preserve channel/direct-message boundaries.
- Email-template saves wait for durable storage. Failed saves retain drafts, stale refreshes cannot replace the saved mirror, and departed workspaces do not receive late success/error messages.
- Browser navigation is reachable. Documentation now covers actual local/cloud switching, browser availability, credential storage, business workflows and file-tool workflows.

## Tools and outputs

The existing catalog contains **88 tools**. The compatibility suite executes **75 engine routes** with synthetic inputs; HEIC is exercised separately in real Chromium. Interactive PDF operations also have studio and processing regressions. This is not a claim that every combination of input format, device and editor operation was clicked manually.

- Remove PDF Password requests the current password and creates an unlocked copy preserving pages and selectable content. Wrong passwords are rejected. The UI shows a prominent Download results action.
- Failed conversions clear stale progress. Empty output cannot be reported as success.
- Generated files can pass directly into another compatible tool through the shared searchable menu. The browser audit verified unlock → compress → result with synthetic input.
- Multi-page previews use the correct source pages. Failed previews discard stale images.
- PDF.js documents/workers are released after extraction, OCR, raster conversion and related operations.
- HEIC decoding runs in an owned worker using the installed CSP-compatible decoder. Abort, errors and a 30-second deadline terminate the worker. Cancellation from a progress callback is also handled, and decoded bitmap/canvas resources are released.

Verified output formats include PDF, text, CSV, JSON, common raster images, SVG, ZIP, DOCX, XLSX, PPTX, RTF, CBZ, TIFF and PSD conversions. The matrix checks parsed PDFs, archive contents and OCR text, rather than just accepting a successful return value.

Material format limits remain: Office conversions preserve supported content rather than full original layouts; PDF table extraction is heuristic; redaction/sanitization rasterize pages; archival metadata is not PDF/A certification. The HEIC check covers one valid fixture and safe rejection/timeout behavior. HEIF sequences currently use the first image.

## Validation results

| Check | Result |
| --- | --- |
| Full frontend suite | 2,045 tests passed in 306 files |
| Backend edge-function suite with network denied | 101 tests passed |
| Windows native library | Compiled; 20 tests passed |
| Real Chromium file-tool checks | 8 passed, including HEIC under the desktop CSP, password removal, cancellation recovery, sanitization, SVG/WASM and Arabic PDF rendering |
| Official UBL XSD plus both vendored PINT-AE Schematrons | 13 supported synthetic scenarios passed |
| Web typecheck/build | Passed |
| Whole-repository ESLint | 0 errors; 544 warnings remain |
| New file-tools guide | Existing route/search/guide suite passed after the guide was added |

The native tests required selecting the installed MSVC cross compiler: the ambient environment otherwise selected Git's unrelated link.exe. No machine-wide compiler settings were changed.

The evidence logs and UI screenshots are in ignored `output/`, including `final-app-audit-tests.log`, `audit-edge-tests.log`, `audit-desktop-tests.log`, `final-app-audit-build.log`, `password-remover-result.png`, `invoice-actions-desktop.png` and `invoice-fit-mobile.png`.

## Boundaries requiring separate live checks

Production cloud migrations/session renewal and transfer of a real workspace were not tested by this batch. Real WhatsApp/email recipient delivery, paid checkout, cloud file saving, native save dialogs and physical iPhone/Safari behavior were not exercised. Configured providers and their permissions remain necessary.

Local e-invoice checks and XML export do not submit a document or certify provider acceptance. Complex deemed/margin/summary/continuous/agent/e-commerce accounting cases remain blocked from XML until their treatment is implemented and tested. Supported synthetic validation is not accreditation or a tax-compliance guarantee.

Email templates still use one setting for a small list; simultaneous edits on different devices need per-template revisions to prevent competing whole-list writes. Chat attachment drafts stay in memory during the open workspace rather than persisting across reloads.

The section-by-section business workflow evidence is in [2026-09-30-workflows.md](2026-09-30-workflows.md).
