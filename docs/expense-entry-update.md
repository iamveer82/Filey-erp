# Purchase entry — 13 September 2026

The Purchase page's **Log expense** action now opens `/purchase/new`. The form collects vendor, expense date, category, receipt/invoice reference, currency and exchange rate, item descriptions, quantities, units and unit prices, discount, tax, payment method, ledger accounts and notes. Totals use the shared invoice arithmetic. A saved expense opens on `/purchase/:id`, including its line items and downloadable receipt. Older expense records remain readable.

A PDF, PNG, JPG or WebP receipt up to 10 MB can be selected or dropped onto the form. It is saved only when the user saves the expense. Device mode uses local file storage; cloud mode uses the existing private My Files bucket. A failed expense save keeps the form and already-uploaded receipt for retry, without uploading a second copy. Removing/deleting an expense does not erase its supporting file from My Files.

This workflow records paid expenses, including tax in the expense total. Recoverable input tax and unpaid supplier bills continue through Purchase Invoices. Foreign-currency amounts use a rate saved with the expense and are posted to the existing AED accounting base. The default account is Operating Expenses, never an unrelated first expense account such as Cost of Goods Sold.

Expense creation and its two ledger entries now commit together. Repeated submissions of the same draft return the existing expense; a changed retry cannot silently replace that expense. Deleting an expense reverses its linked ledger entries and balances in the same transaction. Historical records and previously orphaned ledger entries are not reclassified or rewritten by this update.

## Validation and deployment

- Focused frontend, accounting and tool runs passed: 28 checks, followed by 22 checks (five expense checks overlap; 45 distinct checks in total).
- Tests cover receipt bytes after saving/reloading, line totals and exchange rates, invalid input, repeated submission, retained form/upload after failed save, correct account selection, failed local storage rollback and ledger reversal.
- The actual cloud SQL was run twice in a disposable PostgreSQL database. Tests verified atomic failure, retry behavior, cross-organization rejection, receipt access and deletion reversal, alongside the existing RLS/module checks.
- The production Vite build, TypeScript check, route bundle checks and changed-file lint passed (lint warnings remain).
- Live browser QA checked purchase navigation, line totals, PDF receipt selection, cancel/discard, and light/dark layouts at desktop and 390px width. No business records were saved, edited or deleted during browser QA.
- A live organizer run loaded four thumbnail pages, opened a full-page preview, removed one page and downloaded the result. Reopening the downloaded PDF with pdf-lib confirmed three pages.
- `supabase/2026-09-13-expense-entry.sql` was applied to the configured Filey cloud project. Both expense RPCs were verified as SECURITY INVOKER, executable by authenticated users and unavailable to anonymous users. Production business writes were not used for testing. Native packaged-app verification remains a release check.

## Related tool fixes

PDF text export now explains when a scanned document needs OCR instead of presenting an empty file as success. JSON text export likewise directs scanned documents through OCR. Lossless compression never returns a file larger than the input and reports when the PDF is already optimized.

The page organizer initially renders thumbnails only and loads the focused page on demand, reducing bitmap memory use on long documents. Failed previews show a persistent error and prevent invalid output. Extraction requires a selection and splitting requires a cut. Text/JSON/table extraction and flattening/color transforms now release their PDF.js workers on success or failure. The real conversion-engine checks continue to pass, including actual PDF rendering, OCR and archive output checks.

The user did not identify the specific failing tools in this request; these are the failures found and corrected during this pass. Existing format limitations remain documented in [Tools reliability updates](tools-reliability-update.md).
