# UAE invoice readiness and workflow audit — 8 October 2026

## Fixed

- New manual, scanned and agent invoice drafts read a fresh company snapshot, including saved location, legal registration and electronic identity. Existing drafts have an explicit fill-missing action; manual values and issued document snapshots are preserved.
- Quotation conversion carries matched seller and customer-ID presets, rejects conflicting tax entities, and stops when the workspace changes, including an A → B → A switch.
- Company, customer and supplier forms retain nested identity details, preserve E.164-only phone numbers and persist deliberately cleared optional fields.
- Delayed New, Edit, Duplicate and Credit Note responses cannot replace newer edits or reopen a closed invoice editor.
- XML export rejects malformed imported values and forbidden XML characters, includes party contacts and places GTIN/service classification elements in the required UBL order.
- Hosted agent replies after a failed tool action use verified receipts instead of unsupported completion claims. Uncertain writes remain protected from automatic repetition.
- Schema verification checks identity JSON columns and the exact UUID preservation function/trigger, including its namespace and execution conditions.

## UUID and submission boundary

The [MoF June 2026 guidelines, section 5.2](https://mof.gov.ae/wp-content/uploads/2026/06/UAE-Electronic-Invoicing-Guidelines_V-1.1-01June2026.pdf) assign UUID generation to the Accredited Service Provider (ASP). Filey's existing identifier is labelled **Preparation UUID**. It must not be represented as an FTA-issued or ASP-confirmed identifier. An ASP integration must retain the final submission identity and acknowledgement separately without rewriting the original preparation identity.

The [PINT-AE UUID semantic rule](https://docs.peppol.eu/poac/ae/pint-ae/trn-invoice/semantic-model/btae-07/) requires a globally unique invoice identifier. Filey's UUID shape check is an integrity constraint, not a claim that the official Schematron imposes that regular expression.

Preparation, validation, preview and XML generation are distinct from accredited submission. No ASP sandbox or production delivery was exercised in this audit.

## Verification

- Production TypeScript/Vite build passed.
- Targeted preset, conversion, customer/supplier, local upgrade, XML and invoice-editor regressions passed; the final document-action suite passed 58 tests.
- 136 invoice display/template checks passed, including all built-in formats.
- 23 synthetic XML documents passed UBL 2.1 XSD and both official PINT-AE 1.0.4 Schematron stages. Vendored validation stylesheets matched the official resources.
- 45 hosted-agent/tool tests passed with Deno typechecking.
- 35 schema verifier tests passed. Fresh PostgreSQL bootstrap, atomicity, legacy-installation protection and resulting catalog checks passed.
- Read-only live Supabase catalog verification passed: 93 tables, 1,208 columns and 129 inspected functions, with no required-schema issues. Current fixes use existing columns; no production DDL was needed.
- Browser checks verified seller preset filling, preservation of a manual address, and no horizontal overflow at a 393-pixel mobile viewport in dark mode.
- The first full unit run overlapped source edits and reported five stale-module failures; all three affected files passed after the tree was frozen. Clean pull-request CI remains the final full-suite gate.

No real invoices, payments, customer messages or local database files were modified during testing. This is a scoped audit, not a certification that every possible defect or security issue has been eliminated.

## Follow-up: hosted drafts, imports and queued saves

- Hosted invoice, quote and purchase-order drafts share the authenticated app's numbering allocator. The service-only wrapper checks the current owner's workspace and locks the same numbering namespace. Retries reuse their reservation; existing documents are not renumbered.
- Hosted drafts retain requested dates, notes, terms, company/customer identity snapshots and custom pricing fields. The supplied quantity, unit and rate remain unchanged. Unsupported overrides and invalid amounts fail before allocating a number.
- Scans retain zero quantities and units, reject invalid output, stop when their dialog/workspace closes, and retain the exact save request after an uncertain acknowledgement. Oversized PDFs explicitly fail instead of silently omitting pages.
- Supplier XML imports preserve their original AED exchange rate and supplier identity. Delayed profile requests cannot replace another account's profile. Failed/conflicting legacy queued saves remain available, with pending counts and retry controls in Settings.
- The frozen frontend slice passed 144 focused tests across nine files and a production build. Independent hosted verification passed 54 Deno tests and 25 schema tests. Disposable PostgreSQL tests exercised simultaneous hosted/app numbering, replay, grants, totals, snapshots and repeat upgrades.

Deployment order: apply `supabase/2026-10-08-hosted-draft-parity.sql` before the matching `channel-webhook` source. The regenerated fresh-install schema includes this upgrade. Local adapter compatibility is covered by isolated tests; user databases were not opened or rewritten. PR #57's clean CI, web deployment and persisted backend receipt fix were verified before this follow-up.

## Follow-up: public document privacy and agent recovery

- Reproduced anonymous document access after team-only sharing and hidden stamp/signature bytes in the public payload. Public consent now has an independent field and a guarded owner/admin RPC. Revocation rotates the token, clones start private, and stale saves/sync cannot restore access. Public JSON uses a field whitelist and respects artwork visibility.
- Historical team-sharing flags do not prove public consent. Their old links are disabled until the owner explicitly enables a new one. Team access and document content are unchanged. The public viewer uses saved payment status, never a URL flag; overdue reminder links require explicit public access.
- Reproduced a late company save contaminating another account's cache. Scope/mode epoch checks now protect every asynchronous boundary. Reproduced loss of a confirmed invoice receipt after a failed read-only follow-up; bounded earlier write receipts retain original run identity and remain separate from current task results.
- Sharing SQL authorization, MFA/module/tenant boundaries, token rotation, hidden artwork, record-copy privacy, mappings and repeated upgrades passed in disposable PostgreSQL. Final fresh bootstrap passed with 94 tables, 1,215 columns, 158 inspected functions and no required-schema issues. Local persistence, recurrence and sync regressions passed without opening the user's database.
- Root dependency audit reported zero known vulnerabilities. Browser security tests blocked arbitrary scripts, inline event handlers, dynamic JavaScript and private request redirects.

Apply `supabase/2026-10-08-public-link-isolation.sql` before the matching frontend and redeploy `overdue-reminders` with its updated shared helper. This is a permission repair; no real public links were enabled, messages sent or customer records created during testing.

## Production verification after upgrades

Both reviewed October 8 migrations were applied successfully. The live read-only catalog passes the current verifier with 93 tables, 1,212 columns, 136 inspected functions and no issues. The hosted draft/receipt files and reminder helper were deployed through the existing authenticated dashboard; source copied back after reload matched the reviewed files exactly. The production web bundle for PR #58 was verified independently of the preview deployment.

The old cloud-privacy fixture expected team visibility to authorize anonymous access. It now explicitly enables and revokes public links through the authenticated owner RPC, and asserts that team-only sharing remains private. The complete isolated privacy/bootstrap regression passes, including repeated installation and tenant isolation. Local upgrade, queued-save and concurrency checks passed without opening the user's database.

Navigation and temporary cloud-response recovery are covered; a hard reload, app closure or OS termination still cannot resume the entire agent automatically. No live model calls, payment transactions, external messages or accredited e-invoice submissions were used for verification.
